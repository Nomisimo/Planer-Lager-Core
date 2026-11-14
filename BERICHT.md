# BERICHT – ehrlicher Stand (Spec 1.4 „Ehrlicher Bericht“, 10.1 Nr. 6)

Je Phase ein Eintrag, neueste oben. Kurz, sachlich.

```
## Phase N – <Titel> – <Datum Uhrzeit>
Gebaut: <IDs>
Geprüft: Unit x/x, API x/x, E2E <T-/INT-IDs> grün; Screenshots angesehen: ja/nein (welche)
Nicht geprüft: <z. B. echter Scanner, echter Drucker, macOS-Build, Windows-Build, echter Cloud-Host>
Bekannte Fehler/Grenzen: <…>
Annahmen: D-xx, D-yy
```

## Phase 5 – Angebote, Verfügbarkeit, Packliste – 14.11.2026
Gebaut: 3.11 Angebot/Position/Fassung (A-JJJJ-NNN), Zustand 4.2 mit Fassungsarchiv (PDF im Projektordner/Angebote), R-24–R-27 Reservierung/Verfügbarkeit (SQL-Sicht `reservierung`, Domain-Formeln), R-28–R-28c Preise und Zeitrechner, FA-41 Editor (Material, Verkauf, Personal mit Zeitrechner, freie Positionen, Reihenfolge, Rabatt, Texte, Gültigkeit), FA-42 Live-Überbuchungshinweis + Reservierungen je Artikel (Materialplaner), FA-43 Statuswechsel mit Projektstatus-Folge (D-55), FA-44 Packliste Bildschirm + PDF mit Set-Vorschlag, FA-45 Kalkulator + Zeitrechner, Kopfkennzahl Angebotswert.
Geprüft: Unit+API alle grün (neu: domain/angebot.test.js 13, server/angebote.test.js 6 inkl. FA-41-Beispiel 50,00 €); E2E neu e2e/angebote.test.js (T-04, T-05, FA-41–45) grün. Screenshots: FA-41, FA-44, FA-45, T-05.
Nicht geprüft: Inhalt/Optik der PDFs nur als gültiges PDF geprüft; Firmenlogo im PDF folgt mit Verwaltung (Phase 11).
Bekannte Fehler/Grenzen: Einstellungen Kleinunternehmer/USt-Satz nur per API änderbar, bis die Verwaltungsseite Einstellungen (FA-48) kommt.
Annahmen: D-55–D-59

## Phase 4 – Projekte, Jobs, Aufgaben, Dateien, Kalender – 14.11.2026
Gebaut: 3.2–3.4, Zustand 4.1, R-12, R-13 (Ladezone frei), R-14 (Hook für Verladen), R-20, Projektordner mit Unterordnern, FA-29 (Liste mit Filtern, Detail mit Kopfkennzahlen), FA-30 (Jobs, „Jobs nach Gewerk“), FA-31, FA-32 (auch globale Liste), FA-33 (Upload bis 50 MB, sichere Auslieferung), FA-34 Monatskalender.
Geprüft: Unit+API alle grün (neu: domain/projekt.test.js, server/projekte.test.js 8 Tests); E2E gesamt 8/8 grün, neu e2e/projekte.test.js (T-19, T-24 in UI + API). Screenshots erzeugt: FA-29, FA-33, FA-34.
Nicht geprüft: echte Zip-Ausgabe des Projektordners (D-19, folgt mit Sicherung), PDF-Ansicht in der App (object-Einbettung mit Download-Hinweis) nicht optisch geprüft.
Bekannte Fehler/Grenzen: Angebotswert netto = 0 bis Phase 5 (D-54). Reiter „Angebote“ und „Zeiten“ im Projekt sind Platzhalter bis Phase 5/9.
Annahmen: D-50–D-54
spec-pruefer Phase 4: 12 Befunde; geschlossen: Upload atomar ohne Namensdoppel (paralleler Test), Abbruch → 400, >50 MB chunked → 413, kein decodeURIComponent, UI-5-Folgeschritte, Tests Job-unter-Job per PUT, Statusfilter, download=1, PNG inline, Lager-Rolle 403. Offen gelassen: R-14-Aufruf erst mit Verladen (Phase 6), Angebotswert mit Phase 5.

