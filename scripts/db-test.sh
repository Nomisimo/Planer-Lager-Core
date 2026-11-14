#!/bin/bash
# Startet PostgreSQL in der Cloud-VM (falls aus) und stellt Benutzer + Test-Datenbanken sicher.
# Lokal (Mac/Win): erwartet ein laufendes PostgreSQL und DATABASE_URL in der Umgebung.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "$(id -u)" = "0" ]; then
  pg_isready -q || service postgresql start >/dev/null 2>&1 || pg_ctlcluster 16 main start
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 1; done
  run() { su postgres -c "$1"; }
  run "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='lager'\"" | grep -q 1 \
    || run "psql -c \"CREATE ROLE lager LOGIN SUPERUSER PASSWORD 'lager'\""
  for db in lager_dev lager_test lager_e2e; do
    run "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 || run "createdb -O lager $db"
  done
fi
pg_isready && echo "DATABASE_URL=${DATABASE_URL:-postgres://lager:lager@localhost:5432/lager_test}"
