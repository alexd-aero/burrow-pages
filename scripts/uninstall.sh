#!/usr/bin/env bash
# Uninstall: keep the data -> pause every site (a reinstall resumes them);
# delete the data -> remove every site's tunnel and the build caches.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
if [ "${ADDON_KEEP_DATA:-1}" = 0 ]; then
  echo "::phase Removing every site"
  ports="$(api GET /tunnels | json '(v.tunnels||[]).filter(t=>t.app==="burrow-pages").map(t=>t.port).join(" ")')" || { echo "Burrow didn't answer; nothing changed."; exit 1; }
  for p in $ports; do api DELETE "/tunnels/$p" >/dev/null && echo "removed tunnel $p"; done
  if command -v docker >/dev/null 2>&1; then
    vols="$(docker volume ls -q --filter name=burrow-pages-cache- 2>/dev/null)"
    [ -n "$vols" ] && docker volume rm -f $vols >/dev/null 2>&1 && echo "build caches removed"
  fi
else
  echo "::phase Pausing every site (a reinstall brings them back)"
  if api POST /x/burrow-pages/pause-all >/dev/null 2>&1; then echo 1 > "$ADDON_DATA/paused"; echo "Every site is paused."
  else
    # the extension may already be gone: pause its tunnels directly
    ports="$(api GET /tunnels | json '(v.tunnels||[]).filter(t=>t.app==="burrow-pages"&&t.enabled).map(t=>t.port).join(" ")')"
    for p in $ports; do api PATCH "/tunnels/$p" '{"enabled":false}' >/dev/null && echo "paused tunnel $p"; done
  fi
fi
echo "Done."
