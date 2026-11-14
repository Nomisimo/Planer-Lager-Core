# PROGRESS – Planer-Lager

Legende: `[ ]` offen · `[x]` fertig (Tests grün, committet) · `[~]` blockiert (Grund in ENTSCHEIDUNGEN.md)
Ort: **C** = Core (domain/db/server/ui/station-web), **M** = Materialplaner, **P** = Productionplaner
Reihenfolge = Spec Kap. 13, ergänzt um Cloud + Nahtlos. Immer den **ersten offenen** Punkt nehmen.
Hinter `[x]` kurz notieren: Datum, Repo(s), Testdatei(en). Max. 1 Zeile.

## Phase 0 – Gerüst
- [x] C: npm workspaces (domain, db, server, client, ui, station-web), esbuild, `node --test`, eslint-frei — 14.11., C, eslint.config.cjs
- [x] C: `scripts/db-test.sh` (PostgreSQL starten, Test-DB anlegen), Migrations-Runner, `npm test` grün mit 1 Dummy-Test — 14.11., C, packages/db/test/migrate.test.js
- [x] C: `scripts/spec-abdeckung.js` (IDs aus docs/spec/INDEX.md vs. Testnamen in allen 3 Repos) + `npm run spec:abdeckung`  — 14.11., C, lag im Kit, npm-Skript ergänzt
- [x] M+P: Electron-Gerüst wie Netzwerkplaner (main/preload/renderer, build.js mit Alias `@lager/*`, Splash), Core als Submodule `core/` — 14.11., M+P+C(@lager/shell, scripts/app-build.cjs), test/app-config.test.js
- [x] C: E2E-Rauchtest: Testserver + beide Apps starten unter `xvfb-run`, Screenshot je App — 14.11., C, e2e/rauchtest.test.js
- [x] C+M+P: GitHub-Actions CI (Unit+API mit postgres-Service, E2E mit xvfb) — 14.11., .github/workflows/ci.yml (Lauf unbestätigt, s. D-25)

## Phase 1 – Grundgerüst Server + App-Hüllen
- [x] C: Einstellungen (Spec 3.14, genau 1 Datensatz), FA-48 Grundteil — 14.11., C, domain/einstellungen.test.js, server/verwaltung.test.js
- [x] C: Rollen + Rechte 2.1, R-06, R-07, Route-Registry R-01, R-02, R-03 — 14.11., C, domain/rechte.test.js, server/auth+verwaltung.test.js
- [x] C: Anmeldung R-04, R-08, R-09, R-10, R-11; Verweigerung R-05; Sicherheitsprotokoll 3.15 — 14.11., C, server/auth.test.js (R-11 Web-Umleitung folgt mit station-web, Phase 8)
- [x] C: FA-54 TOTP (Pflicht Admin, hochgestuft wegen Cloud, D-01) — 14.11., C, domain/totp.test.js, server/auth.test.js
- [x] C: Sicherheits-Header + CSRF für Cookie-Sitzungen (NFA-01) — 14.11., C, server/health+auth.test.js, domain/csv.test.js
- [x] C: WebSocket-Hub + Live-Events, `GET /health` mit Protokollversion — 14.11., C, server/hub.test.js, health.test.js
- [x] C: `@lager/ui`: Themes FA-52, UI-6, UI-7, Dichten, Bausteine aus docs/UI-STIL.md — 14.11., C, ui/test/ui.test.js (Kontrast aller 8 Themen geprüft)
- [x] M+P: App-Hülle: Login, Kopfleiste, Seitenmenü UI-1 (nur erlaubte Einträge, aktiver Eintrag nach längstem Präfix), Online-Status — 14.11., C(ui/huelle.jsx)+M+P, e2e/huelle.test.js
- [x] M+P: Deep-Links, Single-Instance, Handoff-Login, App-Schalter (ARCHITEKTUR §4.1–4.3) — 14.11., C+M+P, shell/test/deeplink.test.js, e2e/huelle.test.js (INT-01)
- [x] C: UI-2 Rückmeldungs-Bausteine (Farbe + Symbol + Text), UI-4 Formular-Verhalten, UI-5 Textregeln als Hilfsfunktionen + Test — 14.11., C, ui/test/ui.test.js
- [x] C+M+P: UI-8 Versionskennung der Assets (Hash im Dateinamen) für station-web; Electron-Bundle versioniert — 14.11., C, server/test/statisch.test.js; Apps: meta lager-build + dist-app/build.json

