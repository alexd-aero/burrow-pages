#!/usr/bin/env bash
# Install (and update): check Burrow and what builds need, then wait for the
# dashboard to come up. Sites, accounts and deploys are kept across updates;
# 1.x's carry over on the first start.
set -uo pipefail
. "$ADDON_DIR/scripts/lib.sh"
need_burrow

echo "::phase Checking Burrow"
echo "::progress 10 Burrow $ADDON_HOST_VERSION"
api GET /status >/dev/null || { echo "Burrow didn't answer on its control socket. Is it switched on (Settings → Modules)?"; exit 1; }

echo "::phase Checking what builds need"
echo "::progress 35 Docker"
if command -v docker >/dev/null 2>&1 && docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker $(docker version --format '{{.Server.Version}}'): sites that need building (Vite, Astro, Hugo…) can be built here."
else
  echo "::warn Docker isn't usable by this user: sites are served as they are (commit the built site), uploads and proxies work."
fi

echo "::phase Checking GitHub and GitLab"
echo "::progress 55 GitHub"
curl -s -o /dev/null --max-time 12 https://api.github.com/ && echo "GitHub: reachable" || echo "::warn GitHub didn't answer from this machine."
echo "::progress 65 GitLab"
curl -s -o /dev/null --max-time 12 https://gitlab.com/api/v4/version && echo "GitLab: reachable" || echo "::warn GitLab didn't answer from this machine."

# a reinstall brings back the sites an uninstall paused
if [ -s "$ADDON_DATA/paused" ]; then
  echo "::phase Resuming the sites the last uninstall paused"
  if wait_extension; then api POST /x/burrow-pages/resume-all >/dev/null && echo "Sites resumed."; rm -f "$ADDON_DATA/paused"; fi
fi

echo "::phase Starting the dashboard"
echo "::progress 85 the dashboard"
if wait_extension; then
  sum="$(api GET /x/burrow-pages/status)"
  echo "Burrow Pages is running: $(printf '%s' "$sum" | json '`${v.sites} site${v.sites===1?"":"s"}`')."
else
  echo "::warn The dashboard hasn't answered yet; Burrow loads it within a minute."
fi
echo "::progress 100 Ready"
echo "::open $(dashboard)__gate/pages/"
echo "Open it: Burrow → Burrow Pages → Open, or $(dashboard)__gate/pages/"
