#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
sites | while IFS=$'\t' read -r port state addr site who; do
  [ "$state" = off ] && api PATCH "/tunnels/$port" '{"enabled":true}' >/dev/null && echo "resumed ${addr:-site $port}"
done
echo "Every site answers again."
