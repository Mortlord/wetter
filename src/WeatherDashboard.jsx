import React, { useState, useEffect, useCallback } from "react";

/*
  Minimal weather dashboard (PWA)
  Data sources:
    - Open-Meteo  -> weather worldwide (no API key)
    - Brightsky   -> official DWD warnings (only meaningful for DE locations)

  Deploy notes:
    - Geolocation, service worker and "Add to Home Screen" need HTTPS.
    - Favorites are stored in localStorage.
*/

const WEATHER = {
  0:  { t: "Clear",               i: "☀️" },
  1:  { t: "Mostly clear",        i: "🌤️" },
  2:  { t: "Partly cloudy",       i: "⛅" },
  3:  { t: "Overcast",            i: "☁️" },
  45: { t: "Fog",                 i: "🌫️" },
  48: { t: "Rime fog",            i: "🌫️" },
  51: { t: "Light drizzle",       i: "🌦️" },
  53: { t: "Drizzle",             i: "🌦️" },
  55: { t: "Heavy drizzle",       i: "🌦️" },
  61: { t: "Light rain",          i: "🌧️" },
  63: { t: "Rain",                i: "🌧️" },
  65: { t: "Heavy rain",          i: "🌧️" },
  71: { t: "Light snow",          i: "🌨️" },
  73: { t: "Snow",                i: "🌨️" },
  75: { t: "Heavy snow",          i: "🌨️" },
  80: { t: "Showers",             i: "🌦️" },
  81: { t: "Heavy showers",       i: "🌧️" },
  82: { t: "Violent showers",     i: "⛈️" },
  95: { t: "Thunderstorm",        i: "⛈️" },
  96: { t: "Thunderstorm, hail",  i: "⛈️" },
  99: { t: "Severe thunderstorm", i: "⛈️" },
};
const wx = (code) => WEATHER[code] || { t: "Unknown", i: "❔" };

const DEFAULT_FAVORITES = [
  { id: "fr",  name: "Freiburg",     lat: 47.996, lon: 7.849,   de: true  },
  { id: "ber", name: "Berlin",       lat: 52.520, lon: 13.405,  de: true  },
  { id: "sgn", name: "Ho Chi Minh",  lat: 10.823, lon: 106.630, de: false },
];

const uvLabel = (uv) => {
  if (uv == null) return { t: "–", c: "#8a8f98" };
  if (uv < 3)  return { t: "low",       c: "#4ade80" };
  if (uv < 6)  return { t: "moderate",  c: "#facc15" };
  if (uv < 8)  return { t: "high",      c: "#fb923c" };
  if (uv < 11) return { t: "very high", c: "#f87171" };
  return { t: "extreme", c: "#c084fc" };
};

const dayName = (iso) => {
  const d = new Date(iso);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
};

// HH from ISO time, local
const hourLabel = (iso) => {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, "0");
};

// HH:MM from ISO, for sunrise/sunset
const clock = (iso) => {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
};

// next 12 hourly slots starting from the current hour
const nextHours = (hourly, count = 12) => {
  if (!hourly || !hourly.time) return [];
  const now = Date.now();
  const out = [];
  for (let i = 0; i < hourly.time.length && out.length < count; i++) {
    const t = new Date(hourly.time[i]).getTime();
    if (t >= now - 3600 * 1000) {
      out.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m[i],
        pop: hourly.precipitation_probability
          ? hourly.precipitation_probability[i]
          : null,
        code: hourly.weather_code[i],
      });
    }
  }
  return out;
};

