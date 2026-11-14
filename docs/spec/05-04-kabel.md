## 5.4 Kabel
 • R-29 Länge aus Name: Regex (?<![\w.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*(m|meter|cm)(?![Buchstabe]).
   Bei mehreren Treffern zählt der letzte. „cm" wird durch 100 geteilt. Nur in Kategorien, deren Name „kabel"
   enthält (so wird „Traverse 2 m" nicht fälschlich als Kabel erkannt).
 • R-29a Farbe: Jede Länge bekommt beim ersten Auftreten die nächste freie Farbe aus der Liste (12 Farben)
   und behält sie für immer (KabelLaenge). Sind alle vergeben: leer lassen, Hinweis in der Oberfläche.
 • Das Etikett zeigt Länge und Farbfeld, nicht den Farbnamen.
