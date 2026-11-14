# Architektur Planer-Lager

Stand: Setup vom 14.11.2026. Änderungen hier nur mit Eintrag in ENTSCHEIDUNGEN.md.

## 1. Überblick

```
 Materialplaner (Electron)   Productionplaner (Electron)   Browser: Arbeitsplatz / Anzeige-TV
            \                         |                         /
             \___ HTTPS REST /api/v1 + WSS /ws (Live-Events) __/
                                      |
                       Lager-Server (Node 22, Docker)  <── Netzwerk-Scanner (TCP / HTTP)
                                      |
                        PostgreSQL 16  +  /data (Projektordner, Uploads, PDFs, Sicherungen)
```

Ein Server, eine Datenbank, ein Stand der Wahrheit (Spec 1.2 Nr. 1). Clients halten nur Cache + Offline-Puffer.

## 2. Repos und Ordner

### Planer-Lager-Core (npm workspaces)
```
packages/domain/       Reine Fachlogik je Regel (codes, verfuegbarkeit, preise, kabel, scannen, packliste,
                       zonen, zeit, pruefung, etiketten, rechte). Kein IO. Jede Funktion klein, testbar.
packages/db/           PostgreSQL-Schema, Migrationen (SQL-Dateien, nummeriert), Repositories, Transaktionen.
                       Treiber: `pg`. Keine DB-Spezialfunktionen im Fachcode.
packages/server/       HTTP (node:http + kleiner Router, kein Framework nötig), Auth, Rechte-Kette,
                       WebSocket-Hub (`ws`), Scanner-Gateway, PDF (pdfkit), QR (qrcode), Backup, CLI `lager`.
packages/client/       API-Client, Live-Store (React-Hooks), Offline-Puffer, Deep-Link-Helfer. Von beiden Apps genutzt.
packages/ui/           Gemeinsame React-Komponenten + CSS-Variablen (Planer-Stil), Themes, Dichten.
packages/station-web/  Browser-UI für Lager-Arbeitsplätze (R-11a–g) und Ladezonen-Anzeige (R-59). Vom Server ausgeliefert.
e2e/                   Playwright-Tests T-01…T-24 + Integrations-Szenarien über beide Apps.
deploy/                docker-compose.yml (caddy, server, postgres), Caddyfile, .env.beispiel, Betriebsanleitung.
scripts/               spec-abdeckung.js, db-test.sh, seed.js (5.000 Geräte / 500 Projekte für NFA-05).
```

