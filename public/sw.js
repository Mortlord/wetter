// Service Worker
// Strategie:
//   - Navigation (HTML-Seite): NETWORK FIRST -> nach jedem Deploy sofort aktuell,
//     bei Offline Fallback auf gecachte Seite.
//   - API (Open-Meteo, Brightsky): network first, letzte Antwort als Offline-Fallback.
//   - Sonstige Assets (JS/CSS/Icons): cache first, im Hintergrund nachladen.
const VERSION = "v2";
const SHELL = `wetter-shell-${VERSION}`;
const DATA = `wetter-data-${VERSION}`;
const SHELL_FILES = ["/wetter/", "/wetter/index.html", "/wetter/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 1) Seitenaufrufe immer frisch holen
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/wetter/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/wetter/index.html"))
    );
    return;
  }

  // 2) Wetter-APIs: network first
  const isApi =
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("brightsky.dev");
  if (isApi) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3) Assets: cache first, sonst Netz (und cachen)
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        })
    )
  );
});
