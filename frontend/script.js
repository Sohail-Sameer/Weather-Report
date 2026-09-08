/* ============================================================
   WeatherGPT • Atmospheric Intelligence Client Controller
   Seamless mobile application logic for Android, iOS & Web
   ============================================================ */

// 1. Service Worker for Offline PWA Capabilities
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("ServiceWorker registration:", err);
    });
  });
}

const API_BASE = "";

// ============================================================
// APP STATE
// ============================================================

const state = {
  currentLocation: {
    name: "San Francisco",
    admin1: "California",
    country: "United States",
    latitude: 37.7749,
    longitude: -122.4194,
  },
  weather: null,
  alerts: [],
  airQuality: null,
  synopsis: "",
  voiceLang: "auto",
  activeView: "view-forecast",
  activeMapLayer: "precip",
  isRecording: false,
  mediaRecorder: null,
  mediaStream: null,
  recordedChunks: [],
  recordTimer: null,
  countdownInterval: null,
};

// Condition category mapping for WMO codes
function getConditionCategory(code, isDay = 1) {
  const day = isDay !== 0;
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

const CONDITION_TITLES = {
  "clear-day": "Clear Sky",
  "clear-night": "Clear Sky",
  "partly-cloudy-day": "Partly Cloudy",
  "partly-cloudy-night": "Partly Cloudy",
  "cloudy": "Overcast",
  "fog": "Dense Fog",
  "drizzle": "Light Drizzle",
  "rain": "Rain Showers",
  "snow": "Snowfall",
  "thunder": "Thunderstorm",
};

const CONDITION_ICONS = {
  "clear-day": "wb_sunny",
  "clear-night": "nights_stay",
  "partly-cloudy-day": "partly_cloudy_day",
  "partly-cloudy-night": "partly_cloudy_night",
  "cloudy": "cloud",
  "fog": "mist",
  "drizzle": "water_drop",
  "rain": "rainy",
  "snow": "ac_unit",
  "thunder": "thunderstorm",
};

// ============================================================
// DOM ELEMENTS
// ============================================================

const els = {
  headerLocationName: document.getElementById("header-location-name"),
  locationTriggerBtn: document.getElementById("location-trigger-btn"),
  searchModal: document.getElementById("search-modal"),
  closeSearchBtn: document.getElementById("close-search-btn"),
  citySearchForm: document.getElementById("city-search-form"),
  citySearchInput: document.getElementById("city-search-input"),
  useGpsBtn: document.getElementById("use-gps-btn"),
  appStatusBar: document.getElementById("app-status-bar"),
  statusMessage: document.getElementById("status-message"),
  statusModelBadge: document.getElementById("status-model-badge"),

  // Voice Overlay
  voiceOverlay: document.getElementById("voice-overlay"),
  voiceStopBtn: document.getElementById("voice-stop-btn"),
  voiceCancelBtn: document.getElementById("voice-cancel-btn"),
  voiceCountdownLabel: document.getElementById("voice-countdown-label"),
  voiceLanguageHint: document.getElementById("voice-language-hint"),

  // Forecast Screen
  heroPlaceLabel: document.getElementById("hero-place-label"),
  heroTemperature: document.getElementById("hero-temperature"),
  heroConditionIcon: document.getElementById("hero-condition-icon"),
  heroConditionText: document.getElementById("hero-condition-text"),
  heroTempHigh: document.getElementById("hero-temp-high"),
  heroTempLow: document.getElementById("hero-temp-low"),
  heroTempFeels: document.getElementById("hero-temp-feels"),
  heroSynopsisText: document.getElementById("hero-synopsis-text"),
  heroSynopsisMeta: document.getElementById("hero-synopsis-meta"),
  askAiQuickBtn: document.getElementById("ask-ai-quick-btn"),
  microclimateChipsScroll: document.getElementById("microclimate-chips-scroll"),
  hourlyForecastScroll: document.getElementById("hourly-forecast-scroll"),
  dailyForecastContainer: document.getElementById("daily-forecast-container"),
  telemetryWindSpeed: document.getElementById("telemetry-wind-speed"),
  telemetryWindDir: document.getElementById("telemetry-wind-dir"),
  telemetryWindGusts: document.getElementById("telemetry-wind-gusts"),
  telemetryAqiNum: document.getElementById("telemetry-aqi-num"),
  telemetryAqiLabel: document.getElementById("telemetry-aqi-label"),
  telemetryAqiBar: document.getElementById("telemetry-aqi-bar"),
  telemetryAqiSub: document.getElementById("telemetry-aqi-sub"),
  telemetryHumidity: document.getElementById("telemetry-humidity"),
  telemetryDewpoint: document.getElementById("telemetry-dewpoint"),
  telemetryPressure: document.getElementById("telemetry-pressure"),
  telemetryPressureTrend: document.getElementById("telemetry-pressure-trend"),
  forecastQuickQueryForm: document.getElementById("forecast-quick-query-form"),
  forecastQuickInput: document.getElementById("forecast-quick-input"),

  // Unified Query Input (All Tabs)
  unifiedQueryForm: document.getElementById("unified-query-form"),
  unifiedQueryInput: document.getElementById("unified-query-input"),
  unifiedMicBtn: document.querySelector(".unified-mic-btn"),

  // Map Screen
  mapAddressSearchInput: document.getElementById("map-address-search-input"),
  mapGpsBtn: document.getElementById("map-gps-btn"),
  mapSensorCard: document.getElementById("map-sensor-card"),
  closeSensorCardBtn: document.getElementById("close-sensor-card-btn"),
  sensorCardTitle: document.getElementById("sensor-card-title"),
  sensorMetricTemp: document.getElementById("sensor-metric-temp"),
  sensorMetricPrecip: document.getElementById("sensor-metric-precip"),
  sensorMetricWind: document.getElementById("sensor-metric-wind"),
  sensorMetricAqi: document.getElementById("sensor-metric-aqi"),
  radarPlayBtn: document.getElementById("radar-play-btn"),
  radarTimeSlider: document.getElementById("radar-time-slider"),
  mapRadarPlume: document.getElementById("map-radar-plume"),

  // WeatherGPT Assistant Screen
  chatStream: document.getElementById("chat-stream"),
  assistantChatForm: document.getElementById("assistant-chat-form"),
  assistantInputText: document.getElementById("assistant-input-text"),
  assistantMicBtn: document.getElementById("assistant-mic-btn"),
  assistantPromptChips: document.getElementById("assistant-prompt-chips"),

  // Insights Screen
  insightsAlertsContainer: document.getElementById("insights-alerts-container"),
  insightsBaselineLabel: document.getElementById("insights-baseline-label"),
  insightsDeltaBars: document.getElementById("insights-delta-bars"),
  insightsPressureVal: document.getElementById("insights-pressure-val"),
  insightsUvVal: document.getElementById("insights-uv-val"),
};

// ============================================================
// NAVIGATION & VIEW SWITCHER
// ============================================================

function switchView(targetViewId) {
  state.activeView = targetViewId;

  document.querySelectorAll(".app-view").forEach((view) => {
    view.classList.add("hidden");
  });

  const activeViewEl = document.getElementById(targetViewId);
  if (activeViewEl) {
    activeViewEl.classList.remove("hidden");
  }

  if (targetViewId === "view-map" && window.RadarMap) {
    window.RadarMap.onViewShown();
  }

  // Update bottom navigation tabs
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const isTarget = tab.dataset.view === targetViewId;
    tab.classList.toggle("is-active", isTarget);
    if (isTarget) {
      tab.classList.add("text-primary", "bg-amber-glow-surface");
      tab.classList.remove("text-ink-tertiary");
    } else {
      tab.classList.remove("text-primary", "bg-amber-glow-surface");
      tab.classList.add("text-ink-tertiary");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    switchView(tab.dataset.view);
  });
});

