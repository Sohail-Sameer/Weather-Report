/* ============================================================
   CONFIG
   When the frontend is hosted separately from the backend (e.g.
   frontend on GitHub Pages, backend on Render), set this to the
   backend's full URL, e.g. "https://weathergpt-backend.onrender.com".
   Leave as "" when both are served from the same origin.
   ============================================================ */

const API_BASE = "";

/* ============================================================
   WEATHER ICON / CONDITION SYSTEM
   Hand-built SVGs, no external icon library. Maps a WMO weather
   code + is_day flag to a visual category used both for the
   icon shown and the page's background gradient.
   ============================================================ */

function conditionCategory(code, isDay) {
  const day = isDay !== 0; // Open-Meteo sends 1/0
  if (code === 0) return day ? "clear-day" : "clear-night";
  if (code === 1 || code === 2) return day ? "partly-cloudy-day" : "partly-cloudy-night";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunder";
  return day ? "clear-day" : "clear-night";
}

const CONDITION_LABELS = {
  "clear-day": "Clear sky", "clear-night": "Clear sky",
  "partly-cloudy-day": "Partly cloudy", "partly-cloudy-night": "Partly cloudy",
  "cloudy": "Overcast", "fog": "Fog", "drizzle": "Drizzle",
  "rain": "Rain", "snow": "Snow", "thunder": "Thunderstorm",
};

function weatherIconSVG(category) {
  const sun = `<circle cx="12" cy="12" r="5" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M12 1v3M12 20v3M23 12h-3M4 12H1M19.1 4.9l-2.1 2.1M7 15l-2.1 2.1M19.1 19.1 17 17M7 9 4.9 4.9"/>
    </g>`;
  const moon = `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" fill="currentColor"/>`;
  const cloud = `<path d="M7 19a4.5 4.5 0 0 1 .6-8.96A6 6 0 0 1 19 11.7 3.8 3.8 0 0 1 18.3 19H7Z" fill="currentColor"/>`;
  const cloudBack = `<path d="M6.5 15.5a3.6 3.6 0 0 1 .48-7.17A4.8 4.8 0 0 1 15.7 9.2a3 3 0 0 1-.55 6.3H6.5Z" fill="currentColor" opacity="0.55"/>`;
  const rainDrops = `<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M8.5 20.5 7.5 22.5M12.5 20.5 11.5 22.5M16.5 20.5 15.5 22.5"/>
    </g>`;
  const drizzleDots = `<g fill="currentColor"><circle cx="8" cy="21" r="1"/><circle cx="12" cy="21.5" r="1"/><circle cx="16" cy="21" r="1"/></g>`;
  const snowDots = `<g fill="currentColor"><circle cx="8" cy="21" r="1.1"/><circle cx="12.5" cy="22" r="1.1"/><circle cx="16" cy="21" r="1.1"/></g>`;
  const bolt = `<path d="M13 10.5 9.5 16h3l-1 5.5 5-6.5h-3.2Z" fill="currentColor"/>`;
  const fogLines = `<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M4 18h16M6 21h12"/>
    </g>`;

  const byCategory = {
    "clear-day": sun,
    "clear-night": moon,
    "partly-cloudy-day": `<g transform="translate(-2,-3) scale(0.6)">${sun}</g>${cloud}`,
    "partly-cloudy-night": `<g transform="translate(-2,-3) scale(0.55)">${moon}</g>${cloud}`,
    "cloudy": `${cloudBack}${cloud}`,
    "fog": `${cloud}${fogLines}`,
    "drizzle": `${cloud}${drizzleDots}`,
    "rain": `${cloud}${rainDrops}`,
    "snow": `${cloud}${snowDots}`,
    "thunder": `${cloud}${bolt}`,
  };

  return `<svg viewBox="0 0 24 24">${byCategory[category] || sun}</svg>`;
}

function applyConditionTheme(category) {
  document.body.dataset.condition = category;
}

/* ============================================================
   STATE + DOM
   ============================================================ */

let voiceLang = "auto";
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let isRecording = false;
let recordTimer = null;
let countdownInterval = null;
let pendingQueryData = null;

