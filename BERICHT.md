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

## Phase 16 – Browser-Version – 15.11.2026
Gebaut: WEB-01 bis WEB-15, INT-07. Plattform-Schicht `plattform.js` (einziger Ort mit `window.lagerShell`), Browser-Login per HttpOnly-Cookie + CSRF, Handoff in beide Richtungen („Im Browser öffnen“, „In Desktop-App öffnen“), `npm run build:web` (index ohne Inline-Script, gehashte Assets, Manifest), Auslieferung `/materialplaner/`, `/productionplaner/` mit no-store + CSP, Portal `/` nach Rechten, 503-Seite bei fehlendem Bundle, Docker-Stufe baut beide Web-Apps, Etikettendruck im Browser über das Druckfenster mit `@page`.
Geprüft: Unit+API grün, E2E web.test.js (5 Tests, Chromium als Browser + Desktop-Electron gemischt), huelle, nahtlos, etiketten, seriell, arbeitsplatz grün; erste Erkundungsrunde mit 3 Personas (disponentin, lagerhelfer, admin).
Funde der Erkundung:
- BUG-1 App-Schalter nahm die Seite mit in die andere App, auch wenn es sie dort nicht gibt („Seite nicht gefunden“). Behoben: Ziel nur, wenn die Seite in der anderen App existiert, sonst Übersicht; Packansicht → Projekt im Productionplaner.
- BUG-2 Browser-Konsole zeigte vor der Anmeldung einen 401-Fehler (Sitzungsprüfung über /ich). Behoben: öffentliches `/api/v1/sitzung` antwortet 200 mit angemeldet ja/nein.
- Stolpersteine behoben: Scan-Karte ohne „·“ vor der Uhrzeit, Fehltext bei unbekanntem Code nennt den Menüweg statt „im Materialplaner“, nach dem Verladen nur noch eine Erfolgsmeldung, Packplatz ohne Ladezone verweist auf Material & Lager → Ladezonen, Sicherheits-Check erklärt NODE_ENV für Nicht-Techniker.
- Offen (beobachtet, nicht nachgestellt): Angebotsposition schien nach Browser-Zurück verloren; wird in Phase 17 mit GLEICH (Eingaben behalten) und NUTZER-01 gezielt geprüft.
Nicht geprüft: Docker-Image nur in der CI gebaut (VM ohne Docker-Dienst); Safari/Firefox selbst.

## Phase 17 – Gleichzeitig arbeiten (GLEICH), Zwischenstand – 15.11.2026
Gebaut: GLEICH-01 bis GLEICH-07. Fassung (`version`) an 27 Tabellen per Trigger, jede PUT/PATCH-Route verlangt sie (Route-Registry-Test), 409 mit Name/Uhrzeit und `aktuell`, Vergleich „Deine Werte | Aktuelle Werte“, Änderungsband, „wurde von <Name> gelöscht“ im Formular und in der Packansicht, Hinweis in M bei Angebotsänderung, Präsenz-Chips im Projektkopf (P-Projekt, P-Angebot, M-Packen).
Geprüft: Server 137 + GLEICH-Tests grün, E2E gleich.test.js (3 Tests: P-Desktop + P-Browser, M + P Desktop, M + P + Browser mit demselben Nutzer).
Funde:
- BUG-3 Zwei gleichzeitige Scans desselben Geräts: der abgewiesene Scan meldete „ist bereits in Projekt null null“. Ursache: Nach dem Warten auf die Zeilensperre prüft PostgreSQL nur die Gerätezeile neu, das mitgejointe Projekt blieb leer. Behoben: Projekt per Unterabfrage. Roter Test GLEICH-03 zuerst.
- KLICK-01–06: Klick-Durchlauf über Materialplaner und Productionplaner (Electron und Browser, 5 Rollen) und station-web mit Demo-Daten. 77 Knöpfe/Dialoge ausgelöst, 13 Formulare leer abgeschickt, alle Menüeinträge besucht, keine Konsolen-/Serverfehler, alle Seiten unter 1 s, Rechte stimmen. Bericht: `e2e/artefakte/klick-bericht.json`.
- BUG-4 Bei 1024×768 war die Kopfleiste breiter als das Fenster (waagerechter Rollbalken, Name abgeschnitten). Behoben: Rasterspalte `minmax(0,1fr)`, Codefeld schmaler, Name mit Auslassung. Roter Test KLICK-04 zuerst.
- BUG-5 Material-, Geräte- und Kunden-Detail zeigten beim Laden eine leere Seite. Behoben: „Lädt …“ wie bei Projekten. Roter Test KLICK-03 zuerst.
- BUG-6 Mangel beim Funktionstest der Rückgabe setzte das Gerät auf „Defekt“, legte aber keine Reparatur an; in Reparatur › Offen war es unsichtbar. Behoben: offene Reparatur mit Mangeltext und Projekt, Live-Ereignis an die Werkstatt. Roter Test NUTZER-03 zuerst.
- BUG-7 Denselben Code im Codefeld ein zweites Mal scannen (z. B. nach gebuchter Etiketten-Lieferung) tat nichts, die alte Fehlermeldung blieb stehen. Ursache: gleiche Adresse löst kein `hashchange` aus. Behoben: Navigation zur offenen Adresse lädt die Seite neu. Roter Test NUTZER-04 zuerst.
- BUG-8 Wiederherstellung einer Sicherung brach mit Serverfehler ab („kunde_id darf nicht leer sein“), sobald ein Projekt nach dem Anlegen seiner Jobs geändert worden war. Ursache: Der Job-Trigger suchte beim Einspielen sein Projekt, das in der Sicherung erst später kam. Behoben: Beim Wiederherstellen laufen eigene Trigger nicht (Fremdschlüssel bleiben). Roter Test T-22 (Job + geändertes Projekt) und NUTZER-06 zuerst.
Annahmen: D-118, D-119, D-120
Annahmen: D-114, D-115, D-116