document.getElementById("header-logo-btn")?.addEventListener("click", () => {
  switchView("view-forecast");
});

document.getElementById("view-map-matrix-btn")?.addEventListener("click", () => {
  switchView("view-map");
});

els.askAiQuickBtn?.addEventListener("click", () => {
  switchView("view-weathergpt");
  els.assistantInputText?.focus();
});

// ============================================================
// LANGUAGE SELECTION
// ============================================================

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.voiceLang = btn.dataset.lang;

    updatePromptChipsForLanguage(state.voiceLang);

    // Refresh weather synopsis in new language if data already loaded
    if (state.weather) {
      generateAiReport();
    }
  });
});

function updatePromptChipsForLanguage(lang) {
  if (!els.assistantPromptChips) return;

  const chips = {
    hi: [
      { icon: "translate", text: "क्या आज शाम बारिश होगी?" },
      { icon: "directions_bike", text: "क्या दोपहर में बाहर साइकिल चलाना ठीक रहेगा?" },
      { icon: "thermostat", text: "कल का तापमान कैसा रहेगा?" },
      { icon: "checkroom", text: "आज मुझे क्या कपड़े पहनने चाहिए?" },
    ],
    te: [
      { icon: "translate", text: "ఈ రోజు వర్షం పడుతుందా?" },
      { icon: "directions_run", text: "సాయంత్రం బయటకు వెళ్లడం సురక్షితమేనా?" },
      { icon: "thermostat", text: "రేపటి వాతావరణం ఎలా ఉంటుంది?" },
      { icon: "checkroom", text: "ఈ రోజు ఎలాంటి దుస్తులు ధరించాలి?" },
    ],
    en: [
      { icon: "directions_bike", text: "Can I bike outside this afternoon?" },
      { icon: "umbrella", text: "Will it rain during evening commute?" },
      { icon: "directions_run", text: "Best outdoor run time tomorrow?" },
      { icon: "checkroom", text: "What should I wear today?" },
    ],
  };

  const selected = chips[lang] || chips.en;
  els.assistantPromptChips.innerHTML = selected
    .map(
      (c) => `
    <button class="assistant-chip shrink-0 px-3 py-1.5 rounded-full bg-surface-container border border-glass-border-subtle hover:bg-surface-bright text-ink-secondary hover:text-ink-primary text-xs transition-all flex items-center gap-1.5 active:scale-95">
      <span class="material-symbols-outlined text-primary text-[15px]">${c.icon}</span>
      <span>${escapeHTML(c.text)}</span>
    </button>`
    )
    .join("");

  bindAssistantChips();
}

function bindAssistantChips() {
  document.querySelectorAll(".assistant-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const text = chip.querySelector("span:last-child")?.textContent?.trim();
      if (text && els.assistantInputText) {
        els.assistantInputText.value = text;
        submitAssistantQuery(text);
      }
    });
  });
}

// ============================================================
// STATUS HELPERS
// ============================================================

function showStatus(msg, badge = "Groq + Ollama") {
  if (els.appStatusBar && els.statusMessage) {
    els.statusMessage.textContent = msg;
    if (els.statusModelBadge) els.statusModelBadge.textContent = badge;
    els.appStatusBar.classList.remove("hidden");
  }
}

function hideStatus() {
  if (els.appStatusBar) {
    els.appStatusBar.classList.add("hidden");
  }
}

// ============================================================
// SEARCH & LOCATION MODAL
// ============================================================

els.locationTriggerBtn?.addEventListener("click", () => {
  els.searchModal?.classList.remove("hidden");
  els.citySearchInput?.focus();
});

