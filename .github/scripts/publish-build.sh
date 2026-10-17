#!/usr/bin/env bash
# Puts finished builds on the repository's Releases page, where anyone can download them:
#
#   "builds"         always the newest phone app and firmware, under fixed names, so these links never change:
#                    https://github.com/<repo>/releases/latest/download/switchboard-home.apk
#                    https://github.com/<repo>/releases/latest/download/home_node.bin
#   "firmware-vX"    every firmware version, kept (to go back to an older one)
#
#   publish-build.sh latest <file as published name>...     e.g.  build/x.apk=switchboard-home.apk
#   publish-build.sh firmware <version> <file>
set -euo pipefail
repo="$GITHUB_REPOSITORY"
notes=".github/release-notes.md"

upload() {   # tag, then files as path=name
  local tag="$1"; shift
  local work; work=$(mktemp -d)
  local files=()
  for pair in "$@"; do
    cp "${pair%%=*}" "$work/${pair##*=}"
    files+=("$work/${pair##*=}")
  done
  gh release upload "$tag" "${files[@]}" --clobber -R "$repo"
}

case "$1" in
  latest)
    shift
    if gh release view builds -R "$repo" >/dev/null 2>&1; then
      # the tag follows the newest build
      gh api -X PATCH "repos/$repo/git/refs/tags/builds" -f sha="$GITHUB_SHA" -F force=true >/dev/null
      gh release edit builds --notes-file "$notes" --latest -R "$repo" >/dev/null
    else
      gh release create builds --target "$GITHUB_SHA" --title "Latest builds" --notes-file "$notes" --latest -R "$repo"
    fi
    upload builds "$@"
    ;;
  firmware)
    version="$2"; file="$3"; tag="firmware-v$version"
    if ! gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
      gh release create "$tag" --target "$GITHUB_SHA" --title "Board firmware $version" --latest=false -R "$repo" \
        --notes "Firmware $version for the Switchboard boards (ESP8266 NodeMCU / Wemos D1 mini). Upload it in the web app: a board > Firmware > Upload build, then install it on the boards over Wi‑Fi. First time on a new board: flash it over USB (see firmware/README.md)."
    fi
    upload "$tag" "$file=home_node-$version.bin"
    ;;
  *) echo "usage: publish-build.sh latest|firmware ..." >&2; exit 2 ;;
esac
echo "Published to https://github.com/$repo/releases"