## Phase 2 – Stammdaten
- [x] C: Kategorie 3.6 (Präfix-Vorschlag, letzte_nummer nur steigend) — 14.11., C, domain/codes.test.js, server/stammdaten.test.js
- [x] C: Artikel 3.7 inkl. Artikeltyp-Ableitung — 14.11., C, domain/geraet.test.js, server/stammdaten.test.js
- [x] C: Gerät 3.8, Codes R-21, Normalisierung R-22, Bewegung 3.9, R-16, R-17, R-18, R-19 (IST), R-30 (= R-18, D-15) — 14.11., C, domain/codes+geraet.test.js, server/stammdaten.test.js (R-19 SOLL gleich mit, D-37)
- [x] C: Prüfstatus 5.10 (Monatsende!) — 14.11., C, domain/geraet.test.js, server/stammdaten.test.js
- [x] M: FA-01 Materialliste, FA-02 Artikel anlegen/bearbeiten/löschen, R-71, R-72 — 14.11., C+M, e2e/material.test.js (R-72 „bestellen“ folgt mit R-67 in Phase 3)
- [x] M: FA-03 Geräteliste + Detail, FA-04 Verbrauchsbestand, FA-05 Reservierungen je Artikel — 14.11., C+M, e2e/material.test.js (FA-05-Daten kommen mit Verfügbarkeit Phase 5, Anzeige vorbereitet)
- [x] C+P: Kunde 3.1, FA-26 (IST-Teil), FA-27 PDF-Formular + Import mit Dublettenprüfung, Adresssuche (gemockt im Test) — 14.11., C+P, domain/kunden.test.js, server/kunden.test.js, e2e/kunden.test.js

## Phase 3 – Etiketten
- [x] C: QR (SVG), eigener Code-128-Encoder + Tests — 14.11., C, domain/etiketten.test.js
- [x] C+M: Etiketten-Vorlagen 3.13, FA-10 Druck, FA-11 Designer — 14.11., C+M, server/etiketten.test.js, e2e/etiketten.test.js
- [x] C+M: Kabel 3.12, R-29, R-29a, FA-12 — 14.11., C+M, server/etiketten.test.js, e2e/etiketten.test.js
- [x] C+M: Etiketten-Bestellung R-67, R-68 (PDF + CSV „ohne Bindestrich“), R-69, R-70, FA-13, Zustand 4.4 — 14.11., C+M (R-72 „bestellen“ jetzt aktiv)
- [x] C+M: Kabel-Assistent R-73 — 14.11., C+M
- [x] E2E: T-01, T-02, T-03 — 14.11., e2e/etiketten.test.js

## Phase 4 – Projekte, Jobs, Aufgaben, Dateien, Kalender
- [x] C: Projekt/Job 3.2, R-20, Zustände 4.1, R-12, R-13, R-14 (Hook `nachVerladen`), Projektordner — 14.11., C, domain/projekt.test.js, server/projekte.test.js
- [x] P: FA-29 Liste + Detail mit Kopfkennzahlen, FA-30 anlegen/bearbeiten/Jobs anlegen, FA-31 duplizieren — 14.11., C+P, e2e/projekte.test.js (Angebotswert netto = 0 bis Phase 5)
- [x] C+P: Aufgaben 3.4, FA-32 (inkl. globale Liste) — 14.11., C+P
- [x] C+P: Dateien 3.3, FA-33 (Typ/Größe, sichere Auslieferung) — 14.11., C+P
- [x] P: FA-34 Kalender — 14.11., C+P
- [x] E2E: T-19, T-24 — 14.11., e2e/projekte.test.js + server/projekte.test.js

