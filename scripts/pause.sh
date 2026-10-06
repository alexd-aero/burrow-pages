#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
sites | while IFS=$'\t' read -r port state addr site who; do
  [ "$state" = on ] && api PATCH "/tunnels/$port" '{"enabled":false}' >/dev/null && echo "paused ${addr:-site $port}"
done
echo "Every site is paused."
