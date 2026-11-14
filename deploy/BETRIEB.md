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