## Phase 5 – Angebote, Verfügbarkeit, Packliste
- [x] C: Angebot/Position/Fassung 3.11, Zustand 4.2, Fassungen + PDF-Archiv — 14.11., C, server/angebote.test.js (Angebotswert + Reiter Angebote im Projekt gefüllt)
- [x] C: Verfügbarkeit R-15, R-24, R-25, R-26, R-27 — 14.11., C, domain/angebot.test.js, server/angebote.test.js
- [x] C: Preise R-28, R-28a, R-28b, R-28c (FA-41-Beispiel = 50,00 € als Test) — 14.11., C
- [x] P: FA-41 Angebotseditor, FA-42 Überbuchungshinweis, FA-43 Statuswechsel, FA-45 Kalkulator + Zeitrechner — 14.11., C+P, e2e/angebote.test.js
- [x] C+P+M: Packliste R-51, R-52, R-53, R-54, FA-44 (Bildschirm + PDF) — 14.11., C+P (Materialplaner-Packen nutzt sie in Phase 6)
- [x] E2E: T-04, T-05 — 14.11., e2e/angebote.test.js

## Phase 6 – Scannen, Packen, Verladen, Scanner
- [x] C: Scan-Algorithmus Spec 5.5 komplett (Schritte 1–9, eine Transaktion), R-23, R-70 im Scan — 14.11., C, server/scannen.test.js (Rückgabe/Tasche R-46 im Kern schon enthalten)
- [x] C: Scan-API 7.2 (`/api/scan`, `/api/pruefung`, `/api/vermisst`), FA-19 Status-API — 14.11., C, server/scannen.test.js
- [x] C+M: HID-Scanner-Erkennung (ARCHITEKTUR §5) + UI-3 — 14.11., domain/scannen.test.js, e2e/scannen.test.js
- [x] C: Netzwerk-Scanner-Gateway (TCP + HTTP), Verwaltung „Scanner“, Zuordnung zu Arbeitsplatz — 14.11., server/scanner.test.js (FK auf Arbeitsplatz folgt Phase 8)
- [x] M: FA-15 Scan-Seite, FA-16 globales Codefeld (auch P), FA-17 Packansicht live — 14.11., e2e/scannen.test.js
- [x] C+M: Verladen R-60, R-61 — dabei `nachVerladen` (R-14) aus server/src/projekte.js aufrufen
- [x] E2E: T-07, T-08, T-09, T-10, T-11 — 14.11., e2e/scannen.test.js (T-06 braucht Ladezonen → Phase 8)

## Phase 7 – Rückgabe
- [ ] C: R-46 Taschen, R-47 Funktionstest, R-48, R-49, R-50
- [ ] M: FA-18 Rückgabeansicht + freie Rückgabe am Arbeitsplatz
- [ ] E2E: T-12, T-13, T-14, T-15

## Phase 8 – Ladezonen, Arbeitsplätze, Anzeige
- [ ] C: Ladezone 3.10, R-55, R-56, R-57, R-58 (darf Login nie verhindern), R-59
- [ ] M: FA-23 Zonen verwalten + Prioritätsliste, FA-24 Anzeige
- [ ] C: station-web: R-11a, R-11b, R-11c, R-11d, R-11e, R-11f, R-11g, HTTP 423
- [ ] M: FA-25 Arbeitsplätze + Mitarbeiter verwalten, Kiosk-Modus
- [ ] E2E: T-06 (aus Phase 6 verschoben), T-16, T-21

## Phase 9 – Planungszeit
- [ ] C: Zeiteintrag 3.5, R-62, R-63, R-64, R-65, R-66 + Schnittstelle Rechnungsentwurf (Kap. 11)
- [ ] P: FA-46 Timer, Nachbuchen, Auswertung, CSV
- [ ] E2E: T-20

## Phase 10 – Suche, Startseite, Verwaltung, Sicherung
- [ ] C+M+P: FA-36 Suche (nur was die Rolle sehen darf)
- [ ] M+P: FA-35 Startseite (je App passende Kacheln)
- [ ] C+M+P: FA-47 Benutzer/Rollen, FA-48 Einstellungen komplett, FA-50 Sicherheit, FA-51 System
- [ ] C: FA-49 Sicherung (pg_dump + Dateien, Prüfung, Aufbewahrung, Zweitort, Auto beim Start), `lager restore`
- [ ] C+M: FA-53 Plan-Symbole yEd (graphml + SVG-zip)
- [ ] C: NFA-03 Löschkonzept Kundendaten
- [ ] E2E: T-17, T-18, T-22, T-23 (IST-Teil)

