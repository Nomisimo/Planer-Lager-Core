#!/bin/bash
# Läuft AUF dem Testserver als Benutzer deploy (per SSH aus deploy-test.yml / wartung-test.yml), Ordner /opt/planer-lager.
# Aufruf: bash server.sh <aktion> [argumente]; Geheimnisse kommen nur über stdin, nie als Argument.
# Ausgaben landen in öffentlichen Actions-Logs: nie .env oder Passwörter ausgeben, Logs werden gefiltert.
set -euo pipefail
cd /opt/planer-lager
AKTION="${1:-status}"
C=(docker compose -p lager-test -f docker-compose.yml -f test.override.yml)

# Ersetzt geheime Werte aus .env (Passwörter, Schlüssel, Token) durch *** – für Logs und Fehlerausgaben.
gefiltert() {
  if [ -f .env ]; then
    local muster; muster=$(sed -n -E 's/^[A-Z_]*(PASSWORT|SCHLUESSEL|TOKEN)[A-Z_]*=(.{12,})$/\2/p' .env | sed 's/[][\.*^$/|+?(){}]/\\&/g' | paste -sd'|' -)
    if [ -n "$muster" ]; then sed -E "s/($muster)/***/g"; return; fi
  fi
  cat
}
setze() { # Schlüssel Wert in .env setzen/ersetzen
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

bespielen() {
  local tag="$1" zurueck="$2" domain="$3" gh_user="$4" token gh_token
  read -r token; read -r gh_token
  umask 077
  if [ ! -f .env ]; then
    echo "Erzeuge .env (neue Zufallspasswörter)"
    { echo "POSTGRES_PASSWORT=$(openssl rand -hex 32)"; echo "BACKUP_SCHLUESSEL=$(openssl rand -hex 32)"
      echo "ADMIN_PASSWORT=$(openssl rand -hex 32)"; echo "DOMAIN=$domain"; echo "ADMIN_BENUTZER=admin"; echo "LAGER_MODUS=test"; } > .env
  fi
  chmod 600 .env
  setze SERVER_IMAGE "ghcr.io/nomisimo/planer-lager-server:$tag"
  setze LAGER_TEST_TOKEN "$token"
  # Speicher: AMD-Micro (1 GB) knapp, A1 (12 GB) großzügig
  if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -gt 4000000 ]; then
    setze PG_SPEICHER 2g; setze SERVER_SPEICHER 2g; setze CADDY_SPEICHER 256m; setze SERVER_HEAP_MB 1536
  else
    setze PG_SPEICHER 256m; setze SERVER_SPEICHER 384m; setze CADDY_SPEICHER 64m; setze SERVER_HEAP_MB 256
  fi
  printf '%s' "$gh_token" | docker login ghcr.io -u "$gh_user" --password-stdin >/dev/null
  "${C[@]}" pull -q
  docker logout ghcr.io >/dev/null
  if [ "$zurueck" = "true" ]; then echo "Zurücksetzen: Container und Volumes löschen"; "${C[@]}" down -v; fi
  "${C[@]}" up -d --remove-orphans --no-build
  docker image prune -f >/dev/null
  docker image inspect "ghcr.io/nomisimo/planer-lager-server:$tag" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^LAGER_(VERSION|COMMIT)=' | sed 's/^/IMAGE_/'
}

status() {
  echo "== Container"; "${C[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>&1 | gefiltert
  echo "== Speicherplatz"; df -h / /var/lib/docker 2>/dev/null | uniq
  echo "== Arbeitsspeicher"; free -m
  echo "== Laufzeit"; uptime
  echo "== Docker-Volumes"; docker volume ls --filter name=lager-test --format '{{.Name}}'
}

case "$AKTION" in
  bespielen) shift; bespielen "$@" ;;
  pruefen) echo "== Docker"; docker info --format 'Docker {{.ServerVersion}}, {{.NCPU}} CPU, {{.MemTotal}} Byte, {{.OperatingSystem}} ({{.Architecture}})'; df -h /; free -m ;;
  status) status ;;
  logs) "${C[@]}" logs --no-color --tail 300 2>&1 | gefiltert ;;
  fehler) "${C[@]}" ps 2>&1 | gefiltert; "${C[@]}" logs --no-color --tail 200 2>&1 | gefiltert ;;
  aufraeumen) docker system prune -af; df -h / ;;
  neustart) "${C[@]}" down; "${C[@]}" up -d --no-build; sleep 5; "${C[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' ;;
  sicherung) "${C[@]}" exec -T server node packages/server/src/cli.js sicherung 2>&1 | gefiltert ;;
  sam-zugang)
    domain=$(sed -n 's/^DOMAIN=//p' .env)
    pw=$("${C[@]}" exec -T server node packages/server/src/cli.js einmal-zugang sam Administrator)
    umask 077
    printf 'Planer-Lager Testserver\nAdresse:      https://%s/\nBenutzername: sam\nPasswort:     %s\n\nBeim ersten Login vergibst du ein eigenes Passwort und richtest die Zwei-Faktor-Anmeldung ein.\nDiese Datei danach löschen.\n' "$domain" "$pw" > sam-zugang.txt
    chmod 600 sam-zugang.txt
    unset pw
    echo "sam-zugang.txt angelegt (nur für deploy lesbar)." ;;
  *) echo "Unbekannte Aktion: $AKTION"; exit 1 ;;
esac
