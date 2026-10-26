#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
api POST /x/burrow-pages/resume-all | json '`Resumed ${v.resumed} site${v.resumed===1?"":"s"}.`'; echo
