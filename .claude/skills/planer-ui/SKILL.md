---
name: planer-ui
description: Baut oder ändert Oberflächen in Materialplaner, Productionplaner oder station-web im Stil der Planer-Familie (Stromplaner/Netzwerkplaner). Verwenden bei jeder neuen Seite, jedem Dialog, jeder Liste oder jedem Formular.
---

# Oberfläche im Planer-Stil

1. Lies `docs/UI-STIL.md` (einmal je Session reicht).
2. Nutze nur Bausteine aus `@lager/ui`. Fehlt einer: dort ergänzen, nicht in der App nachbauen. So bleiben beide Apps gleich (Nahtlos, D-05).
3. Jede Seite: Titel (h2), kurzer Untertitel (was tut man hier), Aktionen rechts oben, Inhalt in `Section`.
4. Leerzustand mit Satz + Knopf („Noch kein Material. Lege den ersten Artikel an.“).
5. Listen: Suche + Filter oben, paginiert/begrenzt (NFA-05), Spaltenköpfe wie `th`.
6. Formulare: UI-4 (Pflicht `*`, Fehler am Feld, Doppelklick-Schutz), Sicherheitsabfrage bei Löschen/Verladen/Wiederherstellen.
7. Texte: Deutsch, Du-Form, Ursache + nächster Schritt (UI-5).
8. Rechte: Einträge und Knöpfe nur zeigen, wenn die Rolle sie darf (UI-1). Server prüft trotzdem.
9. Live: Ansicht hängt am Live-Store (`@lager/client`), lädt bei passendem Event nach. Kein manuelles „Aktualisieren“ nötig.
10. Querverweise in die andere App als Deep-Link-Knopf (ARCHITEKTUR §4.2).
11. Tastatur: alles bedienbar, sichtbarer Fokus, `aria-label` an Symbolknöpfen (UI-7).
