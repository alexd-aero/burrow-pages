#!/usr/bin/env bash
# Status: how many sites, how many answering. Read-only and quick.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
if [ "${ADDON_HOST:-}" != burrow ] || [ ! -S "${BURROW_SOCKET:-}" ] || [ -z "$NODE" ]; then
  echo '{"state":"error","detail":"needs Aegis × Burrow"}'; exit 0
fi
s="$(API_TIMEOUT=8 api GET /x/burrow-pages/status 2>/dev/null)" || { echo '{"state":"installed","detail":"starting"}'; exit 0; }
URL="$(dashboard)__gate/pages/"
printf '%s' "$s" | URL="$URL" json '({state: v.sites && !v.on ? "stopped" : "running", detail: v.sites ? `${v.sites} site${v.sites===1?"":"s"}${v.down ? `, ${v.down} down` : ""}${v.on < v.sites ? `, ${v.sites - v.on} paused` : ""}` : "no sites yet", url: process.env.URL})'
echo