## Phase 15 – Abschluss – 14.11.2026
Gebaut: Lücke FA-05 geschlossen (Reservierungen je Artikel im wählbaren Zeitraum); Fehler UI-4 behoben (Knöpfe in klickbaren Tabellenzeilen öffneten beim Löschen zusätzlich den Bearbeiten-Dialog, weil die Aktion erst im nächsten Mikrotask lief); Server-Adresse in der installierten App auf der Anmeldeseite eintragbar (vorher nur per Umgebungsvariable); Installer per GitHub Actions für Windows x64 und macOS Apple Silicon + Intel (D-103); Sichtprüfungs-Test e2e/themen.test.js (Hauptseiten beider Apps in Hell, Dunkel, Grün/kompakt); Befunde der Sichtprüfung behoben: Status-Badges wählen die Schrift mit dem besseren Kontrast (Orange/Grau vorher weiß, < 4,5:1), abgeschnittene Auswahl „Projekte und Jobs“.
Geprüft: `npm run spec:abdeckung` 166/166; Unit+API, alle 31+ E2E-Dateien einzeln, Materialplaner- und Productionplaner-Tests grün, Lint sauber; Endabnahme durch unabhängigen Prüfer (Stichprobe über alle Kapitel, Akzeptanztexte wörtlich geprüft für Verfügbarkeit, Rabatt, Verladen, Rückgabe, Arbeitsplatz, Sicherheit); Paket für Linux lokal gebaut und gestartet (Inhalt nur dist-app).
Nicht geprüft: Installer auf echtem Windows-PC und Mac (CI-Bau für Windows, Mac arm64 und Mac Intel in beiden Apps grün, Mac-Signatur geprüft); echter Etikettendrucker (FA-14 bleibt [~]); echte Handscanner (HID, Bluetooth-SPP, Netzwerk) – alle simuliert; echter Cloud-Host mit Domain; Safari/Firefox/Edge selbst.
Bekannte Grenzen: Datumsfelder zeigen in der Test-VM den Platzhalter „dd.mm.yyyy“ (Chromium-Sprachdatei), Eingabe und Anzeige sind TT.MM.JJJJ; das Seitenmenü scrollt bei 900 px Fensterhöhe; Mac-App nicht bei Apple beglaubigt (erster Start per Rechtsklick → Öffnen); Android-APK (Phase Z) nicht gebaut.
Annahmen: D-103

