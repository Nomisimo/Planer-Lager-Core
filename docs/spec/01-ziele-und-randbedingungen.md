# 1. Ziele und Randbedingungen
1.1 Ziel
Ein Verleih- und Eventtechnik-Betrieb soll sein gesamtes Material, den Lagerablauf und seine Projekte in einem
System führen: von der Kundenanfrage über Angebot, Reservierung, Packen, Verladen bis zur Rückgabe und
zum Projektabschluss. Das System ersetzt Excel-Listen und Zettel und soll sich an Rentman orientieren, aber
auf diesen Betrieb zugeschnitten sein.

1.2 Leitprinzipien
 1. Ein Stand der Wahrheit: Was im System steht, stimmt mit dem Lager überein. Jede Bewegung eines
    Geräts ist gebucht (R-30).
 2. Scannen statt tippen: Das Lager arbeitet mit Handscanner oder Kamera. Jede Lageraktion ist mit einem
    Scan in unter 2 Sekunden Rückmeldung möglich.
 3. Nachvollziehbar: Jede Buchung trägt Person und Zeit. Nichts wird gelöscht, was Nachweis ist (Geräte
    werden ausgemustert, nicht gelöscht).
 4. Fehlertolerant, aber laut: Das System lässt Praxisfälle zu (Ersatzgerät, Nachpacken) und warnt deutlich.
    Es blockiert nur, wenn eine Buchung fachlich unmöglich ist.
 5. Einfach für Laien: Deutsche Oberfläche, klare Sätze, keine Fachbegriffe der Informatik.
 6. Betrieb auf einem Rechner im Betrieb: Kein Cloud-Zwang, Daten bleiben beim Betrieb (siehe NFA).

 1.3 Technische Vorgaben (verbindlich für das Referenz-System)
Thema                      Vorgabe
Sprache/Framework          Python 3.12, Django 6.1
Datenbank                  SQLite (eine Datei). Späterer Wechsel auf PostgreSQL muss möglich bleiben: keine
                           SQLite-Spezialfunktionen im Fachcode.
PDF                        reportlab (Packliste, Angebot, Etiketten-Bestellung)
Codes                      qrcode (QR als SVG), eigener Code-128-Encoder (core/barcode.py)
Frontend                   Server-gerenderte Django-Templates, reines JavaScript, kein Frontend-Framework. Kamera-Scan:
                           html5-qrcode (lokal ausgeliefert, keine CDN).
Geld/Zahlen                Decimal, kaufmännisch auf Cent runden. Nie float für Beträge.
Zeit                       Zeitzone Europe/Berlin, USE_TZ=True, Datumsanzeige TT.MM.JJJJ
Sprache der UI             Deutsch (Du-Form). Fehlermeldungen sagen, was und was zu tun ist.
Start                      starten.command (sichert bei Bedarf, migriert, startet Server auf 127.0.0.1:8000)
Tests                      Django TestCase, Testdatenbank als Datei. Jede Fachregel hat mindestens einen Test. Stand
                           Referenz: 538 Tests, alle grün.
Befehle                    .venv/bin/python manage.py ... (Ordnername enthält einen Doppelpunkt: uv run
                           funktioniert nicht)

1.4 Arbeitsregeln für Entwicklung
 • Kein Datenverlust: Änderungen an echten Daten (Datenbank, daten/) nie ohne vorherige Sicherung
   (manage.py backup). Migrationen müssen auf einer Kopie der echten Datenbank getestet werden.
 • Neue Funktionen in einer Kopie bauen (verleih-nacht) und per UEBERNEHMEN.command einspielen, damit
   das laufende Tool nicht gestört wird.
 • Test zuerst oder zugleich: Kein Merge ohne grüne Gesamttest-Suite.
 • Ehrlicher Bericht: Am Ende jeder Lieferung steht, was geprüft wurde und was nicht (z. B. kein echter
   Scanner getestet).
 • Kein neues Paket ohne Grund, keine externen Dienste im Fachcode, keine Daten an Dritte.