## Phase 11 – Cloud-Betrieb, Offline, Leistung
- [ ] C: `deploy/` docker-compose (caddy, server, postgres), Healthcheck, FA-56, NFA-02 (HTTPS/HSTS/Secure-Cookies)
- [ ] C: Verschlüsselte Sicherungen + Wiederherstellungstest (NFA-04)
- [ ] C+M+P: FA-22 Offline-Puffer (hochgestuft) inkl. Anzeige wartender Scans
- [ ] C: NFA-05 Leistung mit Seed 5.000 Geräte / 500 Projekte, N+1 vermeiden
- [ ] C: NFA-06, NFA-07, NFA-08, NFA-09 prüfen und belegen

## Phase 12 – Nahtlos (App-übergreifende E2E)
- [x] INT-01 Login in P, Wechsel nach M ohne erneute Anmeldung — 14.11., e2e/huelle.test.js
- [ ] INT-02 Angebot in P annehmen → Packliste in M erscheint live ohne Neuladen
- [ ] INT-03 Packen + Verladen in M → P zeigt „Läuft“ + Zone frei live
- [ ] INT-04 Codefeld in P mit Gerätecode → öffnet M beim Gerät; Codefeld in M mit Projektcode → öffnet P
- [ ] INT-05 Netzwerk-Scanner bucht → Arbeitsplatz-Web + M + P aktualisieren sich
- [ ] INT-06 Offline: Verbindung trennen, 5 Scans, wiederverbinden → alle gebucht, Reihenfolge stimmt

## Phase 13 – SOLL P2
- [ ] FA-06 Inventur (M) · [ ] FA-07 Reparatur/Wartung (M) · [ ] FA-20 Teilrückgabe/Nachpacken (M)
- [ ] FA-21 Lieferschein + Rückgabeprotokoll PDF (C+M) · [ ] FA-37 Personalplanung (P) · [ ] FA-38 Fahrzeuge (P)
- [ ] FA-55 Änderungsprotokoll (C) · [x] R-19 SOLL + T-23 Teil 2 (14.11., mit Phase 2) · [ ] FA-49 SOLL Wiederherstellung in der Oberfläche

## Phase 14 – SOLL P3 + Rest
- [ ] FA-08 Lagerorte · [ ] FA-09 Schadensdoku · [~] FA-14 Direktdruck Etikettendrucker (Druckdialog mit Maßen aus Vorlage gebaut, D-46; Test mit echtem Gerät braucht Hardware)
- [x] FA-26 SOLL Dublettenwarnung manuell (14.11., mit Phase 2) · [ ] FA-28 Ansprechpartner + Historie
- [ ] FA-39 Projektvorlagen · [ ] FA-40 Wiederkehrende Aufgaben + Benachrichtigungen (E-5: Standard = In-App + E-Mail per SMTP-Env)
- [ ] Kamera-Scan (FA-15-Teil, html5-qrcode lokal, nur Arbeitsplatz-Web)
- [ ] BT-SPP-Scanner (serialport, M)

## Phase 15 – Abschluss
- [ ] Volle Suite grün in allen 3 Repos, `spec:abdeckung` = 0 fehlend
- [ ] `spec-pruefer` Endabnahme über alle Kapitel, Befunde behoben
- [ ] `ui-pruefer` alle Hauptseiten beider Apps in Hell + Dunkel + 1 weiteres Thema
- [ ] BERICHT.md final (was geprüft, was nicht – z. B. kein echter Scanner, kein echter Drucker)
- [ ] Release-Builds per CI lauffähig (Tag setzt der Nutzer, Proxy erlaubt keine Tag-Pushes)

## Phase Z – nur wenn Budget übrig
- [ ] Android-APK: station-web per Capacitor (wie Stromplaner/webapp), HID-Scanner + Kamera
