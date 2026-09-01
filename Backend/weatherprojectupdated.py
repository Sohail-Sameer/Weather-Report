import os
import json
import requests
import speech_recognition as sr

from datetime import datetime
from dotenv import load_dotenv
from ollama import Client


# ============================================================
# CONFIGURATION
# ============================================================

load_dotenv()


MODEL = "gpt-oss:120b"


# ============================================================
# OLLAMA CLIENT
# ============================================================

client = Client(
    host="https://ollama.com",
    headers={
        'Authorization': 'Bearer ' + "c54e5e495fed4705abb4fd4084555999.b4a8yxRj7Rpfs8xjWLY8pJfs"
    }
)


# ============================================================
# QUERY ANALYSIS PROMPT
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
# WEATHER REPORT PROMPT
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
# VOICE LANGUAGE DETECTION
# ============================================================

def detect_text_language(text):
    """
    Detect language using Unicode script.
    """

    if not text:
        return "English"


    for character in text:

        # Telugu Unicode block
        if "\u0C00" <= character <= "\u0C7F":

            return "Telugu"


        # Devanagari Unicode block
        if "\u0900" <= character <= "\u097F":

            return "Hindi"


    return "English"


# ============================================================
# VOICE INPUT
# ============================================================

def get_voice_input():

    recognizer = sr.Recognizer()


    # Microphone sensitivity settings

    recognizer.dynamic_energy_threshold = True

    recognizer.pause_threshold = 0.8

    recognizer.phrase_threshold = 0.3


    language_codes = {

        "English": "en-IN",

        "Hindi": "hi-IN",

        "Telugu": "te-IN"

    }


    try:

        with sr.Microphone() as source:

            print(
                "\nAdjusting microphone for background noise..."
            )


            recognizer.adjust_for_ambient_noise(
                source,
                duration=1
            )


            print(
                "\nListening..."
            )


            print(
                "Speak in English, Hindi, or Telugu."
            )


            audio = recognizer.listen(

                source,

                timeout=10,

                phrase_time_limit=20

            )


    except sr.WaitTimeoutError:

        print(
            "\nNo voice was detected."
        )

        return None


    except OSError as error:

        print(
            f"\nMicrophone error: {error}"
        )

        return None


    except Exception as error:

        print(
            f"\nVoice input error: {error}"
        )

        return None


    print(
        "\nProcessing voice..."
    )


    recognized_results = []


    # --------------------------------------------------------
    # TRY ENGLISH, HINDI AND TELUGU RECOGNITION
    # --------------------------------------------------------

    for language_name, language_code in language_codes.items():

        try:

            text = recognizer.recognize_google(

                audio,

                language=language_code

            )


            if text:

                recognized_results.append(

                    {

                        "text": text,

                        "recognition_language": language_name

                    }

                )


        except sr.UnknownValueError:

            pass


        except sr.RequestError as error:

            print(
                f"\nSpeech recognition service error: {error}"
            )

            return None


        except Exception:

            pass


    # --------------------------------------------------------
    # NO RESULTS
    # --------------------------------------------------------

    if not recognized_results:

        print(
            "\nCould not understand the voice input."
        )

        return None


    # --------------------------------------------------------
    # SELECT RESULT WITH MATCHING SCRIPT
    # --------------------------------------------------------

    for result in recognized_results:

        detected_language = detect_text_language(

            result["text"]

        )


        recognition_language = result[

            "recognition_language"

        ]


        if detected_language == recognition_language:

            print(

                f"\nDetected voice language: "

                f"{detected_language}"

            )


            print(

                f"You said: "

                f"{result['text']}"

            )


            return result["text"]


    # --------------------------------------------------------
    # FALLBACK
    # --------------------------------------------------------

    best_result = recognized_results[0]


    print(

        "\nDetected voice language: "

        f"{detect_text_language(best_result['text'])}"

    )


    print(

        f"You said: "

        f"{best_result['text']}"

    )


    return best_result["text"]


# ============================================================
# USER INPUT
# ============================================================

