// Burrow Pages: the dashboard. One module, no build step. Routes live in the
// hash (#/site/<id>/deploys), the server pushes jobs and site changes over
// /api/events, and every request goes to the API next to this page.

/* ================================================================ basics */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const main = $("#main");
const S = { state: null, sites: {}, stats: {}, files: {}, jobs: new Map(), wiz: null, acctForm: null, dirty: null, live: false, activity: null, settings: null };

const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  github: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
  gitlab: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="m22.65 13.39-1.24-3.8-2.45-7.53a.42.42 0 0 0-.8 0L15.7 9.6H8.3L5.84 2.06a.42.42 0 0 0-.8 0L2.6 9.59l-1.24 3.8a.85.85 0 0 0 .31.95L12 21.86l10.34-7.52a.85.85 0 0 0 .31-.95z"/></svg>',
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  rocket: svg('<path d="M14 4c3-1 6 0 6 0s1 3 0 6l-6 6-4-4z"/><path d="m10 12-3 1-3 3 4 1M12 14l-1 3 1 4 3-3 1-3"/>'),
  sync: svg('<path d="M20 12a8 8 0 0 1-14 5.3M4 12A8 8 0 0 1 18 6.7"/><path d="M18 2.5v4.5h-4.5M6 21.5V17h4.5"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chev: svg('<path d="m9 18 6-6-6-6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>'),
  open: svg('<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M8 12h8M12 8v8"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  play: svg('<path d="M7 4v16l13-8z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  doc: svg('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>'),
  folder: svg('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.4),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  warn: svg('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  sites: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  pulse: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  branch: svg('<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6M18 9.2c0 5-7 3.5-11 7.6"/>'),
  commit: svg('<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>'),
  box: svg('<path d="m21 8-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  heart: svg('<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};
const PROV = { github: "GitHub", gitlab: "GitLab" };
const LANG = { HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c", JavaScript: "#f1e05a", TypeScript: "#3178c6", Vue: "#41b883", Svelte: "#ff3e00", Astro: "#ff5a03",
               Ruby: "#701516", Python: "#3572A5", Go: "#00ADD8", Rust: "#dea584", Java: "#b07219", Shell: "#89e051", MDX: "#fcb32c", Markdown: "#083fa1", Dart: "#00B4AB" };

const ago = (t) => {
  if (!t) return "never";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return "just now"; if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 5400) return "an hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 172800) return "yesterday";
  if (s < 30 * 86400) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: s > 300 * 86400 ? "numeric" : undefined });
};
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const bytes = (b) => { b = Number(b) || 0; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`; if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`; return `${(b / 1073741824).toFixed(2)} GB`; };
const num = (n) => { n = Number(n) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n); };
const secs = (s) => (s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const mark = (name, cls = "") => `<span class="mono-mark ${cls}" style="background:linear-gradient(140deg,hsl(${hue(name)} 42% 34%),hsl(${(hue(name) + 40) % 360} 38% 22%))">${h(String(name || "?").trim()[0]?.toUpperCase() || "?")}</span>`;
const zoneSuffix = () => { const t = Object.values(S.state?.sites || {}).find((x) => x.host && x.sub); return t ? t.host.slice(t.sub.length + 1) : S.state?.zone || ""; };

/* ================================================================ API */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { method = "GET", body, raw } = {}) {
  const opt = { method, headers: { "X-Pages": "1" }, credentials: "same-origin" };
  if (body !== undefined && !raw) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  if (raw) opt.body = raw;
  let r;
  try { r = await fetch(`api${path}`, opt); } catch { throw new ApiError("The dashboard didn't answer. Is this machine online?", 0); }
  if (r.status === 401) { signedOut(); throw new ApiError("You were signed out.", 401); }
  const type = r.headers.get("content-type") || "";
  const j = type.includes("json") ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) throw new ApiError((j && j.error) || `HTTP ${r.status}`, r.status);
  return j;
}
function signedOut() {
  main.innerHTML = `<div class="card empty"><div class="mark">${I.lock}</div><h2>Signed out</h2><p>Your dashboard session ended. Sign in again to keep working on your sites.</p><a class="btn primary" href="/__gate/login?next=${encodeURIComponent("/__gate/pages/" + location.hash)}">Sign in</a></div>`;
}

