#!/bin/bash
# Oracle-Testserver (Phase S): anlegen | status | starten | entfernen. Läuft im Workflow oracle-infrastruktur.yml.
# Erwartet eine fertige ~/.oci/config, TEN (Tenancy-OCID), TAGS, SSH_PUBKEY; Ausgabe zusätzlich in $GITHUB_STEP_SUMMARY.
# Nie `set -x`: die Befehle enthalten OCIDs der Tenancy.
set -euo pipefail
AKTION="${1:-status}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
NAME_INSTANZ=lager-test
A1=VM.Standard.A1.Flex
MICRO=VM.Standard.E2.1.Micro
KAP_MINUTEN="${KAP_MINUTEN:-30}"

log() { echo "[$(date +%H:%M:%S)] $*"; }
erst() { local r; r=$("$@" 2>/dev/null || true); [ "$r" = "null" ] && r=""; echo "$r"; }
# Wiederholt einen Befehl bei Fehlern (frisch angelegte Compartments sind ein paar Sekunden lang „not found“).
nochmal() { local i; for i in 1 2 3 4 5 6; do if "$@"; then return 0; fi; log "Fehlgeschlagen, neuer Versuch in 20 s ($i/6)"; sleep 20; done; return 1; }

compartment() {
  C=$(erst oci iam compartment list -c "$TEN" --name planer-lager --lifecycle-state ACTIVE --all --query 'data[0].id' --raw-output)
  if [ -z "$C" ] && [ "${1:-}" = anlegen ]; then
    log "Compartment planer-lager anlegen"
    C=$(oci iam compartment create -c "$TEN" --name planer-lager --description "Planer-Lager Testserver" \
      --freeform-tags "$TAGS" --query data.id --raw-output)
    for _ in $(seq 1 24); do
      [ "$(erst oci iam compartment get --compartment-id "$C" --query 'data."lifecycle-state"' --raw-output)" = ACTIVE ] && break
      sleep 5
    done
    sleep 15
  fi
}

instanz_id() {
  erst oci compute instance list -c "$C" --display-name "$NAME_INSTANZ" --all \
    --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" --raw-output
}
zustand() { erst oci compute instance get --instance-id "$1" --query 'data."lifecycle-state"' --raw-output; }
oeffentliche_ip() { erst oci compute instance list-vnics --instance-id "$1" --query 'data[0]."public-ip"' --raw-output; }

konsole() { # $1 Instanz → Datei konsole.txt
  local h
  h=$(oci compute console-history capture --instance-id "$1" --query data.id --raw-output)
  for _ in $(seq 1 30); do
    [ "$(erst oci compute console-history get --instance-console-history-id "$h" --query 'data."lifecycle-state"' --raw-output)" = SUCCEEDED ] && break
    sleep 2
  done
  oci compute console-history get-content --instance-console-history-id "$h" --length 10000000 --file konsole.txt >/dev/null 2>&1 || : > konsole.txt
  oci compute console-history delete --instance-console-history-id "$h" --force >/dev/null 2>&1 || true
}

