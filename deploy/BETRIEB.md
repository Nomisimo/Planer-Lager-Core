# Betrieb des Lager-Servers (Cloud)

Ein zentraler Server für beide Apps und die Arbeitsplatz-Browser. Bestandteile (docker-compose.yml):

| Dienst | Aufgabe |
|---|---|
| `caddy` | HTTPS mit automatischem Zertifikat (Let's Encrypt), leitet an den Server weiter |
| `server` | Lager-Server (Node 22), läuft als Benutzer `node`, Daten in Volume `/data` |
| `postgres` | PostgreSQL 16, Daten in Volume `pg_daten` |

## Einrichten (einmalig)

1. VPS in DE/EU mit Docker (z. B. 2 CPU, 4 GB RAM). Domain auf die Server-IP zeigen lassen (DNS A-Eintrag).
2. Repository auf den Server holen, dann:
   ```sh
   cd deploy
   cp .env.beispiel .env     # Werte eintragen: DOMAIN, Passwörter, BACKUP_SCHLUESSEL
   chmod 600 .env
   docker compose up -d --build
   ```
3. `https://<DOMAIN>/health` muss `{"ok":true,…}` liefern. In den Apps die Server-Adresse `https://<DOMAIN>` eintragen.
4. Mit `ADMIN_BENUTZER`/`ADMIN_PASSWORT` anmelden, Zwei-Faktor einrichten (Pflicht für Administratoren im Netz, FA-54), danach `ADMIN_PASSWORT` aus `.env` entfernen.

## Browser-Version (ARCHITEKTUR §10)

Beide Apps laufen zusätzlich im Browser, ausgeliefert vom selben Server. Gleiches Konto, Live-Sync, Abmelden gilt für beide.

| Adresse | Inhalt |
|---|---|
| `https://<DOMAIN>/` | Übersicht mit Kacheln (nur die Apps, für die die eigene Rolle Rechte hat) |
| `https://<DOMAIN>/materialplaner/` | Materialplaner im Browser |
| `https://<DOMAIN>/productionplaner/` | Productionplaner im Browser |
| `https://<DOMAIN>/station` | Arbeitsplatz-Web (Lager-Arbeitsplatz, Anzeige-Bildschirm) |

- Das Image baut die Browser-Versionen selbst: es holt beide App-Repos von GitHub und führt `npm run build:web` aus. Welche Fassung, legen die Build-Argumente fest (Standard `main`), z. B. ein Release-Tag:
  ```sh
  docker compose build --build-arg MATERIALPLANER_REF=v0.1.0-beta.1 --build-arg PRODUCTIONPLANER_REF=v0.1.0-beta.1 server
  docker compose up -d
  ```
- Eigener Ablageort statt des Images: `WEB_APPS_DIR=/pfad` mit Unterordnern `materialplaner/` und `productionplaner/` (Inhalt von `dist-web/`).
- Fehlt eine Browser-Version, zeigt die Adresse „… ist auf diesem Server nicht installiert“ (HTTP 503). Dann Image neu bauen.
- Nur in der Desktop-App: Arbeitsplatz-Modus (Vollbild), Direktdruck auf den Etikettendrucker, Bluetooth-Scanner im seriellen Modus, Projektordner öffnen, Server-Adresse ändern. Im Browser druckt „Etikett drucken“ über das Druckfenster des Browsers.
- Anmeldung im Browser per Sitzungscookie (HttpOnly, Secure, SameSite=Lax) und CSRF-Token. Aus der Desktop-App öffnet „Im Browser öffnen“ dieselbe Ansicht ohne neue Anmeldung.

## Sicherheit (NFA-01, NFA-02, FA-56)

- Nur HTTPS. Der Server setzt HSTS und Secure-Cookies, sobald `PUBLIC_URL` mit `https://` beginnt.
- `LAGER_HOSTS` (= `DOMAIN`) entspricht ALLOWED_HOSTS: Anfragen mit anderem Hostnamen werden abgewiesen. Weitere Namen kommagetrennt eintragen.
- Der Server-Port 8080 ist nicht nach außen offen, nur Caddy (80/443).
- `NODE_ENV=production` ist im Image gesetzt (entspricht DEBUG=0).
- Dateirechte im Datenordner werden bei jedem Start abgesichert (Ordner 700, Dateien 600).
- Netzwerk-Scanner per TCP nur im VPN freigeben (`SCANNER_TCP_PORT`, Standard aus). HTTP-Scanner nutzen `https://<DOMAIN>/api/v1/scanner/eingang`.
- Vor dem Echtbetrieb: unabhängige Sicherheitsprüfung (Penetrationstest), siehe Spec FA-56.

## Sicherungen (FA-49, NFA-04)

- Automatisch beim Start, wenn die letzte älter als 20 Stunden ist, und jederzeit in der Verwaltung („Jetzt sichern“).
- Mit `BACKUP_SCHLUESSEL` verschlüsselt (AES-256-GCM, Dateiendung `.zip.enc`). **Schlüssel getrennt aufbewahren** (z. B. Passwort-Manager). Ohne ihn ist keine Sicherung lesbar.
- Zweitort: `ZWEITORT` in `.env` (Host-Ordner, z. B. eingebundenes NAS), dem Container-Benutzer geben (`sudo chown 1000:1000 <Ordner>`) und in der Verwaltung → Einstellungen → Sicherung `/zweitort` eintragen.
- Täglich sichern ohne Neustart: Cron auf dem Host
  ```sh
  0 3 * * * cd /pfad/deploy && docker compose exec -T server node packages/server/src/cli.js sicherung
  ```
- Wiederherstellen (vorher wird automatisch der aktuelle Stand gesichert):
  ```sh
  docker compose exec server node packages/server/src/cli.js restore lager-JJJJ-MM-TT_HHMMSS.zip.enc
  ```
  Oder in der Verwaltung → Datensicherung → Wiederherstellen (mit Bestätigung).
- Wiederherstellungstest einmal im Quartal: Sicherung auf einem Zweitsystem einspielen, `pruefen` ausführen:
  ```sh
  docker compose exec server node packages/server/src/cli.js pruefen <Datei>
  ```

## Wartung und Neustart (FA-51)

- Verwaltung → System: Wartung an/aus (nur Admins arbeiten weiter), Server neu starten (Docker startet ihn neu).
- Update: `git pull && docker compose up -d --build`. Migrationen laufen beim Start automatisch.
- Logs: `docker compose logs -f server`.
- Sicherheits-Check auch auf der Kommandozeile: `docker compose exec server node packages/server/src/cli.js sicherheitscheck`.

## Benachrichtigungen per E-Mail (FA-40)
Ohne Einstellung erscheinen Fristen, Prüfungen, Wartung und Überbuchungen nur in der App (Glocke oben rechts).
Für E-Mails in `.env` `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` (`direkt` für Port 465, `starttls` für 587), `SMTP_BENUTZER`, `SMTP_PASSWORT` und `SMTP_VON` eintragen und `docker compose up -d` ausführen.
E-Mails gehen an die Adresse im Benutzerkonto; jeder kann sie in der Glocke ausschalten. Der Lauf ist stündlich (`LAGER_HINTERGRUND_MINUTEN`, 0 = aus).

## Testserver (Oracle Always Free)

Ein echter Testserver mit Beispieldaten unter `https://<TEST_DOMAIN>` (Repository-Variable `TEST_DOMAIN`). Eine Domain für alles: Portal `/`, `/materialplaner/`, `/productionplaner/`, API, WebSocket, Arbeitsplatz `/station`, Anzeige `/anzeige`. In den Desktop-Apps als Server-Adresse `https://<TEST_DOMAIN>` eintragen. Alle Seiten zeigen oben das Band „TESTSYSTEM – nur Beispieldaten“, Suchmaschinen werden ausgesperrt (`X-Robots-Tag`, `robots.txt`).

**Kosten: 0 €** im Rahmen von Oracle „Always Free“: eine Instanz `VM.Standard.A1.Flex` (ARM, 2 OCPU, 12 GB RAM, 50 GB Boot-Volume, Ubuntu 24.04), ein VCN, sonst nichts (kein Load Balancer, keine Oracle-Datenbank, kein Extra-Volume). Ersatz bei fehlender ARM-Kapazität: `VM.Standard.E2.1.Micro` (AMD, 1 GB), das Image gibt es für beide Architekturen.

**Leerlauf:** Oracle stoppt Always-Free-Instanzen, die über Tage kaum CPU, Netz und Speicher nutzen. Abhilfe: Konto auf „Pay As You Go“ umstellen (kostet im Free-Rahmen weiterhin nichts). Künstliche Last erzeugen wir bewusst nicht. Gestoppt? Actions › „Oracle Infrastruktur“ › `starten`.

### Workflows (Actions › Run workflow)

| Workflow | Aktion | Wirkung |
|---|---|---|
| Oracle Infrastruktur (`oracle-infrastruktur.yml`) | `anlegen` | Compartment `planer-lager`, Netz (VCN 10.20.0.0/16, Internet Gateway, Routen, Firewall 22/80/443, Subnetz), Instanz `lager-test` mit cloud-init (`deploy/oracle/cloud-init.yaml`). Idempotent. Zeigt IP und SSH-Host-Schlüssel. |
| | `status` / `starten` | Zustand, IP, Laufzeit, Konsole / Instanz starten |
| | `entfernen` | Instanz samt Boot-Volume und Netz löschen (nur mit `bestaetigung = ENTFERNEN`), Compartment bleibt |
| Image (`image.yml`) | – | Server-Image für `linux/arm64` und `linux/amd64` nach `ghcr.io/nomisimo/planer-lager-server` (`sha-<kurz>`, `test`; mit „release“ auch `v<version>`, `latest`). Läuft nach jeder grünen CI auf main. |
| Testserver bespielen (`deploy-test.yml`) | `image_tag`, `zuruecksetzen` | Dateien nach `/opt/planer-lager/`, `.env` beim ersten Mal mit Zufallspasswörtern, Image ziehen, starten, `/health` prüfen. Läuft nach jedem Image-Lauf. `zuruecksetzen` löscht alle Daten (Volumes) und startet mit Beispieldaten neu. |
| Testserver prüfen (`remote-test.yml`) | – | REMOTE-Tests aus dem Runner (echtes Zertifikat). Läuft nach jedem Bespielen. |
| Wartung Testserver (`wartung-test.yml`) | `pruefen` | DNS zeigt auf die Instanz, SSH mit geprüftem Host-Schlüssel, Docker, Platz, Speicher |
| | `status` / `logs` | Container, Platz, Speicher, Zertifikat / letzte 300 Zeilen (Geheimnisse gefiltert) |
| | `zuruecksetzen` | Beispieldaten neu laden; eigene Benutzer (admin, sam) bleiben |
| | `neustart` / `aufraeumen` | Container neu starten (Daten bleiben) / alte Images löschen |
| | `sicherung` | Sicherung im Container erstellen und prüfen |
| | `sam-zugang` | Admin `sam` mit Einmal-Passwort (siehe unten); erneut = neues Passwort |

Alle Workflows, die den Server ändern, laufen nacheinander (Gruppe `oracle`). Der Zugriff läuft per SSH als `deploy@<TEST_DOMAIN>` mit `ORACLE_SSH_KEY`, der Host-Schlüssel wird gegen `ORACLE_KNOWN_HOSTS` geprüft (`StrictHostKeyChecking=yes`).

### Zugang für Sam
1. Actions › „Wartung Testserver“ › `sam-zugang`.
2. Passwort abholen (die Datei wird dabei gelöscht):
   `ssh -i <dein Schlüssel> deploy@<TEST_DOMAIN> "cat /opt/planer-lager/sam-zugang.txt && rm /opt/planer-lager/sam-zugang.txt"`
3. Unter `https://<TEST_DOMAIN>/` anmelden, eigenes Passwort vergeben, Zwei-Faktor einrichten.

### Testmodus (`LAGER_MODUS=test`)
Nur auf dem Testserver. Der Server startet nicht, wenn `LAGER_TEST_TOKEN` fehlt oder kürzer als 32 Zeichen ist. `Authorization: Bearer <LAGER_TEST_TOKEN>` ergibt eine Admin-Sitzung des System-Nutzers „claude-test“ (jede Nutzung im Sicherheitsprotokoll); ein Benutzer-Cookie geht immer vor. Zusätzliche Routen: `POST /api/v1/test/zuruecksetzen` (Beispieldaten neu), `POST /api/v1/test/benutzer` (Testbenutzer je Rolle, Passwörter nur in der Antwort). Sonst gilt alles wie im Echtbetrieb (2FA, Sperre nach Fehlversuchen, Header, Rate-Limits). Ohne Testmodus gibt der Token 401 und die Test-Routen 404.

### Einmalige Einrichtung (Sam)
Secrets `OCI_CLI_USER`, `OCI_CLI_TENANCY`, `OCI_CLI_FINGERPRINT`, `OCI_CLI_REGION`, `OCI_CLI_KEY_CONTENT`, `ORACLE_SSH_KEY`, `ORACLE_SSH_PUBKEY`, `LAGER_TEST_TOKEN`; Variable `TEST_DOMAIN`. Nach `anlegen`: A-Record `TEST_DOMAIN` → IP, dann
`ssh-keyscan -t ed25519 <TEST_DOMAIN> 2>/dev/null | tee /tmp/lager_host | ssh-keygen -lf -` (Fingerabdruck mit der Ausgabe von `anlegen` vergleichen) und
`gh secret set ORACLE_KNOWN_HOSTS -R Nomisimo/Planer-Lager-Core < /tmp/lager_host`.
Nach der Einrichtung können die `OCI_CLI_*`-Secrets gelöscht werden (`for s in USER TENANCY FINGERPRINT REGION KEY_CONTENT; do gh secret delete OCI_CLI_$s -R Nomisimo/Planer-Lager-Core; done`). Bespielen und Wartung gehen weiter, nur `oracle-infrastruktur.yml` (Anlegen, Starten, Entfernen) und der IP-Vergleich bei `pruefen` nicht mehr.
