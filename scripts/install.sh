#!/usr/bin/env bash
# Install: check Burrow, the way out to GitHub and GitLab and the linked
# domain (is it eligible; does it already point at Pages, for which account?),
# then bring back any site an earlier uninstall paused. Idempotent.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow

echo "::phase Checking Burrow"
echo "::progress 15 Burrow $ADDON_HOST_VERSION"
api GET /status >/dev/null || { echo "Burrow didn't answer on its control socket. Is it switched on (Settings → Modules)?"; exit 1; }

echo "::phase Checking that GitHub and GitLab Pages answer"
echo "::progress 40 GitHub Pages"
if curl -s -o /dev/null --max-time 12 https://pages.github.com/; then echo "GitHub Pages: reachable"
else echo "::warn GitHub Pages didn't answer from this machine. Sites there won't load until it does."; fi
echo "::progress 60 GitLab Pages"
if curl -s -o /dev/null --max-time 12 https://pages.gitlab.io/; then echo "GitLab Pages: reachable"
else echo "::warn GitLab Pages didn't answer from this machine. Sites there won't load until it does."; fi

echo "::phase Checking your domain"
echo "::progress 75 the domain"
api GET /dns | "$NODE" "$ADDON_DIR/burrow/check-domain.mjs" || true

paused="$ADDON_DATA/paused"
if [ -s "$paused" ]; then
  echo "::phase Resuming the sites the last uninstall paused"
  while IFS= read -r port; do
    [ -n "$port" ] && api PATCH "/tunnels/$port" '{"enabled":true}' >/dev/null && echo "resumed site $port"
  done < "$paused"
  rm -f "$paused"
fi

echo "::progress 100 Ready"
echo "::open $(dashboard)__gate/tunnels#/pages"
echo "Burrow Pages is on: Burrow → Burrow Pages → Deploy a repository."