netz() {
  V=$(erst oci network vcn list -c "$C" --display-name lager-vcn --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output)
  if [ -z "$V" ]; then
    log "VCN lager-vcn anlegen"
    V=$(nochmal oci network vcn create -c "$C" --display-name lager-vcn --cidr-blocks '["10.20.0.0/16"]' --dns-label lagervcn \
      --freeform-tags "$TAGS" --wait-for-state AVAILABLE --query data.id --raw-output)
  fi
  IGW=$(erst oci network internet-gateway list -c "$C" --vcn-id "$V" --display-name lager-igw --query 'data[0].id' --raw-output)
  if [ -z "$IGW" ]; then
    log "Internet Gateway anlegen"
    IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$V" --display-name lager-igw --is-enabled true \
      --freeform-tags "$TAGS" --wait-for-state AVAILABLE --query data.id --raw-output)
  fi
  RT=$(erst oci network route-table list -c "$C" --vcn-id "$V" --display-name lager-routen --query 'data[0].id' --raw-output)
  if [ -z "$RT" ]; then
    log "Route Table anlegen"
    RT=$(oci network route-table create -c "$C" --vcn-id "$V" --display-name lager-routen \
      --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" \
      --freeform-tags "$TAGS" --wait-for-state AVAILABLE --query data.id --raw-output)
  fi
  SL=$(erst oci network security-list list -c "$C" --vcn-id "$V" --display-name lager-regeln --query 'data[0].id' --raw-output)
  local ein='[{"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
    {"protocol":"1","source":"0.0.0.0/0","icmpOptions":{"type":3,"code":4}}]'
  local aus='[{"protocol":"all","destination":"0.0.0.0/0"}]'
  if [ -z "$SL" ]; then
    log "Security List anlegen"
    SL=$(oci network security-list create -c "$C" --vcn-id "$V" --display-name lager-regeln \
      --ingress-security-rules "$ein" --egress-security-rules "$aus" \
      --freeform-tags "$TAGS" --wait-for-state AVAILABLE --query data.id --raw-output)
  fi
  SN=$(erst oci network subnet list -c "$C" --vcn-id "$V" --display-name lager-subnetz --query 'data[0].id' --raw-output)
  if [ -z "$SN" ]; then
    log "Öffentliches Subnetz anlegen"
    SN=$(oci network subnet create -c "$C" --vcn-id "$V" --display-name lager-subnetz --cidr-block 10.20.1.0/24 --dns-label lager \
      --route-table-id "$RT" --security-list-ids "[\"$SL\"]" --prohibit-public-ip-on-vnic false \
      --freeform-tags "$TAGS" --wait-for-state AVAILABLE --query data.id --raw-output)
  fi
}

image_fuer() { # $1 Shape
  erst oci compute image list -c "$TEN" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
    --shape "$1" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output
}

starte_instanz() { # $1 AD, $2 Shape, $3 Image → setzt I oder gibt 1 zurück; FEHLER enthält die Meldung
  local args=(oci compute instance launch -c "$C" --availability-domain "$1" --shape "$2" --image-id "$3" --subnet-id "$SN"
    --assign-public-ip true --display-name "$NAME_INSTANZ" --boot-volume-size-in-gbs 50
    --ssh-authorized-keys-file pubkey.txt --user-data-file user-data.yaml --freeform-tags "$TAGS"
    --query data.id --raw-output)
  [ "$2" = "$A1" ] && args+=(--shape-config '{"ocpus":2,"memoryInGBs":12}')
  if I=$("${args[@]}" 2>fehler.txt); then return 0; fi
  FEHLER=$(grep -oE '"message": "[^"]*"' fehler.txt | head -1 || true)
  [ -z "$FEHLER" ] && FEHLER=$(tail -c 300 fehler.txt)
  return 1
}

