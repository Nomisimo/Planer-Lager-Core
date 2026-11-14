---
name: umsetzen
description: Autonome Arbeitsschleife für Planer-Lager. Nimmt den nächsten offenen Punkt aus PROGRESS.md, baut ihn testgetrieben über Core und Apps, prüft, committet, macht weiter. Verwenden bei "weiter", "mach weiter", "umsetzen", "nächster Punkt" oder zu Beginn jeder Session.
---

# Arbeitsschleife

Ziel: alle Punkte in `Planer-Lager-Core/PROGRESS.md` auf `[x]`. Nicht anhalten, um zu fragen.

## Start jeder Session (einmal)
1. `git -C <repo> status` und `git log --oneline -5` in allen 3 Repos. Unsauberen Stand zuerst aufräumen.
2. PROGRESS.md lesen → ersten `[ ]`-Punkt wählen. ENTSCHEIDUNGEN.md nur überfliegen (Abschnitt „Während der Umsetzung“).
3. Datenbank bereit? `bash scripts/db-test.sh` (startet PostgreSQL, falls nicht läuft).

## Je Punkt
1. **Spec holen**: `docs/spec/INDEX.md` → nur die Dateien zu den IDs des Punkts lesen. Zustände/Datenmodell nur, wenn nötig.
2. **Plan in 3–6 Zeilen** (im Kopf oder TaskCreate): Schichten domain → db → server → client → ui/app. Was ist Akzeptanz?
3. **Tests zuerst**: Testname beginnt mit der ID. Grenzfälle aus der Spec wörtlich übernehmen (Regex-Beispiele, Rechenbeispiele, Texte der Meldungen).
4. **Bauen**: kleinste vollständige Lösung über alle Schichten. Fachlogik nur in `packages/domain`. Meldungstexte wörtlich aus der Spec.
5. **Prüfen**: betroffene Tests → dann volle Suite des Repos (`npm test 2>&1 | tail -n 40`). Rot? Ursache finden, nicht Test aufweichen.
6. **UI-Punkt?** Kurzer E2E oder Screenshot (Skill `e2e-electron`). Nicht jeden Punkt – spätestens am Phasenende.
7. **Abhaken**: PROGRESS.md `[x]` + eine Zeile (Datum, Repos, Testdatei). Annahme getroffen? → ENTSCHEIDUNGEN.md.
8. **Commit** je Repo: `feat(<ID>): <was>` bzw. `fix(<ID>): …`. Core geändert → Submodule-Zeiger in M und P mitziehen. Pushen.
9. Nächster Punkt.

## Phasenende
1. Subagent `tester`: alle Suiten in allen Repos + E2E der Phase. Fehler beheben.
2. Subagent `spec-pruefer` mit den IDs der Phase. Befunde beheben oder begründet in ENTSCHEIDUNGEN.md.
3. Bei UI-Phasen: Subagent `ui-pruefer`.
4. BERICHT.md-Eintrag schreiben. `npm run spec:abdeckung` kurz ausgeben.
5. `/compact`, dann weiter mit der nächsten Phase.

## Wenn etwas blockiert
- Netz/Hardware/Download geht nicht: Punkt `[~]`, Grund in ENTSCHEIDUNGEN.md, nächsten Punkt nehmen. Später erneut versuchen.
- Gleicher Fehler 3× ohne Fortschritt: Skill `investigate-first`, dann neu ansetzen. Nicht im Kreis drehen.
- Spec widersprüchlich: strengere/sicherere Lesart nehmen, eintragen.

## Fertig-Kriterium (Spec 10.1, angepasst)
Alle Punkte `[x]` (oder `[~]` mit Grund), `spec:abdeckung` 0 fehlend, alle Unit/API/E2E grün in allen Repos, BERICHT.md ehrlich, Endabnahme `spec-pruefer` ohne offene Befunde.