### Materialplaner / Productionplaner (je ein Repo, gleicher Aufbau wie Netzwerkplaner)
```
core/                  Git-Submodule → Planer-Lager-Core (fester Commit)
src/main/              Electron-Hauptprozess: Fenster, Deep-Links, safeStorage für Token, Updater, Druck
src/preload/           contextBridge
src/renderer/          React-Oberfläche, Tabs je Modul
scripts/build.js       esbuild → dist-app/index.html (Single-File). Alias `@lager/*` → `${LAGER_CORE_DIR:-core}/packages/*`
test/                  App-spezifische Unit-Tests
```
- Entwicklung in der Session: Core liegt als eigenes Repo daneben. `LAGER_CORE_DIR` zeigt dorthin, damit Änderungen sofort greifen.
- Nach Core-Änderung: Submodule-Zeiger in beiden Apps aktualisieren und mit-committen.

## 3. Server

- **API**: `/api/v1/<ressource>`. Die Pfade aus Spec Kap. 7 bleiben als Ressourcennamen (`/projekte/:id/packen` → `POST /api/v1/projekte/:id/scan` usw.). JSON-Antworten wie Spec 7.2 (Scan-Antwort exakt: `level, text, meldungen[], tasche, code, artikel_id, ist_case, projekt, weiter`).
- **Rechte (R-01–R-05)**: Route-Registry. Jede Route deklariert `bereich` + `stufe` (r/w). Nicht registriert → nur Admin. Test prüft: jede Route hat einen Bereich. Bereich `start` = jeder angemeldete Nutzer.
- **Auth**: Benutzer mit Passwort (scrypt aus node:crypto), R-08 Sperre, R-09 Regeln, R-10 12 h gleitend. Electron-Apps: Bearer-Token (in `safeStorage`). Browser-Arbeitsplatz: HttpOnly-Cookie + CSRF-Token. **FA-54 TOTP ist P1** (Server im Internet): Pflicht für Admins, optional für andere.
- **Arbeitsplatz-Konten**: langlebiges Gerätetoken, Rolle „Lager-Arbeitsplatz“, Sperrbildschirm + Mitarbeiter-PIN (R-11a–g). Anzeige-Bildschirm: eigenes Token, nur Bereich `anzeige`.
- **Live-Events**: Nach jeder Buchung sendet der Hub `{typ, id, version, bereich}` (z. B. `geraet.geaendert`, `projekt.geaendert`, `angebot.geaendert`, `zone.geaendert`, `scan.ergebnis`). Clients laden betroffene Ansichten nach. Nur an Nutzer mit Leserecht auf den Bereich.
- **Transaktionen**: Jede Buchung (Scan, Verladen, Rückgabe, Bestellung, Lieferung) in einer DB-Transaktion (NFA-06). Bewegungen und Sicherheitsereignisse nur anfügen (DB-Rechte oder Trigger verhindern UPDATE/DELETE).
- **Dateien**: `/data/projekte/<Nummer Name>/{Angebote,Rechnungen,Dokumente}`, Jobs unter `Jobs/` (Spec 3.2). Auslieferung nach FA-33 (nosniff, Sandbox, SVG nie inline).
- **Sicherung (FA-49, NFA-04)**: `pg_dump` + `/data` als zip, geprüft (zip lesbar, Dump einspielbar), Aufbewahrung 14, „vor-wiederherstellung“ bleibt. Zweitort = zweites Volume oder S3-kompatibler Speicher. Sicherungen verschlüsselt (age oder AES-GCM), weil Cloud.
- **Sicherheit (NFA-01/02)**: CSP mit frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy, HSTS, Rate-Limits, CSV-Formelschutz, kein Caching angemeldeter Seiten. Server bindet hinter Caddy nur auf internes Netz.
- **Adresssuche**: Geoapify-Schlüssel nur serverseitig (Env), Fallback Photon. In Tests gemockt (NFA-08: ohne Netz).

## 4. Nahtlos-Integration der beiden Apps

1. **Ein Konto, einmal anmelden**: Login in App A. Wechsel zu App B per Deep-Link mit Einmal-Code (`handoff`, 60 s gültig, einmal einlösbar) → App B tauscht ihn gegen eigenes Token. Kein Passwort doppelt.
2. **Deep-Links** (Protokolle registrieren, Single-Instance-Lock, `open-url`/`second-instance`):
   - `materialplaner://geraet/LT-0001`, `materialplaner://projekt/<id>/packen`, `materialplaner://projekt/<id>/rueckgabe`, `materialplaner://material/<id>`
   - `productionplaner://projekt/P-2026-001`, `productionplaner://angebot/<id>`, `productionplaner://kunde/<id>`
   - Andere App nicht installiert → Hinweis + Lese-Ansicht in der eigenen App.
3. **App-Schalter** in der Kopfleiste beider Apps (gleiche Stelle, gleiches Symbol). Kontext bleibt erhalten: Aus Projekt in App B öffnet App A dasselbe Projekt.
4. **Globales Codefeld (FA-16)** in beiden Apps: Gerät → Materialplaner, Projekt → Productionplaner (Packen-Kontext → Materialplaner).
5. **Live-Querinfos**: Productionplaner zeigt Verfügbarkeit (R-24–27), Packfortschritt und Zone live. Materialplaner zeigt Projektkopf (Kunde, Termin, Status, Angebot) read-only + Link.
6. **Gleiche Bausteine** aus `@lager/ui`: Kopfleiste, Menü (UI-1), Meldungen (UI-2), Tabellen, Formulare (UI-4), Bestätigungen, Themes. Keine App baut eigene Varianten.
7. **Versionen**: Server meldet `GET /health` Protokollversion. Apps zeigen bei Unverträglichkeit klaren Hinweis + Update-Link.
8. **E2E-Pflicht**: Szenarien, die beide Apps durchlaufen (Angebot in Productionplaner annehmen → Materialplaner zeigt Packliste live → Verladen → Productionplaner zeigt „Läuft“), siehe PROGRESS Phase 12.

## 5. Scanner

- **BT/USB-HID (Tastatur-Emulation)** – Standardweg. Scan-Erkennung über Tempo (< 35 ms je Zeichen, ≥ 4 Zeichen, Abschluss Enter oder Tab). Ein globaler Listener in beiden Apps und im Arbeitsplatz-Web fängt Scans ab, auch wenn kein Feld den Fokus hat, und leitet sie ins Scan-Feld (UI-3). Präfix/Suffix und Schwellwerte einstellbar.
- **Netzwerk-Scanner** – Scanner-Gateway am Server:
  - TCP-Listener (Port per Env `SCANNER_TCP_PORT`, Standard 9101). Eine Zeile = ein Code (CR/LF). Zuordnung Scanner → Arbeitsplatz per Absender-IP oder Kennungs-Präfix. Im Internet nur über TLS-Tunnel/VPN, nicht offen.
  - HTTP: `POST /api/v1/scanner/eingang` mit Scanner-Token (für Scanner/Gateways mit HTTP-Push).
  - Ergebnis geht per WebSocket an den zugeordneten Arbeitsplatz (Farbe, Text, Ton). Verwaltung → „Scanner“ (anlegen, Token, Zuordnung, letzter Kontakt).
  - Tests simulieren Scanner mit TCP-Client und HTTP-Aufruf.
- **BT-SPP (seriell)** – P3, nur wenn Budget: `serialport` im Materialplaner.
- **Kamera (html5-qrcode)** – IST in der Spec, aber spät: nur Arbeitsplatz-Web, lokal ausgeliefert.
- **Android-APK** – ganz zuletzt (Phase Z): station-web per Capacitor verpacken (wie Stromplaner/webapp).

## 6. Cloud-Betrieb und Offline

- Deployment: `deploy/docker-compose.yml` (caddy mit automatischem HTTPS, server, postgres mit Volume). Host noch offen (VPS in DE/EU empfohlen). Env: `DATABASE_URL`, `PUBLIC_URL`, `DATA_DIR`, `GEOAPIFY_KEY`, `BACKUP_ZIEL`, `BACKUP_SCHLUESSEL`.
- Abweichung von Spec 1.2 Nr. 6 / NFA-02 (Daten beim Betrieb, nur 127.0.0.1): bewusst, siehe ENTSCHEIDUNGEN.md D-01. Darum FA-54, FA-56 und verschlüsselte Sicherungen schon in Phase 1.
- **Offline (FA-22, hochgestuft)**: Fällt die Verbindung aus, puffern Apps und Arbeitsplatz Scans lokal (IndexedDB) mit Zeitstempel und Mitarbeiter. Beim Wiederverbinden bucht der Server in Reihenfolge. Konflikte gehen als Gelb/Rot zurück. Anzeige „Offline – n Scans warten“.

## 7. Django-Begriffe der Spec → dieses System

| Spec (Django-Referenz) | Hier |
|---|---|
| `manage.py backup` / `restore <Datei>` / `sicherheitscheck --absichern` | CLI `lager backup`, `lager restore <Datei>`, `lager sicherheitscheck --absichern` (im Container) |
| `starten.command` (sichern, migrieren, starten) | Server-Start: Migrationen → Sicherung falls > 20 h → Listen |
| Django-Gruppen / Rolle | Tabelle `rolle` mit Rechte-JSON je Bereich (R-06) |
| URL-Regelliste REGELN | Route-Registry (siehe §3) |
| Server-Templates + reines JS | React in Electron-Apps und station-web |
| CSRF | nur für Cookie-Sitzungen (Arbeitsplatz-Web) |
| `/admin/`, R-11 | entfällt; Verwaltung in den Apps. R-11 als „/admin → Login“-Umleitung im Web umsetzen |
| `{% asset %}` (UI-8) | esbuild mit Hash im Dateinamen; Electron-Bundle ist versioniert |
| reportlab / qrcode / core/barcode.py | pdfkit / `qrcode` (SVG) / eigener Code-128-Encoder in `domain/barcode.js` |
| Decimal | Integer-Cent + Prozent als Ganzzahl in Hundertstel |
| Django TestCase + Testdatenbank-Datei | `node --test`, eigene PostgreSQL-Testdatenbank je Lauf, temporäre Ordner |
| gunicorn + Reverse-Proxy (FA-56) | Node-Server + Caddy (HTTPS), Docker restart-Policy, Healthcheck |
| SQLite | PostgreSQL 16 |
| Rechnungen (Kap. 11) | Nicht bauen. Nur Schnittstelle: Tabelle `rechnung_entwurf` + Positionen für R-66 und „Angebot → Rechnungsentwurf“ |

## 8. Tests

- **Unit** (domain): jede R-Regel ≥ 1 Test, Grenzfälle (Regex R-22/R-23/R-29, Rundung R-28, Überschneidung R-25).
- **API** (server): Server auf Zufallsport, eigene Test-DB, prüft Rechte (R-01–R-05), Transaktionen, Event-Versand.
- **E2E** (`e2e/`): `T-xx.spec.js` je Abnahmetest + `INT-xx.spec.js` für App-übergreifende Abläufe. Startet Testserver + beide Apps mit `_electron.launch`. Screenshots nach `e2e/artefakte/` (gitignored).
- **Leistung (NFA-05)**: `npm run seed -- --gross` + Messung Seitenaufruf/Scan < 1 s.
- **Abdeckung**: `npm run spec:abdeckung` listet IDs aus docs/spec/INDEX.md ohne Test.
- CI: GitHub Actions je Repo (Unit + API mit postgres-Service; E2E mit xvfb).

## 9. Build und Release

- Wie Geschwister-Apps: electron-builder, macOS dmg (arm64 + x64), Windows NSIS x64, unsigniert, electron-updater über GitHub Releases. Version in package.json + „Was ist neu?“.
- Server-Image: GitHub Actions baut Docker-Image (ghcr.io/nomisimo/planer-lager-server).
