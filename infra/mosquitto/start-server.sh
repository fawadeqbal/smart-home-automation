#!/bin/sh
# Starts Mosquitto on Server B: logins from .env (see prepare.sh), TLS certificate from the server's Caddy.
# Caddy renews the certificate by itself; when the file changes this script exits and Docker
# restarts the container with the new one (boards reconnect within seconds).
set -eu
DIR="/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$MQTT_TLS_HOST"
CRT="$DIR/$MQTT_TLS_HOST.crt"
KEY="$DIR/$MQTT_TLS_HOST.key"

until [ -s "$CRT" ] && [ -s "$KEY" ]; do
  echo "waiting for Caddy's certificate for $MQTT_TLS_HOST ..."
  sleep 15
done
mkdir -p /mosquitto/certs
cp "$CRT" /mosquitto/certs/cert.pem
cp "$KEY" /mosquitto/certs/key.pem
chown -R mosquitto:mosquitto /mosquitto/certs
chmod 0600 /mosquitto/certs/key.pem

# Connection log for the API (see mosquitto.server.conf). Created here so it is readable (0644):
# a file Mosquitto creates itself is private to it.
LOG=/mosquitto/log/broker.log
mkdir -p /mosquitto/log
touch "$LOG"
chown -R mosquitto:mosquitto /mosquitto/log
chmod 0755 /mosquitto/log
chmod 0644 "$LOG"
# Keeps the newest lines when it passes 2 MB (rewritten in place: Mosquitto appends, so nothing is lost).
trim_log() {
  if [ "$(wc -c < "$LOG")" -gt 2097152 ]; then
    tail -n 8000 "$LOG" > "$LOG.tmp" && cat "$LOG.tmp" > "$LOG"
    rm -f "$LOG.tmp"
  fi
}
trim_log

# Logins (fixed ones from .env, per-board ones kept by the API) and the configuration to run
sh /mosquitto/config/prepare.sh /mosquitto/config/mosquitto.conf /mosquitto/config/acl

# With per-board logins; if the plugin won't load, without (boards then use the shared login)
mosquitto -c /tmp/mosquitto/mosquitto.conf &
PID=$!
sleep 3
if ! kill -0 "$PID" 2>/dev/null; then
  echo "Mosquitto would not start with per-board logins: starting without them"
  mosquitto -c /tmp/mosquitto/plain.conf &
  PID=$!
fi
trap 'kill "$PID" 2>/dev/null; wait "$PID"; exit 0' TERM INT
SUM="$(sha256sum < "$CRT")"
while kill -0 "$PID" 2>/dev/null; do
  sleep 60
  trim_log
  if [ "$(sha256sum < "$CRT" 2>/dev/null)" != "$SUM" ]; then
    echo "certificate renewed: restarting to load it"
    kill "$PID"; wait "$PID" || true
    exit 0
  fi
done
wait "$PID"