els.closeSearchBtn?.addEventListener("click", () => {
  els.searchModal?.classList.add("hidden");
});

els.citySearchForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = els.citySearchInput.value.trim();
  if (!query) return;

  try {
    showStatus(`Geocoding '${query}' with Open-Meteo...`);
    const loc = await getJSON(`/api/geocode?location=${encodeURIComponent(query)}`);
    state.currentLocation = loc;
    els.searchModal?.classList.add("hidden");
    els.citySearchInput.value = "";
    await refreshWeatherData();
  } catch (err) {
    alert(`Could not find '${query}': ${err.message}`);
  } finally {
    hideStatus();
  }
});

document.querySelectorAll(".popular-city-chip").forEach((chip) => {
  chip.addEventListener("click", async () => {
    const city = chip.dataset.city;
    if (!city) return;
    try {
      showStatus(`Loading ${city}...`);
      const loc = await getJSON(`/api/geocode?location=${encodeURIComponent(city)}`);
      state.currentLocation = loc;
      els.searchModal?.classList.add("hidden");
      await refreshWeatherData();
    } catch (err) {
      alert(err.message);
    } finally {
      hideStatus();
    }
  });
});

els.useGpsBtn?.addEventListener("click", () => {
  requestDeviceGps();
  els.searchModal?.classList.add("hidden");
});

els.mapGpsBtn?.addEventListener("click", () => {
  requestDeviceGps();
});

// The map screen's own address bar previously just displayed the current
// location with no way to actually search — wire it to the same
// geocode-then-refresh flow the main search uses.
els.mapAddressSearchInput?.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const query = els.mapAddressSearchInput.value.trim();
  if (!query) return;

  try {
    showStatus(`Geocoding '${query}'...`);
    const loc = await getJSON(`/api/geocode?location=${encodeURIComponent(query)}`);
    state.currentLocation = loc;
    await refreshWeatherData();
  } catch (err) {
    alert(`Could not find '${query}': ${err.message}`);
  } finally {
    hideStatus();
  }
});

