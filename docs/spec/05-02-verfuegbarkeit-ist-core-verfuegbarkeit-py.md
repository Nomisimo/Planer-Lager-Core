## 5.2 Verfügbarkeit [IST] (core/verfuegbarkeit.py)
 • R-24 Reservierung: Eine Mietposition mit Artikel reserviert Menge, wenn ihr Angebot (a) Angenommen ist und
   das Projekt weder abgeschlossen noch storniert ist (fest), oder (b) Versendet ist und gueltig_bis leer oder
   >= heute (vorgemerkt).
 • R-25 Zeitraum: Eine Reservierung gilt im Zeitraum Projekt-beginn bis ende (fehlt ende: beginn). Zwei
   Zeiträume überschneiden sich, wenn von1 <= bis2 und bis1 >= von2. Fehlt ein Datum, gilt die
   Reservierung vorsichtshalber immer.
 • R-26 Bestand: Dienstleistung = unbegrenzt (None). Verbrauchsmaterial = bestand. Sonst = Anzahl
   einsetzbarer Geräte (R-17).
 • R-27 Verfügbar = Bestand - Summe der Mengen aller überschneidenden Reservierungen (außer dem
   gerade bearbeiteten Angebot). Negativ = Überbuchung: In der Angebotsposition erscheint ein Hinweis.
   Das System blockiert nicht, weil Zukauf/Nachmiete möglich ist.
