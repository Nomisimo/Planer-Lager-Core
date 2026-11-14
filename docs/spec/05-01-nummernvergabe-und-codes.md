## 5.1 Nummernvergabe und Codes
 • R-20 Projektnummer: P bzw. J + - + Jahr des Anlegens + - + (höchste vorhandene Nummer dieses
   Präfixes + 1), dreistellig mit führenden Nullen. Jobs und Projekte haben getrennte Zähler.

  • R-21 Gerätecode: Kategorie.praefix + "-" + 4-stellige Nummer. Nächste Nummer = Maximum aus
   Kategorie.letzte_nummer und allen vorhandenen Codes dieses Präfixes, plus 1. letzte_nummer wird dabei
   hochgezählt. Codes werden nie wiederverwendet, auch wenn Geräte gelöscht werden.
 • R-22 Code-Normalisierung bei Eingabe: Regex ^([A-Za-z]{1,4})[-\s]?0*(\d+)$ -> PRAEFIX-0000. „lt1",
   „LT 1", „lt-0001" sind alle LT-0001. Alles andere bleibt unverändert (z. B. alte Benning-Prüf-ID).
 • R-23 Projektcode-Eingabe: ^([PpJj])[-\s]?(\d{4})[-\s]?0*(\d+)$ -> P-JJJJ-NNN. Wird beim Scannen
   ein Projektcode erkannt, wechselt die Oberfläche in die Packansicht dieses Projekts (Antwort-Feld weiter).
