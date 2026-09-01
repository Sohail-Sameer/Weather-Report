# WeatherGPT — Website

A web version of your WeatherGPT CLI script, same pipeline (analyze query →
geocode → Open-Meteo forecast → alerts → AI-generated report), now as a
Flask backend + static frontend so it can later be wrapped for iOS/Android
(e.g. with Capacitor, or by having a native app call the same `/api/*`
endpoints).

## Important: about your API key

Your pasted script had your Ollama API key hardcoded in plain text. Treat
that key as compromised — rotate it at https://ollama.com. This project
never puts the key in code or in the browser; it's read from an environment
variable on the server only.

## Project layout

```
weathergpt-web/
  backend/
    app.py              Flask server + ported logic from your script
    requirements.txt
    .env.example         copy to .env and add your key
  frontend/
    index.html
    style.css
    script.js            voice input uses the browser's Web Speech API
```

## Run it locally

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and set OLLAMA_API_KEY=your_new_key

python app.py
```

Open http://localhost:5000 in Chrome or Edge (best Web Speech API support).

## What changed vs. the CLI version

- **Voice input** now uses the browser's built-in `SpeechRecognition` API
  instead of `speech_recognition` + a microphone library. Pick the voice
  language (EN/HI/TE) with the pills next to the input box before tapping
  the mic — the browser needs to know which language to listen for.
- **Location fallback**: if no location is detected in the request, the
  page shows an inline prompt instead of a terminal `input()` call.
- **Alerts, forecast, and the AI report** use the exact same prompts,
  thresholds, and Open-Meteo fields as your original script.

## Deploying

Any host that runs a Python/Flask app works (Render, Railway, Fly.io, a VPS,
etc.). Set `OLLAMA_API_KEY` as an environment variable in that host's
dashboard — don't commit `.env`. The frontend is plain static files, so if
you later want to split hosting, point `API_BASE` in `frontend/script.js` at
your backend's URL.

## Path to iOS/Android

Since all the logic already lives behind `/api/analyze`, `/api/geocode`,
`/api/weather`, and `/api/report`, a native app (Swift/Kotlin, or a
cross-platform shell like Capacitor/React Native) can reuse this same
backend — it just needs its own UI and its own voice-input integration
(the Web Speech API doesn't exist natively; iOS/Android would use their own
speech frameworks) calling the same endpoints.