/* ================================================================ toasts, modals */
function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${kind === "err" ? I.warn : I.check}<div>${h(msg)}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, kind === "err" ? 6500 : 3200);
}
let modalEl = null;
function modal(html, { wide, onClose } = {}) {
  closeModal();
  modalEl = document.createElement("div");
  modalEl.className = "scrim";
  modalEl.innerHTML = `<div class="card modal${wide ? " wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  modalEl.addEventListener("mousedown", (e) => { if (e.target === modalEl) closeModal(); });
  modalEl._onClose = onClose;
  document.body.appendChild(modalEl);
  setTimeout(() => $("input:not([type=hidden]):not([disabled]), textarea, select", modalEl)?.focus(), 30);
  return modalEl.firstElementChild;
}
function closeModal() { if (!modalEl) return; const f = modalEl._onClose; modalEl.remove(); modalEl = null; f?.(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalEl) closeModal(); });
function confirmBox({ title, text, ok = "Confirm", danger, type }) {
  return new Promise((done) => {
    const m = modal(`<div class="modal-h"><div class="grow"><h2>${h(title)}</h2><p>${text}</p></div></div>
      ${type ? `<label class="f"><span>Type <b class="mono">${h(type)}</b> to confirm</span><input class="inp" id="cfType" autocomplete="off" spellcheck="false"></label>` : ""}
      <div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-ok ${type ? "disabled" : ""}>${h(ok)}</button></div>`, { onClose: () => done(false) });
    if (type) $("#cfType", m).oninput = (e) => { $("[data-ok]", m).disabled = e.target.value.trim() !== type; };
    $("[data-x]", m).onclick = () => closeModal();
    $("[data-ok]", m).onclick = () => { modalEl._onClose = null; closeModal(); done(true); };
  });
}
async function busy(btn, fn) {
  if (!btn) return fn();
  const was = btn.innerHTML;
  btn.classList.add("busy"); btn.disabled = true;
  if (!btn.querySelector("svg")) btn.innerHTML = I.sync + was;
  try { return await fn(); } finally { if (btn.isConnected) { btn.classList.remove("busy"); btn.disabled = false; btn.innerHTML = was; } }
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy: select it and copy by hand.", "err"); } }

/* ================================================================ the pieces */
function status(s) {
  if (s.busy || s.last?.state === "building") return `<span class="badge busy"><i></i>Deploying</span>`;
  if (s.paused) return `<span class="badge paused"><i></i>Paused</span>`;
  if (!s.tunnel) return `<span class="badge fail"><i></i>No tunnel</span>`;
  if (s.maintenance === true || s.maintenance?.on) return `<span class="badge maint"><i></i>Maintenance</span>`;
  if (s.type !== "proxy" && !s.current) return s.last?.state === "failed" ? `<span class="badge fail"><i></i>Failed</span>` : `<span class="badge"><i></i>No deploy yet</span>`;
  if (s.health && !s.health.ok) return `<span class="badge down"><i></i>Down</span>`;
  if (s.last?.state === "failed") return `<span class="badge fail" title="The last deploy failed; the one before it is still live"><i></i>Live · last deploy failed</span>`;
  return `<span class="badge live"><i></i>Live</span>`;
}
const accessChip = (a) => a === "public" ? `<span class="chip pub">${I.globe}Public</span>` : a === "password" ? `<span class="chip">${I.key}Password</span>` : `<span class="chip">${I.lock}Your login</span>`;
function sourceLine(s) {
  if (s.type === "git") return `<span class="site-src">${I[s.source.provider]}<span class="ell">${h(s.source.repo)}</span><span class="faint">·</span>${I.branch}<span class="ell">${h(s.source.branch)}</span>${s.source.mode === "build" ? `<span class="chip">${I.box}build</span>` : ""}</span>`;
  if (s.type === "proxy") return `<span class="site-src">${I.globe}<span class="ell">${h(String(s.source.upstream || "").replace(/^https?:\/\//, ""))}</span></span>`;
  return `<span class="site-src">${I.upload}<span>Uploaded files</span></span>`;
}
function spark(values) {
  const max = Math.max(1, ...values), w = 110, hgt = 28, n = values.length;
  const pts = values.map((v, i) => [Math.round((i / (n - 1)) * w * 10) / 10, Math.round((hgt - 2 - (v / max) * (hgt - 4)) * 10) / 10]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line}L${w},${hgt}L0,${hgt}Z"/><path class="l" d="${line}"/></svg>`;
}
const avatar = (a, cls = "") => a?.avatar ? `<img class="av ${cls}" src="api/accounts/${encodeURIComponent(a.id)}/avatar" alt="" loading="lazy">` : `<span class="av ${cls}">${h((a?.username || "?")[0].toUpperCase())}</span>`;
function logHtml(lines) {
  return lines.map((l) => {
    const m = /^(\d\d:\d\d:\d\d)  (.*)$/.exec(l);
    const t = m ? m[1] : "", x = m ? m[2] : l;
    const cls = x.startsWith("✗") ? "x" : x.startsWith("✓") ? "v" : x.startsWith("⚠") ? "w" : x.startsWith("  ") ? "d" : "";
    return `${t ? `<span class="t">${t} </span>` : ""}<span class="${cls}">${h(x)}</span>`;
  }).join("\n");
}

/* ================================================================ routing */
const route = () => { const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean); return { view: p[0] || "sites", id: p[1], tab: p[2], extra: p[3] }; };
function nav() {
  const r = route(), on = (v) => (r.view === v || (v === "sites" && (r.view === "site" || r.view === "new")) ? "on" : "");
  // the header's tabs, and the same tabs at the bottom on phones (outside the
  // header: its backdrop blur would make it the box a fixed bar sits in)
  const links = `<a href="#/" class="${on("sites")}">${I.sites}<span>Sites</span></a><a href="#/accounts" class="${on("accounts")}">${I.people}<span>Accounts</span></a><a href="#/activity" class="${on("activity")}">${I.pulse}<span>Activity</span></a><a href="#/settings" class="${on("settings")}">${I.gear}<span>Settings</span></a>`;
  $("#nav").innerHTML = links; $("#bnav").innerHTML = links;
}
async function render() {
  nav();
  const r = route();
  if (S.dirty && !(r.view === "site" && r.id === S.dirty.site && r.tab === "settings")) S.dirty = null;
  try {
    if (!S.state) await loadState();
    if (r.view === "sites") return renderSites();
    if (r.view === "site") return renderSite(r);
    if (r.view === "new") return renderNew(r);
    if (r.view === "accounts") return renderAccounts();
    if (r.view === "activity") return renderActivity(r);
    if (r.view === "settings") return renderSettings();
    location.hash = "#/";
  } catch (e) {
    if (e.status === 401) return;
    main.innerHTML = `<div class="notice err">${I.warn}<div class="grow">${h(e.message)}</div><button class="btn sm" onclick="location.reload()">Try again</button></div>`;
  }
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
async function loadState() {
  S.state = await api("/state");
  S.state.sites = Object.fromEntries(S.state.sites.map((s) => [s.id, s]));
  for (const j of S.state.jobs) S.jobs.set(j.id, j);
}

/* ================================================================ live updates */
function connect() {
  const es = new EventSource("api/events");
  es.onopen = () => { S.live = true; $("#live").classList.add("on"); $("#live").title = "Live updates on"; };
  es.onerror = () => { S.live = false; $("#live").classList.remove("on"); $("#live").title = "Reconnecting…"; };
  es.addEventListener("job", (e) => {
    const j = JSON.parse(e.data);
    S.jobs.set(j.id, j);
    paintJob(j);
    if (j.state === "done" || j.state === "failed") {
      if (j.state === "done" && j.kind === "deploy") toast(`${S.state?.sites[j.site]?.name || "Site"} is live`);
      if (j.state === "failed") toast(`${S.state?.sites[j.site]?.name || "Deploy"}: ${j.error}`, "err");
      if (S.sites[j.site]) refreshSite(j.site);
    }
  });
  es.addEventListener("site", (e) => {
    const s = JSON.parse(e.data);
    if (!S.state) return;
    if (s.removed) delete S.state.sites[s.id]; else S.state.sites[s.id] = s;
    const r = route();
    if (r.view === "sites") paintSites();
    if (r.view === "site" && r.id === s.id && !s.removed) { if (S.sites[s.id]) Object.assign(S.sites[s.id], s); paintSiteHead(); if (!r.tab || r.tab === "overview") paintTab(); }
  });
}
let refreshT = {};
function refreshSite(id) {
  clearTimeout(refreshT[id]);
  refreshT[id] = setTimeout(async () => {
    try {
      S.sites[id] = { ...(await api(`/sites/${id}`)), _at: Date.now() };
      const r = route();
      if (r.view === "site" && r.id === id) { paintSiteHead(); if (r.tab !== "settings") paintTab(); }
    } catch { /* gone */ }
  }, 300);
}
function paintJob(j) {
  for (const el of $$(`[data-job="${j.id}"]`)) {
    el.className = `job ${j.state === "done" ? "done" : j.state === "failed" ? "failed" : ""}`;
    $(".phase", el).textContent = j.state === "done" ? "Done" : j.state === "failed" ? j.error : j.phase;
    if (j.label) $(".jl", el).textContent = j.label;
    $(".bar", el)?.classList.toggle("hidden", j.state !== "running" && j.state !== "queued");
    const log = $(".log", el);
    if (log) { const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30; log.innerHTML = logHtml(j.log); if (stick) log.scrollTop = log.scrollHeight; }
    const done = $(".job-done", el);
    if (done) done.classList.toggle("hidden", j.state !== "done");
  }
}
const jobBox = (j, { open = true, extra = "" } = {}) => `<div class="job ${j.state === "done" ? "done" : j.state === "failed" ? "failed" : ""}" data-job="${j.id}">
  <div class="job-h">${j.state === "failed" ? I.warn : j.state === "done" ? I.check : I.rocket}<span class="jl">${h(j.label)}</span><span class="phase grow ell">${h(j.state === "done" ? "Done" : j.state === "failed" ? j.error : j.phase)}</span>
    <button class="btn xs ghost" data-act="toggle-log">${open ? "Hide log" : "Show log"}</button></div>
  <div class="bar ${j.state === "running" || j.state === "queued" ? "" : "hidden"}"><i></i></div>
  <div class="log ${open ? "" : "hidden"}">${logHtml(j.log)}</div>${extra}</div>`;

/* ================================================================ sites */
function renderSites() {
  const st = S.state;
  const list = Object.values(st.sites);
  const t = list.reduce((a, s) => ({ v: a.v + (s.today?.v || 0), p: a.p + (s.today?.p || 0), r: a.r + (s.today?.r || 0), b: a.b + (s.today?.b || 0) }), { v: 0, p: 0, r: 0, b: 0 });
  const live = list.filter((s) => s.tunnel && !s.paused && (s.type === "proxy" || s.current) && !(s.health && !s.health.ok)).length;
  main.innerHTML = `
    <div class="page-h"><div class="grow"><h1>Sites</h1><p>Static websites on your own addresses${st.zone ? ` at <span class="mono">*.${h(zoneSuffix())}</span>` : ""}, behind your login, a password, or open to everyone.</p></div>
      ${list.length ? `<a class="btn primary" href="#/new">${I.plus}New site</a>` : ""}</div>
    ${st.legacy?.length ? `<div class="notice warn">${I.info}<div class="grow">${st.legacy.length === 1 ? "One site" : `${st.legacy.length} sites`} from the old Burrow Pages ${st.legacy.length === 1 ? "is" : "are"} still a plain Burrow tunnel: <b>${st.legacy.map((x) => h(x.sub || x.name)).join(", ")}</b>. Move ${st.legacy.length === 1 ? "it" : "them"} in for caching, stats, health checks and public access.</div><button class="btn sm" data-act="legacy">Move in</button></div>` : ""}
    ${list.length ? `<div class="stats">
      <div class="card stat"><b>${live}<span class="faint" style="font-size:16px">/${list.length}</span></b><span>sites live</span></div>
      <div class="card stat"><b>${num(t.v)}</b><span>visitors today</span></div>
      <div class="card stat"><b>${num(t.p)}</b><span>page views today</span></div>
      <div class="card stat"><b>${bytes(t.b)}</b><span>served today · ${num(t.r)} requests</span></div>
    </div>` : ""}
    <div id="sitesArea"></div>`;
  paintSites();
}
function paintSites() {
  const area = $("#sitesArea"); if (!area) return;
  const list = Object.values(S.state.sites).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!list.length) {
    area.innerHTML = `<div class="card empty"><div class="mark">${I.layers}</div><h2>Your first site</h2><p>Pick where it comes from. It gets its own address on your domain, HTTPS, and stays behind your login until you say otherwise.</p>
      <div class="sources" style="max-width:820px;margin:0 auto;text-align:left">${sourceCards()}</div></div>`;
    return;
  }
  area.innerHTML = `<div class="sites">${list.map(siteCard).join("")}</div>`;
}
function siteCard(s) {
  const c = s.current;
  return `<div class="card site" data-go="#/site/${s.id}" tabindex="0" role="link" aria-label="${h(s.name)}">
    <div class="site-top">${mark(s.name)}<div class="grow"><div class="site-name ell">${h(s.name)}</div>
      <div class="site-host">${s.url ? `<a href="${h(s.url)}" target="_blank" rel="noopener" data-stop>${h(s.host)}</a>` : `<span class="faint">${h(s.sub || "")}</span>`}</div></div>
      <div>${status(s)}</div></div>
    ${sourceLine(s)}
    <div class="site-foot"><div class="commit grow">
      <div class="row" style="gap:6px;margin-bottom:4px">${accessChip(s.access)}${s.today?.v ? `<span class="chip">${I.user}${num(s.today.v)} today</span>` : ""}</div>
      ${c ? `<div class="ell">${c.sha ? `<span class="mono">${h(c.sha.slice(0, 7))}</span> ` : ""}<b>${h(c.message || "Deployed")}</b></div><div>${ago(c.at)}</div>`
          : s.type === "proxy" ? `<div>${s.health ? `${s.health.ok ? "Answering" : "Not answering"} · checked ${ago(s.health.at)}` : "Checking…"}</div>` : `<div>${s.last?.state === "failed" ? `<span class="bad">${h(s.last.error || "Failed")}</span>` : "Nothing deployed yet"}</div>`}
    </div>${spark(s.spark || [])}</div>
  </div>`;
}
const sourceCards = () => `
  <button class="source" data-go="#/new/git"><div class="ic">${I.github}</div><b>From a repository</b><span>GitHub or GitLab, private ones too. Every push goes live; sites that need building are built in a container.</span></button>
  <button class="source" data-go="#/new/upload"><div class="ic">${I.upload}</div><b>Upload files</b><span>Drop a folder, a .zip or a .tar.gz. Upload a new version whenever you like.</span></button>
  <button class="source" data-go="#/new/proxy"><div class="ic">${I.globe}</div><b>A site elsewhere</b><span>GitLab or GitHub Pages, or any website, answering on your address with caching and stats.</span></button>`;

/* ================================================================ new site */
function renderNew(r) {
  const kind = r.id;
  if (!kind) {
    main.innerHTML = `<div class="crumbs"><a href="#/">Sites</a>${I.chev}<span>New site</span></div>
      <div class="page-h"><div class="grow"><h1>New site</h1><p>Where does it come from?</p></div></div><div class="sources">${sourceCards()}</div>`;
    return;
  }
  if (!S.wiz || S.wiz.kind !== kind) S.wiz = { kind, step: 0, access: S.state.settings.access || "login", acct: null, repo: null, q: "" };
  paintWizard();
}
function wizShell(title, sub, steps, step, body) {
  return `<div class="crumbs"><a href="#/">Sites</a>${I.chev}<a href="#/new">New site</a>${I.chev}<span>${h(title)}</span></div>
    <div class="page-h"><div class="grow"><h1>${h(title)}</h1><p>${sub}</p></div></div>
    <div class="steps">${Array.from({ length: steps }, (_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>${body}`;
}
function addressFields(w, { name } = {}) {
  const suffix = zoneSuffix();
  return `<div class="grid2">
      <label class="f"><span>Name</span><input class="inp" id="wName" value="${h(w.name ?? name ?? "")}" maxlength="60" placeholder="My site"></label>
      <div class="f" style="margin-top:0"><span class="lbl">Address</span><div class="inp-group"><input class="inp mono" id="wSub" value="${h(w.sub || "")}" maxlength="63" placeholder="docs" autocapitalize="none" spellcheck="false">${suffix ? `<span class="add">.${h(suffix)}</span>` : ""}</div><div class="help" id="wSubHelp">Letters, digits and dashes.</div></div>
    </div>
    <div class="f" style="margin-top:16px"><span class="lbl">Who can open it</span>
      <div class="seg full" id="wAccess">${[["login", I.lock, "Your login"], ["password", I.key, "A password"], ["public", I.globe, "Everyone"]].map(([v, ic, t]) => `<button type="button" data-v="${v}" class="${w.access === v ? "on" : ""}">${ic}${t}</button>`).join("")}</div>
      <div class="help" id="wAccessHelp">${accessHelp(w.access)}</div>
      <div id="wPwWrap" class="${w.access === "password" ? "" : "hidden"}" style="margin-top:10px"><input class="inp" type="password" id="wPw" autocomplete="new-password" placeholder="The site's password"></div>
    </div>`;
}
const accessHelp = (a) => a === "public" ? "Anyone with the address. New visitors are checked by your gate's shield first." : a === "password" ? "Visitors type a password of the site's own. You stay signed in with your login too." : "Only you, signed in to this dashboard.";
let subT = null;
function wireAddress(w) {
  const sub = $("#wSub"), help = $("#wSubHelp");
  const check = () => {
    clearTimeout(subT);
    const v = sub.value.trim().toLowerCase();
    w.sub = v;
    if (!v) { help.className = "help"; help.textContent = "Letters, digits and dashes."; return; }
    subT = setTimeout(async () => {
      const r = await api(`/check-sub?sub=${encodeURIComponent(v)}`).catch((e) => ({ ok: false, error: e.message }));
      if (sub.value.trim().toLowerCase() !== v) return;
      help.className = `help ${r.ok ? "okc" : "err"}`;
      help.textContent = r.ok ? `✓ ${r.host || v} is free` : r.error;
      w.subOk = r.ok;
    }, 280);
  };
  sub.oninput = () => { sub.value = sub.value.toLowerCase().replace(/[^a-z0-9-]/g, ""); w.subTouched = true; check(); };
  $("#wName").oninput = (e) => { w.name = e.target.value; if (!w.subTouched) { sub.value = slug(e.target.value); check(); } };
  $("#wAccess").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    w.access = b.dataset.v;
    $$("#wAccess button").forEach((x) => x.classList.toggle("on", x === b));
    $("#wAccessHelp").textContent = accessHelp(w.access);
    $("#wPwWrap").classList.toggle("hidden", w.access !== "password");
  };
  if (sub.value) check();
}
const slug = (s) => String(s || "").toLowerCase().split("/").pop().replace(/\.github\.io$|\.gitlab\.io$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
function readAddress(w) {
  w.name = $("#wName").value.trim(); w.sub = $("#wSub").value.trim();
  const pw = $("#wPw")?.value || "";
  if (!w.name) throw new Error("Give the site a name.");
  if (!w.sub) throw new Error("Pick its address.");
  if (w.access === "password" && !pw) throw new Error("Set the site's password.");
  return { name: w.name, sub: w.sub, access: w.access, password: w.access === "password" ? pw : undefined };
}

function paintWizard() {
  const w = S.wiz;
  if (w.kind === "git") return paintGitWizard();
  if (w.kind === "proxy") {
    main.innerHTML = wizShell("A site elsewhere", "A website that lives somewhere else, answering on your address. Caching keeps it up when the original has a bad minute.", 1, 0, `
      <div class="card pad">
        <label class="f"><span>Its address</span><input class="inp mono" id="wUp" value="${h(w.upstream || "")}" placeholder="https://group.gitlab.io/project/" spellcheck="false" autocapitalize="none"></label>
        <div class="help" id="wUpHelp">GitLab or GitHub Pages, or any http(s) website. A path is kept: /project/x is fetched for /x.</div>
        <div class="divider"></div>
        ${addressFields(w)}
        <div class="divider"></div>
        <div class="toggle-row"><label class="switch"><input type="checkbox" id="wCache" ${w.cache !== false ? "checked" : ""}><i></i></label><div><b>Cache pages for a minute</b><span>Faster, and if the original goes down your visitors still get the last copy for up to a day.</span></div></div>
        <div class="toggle-row"><label class="switch"><input type="checkbox" id="wRewrite" ${w.rewrite ? "checked" : ""}><i></i></label><div><b>Rewrite links to the original</b><span>Absolute links in its pages that point at the original address point at yours instead.</span></div></div>
        <div class="modal-f"><a class="btn ghost" href="#/new">Back</a><button class="btn primary" data-act="wiz-proxy">${I.rocket}Create the site</button></div>
      </div>`);
    wireAddress(w);
    let t = null;
    $("#wUp").oninput = (e) => {
      w.upstream = e.target.value.trim();
      if (!w.nameTouched && !$("#wName").value) { try { const u = new URL(/^https?:/.test(w.upstream) ? w.upstream : "https://" + w.upstream); const n = u.pathname.split("/").filter(Boolean).pop() || u.hostname.split(".")[0]; $("#wName").value = n; w.name = n; if (!w.subTouched) { $("#wSub").value = slug(n); $("#wSub").dispatchEvent(new Event("input")); w.subTouched = false; } } catch { /* typing */ } }
      clearTimeout(t);
    };
    return;
  }
  // upload
  main.innerHTML = wizShell("Upload files", "A static site from your computer: a folder with an index.html in it, or that folder as a .zip or .tar.gz.", 2, w.step, w.step === 0 ? `
    <div class="card pad">${addressFields(w)}
      <div class="modal-f"><a class="btn ghost" href="#/new">Back</a><button class="btn primary" data-act="wiz-upload-create">Next: the files</button></div></div>` : `
    <div class="card pad">${dropZone()}<div id="upProgress"></div></div>`);
  if (w.step === 0) wireAddress(w); else wireDrop($(".drop"), w.siteId, true);
}

/* ---------------- repository wizard ---------------- */
function paintGitWizard() {
  const w = S.wiz, accts = S.state.accounts;
  if (w.step === 0) {
    if (!w.acct && accts.length) w.acct = (accts.find((a) => a.signedIn) || accts[0]).id;
    main.innerHTML = wizShell("From a repository", "Pick the repository. The ones with the most commits and the most recent activity come first.", 3, 0, `
      <div class="card pad">
        ${accts.length ? `<div class="acct-pick" id="wAccts">${accts.map((a) => `<button data-acct="${h(a.id)}" class="${w.acct === a.id ? "on" : ""}">${avatar(a)}${I[a.provider]}<span>${h(a.username)}</span>${a.signedIn ? "" : `<span class="faint tiny">public only</span>`}</button>`).join("")}<button data-act="acct-add">${I.plus}<span>Add an account</span></button></div>`
          : `<div class="notice">${I.info}<div class="grow">Connect GitHub or GitLab first: sign in for private repositories, or just name an account for its public ones.</div><button class="btn sm primary" data-act="acct-add">Connect an account</button></div>`}
        ${w.acct ? `<div class="row" style="margin-bottom:10px"><input class="inp grow" id="wQ" placeholder="Search repositories" value="${h(w.q)}" autocomplete="off"><button class="btn icon" data-act="repos-fresh" title="Load again">${I.sync}</button></div>
        <div class="repos" id="wRepos"><div class="skel" style="height:220px;margin:12px"></div></div>
        <div class="help">Or type <span class="mono">owner/repository</span> above for one that isn't listed.</div>` : ""}
      </div>`);
    if (w.acct) { loadRepos(false); $("#wQ").oninput = (e) => { w.q = e.target.value; paintRepos(); }; }
    return;
  }
  if (w.step === 1) {
    const d = w.det;
    main.innerHTML = wizShell(w.repo.full, `${PROV[w.repo.provider]} repository${w.repo.private ? " · private" : ""}${w.repo.description ? ` · ${h(w.repo.description)}` : ""}`, 3, 1, `
      <div class="card pad">
        <div class="grid2"><label class="f"><span>Branch</span><select class="inp" id="wBranch">${w.branches.map((b) => `<option ${b === w.branch ? "selected" : ""}>${h(b)}</option>`).join("")}</select></label>
          <label class="f" style="margin-top:0"><span>Folder <span class="faint">(optional)</span></span><input class="inp mono" id="wPath" value="${h(w.path || "")}" placeholder="the top of the repository" spellcheck="false"></label></div>
        <div id="wDetect">${d ? detectBox(d) : `<div class="skel" style="height:74px;margin:14px 0"></div>`}</div>
        <div id="wBuild" class="${w.mode === "build" ? "" : "hidden"}">${buildFields(w.build || {})}</div>
        <div class="modal-f"><button class="btn ghost" data-act="wiz-back">Back</button><button class="btn primary" data-act="wiz-git-next" ${d ? "" : "disabled"}>Next: its address</button></div>
      </div>`);
    $("#wBranch").onchange = (e) => { w.branch = e.target.value; runDetect(); };
    let t = null; $("#wPath").oninput = (e) => { w.path = e.target.value.trim().replace(/^\/+|\/+$/g, ""); clearTimeout(t); t = setTimeout(runDetect, 500); };
    if (!d) runDetect();
    return;
  }
  if (w.step === 2) {
    main.innerHTML = wizShell(w.repo.full, `${w.mode === "build" ? `Built with ${h(w.build?.name || w.build?.image || "a container")}` : `Served as it is from ${w.path ? h(w.path) + "/" : "the top folder"}`} · ${h(w.branch)}`, 3, 2, `
      <div class="card pad">${addressFields(w, { name: w.repo.name })}
        <div class="divider"></div>
        <div class="toggle-row"><label class="switch"><input type="checkbox" id="wAuto" ${w.auto !== false ? "checked" : ""}><i></i></label><div><b>Deploy every push</b><span>Burrow looks for new commits on ${h(w.branch)} every few minutes (Settings) and deploys them.</span></div></div>
        <div class="toggle-row"><label class="switch"><input type="checkbox" id="wSpa" ${w.spa ? "checked" : ""}><i></i></label><div><b>Single-page app</b><span>Unknown paths get index.html, for React, Vue or Svelte routers.</span></div></div>
        <div class="modal-f"><button class="btn ghost" data-act="wiz-back">Back</button><button class="btn primary" data-act="wiz-git-create">${I.rocket}Deploy</button></div>
      </div>`);
    if (!w.sub) { $("#wSub").value = w.det?.sub || slug(w.repo.name); w.sub = $("#wSub").value; }
    wireAddress(w);
    return;
  }
  // step 3: deploying
  const j = S.jobs.get(w.job);
  main.innerHTML = wizShell(w.repo.full, "Deploying. You can leave this page: it carries on, and the site's page shows how it went.", 3, 3, `
    ${j ? jobBox(j) : ""}
    <a class="btn primary" href="#/site/${w.siteId}">Go to the site</a>`);
}
const detectBox = (d) => {
  if (d.kind === "static") return `<div class="detect"><div class="ic">${I.check}</div><div><b>A static site</b><div class="muted small">Its index.html is in ${d.dir ? `<span class="mono">${h(d.dir)}/</span>` : "the top folder"}: served as it is, no build.</div></div></div>`;
  if (d.kind === "build") return `<div class="detect"><div class="ic">${I.box}</div><div class="grow"><b>${h(d.build.name)}</b><div class="muted small">Built in a container with <span class="mono">${h(d.build.image)}</span>, then <span class="mono">${h(d.build.output)}/</span> is served.${d.notes?.length ? `<br>${d.notes.map(h).join("<br>")}` : ""}</div>
    ${d.prebuilt ? `<div class="seg" id="wMode" style="margin-top:10px"><button data-v="build" class="${S.wiz.mode === "build" ? "on" : ""}">Build it</button><button data-v="static" class="${S.wiz.mode === "static" ? "on" : ""}">Serve ${h(d.prebuilt)}/ as it is</button></div>` : ""}</div></div>
    ${S.state.docker?.ok ? "" : `<div class="notice err">${I.warn}<div>${h(S.state.docker?.error || "Docker isn't available")}: building needs it. Commit the built site instead, or install Docker.</div></div>`}`;
  return `<div class="notice warn">${I.warn}<div>No index.html${S.wiz.path ? ` in ${h(S.wiz.path)}/` : ""} and no build setup found${d.indexDirs?.length ? `. There is an index.html in: ${d.indexDirs.map((x) => `<button class="btn xs" data-act="use-dir" data-v="${h(x)}">${h(x || "/")}</button>`).join(" ")}` : ""}. You can still set a build command below.</div></div>
    <div class="row"><button class="btn sm" data-act="force-build">Set a build command</button></div>`;
};
const buildFields = (b) => `<div class="grid2" style="margin-top:6px">
    <label class="f"><span>Image</span><input class="inp mono" id="bImage" value="${h(b.image || "node:22-alpine")}" spellcheck="false"></label>
    <label class="f" style="margin-top:0"><span>Output folder</span><input class="inp mono" id="bOut" value="${h(b.output || "dist")}" spellcheck="false"></label></div>
  <label class="f"><span>Command</span><input class="inp mono" id="bCmd" value="${h(b.command || "npm ci && npm run build")}" spellcheck="false"></label>
  <label class="f"><span>Environment variables <span class="faint">NAME=value, one per line</span></span><textarea class="inp" id="bEnv" rows="3" style="min-height:70px" spellcheck="false">${h(Object.entries(b.env || {}).map(([k, v]) => `${k}=${v}`).join("\n"))}</textarea></label>
  <div class="help">The build runs your repository's code in a throwaway container with network access, memory and time limits. Build what you trust.</div>`;
const readBuild = () => {
  const env = {};
  for (const l of ($("#bEnv")?.value || "").split("\n")) { const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l); if (m) env[m[1]] = m[2]; else if (l.trim()) throw new Error(`"${l.trim()}" isn't NAME=value`); }
  return { image: $("#bImage").value.trim(), output: $("#bOut").value.trim(), command: $("#bCmd").value.trim(), env };
};
async function runDetect() {
  const w = S.wiz; w.det = null;
  const box = $("#wDetect"); if (box) box.innerHTML = `<div class="skel" style="height:74px;margin:14px 0"></div>`;
  try {
    const a = w.acct ? `account=${encodeURIComponent(w.acct)}&` : `provider=${w.repo.provider}&`;
    const d = await api(`/detect?${a}repo=${encodeURIComponent(w.repo.full)}&branch=${encodeURIComponent(w.branch)}&path=${encodeURIComponent(w.path || "")}`);
    w.det = d;
    if (d.kind === "build") { w.mode = "build"; w.build = { ...d.build }; } else { w.mode = "static"; }
    if (d.kind === "static" && d.dir && !w.path) w.path = d.dir;
    paintGitWizard();
  } catch (e) { if (box) box.innerHTML = `<div class="notice err">${I.warn}<div>${h(e.message)}</div></div>`; }
}
async function loadRepos(fresh) {
  const w = S.wiz;
  S.repos ||= {};
  try {
    if (fresh || !S.repos[w.acct]) S.repos[w.acct] = (await api(`/accounts/${encodeURIComponent(w.acct)}/repos${fresh ? "?fresh=1" : ""}`)).repos;
    paintRepos();
  } catch (e) { const el = $("#wRepos"); if (el) el.innerHTML = `<div class="notice err" style="margin:12px">${I.warn}<div>${h(e.message)}</div></div>`; }
}
function paintRepos() {
  const w = S.wiz, el = $("#wRepos"); if (!el) return;
  const q = w.q.trim().toLowerCase();
  const list = (S.repos[w.acct] || []).filter((r) => !q || r.full.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q));
  const typed = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+$/.test(w.q.trim()) && !list.some((r) => r.full.toLowerCase() === q);
  el.innerHTML = (typed ? `<div class="repo" data-repo-full="${h(w.q.trim())}"><div><b>${h(w.q.trim())}</b><div class="d">Use this repository</div></div>${I.chev}</div>` : "")
    + (list.length ? list.slice(0, 150).map((r) => `<div class="repo" data-repo-full="${h(r.full)}">
      <div style="min-width:0"><b>${h(r.full)}</b>${r.private ? ` <span class="chip">${I.lock}private</span>` : ""}${r.fork ? ` <span class="chip">fork</span>` : ""}${r.archived ? ` <span class="chip">archived</span>` : ""}
        ${r.description ? `<div class="d">${h(r.description)}</div>` : ""}
        <div class="m">${r.language ? `<span class="lang"><i style="background:${LANG[r.language] || "#888"}"></i>${h(r.language)}</span>` : ""}${r.commits != null ? `<span>${num(r.commits)} commits</span>` : ""}<span>updated ${ago(r.pushed)}</span>${r.pages ? "<span>has Pages</span>" : ""}${r.stars ? `<span>★ ${num(r.stars)}</span>` : ""}</div></div>
      <button class="btn sm">Pick</button></div>`).join("") : typed ? "" : `<div class="muted" style="padding:20px;text-align:center">${q ? "Nothing matches." : "No repositories here."}</div>`);
}
async function pickRepo(full) {
  const w = S.wiz;
  const a = w.acct ? `account=${encodeURIComponent(w.acct)}` : "provider=github";
  main.querySelector(".card").style.opacity = ".6";
  try {
    const r = await api(`/repo?${a}&repo=${encodeURIComponent(full)}`);
    Object.assign(w, { repo: r.repo, branches: r.branches, branch: r.suggested, path: "", det: null, step: 1, sub: "", subTouched: false, name: r.repo.name });
    paintGitWizard();
  } catch (e) { toast(e.message, "err"); main.querySelector(".card").style.opacity = ""; }
}

/* ---------------- uploads ---------------- */
const dropZone = () => `<div class="drop" tabindex="0">${I.upload}<b>Drop a folder, a .zip or a .tar.gz here</b><div class="muted small">or <button class="btn xs" data-act="pick-folder">choose a folder</button> <button class="btn xs" data-act="pick-archive">choose an archive</button></div>
  <input type="file" id="upFolder" webkitdirectory multiple hidden><input type="file" id="upArchive" accept=".zip,.tar,.tgz,.tar.gz,application/zip,application/gzip" hidden></div>`;
function wireDrop(el, siteId, wizard) {
  if (!el) return;
  el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = async (e) => {
    e.preventDefault(); el.classList.remove("over");
    const items = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (items.length === 1 && items[0].isFile && /\.(zip|tar|tgz|tar\.gz)$/i.test(items[0].name)) return sendArchive(siteId, e.dataTransfer.files[0], wizard);
    const files = [];
    const walk = (entry, path) => new Promise((ok) => {
      if (entry.isFile) entry.file((f) => { files.push({ file: f, path: path + f.name }); ok(); }, () => ok());
      else if (entry.isDirectory) {
        const reader = entry.createReader(), all = [];
        const more = () => reader.readEntries(async (ents) => { if (!ents.length) { for (const x of all) await walk(x, `${path}${entry.name}/`); ok(); } else { all.push(...ents); more(); } }, () => ok());
        more();
      } else ok();
    });
    for (const it of items) await walk(it, "");
    sendFiles(siteId, files, wizard);
  };
  $("#upFolder").onchange = (e) => sendFiles(siteId, [...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })), wizard);
  $("#upArchive").onchange = (e) => e.target.files[0] && sendArchive(siteId, e.target.files[0], wizard);
}
function put(url, body, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url); x.setRequestHeader("X-Pages", "1");
    x.upload.onprogress = (e) => onProgress?.(e.loaded);
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch { /* */ } x.status < 400 ? ok(j) : no(new Error(j?.error || `HTTP ${x.status}`)); };
    x.onerror = () => no(new Error("The upload was cut off."));
    x.send(body);
  });
}
function progressBox(label) {
  const box = $("#upProgress") || $("#siteUp");
  if (box) box.innerHTML = `<div class="job" style="margin-top:14px"><div class="job-h">${I.upload}<span>${h(label)}</span><span class="phase grow" id="upPct">0%</span></div><div class="bar det"><i id="upBar"></i></div></div>`;
  return (done, total) => { const p = total ? Math.min(100, Math.round((done / total) * 100)) : 0; const b = $("#upBar"); if (b) b.parentElement.style.setProperty("--p", `${p}%`); const t = $("#upPct"); if (t) t.textContent = `${p}% · ${bytes(done)} of ${bytes(total)}`; };
}
async function sendArchive(siteId, file, wizard) {
  if (file.size > 1024 * 1024 * 1024) return toast("That archive is over 1 GB.", "err");
  const prog = progressBox(`Uploading ${file.name}`);
  try {
    await put(`api/sites/${siteId}/upload/archive`, file, (n) => prog(n, file.size));
    prog(file.size, file.size);
    const r = await api(`/sites/${siteId}/upload/finish`, { method: "POST", body: { note: file.name } });
    afterUpload(siteId, r.job, wizard);
  } catch (e) { toast(e.message, "err"); }
}
async function sendFiles(siteId, list, wizard) {
  list = list.filter((x) => !/(^|\/)(\.DS_Store|Thumbs\.db|\.git\/)/.test(x.path));
  if (!list.length) return toast("That folder is empty.", "err");
  // a folder picked or dropped as a whole: its own name comes off the front
  const tops = new Set(list.map((x) => x.path.split("/")[0]));
  if (tops.size === 1 && list.every((x) => x.path.includes("/"))) list = list.map((x) => ({ ...x, path: x.path.split("/").slice(1).join("/") }));
  if (!list.some((x) => /(^|\/)index\.html?$/i.test(x.path))) { if (!(await confirmBox({ title: "No index.html", text: "This folder has no index.html, so its address would show nothing. Upload it anyway?", ok: "Upload anyway" }))) return; }
  const total = list.reduce((a, x) => a + x.file.size, 0);
  const prog = progressBox(`Uploading ${list.length} file${list.length === 1 ? "" : "s"}`);
  try {
    await api(`/sites/${siteId}/upload/start`, { method: "POST", body: {} });
    let done = 0, i = 0;
    const inflight = new Map();
    const show = () => prog(done + [...inflight.values()].reduce((a, n) => a + n, 0), total);
    const worker = async () => {
      while (i < list.length) {
        const k = i, x = list[i++];
        inflight.set(k, 0);
        await put(`api/sites/${siteId}/upload/file?path=${encodeURIComponent(x.path)}`, x.file, (n) => { inflight.set(k, n); show(); });
        inflight.delete(k); done += x.file.size; show();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const r = await api(`/sites/${siteId}/upload/finish`, { method: "POST", body: { note: `${list.length} files` } });
    afterUpload(siteId, r.job, wizard);
  } catch (e) { toast(e.message, "err"); }
}
function afterUpload(siteId, jobId, wizard) {
  const j = S.jobs.get(jobId) || { id: jobId, label: "Deploy", state: "running", phase: "Publishing", log: [] };
  S.jobs.set(jobId, j);
  const box = $("#upProgress") || $("#siteUp");
  if (box) box.innerHTML = jobBox(j, { extra: `<div class="job-done hidden" style="margin-top:12px"><a class="btn primary" href="#/site/${siteId}">Open the site</a></div>` });
  if (wizard) setTimeout(() => { if (S.jobs.get(jobId)?.state === "done") location.hash = `#/site/${siteId}`; }, 1500);
}

/* ================================================================ one site */
async function renderSite(r) {
  if (!S.sites[r.id] || S.sites[r.id]._at < Date.now() - 2000) {
    if (!S.sites[r.id]) main.innerHTML = `<div class="skel" style="height:80px;margin-bottom:20px"></div><div class="skel" style="height:300px"></div>`;
    S.sites[r.id] = { ...(await api(`/sites/${r.id}`)), _at: Date.now() };
  }
  const s = S.sites[r.id];
  const tab = r.tab || "overview";
  main.innerHTML = `<div class="crumbs"><a href="#/">Sites</a>${I.chev}<span>${h(s.name)}</span></div>
    <div id="siteHead"></div>
    <nav class="tabs">${[["overview", "Overview"], ...(s.type === "proxy" ? [] : [["deploys", "Deploys"]]), ["analytics", "Analytics"], ...(s.type === "proxy" ? [] : [["files", "Files"]]), ["settings", "Settings"]]
      .map(([k, t]) => `<a href="#/site/${s.id}/${k}" class="${tab === k ? "on" : ""}">${t}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  paintSiteHead(); paintTab();
}
function paintSiteHead() {
  const r = route(), s = S.sites[r.id], el = $("#siteHead"); if (!s || !el) return;
  const live = S.state.sites[s.id];
  if (live) Object.assign(s, { busy: live.busy, health: live.health, last: live.last, paused: live.paused, enabled: live.enabled, url: live.url || s.url, host: live.host || s.host });
  el.innerHTML = `<div class="site-h">${mark(s.name)}<div class="grow"><h1>${h(s.name)} ${status(s)}</h1>
      <div class="url">${s.url ? `<a href="${h(s.url)}" target="_blank" rel="noopener">${h(s.host)}</a><button class="copy" data-copy="${h(s.url)}" title="Copy">${I.copy}</button>` : `<span class="faint">no address</span>`}${accessChip(s.access)}</div></div>
    <div class="row wrap">
      ${s.type === "git" ? `<button class="btn" data-act="deploy">${I.rocket}Deploy</button>` : s.type === "upload" ? `<button class="btn" data-act="upload">${I.upload}Upload</button>` : `<button class="btn" data-act="purge">${I.sync}Empty the cache</button>`}
      ${s.paused ? `<button class="btn" data-act="resume">${I.play}Resume</button>` : `<button class="btn ghost" data-act="pause" title="Stop answering">${I.pause}Pause</button>`}
      ${s.url ? `<a class="btn primary" href="${h(s.url)}" target="_blank" rel="noopener">${I.ext}Visit</a>` : ""}
    </div></div>
    ${s.paused ? `<div class="notice warn">${I.pause}<div class="grow">Paused: its address doesn't answer. Nothing is deleted.</div><button class="btn sm" data-act="resume">Resume</button></div>` : ""}
    ${s.maintenance?.on ? `<div class="notice warn">${I.wrench}<div class="grow">Maintenance mode is on: visitors get a "back soon" page.</div><button class="btn sm" data-act="maint-off">Turn it off</button></div>` : ""}
    ${s.source?.pausedByRollback && s.source.autoDeploy === false ? `<div class="notice">${I.undo}<div class="grow">You rolled back, so new pushes aren't deployed until you say.</div><button class="btn sm" data-act="auto-on">Deploy pushes again</button></div>` : ""}
    ${!s.tunnel ? `<div class="notice err">${I.warn}<div class="grow">Its tunnel is gone (removed in Burrow?), so it has no address. Remove this site, or make it again.</div></div>` : ""}
    <div id="siteUp"></div>`;
}
function paintTab() {
  const r = route(), s = S.sites[r.id], el = $("#tab"); if (!s || !el) return;
  const tab = r.tab || "overview";
  if (tab === "overview") return tabOverview(s, el);
  if (tab === "deploys") return tabDeploys(s, el);
  if (tab === "analytics") return tabAnalytics(s, el);
  if (tab === "files") return tabFiles(s, el, r);
  if (tab === "settings") return tabSettings(s, el);
}

function tabOverview(s, el) {
  const c = (s.deploys || []).find((d) => d.id === s.current?.id || d.id === s.current);
  const running = [...S.jobs.values()].filter((j) => j.site === s.id && (j.state === "running" || j.state === "queued"));
  const checks = s.health?.checks || [];
  const up = checks.length ? Math.round((checks.filter(Boolean).length / checks.length) * 1000) / 10 : null;
  const today = S.state.sites[s.id]?.today || {};
  el.innerHTML = `${running.map((j) => jobBox(j)).join("")}<div class="cols"><div class="stack">
    ${s.type !== "proxy" ? `<div class="card pad"><div class="row" style="margin-bottom:14px"><h3 class="grow">Live deploy</h3>${c ? `<a class="btn sm ghost" href="#/site/${s.id}/deploys">All deploys</a>` : ""}</div>
      ${c ? `<dl class="kv">
        ${c.commit?.sha ? `<dt>Commit</dt><dd>${c.commit.url ? `<a class="mono" href="${h(c.commit.url)}" target="_blank" rel="noopener">${h(c.commit.sha.slice(0, 7))}</a>` : `<span class="mono">${h(c.commit.sha.slice(0, 7))}</span>`} ${h(c.commit.message || "")}</dd>` : `<dt>From</dt><dd>${h(c.note || "an upload")}</dd>`}
        ${c.commit?.author ? `<dt>By</dt><dd>${h(c.commit.author)}</dd>` : ""}
        <dt>Deployed</dt><dd>${when(c.at)} <span class="faint">(${ago(c.at)}${c.seconds != null ? `, took ${secs(c.seconds)}` : ""})</span></dd>
        <dt>Files</dt><dd>${num(c.files)} · ${bytes(c.bytes)}${c.hasIndex === false ? ` <span class="warnc">· no index.html</span>` : ""}</dd>
        ${c.rules?.redirects || c.rules?.headers ? `<dt>Rules</dt><dd>${[c.rules.redirects && "_redirects", c.rules.headers && "_headers"].filter(Boolean).join(", ")}</dd>` : ""}
      </dl>` : `<p class="muted" style="margin:0">${s.type === "upload" ? `Nothing yet. <button class="btn sm" data-act="upload">${I.upload}Upload files</button>` : "Nothing deployed yet."}</p>`}</div>` : ""}
    ${s.type === "git" ? `<div class="card pad"><h3>Source</h3><dl class="kv" style="margin-top:12px">
        <dt>Repository</dt><dd>${I[s.source.provider]} <a href="https://${s.source.provider}.com/${h(s.source.repo)}" target="_blank" rel="noopener">${h(s.source.repo)}</a>${s.source.private ? ` <span class="chip">${I.lock}private</span>` : ""}</dd>
        <dt>Branch</dt><dd class="mono">${h(s.source.branch)}${s.source.path ? ` · ${h(s.source.path)}/` : ""}</dd>
        <dt>Build</dt><dd>${s.source.mode === "build" ? `<span class="mono">${h(s.source.build?.command || "")}</span> → <span class="mono">${h(s.source.build?.output || "")}/</span>` : "None: served as it is"}</dd>
        <dt>Pushes</dt><dd>${s.source.autoDeploy !== false ? `Deployed as they come${s.sync?.checked ? ` <span class="faint">· checked ${ago(s.sync.checked)}</span>` : ""}` : "Deployed when you press Deploy"}${s.sync?.error ? `<div class="bad small">${h(s.sync.error)}</div>` : ""}${s.sync?.pending && s.sync.pending !== s.current?.sha ? `<div class="warnc small">New commit ${h(s.sync.pending.slice(0, 7))} waiting</div>` : ""}</dd>
      </dl><div class="row" style="margin-top:14px"><button class="btn sm" data-act="sync">${I.sync}Look for new commits</button></div></div>` : ""}
    ${s.type === "proxy" ? `<div class="card pad"><h3>Original</h3><dl class="kv" style="margin-top:12px">
        <dt>Address</dt><dd><a class="mono" href="${h(s.proxy.upstream)}" target="_blank" rel="noopener">${h(s.proxy.upstream)}</a></dd>
        <dt>Cache</dt><dd>${s.proxy.cacheSeconds ? `${({ 30: "30 seconds", 60: "A minute", 300: "5 minutes", 3600: "An hour", 86400: "A day" })[s.proxy.cacheSeconds] || secs(s.proxy.cacheSeconds)}, and the last copy for a day if the original breaks` : "Off: every request goes to the original"}</dd>
        <dt>Links</dt><dd>${s.proxy.rewriteLinks ? "Rewritten to your address" : "As they are"}</dd></dl></div>` : ""}
  </div><div class="stack">
    <div class="card pad"><div class="row"><h3 class="grow">Health</h3><button class="btn xs" data-act="check">Check now</button></div>
      <div class="uptime" title="The last ${Math.min(60, checks.length)} checks, newest on the right">${[...Array.from({ length: Math.max(0, 60 - checks.length) }, () => null), ...checks.slice(-60)].map((x) => `<i class="${x === null ? "na" : x ? "" : "no"}"></i>`).join("")}</div>
      <div class="row small"><span class="grow muted">${s.health ? `${s.health.ok ? "Answering" : `Not answering: ${h(s.health.error || `HTTP ${s.health.status}`)}`}${s.health.ms ? ` · ${s.health.ms} ms` : ""}` : "Not checked yet"}</span><span class="faint">${up != null ? `${up}% up` : ""}</span></div>
      ${s.health?.since ? `<div class="faint tiny" style="margin-top:4px">${s.health.ok ? "Up" : "Down"} since ${when(s.health.since)}</div>` : ""}</div>
    <div class="card pad"><div class="row"><h3 class="grow">Today</h3><a class="btn xs ghost" href="#/site/${s.id}/analytics">Analytics</a></div>
      <div class="grid2" style="margin-top:12px;gap:10px"><div><b style="font-size:20px">${num(today.v)}</b><div class="faint small">visitors</div></div><div><b style="font-size:20px">${num(today.p)}</b><div class="faint small">page views</div></div>
        <div><b style="font-size:20px">${num(today.r)}</b><div class="faint small">requests</div></div><div><b style="font-size:20px">${bytes(today.b)}</b><div class="faint small">served</div></div></div>
      <div style="margin-top:12px">${spark(S.state.sites[s.id]?.spark || [])}<div class="faint tiny">Requests, last 24 hours</div></div></div>
    <div class="card pad"><h3>Recent</h3><div id="siteAct" class="small" style="margin-top:10px"><div class="skel" style="height:60px"></div></div></div>
  </div></div>`;
  api(`/activity?site=${s.id}&limit=8`).then((r) => { const a = $("#siteAct"); if (a) a.innerHTML = r.items.length ? r.items.map((e) => `<div class="row" style="padding:5px 0;align-items:flex-start"><span class="grow">${h(e.text)}</span><span class="faint tiny" style="white-space:nowrap">${ago(e.t)}</span></div>`).join("") : `<span class="faint">Nothing yet.</span>`; }).catch(() => {});
}

function tabDeploys(s, el) {
  const running = [...S.jobs.values()].filter((j) => j.site === s.id && (j.state === "running" || j.state === "queued"));
  const list = s.deploys || [];
  el.innerHTML = `${running.map((j) => jobBox(j)).join("")}
    <div class="card">${list.length ? `<div class="list">${list.map((d) => {
      const cur = d.id === (s.current?.id || s.current);
      return `<div class="dep"><span class="dot ${cur ? "current" : d.state}"></span>
        <div style="min-width:0"><div class="msg">${h(d.commit?.message || d.note || (d.state === "failed" ? "Failed deploy" : "Deploy"))}${cur ? ` <span class="badge live" style="margin-left:6px"><i></i>Live</span>` : ""}${d.state === "pruned" ? ` <span class="chip">files removed</span>` : ""}</div>
          <div class="meta">${d.commit?.sha ? `<span class="mono">${h(d.commit.sha.slice(0, 7))}</span>` : ""}${d.branch ? `<span>${h(d.branch)}</span>` : ""}<span>${h(d.trigger || "")}</span><span title="${h(when(d.at))}">${ago(d.at)}</span>${d.seconds != null ? `<span>${secs(d.seconds)}</span>` : ""}${d.files ? `<span>${num(d.files)} files · ${bytes(d.bytes)}</span>` : ""}</div>
          ${d.error ? `<div class="bad small" style="margin-top:3px">${h(d.error)}</div>` : ""}</div>
        <div class="acts">
          <button class="btn xs" data-act="log" data-d="${d.id}">Log</button>
          ${d.state === "ready" && !cur ? `<button class="btn xs" data-act="rollback" data-d="${d.id}">${I.undo}Make live</button>` : ""}
          ${d.state === "ready" ? `<a class="btn xs icon" href="api/sites/${s.id}/download?deploy=${d.id}" title="Download">${I.download}</a>` : ""}
          ${!cur && d.state !== "building" ? `<button class="btn xs icon ghost" data-act="drop-deploy" data-d="${d.id}" title="Delete">${I.trash}</button>` : ""}
        </div></div>`; }).join("")}</div>`
      : `<div class="empty"><p class="muted">No deploys yet.</p></div>`}</div>
    <p class="faint small" style="margin-top:12px">The last ${S.state.settings.keep} deploys keep their files, so any of them can be made live again in a moment (Settings → Deploys kept).</p>`;
}

async function tabAnalytics(s, el) {
  const days = S.statDays || 7;
  el.innerHTML = `<div class="row wrap an-head" style="margin-bottom:14px"><span class="muted small grow">No cookies and no scripts in your pages: counted where the files are served. Visitors are a daily-salted hash, never an address.</span>
    <div class="seg range" id="range">${[[1, "24 h"], [7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, t]) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${t}</button>`).join("")}</div></div>
    <div id="an"><div class="skel" style="height:300px"></div></div>`;
  $("#range").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { S.statDays = Number(b.dataset.d); tabAnalytics(s, el); } };
  let v;
  try { v = await api(`/sites/${s.id}/stats?days=${days}`); } catch (e) { $("#an").innerHTML = `<div class="notice err">${I.warn}${h(e.message)}</div>`; return; }
  const delta = (cur, prev) => { if (!v.previous || !prev) return ""; const d = Math.round(((cur - prev) / prev) * 100); return d ? `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%</span>` : ""; };
  const T = v.totals, P = v.previous || {};
  const table = (title, rows, fmt = (x) => h(x)) => { const max = Math.max(1, ...rows.map((x) => x.n)); return `<div class="card top-t"><h4>${title}<span>${rows.length ? "" : "none yet"}</span></h4>${rows.map((x) => `<div class="trow" style="--w:${Math.round((x.n / max) * 100)}%"><span class="ell">${fmt(x.name)}</span><span class="n">${num(x.n)}</span></div>`).join("")}</div>`; };
  $("#an").innerHTML = `
    <div class="kpis">
      <div class="card stat"><b>${num(T.visitors)}</b><span>visitors${delta(T.visitors, P.v)}</span></div>
      <div class="card stat"><b>${num(T.pageviews)}</b><span>page views${delta(T.pageviews, P.p)}</span></div>
      <div class="card stat"><b>${num(T.requests)}</b><span>requests${delta(T.requests, P.r)}</span></div>
      <div class="card stat"><b>${bytes(T.bytes)}</b><span>served${delta(T.bytes, P.b)}</span></div>
      <div class="card stat"><b class="${T.serverErrors ? "bad" : ""}">${num(T.errors)}</b><span>errors${T.serverErrors ? ` · ${num(T.serverErrors)} server` : ""}</span></div>
    </div>
    <div class="card pad"><div class="row" style="margin-bottom:8px"><h3 class="grow">Traffic</h3><div class="legend"><span><i style="background:var(--green-2)"></i>Page views</span><span><i style="background:rgba(61,220,151,.28)"></i>Other requests</span></div></div>${chart(v.series, days)}</div>
    <div class="tops">
      ${table("Top pages", v.pages, (x) => `<span class="mono">${h(x)}</span>`)}
      ${table("Referrers", v.referrers)}
      ${table("Browsers", v.browsers)}
      ${table("Systems", v.os)}
      ${table("Devices", v.devices)}
      ${table("Status codes", v.codes, (x) => `<span class="code c${String(x)[0]}">${h(x)}</span>`)}
      ${v.missing.length ? table("Not found (404)", v.missing, (x) => `<span class="mono">${h(x)}</span>`) : ""}
    </div>
    <div class="section-h"><h2 class="grow">Recent requests</h2><span class="faint small">${v.allTime?.r ? `${num(v.allTime.r)} requests since ${new Date(v.since).toLocaleDateString()}` : ""}</span></div>
    <div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>When</th><th>Path</th><th>Status</th><th class="num">Size</th><th class="num">Time</th><th>Visitor</th></tr></thead><tbody>
      ${v.recent.map((x) => `<tr><td class="faint" style="white-space:nowrap">${new Date(x.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td class="mono ell" style="max-width:340px">${h(x.p)}</td><td><span class="code c${String(x.s)[0]}">${x.s}</span></td><td class="num">${bytes(x.b)}</td><td class="num">${x.ms} ms</td><td class="faint">${h(x.ua)}${x.bot ? " · bot" : ""} · <span class="mono">${h(x.ip)}</span></td></tr>`).join("") || `<tr><td colspan="6" class="faint" style="text-align:center;padding:24px">No requests yet.</td></tr>`}
    </tbody></table></div>`;
}
function chart(series, days) {
  const W = 1000, H = 220, pad = { l: 40, r: 8, t: 10, b: 24 };
  const max = Math.max(4, ...series.map((x) => x.r || 0));
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const bw = (W - pad.l - pad.r) / series.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  let g = `<g class="grid">`;
  for (let v = 0; v <= top; v += step) g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 3}" text-anchor="end">${num(v)}</text>`;
  g += `</g>`;
  const label = (t) => (days <= 1 ? new Date(t).toLocaleTimeString([], { hour: "numeric" }) : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const every = Math.ceil(series.length / 8);
  const bars = series.map((x, i) => {
    const r = x.r || 0, p = Math.min(r, x.p || 0), X = pad.l + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
    return `<g class="col"><title>${label(x.t)}: ${p} page views, ${r} requests, ${x.v || 0} visitors</title>
      <rect class="b2" x="${X}" y="${y(r)}" width="${w}" height="${Math.max(0, y(0) - y(r))}" rx="2"/><rect class="b1" x="${X}" y="${y(p)}" width="${w}" height="${Math.max(0, y(0) - y(p))}" rx="2"/>
      <rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}"/>
      ${i % every === 0 ? `<text x="${X + w / 2}" y="${H - 6}" text-anchor="middle">${label(x.t)}</text>` : ""}</g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${bars}</svg>`;
}
function niceStep(max) { const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

async function tabFiles(s, el, r) {
  const path = decodeURIComponent(r.extra || "");
  if (!s.current) { el.innerHTML = `<div class="card empty"><p class="muted">No deploy yet.</p></div>`; return; }
  el.innerHTML = `<div class="skel" style="height:200px"></div>`;
  let v;
  try { v = await api(`/sites/${s.id}/files?path=${encodeURIComponent(path)}`); } catch (e) { el.innerHTML = `<div class="notice err">${I.warn}${h(e.message)}</div>`; return; }
  const parts = path ? path.split("/") : [];
  const enc = (p) => encodeURIComponent(p);
  el.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="path grow"><a href="#/site/${s.id}/files">${h(s.host || s.name)}</a>${parts.map((p, i) => `<span class="faint">/</span><a href="#/site/${s.id}/files/${enc(parts.slice(0, i + 1).join("/"))}">${h(p)}</a>`).join("")}</div>
      <a class="btn sm" href="api/sites/${s.id}/download">${I.download}Download all</a></div>
    <div class="card files">${v.entries.length ? `<div class="list">${v.entries.map((e) => {
      const p = path ? `${path}/${e.name}` : e.name;
      return e.dir ? `<div class="fr d">${I.folder}<a class="n" href="#/site/${s.id}/files/${enc(p)}">${h(e.name)}/</a><span class="faint small when">${num(e.files)} files</span><span class="faint small">${bytes(e.size)}</span></div>`
                   : `<div class="fr">${I.doc}${s.url ? `<a class="n" href="${h(s.url)}/${p.split("/").map(encodeURIComponent).join("/")}" target="_blank" rel="noopener">${h(e.name)}</a>` : `<span>${h(e.name)}</span>`}<span class="faint small when"></span><span class="faint small">${bytes(e.size)}</span></div>`;
    }).join("")}</div>` : `<div class="empty"><p class="muted">Empty folder.</p></div>`}</div>`;
}

/* ---------------- settings of a site ---------------- */
function tabSettings(s, el) {
  const sv = s.serving, mt = s.maintenance || {};
  const suffix = zoneSuffix();
  el.innerHTML = `<div class="card" id="setForm">
    <div class="set"><div><h3>Name and address</h3><p class="d">Changing the address moves the site at once; the old one stops answering.</p></div><div>
      <div class="grid2"><label class="f"><span>Name</span><input class="inp" data-k="name" value="${h(s.name)}" maxlength="60"></label>
      <div class="f" style="margin-top:0"><span class="lbl">Address</span><div class="inp-group"><input class="inp mono" data-k="sub" value="${h(s.sub || "")}" maxlength="63" spellcheck="false">${suffix ? `<span class="add">.${h(suffix)}</span>` : ""}</div><div class="help" id="subHelp"></div></div></div></div></div>
    <div class="set"><div><h3>Who can open it</h3><p class="d">Public sites are still behind your gate's shield: new visitors are checked before they get in.</p></div><div>
      <div class="seg full" id="accSeg">${[["login", I.lock, "Your login"], ["password", I.key, "A password"], ["public", I.globe, "Everyone"]].map(([v, ic, t]) => `<button type="button" data-v="${v}" class="${s.access === v ? "on" : ""}">${ic}${t}</button>`).join("")}</div>
      <div id="pwRow" class="${s.access === "password" ? "" : "hidden"}" style="margin-top:12px"><input class="inp" type="password" data-k="password" autocomplete="new-password" placeholder="${s.tunnelInfo?.locked ? "A new password (leave empty to keep the current one)" : "The site's password"}"></div></div></div>
    ${s.type === "git" ? `<div class="set"><div><h3>Source</h3><p class="d">${I[s.source.provider]} ${h(s.source.repo)}. A change here deploys again.</p></div><div>
      <div class="grid2"><label class="f"><span>Branch</span><input class="inp mono" data-k="source.branch" value="${h(s.source.branch)}" spellcheck="false"></label>
        <label class="f" style="margin-top:0"><span>Folder</span><input class="inp mono" data-k="source.path" value="${h(s.source.path || "")}" placeholder="the top of the repository" spellcheck="false"></label></div>
      <div class="toggle-row" style="margin-top:8px"><label class="switch"><input type="checkbox" data-k="source.autoDeploy" ${s.source.autoDeploy !== false ? "checked" : ""}><i></i></label><div><b>Deploy every push</b><span>Otherwise new commits wait for the Deploy button.</span></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="source.mode" ${s.source.mode === "build" ? "checked" : ""}><i></i></label><div class="grow"><b>Build it first</b><span>Run a command in a container and serve its output folder.</span>
        <div id="bWrap" class="${s.source.mode === "build" ? "" : "hidden"}">${buildFields(s.source.build || {})}</div></div></div>
      <label class="f"><span>Look for new commits</span><select class="inp" data-k="source.syncEvery" style="max-width:280px">${[["", `As in Settings (${S.state.settings.syncEvery ? `every ${S.state.settings.syncEvery} min` : "off"})`], ["1", "Every minute"], ["5", "Every 5 minutes"], ["15", "Every 15 minutes"], ["60", "Every hour"], ["0", "Never by itself"]].map(([v, t]) => `<option value="${v}" ${String(s.source.syncEvery ?? "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${s.source.mode === "build" ? `<div class="row" style="margin-top:14px"><button class="btn sm" data-act="deploy-clean">${I.sync}Deploy with a clean build cache</button></div>` : ""}
    </div></div>` : ""}
    ${s.type === "proxy" ? `<div class="set"><div><h3>The original</h3><p class="d">Where this site really is.</p></div><div>
      <label class="f"><span>Address</span><input class="inp mono" data-k="proxy.upstream" value="${h(s.proxy.upstream)}" spellcheck="false"></label>
      <div class="grid2"><label class="f"><span>Cache pages for</span><select class="inp" data-k="proxy.cacheSeconds">${[[0, "Off"], [30, "30 seconds"], [60, "A minute"], [300, "5 minutes"], [3600, "An hour"], [86400, "A day"]].map(([v, t]) => `<option value="${v}" ${Number(s.proxy.cacheSeconds) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="f" style="margin-top:0"><span>Give up after</span><select class="inp" data-k="proxy.timeout">${[10, 30, 60, 120].map((v) => `<option value="${v}" ${Number(s.proxy.timeout) === v ? "selected" : ""}>${v} seconds</option>`).join("")}</select></label></div>
      <div class="toggle-row" style="margin-top:8px"><label class="switch"><input type="checkbox" data-k="proxy.rewriteLinks" ${s.proxy.rewriteLinks ? "checked" : ""}><i></i></label><div><b>Rewrite links to the original</b><span>In HTML, CSS and JavaScript.</span></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="proxy.forwardIp" ${s.proxy.forwardIp ? "checked" : ""}><i></i></label><div><b>Tell the original who's visiting</b><span>Sends the visitor's address on (X-Forwarded-For). Off keeps it private.</span></div></div>
    </div></div>` : ""}
    <div class="set"><div><h3>Serving</h3><p class="d">How requests turn into files.</p></div><div>
      ${s.type !== "proxy" ? `
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="serving.spa" ${sv.spa ? "checked" : ""}><i></i></label><div><b>Single-page app</b><span>Unknown paths without a file extension get /index.html.</span></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="serving.cleanUrls" ${sv.cleanUrls !== false ? "checked" : ""}><i></i></label><div><b>Clean URLs</b><span>/about serves about.html.</span></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="serving.trailingSlash" ${sv.trailingSlash !== false ? "checked" : ""}><i></i></label><div><b>Folders end in /</b><span>/docs redirects to /docs/ (so relative links inside work).</span></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="serving.compress" ${sv.compress !== false ? "checked" : ""}><i></i></label><div><b>Compress</b><span>Brotli or gzip for text, scripts and styles.</span></div></div>` : ""}
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="serving.noindex" ${sv.noindex ? "checked" : ""}><i></i></label><div><b>Keep it out of search engines</b><span>Adds X-Robots-Tag: noindex.</span></div></div>
      ${s.type !== "proxy" ? `<div class="grid3" style="margin-top:12px">
        <label class="f"><span>Not-found page</span><input class="inp mono" data-k="serving.notFound" value="${h(sv.notFound || "")}" placeholder="/404.html"></label>
        <label class="f" style="margin-top:0"><span>In other sites' frames</span><select class="inp" data-k="serving.frame">${[["sameorigin", "Only its own"], ["deny", "Never"], ["allow", "Anywhere"]].map(([v, t]) => `<option value="${v}" ${sv.frame === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="f" style="margin-top:0"><span>Browser cache</span><select class="inp" data-k="serving.maxAge">${[[0, "Always check"], [300, "5 minutes"], [3600, "An hour"], [86400, "A day"], [604800, "A week"]].map(([v, t]) => `<option value="${v}" ${Number(sv.maxAge) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <div class="help">HTML is always checked; build files with a hash in their name are kept for a year.</div>
      <label class="f"><span>Content-Security-Policy <span class="faint">(optional)</span></span><input class="inp mono" data-k="serving.csp" value="${h(sv.csp || "")}" placeholder="default-src 'self'" spellcheck="false"></label>` : ""}
    </div></div>
    ${s.type !== "proxy" ? `<div class="set"><div><h3>Redirects</h3><p class="d">One per line: <span class="mono">from to [status]</span>. Before the site's own _redirects file.</p></div><div>
      <textarea class="inp" data-k="serving.redirects" rows="6" spellcheck="false" placeholder="/old-page    /new-page    301&#10;/blog/*     /posts/:splat 302&#10;/app/*      /app/index.html 200">${h(sv.redirects || "")}</textarea>
      <div class="help" id="rdHelp">${s.rules?.errors?.filter((e) => e.startsWith("Redirects")).map(h).join("<br>") || "200 serves another file at the same address; ! applies even when the file exists."}</div></div></div>
    <div class="set"><div><h3>Headers</h3><p class="d">A path, then its headers indented under it. After the site's own _headers file.</p></div><div>
      <textarea class="inp" data-k="serving.headers" rows="6" spellcheck="false" placeholder="/*&#10;  Permissions-Policy: camera=()&#10;/assets/*&#10;  Cache-Control: public, max-age=31536000, immutable">${h(sv.headers || "")}</textarea>
      <div class="help" id="hdHelp">${s.rules?.errors?.filter((e) => e.startsWith("Headers")).map(h).join("<br>") || ""}</div></div></div>` : ""}
    <div class="set"><div><h3>Maintenance</h3><p class="d">Visitors get a calm "back soon" page (503) while it's on. You can still open the site's files here.</p></div><div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" data-k="maintenance.on" ${mt.on ? "checked" : ""}><i></i></label><div><b>Maintenance mode</b></div></div>
      <div class="grid2"><label class="f"><span>Title</span><input class="inp" data-k="maintenance.title" value="${h(mt.title || "")}" placeholder="Back soon"></label>
        <label class="f" style="margin-top:0"><span>Message</span><input class="inp" data-k="maintenance.message" value="${h(mt.message || "")}" placeholder="This site is being worked on."></label></div></div></div>
  </div>
  <div id="saveBar"></div>
  <div class="card danger-zone" style="margin-top:22px"><div class="set"><div><h3 class="bad">Remove the site</h3><p class="d">Its address stops answering, and its deploys, files and numbers are deleted. The repository isn't touched.</p></div>
    <div class="row" style="align-items:flex-start"><button class="btn danger" data-act="remove">${I.trash}Remove ${h(s.name)}</button></div></div></div>`;
  S.dirty = { site: s.id, patch: {} };
  const form = $("#setForm");
  const markDirty = () => {
    const n = Object.keys(S.dirty.patch).length;
    $("#saveBar").innerHTML = n ? `<div class="save-bar"><span class="grow">Unsaved changes</span><button class="btn ghost sm" data-act="set-reset">Discard</button><button class="btn primary sm" data-act="set-save">Save</button></div>` : "";
  };
  form.addEventListener("input", (e) => {
    const k = e.target.dataset.k; if (!k) return;
    S.dirty.patch[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "source.mode") $("#bWrap")?.classList.toggle("hidden", !e.target.checked);
    if (k === "sub") { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""); S.dirty.patch.sub = e.target.value; checkSubLater(e.target.value, s.sub); }
    if (k === "serving.redirects" || k === "serving.headers") checkRulesLater();
    markDirty();
  });
  for (const id of ["bImage", "bOut", "bCmd", "bEnv"]) { const x = $(`#${id}`); if (x) x.addEventListener("input", () => { S.dirty.patch["source.build"] = true; markDirty(); }); }
  $("#accSeg").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    $$("#accSeg button").forEach((x) => x.classList.toggle("on", x === b));
    $("#pwRow").classList.toggle("hidden", b.dataset.v !== "password");
    S.dirty.patch.access = b.dataset.v; if (b.dataset.v === s.access) delete S.dirty.patch.access;
    markDirty();
  };
}
let subCheckT = null, ruleT = null;
function checkSubLater(v, cur) {
  clearTimeout(subCheckT);
  const help = $("#subHelp");
  if (v === cur) { help.textContent = ""; return; }
  subCheckT = setTimeout(async () => { const r = await api(`/check-sub?sub=${encodeURIComponent(v)}`).catch((e) => ({ ok: false, error: e.message })); help.className = `help ${r.ok ? "okc" : "err"}`; help.textContent = r.ok ? `✓ ${r.host || v} is free` : r.error; }, 300);
}
function checkRulesLater() {
  clearTimeout(ruleT);
  ruleT = setTimeout(async () => {
    const r = await api("/rules/check", { method: "POST", body: { redirects: $('[data-k="serving.redirects"]')?.value || "", headers: $('[data-k="serving.headers"]')?.value || "" } }).catch(() => null);
    if (!r) return;
    const rd = r.errors.filter((e) => e.startsWith("Redirects")), hd = r.errors.filter((e) => e.startsWith("Headers"));
    const a = $("#rdHelp"), b = $("#hdHelp");
    if (a) { a.className = `help ${rd.length ? "err" : "okc"}`; a.innerHTML = rd.length ? rd.map(h).join("<br>") : `✓ ${r.redirects.length} rule${r.redirects.length === 1 ? "" : "s"}`; }
    if (b) { b.className = `help ${hd.length ? "err" : "okc"}`; b.innerHTML = hd.length ? hd.map(h).join("<br>") : `✓ ${r.headers.length} path${r.headers.length === 1 ? "" : "s"}`; }
  }, 400);
}
async function saveSettings(btn) {
  const s = S.sites[S.dirty.site], p = S.dirty.patch, body = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "source.build") continue;
    const [a, b] = k.split(".");
    if (!b) { body[a] = v; continue; }
    body[a] ||= {};
    if (a === "source" && b === "mode") body.source.mode = v ? "build" : "static";
    else if (["maxAge", "cacheSeconds", "timeout"].includes(b)) body[a][b] = Number(v);
    else if (b === "syncEvery") body[a][b] = v === "" ? null : Number(v);
    else body[a][b] = v;
  }
  if (s.type === "git" && (p["source.build"] || body.source?.mode === "build")) {
    try { body.source ||= {}; body.source.build = readBuild(); } catch (e) { return toast(e.message, "err"); }
  }
  if (body.maintenance) body.maintenance = { on: $('[data-k="maintenance.on"]').checked, title: $('[data-k="maintenance.title"]').value, message: $('[data-k="maintenance.message"]').value };
  if (body.access === "password" && !body.password && !s.tunnelInfo?.locked) return toast("Set the site's password.", "err");
  if ("password" in body && !body.password) delete body.password;
  if (body.password && !body.access) body.access = "password";
  await busy(btn, async () => {
    try {
      const r = await api(`/sites/${s.id}`, { method: "PATCH", body });
      S.sites[s.id] = { ...r.site, _at: Date.now() };
      S.dirty = null;
      toast(r.job ? "Saved. Deploying with the new settings…" : "Saved");
      await loadState(); paintSiteHead(); paintTab();
    } catch (e) { toast(e.message, "err"); }
  });
}

/* ================================================================ accounts */
function renderAccounts() {
  const list = S.state.accounts;
  main.innerHTML = `<div class="page-h"><div class="grow"><h1>Accounts</h1><p>GitHub and GitLab accounts Burrow reads repositories from. Sign-ins are sealed on this machine and never shown again.</p></div>
      <button class="btn primary" data-act="acct-add">${I.plus}Add an account</button></div>
    <div class="card">${list.length ? `<div class="list">${list.map((a) => `<div class="act" style="grid-template-columns:38px 1fr auto">${avatar(a, "lg")}
      <div style="min-width:0"><div class="row" style="gap:7px">${I[a.provider]}<b>${h(a.username)}</b>${a.name ? `<span class="muted ell">${h(a.name)}</span>` : ""}${a.kind !== "user" ? `<span class="chip">${h(a.kind)}</span>` : ""}</div>
        <div class="faint small">${a.signedIn ? `<span class="ok">Signed in</span> (${h(a.via || "token")})${a.scopes ? ` · ${h(a.scopes)}` : ""}` : "Public repositories only"} · ${a.sites} site${a.sites === 1 ? "" : "s"} · added ${ago(a.added)}</div></div>
      <div class="row">${a.provider === "github" && !a.signedIn && S.state.github.signIn ? `<button class="btn sm" data-act="gh-signin">Sign in</button>` : ""}<button class="btn sm ghost" data-act="acct-remove" data-id="${h(a.id)}" title="Remove">${I.trash}</button></div></div>`).join("")}</div>`
      : `<div class="empty"><div class="mark">${I.people}</div><h2>No accounts yet</h2><p>Connect GitHub or GitLab to deploy straight from your repositories.</p><button class="btn primary" data-act="acct-add">${I.plus}Add an account</button></div>`}</div>
    <p class="faint small" style="margin-top:14px">To revoke a GitHub sign-in on GitHub's side too: github.com/settings/applications. GitLab tokens: gitlab.com/-/user_settings/personal_access_tokens.</p>`;
}
function acctModal() {
  const f = S.acctForm ||= { provider: "github", how: S.state.github.signIn ? "signin" : "token" };
  const m = modal(`<div class="modal-h"><div class="grow"><h2>Add an account</h2><p>Sign in for private repositories, or name any account for its public ones.</p></div><button class="btn icon ghost" data-x>${I.x}</button></div>
    <div class="seg full" id="aProv" style="margin-bottom:14px"><button data-v="github" class="${f.provider === "github" ? "on" : ""}">${I.github}GitHub</button><button data-v="gitlab" class="${f.provider === "gitlab" ? "on" : ""}">${I.gitlab}GitLab</button></div>
    <div class="seg full" id="aHow" style="margin-bottom:16px">${f.provider === "github" && S.state.github.signIn ? `<button data-v="signin" class="${f.how === "signin" ? "on" : ""}">Sign in</button>` : ""}<button data-v="token" class="${f.how === "token" ? "on" : ""}">Token</button><button data-v="name" class="${f.how === "name" ? "on" : ""}">Username</button></div>
    <div id="aBody"></div>`, { onClose: () => { if (S.device) api("/github/device", { method: "DELETE" }).catch(() => {}); S.device = null; } });
  $("[data-x]", m).onclick = closeModal;
  $("#aProv", m).onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; f.provider = b.dataset.v; if (f.provider === "gitlab" && f.how === "signin") f.how = "token"; acctModal(); };
  $("#aHow", m).onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; f.how = b.dataset.v; acctModal(); };
  const body = $("#aBody", m);
  if (f.how === "signin") {
    body.innerHTML = `<p class="muted small" style="margin-top:0">Burrow shows a code; you enter it at github.com/login/device on any device. No password is typed here.</p><div id="devBox"><button class="btn primary" data-act="dev-start">${I.github}Get a code</button></div>`;
  } else if (f.how === "token") {
    const url = f.provider === "github" ? "https://github.com/settings/tokens/new?description=Burrow%20Pages&scopes=repo" : "https://gitlab.com/-/user_settings/personal_access_tokens?name=Burrow%20Pages&scopes=read_api,read_repository";
    body.innerHTML = `<label class="f"><span>${PROV[f.provider]} personal access token</span><input class="inp mono" id="aToken" type="password" autocomplete="off" spellcheck="false" placeholder="${f.provider === "github" ? "ghp_… or github_pat_…" : "glpat-…"}"></label>
      <div class="help">Needs ${f.provider === "github" ? "<span class='mono'>repo</span> (or read access to contents for a fine-grained one)" : "<span class='mono'>read_api</span> and <span class='mono'>read_repository</span>"}. <a class="ok" href="${url}" target="_blank" rel="noopener">Make one ↗</a></div>
      <div class="modal-f"><button class="btn primary" data-act="acct-save">Connect</button></div>`;
  } else {
    body.innerHTML = `<label class="f"><span>${PROV[f.provider]} username${f.provider === "gitlab" ? " or group" : " or organization"}</span><input class="inp mono" id="aName" autocomplete="off" spellcheck="false" placeholder="octocat"></label>
      <div class="help">Lists its public repositories. Nothing to sign in to.</div>
      <div class="modal-f"><button class="btn primary" data-act="acct-save">Add</button></div>`;
  }
}
async function devStart(btn) {
  await busy(btn, async () => {
    try {
      S.device = await api("/github/device", { method: "POST", body: {} });
      paintDevice();
      const poll = async () => {
        if (!S.device || !$("#devBox")) return;
        S.device = await api("/github/device").catch(() => S.device);
        paintDevice();
        if (S.device?.state === "pending") setTimeout(poll, 2500);
        if (S.device?.state === "done") { toast(`Signed in as ${S.device.account.username}`); S.device = null; closeModal(); await loadState(); render(); }
      };
      setTimeout(poll, 2500);
    } catch (e) { toast(e.message, "err"); }
  });
}
function paintDevice() {
  const d = S.device, box = $("#devBox"); if (!box || !d) return;
  if (d.state === "pending") box.innerHTML = `<div class="code-big">${h(d.user_code)}</div><div class="row"><button class="btn" data-copy="${h(d.user_code)}">${I.copy}Copy</button><a class="btn primary grow" href="${h(d.uri)}" target="_blank" rel="noopener">${I.ext}Open github.com/login/device</a></div>
    <p class="faint small" style="text-align:center;margin:12px 0 0">Waiting for you on GitHub… the code works for ${Math.max(1, Math.round((d.expires - Date.now()) / 60000))} more minutes.</p>`;
  else if (d.state === "expired" || d.state === "error") box.innerHTML = `<div class="notice err">${I.warn}<div class="grow">${h(d.error || "The code expired.")}</div></div><button class="btn primary" data-act="dev-start">Get a new code</button>`;
}

/* ================================================================ activity */
async function renderActivity() {
  main.innerHTML = `<div class="page-h"><div class="grow"><h1>Activity</h1><p>Deploys, rollbacks, outages and changes, newest first.</p></div></div><div class="card" id="actList"><div class="skel" style="height:240px;margin:14px"></div></div>`;
  const r = await api("/activity?limit=300");
  const icon = { deploy: I.rocket, failed: I.warn, rollback: I.undo, down: I.warn, up: I.check, created: I.plus, removed: I.trash, settings: I.gear, account: I.user };
  let day = "";
  $("#actList").innerHTML = r.items.length ? r.items.map((e) => {
    const d = new Date(e.t).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const head = d !== day ? `<div style="padding:14px 18px 6px" class="faint small">${(day = d)}</div>` : "";
    return `${head}<div class="act"><span class="ic ${h(e.kind)}">${icon[e.kind] || I.info}</span><div>${e.site && S.state.sites[e.site] ? `<a href="#/site/${e.site}">${h(e.text)}</a>` : h(e.text)}</div><time title="${h(when(e.t))}">${new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>`;
  }).join("") : `<div class="empty"><p class="muted">Nothing has happened yet.</p></div>`;
}

/* ================================================================ settings */
async function renderSettings() {
  const st = await api("/settings");
  const d = S.state.docker;
  const total = Object.values(S.state.sites).length;
  main.innerHTML = `<div class="page-h"><div class="grow"><h1>Settings</h1><p>Defaults for every site, and how Burrow Pages runs on this machine.</p></div></div>
    <div class="card" id="gset">
      <div class="set"><div><h3>New sites</h3><p class="d">What a new site starts with.</p></div><div>
        <label class="f"><span>Who can open a new site</span><select class="inp" data-g="access" style="max-width:300px">${[["login", "Your login"], ["password", "A password"], ["public", "Everyone"]].map(([v, t]) => `<option value="${v}" ${st.access === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div></div>
      <div class="set"><div><h3>Deploys</h3><p class="d">How often repositories are checked, and how many deploys keep their files for rollbacks.</p></div><div class="grid2">
        <label class="f"><span>Look for new commits</span><select class="inp" data-g="syncEvery">${[[1, "Every minute"], [2, "Every 2 minutes"], [5, "Every 5 minutes"], [15, "Every 15 minutes"], [60, "Every hour"], [0, "Never by itself"]].map(([v, t]) => `<option value="${v}" ${Number(st.syncEvery) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="f" style="margin-top:0"><span>Deploys kept per site</span><input class="inp" type="number" min="1" max="50" data-g="keep" value="${st.keep}"></label></div></div>
      <div class="set"><div><h3>Health checks</h3><p class="d">Each site is checked every few minutes; when one stops answering, your dashboard's bell says so.</p></div><div>
        <label class="f"><span>Check every</span><select class="inp" data-g="monitorEvery" style="max-width:300px">${[1, 2, 5, 10, 30].map((v) => `<option value="${v}" ${Number(st.monitorEvery) === v ? "selected" : ""}>${v} minute${v === 1 ? "" : "s"}</option>`).join("")}</select></label>
        <div class="toggle-row" style="margin-top:8px"><label class="switch"><input type="checkbox" data-g="notify" ${st.notify ? "checked" : ""}><i></i></label><div><b>Tell me on the dashboard</b><span>Failed deploys and sites that go down.</span></div></div></div></div>
      <div class="set"><div><h3>Builds</h3><p class="d">Sites that need building run in a throwaway Docker container.</p></div><div>
        <div class="notice ${d?.ok ? "green" : "warn"}" style="margin-bottom:12px">${d?.ok ? I.check : I.warn}<div>${d?.ok ? `Docker ${h(d.version)} (${h(d.arch)}) is ready.` : h(d?.error || "Docker isn't available.")}</div></div>
        <div class="grid2"><label class="f"><span>Time limit</span><select class="inp" data-g="buildTimeout">${[5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${Number(st.buildTimeout) === v ? "selected" : ""}>${v} minutes</option>`).join("")}</select></label>
          <label class="f" style="margin-top:0"><span>Memory</span><select class="inp" data-g="buildMemory">${[512, 1024, 1536, 2048, 4096].map((v) => `<option value="${v}" ${Number(st.buildMemory) === v ? "selected" : ""}>${v >= 1024 ? `${v / 1024} GB` : `${v} MB`}</option>`).join("")}</select></label></div></div></div>
      <div class="set"><div><h3>GitHub sign-in</h3><p class="d">The GitHub OAuth app "Sign in with a code" uses. Burrow Pages' own is built in; its client ID is public and there's no secret.</p></div><div>
        <label class="f"><span>Client ID <span class="faint">(empty = the built-in one)</span></span><input class="inp mono" data-g="githubClientId" value="${h(st.githubClientId || "")}" placeholder="Ov23li…" spellcheck="false"></label>
        <div class="help">Using your own? Tick “Enable Device Flow” on it at github.com/settings/developers.</div></div></div>
      <div class="set"><div><h3>Everything at once</h3><p class="d">${total} site${total === 1 ? "" : "s"}. The export holds every site's settings and no sign-ins.</p></div><div class="row wrap">
        <a class="btn" href="api/export">${I.download}Export settings</a><button class="btn" data-act="sync-all">${I.sync}Look for new commits everywhere</button></div></div>
    </div><div id="gsave"></div>
    <p class="faint small" style="margin-top:16px">Burrow Pages ${h(S.state.version)} on Aegis × Burrow ${h(S.state.host)}.</p>`;
  const patch = {};
  $("#gset").addEventListener("change", (e) => {
    const k = e.target.dataset.g; if (!k) return;
    patch[k] = e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" || /Every|Timeout|Memory/.test(k) ? Number(e.target.value) : e.target.value;
    $("#gsave").innerHTML = `<div class="save-bar"><span class="grow">Unsaved changes</span><button class="btn primary sm" id="gsaveBtn">Save</button></div>`;
    $("#gsaveBtn").onclick = (ev) => busy(ev.currentTarget, async () => { try { await api("/settings", { method: "PATCH", body: patch }); toast("Saved"); await loadState(); renderSettings(); } catch (err) { toast(err.message, "err"); } });
  });
}

/* ================================================================ legacy tunnels */
function legacyModal() {
  const L = S.state.legacy;
  const m = modal(`<div class="modal-h"><div class="grow"><h2>Move into Burrow Pages</h2><p>These answer through Burrow's old Pages proxy. Moved in, each becomes a site here with caching, numbers, health checks, and can be public. The address stays the same.</p></div><button class="btn icon ghost" data-x>${I.x}</button></div>
    <div class="list card">${L.map((x) => `<div class="act" style="grid-template-columns:1fr auto"><div style="min-width:0"><b>${h(x.sub || x.name)}</b><div class="faint small ell">${h(x.url || "")} → ${h(x.target)}</div></div>
      <div class="row"><select class="inp" data-acc="${x.port}" style="height:32px;width:140px"><option value="public">Everyone</option><option value="login" ${x.access !== "public" ? "selected" : ""}>Your login</option><option value="password">A password</option></select>
      <button class="btn sm primary" data-act="adopt" data-port="${x.port}">Move</button></div></div>`).join("")}</div>
    <p class="help">Its old password can't be carried over (Burrow keeps only a hash): pick who can open it now, or set a new password after.</p>`, { wide: true });
  $("[data-x]", m).onclick = closeModal;
}

/* ================================================================ clicks */
document.addEventListener("click", async (e) => {
  const stop = e.target.closest("[data-stop]"); if (stop) return;
  const cp = e.target.closest("[data-copy]"); if (cp) { e.preventDefault(); return copy(cp.dataset.copy); }
  const go = e.target.closest("[data-go]"); if (go && !e.target.closest("a,button:not([data-go])")) { location.hash = go.dataset.go; return; }
  const acct = e.target.closest("[data-acct]"); if (acct) { S.wiz.acct = acct.dataset.acct; S.wiz.q = ""; return paintGitWizard(); }
  const repoEl = e.target.closest("[data-repo-full]"); if (repoEl) return pickRepo(repoEl.dataset.repoFull);
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, r = route(), s = S.sites[r.id], w = S.wiz;
  try {
    if (act === "toggle-log") { const box = el.closest(".job"); const log = $(".log", box); log.classList.toggle("hidden"); el.textContent = log.classList.contains("hidden") ? "Show log" : "Hide log"; return; }
    if (act === "legacy") return legacyModal();
    if (act === "adopt") {
      const port = el.dataset.port, access = $(`[data-acc="${port}"]`).value;
      let password;
      if (access === "password") { password = prompt("The site's new password:"); if (!password) return; }
      return busy(el, async () => { const out = await api(`/legacy/${port}/adopt`, { method: "POST", body: { access, password } }); closeModal(); toast("Moved in"); await loadState(); location.hash = `#/site/${out.site.id}`; render(); });
    }
    // ---- wizard
    if (act === "acct-add") return acctModal();
    if (act === "gh-signin") { S.acctForm = { provider: "github", how: "signin" }; return acctModal(); }
    if (act === "dev-start") return devStart(el);
    if (act === "acct-save") {
      const f = S.acctForm, body = { provider: f.provider };
      if (f.how === "token") body.token = $("#aToken").value.trim(); else body.username = $("#aName").value.trim();
      return busy(el, async () => { const a = await api("/accounts", { method: "POST", body }); toast(`${a.username} connected`); closeModal(); await loadState(); if (S.wiz?.kind === "git") { S.wiz.acct = a.id; delete S.repos?.[a.id]; } render(); });
    }
    if (act === "acct-remove") {
      const a = S.state.accounts.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox({ title: `Remove ${a.username}?`, text: `Burrow forgets this account${a.signedIn ? " and its sign-in" : ""}.${a.sites ? ` ${a.sites} site${a.sites === 1 ? " reads" : "s read"} from it: public repositories keep working, private ones stop updating.` : ""}`, ok: "Remove", danger: true }))) return;
      const out = await api(`/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" }); toast(out.note || "Removed"); await loadState(); return render();
    }
    if (act === "repos-fresh") return busy(el, () => loadRepos(true));
    if (act === "wiz-back") { w.step--; return paintWizard(); }
    if (act === "use-dir") { w.path = el.dataset.v; $("#wPath").value = w.path; return runDetect(); }
    if (act === "force-build") { w.mode = "build"; w.build = { image: "node:22-alpine", command: "npm install && npm run build", output: "dist" }; return paintGitWizard(); }
    if (el.closest("#wMode")) return;
    if (act === "wiz-git-next") { if (w.mode === "build") w.build = { ...w.build, ...readBuild() }; w.step = 2; return paintGitWizard(); }
    if (act === "wiz-git-create") {
      const addr = readAddress(w);
      w.auto = $("#wAuto").checked; w.spa = $("#wSpa").checked;
      return busy(el, async () => {
        const out = await api("/sites", { method: "POST", body: { type: "git", ...addr, source: { provider: w.repo.provider, account: w.acct, repo: w.repo.full, branch: w.branch, path: w.path || "", mode: w.mode, build: w.mode === "build" ? w.build : undefined, autoDeploy: w.auto, private: w.repo.private }, serving: { spa: w.spa } } });
        S.state.sites[out.site.id] = out.site;
        w.siteId = out.site.id; w.job = out.job; w.step = 3;
        S.jobs.set(out.job, S.jobs.get(out.job) || { id: out.job, label: `Deploy ${addr.name}`, state: "queued", phase: "Starting", log: [] });
        paintGitWizard();
      });
    }
    if (act === "wiz-proxy") {
      const addr = readAddress(w);
      const upstream = $("#wUp").value.trim(); if (!upstream) throw new Error("Enter the address of the site.");
      return busy(el, async () => {
        const out = await api("/sites", { method: "POST", body: { type: "proxy", ...addr, proxy: { upstream, cacheSeconds: $("#wCache").checked ? 60 : 0, rewriteLinks: $("#wRewrite").checked } } });
        S.wiz = null; toast(`${addr.name} is live`); await loadState(); location.hash = `#/site/${out.site.id}`;
      });
    }
    if (act === "wiz-upload-create") {
      const addr = readAddress(w);
      return busy(el, async () => { const out = await api("/sites", { method: "POST", body: { type: "upload", ...addr } }); S.state.sites[out.site.id] = out.site; w.siteId = out.site.id; w.step = 1; paintWizard(); });
    }
    if (act === "pick-folder") return $("#upFolder").click();
    if (act === "pick-archive") return $("#upArchive").click();
    // ---- a site
    if (act === "deploy" || act === "deploy-clean") return busy(el, async () => { const out = await api(`/sites/${s.id}/deploy`, { method: "POST", body: { clearCache: act === "deploy-clean" } }); S.jobs.set(out.job, { id: out.job, site: s.id, label: `Deploy ${s.name}`, state: "queued", phase: "Starting", log: [] }); if (r.tab && r.tab !== "overview" && r.tab !== "deploys") location.hash = `#/site/${s.id}/deploys`; else paintTab(); });
    if (act === "upload") { $("#siteUp").innerHTML = `<div class="card pad" style="margin-bottom:16px">${dropZone()}</div>`; return wireDrop($("#siteUp .drop"), s.id, false); }
    if (act === "sync") return busy(el, async () => { S.sites[s.id] = { ...(await api(`/sites/${s.id}/sync`, { method: "POST", body: {} })), _at: Date.now() }; toast(S.sites[s.id].sync?.error || "Checked"); paintTab(); });
    if (act === "check") return busy(el, async () => { const out = await api(`/sites/${s.id}/check`, { method: "POST", body: {} }); s.health = out.health; toast(out.health.ok ? "Answering" : `Not answering: ${out.health.error || out.health.status}`, out.health.ok ? "ok" : "err"); refreshSite(s.id); });
    if (act === "purge") return busy(el, async () => { await api(`/sites/${s.id}/purge`, { method: "POST", body: {} }); toast("Cache emptied"); });
    if (act === "pause" || act === "resume") return busy(el, async () => { await api(`/sites/${s.id}`, { method: "PATCH", body: { paused: act === "pause" } }); toast(act === "pause" ? "Paused" : "Answering again"); refreshSite(s.id); await loadState(); paintSiteHead(); });
    if (act === "maint-off") return busy(el, async () => { await api(`/sites/${s.id}`, { method: "PATCH", body: { maintenance: { on: false } } }); toast("Maintenance off"); refreshSite(s.id); });
    if (act === "auto-on") return busy(el, async () => { await api(`/sites/${s.id}`, { method: "PATCH", body: { source: { autoDeploy: true } } }); toast("Pushes are deployed again"); refreshSite(s.id); });
    if (act === "rollback") {
      const d = s.deploys.find((x) => x.id === el.dataset.d);
      if (!(await confirmBox({ title: "Make this deploy live?", text: `${h(d.commit?.message || d.note || d.id)}, from ${ago(d.at)}, replaces what's live at once.${s.type === "git" ? " New pushes stop being deployed until you turn that back on." : ""}`, ok: "Make it live" }))) return;
      await api(`/sites/${s.id}/rollback`, { method: "POST", body: { deploy: d.id } }); toast("Rolled back"); return refreshSite(s.id);
    }
    if (act === "drop-deploy") { if (!(await confirmBox({ title: "Delete this deploy?", text: "Its files and log are deleted; it can't be made live again.", ok: "Delete", danger: true }))) return; await api(`/sites/${s.id}/deploys/${el.dataset.d}`, { method: "DELETE" }); toast("Deleted"); return refreshSite(s.id); }
    if (act === "log") {
      const d = s.deploys.find((x) => x.id === el.dataset.d);
      const m = modal(`<div class="modal-h"><div class="grow"><h2>${h(d.commit?.message || d.note || "Deploy")}</h2><p>${d.commit?.sha ? `<span class="mono">${h(d.commit.sha.slice(0, 7))}</span> · ` : ""}${when(d.at)}</p></div><button class="btn icon ghost" data-x>${I.x}</button></div><div class="log" id="logBox">Loading…</div>`, { wide: true });
      $("[data-x]", m).onclick = closeModal;
      const live = [...S.jobs.values()].find((j) => j.site === s.id && j.state === "running");
      if (live && d.state === "building") { $("#logBox").outerHTML = jobBox(live); return; }
      const t = await api(`/sites/${s.id}/deploys/${d.id}/log`).catch((er) => er.message);
      $("#logBox").innerHTML = logHtml(String(t).trim().split("\n"));
      return;
    }
    if (act === "set-save") return saveSettings(el);
    if (act === "set-reset") { S.dirty = null; return paintTab(); }
    if (act === "remove") {
      if (!(await confirmBox({ title: `Remove ${s.name}?`, text: `${h(s.host || "Its address")} stops answering, and its deploys, files and numbers are deleted.`, ok: "Remove", danger: true, type: s.sub || s.name }))) return;
      await api(`/sites/${s.id}`, { method: "DELETE" }); toast(`${s.name} removed`); delete S.sites[s.id]; await loadState(); location.hash = "#/"; return;
    }
    if (act === "sync-all") return busy(el, async () => { for (const x of Object.values(S.state.sites)) if (x.type === "git") await api(`/sites/${x.id}/sync`, { method: "POST", body: {} }).catch(() => {}); toast("Checked every repository"); });
  } catch (err) { toast(err.message, "err"); }
});
document.addEventListener("click", (e) => { const b = e.target.closest("#wMode [data-v]"); if (!b) return; S.wiz.mode = b.dataset.v; if (b.dataset.v === "static") S.wiz.path = S.wiz.det.prebuilt; paintGitWizard(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.(".site, [data-go]") && !e.target.closest("input,textarea")) location.hash = e.target.dataset.go;
  if (e.key === "Enter" && (e.target.id === "aToken" || e.target.id === "aName")) $('[data-act="acct-save"]')?.click();
});
window.addEventListener("beforeunload", (e) => { if (S.dirty && Object.keys(S.dirty.patch).length) { e.preventDefault(); e.returnValue = ""; } });

render().then(connect);
setInterval(() => { if (route().view === "sites" && !document.hidden) loadState().then(paintSites).catch(() => {}); }, 60000);
