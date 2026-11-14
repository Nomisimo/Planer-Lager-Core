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
