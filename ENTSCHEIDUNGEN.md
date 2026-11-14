# ENTSCHEIDUNGEN

Jede Annahme, Abweichung von der Spec oder offene Frage. Format:
`D-xx | Datum | Thema | Entscheidung | Grund | betroffene IDs | von (Sam/Claude)`
Sam prüft diese Liste. Claude ändert getroffene Einträge von Sam nie, sondern ergänzt neue.

## Vom Auftraggeber festgelegt (Setup 14.11.2026)
- D-01 | 14.11. | Betrieb | Zentraler Server **in der Cloud** (Docker, PostgreSQL 16, Caddy/HTTPS), alles darüber synchronisiert. Weicht ab von Spec 1.2 Nr. 6 und NFA-02 (nur 127.0.0.1). Folge: FA-54 (2FA) und FA-56 (Server-Betrieb) in Phase 1/11 statt P2/P3, Sicherungen verschlüsselt, FA-22 Offline hochgestuft. | Wunsch Sam | 1.2, NFA-02, FA-22, FA-54, FA-56, E-1, E-6 | Sam
- D-02 | 14.11. | Plattform | Zwei Electron-Apps (Materialplaner, Productionplaner) statt Django-Weboberfläche. Neubau von Grund auf, Referenz `verleih/` liegt nicht vor: Spec-Text ist allein verbindlich. | Wunsch Sam | 1.3, Anhang A | Sam
- D-03 | 14.11. | Repos | Drei Repos unter Nomisimo: Planer-Lager-Core (Submodule `core/` in beiden Apps), Materialplaner, Productionplaner. | Wunsch Sam | – | Sam
- D-04 | 14.11. | Aufteilung | Siehe CLAUDE.md der Apps. Verwaltung in beiden Apps für Admins. | Wunsch Sam | 2.1, UI-1 | Sam
- D-05 | 14.11. | Nahtlos | Apps müssen nahtlos zusammenarbeiten (ARCHITEKTUR §4). | Wunsch Sam | – | Sam
- D-06 | 14.11. | Scanner | Externe BT- oder Netzwerk-Scanner sind Standard. Handy-App erst ganz am Ende (Android-APK), Kamera-Scan niedrig priorisiert. | Wunsch Sam | FA-15, UI-3, NFA-09 | Sam
- D-07 | 14.11. | Umfang | Alles inkl. P3 (Reihenfolge Kap. 13). | Wunsch Sam | alle | Sam
- D-08 | 14.11. | Autonomie | Bei Unklarheit Spec-Standard nehmen, hier eintragen, weiterarbeiten. | Wunsch Sam | – | Sam

## Offene Punkte der Spec (Kap. 12) – Standard bis Sam entscheidet
- D-09 | E-1 Server-Umzug | Durch D-01 erledigt: Cloud-Host. Host-Anbieter offen, docker-compose bleibt anbieterneutral. | Claude
- D-10 | E-2 yEd-Aussehen | Einfache, einheitliche Piktogramme je Kategorie; später anpassbar. | Claude
- D-11 | E-3 Bindestrich im Etikettencode | CSV-Option „ohne Bindestrich“ + Scan-Normalisierung (R-22, R-69) akzeptiert beide Formen. | Claude
- D-12 | E-4 Personal/Fahrzeuge | Umfang = FA-37/FA-38 wörtlich, ohne Lohn/Abrechnung. | Claude
- D-13 | E-5 Benachrichtigungen | In-App-Hinweise + E-Mail über SMTP (Env), kein Push-Dienst. | Claude
- D-14 | E-6 Mehrbenutzer | PostgreSQL von Anfang an (D-01). | Claude

## Lücken in der Spec, beim Setup gefunden
- D-15 | R-30 | In 1.2 Nr. 1 zitiert, aber nirgends definiert. Annahme: = R-18 (jede Gerätebewegung wird gebucht). | Claude
- D-16 | Scan-Algorithmus 5.5 | Hat keine R-ID. In Tests als `R-SCAN-<Schritt>` bezeichnen (z. B. `R-SCAN-5`). | Claude
- D-17 | Bereich `start` | In 7.1 genutzt, fehlt in der Bereichsliste 2.1. Annahme: jeder angemeldete Nutzer. | Claude
- D-18 | R-11 `/admin/login/` | Kein Django-Admin. Umsetzung: `/admin*` im Web leitet auf die Login-Seite. | Claude
- D-19 | Projektordner (3.2) | Liegen auf dem Server unter `/data/projekte/`. Apps zeigen sie als Dateiliste + Zip-Download statt „Ordner im Finder öffnen“. | Claude
- D-20 | FA-48 Zweitordner „per Ordner-Auswahl“ | In der Cloud: Zweitort = zweites Volume oder S3-kompatibles Ziel (Env), Auswahl in der Verwaltung. | Claude