## Phase 3 – Etiketten, Kabel, Etiketten-Bestellung – 14.11.2026
Gebaut: eigener Code-128-Encoder, QR (qrcode), Etiketten-Vorlagen 3.13 mit Standard je Art, FA-10 Druck (Seitengröße aus Vorlage, eine Seite je Etikett), FA-11 Designer (ziehen, Größe, drehen, zentrieren, Raster 0,5 mm, Vorschau), Kabel 3.12/R-29/R-29a/FA-12, Bestellung R-67–R-70 (PDF + CSV ohne Bindestrich, Lieferung per Scan/Abhaken, Meldung mit Bestellnummer), Zustand 4.4, Kabel-Assistent R-73, R-72 „bestellen“.
Geprüft: Unit+API alle grün (neu: server/etiketten.test.js 8 Tests, domain/etiketten.test.js); E2E T-01, T-02, T-03, FA-10/11/12, R-72 grün (e2e/etiketten.test.js); Druck im Testmodus als PDF geprüft (2 Seiten à 62×29 mm). Screenshots erzeugt: R-73-kabel-assistent, T-02, T-03, FA-10, FA-11.
Nicht geprüft: echter Etikettendrucker (FA-14 braucht Hardware, offen), Druckdialog unter macOS/Windows.
Bekannte Fehler/Grenzen: Logo-Element bleibt leer, bis in der Verwaltung ein Firmenlogo hinterlegt werden kann (Phase 11). Designer-Vorschau nutzt ein Platzhalter-QR (Server-Vorschau mit echtem QR vorhanden).
spec-pruefer Phase 3: 0 Fehler, 10 Testlücken; geschlossen: Größen-Griff (E2E), eigene Länge (E2E), R-73 Zeilenpreis-Rundung, R-72 „keine“/Verbrauch, UI-5-Text R-67. Offen gelassen: PDF-Inhalt (nur Format geprüft), Kabelfarben-Hinweis nur per API getestet, R-70 muss im Scan-Kern (Phase 5) mitgenutzt werden.
Annahmen: D-42–D-49

## Phase 2 – Material, Geräte, Kunden – 14.11.2026
Gebaut: Kategorien 3.6, Artikel FA-01/FA-02/R-71/R-72, Geräte FA-03/FA-04/R-16–R-22/R-30, Prüfstatus 5.10, Kunden FA-26/FA-27 inkl. PDF-Formular und Import.
Geprüft: Unit+API+E2E grün; spec-pruefer Phase 2: 15 Befunde, alle behoben (u. a. R-71 serverseitig, manueller Status nur ohne zugeordnet/gepackt, Kategorie-Live-Update, Grenzwert- und Paritätstests 3.7/3.8/5.10) oder eingetragen (D-42 Photon laut NFA 9).
Nicht geprüft: Adresssuche gegen echten Dienst (im Test gemockt).
Bekannte Fehler/Grenzen: Spalte „Reservierungen“ zeigt „–“ bis Verfügbarkeit (Phase 5).
Annahmen: D-37–D-44

## Phase 0+1 – Gerüst, Server-Grundgerüst, App-Hüllen – 14.11.2026
Gebaut: npm-Workspaces (domain, db, server, client, ui, shell, station-web), Migrations-Runner, Electron-Hülle beider Apps (gemeinsam in @lager/shell), CI-Workflows; R-01–R-11, FA-54 (TOTP), FA-48 Grundteil, FA-52, NFA-01 (Header, CSRF, CSV-Schutz), UI-1, UI-2, UI-4–UI-8, WebSocket-Hub, Handoff/Deep-Links, INT-01.
Geprüft: Unit+API alle grün (domain, db, server, client, ui, shell); E2E rauchtest + huelle (UI-1, INT-01) grün; Screenshots angesehen: ja (Productionplaner Admin hell). spec-pruefer Phase 0/1: Befunde zu R-10 (Cookie gleitend), R-05 (Seite Zugriff verweigert), R-08 (Fenster-Test), CSV, Design-Prüfung, UI-6 (Systemwechsel) behoben; R-01/R-09/UI-1/3.15-download als D-33–D-36 eingetragen.
Nicht geprüft: CI-Läufe auf GitHub (Secret LAGER_REPO_TOKEN evtl. nötig, D-25), macOS/Windows-Builds, echter Cloud-Host, Deep-Link-Registrierung im Betriebssystem (im Test über argv simuliert), safeStorage-Verschlüsselung unter Linux-Testmodus (Fallback ohne Schlüsselbund).
Bekannte Fehler/Grenzen: Startseiten sind Platzhalter (FA-35 folgt Phase 10).
Annahmen: D-21–D-36

