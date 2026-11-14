# Planer-Lager: Cloud-Session einrichten (ca. 15 Minuten)

Inhalt dieses Kits:
```
Planer-Lager-Core/   → Inhalt für Repo Nomisimo/Planer-Lager-Core (CLAUDE.md, Spec in Häppchen, Skills, Subagents, PROGRESS …)
Materialplaner/      → Inhalt für Repo Nomisimo/Materialplaner (CLAUDE.md, .gitignore)
Productionplaner/    → Inhalt für Repo Nomisimo/Productionplaner (CLAUDE.md, .gitignore)
umgebung/            → Setup-Script + Umgebungsvariablen für die Cloud-Umgebung
prompts/             → 1-KICKOFF (erste Nachricht), 2-WEITER (nach Pausen), 3-ENDSPURT (vor Budget-Ende)
```

## 1. Drei Repos auf GitHub anlegen
Unter **Nomisimo**, leer (ohne README): `Planer-Lager-Core`, `Materialplaner`, `Productionplaner`.

## 2. Kit hineinlegen
```bash
unzip Planer-Lager-Kit.zip && cd Planer-Lager-Kit
for r in Planer-Lager-Core Materialplaner Productionplaner; do
  (cd "$r" && git init -b main && git add -A && git commit -m "chore: Claude-Setup" \
   && git remote add origin "https://github.com/Nomisimo/$r.git" && git push -u origin main)
done
```
(Oder: Sag mir Bescheid, sobald die leeren Repos existieren, dann pushe ich das Kit selbst.)

## 3. Cloud-Umgebung anlegen
claude.ai/code → Umgebung wählen → **Add cloud environment**:
- **Name:** `Planer-Lager`
- **Network access:** `Trusted` (npm, GitHub, Ubuntu-Pakete und Docker Hub sind drin)
- **Environment variables:** Inhalt von `umgebung/umgebungsvariablen.env` einfügen
- **Setup script:** Inhalt von `umgebung/setup-script.sh` einfügen

Das Script installiert xvfb und die Electron-Bibliotheken, richtet PostgreSQL ein und lädt Electron vorab. Danach wird alles ca. 7 Tage gecacht, und neue Sessions starten schnell.

**Falls Electron nicht lädt** (Hinweis „Electron-Download fehlgeschlagen“ im Setup-Log): Network access auf **Custom** stellen, „Also include default list“ anhaken, `npmmirror.com` und `cdn.npmmirror.com` eintragen und die Variable `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` ergänzen.

## 4. Optional: Skills in claude.ai einschalten
Cloud-Sessions laden automatisch die Skills, die du in claude.ai aktiviert hast. Empfehlenswert ist **frontend-design** (bessere Oberflächen). Caveman und die Projekt-Skills liegen schon im Repo, dafür musst du nichts tun.

## 5. Session starten
claude.ai/code → Umgebung `Planer-Lager` → Repos auswählen:
- `Planer-Lager-Core`, `Materialplaner`, `Productionplaner`
- **optional `Netzwerkplaner`** als Vorlage. Claude übernimmt dann Build-Script, Electron-Gerüst und UI-Bausteine, statt sie neu zu schreiben. Das spart viele Tokens.

Modell: **Opus 5.5** (die Subagents laufen automatisch auf Sonnet). Dann den Text aus `prompts/1-KICKOFF.md` als erste Nachricht senden.

## 6. Während es läuft
- Fortschritt siehst du jederzeit auf GitHub in `PROGRESS.md` und `BERICHT.md`, auch vom Handy aus.
- Hält die Session an (Turn zu Ende, VM pausiert), schick den Text aus `prompts/2-WEITER.md` (liegt nach dem Setup auch im Repo unter `setup/prompts/`). Mehr ist nicht nötig, weil der ganze Stand im Repo liegt.
- Etwa 2–3 Stunden vor Sonntag 07:00 schickst du `prompts/3-ENDSPURT.md`. So bleibt alles grün und sauber übergeben.
- Am Ende `ENTSCHEIDUNGEN.md` lesen: Dort steht jede Annahme, die Claude statt einer Rückfrage getroffen hat.

## 7. Token sparen (eingebaut)
- **Spec in 55 Häppchen** (`docs/spec/` + `INDEX.md`): Claude liest je Aufgabe nur 1–3 kleine Dateien statt 17 PDF-Seiten.
- **caveman** im Chat (Repo-Skill). Echte Ersparnis eher 15–25 % der Ausgabe, weil der Großteil Code ist. Code, Commits und Doku bleiben normal.
- **Subagents auf Sonnet** (`tester`, `spec-pruefer`, `ui-pruefer`): Testläufe, Abnahmen und Screenshots füllen nicht den Opus-Kontext.
- **PROGRESS.md als Gedächtnis**: Nach jeder Phase `/compact`, neue Sessions steigen ohne langes Einlesen ein.
- **Fertiges `spec-abdeckung.js`**: zeigt jederzeit, welche der 166 Spec-IDs noch keinen Test haben.
- Budget im Blick behalten (65 % übrig bei Start): Sinkt es schneller als die Phasen fertig werden, mit `/model` für UI-Fleißarbeit auf Sonnet 5.5 wechseln. Opus für Scan-Logik, Verfügbarkeit, Rechte und Sync behalten.

## 8. Gut zu wissen
- In einer Session mit mehreren Repos lädt die Cloud `CLAUDE.md`, `.claude/skills/` und `.claude/agents/` aller Repos. **Hooks und `.claude/settings.json` lädt sie dagegen nicht**, und Plugins werden in Cloud-Sessions nicht installiert. Darum liegt alles als Skill-Dateien im Repo, und Installationen macht das Setup-Script.
- Der GitHub-Proxy der Cloud lässt **keine Tag-Pushes** zu. Releases (`git tag v0.1.0 && git push --tags`) machst du selbst, dann bauen die GitHub Actions dmg und exe.
- Electron läuft in der VM als root, deshalb steht `ELECTRON_DISABLE_SANDBOX=1` in den Variablen. Das gilt nur für Tests, nicht für deine Builds.
- Echte Scanner, Drucker und Mac-/Windows-Builds kann Claude in der Cloud nicht testen. Das steht dann ehrlich im BERICHT.

## 9. Ehrliche Einschätzung zum Umfang
Alles inklusive P3 bis Sonntag ist sehr viel: etwa 70 Fachregeln, 56 Funktionen, 24 Abnahmetests, zwei Apps, ein Server. Die Reihenfolge in PROGRESS.md sorgt dafür, dass das Fertige stabil und getestet ist. Was nicht mehr reinpasst, liegt nächste Woche sauber als offene Punkte bereit, statt halbfertig über alles verteilt zu sein.