export default function WeatherDashboard() {
  const [favorites, setFavorites] = useState(() => {
    try {
      const s = window.localStorage.getItem("wx_favorites");
      return s ? JSON.parse(s) : DEFAULT_FAVORITES;
    } catch {
      return DEFAULT_FAVORITES;
    }
  });
  const [active, setActive] = useState(null); // null = current location
  const [geo, setGeo] = useState(null);
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errMsg, setErrMsg] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // persist favorites
  useEffect(() => {
    try {
      window.localStorage.setItem("wx_favorites", JSON.stringify(favorites));
    } catch { /* ignore */ }
  }, [favorites]);

  const place = active
    ? favorites.find((f) => f.id === active)
    : geo
    ? { name: geo.name || "Current location", lat: geo.lat, lon: geo.lon, de: geo.de }
    : null;

  const askLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrMsg("Geolocation is not supported by this browser.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // rough DE bounding box for warning logic
        const de = lat > 47.2 && lat < 55.1 && lon > 5.8 && lon < 15.1;
        setGeo({ lat, lon, de });
        setActive(null);
      },
      (err) => {
        setErrMsg("Location unavailable: " + err.message);
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }, []);

  // load weather + warnings once a place is set
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    setStatus("loading");
    setErrMsg("");

    const wUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,uv_index" +
      "&hourly=temperature_2m,precipitation_probability,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,uv_index_max,sunrise,sunset" +
      "&timezone=auto&forecast_days=3";

    const tasks = [fetch(wUrl).then((r) => r.json())];
    if (place.de) {
      tasks.push(
        fetch(`https://api.brightsky.dev/alerts?lat=${place.lat}&lon=${place.lon}`)
          .then((r) => r.json())
          .catch(() => null)
      );
    }

    Promise.all(tasks)
      .then(([w, a]) => {
        if (cancelled) return;
        setData(w);
        const list =
          a && Array.isArray(a.alerts)
            ? a.alerts.filter((x) => x.event_en || x.headline_en || x.event_de || x.headline)
            : [];
        setAlerts(list);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setErrMsg("Could not load weather data.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [place?.lat, place?.lon, place?.de]);

  // first start: ask for location
  useEffect(() => {
    askLocation();
  }, [askLocation]);

  const removeFavorite = (id) =>
    setFavorites((f) => f.filter((x) => x.id !== id));

  const searchPlace = useCallback((q) => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    fetch(
      "https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&name=" +
        encodeURIComponent(q.trim())
    )
      .then((r) => r.json())
      .then((j) => setResults(Array.isArray(j.results) ? j.results : []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchPlace(query), 350);
    return () => clearTimeout(t);
  }, [query, searchPlace]);

  const addFavorite = (r) => {
    const id = `${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`;
    if (favorites.some((f) => f.id === id)) {
      setActive(id);
    } else {
      const fav = {
        id,
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        de: r.country_code === "DE",
      };
      setFavorites((f) => [...f, fav]);
      setActive(id);
    }
    setQuery("");
    setResults([]);
  };

  const cur = data?.current;
  const daily = data?.daily;
  const uv = uvLabel(cur?.uv_index);

  return (
    <div style={S.root}>
      <style>{KEYFRAMES}</style>
      <div style={S.shell}>

        {/* location tabs */}
        <div style={S.tabs}>
          <button
            onClick={askLocation}
            style={{ ...S.tab, ...(active === null ? S.tabActive : {}) }}
          >
            ⌖ Location
          </button>
          {favorites.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              style={{ ...S.tab, ...(active === f.id ? S.tabActive : {}) }}
            >
              {f.name}
            </button>
          ))}
        </div>

        {/* warnings first */}
        {place?.de && alerts.length > 0 && (
          <div style={S.alertWrap}>
            {alerts.slice(0, 3).map((a, idx) => (
              <div key={idx} style={S.alert}>
                <span style={S.alertDot} />
                <div>
                  <div style={S.alertTitle}>
                    {a.event_en || a.headline_en || a.event_de || a.headline}
                  </div>
                  {(a.description_en || a.instruction_en ||
                    a.description_de || a.instruction_de) && (
                    <div style={S.alertBody}>
                      {a.description_en || a.instruction_en ||
                        a.description_de || a.instruction_de}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {place && !place.de && (
          <div style={S.noAlert}>
            No official warnings available outside Germany.
          </div>
        )}

        {status === "loading" && <div style={S.muted}>Loading …</div>}
        {status === "error" && <div style={S.errBox}>{errMsg}</div>}

        {/* current block */}
        {cur && place && (
          <>
            <div style={S.hero}>
              <div style={S.heroIcon}>{wx(cur.weather_code).i}</div>
              <div>
                <div style={S.place}>{place.name}</div>
                <div style={S.temp}>
                  {Math.round(cur.temperature_2m)}
                  <span style={S.deg}>°</span>
                </div>
                <div style={S.cond}>{wx(cur.weather_code).t}</div>
                {cur.apparent_temperature != null && (
                  <div style={S.feels}>
                    Feels like {Math.round(cur.apparent_temperature)}°
                  </div>
                )}
              </div>
            </div>

            {/* core metrics */}
            <div style={S.metrics}>
              <Metric label="Wind" value={`${Math.round(cur.wind_speed_10m)}`} sub="km/h" />
              <Metric label="Precip." value={`${cur.precipitation ?? 0}`} sub="mm" />
              <Metric
                label="Humidity"
                value={cur.relative_humidity_2m != null ? `${cur.relative_humidity_2m}` : "–"}
                sub="%"
              />
              <Metric
                label="UV"
                value={cur.uv_index != null ? cur.uv_index.toFixed(1) : "–"}
                sub={uv.t}
                color={uv.c}
              />
            </div>

            {/* hourly preview for today */}
            {data?.hourly && (
              <div style={S.hourlyWrap}>
                <div style={S.sectionHead}>Next hours</div>
                <div style={S.hourly}>
                  {nextHours(data.hourly, 12).map((h) => (
                    <div key={h.time} style={S.hour}>
                      <div style={S.hourTime}>{hourLabel(h.time)}</div>
                      <div style={S.hourIcon}>{wx(h.code).i}</div>
                      <div style={S.hourTemp}>{Math.round(h.temp)}°</div>
                      <div style={S.hourPop}>
                        {h.pop != null && h.pop > 0 ? `${h.pop}%` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3-day trend */}
            {daily && (
              <div style={S.forecast}>
                {daily.time.map((t, i) => (
                  <div key={t} style={S.fday}>
                    <div style={S.fdayName}>{i === 0 ? "Today" : dayName(t)}</div>
                    <div style={S.fdayIcon}>{wx(daily.weather_code[i]).i}</div>
                    <div style={S.fdayTemp}>
                      <span style={S.fmax}>{Math.round(daily.temperature_2m_max[i])}°</span>
                      <span style={S.fmin}>{Math.round(daily.temperature_2m_min[i])}°</span>
                    </div>
                    <div style={S.fdayRain}>
                      {daily.precipitation_sum[i] > 0
                        ? `💧 ${daily.precipitation_sum[i].toFixed(1)} mm`
                        : "–"}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* sunrise / sunset for today */}
            {daily?.sunrise && daily?.sunset && (
              <div style={S.sun}>
                <div style={S.sunItem}>
                  <span style={S.sunIcon}>🌅</span>
                  <span style={S.sunLabel}>Sunrise</span>
                  <span style={S.sunTime}>{clock(daily.sunrise[0])}</span>
                </div>
                <div style={S.sunItem}>
                  <span style={S.sunIcon}>🌇</span>
                  <span style={S.sunLabel}>Sunset</span>
                  <span style={S.sunTime}>{clock(daily.sunset[0])}</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* manage favorites */}
        <div style={S.manage}>
          <div style={S.manageHead}>Add location</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city …"
            style={S.search}
          />
          {searching && <div style={S.muted}>Searching …</div>}
          {results.length > 0 && (
            <div style={S.results}>
              {results.map((r) => (
                <button
                  key={`${r.latitude},${r.longitude}`}
                  style={S.resultRow}
                  onClick={() => addFavorite(r)}
                >
                  <span>
                    {r.name}
                    {r.admin1 ? `, ${r.admin1}` : ""}
                  </span>
                  <span style={S.resultCountry}>{r.country_code}</span>
                </button>
              ))}
            </div>
          )}

          {favorites.length > 0 && (
            <>
              <div style={{ ...S.manageHead, marginTop: 16 }}>Favorites</div>
              {favorites.map((f) => (
                <div key={f.id} style={S.manageRow}>
                  <span>
                    {f.name}
                    {f.de ? "" : "  (no warning service)"}
                  </span>
                  <button style={S.remove} onClick={() => removeFavorite(f.id)}>
                    remove
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, color }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, color: color || "#f5f5f7" }}>{value}</div>
      {sub && <div style={{ ...S.metricSub, color: color || "#8a8f98" }}>{sub}</div>}
    </div>
  );
}

const KEYFRAMES = `
  @keyframes fadeUp { from { opacity:0; transform:translateY(8px);} to {opacity:1; transform:none;} }
  * { box-sizing: border-box; }
`;

const S = {
  root: {
    minHeight: "100vh",
    background: "radial-gradient(120% 100% at 50% 0%, #1b2735 0%, #0b0f14 60%)",
    color: "#f5f5f7",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    padding: "calc(env(safe-area-inset-top, 0px) + 20px) 16px 40px",
    display: "flex",
    justifyContent: "center",
  },
  shell: { width: "100%", maxWidth: 440, animation: "fadeUp .4s ease" },
  tabs: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 16 },
  tab: {
    flex: "0 0 auto", padding: "8px 14px", borderRadius: 999,
    border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)",
    color: "#c7ccd4", fontSize: 14, cursor: "pointer", whiteSpace: "nowrap",
  },
  tabActive: { background: "#f5f5f7", color: "#0b0f14", borderColor: "#f5f5f7", fontWeight: 600 },
  alertWrap: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  alert: {
    display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14,
    background: "rgba(248,113,113,.12)", border: "1px solid rgba(248,113,113,.35)",
  },
  alertDot: {
    width: 8, height: 8, borderRadius: 999, background: "#f87171",
    marginTop: 6, flex: "0 0 auto",
  },
  alertTitle: { fontWeight: 600, fontSize: 14, color: "#fecaca" },
  alertBody: { fontSize: 12.5, color: "#e7c5c5", marginTop: 3, lineHeight: 1.4 },
  noAlert: { fontSize: 12.5, color: "#6b7280", marginBottom: 16 },
  muted: { color: "#8a8f98", fontSize: 14, padding: "8px 0" },
  errBox: {
    fontSize: 13, color: "#fecaca", background: "rgba(248,113,113,.1)",
    border: "1px solid rgba(248,113,113,.3)", borderRadius: 12, padding: "10px 12px", marginBottom: 12,
  },
  hero: { display: "flex", alignItems: "center", gap: 18, marginBottom: 24 },
  heroIcon: { fontSize: 64, lineHeight: 1 },
  place: { fontSize: 15, color: "#8a8f98", letterSpacing: ".02em" },
  temp: { fontSize: 72, fontWeight: 200, lineHeight: 1, letterSpacing: "-.03em" },
  deg: { fontWeight: 200 },
  cond: { fontSize: 16, color: "#c7ccd4", marginTop: 2 },
  feels: { fontSize: 13, color: "#8a8f98", marginTop: 2 },
  metrics: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 },
  metric: {
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 14, padding: "12px 8px",
  },
  metricLabel: { fontSize: 10.5, color: "#8a8f98", textTransform: "uppercase", letterSpacing: ".04em" },
  metricValue: { fontSize: 20, fontWeight: 500, marginTop: 5 },
  metricSub: { fontSize: 12, marginTop: 2 },
  sectionHead: { fontSize: 11, color: "#8a8f98", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 },
  hourlyWrap: { marginBottom: 20 },
  hourly: { display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4 },
  hour: {
    flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center",
    gap: 4, padding: "8px 6px", borderRadius: 12, background: "rgba(255,255,255,.03)",
    minWidth: 46,
  },
  hourTime: { fontSize: 11, color: "#8a8f98" },
  hourIcon: { fontSize: 18 },
  hourTemp: { fontSize: 14, fontWeight: 600 },
  hourPop: { fontSize: 10.5, color: "#7dd3fc", minHeight: 13 },
  forecast: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 24 },
  fday: {
    display: "grid", gridTemplateColumns: "48px 40px 1fr auto", alignItems: "center",
    gap: 12, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,.03)",
  },
  fdayName: { fontSize: 14, color: "#c7ccd4", fontWeight: 500 },
  fdayIcon: { fontSize: 24, textAlign: "center" },
  fdayTemp: { display: "flex", gap: 10, alignItems: "baseline" },
  fmax: { fontSize: 17, fontWeight: 600 },
  fmin: { fontSize: 15, color: "#8a8f98" },
  fdayRain: { fontSize: 12.5, color: "#7dd3fc", textAlign: "right" },
  sun: {
    display: "flex", gap: 10, marginBottom: 24,
  },
  sunItem: {
    flex: 1, display: "flex", alignItems: "center", gap: 8,
    padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,.03)",
  },
  sunIcon: { fontSize: 20 },
  sunLabel: { fontSize: 13, color: "#8a8f98", flex: 1 },
  sunTime: { fontSize: 15, fontWeight: 600 },
  manage: {
    borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 16,
  },
  search: {
    width: "100%", padding: "10px 12px", borderRadius: 12,
    border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)",
    color: "#f5f5f7", fontSize: 14, outline: "none",
  },
  results: { display: "flex", flexDirection: "column", gap: 2, marginTop: 8 },
  resultRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    width: "100%", padding: "10px 12px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)",
    color: "#f5f5f7", fontSize: 14, cursor: "pointer", textAlign: "left",
  },
  resultCountry: { fontSize: 12, color: "#8a8f98" },
  manageHead: { fontSize: 12, color: "#8a8f98", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 },
  manageRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    fontSize: 14, color: "#c7ccd4", padding: "6px 0",
  },
  remove: {
    background: "none", border: "none", color: "#f87171", fontSize: 13,
    cursor: "pointer", padding: 0,
  },
};
