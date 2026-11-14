#!/bin/bash
# Setup-Script für die Cloud-Umgebung "Planer-Lager" (claude.ai/code → Umgebung → Setup script)
# Läuft als root auf Ubuntu 24.04, vor dem Start von Claude. Ergebnis wird ~7 Tage gecacht.
# Muss unter ~5 Minuten bleiben, sonst kein Cache. Darum parallel und ohne große Extras.
set -u
LOG=/var/log/planer-setup.log
exec > >(tee -a "$LOG") 2>&1
echo "== Planer-Lager Setup $(date -Is)"

# 1) Systempakete für Electron unter xvfb (E2E-Tests, Screenshots) + Hilfen
apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    xvfb xauth libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgtk-3-0t64 \
    libgbm1 libasound2t64 libxss1 libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libpango-1.0-0 libcairo2 fonts-dejavu-core fonts-liberation \
    poppler-utils netcat-openbsd >/dev/null || echo "WARNUNG: apt-Pakete unvollständig"
  apt-get install -y -qq --no-install-recommends shellcheck >/dev/null 2>&1 || true
  echo "apt fertig"
}

# 2) PostgreSQL 16 (vorinstalliert): Benutzer + Test-Datenbanken anlegen
pg_setup() {
  service postgresql start >/dev/null 2>&1 || pg_ctlcluster 16 main start || true
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 1; done
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='lager'\"" | grep -q 1 \
    || su postgres -c "psql -c \"CREATE ROLE lager LOGIN SUPERUSER PASSWORD 'lager'\""
  for db in lager_dev lager_test lager_e2e; do
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
      || su postgres -c "createdb -O lager $db"
  done
  echo "postgres fertig"
}

# 3) Electron-Binary vorab in den Cache laden (spart Zeit bei jedem npm install)
electron_cache() {
  export ELECTRON_CACHE=/root/.cache/electron
  mkdir -p "$ELECTRON_CACHE"
  # install.js ausdrücklich aufrufen: der postinstall-Download lief im Test nicht immer mit
  ( mkdir -p /tmp/electron-vorab && cd /tmp/electron-vorab && npm init -y >/dev/null \
    && timeout 120 npm install --no-save --no-audit --no-fund electron@latest >/dev/null 2>&1 \
    && timeout 150 node node_modules/electron/install.js >/dev/null 2>&1 \
    && test -x node_modules/electron/dist/electron ) \
    && echo "electron im Cache: $(ls "$ELECTRON_CACHE" | head -3 | tr '\n' ' ')" \
    || echo "WARNUNG: Electron-Download fehlgeschlagen. Siehe ANLEITUNG.md, Abschnitt Netzwerk (ELECTRON_MIRROR)."
}

apt_install & A=$!
pg_setup & B=$!
electron_cache & C=$!
wait $A $B $C

# 4) Persönliche Claude-Anweisungen für diese Umgebung (nicht im Repo)
mkdir -p /root/.claude
cat > /root/.claude/CLAUDE.md <<'EOF'
- Antworte im Chat auf Deutsch und knapp (Skill caveman). Code, Commits, Doku normal.
- Arbeite autonom nach Skill `umsetzen` im Repo Planer-Lager-Core. Nicht anhalten, um zu fragen.
- PostgreSQL läuft nicht automatisch: vor Tests `bash scripts/db-test.sh` im Core (oder `service postgresql start`).
- Electron als root: immer mit ELECTRON_DISABLE_SANDBOX=1 bzw. `--no-sandbox` starten.
EOF

echo "== Setup fertig $(date -Is)"
