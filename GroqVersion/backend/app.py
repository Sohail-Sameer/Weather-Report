import os
import json
import tempfile
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
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "https://ollama.com")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b")
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")

if not OLLAMA_API_KEY:
    raise RuntimeError("OLLAMA_API_KEY is missing in backend/.env")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing in backend/.env")
if not WEATHER_API_KEY:
    raise RuntimeError("WEATHER_API_KEY is missing in environment")

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
        "https://api.weatherapi.com/v1/search.json",
        params={
            "key": WEATHER_API_KEY,
            "q": location_name,
        },
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    if not data:
        return None

    place = data[0]

    return {
        "name": place.get("name"),
        "country": place.get("country"),
        "latitude": place.get("lat"),
        "longitude": place.get("lon"),
        "timezone": place.get("tz_id"),
    }


def weatherapi_code_to_wmo(code):
    mapping = {
        1000: 0,
        1003: 2,
        1006: 3,
        1009: 3,
        1030: 45,
        1063: 61,
        1066: 71,
        1069: 51,
        1072: 56,
        1087: 95,
        1114: 75,
        1117: 75,
        1135: 45,
        1147: 48,
        1150: 51,
        1153: 53,
        1168: 56,
        1171: 57,
        1180: 61,
        1183: 63,
        1186: 63,
        1189: 65,
        1192: 65,
        1195: 65,
        1198: 66,
        1201: 67,
        1204: 56,
        1207: 57,
        1210: 71,
        1213: 73,
        1216: 73,
        1219: 75,
        1222: 75,
        1225: 77,
        1237: 77,
        1240: 80,
        1243: 81,
        1246: 82,
        1249: 85,
        1252: 86,
        1255: 85,
        1258: 86,
        1261: 66,
        1264: 67,
        1273: 95,
        1276: 95,
        1279: 96,
        1282: 99,
    }

    return mapping.get(code, 3)


def fetch_weather(latitude, longitude, forecast_days):
    days = max(1, min(int(forecast_days), 3))

    response = requests.get(
        "https://api.weatherapi.com/v1/forecast.json",
        params={
            "key": WEATHER_API_KEY,
            "q": f"{latitude},{longitude}",
            "days": days,
            "aqi": "no",
            "alerts": "yes",
        },
        timeout=15,
    )

    response.raise_for_status()
    data = response.json()

    current = data["current"]
    forecast_days_data = data.get("forecast", {}).get("forecastday", [])

    daily_time = []
    daily_weather_code = []
    daily_max = []
    daily_min = []
    daily_precip = []
    daily_rain_prob = []
    daily_uv = []
    daily_wind = []

    for day in forecast_days_data:
        day_info = day.get("day", {})
        condition = day_info.get("condition", {})

        daily_time.append(day.get("date"))
        daily_weather_code.append(
            weatherapi_code_to_wmo(condition.get("code"))
        )
        daily_max.append(day_info.get("maxtemp_c"))
        daily_min.append(day_info.get("mintemp_c"))
        daily_precip.append(day_info.get("totalprecip_mm"))
        daily_rain_prob.append(day_info.get("daily_chance_of_rain"))
        daily_uv.append(day_info.get("uv"))
        daily_wind.append(day_info.get("maxwind_kph"))

    return {
        "current": {
            "temperature_2m": current.get("temp_c"),
            "relative_humidity_2m": current.get("humidity"),
            "apparent_temperature": current.get("feelslike_c"),
            "precipitation": current.get("precip_mm"),
            "rain": current.get("precip_mm"),
            "weather_code": weatherapi_code_to_wmo(
                current.get("condition", {}).get("code")
            ),
            "wind_speed_10m": current.get("wind_kph"),
            "is_day": current.get("is_day"),
        },
        "daily": {
            "time": daily_time,
            "weather_code": daily_weather_code,
            "temperature_2m_max": daily_max,
            "temperature_2m_min": daily_min,
            "precipitation_sum": daily_precip,
            "precipitation_probability_max": daily_rain_prob,
            "uv_index_max": daily_uv,
            "wind_speed_10m_max": daily_wind,
        },
    }


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