const RECORDING_MAX_MS = 20000;

const queryInput = document.getElementById("query-input");
const statusLine = document.getElementById("status-line");
const micBtn = document.getElementById("mic-btn");
const askForm = document.getElementById("ask-form");

const locationPrompt = document.getElementById("location-prompt");
const locationForm = document.getElementById("location-form");
const locationInput = document.getElementById("location-input");

const alertLedger = document.getElementById("alert-ledger");
const resultSection = document.getElementById("result");

/* ============================================================
   STATUS HELPERS
   ============================================================ */

function setStatus(message, isError = false) {
  statusLine.textContent = message || "";
  statusLine.classList.toggle("is-error", isError);
}

/* ============================================================
   LANGUAGE PILLS
   ============================================================ */

document.querySelectorAll(".lang-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    if (isRecording) return; // don't let the hint change mid-recording
    document.querySelectorAll(".lang-pill").forEach((p) => p.classList.remove("is-active"));
    pill.classList.add("is-active");
    voiceLang = pill.dataset.lang;
  });
});

/* ============================================================
   VOICE INPUT
   Fixes vs. the previous build:
   - feature-detects getUserMedia/MediaRecorder instead of throwing
   - explicitly picks a MediaRecorder mimeType the browser actually
     supports, instead of relying on an unset default (this is what
     broke recording in Safari/iOS)
   - recording window raised from a hard 8s to 20s, with a live
     countdown so people can see how long they have left
   - normalizes whatever language label Groq returns
   ============================================================ */

function pickSupportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function toggleVoice() {
  if (isRecording) {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("Voice input isn't supported in this browser.", true);
    return;
  }

  const mimeType = pickSupportedMimeType();
  if (mimeType === null) {
    setStatus("Voice input isn't supported in this browser.", true);
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    setStatus(
      error.name === "NotAllowedError"
        ? "Microphone permission was denied."
        : `Couldn't access the microphone: ${error.message}`,
      true
    );
    return;
  }

  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };

  mediaRecorder.onstop = handleRecordingStop;

  mediaRecorder.start();
  isRecording = true;
  micBtn.classList.add("is-listening");

  let secondsLeft = RECORDING_MAX_MS / 1000;
  setStatus(`Listening… ${secondsLeft}s`);
  countdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) setStatus(`Listening… ${secondsLeft}s`);
  }, 1000);

  recordTimer = setTimeout(() => {
    if (isRecording) mediaRecorder.stop();
  }, RECORDING_MAX_MS);
}

async function handleRecordingStop() {
  clearTimeout(recordTimer);
  clearInterval(countdownInterval);
  isRecording = false;
  micBtn.classList.remove("is-listening");
  mediaStream.getTracks().forEach((track) => track.stop());

  if (recordedChunks.length === 0) {
    setStatus("No audio was captured. Try again.", true);
    return;
  }

  try {
    setStatus("Transcribing voice…");
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "voice.webm");
    form.append("preferred_language", voiceLang);

    const response = await fetch(API_BASE + "/api/transcribe", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transcription failed");

    queryInput.value = data.transcript;
    setStatus(`Heard: "${data.transcript}"`);
    handleQuery(data.transcript);
  } catch (error) {
    setStatus(error.message, true);
  }
}

micBtn.addEventListener("click", toggleVoice);

/* ============================================================
   TEXT INPUT
   ============================================================ */

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (query) handleQuery(query);
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
  setStatus("Understanding your request…");

  try {
    const queryData = await postJSON("/api/analyze", { query: userQuery });
    queryData.originalQuery = userQuery;

    if (!queryData.location) {
      pendingQueryData = queryData;
      locationPrompt.classList.remove("hidden");
      setStatus("");
      locationInput.focus();
      return;
    }

    await runPipeline(userQuery, queryData);
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  }
}

