# Zusatz-Anforderungen (Sam, 15.11.2026) – Phasen 16–20

Ergänzt die Entwickler-Anweisung. Eigene ID-Liste, wird von `npm run spec:abdeckung` zusätzlich zu INDEX.md gelesen.
Festlegungen im Detail: ARCHITEKTUR.md §10 (Browser), §11 (Tour), §12 (Gleichzeitiges Arbeiten); Entscheidungen D-105 ff.

## Phase 16 W – Browser-Version (beide Apps als Website vom Lager-Server)
Wer `https://<server>/materialplaner/` oder `/productionplaner/` öffnet, bekommt dieselbe App wie in Electron (gleiches Konto, Live-Sync, keine zweite Codebasis). Plattform-Unterschiede nur in `packages/ui/src/plattform.js` (einziger Ort mit `window.lagerShell`). Web-Login per HttpOnly-Cookie (Secure, SameSite=Lax, Pfad /) + CSRF-Token (`X-CSRF-Token` bei allem außer GET/HEAD). Übergang Desktop ↔ Browser per Handoff. Build `npm run build:web` → `dist-web/` (index.html ohne Inline-Script, gehashte Assets, Manifest + Icon). Auslieferung `/materialplaner/`, `/productionplaner/` (no-store, strenge CSP), `/` = Portal mit Kacheln nach Rechten, Quelle `WEB_APPS_DIR`, fehlt ein Bundle → 503 mit Text. Docker-Stufe baut beide Web-Apps.

- WEB-01 Login im Browser (Cookie-Sitzung, 2FA/R-08/R-10 gelten).
- WEB-02 Wechsel Materialplaner → Productionplaner im Browser ohne neue Anmeldung.
- WEB-03 Änderung im Browser-Productionplaner erscheint live im Desktop-Materialplaner.
- WEB-04 Etikett drucken im Browser öffnet ein Druckfenster mit der Seitengröße der Vorlage (`@page`), `window.print` gestubbt.
- WEB-05 Keine CSP-Fehler in der Konsole.
- WEB-06 Hash-Route überlebt Neuladen.
- WEB-07 Nicht angemeldet → Login, danach zurück zur Ursprungsseite.
- WEB-08 Funktionen „Nur in der Desktop-App“ (Kiosk, Direktdruck FA-14, BT-SPP, Ordner öffnen) sind im Browser verborgen bzw. so gekennzeichnet.
- WEB-09 Fehlt das CSRF-Token → 403 mit verständlichem Text (Ursache + nächster Schritt).
- WEB-10 Portal `/` zeigt nur Kacheln, für die die Rolle Rechte hat.
- WEB-11 `window.lagerShell` kommt außerhalb von plattform.js und packages/shell nirgends vor.
- WEB-12 Abmelden in einer Web-App meldet beide Web-Apps ab.
- WEB-13 „Im Browser öffnen“ aus der Desktop-App (Handoff → Cookie → gleiche Ansicht).
- WEB-14 Web-Bundle: index.html ohne Inline-Script, gehashte Assets dauerhaft cachebar, index no-store, Manifest vorhanden.
- WEB-15 Fehlt ein Web-Bundle, antwortet der Server 503 mit verständlichem Text.
- INT-01 bis INT-06 (App-übergreifend, ARCHITEKTUR §4, Phase 12): INT-01 INT-02 INT-03 INT-04 INT-05 INT-06.
- INT-07 INT-01 bis INT-06 laufen zusätzlich einmal in der Kombination Browser + Desktop.

## Phase 17 N – Nutzertests und gleichzeitiges Arbeiten
### Klick-Durchlauf (KLICK)
`e2e/klick-durchlauf.test.js` + `e2e/klick-helfer.js`, frische DB mit Demo-Daten (`--seed demo`). Je App (M, P, station-web) × Plattform (Electron, Browser) × Rolle (Admin, Lagerleitung, Lager, Projektleitung, Arbeitsplatz-Konto): jeden Menüeintrag und Tab öffnen, jeden Knopf/Klappmenü/Dialog-Öffner anklicken (Dialoge per Abbrechen/Esc schließen, buchende/löschende Knöpfe auch auslösen, Bestätigungen beide Wege), jedes Formular leer und gültig abschicken.
- KLICK-01 Alle Menüeinträge und Tabs je App × Plattform × Rolle besucht; Abdeckungsbericht `e2e/artefakte/klick-bericht.json`, Fehlschlag wenn ein Menüeintrag nie besucht wurde.
- KLICK-02 Kein `pageerror`, kein `console.error`, keine unbehandelte Promise, keine Server-Antwort ≥ 500.
- KLICK-03 Keine leere/weiße Seite, kein englischer Fehlertext, kein Stacktrace in der Oberfläche.
- KLICK-04 Jeder Knopf hat einen zugänglichen Namen (UI-7); bei 1280×800 und 1024×768 nichts außerhalb des Fensters oder überlappend.
- KLICK-05 Ladezeit je Seite unter 1 s (NFA-05); Formulare leer abgeschickt zeigen Pflichtfeld-Fehler (UI-4), gültig abgeschickt speichern.
- KLICK-06 Rechte: nicht erlaubte Menüeinträge/Knöpfe unsichtbar; direkter Aufruf der Hash-Route zeigt „Keine Berechtigung“.

