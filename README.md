# WeatherGPT • Atmospheric Intelligence

Modernized, voice-enabled weather application powered by **Groq Whisper Large v3 Turbo**, **Ollama (`gpt-oss:120b`)**, **Open-Meteo**, and **WeatherAPI.com** fallback, styled with Google Stitch's **Atmospheric Intelligence** design system.

The application functions as a mobile-first Progressive Web App (PWA) with full native ergonomics for both **Android** and **iOS**.

---

## Key Features

1. **Multilingual Voice Commands (Groq Whisper)**:
   - Voice weather queries in **English**, **Hindi (हिंदी)**, **Telugu (తెలుగు)**, or **Auto-detect**.
   - Full-screen pulsing aura recording visualizer, 20-second countdown, and cross-browser audio codec negotiation (Safari iOS `audio/mp4` / `m4a` + Android `audio/webm;codecs=opus`).
2. **Atmospheric AI Synthesis (Ollama Llama/GPT-OSS)**:
   - Deep meteorological reasoning with localized conversational outputs.
   - Structured action cards:
     - **Optimal Activity Departure Window**: Ideal hours, crosswinds, thermal shifts.
     - **Route Micro-Climate Progression**: Origin, midway, and destination temperatures & wind conditions.
     - **Smart Apparel Guidance**: Layering advice, thermal rating, and accessories.
3. **High-Res Weather Telemetry (Open-Meteo + WeatherAPI fallback)**:
   - Ambient sky canvas hero card with huge display temperature and condition pill.
   - 24-Hour Horizon Hourly Scroller with rain probability and UV peaks.
   - Precision Telemetry 2×2 Matrix: Wind & Gusts, Air Quality (AQI, PM2.5, PM10), Humidity & Dew Point, Barometric Pressure & trend.
   - 7-Day Synoptic Outlook with temperature range gradient bars.
   - In-memory 15-minute rate-limit caching and automatic WeatherAPI.com fallback.
4. **Hyper-Local Radar Map**:
   - Dark high-altitude vector map viewport with precipitation plume bloom.
   - Interactive neighborhood pulse pins with clickable live microclimate cells.
   - Layer toggles: Precipitation Radar, Micro-Temp, Wind Vectors, AQI Plume, Satellite Clouds.
   - Playback scrubber timeline (-60m to +60m nowcast).
5. **Precision Telemetry Insights**:
   - Priority Extreme Early Warning Alert Ledger with precautionary safety protocols.
   - Microclimate Delta Grid comparing variance against city baseline.
   - Barometric pressure gradients and solar radiation / UV trajectory.
6. **Mobile App (Android & iOS)**:
   - Standalone PWA installable on Android and iOS home screens.
   - Safe-area insets (`pt-safe`, `pb-safe`), disabled rubber-band bounce, touch momentum scrolling.
   - Capacitor configuration (`capacitor.config.json`) ready for native `.apk` and Xcode `.ipa` building.

---

## Quick Start

### 1. Install Dependencies
```bash
pip install -r Weather-Report/GroqVersion/backend/requirements.txt
```

### 2. Configure Environment Keys
The app automatically loads keys from `Weather-Report.env` or `backend/.env`:
```ini
GROQ_API_KEY=gsk_...
GROQ_WHISPER_MODEL=whisper-large-v3-turbo
OLLAMA_API_KEY=...
OLLAMA_HOST=https://ollama.com
OLLAMA_MODEL=gpt-oss:120b
WEATHERAPI_KEY=...
```

### 3. Run the App
Launch from the root directory:
```bash
python run_app.py
```
Or from the backend directory:
```bash
cd Weather-Report/GroqVersion/backend
python app.py
```

Open `http://localhost:5000` in your web browser.

---

## Running Like an App on Android & iOS

### Method A: Instant Mobile PWA (Zero Build Required)
1. Ensure your phone and PC are connected to the same Wi-Fi network.
2. When you run `python run_app.py`, note the **Mobile Device URL** printed in the terminal (e.g., `http://192.168.1.15:5000`).
3. Open that URL on your phone:
   - **Android (Chrome / Edge)**: Tap the three dots menu (⋮) -> **"Install app"** or **"Add to Home screen"**.
   - **iOS (Safari)**: Tap the **Share** button -> **"Add to Home Screen"**.
4. The app will launch in full-screen standalone mode with no browser address bar, custom dark theme, and offline asset caching!

### Method B: Native Android & iOS Build (Capacitor)
The project includes `capacitor.config.json` pre-configured for native builds:
```bash
# Install Capacitor CLI (requires Node.js / npm)
npm install -g @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios

# Initialize Native Android Project
npx cap add android
npx cap open android
# (Builds APK / AAB in Android Studio)

# Initialize Native iOS Project (macOS only)
npx cap add ios
npx cap open ios
# (Builds IPA in Xcode)
```

---

## Directory Structure

```
stitch_weathergpt_modern_redesign/
├── run_app.py                                  # Root one-click launcher
├── capacitor.config.json                       # Mobile native build configuration
├── atmospheric_intelligence/
│   └── DESIGN.md                              # Stitch design tokens & specs
├── Weather-Report/
│   └── GroqVersion/
│       ├── Weather-Report.env                  # API configuration
│       ├── backend/
│       │   ├── app.py                         # Flask API (Whisper, Ollama, Open-Meteo, WeatherAPI)
│       │   ├── requirements.txt               # Python dependencies
│       │   └── .env                           # Environment variables
│       └── frontend/
│           ├── index.html                     # Unified 4-view modern app
│           ├── style.css                      # Atmospheric intelligence stylesheet
│           ├── script.js                      # Client state controller & voice engine
│           ├── manifest.json                  # PWA manifest
│           ├── sw.js                          # Service worker
│           └── icons/
│               └── logo.svg                   # Vector app logo
```
