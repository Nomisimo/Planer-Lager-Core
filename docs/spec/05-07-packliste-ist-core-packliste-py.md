## 5.7 Packliste [IST] (core/packliste.py)
 • R-51 Aus den Positionen eines Angebots (nur miete und verkauf, nur Artikel, keine Dienstleistungen);
   gleiche Artikel aus mehreren Positionen werden zusammengezählt; sortiert nach Kategorie und Name.
 • R-52 Je Zeile: soll, ist (Geräte dieses Artikels im Projekt mit Status Zugeordnet oder Gepackt), gepackt,
   fertig (gepackt >= soll). Für Verbrauchsmaterial gibt es kein ist/gepackt (nicht zählbar, wird von Hand
   kontrolliert).
 • R-53 Sets: Hat der Artikel einen mengenschritt und ist soll ein Vielfaches davon, zeigt die Zeile „n ×
   k-er-Set" und schlägt freie, vollständige Taschen (Status Im Lager, kein Projekt, mindestens k Teile im
   Lager) als Vorschlag vor. Es wird nichts gebucht.
 • R-54 Case-Zeilen zeigen „Inhalt: Artikel × soll_inhalt".
 • Ausgabe auch als druckbares PDF.