## Phase 14 – SOLL P3 + Rest – 14.11.2026
Gebaut: FA-08 Lagerorte (Artikel, abweichend je Gerät, Anzeige in Packliste und Packlisten-PDF); FA-09 Schadensdoku mit bis zu 10 Fotos, Projekt + Kunde, optional Reparatur; FA-28 Ansprechpartner + Kundenhistorie; FA-39 Projektvorlagen; FA-40 wiederkehrende Aufgaben, Glocke mit Live-Benachrichtigungen, E-Mail per SMTP (eigener kleiner Client); Kamera-Scan im Arbeitsplatz-Web (html5-qrcode lokal); Bluetooth-Scanner im seriellen Modus über Web Serial.
Geprüft: Unit+API grün (u. a. lagerorte, kontakte, vorlagen mit Fake-SMTP-Server, Zeilenleser); E2E lagerorte, kontakte, vorlagen, kamera (künstliche Kamera mit QR-Video), seriell (echte Portliste von Electron, Codes über simulierten Port, Neuverbinden).
Nicht geprüft: echter SMTP-Server eines Anbieters; echte Kamera eines Tablets; echter Bluetooth-Scanner.
Annahmen: D-97–D-102

## Phase 13 – SOLL P2 – 14.11.2026
Gebaut: FA-06 Inventur, FA-07 Reparatur/Wartung (Status „bald“ ≤ 30 Tage), FA-20 Teilrückgabe/Nachpacken, FA-21 Lieferschein + Rückgabeprotokoll, FA-37 Personal, FA-38 Fahrzeuge, FA-55 Änderungsprotokoll (Datenbank-Trigger); FA-49 SOLL bestätigt.
Geprüft: Unit+API und E2E der Phase grün; unabhängige Abnahme fand eine Lücke (FA-07 „bald fällig“), behoben.
Nicht geprüft: Druck der PDFs auf Papier.
Annahmen: D-92–D-96

## Phase 12 – Nahtlos (App-übergreifend) – 14.11.2026
Gebaut: Projektseite in P zeigt Lager-Stand (Ladezone / verladen) live (D-91); Projekt-Detail liefert den Ladezonen-Namen.
Geprüft: E2E e2e/nahtlos.test.js mit beiden Apps gleichzeitig: INT-02 Angebot in P annehmen → Packliste in M ohne Neuladen; INT-03 Packen + Verladen in M → P zeigt „Läuft“, Zone frei, „2 / 2“ gepackt; INT-04 Codefeld in P (Gerät) öffnet M beim Gerät mit Handoff, Codefeld in M (Projekt) öffnet P; INT-05 Netzwerk-Scanner bucht am Arbeitsplatz-Web (Browser), M-Geräteseite und P-Projektseite aktualisieren sich; INT-06 5 Scans offline, wiederverbinden → alle gebucht in Erfassungsreihenfolge, P zeigt „5 / 5“. INT-01 seit Phase 1. Unit+API alle grün (N+1-Zählung im Leistungstest jetzt stabil auf Client-Ebene).
Nicht geprüft: Deep-Link in eine bereits laufende zweite App-Instanz auf echtem macOS/Windows (im Test wird die Ziel-App mit dem Link gestartet); echter Netzwerk-Scanner (per HTTP simuliert).
Annahmen: D-91

