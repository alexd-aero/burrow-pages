# Burrow Pages: what every script shares.
#
# Burrow Pages runs inside Burrow (burrow/extension.mjs); its scripts talk to
# it over Burrow's control socket ($BURROW_SOCKET, mode 600): Burrow's own
# routes, and the extension's under /x/burrow-pages/.

NODE="${BURROW_NODE:-$(command -v node || true)}"

need_burrow() {
  if [ "${ADDON_HOST:-}" != burrow ] || [ ! -S "${BURROW_SOCKET:-}" ]; then
    echo "Burrow Pages runs on Aegis × Burrow only (it needs Burrow's control socket)."
    exit 1
  fi
}

# api METHOD PATH [JSON]  -> the response body; non-zero on an HTTP error
api() {
  local out code
  out="$(curl -sS --max-time "${API_TIMEOUT:-30}" --unix-socket "$BURROW_SOCKET" -X "$1" \
           -H 'Content-Type: application/json' -H "X-Burrow-Client: burrow-pages/${ADDON_VERSION:-2}" \
           ${3:+--data "$3"} -w '\n%{http_code}' "http://burrow$2")" || return 1
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  printf '%s' "$out"
  [ "$code" -lt 400 ]
}

# a value out of JSON on stdin: json '.sites.length'
json() { [ -n "$NODE" ] && "$NODE" -e "let j='';process.stdin.on('data',d=>j+=d).on('end',()=>{try{const v=JSON.parse(j);const r=(${1});process.stdout.write(typeof r==='string'?r:JSON.stringify(r))}catch(e){process.exit(1)}})"; }

# where the dashboard is: its domain, or the address Burrow gave us
dashboard() {
  local host
  host="$(api GET /overview 2>/dev/null | json 'v.mainHost||""')" || true
  if [ -n "$host" ]; then printf 'https://%s/' "$host"; else printf '%s' "${ADDON_HOST_URL:-http://127.0.0.1:4310/}"; fi
}

# The extension is loaded a moment after an install: wait for it
wait_extension() {
  for _ in $(seq 1 40); do api GET /x/burrow-pages/status >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