function requestDeviceGps() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser/device.");
    return;
  }

  showStatus("Acquiring GPS coordinates...");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      try {
        const rev = await getJSON(`/api/reverse-geocode?latitude=${lat}&longitude=${lon}`);
        state.currentLocation = {
          name: rev.name || "My Location",
          admin1: rev.admin1 || "",
          country: rev.country || "",
          latitude: lat,
          longitude: lon,
        };
        await refreshWeatherData();
      } catch (err) {
        state.currentLocation = {
          name: "My Location",
          latitude: lat,
          longitude: lon,
        };
        await refreshWeatherData();
      } finally {
        hideStatus();
      }
    },
    (err) => {
      hideStatus();
      alert(`GPS access error: ${err.message}. Using default location.`);
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

// ============================================================
// WEATHER DATA REFRESH & PIPELINE
// ============================================================

async function refreshWeatherData() {
  const { latitude, longitude, name } = state.currentLocation;
  if (!latitude || !longitude) return;

  if (els.headerLocationName) els.headerLocationName.textContent = name;
  if (els.heroPlaceLabel) els.heroPlaceLabel.textContent = `${name}, ${state.currentLocation.country || ""}`;

  showStatus(`Connecting to Open-Meteo & WeatherAPI for ${name}...`);

  try {
    const data = await getJSON(`/api/weather?latitude=${latitude}&longitude=${longitude}&forecast_days=7`);
    state.weather = data.weather;
    state.alerts = data.alerts || [];
    state.airQuality = data.air_quality || data.weather?.air_quality || {};

    renderForecastScreen();
    renderMapScreen();
    renderInsightsScreen();

    // Trigger AI report synthesis asynchronously
    generateAiReport();
  } catch (err) {
    console.error("Weather fetch failed:", err);
    showStatus(`Weather sync error: ${err.message}`, "Offline");
  } finally {
    hideStatus();
  }
}

function renderForecastScreen() {
  const current = state.weather?.current || {};
  const daily = state.weather?.daily || {};
  const hourly = state.weather?.hourly || {};

  const temp = Math.round(current.temperature_2m ?? 20);
  const feels = Math.round(current.apparent_temperature ?? temp);
  const high = Math.round(daily.temperature_2m_max?.[0] ?? temp + 3);
  const low = Math.round(daily.temperature_2m_min?.[0] ?? temp - 4);
  const wCode = current.weather_code ?? 0;
  const isDay = current.is_day ?? 1;
  const cat = getConditionCategory(wCode, isDay);

  document.body.dataset.condition = cat;

  if (els.heroTemperature) els.heroTemperature.textContent = temp;
  if (els.heroTempFeels) els.heroTempFeels.textContent = `${feels}°`;
  if (els.heroTempHigh) els.heroTempHigh.textContent = `${high}°`;
  if (els.heroTempLow) els.heroTempLow.textContent = `${low}°`;
  if (els.heroConditionText) els.heroConditionText.textContent = CONDITION_TITLES[cat] || "Clear";
  if (els.heroConditionIcon) els.heroConditionIcon.textContent = CONDITION_ICONS[cat] || "wb_sunny";

  // Telemetry Grid
  const windKph = Math.round(current.wind_speed_10m ?? 12);
  const gustsKph = Math.round(current.wind_gusts_10m ?? windKph * 1.3);
  const rh = Math.round(current.relative_humidity_2m ?? 65);
  const dew = Math.round(current.dew_point_2m ?? temp - 5);
  const pressure = (current.surface_pressure ?? 1013.2).toFixed(1);

  if (els.telemetryWindSpeed) els.telemetryWindSpeed.textContent = windKph;
  if (els.telemetryWindGusts) els.telemetryWindGusts.textContent = `${gustsKph} km/h`;
  if (els.telemetryHumidity) els.telemetryHumidity.textContent = `${rh}%`;
  if (els.telemetryDewpoint) els.telemetryDewpoint.textContent = `${dew}°C`;
  if (els.telemetryPressure) els.telemetryPressure.textContent = pressure;

  // Air Quality
  const aqiVal = state.airQuality?.us_aqi || state.airQuality?.european_aqi || 32;
  const aqiLabel = aqiVal <= 50 ? "Good" : aqiVal <= 100 ? "Moderate" : "Unhealthy";
  const aqiColor = aqiVal <= 50 ? "#34d399" : aqiVal <= 100 ? "#fbbf24" : "#f87171";

  if (els.telemetryAqiNum) {
    els.telemetryAqiNum.textContent = aqiVal;
    els.telemetryAqiNum.style.color = aqiColor;
  }
  if (els.telemetryAqiLabel) els.telemetryAqiLabel.textContent = aqiLabel;
  if (els.telemetryAqiBar) {
    els.telemetryAqiBar.style.width = `${Math.min(100, Math.max(10, aqiVal))}%`;
    els.telemetryAqiBar.style.backgroundColor = aqiColor;
  }
  if (els.telemetryAqiSub) {
    const pm25 = state.airQuality?.pm2_5 || 7.2;
    els.telemetryAqiSub.textContent = `PM2.5: ${pm25} µg/m³ • ${aqiLabel}`;
  }

  // Microclimate Chips
  if (els.microclimateChipsScroll) {
    const deltas = [
      { name: "Downtown Core", delta: 0, icon: "wb_sunny" },
      { name: "Coastal / Lake", delta: -3, icon: "mist" },
      { name: "Hilltop / Ridge", delta: -1, icon: "air" },
      { name: "Valley Sub-basin", delta: +2, icon: "clear_day" },
    ];
    els.microclimateChipsScroll.innerHTML = deltas
      .map(
        (m, idx) => `
      <div class="microclimate-chip flex items-center gap-2 px-3 py-2 rounded-xl ${
        idx === 0 ? "bg-amber-glow-surface border border-primary/40 shadow-sm" : "bg-surface-container-high border border-glass-border-subtle"
      } shrink-0 cursor-pointer">
        <span class="w-2 h-2 rounded-full ${idx === 0 ? "bg-primary-container" : "bg-secondary"}"></span>
        <div class="flex flex-col">
          <span class="font-pill-text text-xs text-ink-primary">${m.name}</span>
          <span class="font-headline-card text-xs text-primary leading-none font-bold">${temp + m.delta}°</span>
        </div>
        <span class="material-symbols-outlined text-primary text-[16px] ml-1">${m.icon}</span>
      </div>`
      )
      .join("");
  }

  // Hourly Forecast Scroller (First 24 entries)
  if (els.hourlyForecastScroll && hourly.time) {
    const times = hourly.time.slice(0, 24);
    const temps = hourly.temperature_2m?.slice(0, 24) || [];
    const rains = hourly.precipitation_probability?.slice(0, 24) || [];
    const codes = hourly.weather_code?.slice(0, 24) || [];
    const uvs = hourly.uv_index?.slice(0, 24) || [];

    els.hourlyForecastScroll.innerHTML = times
      .map((tStr, i) => {
        const d = new Date(tStr);
        const timeLabel = i === 0 ? "Now" : d.toLocaleTimeString([], { hour: "numeric" });
        const hTemp = Math.round(temps[i] ?? temp);
        const hRain = rains[i] ?? 0;
        const hCode = codes[i] ?? 0;
        const hUv = Math.round(uvs[i] ?? 0);
        const hCat = getConditionCategory(hCode, 1);
        const isActive = i === 0;

        return `
        <div class="forecast-hourly-card flex flex-col items-center justify-between w-20 py-3 rounded-2xl ${
          isActive
            ? "bg-amber-glow-surface border border-primary/40 shadow-md"
            : "bg-surface-container-high border border-glass-border/10"
        } shrink-0">
          <span class="font-label-caps text-[11px] ${isActive ? "text-primary font-bold" : "text-ink-tertiary"} uppercase">${timeLabel}</span>
          <span class="material-symbols-outlined ${isActive ? "text-primary" : "text-ink-primary"} text-[22px] my-1.5">${
          CONDITION_ICONS[hCat] || "wb_sunny"
        }</span>
          <span class="font-headline-card text-xs text-ink-primary font-bold">${hTemp}°</span>
          <div class="mt-1.5 flex flex-col items-center">
            <span class="font-label-caps text-[10px] text-secondary font-medium">${hRain}%</span>
            <span class="font-label-caps text-[9px] text-ink-tertiary">UV ${hUv}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  // 7-Day Synoptic Outlook
  if (els.dailyForecastContainer && daily.time) {
    const days = daily.time;
    els.dailyForecastContainer.innerHTML = days
      .map((dStr, i) => {
        const d = new Date(dStr + "T00:00:00");
        const dayLabel = i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" });
        const dCode = daily.weather_code?.[i] ?? 0;
        const dCat = getConditionCategory(dCode, 1);
        const dMax = Math.round(daily.temperature_2m_max?.[i] ?? temp + 2);
        const dMin = Math.round(daily.temperature_2m_min?.[i] ?? temp - 3);
        const dRain = daily.precipitation_probability_max?.[i] ?? 10;

        return `
        <div class="flex items-center justify-between py-2 px-1 border-b border-glass-border-subtle last:border-b-0">
          <div class="w-16">
            <span class="font-pill-text text-xs ${i === 0 ? "text-primary font-bold" : "text-ink-secondary"}">${dayLabel}</span>
          </div>
          <div class="flex items-center gap-1.5 w-20 justify-start">
            <span class="material-symbols-outlined ${i === 0 ? "text-primary" : "text-secondary"} text-[19px]">${
          CONDITION_ICONS[dCat] || "wb_sunny"
        }</span>
            <span class="font-label-caps text-[10px] text-secondary">${dRain}%</span>
          </div>
          <div class="flex-1 flex items-center justify-end gap-2.5">
            <span class="font-body-dim text-xs text-ink-tertiary w-6 text-right">${dMin}°</span>
            <div class="w-24 h-1.5 bg-surface-container rounded-full relative overflow-hidden">
              <div class="absolute inset-y-0 left-[20%] right-[15%] bg-gradient-to-r from-secondary to-primary-container rounded-full"></div>
            </div>
            <span class="font-pill-text text-xs text-ink-primary w-6 text-left font-semibold">${dMax}°</span>
          </div>
        </div>`;
      })
      .join("");
  }
}

function renderMapScreen() {
  const current = state.weather?.current || {};
  const temp = Math.round(current.temperature_2m ?? 0);
  const hasTemp = current.temperature_2m !== undefined;

  if (els.sensorCardTitle) {
    els.sensorCardTitle.textContent = `${state.currentLocation.name} — Live Reading`;
  }
  if (els.sensorMetricTemp) els.sensorMetricTemp.textContent = hasTemp ? `${temp}°C` : "—";
  if (els.sensorMetricWind) {
    els.sensorMetricWind.textContent =
      current.wind_speed_10m !== undefined ? `${Math.round(current.wind_speed_10m)} km/h` : "—";
  }
  if (els.sensorMetricPrecip) {
    els.sensorMetricPrecip.textContent =
      current.precipitation !== undefined ? `${current.precipitation.toFixed(1)} mm` : "—";
  }
  if (els.sensorMetricAqi) {
    els.sensorMetricAqi.textContent =
      state.airQuality?.us_aqi !== undefined ? state.airQuality.us_aqi : "—";
  }

  if (els.mapAddressSearchInput) {
    els.mapAddressSearchInput.value = `${state.currentLocation.name}, ${state.currentLocation.country || ""}`;
  }

  if (window.RadarMap && state.currentLocation.latitude) {
    window.RadarMap.updateLocation({
      latitude: state.currentLocation.latitude,
      longitude: state.currentLocation.longitude,
      name: state.currentLocation.name,
      temp: hasTemp ? `${temp}°C` : "—",
    });
  }
}

function renderInsightsScreen() {
  const current = state.weather?.current || {};
  const daily = state.weather?.daily || {};
  const temp = Math.round(current.temperature_2m ?? 22);

  // Early Warning Alert Ledger
  if (els.insightsAlertsContainer) {
    if (state.alerts && state.alerts.length > 0) {
      els.insightsAlertsContainer.innerHTML = state.alerts
        .map(
          (alert) => `
        <div class="relative overflow-hidden rounded-2xl bg-alert-coral-bg border border-alert-coral-border shadow-lg p-4">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-full bg-alert-coral/20 flex items-center justify-center shrink-0 text-alert-coral">
              <span class="material-symbols-outlined text-[22px]" style="font-variation-settings: 'FILL' 1;">warning</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="px-2 py-0.5 rounded-full font-label-caps text-[9px] bg-alert-coral text-on-error uppercase font-bold tracking-wider">${alert.severity || "Advisory"}</span>
                <span class="font-headline-card text-xs text-alert-coral-text font-semibold">${escapeHTML(alert.type || "Meteorological Notice")}</span>
              </div>
              <p class="font-body-base text-xs text-alert-coral-text/90">${escapeHTML(alert.text || "")}</p>
              ${
                alert.protocol
                  ? `
              <div class="mt-3 pt-2.5 bg-surface-container-lowest/40 -mx-4 -mb-4 px-4 py-2.5 rounded-b-2xl flex flex-col gap-1.5">
                <span class="font-label-caps text-[9px] text-alert-coral uppercase tracking-wider font-semibold">Precautionary Safety Protocol</span>
                ${alert.protocol
                  .map(
                    (p) => `
                  <div class="flex items-center gap-2 text-ink-primary font-body-dim text-xs">
                    <span class="material-symbols-outlined text-[15px] text-alert-coral">check_circle</span>
                    <span>${escapeHTML(p)}</span>
                  </div>`
                  )
                  .join("")}
              </div>`
                  : ""
              }
            </div>
          </div>
        </div>`
        )
        .join("");
    } else {
      els.insightsAlertsContainer.innerHTML = `
        <div class="rounded-2xl bg-surface-container-high border border-glass-border/20 p-4 flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-emerald-400/20 text-emerald-400 flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[20px]">verified_user</span>
          </div>
          <div>
            <h4 class="font-headline-card text-xs text-ink-primary font-semibold">No Severe Atmospheric Alerts</h4>
            <p class="font-body-dim text-xs text-ink-tertiary">All telemetry sensors report conditions within nominal safe thresholds.</p>
          </div>
        </div>`;
    }
  }

  // Microclimate Variance Bars
  if (els.insightsDeltaBars) {
    const bars = [
      { name: "Valley / Urban Basin", delta: "+2.4°C", width: "48%", color: "bg-primary-container" },
      { name: "Downtown Canyon Core", delta: "+1.1°C", width: "24%", color: "bg-secondary" },
      { name: "Coastal Headlands", delta: "-3.2°C", width: "56%", color: "bg-tertiary-container" },
      { name: "Elevated Hill Ridge", delta: "-1.6°C", width: "32%", color: "bg-secondary-fixed" },
    ];

    if (els.insightsBaselineLabel) {
      els.insightsBaselineLabel.textContent = `Variance vs ${state.currentLocation.name} Baseline (${temp}°C)`;
    }

    els.insightsDeltaBars.innerHTML = bars
      .map(
        (b) => `
      <div class="flex flex-col gap-1">
        <div class="flex justify-between items-center text-ink-primary text-xs">
          <span class="font-body-base font-medium">${b.name}</span>
          <span class="font-headline-card text-primary font-semibold">${b.delta}</span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-surface-container overflow-hidden flex">
          <div class="h-full ${b.color} rounded-full" style="width: ${b.width};"></div>
        </div>
      </div>`
      )
      .join("");
  }

  if (els.insightsPressureVal) {
    els.insightsPressureVal.textContent = (current.surface_pressure ?? 1014.2).toFixed(1);
  }
  if (els.insightsUvVal) {
    els.insightsUvVal.textContent = Math.round(daily.uv_index_max?.[0] ?? 4.2);
  }
}

// ============================================================
// OLLAMA AI REPORT SYNTHESIS
// ============================================================

async function generateAiReport() {
  const language = state.voiceLang === "hi" ? "Hindi" : state.voiceLang === "te" ? "Telugu" : "English";

  try {
    const payload = {
      location: state.currentLocation,
      weather_data: state.weather,
      alerts: state.alerts,
      language: language,
    };

    const res = await postJSON("/api/report", payload);
    state.synopsis = res.report;
    if (els.heroSynopsisText) {
      els.heroSynopsisText.innerHTML = renderMarkdownLite(res.report);
    }
    if (els.heroSynopsisMeta) {
      els.heroSynopsisMeta.textContent = `Synthesized in ${language} • Ready`;
    }
  } catch (err) {
    console.warn("AI report synthesis skipped:", err);
    if (els.heroSynopsisText) {
      els.heroSynopsisText.textContent = `Current temperature is ${Math.round(
        state.weather?.current?.temperature_2m || 20
      )}°C with ${CONDITION_TITLES[document.body.dataset.condition] || "nominal weather"}.`;
    }
  }
}

// ============================================================
// WEATHERGPT AI ASSISTANT CHAT
// ============================================================

// Unified input form (appears in all tabs)
els.unifiedQueryForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.unifiedQueryInput.value.trim();
  if (!q) return;
  els.unifiedQueryInput.value = "";
  switchView("view-weathergpt");
  submitAssistantQuery(q);
});

els.assistantChatForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.assistantInputText.value.trim();
  if (!q) return;
  submitAssistantQuery(q);
});

els.forecastQuickQueryForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.forecastQuickInput.value.trim();
  if (!q) return;
  els.forecastQuickInput.value = "";
  switchView("view-weathergpt");
  submitAssistantQuery(q);
});

async function submitAssistantQuery(userQuery) {
  if (!userQuery) return;
  if (els.assistantInputText) els.assistantInputText.value = "";

  // Append user bubble
  appendUserChatBubble(userQuery);

  // Show thinking indicator
  const thinkingId = appendThinkingBubble();

  const language = state.voiceLang === "hi" ? "Hindi" : state.voiceLang === "te" ? "Telugu" : "English";
  const weatherSummary = state.weather?.current
    ? `${Math.round(state.weather.current.temperature_2m)}°C, ${
        CONDITION_TITLES[document.body.dataset.condition] || "Normal"
      }, Wind: ${Math.round(state.weather.current.wind_speed_10m)} km/h`
    : "Clear, 22°C";

  try {
    const res = await postJSON("/api/assistant", {
      query: userQuery,
      location_name: state.currentLocation.name,
      weather_summary: weatherSummary,
      language: language,
    });

    removeThinkingBubble(thinkingId);
    appendAssistantResponseNode(res);
  } catch (err) {
    removeThinkingBubble(thinkingId);
    appendAssistantResponseNode({
      answer: `Unable to synthesize full atmospheric intelligence: ${err.message}. Current temperature in ${state.currentLocation.name} is ${weatherSummary}.`,
    });
  }
}

function appendUserChatBubble(text) {
  if (!els.chatStream) return;
  const div = document.createElement("div");
  div.className = "flex flex-col items-end w-full pl-6 space-y-1 animate-fade-in";
  div.innerHTML = `
    <div class="flex items-end gap-2 max-w-full">
      <div class="bg-surface-bright text-ink-primary rounded-2xl rounded-tr-xs px-4 py-2.5 shadow-md">
        <p class="font-body-base text-xs leading-relaxed">${escapeHTML(text)}</p>
      </div>
      <div class="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 ring-1 ring-glass-border">
        <span class="material-symbols-outlined text-[16px]">person</span>
      </div>
    </div>
    <span class="font-label-caps text-[9px] text-ink-tertiary pr-9">${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}</span>
  `;
  els.chatStream.appendChild(div);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function appendThinkingBubble() {
  const id = `thinking-${Date.now()}`;
  const div = document.createElement("div");
  div.id = id;
  div.className = "flex items-center gap-2 text-ink-tertiary text-xs p-2";
  div.innerHTML = `
    <span class="w-2 h-2 rounded-full bg-secondary animate-bounce"></span>
    <span class="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]"></span>
    <span class="w-2 h-2 rounded-full bg-secondary-fixed animate-bounce [animation-delay:0.4s]"></span>
    <span class="font-label-caps text-[10px] uppercase tracking-wider text-secondary font-mono">Synthesizing on Groq LPU &amp; Ollama...</span>
  `;
  els.chatStream?.appendChild(div);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  return id;
}

function removeThinkingBubble(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function appendAssistantResponseNode(data) {
  if (!els.chatStream) return;
  const div = document.createElement("div");
  div.className = "ai-chat-node flex flex-col items-start w-full space-y-2.5 animate-fade-in";

  let actionCardsHtml = "";

  // Action Card 1: Optimal Window
  if (data.optimal_window && data.optimal_window.time_range) {
    actionCardsHtml += `
    <div class="rounded-xl bg-surface-bright/70 border border-glass-border-subtle p-3 shadow-inner space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary-container text-[18px]">timelapse</span>
          <span class="font-headline-card text-xs text-ink-primary font-semibold">${escapeHTML(
            data.optimal_window.title || "Optimal Activity Window"
          )}</span>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-primary-container/20 text-primary-container font-label-caps text-[9px] font-semibold">
          ${escapeHTML(data.optimal_window.reliability || "High Confidence")}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-1">
        <div class="bg-surface-container-high/80 rounded-lg p-2 flex flex-col">
          <span class="font-label-caps text-[9px] text-ink-tertiary uppercase">Recommended Window</span>
          <span class="font-headline-card text-xs text-ink-primary font-bold mt-0.5">${escapeHTML(
            data.optimal_window.time_range
          )}</span>
          <span class="font-body-dim text-[10px] text-secondary mt-0.5">${escapeHTML(
            data.optimal_window.favorable_note || "Favorable conditions"
          )}</span>
        </div>
        <div class="bg-surface-container-high/80 rounded-lg p-2 flex flex-col">
          <span class="font-label-caps text-[9px] text-ink-tertiary uppercase">Thermal / Weather Shift</span>
          <span class="font-headline-card text-xs text-alert-coral font-bold mt-0.5">${escapeHTML(
            data.optimal_window.caution_note || "Later hours"
          )}</span>
          <span class="font-body-dim text-[10px] text-ink-secondary mt-0.5">Prepare accordingly</span>
        </div>
      </div>
    </div>`;
  }

  // Action Card 2: Route Micro-Climate Progression
  if (data.route_progression && data.route_progression.length > 0) {
    actionCardsHtml += `
    <div class="rounded-xl bg-surface-bright/70 border border-glass-border-subtle p-3 shadow-inner space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="material-symbols-outlined text-secondary text-[18px]">route</span>
          <span class="font-headline-card text-xs text-ink-primary font-semibold">Route Micro-Climate Progression</span>
        </div>
        <span class="font-body-dim text-[10px] text-ink-tertiary">Transect Telemetry</span>
      </div>
      <div class="grid grid-cols-3 gap-1.5 pt-1">
        ${data.route_progression
          .map(
            (step, idx) => `
        <div class="flex flex-col bg-surface-container-high/60 rounded-lg p-2">
          <span class="font-label-caps text-[9px] text-ink-tertiary uppercase">${escapeHTML(step.label || `Step ${idx + 1}`)}</span>
          <span class="font-label-section text-xs text-ink-primary font-bold truncate mt-0.5">${escapeHTML(step.place || "")}</span>
          <span class="font-headline-card text-xs text-primary font-bold">${escapeHTML(step.temp || "")}</span>
          <span class="font-body-dim text-[9px] text-ink-secondary truncate">${escapeHTML(step.condition || "")}</span>
        </div>`
          )
          .join("")}
      </div>
    </div>`;
  }

  // Action Card 3: Smart Apparel Guidance
  if (data.attire_guidance && data.attire_guidance.headline) {
    actionCardsHtml += `
    <div class="rounded-xl bg-surface-bright/70 border border-glass-border-subtle p-3 shadow-inner space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary text-[18px]">checkroom</span>
          <span class="font-headline-card text-xs text-ink-primary font-semibold">${escapeHTML(
            data.attire_guidance.headline
          )}</span>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-surface-container text-ink-secondary font-label-caps text-[9px]">
          ${escapeHTML(data.attire_guidance.thermal_rating || "Comfortable")}
        </span>
      </div>
      <div class="flex flex-wrap gap-1.5 pt-1">
        ${(data.attire_guidance.layers || [])
          .map((l) => `<span class="px-2 py-1 rounded-lg bg-surface-container text-ink-primary text-[10px] font-medium">• ${escapeHTML(l)}</span>`)
          .join("")}
        ${(data.attire_guidance.accessories || [])
          .map((a) => `<span class="px-2 py-1 rounded-lg bg-surface-container text-secondary text-[10px] font-medium">★ ${escapeHTML(a)}</span>`)
          .join("")}
      </div>
    </div>`;
  }

  div.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="w-6 h-6 rounded-full bg-amber-glow-surface text-primary-container flex items-center justify-center">
        <span class="material-symbols-outlined text-[15px]">auto_awesome</span>
      </div>
      <span class="font-label-section text-xs text-ink-primary font-semibold">WeatherGPT Synoptic Intelligence</span>
      <span class="font-label-caps text-[9px] text-secondary font-mono px-1.5 py-0.2 rounded bg-secondary-container/40">Groq Accelerated</span>
    </div>
    <div class="w-full bg-surface-container/70 border border-glass-border/30 backdrop-blur-xl rounded-2xl p-4 shadow-xl space-y-3">
      <p class="font-body-base text-xs text-ink-primary leading-relaxed">${escapeHTML(data.answer || "")}</p>
      ${actionCardsHtml}
    </div>
  `;

  els.chatStream.appendChild(div);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

// ============================================================
// GROQ WHISPER VOICE RECORDING MODULE
// ============================================================

function pickSupportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/m4a",
    "audio/wav",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startVoiceRecording() {
  if (state.isRecording) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    alert("Microphone voice recording is not supported in this browser environment.");
    return;
  }

  const mimeType = pickSupportedMimeType();
  if (mimeType === null) {
    alert("Audio recorder codec not supported in this browser.");
    return;
  }

  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    alert(`Microphone permission denied: ${err.message}`);
    return;
  }

  state.mediaRecorder = mimeType
    ? new MediaRecorder(state.mediaStream, { mimeType })
    : new MediaRecorder(state.mediaStream);
  state.recordedChunks = [];

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = handleVoiceRecordingFinished;

  state.mediaRecorder.start();
  state.isRecording = true;

  // Show voice overlay
  if (els.voiceOverlay) els.voiceOverlay.classList.remove("hidden");

  let secondsLeft = 20;
  if (els.voiceCountdownLabel) els.voiceCountdownLabel.textContent = `${secondsLeft}s remaining`;

  state.countdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (els.voiceCountdownLabel) els.voiceCountdownLabel.textContent = `${secondsLeft}s remaining`;
    if (secondsLeft <= 0) {
      stopVoiceRecording();
    }
  }, 1000);

  state.recordTimer = setTimeout(() => {
    if (state.isRecording) stopVoiceRecording();
  }, 20000);
}

function stopVoiceRecording() {
  if (!state.isRecording) return;
  clearInterval(state.countdownInterval);
  clearTimeout(state.recordTimer);
  state.isRecording = false;

  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }

  if (els.voiceOverlay) els.voiceOverlay.classList.add("hidden");
}

