#!/usr/bin/env bash
# Run ON Server B by GitHub Actions (.github/workflows/ci-cd.yml), after the new code has been
# unpacked into /opt/home-platform. Also fine to run by hand:
#   cd /opt/home-platform && bash infra/deploy-from-ci.sh
#
#   1. backs up the database (a new version may migrate it), keeping the last 10 backups
#   2. builds and restarts with infra/deploy-server.sh
#   3. writes .deployed (which commit is live, and when)
#   (and downloads the Urdu voice once, if it isn't there yet)
#
# Undo a bad migration:  gunzip -c infra/backups/<file>.sql.gz | docker exec -i home-postgres psql -U home -d home
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="${1:-manual}"

mkdir -p infra/backups
if docker ps --format '{{.Names}}' | grep -qx home-postgres; then
  file="infra/backups/before-${SHA:0:7}-$(date +%Y%m%d-%H%M%S).sql.gz"
  docker exec home-postgres pg_dump -U home -d home --clean --if-exists | gzip > "$file"
  echo "Database backed up to $file ($(du -h "$file" | cut -f1))"
  ls -1t infra/backups/before-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  echo "home-postgres is not running yet: no backup (first deploy?)"
fi

# The natural Urdu voice (Piper "Fasih", 63 MB): fetched once, kept in apps/assistant/models.
# Without it Urdu replies use espeak-ng. Turn it off with URDU_PIPER_MODEL=off in .env.
voices="https://huggingface.co/rhasspy/piper-voices/resolve/main/ur/ur_PK/fasih/medium"
models="apps/assistant/models"
mkdir -p "$models"
for f in ur_PK-fasih-medium.onnx.json ur_PK-fasih-medium.onnx; do
  if [ ! -s "$models/$f" ]; then
    if curl -fsSL --retry 2 --max-time 300 -o "$models/$f.part" "$voices/$f"; then
      mv "$models/$f.part" "$models/$f" && echo "Downloaded the Urdu voice: $f"
    else
      rm -f "$models/$f.part"; echo "Could not download $f: Urdu replies will use the basic voice"
    fi
  fi
done

bash infra/deploy-server.sh

printf '%s %s\n' "$SHA" "$(date -Is)" > .deployed
echo "Live: ${SHA:0:7}"
