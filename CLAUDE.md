# Planer-Lager – Projektregeln (gilt für alle 3 Repos)

Verleih-/Eventtechnik-Betrieb: Material, Lager, Projekte in einem System. Teil der Planer-Familie (Stromplaner, Netzwerkplaner).
Neubau von Grund auf. Ziel: **alle** Anforderungen der Spec (IST + SOLL P1/P2/P3) gebaut, getestet, fehlerfrei.

## Repos (alle in dieser Session)
- `Planer-Lager-Core` – Fachlogik, DB, Cloud-Server, gemeinsame UI, Arbeitsplatz-Web, E2E-Tests. **Hier liegen PROGRESS.md, ENTSCHEIDUNGEN.md, BERICHT.md, docs/.**
- `Materialplaner` – Electron-App: Material, Geräte, Etiketten, Kabel, Scannen, Packen, Rückgabe, Ladezonen, Arbeitsplätze, Inventur, Reparatur.
- `Productionplaner` – Electron-App: Kunden, Projekte/Jobs, Angebote, Aufgaben, Dateien, Kalender, Planungszeit, Personal, Fahrzeuge.
- Verwaltung (Benutzer, Rollen, Sicherung, Sicherheit) in beiden Apps, nur für Admins.

## Pflicht-Lektüre (nur bei Bedarf, nie alles auf einmal)
- `docs/spec/INDEX.md` → welche Spec-Datei welche IDs enthält. **Nur die nötige Datei lesen. Nie die PDF.**
- `docs/ARCHITEKTUR.md` → Stack, Ordner, Django→Node-Abbildung, Nahtlos-Integration, Scanner, Cloud.
- `docs/UI-STIL.md` → Planer-Designsprache.
- `PROGRESS.md` → nächster offener Punkt. `ENTSCHEIDUNGEN.md` → getroffene Annahmen.

## Kernentscheidungen (fest)
- **Ein zentraler Cloud-Server** (Node 22, PostgreSQL 16, Docker + Caddy/HTTPS). Beide Apps und Arbeitsplatz-Browser sind Clients. Kein eingebetteter Server, keine lokale Haupt-DB.
- Electron + React 18 + esbuild (Single-HTML-Bundle) wie Netzwerkplaner. Plain JS (ESM) + JSDoc, kein TypeScript.
- Beide Apps laufen als Electron-App UND im Browser (vom Lager-Server ausgeliefert). Gemeinsamer Code, Plattform-Unterschiede nur in `@lager/ui/plattform.js`.
- Tests: `node --test`. E2E: Playwright `_electron` unter `xvfb-run`. Keine Playwright-Browser laden.
- Geld: **Integer-Cent**, kaufmännisch runden (eigener Helper). Nie float für Beträge.
- Zeit: Europe/Berlin, Anzeige TT.MM.JJJJ.
- UI-Sprache Deutsch, Du-Form, Fehlertext = Ursache + nächster Schritt (UI-5).
- Scanner: externe BT/USB-HID-Scanner (Tastatur) + Netzwerk-Scanner (TCP/HTTP-Gateway am Server). Kamera-Scan zuletzt. Android-APK erst ganz am Ende, wenn Budget übrig.

## Nahtlos (harte Anforderung)
Beide Apps fühlen sich wie ein Produkt an: gleiches Konto, Login nur einmal (Handoff), Live-Updates per WebSocket ohne Neuladen, Deep-Links zwischen den Apps, globales Codefeld öffnet Gerät/Projekt in der zuständigen App, gleiche Kopfleiste und Komponenten aus `core/packages/ui`. Details: ARCHITEKTUR.md §4.

## Arbeitsweise (autonom)
- Skill `umsetzen` = Arbeitsschleife. Folge ihr ohne Rückfrage, Punkt für Punkt aus PROGRESS.md.
- Unklar oder `[ENTSCHEIDUNG]`? Spec-Standard nehmen, in ENTSCHEIDUNGEN.md eintragen, weitermachen. **Nicht anhalten, um zu fragen.**
- Blockiert (z. B. Netz, Hardware)? Eintragen, Punkt als `[~]` markieren, nächsten Punkt nehmen.
- Fertig erst, wenn: alle Punkte `[x]`, `npm run spec:abdeckung` meldet 0 fehlende IDs (INDEX.md + ZUSATZ.md), alle Unit-, API- und E2E-Tests grün, **GitHub-CI in allen drei Repos grün** (nach jedem Push `gh run list -R Nomisimo/<Repo> -L 3` prüfen; rot oder > 30 min → Log ansehen, beheben), ein veröffentlichtes Release mit Installern, vollständige READMEs, BERICHT.md ehrlich aktualisiert.
- Jeder Test trägt die Spec-ID im Namen: `test("R-22 normalisiert lt1 zu LT-0001", …)`.
- Commit nach jedem erledigten Punkt, je betroffenem Repo. Nachricht: `feat(R-22): …` / `fix(T-09): …`. Push auf den Session-Branch.

## Token sparen (Wochenlimit!)
- Chat-Antworten: Skill `caveman` ist Standard. Code, Kommentare, Commits, Doku: normales Deutsch.
- Datei nicht erneut lesen, die du gerade geschrieben hast. Mit `rg -n` suchen, gezielt Zeilenbereiche lesen.
- Testausgabe kurz: `npm test 2>&1 | tail -n 40`. Nur Fehler genauer ansehen.
- Routinearbeit an Subagents (Modell sonnet): `tester` (Suiten laufen lassen, Fehler zusammenfassen), `ui-pruefer` (Screenshots), `spec-pruefer` (unabhängige Abnahme je Phase). Kernlogik selbst schreiben.
- Keine neuen Pakete ohne Grund (Spec 1.4). Keine großen Downloads.
- Nach jeder Phase: PROGRESS.md aktuell, dann `/compact`.

## Befehle (Core)
- `npm test` – Unit + API (braucht laufendes PostgreSQL, siehe `scripts/db-test.sh`)
- `npm run e2e` – Playwright-Electron gegen Testserver (`xvfb-run -a`)
- `npm run spec:abdeckung` – vergleicht Test-IDs mit docs/spec/INDEX.md
- `npm run dev:server` – Server lokal auf :8080 mit Testdaten (`npm run seed`)
