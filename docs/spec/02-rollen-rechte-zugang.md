# 2. Rollen, Rechte, Zugang
2.1 Rollen [IST] (core/rechte.py, Tabelle Rolle)
Rechte je Bereich mit Stufen '' (kein Zugriff), r (ansehen), w (ändern). w schließt r ein.
Rolle                                       Rechte (Bereich: Stufe)
Administrator                               alles, inkl. Bereich verwaltung
Büro / Disposition                          kunden w, projekte w, angebote w, packen w, zeiten w, zeitrechner w, rechnungen
                                            r, material r, geraete r, zonen r
Lagerleitung                                material w, geraete w, packen w, projekte r, angebote r, kunden r, zonen r,
                                            zeitrechner r
Lager / Techniker                           packen w, geraete r, material r, projekte r, zonen r
Lager-Arbeitsplatz                          packen w, geraete r (fest angemeldetes Konto)
Anzeige (Bildschirm)                        nur anzeige r (Ladezonen-Bildschirm)
Buchhaltung, Steuerberater (nur lesen)      siehe Anweisung Buchhaltung, hier nicht relevant

Bereiche: kunden, projekte, angebote, rechnungen, ausgaben, auswertung, material, geraete, packen,
zeitrechner, zeiten, zonen, anzeige, verwaltung.

2.2 Zugriffsregeln
 • R-01 Jede URL gehört genau einem Bereich (Regelliste REGELN, erste passende Regel gilt). Unbekannte
   Pfade sind nur für Administratoren. Eine neue URL muss in REGELN eingetragen werden, sonst ist sie
   gesperrt (sicherer Standard).

  • R-02 GET benötigt mindestens r; POST sowie GET-Formularseiten (/neu, /bearbeiten, /loeschen,
   /importieren, /hochladen, /pruefen) benötigen w.
 • R-03 Der Bereich verwaltung ist ausschließlich Administratoren vorbehalten (Einstellungen, Benutzer,
   Rollen, Stationen, Sicherung, Sicherheit, System, Admin-Oberfläche).
 • R-04 Ohne Anmeldung ist nichts erreichbar außer der Login-Seite.
 • R-05 Verweigerter Zugriff: Seite „Zugriff verweigert" (HTTP 403, Rolle nennen). Bei API/AJAX: JSON {"ok":
   false, "level": "error", "text": "Dafür fehlt dir die Berechtigung."} mit 403. Jede Verweigerung
   wird im Sicherheitsprotokoll vermerkt.
 • R-06 Rollen sind in der Oberfläche editierbar (eigene Rollen anlegen, Rechte je Bereich setzen). Eingebaute
   Rollen sind nicht löschbar. Jede Rolle entspricht einer gleichnamigen Django-Gruppe.
 • R-07 Mindestens ein Administrator muss immer bestehen (Herabstufen/Löschen des letzten Admins wird
   verhindert).

2.3 Anmeldung [IST] (core/views_sicherheit.py, core/sicherheit.py)
 • R-08 Sperre: 5 Fehlversuche je Benutzername oder 20 je Adresse innerhalb von 15 Minuten sperren die
   Anmeldung (HTTP 429, Meldung ohne Hinweis, ob der Benutzer existiert). Ein erfolgreiches Login setzt den
   Zähler des Benutzers zurück. Die Sperre gilt auch bei richtigem Passwort.
 • R-09 Passwortregeln: mindestens 10 Zeichen, nicht nur Ziffern, keine häufigen Passwörter, nicht dem
   Benutzernamen ähnlich. Passwörter werden nur gehasht gespeichert.
 • R-10 Sitzung: 12 Stunden ab letzter Aktivität. Cookies HttpOnly, SameSite=Lax.
 • R-11 /admin/login/ leitet auf die gesicherte Anmeldeseite um.

2.4 Lagerarbeitsplätze [IST] (core/station.py, core/views_station.py, Modelle Arbeitsplatz,
Mitarbeiter)
Ein Arbeitsplatz ist ein fest eingerichtetes Gerät im Lager (z. B. „Packplatz 1", „Rückgabe") mit eigenem,
dauerhaft angemeldetem Konto der Rolle „Lager-Arbeitsplatz".
 • R-11a Der Platz ist gesperrt, bis sich ein Mitarbeiter (Name aus Liste, optional PIN) entsperrt. Mitarbeiter
   haben kein Benutzerkonto.
 • R-11b Automatische Sperre nach sperrzeit_minuten (Standard 10) ohne Eingabe. Jede erlaubte Anfrage
   verlängert die Zeit (ausgenommen Sperrbildschirm-Seiten).
 • R-11c 5 falsche PIN-Eingaben in Folge sperren das Entsperren für kurze Zeit (30 Sekunden Wartezeit,
   danach neuer Versuch).
 • R-11d Ein Arbeitsplatz-Konto darf nur diese Seiten öffnen: Station-Seiten, Logout, Code-Suche,
   Packen/Rückgabe/Status/Verladen/Packen-öffnen eines Projekts, Scan/Vermisst/Prüfung-API,
   Zonen-Anzeige, Gerätedetail, Packliste. Alles andere leitet zur Arbeitsplatz-Startseite um (ERLAUBT-Muster).
 • R-11e Arbeitsplatz-Arten: packen (an einer Ladezone, Startseite öffnet das Projekt der Zone) und rueckgabe
   (Rückgabe/Prüfung, Startseite = Rückgabe ohne Projektwahl).
 • R-11f Alle Buchungen am Arbeitsplatz speichern den Mitarbeiter (nicht nur das Konto).
 • R-11g Option funktionstest: Bei Rückgabe fragt der Platz je Gerät „In Ordnung (1) / Mangel (2)" ab (siehe
   R-47).
