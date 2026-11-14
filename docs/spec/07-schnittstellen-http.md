# 7. Schnittstellen (HTTP)
Alle Pfade relativ zur Basisadresse. Bereich = nötige Berechtigung (R-01/R-02).

7.1 Seiten (Auswahl, vollständig in core/urls.py)
Pfad                                                                Zweck               Bereich
/                                                                   Startseite          start
/kunden/, /kunden/neu/, /kunden/<id>/,                              Kunden              kunden
/kunden/<id>/bearbeiten/
/projekte/, /projekte/neu/, /projekte/<id>/,                        Projekte/Jobs       projekte
/projekte/<id>/bearbeiten/,
/projekte/<id>/duplizieren/,
/projekte/<id>/jobs-anlegen/
/projekte/<id>/aufgaben/neu/,                                       Aufgaben            projekte
/projekte/aufgaben/<id>/umschalten/,
/projekte/aufgaben/<id>/loeschen/, /aufgaben/
/projekte/<id>/dateien/hochladen/,                                  Dateien             projekte
/projekte/dateien/<id>/, .../loeschen/
/kalender/                                                          Kalender            projekte
/projekte/<id>/packen/, /rueckgabe/, /verladen/,                    Packen/Lager        packen
/packen-oeffnen/, /status/, /zone/, /anzeige/
/angebote/...                                                       Angebote,           angebote / packen
                                                                    Packliste
/material/, /material/neu/,                                         Material            material (Bestand: packen)
/material/kabel-assistent/, /material/<id>/...
/geraete/, /geraete/<id>/...                                        Geräte              geraete (geprueft/vermisst/gefunden:
                                                                                        packen)
/etiketten/, /etiketten/vorlagen/...,                               Etiketten           material
/etiketten/kabelfarben/, /etiketten/bestellungen/...
/scan/, /code/                                                      Scannen,            packen
                                                                    Code-Suche
/zonen/, /zonen/auto/, /zonen/<id>/anzeige/                         Ladezonen           zonen / packen / anzeige
/zeiterfassung/...                                                  Planungszeit        zeiten
/station/...                                                        Arbeitsplatz-Seit   (Stations-Middleware)
                                                                    en
/suche/                                                             Suche               start
/verwaltung/, /einstellungen/, /benutzer/...,                       Verwaltung          verwaltung
/stationen/..., /mitarbeiter/..., /backup/...,
/sicherheit/, /system/...

7.2 JSON-Schnittstellen
POST /api/scan/ (Bereich packen, CSRF-Token nötig)

Parameter: code, modus (hinzufuegen|packen|rueckgabe), projekt (ID), optional tasche (Code der aktiven
Tasche), optional angebot (ID für Packlisten-Abgleich).
Antwort (200): {level, text, meldungen[], tasche|null, code, artikel_id, ist_case,
projekt{id,nummer,name}|null}; bei Projektcode zusätzlich weiter (URL).

POST /api/pruefung/: code, ergebnis (ok|mangel), notiz -> {ok, status, text}; unbekanntes Gerät 404.

POST /api/vermisst/: codes[], tasche -> {gemeldet[], tasche}.
GET /projekte/<id>/status/ -> aktueller Packlistenstand als JSON.

GET /zonen/<id>/anzeige/daten/ -> Daten für den Bildschirm (Projekt, QR, Fortschritt).

 POST /zeiterfassung/ping/ (Herzschlag), /zeiterfassung/timer/start|stop/.

GET /api/adresse/?q=... -> Adressvorschläge (serverseitiger Aufruf des Dienstes; Schlüssel nie an den
Browser).
Fehlerformat bei verweigertem Zugriff und Gesperrt: siehe R-05, R-11d; Arbeitsplatz gesperrt: HTTP 423 mit
{"gesperrt": true}.
