import os
import requests
import json
import datetime
import speech_recognition as sr
from ollama import Client


# ============================================================
# CONFIGURATION
# ============================================================


client = Client(
    host="https://ollama.com",
    headers={
        'Authorization': 'Bearer ' + "c54e5e495fed4705abb4fd4084555999.b4a8yxRj7Rpfs8xjWLY8pJfs"
    }
)


MODEL = "gpt-oss:120b"


# ============================================================
# QUERY ANALYSIS PROMPT
# ============================================================

QUERY_ANALYSIS_PROMPT = """
You are an information extraction system for WeatherGPT.

Analyze the user's weather request.

Extract:

1. location
2. language
3. forecast_days
4. weather_focus
5. time_reference

Return ONLY valid JSON.

Rules:

location:
- Extract the city or location.
- If no location is mentioned, return null.

language:
- Detect the language in which the user wants the response.
- If the user explicitly requests a language, use it.
- Otherwise detect the language used by the user.

forecast_days:
- 1 for today or current weather.
- 2 if the request includes tomorrow.
- Up to 7 days for weekly forecasts.

weather_focus:
Possible values:
- general
- rain
- temperature
- humidity
- uv
- wind
- clothing
- alerts

time_reference:
Examples:
- today
- tomorrow
- weekend
- next_3_days
- next_week

Example input:
Will it rain tomorrow in Hyderabad? Answer in Telugu.

Example output:
{
    "location": "Hyderabad",
    "language": "Telugu",
    "forecast_days": 2,
    "weather_focus": "rain",
    "time_reference": "tomorrow"
}
"""


# ============================================================
# WEATHER REPORT PROMPT
# ============================================================

WEATHER_REPORT_PROMPT = """
You are WeatherGPT.

You receive:

1. User request
2. Location information
3. Weather data
4. Automatically generated weather alerts

Generate an accurate and useful weather response.

Rules:

1. Respond only in the requested language.
2. Do not use markdown.
3. Do not use emojis.
4. Do not use em-dashes.
5. Be concise.
6. Prioritize the information requested by the user.
7. Give practical advice.
8. Clearly mention severe weather alerts if present.
9. If the user asks about multiple days, organize the forecast clearly.
10. Never invent weather information.

Requested language: {language}
Current time: {current_time}
"""


# ============================================================
# VOICE INPUT
# ============================================================

def get_voice_input():

    recognizer = sr.Recognizer()

    try:

        with sr.Microphone() as source:

            print("\nListening...")

            recognizer.adjust_for_ambient_noise(
                source,
                duration=1
            )

            audio = recognizer.listen(
                source,
                timeout=10,
                phrase_time_limit=20
            )

        print("Processing voice...")

        text = recognizer.recognize_google(
            audio
        )

        return text

    except sr.WaitTimeoutError:

        print("No voice detected.")

        return None

    except sr.UnknownValueError:

        print("Could not understand the voice input.")

        return None

    except Exception as error:

        print(f"Voice input error: {error}")

        return None


# ============================================================
# USER INPUT
# ============================================================

def get_user_input():

    print("\nWeatherGPT")

    print("\n1. Type your question")
    print("2. Speak your question")

    choice = input(
        "\nChoose input method: "
    ).strip()


    if choice == "2":

        user_query = get_voice_input()

        if user_query:

            print(
                f"\nYou said: {user_query}"
            )

            return user_query

        return None


    user_query = input(
        "\nAsk about the weather: "
    )

    return user_query


# ============================================================
# ANALYZE USER QUERY
# ============================================================

def analyze_query(user_query):

    messages = [

        {
            "role": "system",
            "content": QUERY_ANALYSIS_PROMPT
        },

        {
            "role": "user",
            "content": user_query
        }

    ]


    response = client.chat(

        model=MODEL,

        messages=messages,

        options={
            "temperature": 0
        }

    )


    content = response.message.content.strip()


    # Remove accidental markdown code blocks

    content = content.replace(
        "```json",
        ""
    )

    content = content.replace(
        "```",
        ""
    )

    try:

        return json.loads(
            content
        )

    except json.JSONDecodeError:

        print(
            "\nCould not analyze the request."
        )

        print(
            "LLM response:"
        )

        print(content)

        return None


# ============================================================
# LOCATION GEOCODING
# ============================================================

def get_location_coordinates(location):

    url = (
        "https://geocoding-api.open-meteo.com/v1/search"
    )

    params = {

        "name": location,

        "count": 1,

        "language": "en",

        "format": "json"

    }


    response = requests.get(

        url,

        params=params,

        timeout=10

    )


    response.raise_for_status()

    data = response.json()


    if "results" not in data:

        return None


    place = data["results"][0]


    return {

        "name": place.get("name"),

        "country": place.get("country"),

        "latitude": place.get("latitude"),

        "longitude": place.get("longitude"),

        "timezone": place.get("timezone")

    }


# ============================================================
# GET WEATHER DATA
# ============================================================

def get_weather(

    latitude,

    longitude,

    forecast_days=3

):

    forecast_days = max(
        1,
        min(
            int(forecast_days),
            7
        )
    )


    url = (
        "https://api.open-meteo.com/v1/forecast"
    )


    params = {

        "latitude": latitude,

        "longitude": longitude,


        "current": ",".join([

            "temperature_2m",

            "relative_humidity_2m",

            "apparent_temperature",

            "precipitation",

            "rain",

            "weather_code",

            "wind_speed_10m"

        ]),


        "hourly": ",".join([

            "temperature_2m",

            "relative_humidity_2m",

            "precipitation",

            "precipitation_probability",

            "dew_point_2m",

            "uv_index",

            "wind_speed_10m",

            "weather_code"

        ]),


        "daily": ",".join([

            "weather_code",

            "temperature_2m_max",

            "temperature_2m_min",

            "precipitation_sum",

            "precipitation_probability_max",

            "uv_index_max",

            "wind_speed_10m_max"

        ]),


        "forecast_days": forecast_days,

        "timezone": "auto"

    }


    response = requests.get(

        url,

        params=params,

        timeout=10

    )


    response.raise_for_status()


    return response.json()


