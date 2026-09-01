/* ============================================================
   CONFIG
   ============================================================ */

const API_BASE = ""; // same-origin; change if the backend is hosted separately

/* WMO weather codes -> short English description (used as a fallback
   label; the AI-generated report is the primary language-aware text). */
const WEATHER_CODE_LABELS = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Freezing drizzle", 57: "Dense freezing drizzle",
  61: "Slight rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Slight snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Slight showers", 81: "Showers", 82: "Violent showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm",
};

function weatherLabel(code) {
  return WEATHER_CODE_LABELS[code] || "—";
}

/* ============================================================
   STATE
   ============================================================ */

let selectedVoiceLang = "en-IN";
let pendingQueryData = null; // set while waiting for a manually-entered location

/* ============================================================
   DOM
   ============================================================ */

const askForm = document.getElementById("ask-form");
const queryInput = document.getElementById("query-input");
const micBtn = document.getElementById("mic-btn");
const statusLine = document.getElementById("status-line");
const langPills = document.querySelectorAll(".lang-pill");

const locationPrompt = document.getElementById("location-prompt");
const locationForm = document.getElementById("location-form");
const locationInput = document.getElementById("location-input");

const alertLedger = document.getElementById("alert-ledger");
const resultSection = document.getElementById("result");

const heroUpdated = document.getElementById("hero-updated");
const heroLocation = document.getElementById("hero-location");
const heroTemp = document.getElementById("hero-temp");
const heroCondition = document.getElementById("hero-condition");
const heroFeelslike = document.getElementById("hero-feelslike");

const forecastLedger = document.getElementById("forecast-ledger");
const reportText = document.getElementById("report-text");

/* ============================================================
   CLOCK
   ============================================================ */

function tickClock() {
  const el = document.getElementById("clock");
  el.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
tickClock();
setInterval(tickClock, 30000);

/* ============================================================
   STATUS HELPERS
   ============================================================ */

function setStatus(message, isError = false) {
  statusLine.textContent = message || "";
  statusLine.classList.toggle("is-error", isError);
}

function setBusy(isBusy) {
  askForm.querySelectorAll("button, input").forEach((el) => (el.disabled = isBusy));
}

/* ============================================================
   VOICE INPUT (Web Speech API)
   ============================================================ */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

langPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    langPills.forEach((p) => p.classList.remove("is-active"));
    pill.classList.add("is-active");
    selectedVoiceLang = pill.dataset.lang;
  });
});

if (!SpeechRecognitionImpl) {
  micBtn.disabled = true;
  micBtn.title = "Voice input isn't supported in this browser";
}

micBtn.addEventListener("click", () => {
  if (!SpeechRecognitionImpl) return;

  const recognition = new SpeechRecognitionImpl();
  recognition.lang = selectedVoiceLang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  micBtn.classList.add("is-listening");
  setStatus("Listening…");

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    queryInput.value = transcript;
    setStatus(`Heard: "${transcript}"`);
    handleQuery(transcript);
  };

  recognition.onerror = (event) => {
    setStatus(`Voice input error: ${event.error}`, true);
  };

  recognition.onend = () => {
    micBtn.classList.remove("is-listening");
  };

  recognition.start();
});

/* ============================================================
   TEXT INPUT
   ============================================================ */

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  handleQuery(query);
});

locationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const location = locationInput.value.trim();
  if (!location || !pendingQueryData) return;

  pendingQueryData.location = location;
  locationPrompt.classList.add("hidden");
  runPipeline(pendingQueryData.originalQuery, pendingQueryData);
  pendingQueryData = null;
});

/* ============================================================
   MAIN PIPELINE
   ============================================================ */

async function handleQuery(userQuery) {
  resultSection.classList.add("hidden");
  alertLedger.classList.add("hidden");
  locationPrompt.classList.add("hidden");
  setBusy(true);
  setStatus("Understanding your request…");

  try {
    const queryData = await postJSON("/api/analyze", { query: userQuery });
    queryData.originalQuery = userQuery;

    if (!queryData.location) {
      pendingQueryData = queryData;
      locationPrompt.classList.remove("hidden");
      setStatus("");
      setBusy(false);
      locationInput.focus();
      return;
    }

    await runPipeline(userQuery, queryData);
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
    setBusy(false);
  }
}

async function runPipeline(userQuery, queryData) {
  setBusy(true);

  try {
    const language = ["English", "Hindi", "Telugu"].includes(queryData.language)
      ? queryData.language
      : "English";
    const forecastDays = queryData.forecast_days || 3;

    setStatus(`Finding ${queryData.location}…`);
    const location = await getJSON(
      `/api/geocode?location=${encodeURIComponent(queryData.location)}`
    );

    setStatus("Getting weather data…");
    const { weather, alerts } = await getJSON(
      `/api/weather?latitude=${location.latitude}&longitude=${location.longitude}&forecast_days=${forecastDays}`
    );

    setStatus("Writing your report…");
    const { report } = await postJSON("/api/report", {
      user_query: userQuery,
      location,
      weather_data: weather,
      alerts,
      language,
    });

    renderAlerts(alerts);
    renderHero(location, weather);
    renderForecast(weather);
    renderReport(report);

    resultSection.classList.remove("hidden");
    setStatus("");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  } finally {
    setBusy(false);
  }
}

/* ============================================================
   RENDERING
   ============================================================ */

function renderAlerts(alerts) {
  const real = alerts.filter((a) => a !== "No major weather alerts detected.");
  if (real.length === 0) {
    alertLedger.classList.add("hidden");
    alertLedger.innerHTML = "";
    return;
  }
  alertLedger.innerHTML = real
    .map((a) => `<div class="alert-row">${escapeHTML(a)}</div>`)
    .join("");
  alertLedger.classList.remove("hidden");
}

function renderHero(location, weather) {
  const current = weather.current || {};
  const place = [location.name, location.country].filter(Boolean).join(", ");

  heroUpdated.textContent = "Current conditions";
  heroLocation.textContent = place || "—";
  heroTemp.textContent =
    current.temperature_2m !== undefined ? `${Math.round(current.temperature_2m)}°` : "—°";
  heroCondition.textContent = weatherLabel(current.weather_code);
  heroFeelslike.textContent =
    current.apparent_temperature !== undefined
      ? `Feels like ${Math.round(current.apparent_temperature)}°`
      : "";
}

function renderForecast(weather) {
  const daily = weather.daily || {};
  const days = daily.time || [];

  forecastLedger.innerHTML = days
    .map((dateStr, i) => {
      const label = formatDayLabel(dateStr, i);
      const hi = daily.temperature_2m_max?.[i];
      const lo = daily.temperature_2m_min?.[i];
      const rain = daily.precipitation_probability_max?.[i];
      const condition = weatherLabel(daily.weather_code?.[i]);

      return `
        <div class="forecast-row">
          <div class="forecast-day">${label}</div>
          <div class="forecast-condition">${condition}</div>
          <div class="forecast-stats">
            ${hi !== undefined ? `<span class="hi">${Math.round(hi)}°</span>` : ""}
            ${lo !== undefined ? `<span class="lo">${Math.round(lo)}°</span>` : ""}
            ${rain !== undefined ? `<span class="rain">${rain}% rain</span>` : ""}
          </div>
        </div>`;
    })
    .join("");
}

function renderReport(report) {
  reportText.textContent = report;
}

function formatDayLabel(dateStr, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   FETCH HELPERS
   ============================================================ */

async function getJSON(path) {
  const res = await fetch(API_BASE + path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function postJSON(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
