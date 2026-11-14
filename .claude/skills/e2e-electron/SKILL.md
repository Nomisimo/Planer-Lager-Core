---
name: e2e-electron
description: E2E-Tests und Screenshots für Materialplaner/Productionplaner in der Cloud-VM (Playwright _electron unter xvfb, Testserver mit PostgreSQL, Scanner-Simulation). Verwenden für Abnahmetests T-xx, INT-xx, UI-Prüfung und Fehlersuche in der Oberfläche.
---

# E2E mit Electron in der Cloud-VM

## Voraussetzungen (vom Setup-Script installiert)
`xvfb`, GTK/NSS-Bibliotheken für Electron, PostgreSQL 16. Prüfen: `which xvfb-run && psql --version`.
Fehlt etwas: `sudo apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 libxss1 libxshmfence1` und in ENTSCHEIDUNGEN.md vermerken, dass das Setup-Script angepasst werden muss.
Electron-Binary fehlt (`npm i` lud es nicht)? `ELECTRON_MIRROR` aus der Umgebung nutzen, sonst `[~]` + Eintrag.

## Ablauf
1. Testserver: `node packages/server/test-start.js --port 0 --db lager_e2e --seed e2e` → schreibt URL nach `e2e/.server-url`.
2. Apps bauen: `npm run build:dev` in Materialplaner und Productionplaner (mit `LAGER_CORE_DIR` auf Core).
3. Start: `xvfb-run -a npx playwright test e2e/T-07.spec.js --reporter=line 2>&1 | tail -n 30`
4. In Tests: `const app = await _electron.launch({ args: ["--no-sandbox", appDir], env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", LAGER_SERVER_URL, LAGER_TEST: "1" } })`, dann `const win = await app.firstWindow()`. (VM läuft als root: ohne `--no-sandbox` bricht Electron ab.)
   Vorab geladenes Electron liegt in `$ELECTRON_CACHE` (Setup-Script).
5. Arbeitsplatz-Web: im Materialplaner-Kiosk-Fenster oder per zweitem `BrowserWindow` testen (kein Playwright-Browser-Download).

## Scanner simulieren
- **HID**: `await win.keyboard.type("LT-0001", { delay: 8 }); await win.keyboard.press("Enter");` (schnell = Scanner). Gegenprobe Mensch: `delay: 120` darf nicht als Scan zählen.
- **Netzwerk-TCP**: `net.connect(port).end("LT-0001\r\n")` an `SCANNER_TCP_PORT`.
- **Netzwerk-HTTP**: `fetch(url + "/api/v1/scanner/eingang", { method: "POST", headers: { Authorization: "Bearer " + scannerToken }, body: JSON.stringify({ code }) })`.

## Screenshots
- `await win.screenshot({ path: "e2e/artefakte/<ID>-<schritt>.png" })`. Nur an Schlüsselstellen (≤ 3 je Test).
- Bewerten lässt sie der Subagent `ui-pruefer` (spart Kontext im Hauptlauf).

## Regeln
- Jeder Test räumt seine Daten auf oder nutzt eine eigene DB (`lager_e2e_<id>`).
- Keine festen `sleep`. Auf Text/Element warten (`await expect(win.getByText("Gepackt")).toBeVisible()`).
- Scan-Rückmeldung < 2 s prüfen (FA-15): Zeit messen und asserten.
- Flaky? Ursache suchen (Event-Reihenfolge, fehlendes await), nicht Timeout erhöhen.