## Während der Umsetzung (Claude ergänzt hier)
- D-21 | 14.11. | Tests je Datei | API-/DB-Tests laufen je Testdatei in einem frischen PostgreSQL-Schema (`neueTestDb()`), nicht in einer eigenen Datenbank. Schneller, parallel möglich. | Laufzeit | NFA-08 | Claude
- D-22 | 14.11. | E2E-Runner | E2E-Tests nutzen `node --test` + `_electron` aus dem vorinstallierten Playwright (kein `@playwright/test`, kein Browser-Download). Aufruf `npm run e2e`. | CLAUDE.md „Keine Playwright-Browser laden“ | T-01…T-24 | Claude
- D-23 | 14.11. | Root-Paket | Root-package.json ohne `"type": "module"` (Kit-Skripte sind CommonJS), alle `packages/*` sind ESM. | Kit-Kompatibilität | – | Claude
- D-24 | 14.11. | Paket `@lager/shell` | Zusätzliches Core-Paket für den gemeinsamen Electron-Hauptprozess + Preload (Fenster, Splash, Single-Instance, Deep-Links). Apps bündeln ihren Hauptprozess mit esbuild (`dist-app/main.cjs`), Build-Logik zentral in `scripts/app-build.cjs`. | Keine doppelte Hülle in zwei Apps | ARCHITEKTUR §2, §4 | Claude
- D-25 | 14.11. | CI und private Repos | CI-Workflows liegen in allen 3 Repos. Sind die Repos privat, braucht der E2E-Job (Core) und der Submodule-Checkout (Apps) ein Secret `LAGER_REPO_TOKEN` mit Lesezugriff. Ohne Secret läuft nur Unit/API im Core sicher. | GITHUB_TOKEN sieht nur das eigene Repo | – | Claude
- D-26 | 14.11. | Einstellungen-Speicher | Ein Datensatz (`CHECK id = 1`) mit JSONB-Werten; Standardwerte + Prüfung in `domain/einstellungen.js`. Geld in Cent (`zeit_basis_stundensatz` 6000 = 60,00 €). | Felder wachsen über die Phasen | 3.14, FA-48 | Claude
- D-27 | 14.11. | 2FA-Pflicht | Gilt, wenn `PUBLIC_URL` mit https beginnt oder `LAGER_IM_NETZ=1`. Admin ohne 2FA kann sich anmelden, sieht aber nur die Einrichtung (403 `zweiFaktorEinrichten`). Handoff zwischen den Apps fragt den Code nicht erneut ab. | FA-54 „sobald aus dem Netz erreichbar“ | FA-54 | Claude
- D-28 | 14.11. | Erster Admin | Beim Serverstart aus `LAGER_ADMIN_BENUTZER`/`LAGER_ADMIN_PASSWORT`, nur wenn noch kein Benutzer existiert. | Kein Django-createsuperuser | FA-47 | Claude
- D-29 | 14.11. | R-08 Zählweise | Benutzer: Fehlversuche im 15-min-Fenster seit dem letzten erfolgreichen Login. Adresse: alle Fehlversuche im Fenster (kein Reset). Auch falsche 2FA-Codes zählen. | Spec-Wortlaut | R-08 | Claude
- D-30 | 14.11. | Hell-Farben | Für UI-7 (≥ 4,5:1) wurden im Hellmodus OK/WARN/ERR/INFO/MUTED leicht abgedunkelt (z. B. OK #1a7f45 statt #1f9d55). Akzente werden je Thema automatisch so angepasst, dass weiße Schrift auf Akzent und Akzent-Schrift auf Panel ≥ 4,5:1 erreichen. | UI-7 hat Vorrang vor exakter Netzwerkplaner-Farbe | UI-6, UI-7, FA-52 | Claude
- D-31 | 14.11. | Menü der Apps | Beide Apps zeigen das volle UI-1-Menü (nur erlaubte Einträge). Einträge der anderen App tragen ein Pfeil-Symbol und öffnen die andere App an derselben Stelle (Deep-Link + Handoff). | „Ein Produkt“ (ARCHITEKTUR §4) | UI-1 | Claude
- D-32 | 14.11. | Deep-Link-Pfade | Deep-Link-Pfad = App-Pfad (`materialplaner://projekte/12/packen`). Einzahl-Aliasse aus ARCHITEKTUR §4.2 (`geraet/LT-0001`, `projekt/P-…`, `angebot/5`, `kunde/3`) werden umgesetzt. | Einfacher Kontext-Erhalt beim App-Schalter | – | Claude
- D-33 | 14.11. | R-01 unbekannte Pfade | Nicht registrierte Pfade liefern für alle 404 (auch Admin), angemeldet oder nicht. Strenger als „nur für Admin“: es gibt schlicht keine unregistrierten Endpunkte. Registrierte Routen ohne Bereich sind nur für Admin. | Sicherer Standard | R-01 | Claude
- D-34 | 14.11. | R-09 häufige Passwörter | Eingebaute Liste (~90 verbreitete Passwörter mit ≥ 10 Zeichen, deutsch/englisch) statt Djangos 20.000er-Liste. Mindestlänge 10 schließt die meisten Einträge der großen Liste ohnehin aus. Bei Bedarf Datei nachladen. | Keine großen Downloads | R-09 | Claude
- D-35 | 14.11. | UI-1 Menü-Umfang | Zusätzliche Einträge (Etiketten, Inventur, Reparatur, Personal, Fahrzeuge) aus FA-06/07/10/37/38 und den App-CLAUDE.md. Keine „Zuletzt angesehen“-Liste. | Spec-Funktionen brauchen Einstiege | UI-1 | Claude
- D-36 | 14.11. | Sicherheitsprotokoll `download` | Art `download` wird ab den Datei-/Sicherungs-Downloads (Phase 4/10) protokolliert. | Noch keine Downloads | 3.15 | Claude
- D-37 | 14.11. | R-19 SOLL sofort | Bewegung → Gerät mit `ON DELETE RESTRICT` statt CASCADE. Geräte mit Verlauf sind nie löschbar (nur ausmustern); Geräte ohne Verlauf und ohne Projekt dürfen gelöscht werden. Anlegen erzeugt keine Bewegung (sonst wäre ein Tippfehler nie löschbar). | D-07 (P2 inklusive), Nachweis | R-19, T-23 | Claude
- D-38 | 14.11. | Gerätestatus | Zustände: lager, zugeordnet, gepackt, vermisst, defekt, reparatur, ausgemustert, verkauft. „reparatur“ ist wie „defekt“ nicht packbar (R-16 + Spec 4.3 „Defekt / in Reparatur“). | Zustandsmodell 4.3 | R-16, R-17 | Claude
- D-39 | 14.11. | Optimistische Sperre | Artikel tragen `version`; PUT mit veralteter Version → 409 mit Hinweis „neu laden“. | Mehrbenutzer (D-14) | FA-02 | Claude
- D-40 | 14.11. | PDF-Formulare | `pdf-lib` (neu) für das ausfüllbare Kontaktformular und das Auslesen beim Import (pdfkit kann Formulare nicht lesen). | FA-27 braucht Lesen von AcroForm-Feldern | FA-27 | Claude
- D-41 | 14.11. | Dubletten-Regeln | Treffer bei gleicher E-Mail, gleicher Telefonnummer (Ziffern, +49→0), gleicher Firma ohne Rechtsform oder Name-Ähnlichkeit ≥ 0,85 bei gleichem Ort/PLZ. Manuelles Anlegen warnt (409) und erlaubt „trotzdem anlegen“. | FA-26/27 | FA-26, FA-27 | Claude
- D-42 | 14.11. | Adresssuche ohne Schlüssel | Ohne `GEOAPIFY_KEY` fragt der Server den freien Photon-Server (photon.komoot.io) ab. Gesendet wird nur der eingetippte Adresstext, keine Kundendaten. | NFA Kap. 9 erlaubt Photon ausdrücklich | FA-27 | Claude
- D-43 | 14.11. | Manueller Gerätestatus | Von Hand nur lager, vermisst, defekt, reparatur, ausgemustert, verkauft. „Projekt zugeordnet“ und „Gepackt“ setzt nur das Packen (Phase 5), damit nie ein Gerät ohne Projekt „gepackt“ ist. | Zustandsmodell 4.3 | R-18 | Claude
- D-44 | 14.11. | R-71 serverseitig | Der Server wendet die Art-Regel (`wendeArtAn`) bei jedem Anlegen/Speichern an; der Client allein reicht nicht. | Abnahme Phase 2 | R-71 | Claude
- D-45 | 14.11. | Etiketten-Vorlagen | Vorlage hat `art` (allgemein/kabel); je Art genau eine Standardvorlage. Druck ohne gewählte Vorlage nimmt für Kabel (Artikel mit Länge) die Kabel-Standardvorlage (Barcode), sonst die allgemeine (QR). | FA-10 „QR für alle, Code-128 für Kabel“ | FA-10, FA-11 | Claude
- D-46 | 14.11. | Etikettendruck | Eine Druckseite je Etikett, Seitengröße = Vorlage in mm, ohne Ränder (Electron `webContents.print`). Verschiedene Größen = getrennte Druckaufträge. Testmodus schreibt PDF statt zu drucken. | FA-10, FA-14 | FA-10 | Claude
- D-47 | 14.11. | R-29 Zeitpunkt | Länge aus dem Namen wird beim Anlegen erkannt und über „Längen aus Namen neu erkennen“ (FA-12); beim Bearbeiten nicht automatisch, damit eine bewusst geleerte Länge leer bleibt. | 5.4 | R-29 | Claude
- D-48 | 14.11. | Kabelfarbe fest | Tabelle `kabel_laenge`, Trigger verhindert Farbwechsel, sobald eine Farbe vergeben ist. Sind alle 12 vergeben, bleibt sie leer und die Kabelfarben-Seite zeigt einen Hinweis. | R-29a | R-29a | Claude
- D-49 | 14.11. | Kabel-Assistent bei vorhandenem Namen | Vorhandener Artikel wird nicht doppelt angelegt, aber die Stückzahl gilt für ihn (Geräte bzw. Bestellung). | R-73 | R-73 | Claude
