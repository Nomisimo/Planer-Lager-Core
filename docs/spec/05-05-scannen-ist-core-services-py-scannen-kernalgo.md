## 5.5 Scannen [IST] (core/services.py::_scannen) — Kernalgorithmus
Eingabe: code (Text), modus (hinzufuegen | packen | rueckgabe), projekt (außer bei Rückgabe), optional tasche
(aktive Tasche bei Rückgabe). Ausgabe: {level: ok|warn|error, text, meldungen[], tasche, code,
artikel_id, ist_case, projekt}. Die gesamte Buchung ist eine Datenbank-Transaktion.

 1. Gerät finden: über Code (R-22) oder alte_pruef_id (ohne Beachtung der Schreibweise).
 2. Nicht gefunden: Gehört der Code zu einem bestellten, noch nicht gelieferten Etikett (EtikettCode ohne
    Gerät) -> error mit Bestellnummer. Sonst error „Code ... ist keinem Gerät zugeordnet." Ende.
 3. Modus prüfen: unbekannt -> error. Außer Rückgabe ohne Projekt -> error „Bitte zuerst ein Projekt
    wählen."
 4. Ziele bestimmen: Beim Packen/Hinzufügen eines Case wird der Inhalt (alle Geräte mit case=dieses)
    mitgebucht. Bei Rückgabe wird nur das gescannte Gerät gebucht, der Inhalt einzeln gescannt.
 5. Je Ziel g:
- War g Vermisst und Modus Rückgabe: Bewegung „Wieder aufgetaucht", Status -> Im Lager, Level
mindestens warn.

 - g.gesperrt: Meldung „nicht verfügbar (Status), übersprungen"; Level error wenn es das gescannte Gerät
selbst ist, sonst warn. Weiter.
- Packen/Hinzufügen und g.projekt ist ein anderes Projekt: Meldung „ist bereits in Projekt X, übersprungen";
Level wie oben. Weiter.
- Rückgabe: Bewegung „Zurück im Lager", projekt=None, Status Im Lager.
- Sonst: projekt setzen, Status Gepackt (Modus packen) bzw. Projekt zugeordnet (Modus hinzufügen),
Bewegung schreiben.
- Hat g eine überfällige oder fehlende Prüfung (nicht bei Rückgabe): Meldung „Prüfung überfällig/fehlt!", Level
warn.

 6. Case-Prüfungen (nur Packen/Hinzufügen):
- Anzahl Inhalt <> soll_inhalt -> warn „Case unvollständig: x von y Teilen eingetragen".
- Inhalt vom falschen Artikel (<> inhalt_artikel) -> warn „Falscher Inhalt: ...".
 7. Aktive Tasche bei Rückgabe: Wird ein Case zurückgescannt, wird er zur aktiven Tasche (Antwort enthält
    tasche: code, name, anzahl, soll, offen[]). Jedes danach gescannte Gerät (mit gesendetem tasche-Code)
    wird dieser Tasche zugeordnet (R-46).
 8. Text: „CODE Artikelname – Zurück im Lager / Gepackt / Zum Projekt hinzugefügt" mit Zusatz („inkl. n
    Inhalte", „jetzt die n Lampen darin scannen"). Wurde nichts gebucht: error „nicht gebucht".
 9. Packlisten-Abgleich (nur Packen/Hinzufügen mit Angebot): Danach pruefe_scan: Steht der Artikel nicht
    in der Packliste -> warn „steht nicht in der Packliste". Mehr gepackt als im Angebot -> warn „x gepackt, aber
    nur y im Angebot".
Level-Bedeutung: ok = grün, gebucht. warn = gelb, gebucht (oder teilweise), Hinweis lesen. error = rot, nicht
gebucht, Ursache klären.
