#!/usr/bin/env bash
# Check every site now.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
API_TIMEOUT=120 api POST /x/burrow-pages/check-all | json 'v.sites.length ? v.sites.map(s=>`${s.ok?"ok  ":"DOWN"} ${s.name}${s.url?` (${s.url})`:""}${s.error?`: ${s.error}`:""}`).join("\n") : "No sites yet."'
echo