function cancelVoiceRecording() {
  clearInterval(state.countdownInterval);
  clearTimeout(state.recordTimer);
  state.isRecording = false;

  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }
  state.recordedChunks = [];
  if (els.voiceOverlay) els.voiceOverlay.classList.add("hidden");
}

async function handleVoiceRecordingFinished() {
  if (state.recordedChunks.length === 0) return;

  showStatus("Transcribing speech with Groq Whisper Large v3 Turbo...");

  try {
    const mime = state.mediaRecorder?.mimeType || "audio/webm";
    const audioBlob = new Blob(state.recordedChunks, { type: mime });

    const form = new FormData();
    form.append("audio", audioBlob, "voice_input.webm");
    form.append("preferred_language", state.voiceLang);

    const res = await fetch(API_BASE + "/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Groq transcription failed");

    const transcript = data.transcript;
    if (transcript) {
      showStatus(`Heard (${data.language}): "${transcript}"`);
      // Route query to assistant view
      switchView("view-weathergpt");
      submitAssistantQuery(transcript);
    }
  } catch (err) {
    alert(`Voice transcription error: ${err.message}`);
  } finally {
    hideStatus();
    state.recordedChunks = [];
  }
}

document.querySelectorAll(".forecast-mic-btn").forEach((b) => {
  b.addEventListener("click", startVoiceRecording);
});
els.assistantMicBtn?.addEventListener("click", startVoiceRecording);
els.unifiedMicBtn?.addEventListener("click", startVoiceRecording);
els.voiceStopBtn?.addEventListener("click", stopVoiceRecording);
els.voiceCancelBtn?.addEventListener("click", cancelVoiceRecording);

