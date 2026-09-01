import os
import json
from datetime import datetime

import requests
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
from ollama import Client

# ============================================================
# CONFIGURATION
# ============================================================

load_dotenv()

MODEL = "gpt-oss:120b"

OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY")

if not OLLAMA_API_KEY:
    raise RuntimeError(
        "OLLAMA_API_KEY is not set. Create a .env file in backend/ "
        "(see .env.example) and set it there. Never hardcode it in source."
    )

client = Client(
    host="https://ollama.com",
    headers={"Authorization": "Bearer " + OLLAMA_API_KEY},
)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")


# ============================================================
# QUERY ANALYSIS PROMPT  (unchanged from the original script)
# ============================================================

QUERY_ANALYSIS_PROMPT = """
You are an information extraction system for WeatherGPT.

Analyze the user's weather request.

The request may be in English, Hindi, or Telugu.

Extract the following information:

1. location
2. language
3. forecast_days
4. weather_focus
5. time_reference

Return ONLY valid JSON.

LANGUAGE RULES:

Supported languages are:

English
Hindi
Telugu

If the user explicitly requests a response language,
use that language.

Otherwise detect the language used by the user.

Examples:

English input -> English
Hindi input -> Hindi
Telugu input -> Telugu


LOCATION RULES:

Extract the city or location mentioned by the user.

If no location is mentioned:

"location": null


FORECAST DAYS RULES:

Current weather -> 1
Today -> 1
Tomorrow -> 2
Next 3 days -> 3
Next 5 days -> 5
Week forecast -> 7
Next week -> 7

Never return more than 7.


WEATHER FOCUS:

Choose exactly one:

general
rain
temperature
humidity
uv
wind
clothing
alerts


TIME REFERENCE:

Choose an appropriate value such as:

current
today
tomorrow
next_3_days
next_5_days
next_week


Example:

User input:

Will it rain tomorrow in Hyderabad?
Answer in Telugu.

Output:

{
    "location": "Hyderabad",
    "language": "Telugu",
    "forecast_days": 2,
    "weather_focus": "rain",
    "time_reference": "tomorrow"
}

Return ONLY JSON.
"""


# ============================================================
# WEATHER REPORT PROMPT  (unchanged from the original script)
# ============================================================

WEATHER_REPORT_PROMPT = """
You are WeatherGPT.

You are given:

1. The original user request
2. Location information
3. Weather data from Open-Meteo
4. Automatically generated weather alerts

Generate an accurate and useful weather response.

RULES:

1. Respond only in the requested language.
2. Never use markdown.
3. Never use emojis.
4. Never use em-dashes.
5. Be concise but informative.
6. Prioritize the information requested by the user.
7. Give practical advice.
8. Never invent weather information.
9. Clearly mention major weather alerts.
10. Use Celsius for temperature.
11. Use km/h for wind speed.
12. Use mm for precipitation.

If the user asks about rain:
Focus on precipitation probability and expected precipitation.

If the user asks about temperature:
Focus on current temperature and daily minimum and maximum.

If the user asks about humidity:
Focus on relative humidity.

If the user asks about UV:
Focus on UV index and sunlight protection.

If the user asks about wind:
Focus on wind speed.

If the user asks for clothing advice:
Use temperature, rain probability, wind, and UV.

If the user asks for multiple days:
Clearly separate the forecast by day.

Requested language: {language}

Current local time: {current_time}
"""


# ============================================================
# CORE LOGIC  (ported directly from the CLI script)
# ============================================================

def analyze_query(user_query):
    messages = [
        {"role": "system", "content": QUERY_ANALYSIS_PROMPT},
        {"role": "user", "content": user_query},
    ]

    response = client.chat(model=MODEL, messages=messages, options={"temperature": 0})

    content = response.message.content.strip()
    content = content.replace("```json", "").replace("```", "").strip()

    return json.loads(content)


def get_location_coordinates(location):
    url = "https://geocoding-api.open-meteo.com/v1/search"
    params = {"name": location, "count": 1, "language": "en", "format": "json"}

    response = requests.get(url, params=params, timeout=10)
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


