#!/usr/bin/env bash
# Uninstall: keep the data -> pause every site (a reinstall resumes them);
# delete the data -> remove every site and its DNS record.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
list="$(sites)" || { echo "Burrow didn't answer; nothing changed."; exit 1; }
if [ "${ADDON_KEEP_DATA:-1}" = 0 ]; then
  echo "::phase Removing every site"
  while IFS=$'\t' read -r port state addr site who; do
    [ -n "$port" ] && api DELETE "/tunnels/$port" >/dev/null && echo "removed ${addr:-site $port} ($site)"
  done <<<"$list"
else
  echo "::phase Pausing every site (a reinstall brings them back)"
  : > "$ADDON_DATA/paused"
  while IFS=$'\t' read -r port state addr site who; do
    [ "$state" = on ] || continue
    api PATCH "/tunnels/$port" '{"enabled":false}' >/dev/null && echo "$port" >> "$ADDON_DATA/paused" && echo "paused ${addr:-site $port}"
  done <<<"$list"
fi
echo "Done."
