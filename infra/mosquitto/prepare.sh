#!/bin/sh
# Prepares Mosquitto's logins before it starts (production, docker compose for development, and CI):
#
#   * the password file for the two fixed logins, from the environment: "api" (the server) and
#     "node" (the shared board login typed on each board's setup page)
#   * per-board logins (firmware 2.6.0+): the API gives each board its own login and keeps it in the
#     broker's dynamic-security plugin (/mosquitto/data/dynamic-security.json, made here the first time).
#     The API is the source of truth: it puts every board's login back if that file is ever lost.
#   * MQTT_STRICT_BOARD_LOGIN=true (once every board runs 2.6.0+): the shared login may then only
#     introduce a board and receive its own login, not switch anything.
#
# Writes the configuration to run into $OUT (default /tmp/mosquitto):
#   $OUT/mosquitto.conf   with the plugin (when this Mosquitto has it)
#   $OUT/plain.conf       without it: the fallback if the plugin won't load (boards then use the shared login)
#   usage: sh prepare.sh <mosquitto.conf to start from> [acl file]
set -eu
SRC_CONF=$1
SRC_ACL=${2:-/mosquitto/config/acl}
OUT=${OUT:-/tmp/mosquitto}
DATA=${MQTT_DATA_DIR:-/mosquitto/data}
mkdir -p "$OUT" "$DATA"

# 1. the fixed logins
rm -f "$DATA/passwd"
mosquitto_passwd -c -b "$DATA/passwd" api "$MQTT_API_PASSWORD"
mosquitto_passwd -b "$DATA/passwd" node "$MQTT_NODE_PASSWORD"
chown mosquitto:mosquitto "$DATA/passwd" 2>/dev/null || true
chmod 0700 "$DATA/passwd"

# 2. who may use which topics (the shared board login limited in strict mode)
if [ "${MQTT_STRICT_BOARD_LOGIN:-false}" = "true" ]; then
  awk '$0 == "pattern readwrite home/v1/nodes/%c/#" {
         print "pattern write home/v1/nodes/%c/announce"; print "pattern write home/v1/nodes/%c/status"
         print "pattern write home/v1/nodes/%c/log"; print "pattern write home/v1/nodes/%c/telemetry"
         print "pattern read home/v1/nodes/%c/cmd"; next } { print }' "$SRC_ACL" > "$OUT/acl"
  echo "strict board logins: the shared login can only introduce a board"
else
  cp "$SRC_ACL" "$OUT/acl"
fi
chmod 0644 "$OUT/acl"

# 3. the configuration, pointing at the files above
sed -e "s|^password_file .*|password_file $DATA/passwd|" -e "s|^acl_file .*|acl_file $OUT/acl|" "$SRC_CONF" > "$OUT/plain.conf"
cp "$OUT/plain.conf" "$OUT/mosquitto.conf"
PLUGIN=""
for p in /usr/lib/mosquitto_dynamic_security.so /usr/lib/*/mosquitto_dynamic_security.so /usr/local/lib/mosquitto_dynamic_security.so; do
  [ -f "$p" ] && PLUGIN=$p && break
done
DYN="$DATA/dynamic-security.json"
if [ -n "$PLUGIN" ] && [ ! -s "$DYN" ]; then
  # Its own admin login is never used (the API manages it through the ACL above): a random password.
  if command -v mosquitto_ctrl >/dev/null 2>&1 &&
     mosquitto_ctrl dynsec init "$DYN" dynsec-admin "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >/dev/null 2>&1; then
    echo "per-board logins: created $DYN"
  else
    echo "per-board logins: could not create $DYN; boards keep the shared login"
    PLUGIN=""
  fi
fi
if [ -n "$PLUGIN" ]; then
  chown mosquitto:mosquitto "$DYN" 2>/dev/null || true
  chmod 0600 "$DYN"
  printf '\n# Per-board logins (firmware 2.6.0+), managed by the API\nplugin %s\nplugin_opt_config_file %s\n' "$PLUGIN" "$DYN" >> "$OUT/mosquitto.conf"
else
  echo "per-board logins: off (no dynamic-security plugin); boards use the shared login"
fi
