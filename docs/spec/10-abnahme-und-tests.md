# 10. Abnahme und Tests
10.1 Allgemein
Eine Funktion ist fertig, wenn (1) die Anforderung umgesetzt ist, (2) Tests dafür existieren und grün sind, (3) die
gesamte Suite grün ist, (4) Migration an einer Kopie der echten Datenbank fehlerfrei lief, (5) die Seite im
Browser angesehen wurde (oder im Bericht steht, dass nicht), (6) der Bericht ehrlich nennt, was nicht geprüft
wurde.

10.2 End-to-End-Abnahmetests
ID          Szenario                                                 Erwartung
T-01        Material „Kabel 5 m" über den Kabel-Assistenten          1 Artikel mit laenge_m=5 und Farbe, 1 Bestellung mit 3
            anlegen, 3 Stück, Etiketten bestellen                    fortlaufenden Codes, 0 Geräte
T-02        Lieferung der 3 Codes buchen                             3 Geräte mit genau diesen Codes, Bestellung
                                                                     geliefert
T-03        Code einer noch nicht gelieferten Bestellung scannen     Rot, Meldung mit Bestellnummer
T-04        Projekt anlegen, Angebot mit 2 Positionen, versenden     Nummer P-JJJJ-001, Ordner mit 3 Unterordnern,
                                                                     Material vorgemerkt
T-05        Zweites Projekt im selben Zeitraum fordert mehr          Überbuchungshinweis in der Position, Speichern bleibt
            Material als vorhanden                                   möglich
T-06        Angebot annehmen, Projekt „Bestätigt", Zone zuweisen     Projekt erscheint in der Prioritätsliste, Zone belegt
T-07        Alle Geräte der Packliste im Modus „Packen" scannen      Alle grün, Packliste vollständig, Status Gepackt
T-08        Case scannen                                             Inhalt wird mitgebucht; Case mit falschem/zu wenig
                                                                     Inhalt -> Gelb
T-09        Ein Gerät aus anderem Projekt scannen                    Rot, nicht gebucht, Meldung nennt das andere Projekt
T-10        Gerät mit überfälliger Prüfung packen                    Gelb mit Prüfungshinweis, trotzdem gebucht
T-11        „Packen abgeschlossen & verladen"                        gepackt_am/von gesetzt, Zone frei, Status „Läuft"
T-12        Rückgabe: Tasche zuerst, dann Inhalt                     Alle Im Lager, Tasche zeigt „n von soll", Wechsel in
                                                                     andere Tasche -> Gelb + Bewegung
T-13        Ein Gerät fehlt, „Offene als vermisst melden"            Status Vermisst, bleibt am Projekt, Bewegung
                                                                     geschrieben
T-14        Vermisstes Gerät wird zurückgescannt                     Gelb „wieder aufgetaucht", Im Lager
T-15        Funktionstest „Mangel"                                   Gerät Defekt, Notiz mit Datum, nicht mehr packbar
T-16        Lager-Arbeitsplatz: gesperrt, Entsperren mit falscher    Gesperrt/Verzögerung, kein Zugriff auf Fremdseiten
            PIN 5×
T-17        Rolle „Lager / Techniker" ruft /benutzer/ auf            403, Protokolleintrag „verweigert"
T-18        5 falsche Logins, dann richtiges Passwort                429 und Sperrmeldung
T-19        Job zu Projekt anlegen; Job unter Job versuchen          Kunde übernommen; zweiter Fall abgelehnt
T-20        Timer starten, Projekt verlassen                         Timer stoppt, Zeit vorgemerkt; auf Packseite nie
                                                                     Planungszeit
T-21        Projekt abschließen                                      Ladezone sofort frei, Reservierung aufgehoben
T-22        Sicherung erstellen, per manage.py restore               Daten identisch; Vorab-Sicherung existiert
            wiederherstellen
T-23        Gerät in einem Projekt löschen versuchen                 Verweigert mit Meldung (IST). Nach Umsetzung von
                                                                     R-19 [SOLL]: auch Geräte mit Historie nur ausmustern
T-24        SVG-Datei an Projekt hängen und öffnen                   Nur Download, nie inline

 10.3 Testpflicht (Auszug)
Für jede R-Regel existiert ein Test. Bestehende Testklassen als Vorbild: MaterialTests, RollenRechteTests,
EtikettBestellungTests, BarcodeTests, KabelAssistentTests, SicherheitTests, SeitenmenueTests,
Packen/Scan-Tests in core/tests.py.