### Arbeitstage als Nutzer (NUTZER)
`e2e/nutzer-*.test.js`, M und P gleichzeitig offen (eine davon im Browser), bei Bedarf Arbeitsplatz-Web, Bedienung nur über die Oberfläche; Scans per HID-Simulation und Netzwerk-Scanner (TCP). Je Szenario 3–5 Screenshots.
- NUTZER-01 Vom Anruf zum Angebot (Kunde per Adresssuche gemockt, Projekt + Job, Angebot mit Verfügbarkeit, Überbuchungshinweis, Rabatt, PDF, Fassung, annehmen).
- NUTZER-02 Packtag mit Fehlbedienungen (falscher Code, fremdes Projekt, gesperrtes Gerät, doppelter Scan, Case mit fehlendem Inhalt), Verladen, Zone frei, P zeigt „Läuft“.
- NUTZER-03 Rückgabe mit Schaden (aktive Tasche, Funktionstest, defekt → Reparatur, vermisst, Wieder-Auftauchen).
- NUTZER-04 Etiketten (Kategorie, Artikel, Geräte, Designer, Druck gestubbt, Bestellung, Lieferung, Scan des neuen Etiketts).
- NUTZER-05 Planung über die Woche (Kalender, Aufgaben, Planungszeit-Timer, Wechsel M ↔ P, CSV).
- NUTZER-06 Admin-Tag (Benutzer + Rolle, 2FA, Sperre, Sicherung + Wiederherstellung, Sicherheits-Check, Scanner).
- NUTZER-07 Offline im Lager (Verbindung weg beim Packen, weiterscannen, zurück, P sieht richtigen Stand).
- NUTZER-08 Neuer Mitarbeiter (erster Login, Willkommen + Tour, einfache Aufgabe nur mit dem Gezeigten).

### Freies Ausprobieren
Subagent `nutzer-tester` (`.claude/agents/nutzer-tester.md`, Personas, Bericht `e2e/artefakte/erkundung-<persona>.md` mit FEHLER/STOLPERSTEIN/GUT). Höchstens 3 Personas je Runde; erste Runde nach Phase 16, danach am Ende jeder Phase. Funde → `BUG-<n>` in BERICHT.md, erst roter Test, dann Fix (`fix(BUG-<n>): …`).

### Gleichzeitig arbeiten (GLEICH)
Optimistisches Sperren: Spalte `version` an Kunde, Projekt, Job, Angebot, Position, Artikel, Gerät, Aufgabe, Ladezone, Vorlage, Einstellungen, Benutzer, Rolle; jedes Speichern schickt `version`, Server `UPDATE … WHERE id AND version`, sonst 409 „Das hat gerade <Name> geändert (<Uhrzeit>). Deine Eingaben sind noch da. Lade die neue Fassung und übernimm deine Änderungen.“ mit `aktuell`. Logik zentral in `packages/db`. Oberfläche: Band bei Live-Änderung („[Neu laden] [Meine Eingaben behalten]“), Vergleich „Deine Werte | Aktuelle Werte“ beim 409, Löschen woanders → „Wurde von <Name> gelöscht“ + zurück zur Liste. Präsenz-Chips im Projektkopf (WebSocket-Hub, 30 s).
- GLEICH-01 Dasselbe Angebot in P-Desktop und P-Browser: zweites Speichern bekommt 409 + Vergleich, nichts verloren.
- GLEICH-02 Angebotsposition in P ändern, während M packt: Packliste in M aktualisiert sich live, Hinweis erscheint.
- GLEICH-03 Zwei Arbeitsplätze scannen dasselbe Gerät gleichzeitig: genau einer grün, der andere rot „ist bereits in Projekt …“, eine Bewegung.
- GLEICH-04 Projekt in P löschen, während es in M offen ist.
- GLEICH-05 Derselbe Nutzer in M-Desktop, P-Desktop und P-Browser gleichzeitig, alles synchron.
- GLEICH-06 Präsenz-Chips erscheinen und verschwinden.
- GLEICH-07 Jede PUT/PATCH-Route verlangt `version` (Route-Registry-Test).