anlegen() {
  compartment anlegen
  netz
  printf '%s\n' "$SSH_PUBKEY" > pubkey.txt
  local key; key=$(printf '%s' "$SSH_PUBKEY" | tr -d '\n' | sed 's/[&|]/\\&/g')
  sed "s|__SSH_PUBKEY__|$key|" deploy/oracle/cloud-init.yaml > user-data.yaml
  grep -q __SSH_PUBKEY__ user-data.yaml && { echo "Platzhalter nicht ersetzt"; exit 1; }

  I=$(instanz_id)
  SHAPE=""; AD=""
  if [ -n "$I" ]; then
    log "Instanz $NAME_INSTANZ gibt es schon ($(zustand "$I"))"
  else
    mapfile -t ADS < <(oci iam availability-domain list -c "$TEN" --query 'data[].name' --raw-output | jq -r '.[]')
    local img; img=$(image_fuer "$A1")
    [ -n "$img" ] || { echo "Kein Ubuntu-24.04-Image für $A1 gefunden"; exit 1; }
    local ende=$(( $(date +%s) + KAP_MINUTEN * 60 )) runde=0
    while [ -z "$I" ] && [ "$(date +%s)" -lt "$ende" ]; do
      runde=$((runde + 1))
      for ad in "${ADS[@]}"; do
        if starte_instanz "$ad" "$A1" "$img"; then SHAPE=$A1; AD=$ad; break; fi
        log "Runde $runde, $ad: $FEHLER"
        if ! grep -qiE 'capacity|InternalError|TooManyRequests|429' fehler.txt; then echo "Unerwarteter Fehler beim Anlegen"; exit 1; fi
      done
      [ -z "$I" ] && sleep 60
    done
    if [ -z "$I" ]; then
      log "Keine A1-Kapazität nach $KAP_MINUTEN min, Ersatz $MICRO"
      img=$(image_fuer "$MICRO")
      for ad in "${ADS[@]}"; do
        oci compute shape list -c "$C" --availability-domain "$ad" --all --query 'data[].shape' --raw-output | grep -q "\"$MICRO\"" || continue
        if starte_instanz "$ad" "$MICRO" "$img"; then SHAPE=$MICRO; AD=$ad; break; fi
        log "$ad: $FEHLER"
      done
      [ -n "$I" ] || { echo "Auch $MICRO ließ sich nicht anlegen"; exit 1; }
      echo "> **Ersatz:** keine A1-Kapazität, $MICRO (amd64) angelegt. In ENTSCHEIDUNGEN.md vermerken." >> "$SUMMARY"
    fi
  fi

  log "Warte auf RUNNING"
  for _ in $(seq 1 60); do
    z=$(zustand "$I"); [ "$z" = RUNNING ] && break
    [ "$z" = TERMINATED ] && { echo "Instanz wurde von Oracle beendet"; exit 1; }
    sleep 10
  done
  [ "$(zustand "$I")" = RUNNING ] || { echo "Instanz läuft nicht"; exit 1; }

  log "Warte auf LAGER-BOOTSTRAP-FERTIG und die Host-Schlüssel (höchstens 10 min)"
  local fertig=""
  for _ in $(seq 1 20); do
    konsole "$I"
    if grep -q LAGER-BOOTSTRAP-FEHLER konsole.txt; then grep -B30 LAGER-BOOTSTRAP-FEHLER konsole.txt | tail -40; exit 1; fi
    if grep -q LAGER-BOOTSTRAP-FERTIG konsole.txt && grep -q 'END SSH HOST KEY FINGERPRINTS' konsole.txt; then fertig=1; break; fi
    sleep 30
  done
  bericht "$I"
  [ -n "$fertig" ] || { echo "cloud-init nicht rechtzeitig fertig (siehe Konsole oben)"; tail -40 konsole.txt; exit 1; }
}

bericht() {
  local i=$1 ip shape ad img name
  ip=$(oeffentliche_ip "$i")
  shape=$(erst oci compute instance get --instance-id "$i" --query 'data.shape' --raw-output)
  ad=$(erst oci compute instance get --instance-id "$i" --query 'data."availability-domain"' --raw-output)
  img=$(erst oci compute instance get --instance-id "$i" --query 'data."source-details"."image-id"' --raw-output)
  name=$(erst oci compute image get --image-id "$img" --query 'data."display-name"' --raw-output)
  {
    echo "## Testserver lager-test"
    echo "| | |"; echo "|---|---|"
    echo "| Öffentliche IP | \`$ip\` |"
    echo "| Shape | $shape |"
    echo "| Availability Domain | $ad |"
    echo "| Image | $name |"
    echo "| Zustand | $(zustand "$i") |"
    echo
    echo "### SSH-Host-Schlüssel (Konsolen-Verlauf)"
    echo '```'
    sed -n '/BEGIN SSH HOST KEY FINGERPRINTS/,/END SSH HOST KEY FINGERPRINTS/p' konsole.txt | grep -E 'ED25519|ECDSA|RSA' | sed 's/^.*ci-info: //' | tr -d '\r' | sort -u || true
    echo '```'
  } >> "$SUMMARY"
  echo "IP: $ip"
  sed -n '/BEGIN SSH HOST KEY FINGERPRINTS/,/END SSH HOST KEY FINGERPRINTS/p' konsole.txt | grep ED25519 | tr -d '\r' | sort -u || true
}

