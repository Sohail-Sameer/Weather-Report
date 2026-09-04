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

ANALYZE_PROMPT = """Extract weather request data. Return ONLY JSON with location, language, forecast_days, weather_focus, time_reference, start_date, end_date. User language may be English, Hindi or Telugu. If no location, location is null. For future forecasts, forecast_days: current/today=1, tomorrow=2, next 3 days=3, next 5 days=5, week=7, up to 16 days when requested. For historical requests, identify the exact date or date range when possible and return start_date and end_date in YYYY-MM-DD format. If the user asks about past, historical, yesterday, a previous date, or a year/month in the past, use historical mode through the dates. For current or future requests, start_date and end_date should be null. weather_focus: general,rain,temperature,humidity,uv,wind,clothing,alerts."""

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
        params={
            "name": location_name,
            "count": 1,
            "language": "en",
            "format": "json",
        },
        timeout=15,
    )

    response.raise_for_status()
    data = response.json()

    results = data.get("results", [])

    if not results:
        return None

    place = results[0]

    return {
        "name": place.get("name"),
        "country": place.get("country"),
        "latitude": place.get("latitude"),
        "longitude": place.get("longitude"),
        "timezone": place.get("timezone"),
    }


def fetch_weather(latitude, longitude, forecast_days):
    days = max(1, min(int(forecast_days), 16))

    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": latitude,
            "longitude": longitude,
            "current": ",".join([
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "precipitation",
                "rain",
                "weather_code",
                "wind_speed_10m",
                "is_day",
            ]),
            "daily": ",".join([
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
                "precipitation_probability_max",
                "uv_index_max",
                "wind_speed_10m_max",
            ]),
            "forecast_days": days,
            "timezone": "auto",
        },
        timeout=15,
    )

    response.raise_for_status()
    return response.json()

def fetch_historical_weather(latitude, longitude, start_date, end_date):
    response = requests.get(
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "daily": ",".join([
                "weather_code",
                "temperature_2m_mean",
                "temperature_2m_max",
                "temperature_2m_min",
                "apparent_temperature_mean",
                "precipitation_sum",
                "rain_sum",
                "precipitation_hours",
                "wind_speed_10m_max",
            ]),
            "timezone": "auto",
        },
        timeout=30,
    )

    response.raise_for_status()
    return response.json()


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


@app.route("/api/history")
def api_history():
    try:
        latitude = float(request.args["latitude"])
        longitude = float(request.args["longitude"])
        start_date = request.args["start_date"]
        end_date = request.args.get("end_date", start_date)
    except (KeyError, ValueError):
        return jsonify({
            "error": "valid latitude, longitude, start_date and end_date are required"
        }), 400

    try:
        historical_data = fetch_historical_weather(
            latitude,
            longitude,
            start_date,
            end_date,
        )
        return jsonify({"weather": historical_data})
    except Exception as error:
        return jsonify({"error": str(error)}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