// ============================================================
// MAP SCREEN INTERACTIONS
// ============================================================

// Layer Toggle — precip and satellite ("clouds") are wired to real
// RainViewer tile data; temp/wind/aqi are marked data-soon in the HTML
// and show a status message instead of pretending to do something.
document.querySelectorAll(".map-layer-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    if (pill.dataset.soon === "true") {
      showStatus(`${pill.textContent.trim().replace("Soon", "").trim()} live layer is coming soon.`);
      setTimeout(hideStatus, 2500);
      return;
    }

    document.querySelectorAll(".map-layer-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    state.activeMapLayer = pill.dataset.layer;

    window.RadarMap?.setLayer(state.activeMapLayer);
  });
});

// Real marker click — opens the sensor card with the same real data
// already shown elsewhere in the app (populated by renderMapScreen()).
window.addEventListener("radar-marker-clicked", () => {
  if (els.mapSensorCard) {
    els.mapSensorCard.classList.remove("translate-y-48", "opacity-0");
  }
});

els.closeSensorCardBtn?.addEventListener("click", () => {
  if (els.mapSensorCard) {
    els.mapSensorCard.classList.add("translate-y-48", "opacity-0");
  }
});

// Radar Playback — steps through REAL RainViewer frames (past radar
// history going negative, nowcast frames going positive), instead of
// animating a decorative shape.
let isRadarPlaying = false;
let radarInterval = null;

