## 6.3 Scannen, Packen, Rückgabe
 • FA-15 [IST] Scan-Seite mit Modus (Hinzufügen/Packen/Rückgabe), Projektwahl, Eingabefeld (Handscanner
   als Tastatur, Enter schließt ab), Kamera-Scan (breites Lesefenster für Barcodes), Verlaufsliste,
   Farbrückmeldung, Ton optional.
Akzeptanz: Jeder Scan zeigt innerhalb von 2 Sekunden Ergebnis (grün/gelb/rot) und Text.
 • FA-16 [IST] Globales Codefeld in der Kopfleiste (Gerät/Projekt per Code öffnen).
 • FA-17 [IST] Packansicht je Projekt: Packliste live (soll/ist/gepackt), Fortschritt, Hinweise (Sets, Taschen,
   Case-Inhalt), Packliste drucken, „Packen abgeschlossen & verladen" mit Bestätigung.
 • FA-18 [IST] Rückgabeansicht je Projekt und freie Rückgabe am Arbeitsplatz (Projekt ergibt sich aus dem
   Gerät); Taschen-Ablauf (R-46 bis R-48); „Offene als vermisst melden"; „Tasche beenden".
 • FA-19 [IST] Projekt-Status-API (/projekte/<id>/status/) liefert nach jedem Scan den Stand der Packliste
   als JSON.
 • FA-20 [SOLL P2] Teilrückgaben und Nachpacken: Ein Projekt kann mehrfach gepackt/zurückgegeben
   werden (z. B. Nachlieferung während der Veranstaltung); Verlauf je Packdurchgang mit Zeit und Person.
   Verladen darf erneut geöffnet und abgeschlossen werden, ohne bestehende Buchungen zu verlieren.
 • FA-21 [SOLL P2] Lieferschein/Übergabeprotokoll als PDF beim Verladen (Projekt, Kunde, gescannte
   Geräte mit Code und Seriennummer, Datum, Unterschriftsfeld) und Rückgabeprotokoll (zurückgegeben,
   fehlt, defekt).
 • FA-22 [SOLL P3] Offline-Notfallmodus: Scans werden lokal zwischengespeichert und beim nächsten
   Verbindungsaufbau gebucht.
