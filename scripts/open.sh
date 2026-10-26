#!/usr/bin/env bash
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow
echo "::open $(dashboard)__gate/pages/"
echo "$(dashboard)__gate/pages/"
