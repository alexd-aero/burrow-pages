#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
api POST /x/burrow-pages/pause-all | json '`Paused ${v.paused} site${v.paused===1?"":"s"}.`'; echo
