# 9. Nicht-funktionale Anforderungen
 • NFA-01 Sicherheit [IST]: Anmeldung überall (R-04), Rechte je URL (R-01), Sperre (R-08), CSRF-Schutz,
   Schutz-Header (CSP mit frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy mit
   Kamera nur eigene Seite, kein Zwischenspeichern angemeldeter Seiten), Datei-Auslieferung sicher (nur
   PDF/Bilder inline, Sandbox), CSV-Zellen gegen Formelinjektion geschützt, Dateirechte 0600/0700,
   Passwort-Hashing, geheimer Schlüssel in Datei außerhalb des Codes, Sicherheitsprotokoll.
 • NFA-02 Netz: Standard-Betrieb nur auf 127.0.0.1. Für Betrieb im Netz sind DEBUG=0, HTTPS (HSTS),
   SECURE-Cookies, ALLOWED_HOSTS, richtiger Server und 2FA Pflicht (FA-54, FA-56).
 • NFA-03 Datenschutz: Personenbezogene Daten nur für den Auftrag; Zugriff über Rollen; Protokoll über
   Zugriffe; Löschkonzept für Kundendaten (Aufbewahrungsfristen beachten); keine Weitergabe an Dritte (die
   Adresssuche sendet nur den eingetippten Adresstext serverseitig an den Adressdienst, Geoapify oder
   alternativ den freien Photon-Server, nicht Kundendaten).
 • NFA-04 Verfügbarkeit/Backup: Sicherung beim Start und manuell, Zweitort, Wiederherstellungstest;
   Sicherungen enthalten Datenbank, Projektordner und hochgeladene Dateien.
 • NFA-05 Leistung: Seitenaufruf unter 1 Sekunde bei 5.000 Geräten und 500 Projekten; Scan-Antwort unter 1
   Sekunde. Listen werden paginiert oder begrenzt. Abfragen vermeiden N+1-Problem
   (select_related/prefetch_related).
 • NFA-06 Integrität: Buchungen in Transaktionen; Fremdschlüssel mit PROTECT, wo Nachweis nötig; keine
   Löschung von Geräten mit Historie.
 • NFA-07 Wartbarkeit: Fachcode getrennt von Ansichten (services, zonen, verfuegbarkeit, packliste,
   etiketten_bestellung ...); Werte (Fristen, Grenzen) zentral; kurze Funktionen; Kommentare erklären
   warum, nicht was.
 • NFA-08 Testbarkeit: Siehe Kapitel 10; Tests laufen ohne Netz und ohne Eingriff in echte Daten
   (Testdatenbank, temporäre Ordner).

  • NFA-09 Browser: aktuelle Versionen von Safari, Chrome, Firefox, Edge; Kamera-Scan braucht https oder
   localhost.
