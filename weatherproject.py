import requests
from ollama import Client
import datetime
import json

client = Client(
    host="https://ollama.com",
    headers={'Authorization': 'Bearer ' + "c54e5e495fed4705abb4fd4084555999.b4a8yxRj7Rpfs8xjWLY8pJfs"}
)

SYSTEM_PROMPT = """
You are WeatherGPT.
You will be given a JSON object as your input.
The JSON input will contain today's weather forecase from open-meteo.com.
Use the data provided to give the most relavent information in a concise way to the user.
Output only the final report as your response.
You also have access to the current time of day in the local timezone. Use that to give a more relavent report.

Formatting rules:
1. No markdown formatting
2. No emojis
3. No em-dashes.
4. No excessive sentences
5. Keep it limited to 3 lines
6. Give the following: current data, overview, most-relevant advice

You will output your response in the specified language only.

Language: {lang}
Current time: {ctime}
"""

def get_todays_forecast():
    resp = requests.get("https://api.open-meteo.com/v1/forecast?latitude=17.6801&longitude=83.2016&daily=temperature_2m_max,temperature_2m_min&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,dew_point_2m,uv_index&timezone=auto")
    return resp.json()

def generate_report(weather_data, lang="English"):
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT.format(
                ctime=datetime.datetime.now().strftime("%H:%M:%S"),
                lang=lang
            )
        },
        {
            "role": "user",
            "content": json.dumps(weather_data, indent=4)
        },
    ]
    return client.chat('gpt-oss:120b', messages=messages).message.content

def main():
    weather_data = get_todays_forecast()
    report = generate_report(weather_data, "English")
    print(report)

main()
