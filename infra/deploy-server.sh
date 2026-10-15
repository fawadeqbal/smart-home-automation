#!/usr/bin/env bash
# Switchboard on Server B: build and (re)start. Run ON the server:
#   cd /opt/home-platform && bash infra/deploy-server.sh
# Settings and secrets: /opt/home-platform/.env (made once at first deploy; keep it).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env is missing in $(pwd)"; exit 1; }
C="docker compose -p home -f infra/docker-compose.server.yml --env-file .env"
# One image at a time: the server has 2 CPUs and runs KCP and Vibe too.
for s in home-api home-web home-assistant; do $C build "$s"; done
$C up -d
for _ in $(seq 1 40); do
  st="$(docker inspect -f '{{.State.Status}}' home-api 2>/dev/null || echo missing)"
  [ "$st" = running ] && docker logs home-api 2>&1 | grep -qiE 'listening|started|Nest application' && break
  sleep 5
done
$C ps
docker image prune -f >/dev/null || true
