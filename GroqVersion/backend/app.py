import os
import json
import tempfile
import time
from datetime import datetime

import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from ollama import Client
from groq import Groq

# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "https://ollama.com")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b")
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")

if not OLLAMA_API_KEY:
    raise RuntimeError("OLLAMA_API_KEY is missing in backend/.env")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing in backend/.env")

ollama_client = Client(host=OLLAMA_HOST, headers={"Authorization": f"Bearer {OLLAMA_API_KEY}"})
groq_client = Groq(api_key=GROQ_API_KEY)

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

# Same pattern as the pure-Ollama build: set ALLOWED_ORIGINS to your GitHub
# Pages URL once deployed. "*" (the default) is fine for local testing.
_allowed = os.getenv("ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _allowed.split(",")] if _allowed != "*" else "*"
CORS(app, resources={r"/api/*": {"origins": _origins}})

# ISO 639-1 codes <-> display names, used both as the transcription hint
# and to normalize whatever Groq's Whisper endpoint hands back.
LANG_CODE_TO_NAME = {"en": "English", "hi": "Hindi", "te": "Telugu"}
LANG_NAME_TO_CODE = {"english": "en", "hindi": "hi", "telugu": "te"}

ANALYZE_PROMPT = """Extract weather request data. Return ONLY JSON with location, language, forecast_days, weather_focus, time_reference. User language may be English, Hindi or Telugu. If no location, location is null. forecast_days: current/today=1, tomorrow=2, next 3 days=3, next 5 days=5, week=7. weather_focus: general,rain,temperature,humidity,uv,wind,clothing,alerts."""

REPORT_PROMPT = """You are WeatherGPT. Using the provided request, location, Open-Meteo weather data and alerts, answer accurately. Respond only in {language}. No markdown, no emojis, no invented facts. Use Celsius, km/h and mm. Be concise and practical."""


# ============================================================
# CORE LOGIC
# ============================================================

def clean_json(raw_text):
    text = raw_text.replace("```json", "").replace("```", "").strip()
    start = text.find("{")
    end = text.rfind("}")
    return json.loads(text[start:end + 1])


def analyze(user_query):
    response = ollama_client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": ANALYZE_PROMPT},
            {"role": "user", "content": user_query},
        ],
        options={"temperature": 0},
    )
    return clean_json(response.message.content)


def geocode(location_name):
    response = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": location_name, "count": 1, "language": "en", "format": "json"},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    if not data.get("results"):
        return None

    place = data["results"][0]
    return {
        "name": place.get("name"),
        "country": place.get("country"),
        "latitude": place.get("latitude"),
        "longitude": place.get("longitude"),
        "timezone": place.get("timezone"),
    }


# ------------------------------------------------------------
# Open-Meteo's free tier rate-limits by IP address (600/min,
# 5,000/hour, 10,000/day), and Render's free web services share
# outbound IPs across many unrelated apps — so 429s can happen
# even on your very first request if that shared IP's quota was
# already used up by someone else.
#
# Strategy, in order, on every request:
#   1. Serve from the shared in-memory cache if we already have
#      recent data for this location — regardless of which
#      provider originally fetched it, so one user's successful
#      call saves every other user asking about the same place.
#   2. Try Open-Meteo (with retry/backoff on 429).
#   3. If Open-Meteo is still failing, fall back to WeatherAPI.com
#      for just this request (requires WEATHERAPI_KEY). Its
#      response is normalized into Open-Meteo's exact shape, so
#      nothing downstream (alerts, frontend rendering) needs to
#      know or care which provider actually answered.
#   4. The very next request tries Open-Meteo again from scratch —
#      there's no "switched over" state to recover from, so it
#      self-heals the moment Open-Meteo's shared IP clears up.
# ------------------------------------------------------------

WEATHERAPI_KEY = os.getenv("WEATHERAPI_KEY")  # optional; fallback is skipped if unset

_WEATHER_CACHE = {}
_WEATHER_CACHE_TTL_SECONDS = 900  # 15 minutes


def _cache_get(cache_key):
    cached = _WEATHER_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _WEATHER_CACHE_TTL_SECONDS:
        return cached[1]
    return None


def _cache_set(cache_key, data):
    _WEATHER_CACHE[cache_key] = (time.time(), data)


def _fetch_open_meteo(latitude, longitude, forecast_days):
    params = {
        "latitude": latitude,
        "longitude": longitude,
        # is_day drives which icon (sun vs moon) the frontend shows.
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,"
                   "precipitation,rain,weather_code,wind_speed_10m,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                 "precipitation_sum,precipitation_probability_max,"
                 "uv_index_max,wind_speed_10m_max",
        "forecast_days": forecast_days,
        "timezone": "auto",
    }

    max_attempts = 3
    backoff_seconds = 1.5
    last_error = None

    for attempt in range(1, max_attempts + 1):
        response = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=15)

        if response.status_code == 429:
            last_error = requests.HTTPError(response=response)
            if attempt < max_attempts:
                retry_after = response.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else backoff_seconds * attempt
                time.sleep(wait)
                continue
            break

        response.raise_for_status()
        return response.json()

    raise last_error