## Phase 18 T – Einführungs-Tour
Engine `packages/ui/src/tour/Tour.jsx`, Schritte als Daten in `touren.js` (`anker` = `data-tour`, `art` weiter/klick/eingabe, `vor`, `recht`, `nurDesktop`, `nurWeb`), keine Seiteneffekte. Willkommen nach erster Anmeldung (Tour starten / Später / Nicht mehr anzeigen), serverseitig am Benutzer gespeichert. Hilfe-Seite mit Touren-Liste, Tastenkürzeln, Kurzanleitung. Touren je App + „Zusammenspiel“, kurze Tour im Arbeitsplatz-Web.
- TOUR-01 Willkommen genau beim ersten Login; nach „Nicht mehr anzeigen“ nie wieder, auch nicht in der anderen App.
- TOUR-02 Jeder Schritt jeder Tour findet seinen Anker (Admin, alle Touren).
- TOUR-03 Lager-Rolle sieht keine Admin-Schritte.
- TOUR-04 Tasten → ← Esc.
- TOUR-05 Tour ändert keine Daten.
- TOUR-06 Tour läuft auch im Browser.
- TOUR-07 Alle `anker` aus touren.js kommen als `tour="…"`/`data-tour="…"` im Code vor.

## Phase 19 R – README, Lizenz, Release
READMEs aller drei Repos (Aufbau wie Netzwerkplaner, nur Fertiges, jeder Befehl ausgeführt), Screenshots per `npm run screenshots` nach `docs/screenshots/`, Lizenz Apache-2.0 (LICENSE + NOTICE, package.json), Release je Phase ab 16 per `gh workflow run release.yml`, „Was ist neu?“ aus CHANGELOG.md und Update-Hinweis über GitHub-Releases.
- REL-01 Release-Workflow legt Tag + GitHub-Release mit Installern und `latest*.yml` an (beide Apps, gleiche Version).
- REL-02 „Was ist neu?“ zeigt den CHANGELOG-Abschnitt der laufenden Version.
- REL-03 Update-Hinweis erscheint, wenn auf GitHub eine neuere Version liegt.
- REL-04 LICENSE, NOTICE und `"license": "Apache-2.0"` in allen drei Repos.

## Phase S – Testserver (Oracle Cloud, Always Free)
Echter Testserver unter `https://<TEST_DOMAIN>`: Instanz und Netz per `oracle-infrastruktur.yml`, Grundeinrichtung per cloud-init, Image für ARM + AMD (`image.yml`), Bespielen (`deploy-test.yml`), Wartung (`wartung-test.yml`). Testmodus nur mit `LAGER_MODUS=test`. Tests gegen den echten Server: `npm run e2e:remote` (`LAGER_REMOTE_URL`).
- REMOTE-01 `/health`: Commit stimmt, gültiges Let's-Encrypt-Zertifikat, HSTS und alle Schutz-Header, HTTP → HTTPS.
- REMOTE-02 API-Login mit Testbenutzer, `wss://…/ws` durch Caddy, ein Live-Event kommt in unter 2 s an.
- REMOTE-03 `/`, `/materialplaner/`, `/productionplaner/`, `/station`, `/anzeige` werden ausgeliefert, Assets cachebar, CSP ohne Fehler.
- REMOTE-04 Beide Electron-Apps gegen den echten Server: Login, jeder Menüpunkt einmal, NUTZER-02 Packtag.
- REMOTE-05 Aktion `sicherung` → Prüfung ok; Wiederherstellung nach `zuruecksetzen` ergibt dieselben Zähler.
- REMOTE-06 Last: 20 parallele Scans auf verschiedene Geräte, jede Antwort unter 1 s, keine Doppelbuchung.
- REMOTE-07 Nach `zuruecksetzen` nur Demo-Daten, Band „TESTSYSTEM“ sichtbar.
- REMOTE-08 Neustart über `wartung-test.yml` → Daten bleiben erhalten (Volumes).
- REMOTE-09 Testmodus nur mit `LAGER_MODUS=test`: sonst Test-Token 401 und Test-Routen 404; ohne Token ≥ 32 Zeichen startet der Server nicht; Test-Token = Admin „claude-test“ (protokolliert), Benutzer-Cookie geht vor; noindex + robots.txt.
- REMOTE-10 Einmal-Zugang (`sam-zugang`): Admin mit Einmal-Passwort, beim ersten Login eigenes Passwort und 2FA, erneut ausführen = neues Passwort.