status() {
  compartment
  [ -n "$C" ] || { echo "Kein Compartment planer-lager" | tee -a "$SUMMARY"; return 0; }
  I=$(instanz_id)
  [ -n "$I" ] || { echo "Keine Instanz $NAME_INSTANZ" | tee -a "$SUMMARY"; return 0; }
  local erstellt; erstellt=$(erst oci compute instance get --instance-id "$I" --query 'data."time-created"' --raw-output)
  if [ "$(zustand "$I")" = RUNNING ]; then konsole "$I"; else : > konsole.txt; fi
  bericht "$I"
  {
    echo "Angelegt: $erstellt (seit $(( ( $(date +%s) - $(date -d "$erstellt" +%s) ) / 3600 )) h)"
    echo; echo "### Konsole, letzte 20 Zeilen"; echo '```'; tail -n 20 konsole.txt | tr -d '\r'; echo '```'
  } >> "$SUMMARY"
  tail -n 20 konsole.txt | tr -d '\r'
}

starten() {
  compartment; I=$(instanz_id)
  [ -n "$I" ] || { echo "Keine Instanz $NAME_INSTANZ"; exit 1; }
  if [ "$(zustand "$I")" != RUNNING ]; then
    log "Starte $NAME_INSTANZ"
    oci compute instance action --instance-id "$I" --action START --wait-for-state RUNNING >/dev/null
  fi
  status
}

entfernen() {
  [ "${BESTAETIGUNG:-}" = ENTFERNEN ] || { echo "Zum Entfernen bei „bestaetigung“ ENTFERNEN eintragen."; exit 1; }
  compartment; [ -n "$C" ] || { echo "Nichts zu entfernen"; return 0; }
  I=$(instanz_id)
  if [ -n "$I" ]; then
    log "Instanz terminieren (mit Boot-Volume)"
    oci compute instance terminate --instance-id "$I" --preserve-boot-volume false --force --wait-for-state TERMINATED >/dev/null
  fi
  V=$(erst oci network vcn list -c "$C" --display-name lager-vcn --query 'data[0].id' --raw-output)
  if [ -n "$V" ]; then
    for sn in $(oci network subnet list -c "$C" --vcn-id "$V" --query 'data[].id' --raw-output | jq -r '.[]'); do
      log "Subnetz löschen"; oci network subnet delete --subnet-id "$sn" --force --wait-for-state TERMINATED >/dev/null; done
    for rt in $(oci network route-table list -c "$C" --vcn-id "$V" --display-name lager-routen --query 'data[].id' --raw-output | jq -r '.[]'); do
      log "Route Table löschen"; oci network route-table delete --rt-id "$rt" --force --wait-for-state TERMINATED >/dev/null; done
    for sl in $(oci network security-list list -c "$C" --vcn-id "$V" --display-name lager-regeln --query 'data[].id' --raw-output | jq -r '.[]'); do
      log "Security List löschen"; oci network security-list delete --security-list-id "$sl" --force --wait-for-state TERMINATED >/dev/null; done
    for igw in $(oci network internet-gateway list -c "$C" --vcn-id "$V" --query 'data[].id' --raw-output | jq -r '.[]'); do
      log "Internet Gateway löschen"; oci network internet-gateway delete --ig-id "$igw" --force --wait-for-state TERMINATED >/dev/null; done
    log "VCN löschen"; oci network vcn delete --vcn-id "$V" --force --wait-for-state TERMINATED >/dev/null
  fi
  echo "Entfernt. Das Compartment planer-lager bleibt." | tee -a "$SUMMARY"
}

case "$AKTION" in
  anlegen) anlegen ;;
  status) status ;;
  starten) starten ;;
  entfernen) entfernen ;;
  *) echo "Unbekannte Aktion: $AKTION"; exit 1 ;;
esac