# ============================================================
# WEATHER ALERT SYSTEM
# ============================================================

def generate_weather_alerts(weather_data):

    alerts = []


    current = weather_data.get(

        "current",

        {}

    )


    daily = weather_data.get(

        "daily",

        {}

    )


    # --------------------------------------------------------
    # CURRENT TEMPERATURE
    # --------------------------------------------------------

    temperature = current.get(
        "temperature_2m"
    )


    if temperature is not None:

        if temperature >= 40:

            alerts.append(
                "Extreme heat alert: Temperature is 40°C or above."
            )

        elif temperature >= 35:

            alerts.append(
                "High temperature alert: Avoid prolonged exposure to direct sunlight."
            )


    # --------------------------------------------------------
    # WIND
    # --------------------------------------------------------

    wind_speed = current.get(
        "wind_speed_10m"
    )


    if wind_speed is not None:

        if wind_speed >= 50:

            alerts.append(
                "Strong wind alert: Outdoor activities may be affected."
            )


    # --------------------------------------------------------
    # DAILY FORECAST
    # --------------------------------------------------------

    probabilities = daily.get(

        "precipitation_probability_max",

        []

    )


    precipitation = daily.get(

        "precipitation_sum",

        []

    )


    uv_values = daily.get(

        "uv_index_max",

        []

    )


    # --------------------------------------------------------
    # HEAVY RAIN
    # --------------------------------------------------------

    for index, probability in enumerate(
        probabilities
    ):

        if probability is not None and probability >= 80:

            alerts.append(
                f"High rain probability alert on forecast day {index + 1}: {probability}%."
            )


    # --------------------------------------------------------
    # HEAVY PRECIPITATION
    # --------------------------------------------------------

    for index, amount in enumerate(
        precipitation
    ):

        if amount is not None and amount >= 30:

            alerts.append(
                f"Heavy rainfall alert on forecast day {index + 1}: {amount} mm expected."
            )


    # --------------------------------------------------------
    # UV ALERT
    # --------------------------------------------------------

    for index, uv in enumerate(
        uv_values
    ):

        if uv is not None and uv >= 8:

            alerts.append(
                f"Very high UV alert on forecast day {index + 1}: UV index {uv}."
            )


    if not alerts:

        alerts.append(
            "No major weather alerts detected."
        )


    return alerts


# ============================================================
# GENERATE WEATHER RESPONSE
# ============================================================

def generate_report(

    user_query,

    location,

    weather_data,

    alerts,

    language

):

    current_time = datetime.datetime.now().strftime(

        "%Y-%m-%d %H:%M:%S"

    )


    messages = [

        {

            "role": "system",

            "content": WEATHER_REPORT_PROMPT.format(

                language=language,

                current_time=current_time

            )

        },


        {

            "role": "user",

            "content": json.dumps(

                {

                    "user_request": user_query,

                    "location": location,

                    "weather_data": weather_data,

                    "weather_alerts": alerts

                },

                indent=2

            )

        }

    ]


    response = client.chat(

        model=MODEL,

        messages=messages

    )


    return response.message.content


# ============================================================
# MAIN APPLICATION
# ============================================================

def main():

    # --------------------------------------------------------
    # GET USER QUERY
    # --------------------------------------------------------

    user_query = get_user_input()


    if not user_query:

        print(
            "No valid input received."
        )

        return


    # --------------------------------------------------------
    # ANALYZE QUERY
    # --------------------------------------------------------

    print(
        "\nUnderstanding your request..."
    )


    query_data = analyze_query(

        user_query

    )


    if not query_data:

        return


    print(
        "\nDetected information:"
    )

    print(

        json.dumps(

            query_data,

            indent=2

        )

    )


    # --------------------------------------------------------
    # LOCATION
    # --------------------------------------------------------

    location_name = query_data.get(

        "location"

    )


    if not location_name:

        location_name = input(

            "\nLocation not detected. Enter location: "

        )


    # --------------------------------------------------------
    # LANGUAGE
    # --------------------------------------------------------

    language = query_data.get(

        "language",

        "English"

    )


    # --------------------------------------------------------
    # FORECAST DAYS
    # --------------------------------------------------------

    forecast_days = query_data.get(

        "forecast_days",

        3

    )


    # --------------------------------------------------------
    # GEOCODE LOCATION
    # --------------------------------------------------------

    print(

        f"\nFinding {location_name}..."

    )


    location_data = (

        get_location_coordinates(

            location_name

        )

    )


    if not location_data:

        print(

            "Location could not be found."

        )

        return


    print(

        f"Getting weather data for "

        f"{location_data['name']}, "

        f"{location_data['country']}..."

    )


    # --------------------------------------------------------
    # GET WEATHER
    # --------------------------------------------------------

    weather_data = get_weather(

        latitude=location_data["latitude"],

        longitude=location_data["longitude"],

        forecast_days=forecast_days

    )


    # --------------------------------------------------------
    # GENERATE ALERTS
    # --------------------------------------------------------

    alerts = generate_weather_alerts(

        weather_data

    )


    # --------------------------------------------------------
    # GENERATE LLM RESPONSE
    # --------------------------------------------------------

    print(

        "\nGenerating weather report...\n"

    )


    report = generate_report(

        user_query=user_query,

        location=location_data,

        weather_data=weather_data,

        alerts=alerts,

        language=language

    )


    print(report)


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    main()
