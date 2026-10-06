#!/usr/bin/env bash
# Status: how many sites, how many answering. Read-only and quick.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
if [ "${ADDON_HOST:-}" != burrow ] || [ ! -S "${BURROW_SOCKET:-}" ] || [ -z "$NODE" ]; then
  echo '{"state":"error","detail":"needs Aegis × Burrow"}'; exit 0
fi
list="$(sites 2>/dev/null)" || { echo '{"state":"error","detail":"Burrow is not answering"}'; exit 0; }
url="$(dashboard)__gate/tunnels#/pages"
LIST="$list" URL="$url" "$NODE" -e '
  const rows = (process.env.LIST || "").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const on = rows.filter((r) => r[1] === "on").length, n = rows.length;
  const detail = n ? `${n} site${n === 1 ? "" : "s"}${on < n ? `, ${n - on} paused` : ""}` : "no sites yet";
  console.log(JSON.stringify({ state: n && !on ? "stopped" : n ? "running" : "installed", detail, url: process.env.URL }));'
