import os
import requests
from ollama import Client
import datetime
import json


# ============================================================
# OLLAMA CLIENT
# ============================================================


client = Client(
    host="https://ollama.com",
    headers={'Authorization': 'Bearer ' + "c54e5e495fed4705abb4fd4084555999.b4a8yxRj7Rpfs8xjWLY8pJfs"}
)


# ============================================================
# SYSTEM PROMPT
# ============================================================

SYSTEM_PROMPT = """
You are WeatherGPT, an intelligent weather assistant.

You will receive:
1. The user's request
2. Weather data from Open-Meteo
3. The current local time
4. The requested response language

Your job is to understand the user's request and provide the most relevant
weather information.

Rules:
1. Output only the final weather response.
2. Do not use markdown.
3. Do not use emojis.
4. Do not use em-dashes.
5. Keep the response concise.
6. Use the specified language only.
7. Give practical advice based on the weather.
8. If the user asks about rain, focus on precipitation probability and amount.
9. If the user asks about temperature, focus on current, minimum, and maximum temperature.
10. If the user asks about UV, humidity, or other specific conditions,
    prioritize those values.
11. If the user asks for a general weather report, provide:
    - Current conditions
    - Today's overview
    - Most relevant advice

Language: {lang}
Current local time: {ctime}
"""


# ============================================================
# GET LOCATION COORDINATES
# ============================================================

def get_location_coordinates(location):

    url = "https://geocoding-api.open-meteo.com/v1/search"

    params = {
        "name": location,
        "count": 1,
        "language": "en",
        "format": "json"
    }

    response = requests.get(url, params=params)
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

def get_weather(latitude, longitude):

    url = "https://api.open-meteo.com/v1/forecast"

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
            "wind_speed_10m"
        ]),

        "daily": ",".join([
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "precipitation_probability_max",
            "uv_index_max"
        ]),

        "forecast_days": 3,
        "timezone": "auto"
    }

    response = requests.get(url, params=params)

    return response.json()


# ============================================================
# GENERATE WEATHER REPORT USING LLM
# ============================================================

def generate_report(weather_data, location, user_request, lang="English"):

    current_time = datetime.datetime.now().strftime("%H:%M:%S")

    messages = [

        {
            "role": "system",

            "content": SYSTEM_PROMPT.format(
                lang=lang,
                ctime=current_time
            )
        },

        {
            "role": "user",

            "content": json.dumps(
                {
                    "location": location,
                    "user_request": user_request,
                    "weather_data": weather_data
                },
                indent=2
            )
        }
    ]

    response = client.chat(
        "gpt-oss:120b",
        messages=messages
    )

    return response.message.content


# ============================================================
# GET USER INPUT
# ============================================================

def get_user_input():

    print("\nWeatherGPT")

    location = input(
        "\nEnter location: "
    )

    language = input(
        "Enter language (English/Hindi/Telugu/etc.): "
    )

    user_request = input(
        "What would you like to know about the weather? "
    )

    return location, language, user_request


# ============================================================
# MAIN PROGRAM
# ============================================================

def main():

    location, language, user_request = get_user_input()

    print("\nFinding location...")

    location_data = get_location_coordinates(location)

    if location_data is None:

        print(
            "Location not found. Please enter a valid city or location."
        )

        return


    print(
        f"Getting weather data for "
        f"{location_data['name']}, "
        f"{location_data['country']}..."
    )


    weather_data = get_weather(

        location_data["latitude"],

        location_data["longitude"]
    )


    print("\nGenerating weather report...\n")


    report = generate_report(

        weather_data=weather_data,

        location=location_data,

        user_request=user_request,

        lang=language
    )


    print(report)


# ============================================================
# RUN APPLICATION
# ============================================================

if __name__ == "__main__":
    main()