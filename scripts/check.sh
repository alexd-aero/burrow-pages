#!/usr/bin/env bash
# Check every site: does GitHub or GitLab still serve it?
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
list="$(sites)" || { echo "Burrow didn't answer."; exit 1; }
[ -n "$list" ] || { echo "No sites yet."; exit 0; }
bad=0
while IFS=$'\t' read -r port state addr site who; do
  [ -n "$port" ] || continue
  code="$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' "$site" || echo 000)"
  case "$code" in
    2*|3*) echo "ok   $site ($code) → ${addr:-no address yet}$([ "$state" = off ] && echo " (paused)")" ;;
    *) bad=1; echo "::warn $site answers $code: is Pages still switched on for it?" ;;
  esac
done <<<"$list"
[ "$bad" = 0 ] && echo "Every site answers."
exit 0