def get_user_input():

    print("\n" + "=" * 55)

    print("WeatherGPT")

    print("=" * 55)


    print("\n1. Type your weather question")

    print("2. Speak your weather question")


    choice = input(

        "\nChoose input method (1 or 2): "

    ).strip()


    if choice == "2":

        user_query = get_voice_input()


        if user_query:

            return user_query


        return None


    print(

        "\nYou can type in English, Hindi, or Telugu."

    )


    user_query = input(

        "\nAsk about the weather: "

    ).strip()


    if not user_query:

        return None


    return user_query


# ============================================================
# LLM QUERY ANALYSIS
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


    try:

        response = client.chat(

            model=MODEL,

            messages=messages,

            options={

                "temperature": 0

            }

        )


        content = response.message.content.strip()


        # Remove accidental Markdown JSON formatting

        content = content.replace(

            "```json",

            ""

        )


        content = content.replace(

            "```",

            ""

        )


        content = content.strip()


        query_data = json.loads(

            content

        )


        return query_data


    except json.JSONDecodeError:

        print(

            "\nCould not parse the LLM response."

        )


        print(

            "\nRaw LLM response:"

        )


        print(

            content

        )


        return None


    except Exception as error:

        print(

            f"\nLLM error: {error}"

        )


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


    try:

        response = requests.get(

            url,

            params=params,

            timeout=10

        )


        response.raise_for_status()


        data = response.json()


        if not data.get(

            "results"

        ):

            return None


        place = data["results"][0]


        return {

            "name": place.get(

                "name"

            ),

            "country": place.get(

                "country"

            ),

            "latitude": place.get(

                "latitude"

            ),

            "longitude": place.get(

                "longitude"

            ),

            "timezone": place.get(

                "timezone"

            )

        }


    except requests.RequestException as error:

        print(

            f"\nLocation API error: {error}"

        )

        return None


# ============================================================
# GET WEATHER DATA
# ============================================================

def get_weather(

    latitude,

    longitude,

    forecast_days=3

):


    try:

        forecast_days = int(

            forecast_days

        )


    except (ValueError, TypeError):

        forecast_days = 3


    forecast_days = max(

        1,

        min(

            forecast_days,

            7

        )

    )


    url = (

        "https://api.open-meteo.com/v1/forecast"

    )


    params = {


        "latitude": latitude,

        "longitude": longitude,


        # ----------------------------------------------------
        # CURRENT WEATHER
        # ----------------------------------------------------

        "current": ",".join([

            "temperature_2m",

            "relative_humidity_2m",

            "apparent_temperature",

            "precipitation",

            "rain",

            "weather_code",

            "wind_speed_10m"

        ]),


        # ----------------------------------------------------
        # HOURLY WEATHER
        # ----------------------------------------------------

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


        # ----------------------------------------------------
        # DAILY WEATHER
        # ----------------------------------------------------

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


    try:

        response = requests.get(

            url,

            params=params,

            timeout=10

        )


        response.raise_for_status()


        return response.json()


    except requests.RequestException as error:

        print(

            f"\nWeather API error: {error}"

        )

        return None


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

                "Extreme heat alert: "
                "Temperature is 40°C or above."

            )


        elif temperature >= 35:

            alerts.append(

                "High temperature alert: "
                "Avoid prolonged direct sunlight."

            )


    # --------------------------------------------------------
    # CURRENT WIND
    # --------------------------------------------------------

    wind_speed = current.get(

        "wind_speed_10m"

    )


    if wind_speed is not None:


        if wind_speed >= 50:

            alerts.append(

                "Strong wind alert: "
                "Outdoor activities may be affected."

            )


    # --------------------------------------------------------
    # RAIN PROBABILITY
    # --------------------------------------------------------

    probabilities = daily.get(

        "precipitation_probability_max",

        []

    )


    for index, probability in enumerate(

        probabilities

    ):


        if probability is not None and probability >= 80:


            alerts.append(

                f"High rain probability on forecast day "

                f"{index + 1}: "

                f"{probability}%."

            )


    # --------------------------------------------------------
    # HEAVY RAINFALL
    # --------------------------------------------------------

    precipitation = daily.get(

        "precipitation_sum",

        []

    )


    for index, amount in enumerate(

        precipitation

    ):


        if amount is not None and amount >= 30:


            alerts.append(

                f"Heavy rainfall expected on forecast day "

                f"{index + 1}: "

                f"{amount} mm."

            )


    # --------------------------------------------------------
    # HIGH UV
    # --------------------------------------------------------

    uv_values = daily.get(

        "uv_index_max",

        []

    )


    for index, uv in enumerate(

        uv_values

    ):


        if uv is not None and uv >= 8:


            alerts.append(

                f"Very high UV expected on forecast day "

                f"{index + 1}: "

                f"UV index {uv}."

            )


    # --------------------------------------------------------
    # NO ALERTS
    # --------------------------------------------------------

    if not alerts:

        alerts.append(

            "No major weather alerts detected."

        )


    return alerts


