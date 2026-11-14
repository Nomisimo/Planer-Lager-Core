## 6.1 Material und Geräte
 • FA-01 [IST] Materialliste mit Suche/Filter nach Kategorie, Typ; Spalten Name, Kategorie, Preis,
   Bestand/Anzahl Geräte (Warnzeichen bei Bestand <= Mindestbestand), Reservierungen.
Akzeptanz: Verbrauchsartikel mit Bestand <= Mindestbestand zeigt ein Warnzeichen.
 • FA-02 [IST] Artikel anlegen/bearbeiten (R-71), löschen nur, wenn kein Gerät in einem Projekt belegt ist
   (vermisste/ausgemusterte zählen nicht); sonst verständliche Sperrmeldung.
 • FA-03 [IST] Geräteliste mit Status-, Prüf- und Projektfilter; Gerätedetail mit Bewegungsverlauf, Prüfstatus,
   Case-Inhalt (ein-/austragen), Knöpfen Vermisst/Gefunden/Heute geprüft/Etikett.
 • FA-04 [IST] Bestand von Verbrauchsmaterial ändern (Bereich packen w, damit das Lager es darf).
 • FA-05 [IST] Material-Detailseite mit Reservierungen (vorgemerkt/fest) im Zeitraum.
 • FA-06 [SOLL P2] Inventur: Inventurlauf je Lagerbereich: Bestandsliste erzeugen, Geräte scannen,
   Abweichungen (fehlend, zu viel, unbekannt) anzeigen, bestätigen und buchen (fehlend -> vermisst,
   Bewegung „Inventur"). Abschluss mit Protokoll (PDF).
Akzeptanz: Nach Scan aller Geräte einer Kategorie zeigt das System genau die nicht gescannten als „fehlt".
 • FA-07 [SOLL P2] Reparatur/Wartung: Defekt-Meldung mit Foto, Beschreibung, Verantwortlichem, Status
   (gemeldet, in Reparatur, repariert/geprüft, ausgemustert), Kosten optional; Rückgabe in den Bestand erst
   nach Prüfung. Wartungsintervalle für nicht prüfpflichtige Wartung (z. B. Lüfter reinigen).
 • FA-08 [SOLL P3] Lagerorte/Regalplätze je Artikel oder Gerät (Anzeige beim Packen).
 • FA-09 [SOLL P3] Schadensdokumentation bei Rückgabe mit Foto-Upload und Verknüpfung zum
   Projekt/Kunden (für Haftungsfragen).
