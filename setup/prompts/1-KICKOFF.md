Projekt Planer-Lager: Wir bauen von Grund auf zwei Electron-Apps (Materialplaner, Productionplaner) plus einen zentralen Cloud-Server, mit ALLEN Features der Entwickler-Anweisung (IST + SOLL P1–P3). In dieser Session sind drei Repos: Planer-Lager-Core, Materialplaner, Productionplaner.

So gehst du vor:
1. Lies Planer-Lager-Core/CLAUDE.md. Lies docs/ARCHITEKTUR.md und docs/UI-STIL.md je einmal. Lies die Spec NIE komplett, nur gezielt über docs/spec/INDEX.md (Skill `spec`).
2. Aktiviere den Skill `caveman` für deine Chat-Antworten (Deutsch). Code, Kommentare, Commits und Doku schreibst du normal.
3. Finde heraus, wo die drei Repos in der VM liegen. Setze LAGER_CORE_DIR auf den Core-Pfad und trage den Pfad in CLAUDE.md unter „Befehle (Core)“ ein.
4. Prüfe die Umgebung: `node -v`, `psql --version`, `which xvfb-run`, `ls $ELECTRON_CACHE`, `bash scripts/db-test.sh`. Fehlt etwas: `bash setup/umgebung/setup-script.sh`, sonst einzeln installieren und trage es in ENTSCHEIDUNGEN.md ein (Setup-Script muss angepasst werden).
4b. Ist das Repo Netzwerkplaner auch in der Session, dann ist es nur Vorlage (dort nichts ändern): Übernimm scripts/build.js, das main/preload-Gerüst, src/shared/constants.js und src/renderer/ui.jsx als Startpunkt für @lager/ui und die App-Hüllen, statt alles neu zu schreiben.
5. Arbeite direkt auf dem Branch `main` aller drei Repos (neue Repos, kein PR-Ablauf). Committe und pushe nach jedem erledigten Punkt.
6. Starte jetzt den Skill `umsetzen` mit Phase 0 aus PROGRESS.md und arbeite die Phasen der Reihe nach ab, ohne mich zu fragen. Bei Unklarheiten: Spec-Standard nehmen, in ENTSCHEIDUNGEN.md eintragen, weitermachen.
7. Nutze die Subagents `tester`, `spec-pruefer` und `ui-pruefer` (laufen auf Sonnet) für Testläufe, Abnahmen und Screenshots, damit dein Kontext und mein Token-Budget geschont werden.
8. Du läufst auf Opus 5.5. Mein Wochenlimit (noch 65 %) setzt sich Sonntag 16.11. um 07:00 zurück. Arbeite sparsam: keine unnötigen Dateilesungen, kurze Testausgaben, Routine an Subagents. Halte PROGRESS.md und BERICHT.md immer so aktuell, dass eine neue Session sofort weitermachen kann.

Fertig bist du erst, wenn alle Punkte in PROGRESS.md erledigt sind, `npm run spec:abdeckung` 0 fehlende IDs meldet, alle Unit-, API- und E2E-Tests in allen drei Repos grün sind und BERICHT.md ehrlich sagt, was nicht geprüft wurde.
