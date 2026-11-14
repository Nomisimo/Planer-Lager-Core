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