els.radarPlayBtn?.addEventListener("click", () => {
  isRadarPlaying = !isRadarPlaying;
  const icon = els.radarPlayBtn.querySelector(".material-symbols-outlined");

  if (isRadarPlaying) {
    if (icon) icon.textContent = "pause";
    radarInterval = setInterval(() => {
      let val = parseInt(els.radarTimeSlider.value, 10);
      val = val >= 60 ? -60 : val + 10;
      els.radarTimeSlider.value = val;
      window.RadarMap?.stepToOffsetMinutes(val);
    }, 900);
  } else {
    if (icon) icon.textContent = "play_arrow";
    clearInterval(radarInterval);
  }
});

els.radarTimeSlider?.addEventListener("input", () => {
  if (isRadarPlaying) return; // playback loop already drives it
  window.RadarMap?.stepToOffsetMinutes(parseInt(els.radarTimeSlider.value, 10));
});

// ============================================================
// HELPER UTILITIES
// ============================================================

function escapeHTML(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function renderMarkdownLite(rawText) {
  const lines = escapeHTML(rawText).split("\n");
  const html = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  const inlineBold = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^\*\*(.+)\*\*$/);
    if (heading) {
      closeList();
      html.push(`<h4>${heading[1]}</h4>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineBold(bullet[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineBold(line)}</p>`);
  }
  closeList();
  return html.join("");
}

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

// ============================================================
// INITIALIZATION
// ============================================================

window.addEventListener("DOMContentLoaded", () => {
  bindAssistantChips();
  // Request GPS or load initial weather for default city
  refreshWeatherData();
});