async function runPipeline(userQuery, queryData) {
  try {
    const language = ["English", "Hindi", "Telugu"].includes(queryData.language)
      ? queryData.language
      : "English";

    const forecastDays = queryData.forecast_days || 3;

    setStatus(`Finding ${queryData.location}…`);
    const location = await getJSON(
      `/api/geocode?location=${encodeURIComponent(queryData.location)}`
    );

    let weather;
    let alerts = [];

    // Historical weather request
    if (queryData.start_date) {
      setStatus("Getting historical weather data…");

      const endDate = queryData.end_date || queryData.start_date;

      const historyResponse = await getJSON(
        `/api/history?latitude=${location.latitude}&longitude=${location.longitude}&start_date=${queryData.start_date}&end_date=${endDate}`
      );

      weather = historyResponse.weather;
    }

    // Current / future weather request
    else {
      setStatus("Getting weather data…");

      const weatherResponse = await getJSON(
        `/api/weather?latitude=${location.latitude}&longitude=${location.longitude}&forecast_days=${forecastDays}`
      );

      weather = weatherResponse.weather;
      alerts = weatherResponse.alerts || [];
    }

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
    renderDetails(weather);
    renderForecast(weather);
    renderReport(report);

    resultSection.classList.remove("hidden");
    setStatus("");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
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
  const warningIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 1 21h22L12 3Z"/><path d="M12 10v5M12 18h.01"/></svg>`;
  alertLedger.innerHTML = real
    .map((a) => `<div class="alert-row">${warningIcon}<span>${escapeHTML(a)}</span></div>`)
    .join("");
  alertLedger.classList.remove("hidden");
}

function renderHero(location, weather) {
  const current = weather.current || {};
  const daily = weather.daily || {};

  const isHistorical =
    !current.temperature_2m &&
    daily.temperature_2m_mean !== undefined;

  if (isHistorical) {
    const mean = daily.temperature_2m_mean?.[0];
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];

    const category = conditionCategory(daily.weather_code?.[0], 1);
    applyConditionTheme(category);

    document.getElementById("hero-icon").innerHTML =
      weatherIconSVG(category);

   document.getElementById("hero-temp").textContent =
  mean != null ? `${Math.round(mean)}°` : "—°";

    document.getElementById("hero-condition").textContent =
      CONDITION_LABELS[category] || "Historical weather";

    document.getElementById("hero-location").textContent =
      [location.name, location.country].filter(Boolean).join(", ") || "—";

    document.getElementById("hero-updated").textContent =
      "Historical weather";

    document.getElementById("hero-feelslike").textContent =
      daily.apparent_temperature_mean?.[0] != null
        ? `Feels like ${Math.round(daily.apparent_temperature_mean[0])}°`
        : "";

    document.getElementById("hero-hilo").textContent =
      hi != null && lo != null
        ? `H:${Math.round(hi)}° L:${Math.round(lo)}°`
        : "";

    return;
  }

  const category = conditionCategory(
    current.weather_code,
    current.is_day
  );

  applyConditionTheme(category);

  document.getElementById("hero-icon").innerHTML =
    weatherIconSVG(category);

  document.getElementById("hero-temp").textContent =
    current.temperature_2m !== undefined
      ? `${Math.round(current.temperature_2m)}°`
      : "—°";

  document.getElementById("hero-condition").textContent =
    CONDITION_LABELS[category] || "—";

  document.getElementById("hero-location").textContent =
    [location.name, location.country].filter(Boolean).join(", ") || "—";

  document.getElementById("hero-updated").textContent =
    "Updated just now";

  document.getElementById("hero-feelslike").textContent =
    current.apparent_temperature !== undefined
      ? `Feels like ${Math.round(current.apparent_temperature)}°`
      : "";

  const hi = daily.temperature_2m_max?.[0];
  const lo = daily.temperature_2m_min?.[0];

  document.getElementById("hero-hilo").textContent =
    hi !== undefined && lo !== undefined
      ? `H:${Math.round(hi)}° L:${Math.round(lo)}°`
      : "";
}
function renderDetails(weather) {
  const current = weather.current || {};
  const daily = weather.daily || {};

  const isHistorical =
    !current.temperature_2m &&
    daily.temperature_2m_mean !== undefined;

  const humidityIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"/></svg>`;

  const windIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 13h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 18h9a2 2 0 1 1-2 2"/></svg>`;

  const uvIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`;

  const rainIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 16a4 4 0 0 1 .6-7.96A5 5 0 0 1 17 9.2a3.2 3.2 0 0 1-.6 6.3"/><path d="M9 19v2M13 19v2"/></svg>`;

  let tiles;

  if (isHistorical) {
    const meanTemp = daily.temperature_2m_mean?.[0];
    const rain = daily.rain_sum?.[0];
    const precipitation = daily.precipitation_sum?.[0];
    const wind = daily.wind_speed_10m_max?.[0];

    tiles = [
      {
        icon: humidityIcon,
        value: meanTemp != null ? `${Math.round(meanTemp)}°` : "—",
        label: "Avg Temp",
      },
      {
        icon: windIcon,
        value: wind != null ? `${Math.round(wind)} km/h` : "—",
        label: "Max Wind",
      },
      {
        icon: rainIcon,
        value: precipitation != null ? `${precipitation} mm` : "—",
        label: "Rain",
      },
      {
        icon: uvIcon,
        value: rain != null ? `${rain} mm` : "—",
        label: "Rain Total",
      },
    ];
  } else {
    tiles = [
      {
        icon: humidityIcon,
        value:
          current.relative_humidity_2m !== undefined
            ? `${current.relative_humidity_2m}%`
            : "—",
        label: "Humidity",
      },
      {
        icon: windIcon,
        value:
          current.wind_speed_10m !== undefined
            ? `${Math.round(current.wind_speed_10m)} km/h`
            : "—",
        label: "Wind",
      },
      {
        icon: uvIcon,
        value:
          daily.uv_index_max?.[0] !== undefined
            ? `${Math.round(daily.uv_index_max[0])}`
            : "—",
        label: "UV Index",
      },
      {
        icon: rainIcon,
        value:
          daily.precipitation_probability_max?.[0] !== undefined
            ? `${daily.precipitation_probability_max[0]}%`
            : "—",
        label: "Rain",
      },
    ];
  }

  document.getElementById("details-grid").innerHTML = tiles
    .map(
      (t) =>
        `<div class="detail-tile">${t.icon}<div class="detail-value">${t.value}</div><div class="detail-label">${t.label}</div></div>`
    )
    .join("");
}