# Loose keyword mapping from WeatherAPI's free-text condition to a
# representative WMO code, so the existing icon/category logic in
# script.js (built around Open-Meteo's WMO codes) keeps working
# unchanged no matter which provider answered.
def _condition_text_to_wmo(text):
    t = (text or "").lower()
    if "thunder" in t:
        return 95
    if "snow" in t or "sleet" in t or "ice pellet" in t or "blizzard" in t:
        return 73
    if "freezing" in t and "rain" in t:
        return 66
    if "drizzle" in t:
        return 51
    if "rain" in t or "shower" in t:
        return 63
    if "mist" in t or "fog" in t:
        return 45
    if "overcast" in t:
        return 3
    if "cloud" in t:
        return 2 if "partly" in t else 3
    if "clear" in t or "sunny" in t:
        return 0
    return 2


def _fetch_weatherapi(latitude, longitude, forecast_days):
    if not WEATHERAPI_KEY:
        raise RuntimeError("No WEATHERAPI_KEY configured, can't fall back")

    # WeatherAPI's free plan caps forecasts at 3 days.
    days = max(1, min(forecast_days, 3))

    response = requests.get(
        "https://api.weatherapi.com/v1/forecast.json",
        params={"key": WEATHERAPI_KEY, "q": f"{latitude},{longitude}", "days": days, "aqi": "no", "alerts": "no"},
        timeout=15,
    )
    response.raise_for_status()
    raw = response.json()

    current = raw.get("current", {})
    forecast_days_list = raw.get("forecast", {}).get("forecastday", [])

    normalized = {
        "current": {
            "temperature_2m": current.get("temp_c"),
            "relative_humidity_2m": current.get("humidity"),
            "apparent_temperature": current.get("feelslike_c"),
            "precipitation": current.get("precip_mm"),
            "rain": current.get("precip_mm"),
            "weather_code": _condition_text_to_wmo(current.get("condition", {}).get("text")),
            "wind_speed_10m": current.get("wind_kph"),
            "is_day": current.get("is_day", 1),
        },
        "daily": {
            "time": [d.get("date") for d in forecast_days_list],
            "weather_code": [_condition_text_to_wmo(d.get("day", {}).get("condition", {}).get("text")) for d in forecast_days_list],
            "temperature_2m_max": [d.get("day", {}).get("maxtemp_c") for d in forecast_days_list],
            "temperature_2m_min": [d.get("day", {}).get("mintemp_c") for d in forecast_days_list],
            "precipitation_sum": [d.get("day", {}).get("totalprecip_mm") for d in forecast_days_list],
            "precipitation_probability_max": [d.get("day", {}).get("daily_chance_of_rain") for d in forecast_days_list],
            "uv_index_max": [d.get("day", {}).get("uv") for d in forecast_days_list],
            "wind_speed_10m_max": [d.get("day", {}).get("maxwind_kph") for d in forecast_days_list],
        },
    }
    return normalized


def fetch_weather(latitude, longitude, forecast_days):
    forecast_days = max(1, min(int(forecast_days), 7))
    cache_key = (round(float(latitude), 2), round(float(longitude), 2), forecast_days)

    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        data = _fetch_open_meteo(latitude, longitude, forecast_days)
        print(f"[weather] served by open-meteo for {cache_key}")
        _cache_set(cache_key, data)
        return data
    except requests.HTTPError as open_meteo_error:
        is_429 = open_meteo_error.response is not None and open_meteo_error.response.status_code == 429
        if not is_429 or not WEATHERAPI_KEY:
            raise

        print(f"[weather] open-meteo 429, falling back to weatherapi for {cache_key}")
        data = _fetch_weatherapi(latitude, longitude, forecast_days)
        _cache_set(cache_key, data)
        return data


def build_alerts(weather_data):
    alerts = []
    current = weather_data.get("current", {})
    daily = weather_data.get("daily", {})

    temperature = current.get("temperature_2m")
    wind_speed = current.get("wind_speed_10m")

    if temperature is not None and temperature >= 40:
        alerts.append("Extreme heat alert: Temperature is 40°C or above.")
    elif temperature is not None and temperature >= 35:
        alerts.append("High temperature alert: Avoid prolonged direct sunlight.")

    if wind_speed is not None and wind_speed >= 50:
        alerts.append("Strong wind alert: Outdoor activities may be affected.")

    for i, p in enumerate(daily.get("precipitation_probability_max", [])):
        if p is not None and p >= 80:
            alerts.append(f"High rain probability on forecast day {i + 1}: {p}%.")

    for i, p in enumerate(daily.get("precipitation_sum", [])):
        if p is not None and p >= 30:
            alerts.append(f"Heavy rainfall expected on forecast day {i + 1}: {p} mm.")

    for i, u in enumerate(daily.get("uv_index_max", [])):
        if u is not None and u >= 8:
            alerts.append(f"Very high UV expected on forecast day {i + 1}: UV index {u}.")

    return alerts or ["No major weather alerts detected."]