# ============================================================
# GENERATE FINAL WEATHER REPORT
# ============================================================

def generate_report(

    user_query,

    location,

    weather_data,

    alerts,

    language

):


    current_time = datetime.now().strftime(

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

                indent=2,

                ensure_ascii=False

            )

        }

    ]


    try:

        response = client.chat(

            model=MODEL,

            messages=messages

        )


        return response.message.content


    except Exception as error:

        return (

            f"Weather report generation failed: {error}"

        )


# ============================================================
# MAIN APPLICATION
# ============================================================

def main():


    # --------------------------------------------------------
    # GET USER INPUT
    # --------------------------------------------------------

    user_query = get_user_input()


    if not user_query:

        print(

            "\nNo valid input received."

        )

        return


    # --------------------------------------------------------
    # ANALYZE USER REQUEST
    # --------------------------------------------------------

    print(

        "\nUnderstanding your request..."

    )


    query_data = analyze_query(

        user_query

    )


    if not query_data:

        return


    # --------------------------------------------------------
    # DISPLAY DETECTED INFORMATION
    # --------------------------------------------------------

    print(

        "\nDetected information:"

    )


    print(

        json.dumps(

            query_data,

            indent=2,

            ensure_ascii=False

        )

    )


    # --------------------------------------------------------
    # GET LOCATION
    # --------------------------------------------------------

    location_name = query_data.get(

        "location"

    )


    if not location_name:


        location_name = input(

            "\nLocation not detected. "
            "Enter location: "

        ).strip()


    if not location_name:

        print(

            "\nNo location provided."

        )

        return


    # --------------------------------------------------------
    # GET LANGUAGE
    # --------------------------------------------------------

    language = query_data.get(

        "language"

    )


    if language not in [

        "English",

        "Hindi",

        "Telugu"

    ]:

        language = detect_text_language(

            user_query

        )


    # --------------------------------------------------------
    # GET FORECAST DAYS
    # --------------------------------------------------------

    forecast_days = query_data.get(

        "forecast_days",

        3

    )


    # --------------------------------------------------------
    # FIND LOCATION
    # --------------------------------------------------------

    print(

        f"\nFinding location: "

        f"{location_name}..."

    )


    location_data = (

        get_location_coordinates(

            location_name

        )

    )


    if not location_data:

        print(

            "\nLocation could not be found."

        )

        return


    print(

        f"\nLocation found: "

        f"{location_data['name']}, "

        f"{location_data['country']}"

    )


    # --------------------------------------------------------
    # GET WEATHER
    # --------------------------------------------------------

    print(

        "\nGetting weather data..."

    )


    weather_data = get_weather(

        latitude=location_data[

            "latitude"

        ],

        longitude=location_data[

            "longitude"

        ],

        forecast_days=forecast_days

    )


    if not weather_data:

        print(

            "\nWeather data could not be retrieved."

        )

        return


    # --------------------------------------------------------
    # GENERATE WEATHER ALERTS
    # --------------------------------------------------------

    print(

        "\nChecking weather alerts..."

    )


    alerts = generate_weather_alerts(

        weather_data

    )


    # --------------------------------------------------------
    # GENERATE FINAL REPORT
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


    # --------------------------------------------------------
    # PRINT FINAL REPORT
    # --------------------------------------------------------

    print("=" * 55)

    print("WEATHER REPORT")

    print("=" * 55)

    print()

    print(report)

    print()

    print("=" * 55)


# ============================================================
# RUN APPLICATION
# ============================================================

if __name__ == "__main__":

    main()
