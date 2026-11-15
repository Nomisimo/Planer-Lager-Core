#!/bin/bash
# SSH-Zugang des Runners zum Testserver (Phase S): Host „lager“ = deploy@$DOMAIN, Host-Schlüssel nur aus ORACLE_KNOWN_HOSTS,
# StrictHostKeyChecking=yes (nie no oder accept-new). Erwartet DOMAIN, SSH_KEY, KNOWN_HOSTS in der Umgebung.
set -euo pipefail
[ -n "${DOMAIN:-}" ] || { echo "::error::Variable TEST_DOMAIN fehlt (Settings › Secrets and variables › Actions › Variables)."; exit 1; }
[ -n "${SSH_KEY:-}" ] || { echo "::error::Secret ORACLE_SSH_KEY fehlt."; exit 1; }
[ -n "${KNOWN_HOSTS:-}" ] || { echo "::error::Secret ORACLE_KNOWN_HOSTS fehlt. Sam: ssh-keyscan -t ed25519 $DOMAIN … | gh secret set ORACLE_KNOWN_HOSTS (siehe BETRIEB.md)."; exit 1; }
install -d -m 700 ~/.ssh
umask 077
printf '%s\n' "$SSH_KEY" > ~/.ssh/lager
printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/lager_known_hosts
cat > ~/.ssh/config <<KONF
Host lager
  HostName $DOMAIN
  User deploy
  IdentityFile ~/.ssh/lager
  IdentitiesOnly yes
  UserKnownHostsFile ~/.ssh/lager_known_hosts
  StrictHostKeyChecking yes
  ServerAliveInterval 30
  ConnectTimeout 20
KONF
ssh lager true && echo "SSH zu deploy@$DOMAIN ok (Host-Schlüssel geprüft)."
