# Burrow Pages: what every script shares.
#
# Burrow Pages is a Burrow-only addon. Its scripts talk to Burrow over the
# control socket ($BURROW_SOCKET, mode 600); the rest of it (accounts, GitHub
# sign-in, repositories, deploys, the file servers) runs inside Burrow while it
# is installed: burrow/extension.mjs, with its card in burrow/ui.js.

NODE="${BURROW_NODE:-$(command -v node || true)}"

need_burrow() {
  if [ "${ADDON_HOST:-}" != burrow ] || [ ! -S "${BURROW_SOCKET:-}" ]; then
    echo "Burrow Pages runs on Aegis × Burrow only (it needs Burrow's control socket)."
    exit 1
  fi
  [ -n "$NODE" ] || { echo "Node.js isn't on PATH (Burrow sets BURROW_NODE from 2.8.0 on)."; exit 1; }
}

# api METHOD PATH [JSON]  -> the response body; non-zero on an HTTP error
api() {
  local out code
  out="$(curl -sS --max-time 20 --unix-socket "$BURROW_SOCKET" -X "$1" \
           -H 'Content-Type: application/json' -H "X-Burrow-Client: burrow-pages/${ADDON_VERSION:-1}" \
           ${3:+--data "$3"} -w '\n%{http_code}' "http://burrow$2")" || return 1
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  printf '%s' "$out"
  [ "$code" -lt 400 ]
}

# The sites, one per line: PORT<TAB>on|off<TAB>ADDRESS<TAB>SITE<TAB>WHO
sites() {
  api GET /tunnels | "$NODE" -e '
    let j = ""; process.stdin.on("data", (d) => (j += d)).on("end", () => {
      for (const t of JSON.parse(j).tunnels || []) if (t.kind === "site" || t.app === "burrow-pages")
        console.log([t.port, t.enabled ? "on" : "off", t.url || "", t.site ? t.site.url : t.meta?.repo || "", t.access].join("\t"));
    });'
}

# Where the dashboard is: its domain, or the address Burrow gave us
dashboard() {
  local host
  host="$(api GET /overview 2>/dev/null | "$NODE" -e 'let j="";process.stdin.on("data",(d)=>(j+=d)).on("end",()=>{try{process.stdout.write(JSON.parse(j).mainHost||"")}catch{}})')" || true
  if [ -n "$host" ]; then printf 'https://%s/' "$host"; else printf '%s' "${ADDON_HOST_URL:-http://127.0.0.1:4310/}"; fi
}
