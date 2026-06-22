import React, { useState, useEffect, useCallback } from "react";

/*
  Minimal-Wetter-Dashboard (PWA)
  Datenquellen:
    - Open-Meteo  -> Wetterdaten weltweit (kein API-Key)
    - Brightsky   -> amtliche DWD-Warnungen (nur fuer DE-Standorte sinnvoll)

  Deploy-Hinweis:
    - Geolocation, Service Worker und "Zum Homescreen" brauchen HTTPS.
    - Favoriten werden in localStorage gehalten (im Artifact-Preview nicht aktiv).
*/

const WEATHER = {
  0:  { t: "Klar",                 i: "\u2600\uFE0F" },
  1:  { t: "Ueberwiegend klar",    i: "\uD83C\uDF24\uFE0F" },
  2:  { t: "Teils bewoelkt",       i: "\u26C5" },
  3:  { t: "Bedeckt",              i: "\u2601\uFE0F" },
  45: { t: "Nebel",                i: "\uD83C\uDF2B\uFE0F" },
  48: { t: "Reifnebel",            i: "\uD83C\uDF2B\uFE0F" },
  51: { t: "Leichter Niesel",      i: "\uD83C\uDF26\uFE0F" },
  53: { t: "Niesel",               i: "\uD83C\uDF26\uFE0F" },
  55: { t: "Starker Niesel",       i: "\uD83C\uDF26\uFE0F" },
  61: { t: "Leichter Regen",       i: "\uD83C\uDF27\uFE0F" },
  63: { t: "Regen",                i: "\uD83C\uDF27\uFE0F" },
  65: { t: "Starker Regen",        i: "\uD83C\uDF27\uFE0F" },
  71: { t: "Leichter Schnee",      i: "\uD83C\uDF28\uFE0F" },
  73: { t: "Schnee",               i: "\uD83C\uDF28\uFE0F" },
  75: { t: "Starker Schnee",       i: "\uD83C\uDF28\uFE0F" },
  80: { t: "Schauer",              i: "\uD83C\uDF26\uFE0F" },
  81: { t: "Starke Schauer",       i: "\uD83C\uDF27\uFE0F" },
  82: { t: "Heftige Schauer",      i: "\u26C8\uFE0F" },
  95: { t: "Gewitter",             i: "\u26C8\uFE0F" },
  96: { t: "Gewitter, Hagel",      i: "\u26C8\uFE0F" },
  99: { t: "Schweres Gewitter",    i: "\u26C8\uFE0F" },
};
const wx = (code) => WEATHER[code] || { t: "Unbekannt", i: "\u2754" };

const DEFAULT_FAVORITES = [
  { id: "fr",  name: "Freiburg",        lat: 47.996, lon: 7.849,  de: true  },
  { id: "ber", name: "Berlin",          lat: 52.520, lon: 13.405, de: true  },
  { id: "sgn", name: "Ho-Chi-Minh-St.", lat: 10.823, lon: 106.630, de: false },
];

const uvLabel = (uv) => {
  if (uv == null) return { t: "\u2013", c: "#8a8f98" };
  if (uv < 3)  return { t: "niedrig",      c: "#4ade80" };
  if (uv < 6)  return { t: "mittel",       c: "#facc15" };
  if (uv < 8)  return { t: "hoch",         c: "#fb923c" };
  if (uv < 11) return { t: "sehr hoch",    c: "#f87171" };
  return { t: "extrem", c: "#c084fc" };
};

