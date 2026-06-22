// Minimaler Service Worker: App-Shell cachen, Wetterdaten "network first".
const SHELL = "wetter-shell-v1";
const SHELL_FILES = ["/wetter/", "/wetter/index.html", "/wetter/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isApi =
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("brightsky.dev");

  if (isApi) {
    // Netzwerk zuerst, letzte Antwort als Fallback (Offline-Anzeige)
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open("wetter-data").then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
