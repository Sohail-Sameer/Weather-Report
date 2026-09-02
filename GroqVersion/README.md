# WeatherGPT (Groq voice + Ollama analysis)

## Files
```
backend/app.py
backend/requirements.txt
backend/.env.example
frontend/index.html
frontend/script.js
frontend/style.css
```

## Before you do anything: rotate your keys

The `.env.example` you had contained real, live-looking Ollama and Groq
keys instead of placeholders — that's the file meant to be committed to
git. Rotate both:
- Ollama: https://ollama.com
- Groq: https://console.groq.com

Then put the real keys only in `backend/.env` (already gitignored-by-convention;
make sure your `.gitignore` actually excludes it), never in `.env.example`.

## Install & run

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# edit .env with your new keys
python app.py
```

Open http://localhost:5000 (Chrome, Edge, or Safari 14.3+ for mic access).

## Voice bugs fixed in this pass

- **Silent failure on unsupported browsers**: the mic button now checks for
  `getUserMedia`/`MediaRecorder` support before doing anything, instead of
  throwing an unhandled error.
- **Recording format**: the recorder now explicitly asks for a supported
  `mimeType` (`audio/webm;codecs=opus` → `audio/ogg` → `audio/mp4` fallback)
  instead of relying on the browser's unset default, which is what broke
  recording in some Safari/iOS versions.
- **8-second hard cutoff**: raised to 20 seconds, with a live countdown in
  the status line so you can see how long you have left. Tap the mic again
  any time to stop early.
- **Language label mismatch**: Groq's Whisper endpoint sometimes returns a
  full language name (`"english"`) and sometimes a short code (`"en"`)
  depending on model version — the backend now normalizes either form
  instead of returning whatever came back unmodified.
- **No audio captured**: now reported explicitly instead of sending an
  empty file to the transcription endpoint.

## Frontend

Rebuilt as an actual weather-app layout rather than a plain form:
- Background gradient changes with the current condition and time of day
  (clear/cloudy/rain/snow/thunder × day/night), with a fixed dark scrim so
  text stays readable regardless of the palette.
- Hero section: icon, big temperature, condition, today's high/low.
- Detail tiles: humidity, wind, UV index, rain chance.
- Horizontal-scrolling 7-day forecast strip with per-day icons.
- Alerts render as a distinct banner when Open-Meteo thresholds are hit.
- All icons are hand-built inline SVG (no external icon library or
  copyrighted assets).

## Deploying with GitHub Pages

Same split as before: this Flask backend needs to run somewhere that
supports Python (Render, Railway, Fly.io, PythonAnywhere) since GitHub
Pages only serves static files. `frontend/` can be pushed as a subpage of
your `username.github.io` repo; set `ALLOWED_ORIGINS` on the backend host
to that Pages URL, and set `API_BASE` at the top of `script.js` if the
frontend and backend end up on different domains — currently it assumes
same-origin (`""`).