const dayName = (iso) => {
  const d = new Date(iso);
  return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
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
  const [active, setActive] = useState(null); // null = aktueller Standort
  const [geo, setGeo] = useState(null);
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errMsg, setErrMsg] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Favoriten persistieren
  useEffect(() => {
    try {
      window.localStorage.setItem("wx_favorites", JSON.stringify(favorites));
    } catch { /* Artifact-Preview: kein localStorage */ }
  }, [favorites]);

  const place = active
    ? favorites.find((f) => f.id === active)
    : geo
    ? { name: geo.name || "Aktueller Standort", lat: geo.lat, lon: geo.lon, de: geo.de }
    : null;

  const askLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrMsg("Geolocation wird vom Browser nicht unterstuetzt.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // grobe DE-Bounding-Box fuer Warnungs-Logik
        const de = lat > 47.2 && lat < 55.1 && lon > 5.8 && lon < 15.1;
        setGeo({ lat, lon, de });
        setActive(null);
      },
      (err) => {
        setErrMsg("Standort nicht verfuegbar: " + err.message);
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }, []);

  // Wetter + Warnungen laden, sobald ein Ort feststeht
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    setStatus("loading");
    setErrMsg("");

    const wUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,wind_speed_10m,precipitation,weather_code,uv_index" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,uv_index_max" +
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
            ? a.alerts.filter((x) => x.event_de || x.headline_de || x.headline)
            : [];
        setAlerts(list);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setErrMsg("Wetterdaten konnten nicht geladen werden.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [place?.lat, place?.lon, place?.de]);

  // Erststart: Standort anfragen
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
      "https://geocoding-api.open-meteo.com/v1/search?count=5&language=de&name=" +
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

        {/* Kopf: Ortswahl */}
        <div style={S.tabs}>
          <button
            onClick={askLocation}
            style={{ ...S.tab, ...(active === null ? S.tabActive : {}) }}
          >
            \u2316 Standort
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

        {/* Warnungen zuerst */}
        {place?.de && alerts.length > 0 && (
          <div style={S.alertWrap}>
            {alerts.slice(0, 3).map((a, idx) => (
              <div key={idx} style={S.alert}>
                <span style={S.alertDot} />
                <div>
                  <div style={S.alertTitle}>
                    {a.event_de || a.headline_de || a.headline}
                  </div>
                  {(a.description_de || a.instruction_de) && (
                    <div style={S.alertBody}>
                      {a.description_de || a.instruction_de}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {place && !place.de && (
          <div style={S.noAlert}>
            Keine amtlichen Warnungen ausserhalb Deutschlands verfuegbar.
          </div>
        )}

        {status === "loading" && <div style={S.muted}>Lade \u2026</div>}
        {status === "error" && <div style={S.errBox}>{errMsg}</div>}

        {/* Aktueller Block */}
        {cur && place && (
          <>
            <div style={S.hero}>
              <div style={S.heroIcon}>{wx(cur.weather_code).i}</div>
              <div>
                <div style={S.place}>{place.name}</div>
                <div style={S.temp}>
                  {Math.round(cur.temperature_2m)}
                  <span style={S.deg}>\u00B0</span>
                </div>
                <div style={S.cond}>{wx(cur.weather_code).t}</div>
              </div>
            </div>

            {/* Kernwerte */}
            <div style={S.metrics}>
              <Metric label="Wind" value={`${Math.round(cur.wind_speed_10m)} km/h`} />
              <Metric label="Niederschlag" value={`${cur.precipitation ?? 0} mm`} />
              <Metric
                label="UV"
                value={cur.uv_index != null ? cur.uv_index.toFixed(1) : "\u2013"}
                sub={uv.t}
                color={uv.c}
              />
            </div>

            {/* 3-Tage-Trend */}
            {daily && (
              <div style={S.forecast}>
                {daily.time.map((t, i) => (
                  <div key={t} style={S.fday}>
                    <div style={S.fdayName}>{i === 0 ? "Heute" : dayName(t)}</div>
                    <div style={S.fdayIcon}>{wx(daily.weather_code[i]).i}</div>
                    <div style={S.fdayTemp}>
                      <span style={S.fmax}>{Math.round(daily.temperature_2m_max[i])}\u00B0</span>
                      <span style={S.fmin}>{Math.round(daily.temperature_2m_min[i])}\u00B0</span>
                    </div>
                    <div style={S.fdayRain}>
                      {daily.precipitation_sum[i] > 0
                        ? `\uD83D\uDCA7 ${daily.precipitation_sum[i].toFixed(1)} mm`
                        : "\u2013"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Favoriten verwalten */}
        <div style={S.manage}>
          <div style={S.manageHead}>Ort hinzufuegen</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Stadt suchen \u2026"
            style={S.search}
          />
          {searching && <div style={S.muted}>Suche \u2026</div>}
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
              <div style={{ ...S.manageHead, marginTop: 16 }}>Favoriten</div>
              {favorites.map((f) => (
                <div key={f.id} style={S.manageRow}>
                  <span>
                    {f.name}
                    {f.de ? "" : "  (kein Warndienst)"}
                  </span>
                  <button style={S.remove} onClick={() => removeFavorite(f.id)}>
                    entfernen
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
    padding: "20px 16px 40px",
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
  metrics: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 },
  metric: {
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 16, padding: "14px 12px",
  },
  metricLabel: { fontSize: 12, color: "#8a8f98", textTransform: "uppercase", letterSpacing: ".06em" },
  metricValue: { fontSize: 22, fontWeight: 500, marginTop: 6 },
  metricSub: { fontSize: 12, marginTop: 2 },
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