## Phase 11 – Cloud-Betrieb, Offline, Leistung – 14.11.2026
Gebaut: Server-Image (Dockerfile) und deploy/ mit Caddy (HTTPS, Let's Encrypt), Server, PostgreSQL 16, Healthcheck, Betriebsanleitung deploy/BETRIEB.md (FA-56, NFA-01/02: HSTS, Secure-Cookies, erlaubte Hostnamen); verschlüsselte Sicherungen AES-256-GCM mit BACKUP_SCHLUESSEL (NFA-04); FA-22 Offline-Puffer für Scans (localStorage, Anzeige „n Scans warten“, Nachbuchen in Reihenfolge, Server bucht jede Offline-ID nur einmal); NFA-05 Testdaten groß (`npm run seed -- --gross`) und Leistungstest; NFA-06 Integritätstests auf Datenbankebene; NFA-07/08 Prüfung Fachcode-Trennung, Tests ohne Netz (Netzsperre in `npm test`); NFA-09 Browser-Ziele für das Arbeitsplatz-Web.
Geprüft: Docker-Image gebaut und im Container gestartet (/health ok); Unit+API alle grün (neu: leistung, integritaet, testbarkeit, station-web browser, FA-22 im Scan-Test, NFA-02/NFA-04); E2E offline grün. Messwerte bei 5.000 Geräten / 500 Projekten (Server-Antwort, Test-Container): alle Haupt-Endpunkte 3–20 ms mit 2–16 Abfragen, Scan unter 40 ms; Seitenaufruf in der App (Klick bis Tabelle) 58–92 ms. Sitzungs-Cookie im Netz mit Secure/HttpOnly/SameSite geprüft.
Nicht geprüft: echter VPS mit Domain und Let's-Encrypt-Zertifikat; Safari, Firefox und Edge selbst (nur Chromium vorhanden, Code ist für deren Versionen übersetzt); Penetrationstest (FA-56, extern).
Annahmen: D-86–D-90

## Phase 10 – Suche, Startseite, Verwaltung, Sicherung – 14.11.2026
Gebaut: FA-36 Suche über Kunden, Projekte, Angebote, Material, Geräte nur nach Leserecht, Treffer der anderen App per Deep-Link; FA-35 Startseite in beiden Apps (Kacheln je Rolle, „Diese Woche“ mit Starts und fälligen Rückgaben, meine Aufgaben, Schnellzugriff); Verwaltungsseiten Benutzer, Rollen, Einstellungen, Datensicherung, Sicherheit, System; FA-49 geprüfte Sicherung (Datenbank + Dateien) mit Aufbewahrung, Zweitkopie, Auto beim Start (> 20 h), Download, Wiederherstellung per Befehl und über die Oberfläche mit Vorab-Sicherung; FA-50 Check-Seite, Dateirechte absichern (auch beim Start, `npm run lager -- sicherheitscheck --absichern`); FA-51 Ping, Wartung, Neustart; FA-53 Plan-Symbole mit yEd-Bibliothek und SVG-ZIP; NFA-03 Löschfristen, Datenauskunft, Anonymisieren.
Geprüft: Unit+API alle grün (neu: uebersicht, system, plansymbole, datenschutz, domain plansymbole/datenschutz); E2E neu: uebersicht, verwaltung (T-17, T-18), plansymbole, datenschutz grün; T-22 als Server-Test mit echtem Befehl `restore`; T-23 schon seit Phase 3. Screenshots: FA-35-start-*, FA-36-suche, T-17-verweigert, T-18-sperre, FA-47-benutzer, FA-49-sicherung, FA-50-sicherheit, FA-51-system, FA-53-plansymbole, NFA-03-anonymisiert.
Nicht geprüft: Symbolbibliothek in yEd selbst; Neustart im echten Docker-Container; Zweitordner auf echtem Netzlaufwerk.
Annahmen: D-80–D-85
Abnahme (spec-pruefer + volle E2E 19/19): 7 OK, 5 Lücken geschlossen (FA-35 Schnellzugriff im E2E, FA-47 Passwort setzen/Deaktivieren beendet Sitzungen getestet, FA-48 alle Einstellungsgruppen getestet, FA-53 auch Verbrauchsartikel in der Bibliothek, NFA-03 Zugriffe auf Kunden im Sicherheitsprotokoll).

## Phase 9 – Planungszeit – 14.11.2026
Gebaut: Zeiteintrag 3.5 mit Timer je Benutzer (höchstens einer läuft), Herzschlag aus beiden Apps, Stopp bei fremdem Projekt, Nicht-Planungsseite (Packen/Rückgabe, auch im Materialplaner) oder 5 min Leerlauf (R-62–R-64); Timer in der Kopfleiste mit Stopp-Knopf; „Planungszeit starten“ am Projekt; Nachbuchen mit „1:30“/„90“/„1,5“ (R-65); Satz aus Posten „Technische Projektleitung“ (Stunde oder Tagessatz ÷ Stunden) bzw. Ersatz-Stundensatz × Planungsanteil, Integer-Cent (R-66); Seite „Planungszeit“ mit Filter, Summe je Projekt, CSV; Reiter „Zeiten“ im Projekt; jeder Eintrag als Position im Rechnungsentwurf des Projekts.
Geprüft: Unit+API alle grün (neu: domain planung, server zeit); E2E neu e2e/planungszeit.test.js (T-20) grün. Screenshots: T-20-timer, FA-46-planungszeit.
Annahmen: D-76–D-79
Abnahme (spec-pruefer): 8 OK, 0 Lücken. Hinweise umgesetzt: Lauf unter 60 s wird sicher verworfen, gleichzeitiger Doppelstart ergibt genau einen Timer (getestet).

## Phase 8 – Ladezonen, Arbeitsplätze, Anzeige – 14.11.2026
Gebaut: Ladezonen 3.10 mit Verwaltung, Zuweisen/Freigeben, Prioritätsliste, automatischer Verteilung per Knopf und beim Anmelden (R-55–R-58), Seite „Ladezonen“ im Materialplaner; Arbeitsplätze und Mitarbeiter (Verwaltung → Arbeitsplätze) mit Einrichtungscode; Arbeitsplatz-Web unter /station: Sperrbildschirm mit Namen + PIN, 5 falsche PINs → 30 s, Sperrzeit, ERLAUBT-Muster, Packplatz mit Projekt der Zone, Rückgabeplatz mit Tasche und Funktionstest (Tasten 1/2), Mitarbeiter an jeder Buchung; Anzeige-Bildschirm mit QR, live. Netzwerk-Scanner jetzt mit echtem Fremdschlüssel auf den Arbeitsplatz.
Geprüft: Unit+API alle grün (neu: domain zonen/station, server zonen/station); E2E neu e2e/ladezonen.test.js (T-06, T-21), e2e/arbeitsplatz.test.js (T-16 im echten Browser) grün. Screenshots: FA-23-ladezonen, FA-25-arbeitsplaetze, T-16-sperrbildschirm, R-11g-funktionstest, FA-24-anzeige.
Kiosk: `materialplaner --arbeitsplatz` (E2E e2e/kiosk.test.js). Nicht geprüft: echter Fernseher/Touchscreen, Kiosk-Vollbild unter Windows/macOS.
Annahmen: D-69–D-75
Abnahme (spec-pruefer + volle E2E 14/14): 16 OK, 2 Lücken geschlossen (R-11b Verlängern/Nicht-Verlängern getestet; R-11d Zonen-Anzeige am Lagerplatz trotz Rolle ohne Bereich „anzeige“, tote Route entfernt). Zusätzlich: Anzeige-Daten am gesperrten Lagerplatz nicht mehr sichtbar, abgeschalteter Platz zeigt verständliche Meldung. Bekannt, bewusst so: WebSocket-Ereignisse (nur Typ/ID) erreichen auch gesperrte Plätze.

## Phase 7 – Rückgabe – 14.11.2026
Gebaut: FA-18 Rückgabeansicht je Projekt (Stand noch draußen/zurück/vermisst, Zurückscannen, aktive Tasche mit „Offene als vermisst melden“ und „Tasche beenden“, „Alle offenen als vermisst melden“), freie Rückgabe auf der Scan-Seite (Projekt ergibt sich aus dem Gerät), R-47 Funktionstest nach jedem Scan (bestanden/Mangel mit Notiz), R-49/R-50 auch für die Geräte-Knöpfe „Vermisst“/„Gefunden“ (Projekt bleibt, Case leer, „Gefunden“ nur bei Vermisst), API `GET /api/v1/projekte/:id/rueckgabe`, Deep-Link aus dem Productionplaner.
Geprüft: Unit+API alle grün (neu: R-49/R-50-Test in stammdaten.test.js, FA-18 im Rückgabe-Test); E2E neu e2e/rueckgabe.test.js (T-12–T-15) grün. Screenshots: FA-18-rueckgabe, R-47-funktionstest.
Nicht geprüft: Rückgabe am Arbeitsplatz-Browser (station-web kommt in Phase 8).
Annahmen: D-67, D-68
Abnahme (spec-pruefer): 8 OK, 2 Testlücken (R-46 Text „nicht zugeordnet“, R-50 Bewegung/409-Text) geschlossen; zusätzlich: Funktionstest an ausgemusterten/verkauften Geräten → 409.

## Phase 6 – Scannen, Packen, Verladen, Scanner – 14.11.2026
Gebaut: Scan-Kern 5.5 (Schritte 1–9 in einer Transaktion, inkl. Rückgabe, vermisst → wieder aufgetaucht, aktive Tasche R-46), R-23 Projektcode → Packansicht, R-70 im Scan, Scan-API 7.2 (scan, pruefung = Funktionstest R-47, vermisst R-48/R-49), FA-19 Packstatus, R-60/R-61 Verladen/Wieder öffnen mit R-14, HID-Erkennung global (UI-3), Netzwerk-Scanner-Gateway TCP + HTTP mit Token, Verwaltung „Scanner“, FA-15 Scan-Seite (Modus, Projekt, Verlauf, Farbe, Ton), FA-17 Packansicht live mit Fortschritt und Verladen, FA-16 Sprung PP → Packansicht.
Geprüft: Unit+API alle grün (neu: server/scannen.test.js 9, server/scanner.test.js, domain/scannen.test.js 5); E2E neu e2e/scannen.test.js (T-07–T-11, Handscanner, Netzwerk-Scanner) grün. Screenshots: FA-15, FA-17.
Nicht geprüft: echter Handscanner/Netzwerk-Scanner-Hardware (simuliert per Tastatur, TCP-Client und HTTP), Kamera-Scan (kommt zuletzt).
Bekannte Fehler/Grenzen: T-06 braucht Ladezonen (Phase 8). Arbeitsplatz-Zuordnung der Scanner ist eine Nummer ohne Fremdschlüssel bis Phase 8. Rückgabeansicht/Funktionstest-Oberfläche folgt in Phase 7 (API fertig).
Annahmen: D-62–D-66
Abnahme (spec-pruefer + ui-pruefer): 0 Fehler. Geschlossen: Handscanner-Einstellungen je Gerät (Schwellwert, Mindestlänge, Präfix/Suffix), Vibration mit Ton, FA-15-Antwortzeit < 2 s im E2E geprüft, FA-16 in Testnamen, Case-Inhalt defekt/fremdes Projekt getestet, Rückgabetext Mehrzahl, größere Rückmeldung, 44-px-Ziele, Verlauf mit Symbolen, Leerzustand, Menü-Markierung in der Packansicht. Offen: Kamera-Scan (Phase 14).

## Phase 5 – Angebote, Verfügbarkeit, Packliste – 14.11.2026
Gebaut: 3.11 Angebot/Position/Fassung (A-JJJJ-NNN), Zustand 4.2 mit Fassungsarchiv (PDF im Projektordner/Angebote), R-24–R-27 Reservierung/Verfügbarkeit (SQL-Sicht `reservierung`, Domain-Formeln), R-28–R-28c Preise und Zeitrechner, FA-41 Editor (Material, Verkauf, Personal mit Zeitrechner, freie Positionen, Reihenfolge, Rabatt, Texte, Gültigkeit), FA-42 Live-Überbuchungshinweis + Reservierungen je Artikel (Materialplaner), FA-43 Statuswechsel mit Projektstatus-Folge (D-55), FA-44 Packliste Bildschirm + PDF mit Set-Vorschlag, FA-45 Kalkulator + Zeitrechner, Kopfkennzahl Angebotswert.
Geprüft: Unit+API alle grün (neu: domain/angebot.test.js 13, server/angebote.test.js 6 inkl. FA-41-Beispiel 50,00 €); E2E neu e2e/angebote.test.js (T-04, T-05, FA-41–45) grün. Screenshots: FA-41, FA-44, FA-45, T-05.
Nicht geprüft: Inhalt/Optik der PDFs nur als gültiges PDF geprüft; Firmenlogo im PDF folgt mit Verwaltung (Phase 11).
Bekannte Fehler/Grenzen: Einstellungen Kleinunternehmer/USt-Satz nur per API änderbar, bis die Verwaltungsseite Einstellungen (FA-48) kommt.
Annahmen: D-55–D-61
spec-pruefer Phase 5: 18 OK, 0 Fehler, 3 Lücken; geschlossen: Firmenlogo im PDF (D-60, Test), Reihenfolge-Test, Kalkulator als Domain-Funktion mit Unit-Test, R-15 im Testnamen. ui-pruefer: Datumsfelder jetzt deutsch (D-61), Summen ohne Umbruch, Warnhinweis mit dunklem Text + Symbol, dunklere Status-Badges in der Packliste, klarer Tasche-Hinweis.

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