def get_weather(latitude, longitude, forecast_days=3):
    try:
        forecast_days = int(forecast_days)
    except (ValueError, TypeError):
        forecast_days = 3

    forecast_days = max(1, min(forecast_days, 7))

    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "precipitation",
                "rain",
                "weather_code",
                "wind_speed_10m",
            ]
        ),
        "hourly": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "precipitation",
                "precipitation_probability",
                "dew_point_2m",
                "uv_index",
                "wind_speed_10m",
                "weather_code",
            ]
        ),
        "daily": ",".join(
            [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
                "precipitation_probability_max",
                "uv_index_max",
                "wind_speed_10m_max",
            ]
        ),
        "forecast_days": forecast_days,
        "timezone": "auto",
    }

    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def generate_weather_alerts(weather_data):
    alerts = []

    current = weather_data.get("current", {})
    daily = weather_data.get("daily", {})

    temperature = current.get("temperature_2m")
    if temperature is not None:
        if temperature >= 40:
            alerts.append("Extreme heat alert: Temperature is 40°C or above.")
        elif temperature >= 35:
            alerts.append("High temperature alert: Avoid prolonged direct sunlight.")

    wind_speed = current.get("wind_speed_10m")
    if wind_speed is not None and wind_speed >= 50:
        alerts.append("Strong wind alert: Outdoor activities may be affected.")

    probabilities = daily.get("precipitation_probability_max", [])
    for index, probability in enumerate(probabilities):
        if probability is not None and probability >= 80:
            alerts.append(
                f"High rain probability on forecast day {index + 1}: {probability}%."
            )

    precipitation = daily.get("precipitation_sum", [])
    for index, amount in enumerate(precipitation):
        if amount is not None and amount >= 30:
            alerts.append(
                f"Heavy rainfall expected on forecast day {index + 1}: {amount} mm."
            )

    uv_values = daily.get("uv_index_max", [])
    for index, uv in enumerate(uv_values):
        if uv is not None and uv >= 8:
            alerts.append(
                f"Very high UV expected on forecast day {index + 1}: UV index {uv}."
            )

    if not alerts:
        alerts.append("No major weather alerts detected.")

    return alerts


def generate_report(user_query, location, weather_data, alerts, language):
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    messages = [
        {
            "role": "system",
            "content": WEATHER_REPORT_PROMPT.format(
                language=language, current_time=current_time
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "user_request": user_query,
                    "location": location,
                    "weather_data": weather_data,
                    "weather_alerts": alerts,
                },
                indent=2,
                ensure_ascii=False,
            ),
        },
    ]

    response = client.chat(model=MODEL, messages=messages)
    return response.message.content


# ============================================================
# API ROUTES
# ============================================================

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    body = request.get_json(silent=True) or {}
    user_query = (body.get("query") or "").strip()

    if not user_query:
        return jsonify({"error": "query is required"}), 400

    try:
        query_data = analyze_query(user_query)
        return jsonify(query_data)
    except json.JSONDecodeError:
        return jsonify({"error": "Could not parse the model response"}), 502
    except Exception as error:
        return jsonify({"error": str(error)}), 502


@app.route("/api/geocode", methods=["GET"])
def api_geocode():
    location = (request.args.get("location") or "").strip()

    if not location:
        return jsonify({"error": "location is required"}), 400

    try:
        location_data = get_location_coordinates(location)
    except requests.RequestException as error:
        return jsonify({"error": str(error)}), 502

    if not location_data:
        return jsonify({"error": "Location could not be found"}), 404

    return jsonify(location_data)


@app.route("/api/weather", methods=["GET"])
def api_weather():
    try:
        latitude = float(request.args.get("latitude"))
        longitude = float(request.args.get("longitude"))
    except (TypeError, ValueError):
        return jsonify({"error": "valid latitude and longitude are required"}), 400

    forecast_days = request.args.get("forecast_days", 3)

    try:
        weather_data = get_weather(latitude, longitude, forecast_days)
    except requests.RequestException as error:
        return jsonify({"error": str(error)}), 502

    if not weather_data:
        return jsonify({"error": "Weather data could not be retrieved"}), 502

    alerts = generate_weather_alerts(weather_data)

    return jsonify({"weather": weather_data, "alerts": alerts})


@app.route("/api/report", methods=["POST"])
def api_report():
    body = request.get_json(silent=True) or {}

    required = ["user_query", "location", "weather_data", "alerts", "language"]
    missing = [field for field in required if field not in body]
    if missing:
        return jsonify({"error": f"missing fields: {', '.join(missing)}"}), 400

    try:
        report = generate_report(
            user_query=body["user_query"],
            location=body["location"],
            weather_data=body["weather_data"],
            alerts=body["alerts"],
            language=body["language"],
        )
        return jsonify({"report": report})
    except Exception as error:
        return jsonify({"error": str(error)}), 502


# ============================================================
# STATIC FRONTEND
# ============================================================

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
