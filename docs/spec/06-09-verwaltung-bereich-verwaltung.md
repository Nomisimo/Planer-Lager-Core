## 6.9 Verwaltung (Bereich verwaltung)
 • FA-47 [IST] Benutzer und Rollen (anlegen, Rolle zuweisen, deaktivieren, Passwort setzen; R-07).
 • FA-48 [IST] Einstellungen (Firma, Etiketten, Zeiterfassung, Angebote, Sicherung), Zweitordner per
   Ordner-Auswahl.
 • FA-49 [IST] Datensicherung: Sicherung jetzt, Liste, Download, automatisch beim Start (wenn letzte
   Sicherung > 20 Stunden alt), Zweitkopie, Aufbewahrung (Standard: letzte 14; Vorab-Sicherungen
   „vor-wiederherstellung" bleiben immer), Prüfung jeder Sicherung (zip lesbar, Datenbank intakt).
   Wiederherstellung über Befehl manage.py restore <Datei> mit automatischer Vorab-Sicherung. [SOLL P2]
   Wiederherstellung auch über die Oberfläche (mit Sicherheitsabfrage).
 • FA-50 [IST] Sicherheit: Check-Seite, Sicherheitsprotokoll (30 Tage, filterbar), Dateirechte absichern
   (manage.py sicherheitscheck --absichern, bei jedem Start).
 • FA-51 [IST] System: Neustart aus der Oberfläche, Wartung, Ping.
 • FA-52 [IST] Darstellung: 8 Farbthemen, 3 Abstandsstufen, Standard für alle setzbar.
 • FA-53 [IST] Plan-Symbole (yEd): je Artikel ein Piktogramm, automatisch erzeugte
   Symbolbibliothek.graphml bei jeder Artikeländerung, Download aller SVG als zip. Nicht in yEd selbst
   geprüft; Aussehen soll später angepasst werden (Wunsch des Auftraggebers).
 • FA-54 [SOLL P2] Zwei-Faktor-Anmeldung für Benutzerkonten (TOTP), Pflicht für Administratoren, sobald
   das System aus dem Netz erreichbar ist.
 • FA-55 [SOLL P2] Änderungsprotokoll (wer/wann/was alt->neu) für Stammdaten (Artikel, Kunden, Projekte,
   Rechte).
 • FA-56 [SOLL P3] Server-Betrieb (Mac mini): gunicorn + Reverse-Proxy, HTTPS, DEBUG=0,
   Prozessüberwachung, verschlüsselte Sicherungen. Vorher unabhängige Sicherheitsprüfung

     (Penetrationstest).
