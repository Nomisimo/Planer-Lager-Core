---
name: spec
description: Findet die Stelle der Entwickler-Anweisung zu einer ID (R-xx, FA-xx, NFA-xx, T-xx, UI-xx, E-x) oder einem Thema und liest nur diesen Abschnitt. Verwenden, bevor eine Anforderung gebaut, getestet oder geprüft wird.
---

# Spec gezielt lesen

1. `rg -n "<ID>\b" docs/spec/INDEX.md` → Datei finden. Bei Themen: `rg -il "<Begriff>" docs/spec/`.
2. Nur diese Datei lesen. Datenmodell (`03-*`) und Zustände (`04-*`) nur, wenn der Punkt Felder oder Statuswechsel braucht.
3. Abnahmetest dazu? `rg -n "T-\d+" docs/spec/10-abnahme-und-tests.md` nach dem Thema durchsuchen.
4. Schnittstelle? `docs/spec/07-schnittstellen-http.md`. Oberfläche? `docs/spec/08-oberflaechen-vorgaben.md`.
5. Abweichungen und Annahmen stehen in `ENTSCHEIDUNGEN.md` (D-01 Cloud, D-15–D-20 Spec-Lücken). Sie gehen der Spec vor.

Regeln:
- Meldungstexte, Regex, Grenzwerte, Rechenbeispiele **wörtlich** übernehmen.
- `[IST]` = Verhalten genau so. `[SOLL Pn]` = bauen in der Phase aus PROGRESS.md.
- Verweise auf Django-Dateien (`core/…py`) sind nur Orientierung. Die Referenz liegt nicht vor (D-02). Abbildung: ARCHITEKTUR.md §7.
