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
  ConnectionAttempts 3
  # Eine Verbindung für alle Schritte (schnelle Neuverbindungen setzt sshd sonst zurück)
  ControlMaster auto
  ControlPath ~/.ssh/lager-%C
  ControlPersist 15m
KONF
for i in 1 2 3 4 5; do
  if ssh lager true; then echo "SSH zu deploy@$DOMAIN ok (Host-Schlüssel geprüft)."; exit 0; fi
  echo "SSH-Versuch $i fehlgeschlagen, neuer Versuch in $((i * 5)) s"; sleep $((i * 5))
done
exit 1
