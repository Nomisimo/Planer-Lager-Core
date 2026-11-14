# UI-Stil der Planer-Familie

Vorbild: Netzwerkplaner (`src/shared/constants.js`, `src/renderer/ui.jsx`, `styles.css`) und Stromplaner. Gleiche Designsprache, damit Materialplaner und Productionplaner wie Geschwister aussehen. Umsetzung zentral in `@lager/ui`.

## Grundlayout
- Kopfleiste (`header`): Hintergrund `DARK`, unten `2px solid ACCENT`, Logo fett 18 px in `ACCENT`, daneben Meta-Text (`SUB`, 12 px). Rechts: globales Codefeld (FA-16), App-Schalter, Online-Status, Benutzer.
- Spec UI-1 verlangt ein **Seitenmenü**, gruppiert nach Arbeitsablauf. Darum: Seitenmenü links im Planer-Stil (Hintergrund `DARK`, aktiver Eintrag mit 3 px `ACCENT`-Balken links, Gruppenüberschriften wie `.sp-section-label`). Unterbereiche einer Seite als Tabs im Stil von `navBtn`/`boxTab`.
- Inhalt: `main` max. 1280 px, Abschnitte als `section` (PANEL, Radius 10, Rand LINE, Padding 20).
- Schrift: `'Segoe UI', system-ui, sans-serif`. Icons: `lucide-react`.

## Farben (aus Netzwerkplaner, Akzent #b3483f)
```js
FARBEN_DUNKEL = { DARK:"#1c2127", PANEL:"#252b33", LINE:"#3a424c", BG:"#15191e", OK:"#2ecc71", WARN:"#f39c12",
  ERR:"#ff5d5d", INFO:"#4ea1ff", MUTED:"#7c8794", SUB:"#9aa4af", TEXT:"#e8eaed", STRONG:"#ffffff", TEXT2:"#c8d0d8",
  INPUT:"#1b2026", CARD:"#1f242b", BTN:"#323a44", LINE2:"#232a33", MID:"#56606c", LINK:"#8ec5ff", HINTBG:"#2a2418",
  DANGERLINE:"#5a2a2a" }
FARBEN_HELL = { DARK:"#ffffff", PANEL:"#ffffff", LINE:"#d3d9df", BG:"#eef1f4", OK:"#1f9d55", WARN:"#c77700",
  ERR:"#d63c3c", INFO:"#2a78d1", MUTED:"#6f7a86", SUB:"#56616d", TEXT:"#1d232a", STRONG:"#10151b", TEXT2:"#38414b",
  INPUT:"#ffffff", CARD:"#f6f8fa", BTN:"#e9edf1", LINE2:"#e5e9ed", MID:"#a5aeb8", LINK:"#1f6fc5", HINTBG:"#fff4dc",
  DANGERLINE:"#e8b4b4" }
```
- Als CSS-Variablen ausgeben (`--lp-dark` usw.), nicht hart im Code.
- **FA-52/UI-6: 8 Farbthemen + 3 Dichten + Hell/Dunkel/System.** Thema 1 = „Planer“ (oben). Die anderen 7 tauschen nur `ACCENT` (und passende Hover-Töne), z. B. Blau, Grün, Violett, Orange, Petrol, Grau, Kontrast-hoch. Dichten: kompakt / normal / groß (Abstände, Schrift 13/14/16 px, Touch ≥ 44 px bei „groß“ und am Arbeitsplatz).
- Kontrast ≥ 4,5:1 (UI-7). `ui-pruefer` prüft das je Thema.

## Bausteine (`@lager/ui`)
Section, Field, Modal, Toggle, Klappmenue, Tabelle (th/td-Stil), Chip, Badge, StatusPunkt, Meldung, ScanFeld, ScanErgebnis, Bestaetigung, Leerzustand, Seitenmenue, Kopfleiste, AppSchalter, CodeFeld, OnlineStatus.
- Knöpfe: `primaryBtn` (ACCENT, weiß, fett), `secondaryBtn` (BTN), `ghostBtn`, `dangerBtn` (ERR-Rand).
- Formulare (UI-4): Pflichtfeld mit `*`, Fehler direkt unter dem Feld in ERR, Speichern-Knopf sperrt bis Antwort (kein Doppelbuchen).

## Scan-Rückmeldung (UI-2, UI-3)
- Großes Ergebnisfeld: Grün = gebucht, Gelb = gebucht mit Hinweis, Rot = nicht gebucht. **Immer zusätzlich Symbol + Text** (Häkchen / Dreieck / Kreuz).
- Optional Ton (3 unterschiedliche Töne) und Vibration. Verlaufsliste darunter, neuester oben.
- Fokus bleibt im Scan-Feld. HID-Scans werden auch ohne Fokus abgefangen.

## Texte
Deutsch, Du-Form, keine IT-Begriffe. Fehler: „Das Gerät LT-0004 ist schon in Projekt P-2026-012. Gib es dort zuerst zurück.“
