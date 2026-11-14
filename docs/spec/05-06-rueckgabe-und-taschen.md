## 5.6 Rückgabe und Taschen
 • R-46 Tasche zuordnen: Wird ein Gerät mit aktiver Tasche zurückgebucht:
- Passt sein Artikel nicht zum inhalt_artikel der Tasche -> warn „passt nicht in ..., nicht zugeordnet".
- Lag es in einer anderen Tasche -> Wechsel, Bewegung „Tasche gewechselt: A -> B", warn, Hinweis, wie viele
die alte Tasche jetzt hat.
- Hat die Tasche jetzt mehr als soll_inhalt -> warn.
 • R-47 Funktionstest (optional je Arbeitsplatz): Ergebnis „bestanden" -> Bewegung „Funktionstest
   bestanden". Ergebnis „Mangel" mit Notiz -> Gerät Defekt, Bewegung „Mangel bei Rückgabe: ...", Notiz am
   Gerät mit Datum.
 • R-48 Tasche beenden / Offene als vermisst: Alle Teile, die laut System noch in der Tasche liegen, aber
   nicht zurückgescannt sind, können gesammelt als vermisst gemeldet werden (/api/vermisst/).
 • R-49 Vermisst melden: Status -> Vermisst, case -> leer, Bewegung „Als vermisst gemeldet, Projekt X,
   zuletzt in Y". Das Gerät bleibt dem Projekt zugeordnet (Nachweis). Doppelte Meldung ändert nichts.
 • R-50 Gefunden: Nur bei Status Vermisst -> Im Lager, projekt=None, Bewegung „Wieder gefunden, zurück
   im Lager".
