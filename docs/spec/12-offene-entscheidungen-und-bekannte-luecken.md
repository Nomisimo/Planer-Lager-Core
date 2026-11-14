# 12. Offene Entscheidungen und bekannte Lücken
Nr.         Thema                                                      Standard/Stand
E-1         Server-Umzug (Mac mini, Netz-Zugriff)                      Offen; Pläne liegen in Planung/. Vorher FA-54,
                                                                       FA-56.
E-2         Aussehen der yEd-Symbolbibliothek                          Auftraggeber beschreibt Wunsch später.
E-3         Etikettendrucker und Lieferant (Stromstoss): Bindestrich   Offen; Rückfall CSV „ohne Bindestrich". Echter
            im Code druckbar?                                          Scantest steht aus.
E-4         Personal- und Fahrzeugplanung (FA-37, FA-38)               Gewünscht („vollumfängliches System"), Umfang
                                                                       offen.
E-5         Benachrichtigungen (E-Mail/Push)                           Offen.
E-6         Mehrbenutzer-Last                                          SQLite genügt für wenige gleichzeitige Nutzer; bei
                                                                       mehr: PostgreSQL.

Bekannte Grenzen des Referenz-Systems: Barcodes wurden technisch geprüft, aber nicht mit einem echten
Scanner und gedrucktem Etikett. Kamera-Scan und Drucker nicht auf Geräten getestet. yEd-Datei nicht in yEd
geprüft. Keine unabhängige Sicherheitsprüfung. Daten und Sicherungen nicht verschlüsselt
(Mac-Festplattenverschlüsselung empfohlen).