def guess_suffix(uploaded_file):
    name = (uploaded_file.filename or "").lower()
    mimetype = (uploaded_file.mimetype or "").lower()

    if "ogg" in mimetype or name.endswith(".ogg"):
        return ".ogg"
    if "wav" in mimetype or name.endswith(".wav"):
        return ".wav"
    if "mp4" in mimetype or name.endswith((".m4a", ".mp4")):
        return ".m4a"
    return ".webm"


def normalize_language(raw_value, fallback_code):
    """
    Groq's Whisper endpoint sometimes returns a full language name
    ('english') and sometimes a bare code ('en') depending on model
    version. This maps either form to a consistent {code, name} pair
    instead of silently returning whatever Whisper handed back.
    """
    value = (raw_value or "").strip().lower()

    if value in LANG_CODE_TO_NAME:
        code = value
    elif value in LANG_NAME_TO_CODE:
        code = LANG_NAME_TO_CODE[value]
    else:
        code = fallback_code or "en"

    return code, LANG_CODE_TO_NAME.get(code, (raw_value or "Unknown").title())


def transcribe(audio_path, preferred_language="auto"):
    language_hint = preferred_language if preferred_language in LANG_CODE_TO_NAME else None

    with open(audio_path, "rb") as f:
        kwargs = {
            "file": (os.path.basename(audio_path), f.read()),
            "model": GROQ_WHISPER_MODEL,
            "response_format": "verbose_json",
            "temperature": 0.0,
        }
        if language_hint:
            kwargs["language"] = language_hint

        result = groq_client.audio.transcriptions.create(**kwargs)

    transcript = (getattr(result, "text", "") or "").strip()
    code, name = normalize_language(getattr(result, "language", None), language_hint)

    return {"transcript": transcript, "language_code": code, "language": name}


# ============================================================
# API ROUTES
# ============================================================

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "groq_model": GROQ_WHISPER_MODEL, "ollama_model": OLLAMA_MODEL})


@app.route("/api/transcribe", methods=["POST"])
def api_transcribe():
    uploaded_file = request.files.get("audio")
    if not uploaded_file or not uploaded_file.filename:
        return jsonify({"error": "audio file is required"}), 400

    preferred_language = request.form.get("preferred_language", "auto").strip().lower()
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=guess_suffix(uploaded_file)) as tmp:
            temp_path = tmp.name
            uploaded_file.save(temp_path)

        result = transcribe(temp_path, preferred_language)

        if not result["transcript"]:
            return jsonify({"error": "No speech could be detected. Try speaking closer to the mic."}), 422

        return jsonify(result)

    except Exception as error:
        print("Groq transcription error:", error)
        return jsonify({"error": f"Voice transcription failed: {error}"}), 502

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    query = (request.get_json(silent=True) or {}).get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400

    try:
        return jsonify(analyze(query))
    except Exception as error:
        return jsonify({"error": f"Query analysis failed: {error}"}), 502


@app.route("/api/geocode")
def api_geocode():
    location_name = (request.args.get("location") or "").strip()
    if not location_name:
        return jsonify({"error": "location is required"}), 400

    try:
        location = geocode(location_name)
    except requests.RequestException as error:
        return jsonify({"error": str(error)}), 502

    if not location:
        return jsonify({"error": "Location could not be found."}), 404

    return jsonify(location)


@app.route("/api/weather")
def api_weather():
    try:
        latitude = float(request.args["latitude"])
        longitude = float(request.args["longitude"])
    except (KeyError, ValueError):
        return jsonify({"error": "valid latitude and longitude are required"}), 400

    forecast_days = request.args.get("forecast_days", 3)

    try:
        weather_data = fetch_weather(latitude, longitude, forecast_days)
        return jsonify({"weather": weather_data, "alerts": build_alerts(weather_data)})
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 429:
            # Only reachable if the WeatherAPI fallback also failed (or
            # WEATHERAPI_KEY isn't set) — Open-Meteo alone being rate
            # limited no longer surfaces to the user.
            message = (
                "Open-Meteo is rate-limiting this server's IP right now, and "
                "the backup weather source also failed. Please try again in "
                "a minute or two."
                if WEATHERAPI_KEY else
                "Open-Meteo is rate-limiting this server's IP right now "
                "(common on shared free hosting). Add a WEATHERAPI_KEY "
                "environment variable to enable automatic fallback, or try "
                "again in a minute or two."
            )
            return jsonify({"error": message}), 503
        return jsonify({"error": str(error)}), 502
    except Exception as error:
        return jsonify({"error": str(error)}), 502


@app.route("/api/report", methods=["POST"])
def api_report():
    body = request.get_json(silent=True) or {}
    language = body.get("language", "English")

    try:
        response = ollama_client.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": REPORT_PROMPT.format(language=language)},
                {"role": "user", "content": json.dumps(body, ensure_ascii=False)},
            ],
        )
        return jsonify({"report": response.message.content})
    except Exception as error:
        return jsonify({"error": f"Report generation failed: {error}"}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
