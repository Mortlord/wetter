# Wetter-PWA  (mortlord.github.io/wetter)

Minimal-Wetter-Dashboard. Open-Meteo (Wetter weltweit) + Brightsky/DWD (Warnungen DE).
Aktueller Standort, Favoriten mit Ortssuche, Temp/Wind/UV/Niederschlag, 3-Tage-Trend, Warnmeldungen.

## Deploy auf GitHub Pages (automatisch)

1. Neues Repo anlegen mit Namen genau:  wetter
2. Den INHALT dieses Ordners (nicht den Ordner selbst) ins Repo-Wurzelverzeichnis legen.
   Also package.json, index.html, vite.config.js, src/, public/, .github/ direkt in die Wurzel.
3. Committen und auf den main-Branch pushen.
4. Im Repo: Settings -> Pages -> Source auf "GitHub Actions" stellen.
5. Push loest den Workflow aus, baut und veroeffentlicht automatisch.
   Danach live unter: https://mortlord.github.io/wetter/

Bei jedem weiteren Push baut GitHub neu. Kein lokales Node noetig.

## Homescreen (iPhone)
URL in Safari oeffnen -> Teilen -> "Zum Home-Bildschirm".
Laeuft als Standalone-App. HTTPS ist bei Pages dabei, also funktionieren
Geolocation, Service Worker und Warnungen.

## Hinweis
Der Repo-Name MUSS "wetter" sein, sonst stimmt der Pfad nicht.
Anderer Name? Dann in vite.config.js, manifest.json, sw.js und index.html
ueberall "/wetter/" auf "/<deinname>/" aendern.