function renderForecast(weather) {
  const daily = weather.daily || {};
  const days = daily.time || [];

  const isHistorical =
    daily.temperature_2m_mean !== undefined &&
    weather.current === undefined;

  document.getElementById("forecast-scroll").innerHTML = days
    .map((dateStr, i) => {
      const hi = daily.temperature_2m_max?.[i];
      const lo = daily.temperature_2m_min?.[i];
      const category = conditionCategory(daily.weather_code?.[i], 1);

      if (isHistorical) {
        const date = new Date(dateStr + "T00:00:00");
        const label = date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        });

        const rain = daily.precipitation_sum?.[i];

        return `
          <div class="forecast-card">
            <div class="forecast-day">${label}</div>
            ${weatherIconSVG(category)}
            <div class="forecast-hi">
              ${hi != null ? Math.round(hi) + "°" : "—"}
            </div>
            <div class="forecast-lo">
              ${lo != null ? Math.round(lo) + "°" : "—"}
            </div>
            ${
              rain != null
                ? `<div class="forecast-rain">${rain} mm</div>`
                : ""
            }
          </div>`;
      }

      const label = formatDayLabel(dateStr, i);
      const rain = daily.precipitation_probability_max?.[i];

      return `
        <div class="forecast-card">
          <div class="forecast-day">${label}</div>
          ${weatherIconSVG(category)}
          <div class="forecast-hi">
            ${hi !== undefined ? Math.round(hi) + "°" : "—"}
          </div>
          <div class="forecast-lo">
            ${lo !== undefined ? Math.round(lo) + "°" : "—"}
          </div>
          ${
            rain !== undefined
              ? `<div class="forecast-rain">${rain}%</div>`
              : ""
          }
        </div>`;
    })
    .join("");
}

function renderReport(report) {
  document.getElementById("report-text").textContent = report;
}

function formatDayLabel(dateStr, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tmrw";
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString(undefined, { weekday: "short" });
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
