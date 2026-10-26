#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
API_TIMEOUT=120 api POST /x/burrow-pages/sync-all >/dev/null && echo "Looked at every repository; new commits are deploying (see the dashboard)."
