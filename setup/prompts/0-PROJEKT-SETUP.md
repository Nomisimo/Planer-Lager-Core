Du richtest das Projekt "Planer-Lager" komplett selbst ein und beginnst danach mit der Entwicklung. Ich (Sam) bin technisch nicht tief drin: Frag mich nur, wenn du ohne mich wirklich nicht weiterkommst, und erklär mir dann in einfachen Sätzen, was ich klicken soll.

Ausgangslage:
- In dieser Session sind die Repos Nomisimo/Planer-Lager-Core, Nomisimo/Materialplaner und Nomisimo/Productionplaner. Materialplaner und Productionplaner sind leer. Optional ist auch Nomisimo/Netzwerkplaner dabei, als reine Vorlage.
- Ich habe das Setup-Kit (CLAUDE.md-Dateien, Spec in Abschnitten, Skills, Subagents, PROGRESS.md, ENTSCHEIDUNGEN.md, Scripts, Setup-Script unter `setup/`, Prompts) per Terminal schon in die drei Repos gepusht. Falls stattdessen nur eine Datei Planer-Lager-Kit.zip in Planer-Lager-Core liegt, verteile sie wie in Schritt A beschrieben.

Schritt A – Kit prüfen (und nur falls nötig verteilen)
0. Finde die Pfade der Repos in der VM (`ls`, `git -C <pfad> remote -v`). Gibt es Planer-Lager-Core/CLAUDE.md und Planer-Lager-Core/setup/ schon, dann überspringe 1.–5. und mach bei 6. weiter.
1. (nur mit ZIP) Pfade wie oben.
2. Entpacke Planer-Lager-Kit.zip in einen temporären Ordner außerhalb der Repos.
3. Kopiere den Inhalt von `Planer-Lager-Kit/Planer-Lager-Core/` in das Repo Planer-Lager-Core, `Planer-Lager-Kit/Materialplaner/` in Materialplaner und `Planer-Lager-Kit/Productionplaner/` in Productionplaner. Versteckte Ordner (.claude, .gitignore) mitkopieren.
4. Kopiere zusätzlich `Planer-Lager-Kit/umgebung/`, `Planer-Lager-Kit/prompts/` und `Planer-Lager-Kit/ANLEITUNG.md` nach `Planer-Lager-Core/setup/`.
5. Lösche Planer-Lager-Kit.zip aus dem Repo.
6. Prüfe: In Planer-Lager-Core gibt es CLAUDE.md, PROGRESS.md, docs/spec/INDEX.md, .claude/skills/umsetzen/SKILL.md und .claude/agents/tester.md. `node scripts/spec-abdeckung.js` zeigt 166 IDs.
7. Hast du etwas geändert, committe in jedem betroffenen Repo auf `main` (`chore: Claude-Projekt-Setup`) und pushe.

Schritt B – Werkzeuge in der VM
1. Prüfe `which xvfb-run`, `psql --version` und `ls ${ELECTRON_CACHE:-/root/.cache/electron}`.
2. Fehlt etwas, führe `bash Planer-Lager-Core/setup/umgebung/setup-script.sh` aus (läuft als root, dauert ein paar Minuten). Setze für diese Session die Variablen aus `setup/umgebung/umgebungsvariablen.env` (export).
3. `bash scripts/db-test.sh` im Core muss PostgreSQL bereit melden. Ein kurzer Test `xvfb-run -a <electron> --no-sandbox --version` muss eine Version ausgeben.
4. Lief das Setup-Script hier von Hand, dann sag mir am Ende in 3 einfachen Sätzen, wie ich es einmalig in den Umgebungs-Einstellungen von claude.ai/code eintrage (Setup script + Umgebungsvariablen). Dann starten künftige Sessions schneller. Bis dahin führst du es bei Bedarf in jeder neuen Session selbst aus.

Schritt C – Entwicklung starten
Lies jetzt `Planer-Lager-Core/setup/prompts/1-KICKOFF.md` und befolge ihn vollständig. Ab hier arbeitest du autonom nach dem Skill `umsetzen`, ohne mich zu fragen. Annahmen trägst du in ENTSCHEIDUNGEN.md ein.

Wichtig:
- Du läufst auf Opus 5.5. Mein Wochenbudget (noch 65 %) setzt sich Sonntag 16.11. um 07:00 zurück. Arbeite sparsam: Chat knapp (Skill caveman), Spec nur gezielt über docs/spec/INDEX.md lesen, Testläufe und Prüfungen an die Subagents auf Sonnet geben.
- Halte PROGRESS.md und BERICHT.md immer aktuell, damit jede neue Session mit „weiter“ sofort anschließen kann.
- Schreib mir nach Schritt A und B eine kurze Statusmeldung (was eingerichtet ist, was ich noch tun kann), dann geh direkt in Schritt C.
