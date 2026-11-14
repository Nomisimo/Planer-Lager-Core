# 0. Wie dieses Dokument zu lesen ist
Geltungsbereich: Material und Geräte, Kennzeichnung (Etiketten), Scannen, Packen, Verladen, Rückgabe,
Ladezonen, Lagerarbeitsplätze, Kunden, Projekte und Jobs, Angebote (bis zur Annahme), Aufgaben, Dateien,
Kalender, Planungszeit, Suche, Verwaltung (Benutzer, Rollen, Sicherung, Sicherheit).
Ausdrücklich nicht Teil dieses Dokuments: Rechnungen, Zahlungen, Mahnwesen, Ausgaben, EÜR,
Umsatzsteuer, Steuerberater-Export (eigene Anweisung folgt). Die Schnittstellen dorthin stehen in Kapitel 11.
Status-Kennzeichen (stehen vor jeder Anforderung):
Kennzeichen                 Bedeutung
[IST]                       Ist im Referenz-Tool bereits gebaut und getestet. Bei Neubau muss sich das System genauso
                            verhalten. Verweis auf die Datei in Klammern.
[SOLL]                      Ist noch nicht gebaut, muss aber gebaut werden. Mit Priorität (P1 muss, P2 soll, P3 kann).
[ENTSCHEIDUNG]              Fachliche Frage, die der Auftraggeber (Sam) noch entscheiden muss. Bis dahin gilt der genannte
                            Standard.

Regel-IDs: R-xx = Fachregel, FA-xx = funktionale Anforderung, NFA-xx = nicht-funktionale Anforderung, T-xx =
Abnahmetest. Auf IDs wird in Tests und Commit-Nachrichten verwiesen.
Referenz-Implementierung: Ordner verleih/ (Python/Django). Wo Dateien genannt werden (z. B.
core/services.py), sind sie dort zu finden. Das Verhalten dieser Implementierung ist die verbindliche Vorlage,
wo dieses Dokument nichts anderes sagt.
