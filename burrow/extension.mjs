// Burrow Pages, inside Burrow.
//
// Burrow loads this while the addon is installed (forge-addon.json "burrow":
// {"extension"}) and hands it a context: its data folder, its settings, the
// linked domain and its DNS records (read-only), and the tunnels it made.
// Everything here answers under /__gate/api/x/burrow-pages/… (signed in) and
// /x/burrow-pages/… on Burrow's control socket.
//
//   accounts   GitHub and GitLab accounts: by username (public repositories),
//              or signed in to GitHub with its device flow (private ones too).
//              Accounts the domain already points at are found on install.
//   repos      an account's repositories, smart-sorted: commits and activity.
//   deploy     a repository on a subdomain of yours, behind your login or a
//              password of its own. Burrow serves the repository's files
//              itself ("files": private repositories stay private, and a push
//              shows up within minutes), or proxies its GitHub/GitLab Pages
//              site when that is built from sources ("pages"), turning Pages
//              on first when it has to.

import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TYPES, branchOrder, countFromLink, detectSetups, pickContent, smartSort, subFromRepo } from "./lib.mjs";

const GH = process.env.BURROW_PAGES_GITHUB || "https://github.com";
const GH_API = process.env.BURROW_PAGES_GITHUB_API || "https://api.github.com";
const GH_CODELOAD = process.env.BURROW_PAGES_CODELOAD || "https://codeload.github.com";
const GL_API = process.env.BURROW_PAGES_GITLAB_API || "https://gitlab.com/api/v4";
const SYNC_EVERY = 10 * 60 * 1000;          // look for new commits
const REPOS_TTL = 30 * 60 * 1000;           // a repository list is good for this long
const PORT_BASE = 47600;                    // where the file servers listen (127.0.0.1)
const MAX_DOWNLOAD = 300 * 1024 * 1024;
const ACCOUNT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,6}$/;

let ctx = null, UA = "burrow-pages";
const servers = new Map();      // tunnel port -> http server
const jobs = new Map();         // job id -> {state, phase, log, result, error}
let device = null;              // GitHub sign-in in progress
let syncTimer = null, stopped = false;

const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
// what GitHub's sign-in errors mean for you, in words
const OAUTH_ERRORS = {
  device_flow_disabled: "Device Flow is off for this app. On github.com/settings/developers → OAuth Apps → the app, tick “Enable Device Flow”, press Update application, then sign in again.",
  incorrect_client_credentials: "GitHub doesn't know that client ID. Check it under Burrow → Addons → Burrow Pages → ⋯ → Settings and reinstall.",
  unsupported_grant_type: "GitHub didn't accept the sign-in request.",
};
const now = () => Date.now();

// ------------------------------------------------------------------ state (data/state.json, mode 600)
// Read and written whole each time: the install script adds the accounts it
// finds on the domain to the same file, so nothing is kept only in memory.
const stateFile = () => join(ctx.dataDir, "state.json");
function load() {
  try { const s = JSON.parse(readFileSync(stateFile(), "utf8")); return { accounts: [], deploys: {}, dismissed: [], repos: {}, ...s }; }
  catch { return { accounts: [], deploys: {}, dismissed: [], repos: {} }; }
}
function save(s) {
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
  renameSync(tmp, stateFile());
}
function mutate(fn) { const s = load(); const out = fn(s); save(s); return out; }
const account = (s, id) => s.accounts.find((a) => a.id === id) || fail(404, "No such account.");

// ------------------------------------------------------------------ GitHub and GitLab
async function call(url, { token, method = "GET", body, accept = "application/json", raw, provider = "github", timeout = 20000 } = {}) {
  const headers = { "user-agent": UA, accept };
  if (provider === "github") headers["x-github-api-version"] = "2022-11-28";
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  let r;
  try { r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { fail(502, `${new URL(url).host} didn't answer (${e.cause?.code || e.message}).`); }
  if (raw) return r;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
      const at = new Date(Number(r.headers.get("x-ratelimit-reset")) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      fail(429, `GitHub's limit for requests ${token ? "" : "without signing in "}is used up until ${at}.${token ? "" : " Sign in with GitHub for many more."}`);
    }
    if (r.status === 401) fail(401, `${provider === "github" ? "GitHub" : "GitLab"} refused the sign-in. Sign in again.`);
    const why = j && (OAUTH_ERRORS[j.error] || j.error_description || j.message || j.error);
    // their "no" is a 4xx we pass on as one; only a broken answer is a 502
    fail(r.status === 404 ? 404 : r.status < 500 ? 400 : 502, why ? `${provider === "github" ? "GitHub" : "GitLab"}: ${why}` : `${new URL(url).host} answered HTTP ${r.status}.`);
  }
  return { json: j, headers: r.headers };
}
const gh = async (a, path, o = {}) => (await call(path.startsWith("http") ? path : GH_API + path, { token: a?.token, ...o })).json;
const gl = async (a, path, o = {}) => (await call(GL_API + path, { token: a?.token, provider: "gitlab", ...o })).json;
const glId = (full) => encodeURIComponent(full);

// ------------------------------------------------------------------ accounts
function publicAccount(a, s) {
  return { id: a.id, provider: a.provider, username: a.username, name: a.name || "", avatar: a.avatar || "", kind: a.kind || "user",
           signedIn: !!a.token, scopes: a.scopes || "", source: a.source, added: a.added,
           sites: Object.values(s.deploys).filter((d) => d.account === a.id).length };
}

async function addAccount({ provider, username, source = "you" }) {
  provider = provider === "gitlab" ? "gitlab" : "github";
  username = String(username || "").trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?(?:github|gitlab)\.com\//i, "").replace(/\/.*$/, "");
  if (!ACCOUNT_RE.test(username)) fail(400, "That doesn't look like a username.");
  let a;
  if (provider === "github") {
    const u = await gh(null, `/users/${encodeURIComponent(username)}`).catch((e) => { if (e.status === 404) fail(404, `There is no GitHub account called ${username}.`); throw e; });
    a = { provider, username: u.login, name: u.name || "", avatar: u.avatar_url || "", kind: u.type === "Organization" ? "org" : "user" };
  } else {
    const users = await gl(null, `/users?username=${encodeURIComponent(username)}`);
    if (users?.length) a = { provider, username: users[0].username, name: users[0].name || "", avatar: users[0].avatar_url || "", kind: "user", glid: users[0].id };
    else {
      const g = await gl(null, `/groups/${encodeURIComponent(username)}`).catch(() => null);
      if (!g) fail(404, `There is no GitLab user or group called ${username}.`);
      a = { provider, username: g.full_path, name: g.name || "", avatar: g.avatar_url || "", kind: "group", glid: g.id };
    }
  }
  a.id = `${provider}:${a.username.toLowerCase()}`;
  return mutate((s) => {
    const old = s.accounts.find((x) => x.id === a.id);
    if (old) { Object.assign(old, { name: a.name, avatar: a.avatar }); return publicAccount(old, s); }
    s.accounts.push({ ...a, source, added: now() });
    s.dismissed = s.dismissed.filter((d) => d !== a.id);
    return publicAccount(s.accounts.at(-1), s);
  });
}

function removeAccount(id) {
  return mutate((s) => {
    const a = account(s, id);
    s.accounts = s.accounts.filter((x) => x.id !== id);
    if (!s.dismissed.includes(id)) s.dismissed.push(id);      // the domain check won't bring it back
    delete s.repos[id];
    const left = Object.values(s.deploys).filter((d) => d.account === id).length;
    ctx.log("account removed:", id);
    return { removed: id, signedOut: !!a.token, sitesLeft: left,
             note: a.token ? "Burrow forgot its sign-in. To revoke it on GitHub too: github.com/settings/applications." : undefined };
  });
}

// ------------------------------------------------------------------ GitHub sign-in (device flow)
// Burrow shows a code; you enter it at github.com/login/device. No password
// or token is ever typed into Burrow, and nothing needs a browser on this machine.
async function startDevice() {
  const clientId = String(ctx.setting("GITHUB_CLIENT_ID") || "").trim();
  if (!clientId) fail(409, "GitHub sign-in isn't set up yet: Burrow Pages needs its GitHub app's client ID (Burrow → Addons → Burrow Pages → ⋯ → Settings and reinstall). Accounts by username work without it.");
  const { json: d } = await call(`${GH}/login/device/code`, { method: "POST", body: { client_id: clientId, scope: "repo read:user" } })
    .catch((e) => { if (e.status === 404) fail(400, `GitHub: ${OAUTH_ERRORS.incorrect_client_credentials}`); throw e; });
  if (!d?.device_code) fail(502, d?.error_description || "GitHub didn't give a code.");
  device = { clientId, code: d.device_code, user_code: d.user_code, uri: d.verification_uri || `${GH}/login/device`,
             expires: now() + (d.expires_in || 900) * 1000, interval: Math.max(5, d.interval || 5), state: "pending", account: null, error: null };
  pollDevice(device);
  return deviceView();
}
function deviceView() {
  if (!device) return { state: "none" };
  return { state: device.state, user_code: device.user_code, verification_uri: device.uri, expires: device.expires, account: device.account, error: device.error };
}
function pollDevice(dv) {
  setTimeout(async () => {
    if (stopped || device !== dv || dv.state !== "pending") return;
    if (now() > dv.expires) { dv.state = "expired"; return; }
    try {
      const { json: t } = await call(`${GH}/login/oauth/access_token`, { method: "POST",
        body: { client_id: dv.clientId, device_code: dv.code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" } });
      if (t?.access_token) {
        const u = await gh({ token: t.access_token }, "/user");
        const id = `github:${u.login.toLowerCase()}`;
        dv.account = mutate((s) => {
          let a = s.accounts.find((x) => x.id === id);
          if (!a) { a = { id, provider: "github", username: u.login, kind: "user", source: "signed in", added: now() }; s.accounts.push(a); }
          Object.assign(a, { name: u.name || "", avatar: u.avatar_url || "", token: t.access_token, scopes: t.scope || "", signedInAt: now() });
          s.dismissed = s.dismissed.filter((d) => d !== id);
          delete s.repos[id];
          return publicAccount(a, s);
        });
        dv.state = "done";
        ctx.log("signed in to GitHub as", u.login);
        return;
      }
      if (t?.error === "slow_down") dv.interval += 5;
      else if (t?.error === "expired_token") { dv.state = "expired"; return; }
      else if (t?.error === "access_denied") { dv.state = "denied"; return; }
      else if (t?.error && t.error !== "authorization_pending") { dv.state = "error"; dv.error = OAUTH_ERRORS[t.error] || t.error_description || t.error; return; }
    } catch (e) { dv.error = e.message; }
    pollDevice(dv);
  }, dv.interval * 1000);
}

// ------------------------------------------------------------------ repositories, smart-sorted
function shapeGh(r) {
  return { provider: "github", full: r.full_name, name: r.name, owner: r.owner?.login || "", private: !!r.private, description: r.description || "",
           pushed: Date.parse(r.pushed_at) || 0, stars: r.stargazers_count || 0, fork: !!r.fork, archived: !!r.archived, language: r.language || "",
           branch: r.default_branch || "main", pages: !!r.has_pages, admin: !!r.permissions?.admin, size: r.size || 0, url: r.html_url };
}
function shapeGl(p) {
  return { provider: "gitlab", full: p.path_with_namespace, name: p.name, owner: p.namespace?.full_path || "", private: p.visibility !== "public",
           description: p.description || "", pushed: Date.parse(p.last_activity_at) || 0, stars: p.star_count || 0, fork: !!p.forked_from_project,
           archived: !!p.archived, language: "", branch: p.default_branch || "main", pages: false, admin: false, glid: p.id, url: p.web_url };
}

async function listRepos(id, fresh) {
  const s = load(), a = account(s, id);
  const cached = s.repos[id];
  if (!fresh && cached && now() - cached.at < REPOS_TTL) return annotate(cached.list, s);
  let list = [];
  if (a.provider === "github") {
    const base = a.token ? "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100"
                         : `/users/${encodeURIComponent(a.username)}/repos?sort=pushed&per_page=100&type=owner`;
    for (let page = 1; page <= 3; page++) {
      const got = await gh(a, `${base}&page=${page}`);
      list.push(...got.map(shapeGh));
      if (got.length < 100) break;
    }
    // commits: one small request per repository, for the most recently active ones
    const top = [...list].sort((x, y) => y.pushed - x.pushed).slice(0, a.token ? 40 : 12);
    await Promise.all(top.map(async (r, i) => {
      await new Promise((ok) => setTimeout(ok, (i % 8) * 60));
      try {
        const res = await call(`${GH_API}/repos/${r.full}/commits?per_page=1`, { token: a.token, raw: true });
        if (res.status === 409) { r.commits = 0; return; }           // an empty repository
        if (!res.ok) return;
        const body = await res.json().catch(() => []);
        r.commits = countFromLink(res.headers.get("link"), Array.isArray(body) ? body.length : 0);
      } catch { /* leave it unknown */ }
    }));
  } else {
    const path = a.kind === "group" ? `/groups/${a.glid}/projects?include_subgroups=true` : `/users/${a.glid || encodeURIComponent(a.username)}/projects`;
    for (let page = 1; page <= 3; page++) {
      const got = await gl(a, `${path}${path.includes("?") ? "&" : "?"}order_by=last_activity_at&per_page=100&page=${page}`);
      list.push(...got.map(shapeGl));
      if (got.length < 100) break;
    }
    const top = [...list].sort((x, y) => y.pushed - x.pushed).slice(0, 15);
    await Promise.all(top.map(async (r) => {
      try {
        const res = await call(`${GL_API}/projects/${r.glid}/repository/commits?per_page=1`, { token: a.token, provider: "gitlab", raw: true });
        const n = Number(res.headers.get("x-total")); if (res.ok && n >= 0 && res.headers.get("x-total")) r.commits = n;
        await res.body?.cancel();
      } catch { /* unknown */ }
    }));
  }
  list = smartSort(list);
  mutate((st) => { st.repos[id] = { at: now(), list }; });
  return annotate(list, load());
}
function annotate(list, s) {
  const by = new Map(Object.values(s.deploys).map((d) => [`${d.provider}:${d.repo}`, d]));
  return list.map((r) => { const d = by.get(`${r.provider}:${r.full}`); return d ? { ...r, deployed: { port: d.port, sub: d.sub } } : r; });
}

// ------------------------------------------------------------------ downloading a repository
function tar(args) {
  return new Promise((ok, no) => {
    const p = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => no(e));
    p.on("close", (code) => (code === 0 ? ok() : no(new Error(`tar: ${err.trim().split("\n").pop() || `exit ${code}`}`))));
  });
}
async function download(a, r, branch, into) {
  const url = r.provider === "github"
    ? (a?.token ? `${GH_API}/repos/${r.full}/tarball/${encodeURIComponent(branch)}` : `${GH_CODELOAD}/${r.full}/tar.gz/refs/heads/${encodeURIComponent(branch)}`)
    : `${GL_API}/projects/${glId(r.full)}/repository/archive.tar.gz?sha=${encodeURIComponent(branch)}`;
  const res = await call(url, { token: a?.token, provider: r.provider, raw: true, accept: "*/*", timeout: 300000 });
  if (!res.ok) fail(502, `Couldn't download ${r.full}@${branch} (HTTP ${res.status}).`);
  mkdirSync(into, { recursive: true, mode: 0o700 });
  const file = `${into}.tar.gz`;
  let size = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => { size += c.length; if (size > MAX_DOWNLOAD) body.destroy(new Error("The repository is over 300 MB.")); });
  await pipeline(body, createWriteStream(file, { mode: 0o600 }));
  // GNU tar drops leading "/" and refuses ".." in names; links stay inside (the server checks)
  await tar(["-xzf", file, "-C", into, "--strip-components=1", "--no-same-owner", "--no-same-permissions"]);
  rmSync(file, { force: true });
}
async function headOf(a, r, branch) {
  if (r.provider === "github") return (await gh(a, `/repos/${r.full}/branches/${encodeURIComponent(branch)}`)).commit.sha;
  return (await gl(a, `/projects/${glId(r.full)}/repository/branches/${encodeURIComponent(branch)}`)).commit.id;
}
async function branchesOf(a, r) {
  try {
    if (r.provider === "github") return (await gh(a, `/repos/${r.full}/branches?per_page=100`)).map((b) => b.name);
    return (await gl(a, `/projects/${glId(r.full)}/repository/branches?per_page=100`)).map((b) => b.name);
  } catch { return [r.branch]; }
}
// a Jekyll site: its HTML is a template GitHub Pages renders, not the page itself
function isJekyll(dir) {
  if (existsSync(join(dir, "_config.yml"))) return true;
  try { return readFileSync(join(dir, "index.html"), "utf8").startsWith("---"); } catch { return false; }
}

// ------------------------------------------------------------------ serving the files
function siteRoot(port) { return join(ctx.dataDir, "sites", String(port)); }
function current(port) { try { return realpathSync(join(siteRoot(port), "current")); } catch { return null; } }

function fileServer(port) {
  return createServer((req, res) => {
    const head = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache", "Referrer-Policy": "strict-origin-when-cross-origin" };
    const end = (status, text, extra = {}) => { res.writeHead(status, { ...head, "Content-Type": "text/plain; charset=utf-8", ...extra }); res.end(req.method === "HEAD" ? undefined : text); };
    if (req.method !== "GET" && req.method !== "HEAD") return end(405, "Only GET and HEAD.", { Allow: "GET, HEAD" });
    const root = current(port);
    if (!root) return end(503, "This site is being deployed. Try again in a moment.");
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return end(400, "Bad address."); }
    if (rel.includes("\0")) return end(400, "Bad address.");
    const inside = (p) => p === root || p.startsWith(root + sep);
    let file = resolve(root, "." + rel);
    if (!inside(file)) return end(404, "Not found.");
    let st = null;
    try { st = statSync(file); } catch { /* try below */ }
    if (st?.isDirectory()) {
      if (!rel.endsWith("/")) { const u = new URL(req.url, "http://x"); return end(301, "Moved.", { Location: u.pathname + "/" + u.search }); }
      file = join(file, "index.html"); st = null;
      try { st = statSync(file); } catch { /* none */ }
    }
    if (!st && !extname(file)) { try { st = statSync(file + ".html"); file += ".html"; } catch { /* none */ } }
    let status = 200;
    if (!st?.isFile()) {
      try { file = join(root, "404.html"); st = statSync(file); status = 404; } catch { return end(404, "Not found."); }
    }
    // a link in the repository must not reach outside the site
    try { if (!inside(realpathSync(file))) return end(404, "Not found."); } catch { return end(404, "Not found."); }
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (status === 200 && req.headers["if-none-match"] === etag) { res.writeHead(304, { ...head, ETag: etag }); return res.end(); }
    res.writeHead(status, { ...head, "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
                            "Content-Length": st.size, ETag: etag, "Last-Modified": new Date(st.mtimeMs).toUTCString() });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
}
function listen(server, port) {
  return new Promise((ok, no) => {
    const fail2 = (e) => { server.off("listening", good); no(e); };
    const good = () => { server.off("error", fail2); ok(port); };
    server.once("error", fail2); server.once("listening", good);
    server.listen(port, "127.0.0.1");
  });
}
// A site's file server: keyed by its tunnel's port; it listens there too,
// unless that port was taken while Burrow was down (then the tunnel follows).
async function serve(key, want) {
  const old = servers.get(key);
  if (old) return old.address().port;
  const used = new Set([...ctx.tunnels.list().map((t) => t.port), ...[...servers.values()].map((s) => s.address()?.port)]);
  for (let p = want || PORT_BASE, tries = 0; tries < 200; p++, tries++) {
    if (p !== want && used.has(p)) continue;
    const srv = fileServer(key ?? String(p));
    try { await listen(srv, p); servers.set(key ?? String(p), srv); return p; } catch { srv.close(); }
  }
  fail(503, "No free port for the site's file server.");
}

// ------------------------------------------------------------------ deploying
function job(label, work) {
  const j = { id: randomBytes(6).toString("hex"), label, state: "running", phase: label, log: [], result: null, error: null, started: now() };
  jobs.set(j.id, j);
  for (const [k, v] of jobs) if (v.state !== "running" && now() - v.started > 3600e3) jobs.delete(k);
  const say = (line) => { j.phase = line; j.log.push(line); ctx.log(line); };
  work(say).then((r) => { j.state = "done"; j.result = r; }).catch((e) => { j.state = "error"; j.error = e.message; j.log.push(e.message); });
  return { job: j.id };
}

async function deploy({ account: id, repo: full, sub, access = "login", password, name }, say) {
  const s = load(), a = account(s, id);
  if (!REPO_RE.test(full || "")) fail(400, "Pick a repository.");
  if (Object.values(s.deploys).some((d) => d.provider === a.provider && d.repo === full)) fail(409, `${full} is already deployed.`);
  if (access === "public") fail(400, "A site from Burrow Pages is behind a password: your login, or one of its own.");
  if (ctx.domain() && !sub) fail(400, "Pick its subdomain.");
  say(`Looking at ${full}`);
  const r = a.provider === "github" ? shapeGh(await gh(a, `/repos/${full}`)) : shapeGl(await gl(a, `/projects/${glId(full)}`));
  const meta = { repo: r.full, provider: r.provider, private: r.private };

  // 1. the files, as they are in the repository (a Pages branch first)
  const branches = await branchesOf(a, r);
  const tmp = join(ctx.dataDir, "sites", `.dl-${randomBytes(4).toString("hex")}`);
  let found = null;
  for (const branch of branchOrder(branches, r.branch).slice(0, 3)) {
    say(`Downloading ${r.full}@${branch}`);
    const into = join(tmp, branch.replace(/[^A-Za-z0-9._-]/g, "_"));
    try { await download(a, r, branch, into); } catch (e) { say(`  ${e.message}`); continue; }
    const dir = pickContent((p) => existsSync(join(into, p)));
    if (dir !== null && !isJekyll(join(into, dir))) { found = { branch, dir, into }; break; }
    say(dir === null ? `  no index.html on ${branch}` : `  ${branch} is a Jekyll site: GitHub Pages has to build it`);
  }
  if (found) {
    const commit = await headOf(a, r, found.branch).catch(() => "");
    say("Starting its file server");
    const port = await serve(null);
    const root = siteRoot(port);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const ver = join(root, (commit.slice(0, 12) || "v") + "-" + now().toString(36));
    renameSync(found.dir ? join(found.into, found.dir) : found.into, ver);
    rmSync(tmp, { recursive: true, force: true });
    swap(port, ver);
    say(`Publishing it${sub ? ` at ${sub}` : ""}`);
    let t;
    try {
      t = await ctx.tunnels.create({ port, targetHost: "127.0.0.1", targetPort: port, scheme: "http", name: name || r.name, sub, access, password,
                                     meta: { ...meta, mode: "files", branch: found.branch, path: found.dir || "/" } });
    } catch (e) { servers.get(String(port))?.close(); servers.delete(String(port)); rmSync(root, { recursive: true, force: true }); throw e; }
    mutate((st) => { st.deploys[t.port] = { port: t.port, listen: port, mode: "files", account: id, provider: r.provider, repo: r.full,
                                            branch: found.branch, path: found.dir || "/", commit, synced: now(), sub: t.sub, private: r.private }; });
    say(`Live: ${t.url || "its address is on its way"}`);
    return { tunnel: t, mode: "files", branch: found.branch, path: found.dir || "/", commit };
  }
  rmSync(tmp, { recursive: true, force: true });

  // 2. its Pages site, built by GitHub or GitLab (Jekyll and friends)
  let pagesUrl = r.provider === "github"
    ? (r.full.split("/")[1].toLowerCase() === `${r.owner.toLowerCase()}.github.io` ? `https://${r.owner.toLowerCase()}.github.io/` : `https://${r.owner.toLowerCase()}.github.io/${r.full.split("/")[1]}/`)
    : `https://${r.full.split("/")[0].toLowerCase()}.gitlab.io/${r.full.split("/").slice(1).join("/")}/`;
  const live = async () => { try { const x = await fetch(pagesUrl, { redirect: "manual", signal: AbortSignal.timeout(12000) }); return x.status === 200; } catch { return false; } };
  if (r.private) fail(400, `${r.full} isn't a static website Burrow can serve: no index.html in /, docs/, dist/… or a gh-pages branch (or it is a Jekyll site, whose Pages copy would be public). Burrow Pages serves static websites only; commit the built site and deploy again.`);
  if (!(await live())) {
    // 3. turn GitHub Pages on for it, then serve that
    if (r.provider !== "github" || !a.token || !r.admin) {
      fail(400, `${r.full} isn't a static website: no index.html to serve and no Pages site. Burrow Pages serves static websites only (HTML, CSS, JavaScript, already built); apps that need a server won't run.${r.provider === "github" && !a.token ? " If it is a Jekyll site, sign in with GitHub and Burrow can turn Pages on to build it." : ""}`);
    }
    say("Turning GitHub Pages on for it");
    const docs = branches.includes(r.branch) && (await gh(a, `/repos/${r.full}/contents/docs?ref=${encodeURIComponent(r.branch)}`).then(() => true, () => false));
    await gh(a, `/repos/${r.full}/pages`, { method: "POST", body: { build_type: "legacy", source: { branch: r.branch, path: docs ? "/docs" : "/" } } })
      .catch((e) => { if (!/already/i.test(e.message)) throw e; });
    say("Waiting for GitHub to build it");
    for (let i = 0; i < 40 && !(await live()); i++) await new Promise((ok) => setTimeout(ok, 6000));
    if (!(await live())) fail(504, "GitHub hasn't finished building it yet. Try again in a few minutes.");
  }
  say(`Publishing ${pagesUrl}`);
  const t = await ctx.tunnels.create({ site: pagesUrl, sub, access, password, name: name || r.name, meta: { ...meta, mode: "pages" } });
  mutate((st) => { st.deploys[t.port] = { port: t.port, mode: "pages", account: id, provider: r.provider, repo: r.full, site: pagesUrl, synced: now(), sub: t.sub, private: false }; });
  say(`Live: ${t.url || "its address is on its way"}`);
  return { tunnel: t, mode: "pages", site: pagesUrl };
}

// "current" points at the version being served; switching is one rename
function swap(key, ver) {
  const link = join(siteRoot(key), "current"), tmp = `${link}.${now()}`;
  const old = current(key);
  symlinkSync(ver, tmp);
  renameSync(tmp, link);
  if (old && old !== realpathSync(ver)) rmSync(old, { recursive: true, force: true });
}

// A new commit on the branch: download it, then switch over in one rename.
async function sync(port, say = () => {}) {
  const s = load(), d = s.deploys[port];
  if (!d || d.mode !== "files") fail(404, "That site isn't served from files.");
  const a = s.accounts.find((x) => x.id === d.account) || null;
  const r = { provider: d.provider, full: d.repo, branch: d.branch };
  const head = await headOf(a, r, d.branch);
  if (head && head === d.commit) { mutate((st) => { if (st.deploys[port]) st.deploys[port].checked = now(); }); return { changed: false, commit: head }; }
  say(`New commit on ${d.repo}@${d.branch}: ${String(head).slice(0, 7)}`);
  const into = join(siteRoot(port), `.dl-${now()}`);
  try { await download(a, r, d.branch, into); }
  catch (e) { rmSync(into, { recursive: true, force: true }); rmSync(`${into}.tar.gz`, { force: true }); throw e; }
  const src = d.path && d.path !== "/" ? join(into, d.path) : into;
  if (!existsSync(join(src, "index.html"))) { rmSync(into, { recursive: true, force: true }); fail(400, `${d.path} has no index.html any more on ${d.branch}.`); }
  const ver = join(siteRoot(port), (head || "v").slice(0, 12) + "-" + now().toString(36));
  renameSync(src, ver);
  rmSync(into, { recursive: true, force: true });
  swap(port, ver);
  mutate((st) => { if (st.deploys[port]) Object.assign(st.deploys[port], { commit: head, synced: now(), checked: now() }); });
  ctx.log(`${d.repo}: now at ${String(head).slice(0, 7)}`);
  return { changed: true, commit: head };
}

async function undeploy(port) {
  const d = load().deploys[port];
  if (!d) fail(404, "No such site.");
  await ctx.tunnels.remove(Number(port)).catch(() => {});
  servers.get(String(port))?.close(); servers.delete(String(port));
  rmSync(siteRoot(port), { recursive: true, force: true });
  mutate((st) => { delete st.deploys[port]; });
  return { removed: Number(port) };
}

async function syncAll() {
  const s = load();
  const live = new Set(ctx.tunnels.list().map((t) => String(t.port)));
  for (const d of Object.values(s.deploys)) {
    if (!live.has(String(d.port))) {             // its tunnel was deleted from Burrow
      servers.get(String(d.port))?.close(); servers.delete(String(d.port));
      rmSync(siteRoot(d.port), { recursive: true, force: true });
      mutate((st) => { delete st.deploys[d.port]; });
      ctx.log(`${d.repo}: its tunnel is gone; files removed`);
      continue;
    }
    if (d.mode === "files") await sync(d.port).catch((e) => ctx.log(`${d.repo}: sync failed:`, e.message));
  }
}

// ------------------------------------------------------------------ the domain
let domainCache = null;
async function domainCheck(fresh) {
  if (!fresh && domainCache && now() - domainCache.at < 10 * 60 * 1000) return domainCache.v;
  const d = ctx.domain();
  let v;
  if (!d) v = { linked: false, eligible: false, setups: [], reason: "No domain is linked yet, so each site gets a random trycloudflare.com address. Link one under Settings → Domain for subdomains of your own." };
  else {
    let records = [], error = null;
    try { records = await ctx.dns(); } catch (e) { error = e.message; }
    v = { linked: true, eligible: !error, zone: d.zone, mainHost: d.mainHost, error, setups: detectSetups(records),
          reason: error ? `Burrow couldn't read ${d.zone}'s DNS records (${error}); sites still work.` : `Sites can live at NAME.${d.zone}.` };
  }
  domainCache = { at: now(), v };
  return v;
}
// accounts the domain points at join the list (unless you removed them)
async function adoptFromDomain() {
  const v = await domainCheck(true);
  for (const s of v.setups || []) {
    if (!s.account) continue;
    const id = `${s.provider}:${s.account.toLowerCase()}`, st = load();
    if (st.accounts.some((a) => a.id === id) || st.dismissed.includes(id)) continue;
    await addAccount({ provider: s.provider, username: s.account, source: "your domain" }).catch((e) => ctx.log("couldn't add", id, e.message));
  }
}

// ------------------------------------------------------------------ avatars (cached a day)
const avatars = new Map();
async function avatar(id) {
  const a = load().accounts.find((x) => x.id === id);
  if (!a?.avatar || !/^https:\/\/([a-z0-9-]+\.)*(githubusercontent\.com|gitlab\.com|gravatar\.com|gitlab-static\.net)\//.test(a.avatar)) return { status: 404, json: { error: "no avatar" } };
  const hit = avatars.get(id);
  if (hit && now() - hit.at < 864e5) return { status: 200, body: hit.body, type: hit.type };
  const r = await fetch(a.avatar + (a.avatar.includes("?") ? "&" : "?") + "s=64", { signal: AbortSignal.timeout(10000) }).catch(() => null);
  const type = r?.headers.get("content-type") || "";
  if (!r?.ok || !/^image\/(png|jpeg|gif|webp)/.test(type)) return { status: 404, json: { error: "no avatar" } };
  const body = Buffer.from(await r.arrayBuffer());
  if (body.length > 400000) return { status: 404, json: { error: "too big" } };
  avatars.set(id, { at: now(), body, type });
  return { status: 200, body, type };
}

// ------------------------------------------------------------------ the host's side
export async function start(c) {
  ctx = c; stopped = false;
  UA = `burrow-pages (Aegis × Burrow ${ctx.hostVersion})`;
  mkdirSync(join(ctx.dataDir, "sites"), { recursive: true, mode: 0o700 });
  const s = load();
  for (const d of Object.values(s.deploys)) {
    if (d.mode !== "files" || !current(d.port)) continue;
    const port = await serve(String(d.port), d.listen).catch((e) => { ctx.log(`${d.repo}:`, e.message); return null; });
    if (port && port !== d.listen) {
      mutate((st) => { st.deploys[d.port].listen = port; });
      await ctx.tunnels.update(d.port, { targetPort: port }).catch(() => {});
    }
  }
  adoptFromDomain().catch(() => {});
  syncTimer = setInterval(() => syncAll().catch(() => {}), SYNC_EVERY);
  setTimeout(() => syncAll().catch(() => {}), 20000);
}

export async function stop() {
  stopped = true;
  clearInterval(syncTimer);
  for (const srv of servers.values()) srv.close();
  servers.clear();
}

export async function handle({ method, path, query, json, unseal }) {
  const ok = (j) => ({ status: 200, json: j });
  const body = async () => (method === "GET" ? {} : (await json()) || {});
  if (path === "/state" && method === "GET") {
    const s = load();
    return ok({ accounts: s.accounts.map((a) => publicAccount(a, s)), deploys: Object.values(s.deploys),
                domain: await domainCheck(query.get("fresh") === "1"), device: deviceView(),
                github: { signIn: !!String(ctx.setting("GITHUB_CLIENT_ID") || "").trim() } });
  }
  if (path === "/domain" && method === "GET") return ok(await domainCheck(query.get("fresh") === "1"));
  // avatars come through here: the dashboard only loads images from itself
  let av = /^\/avatar\/([a-z]+:[A-Za-z0-9._\/-]+)$/.exec(decodeURIComponent(path));
  if (av && method === "GET") return avatar(av[1]);
  if (path === "/accounts" && method === "POST") return ok(await addAccount({ ...(await body()), source: "you" }));
  let m = /^\/accounts\/([a-z]+:[A-Za-z0-9._\/-]+)$/.exec(decodeURIComponent(path));
  if (m && method === "DELETE") return ok(removeAccount(m[1]));
  if (path === "/github/device" && method === "POST") return ok(await startDevice());
  if (path === "/github/device" && method === "GET") return ok(deviceView());
  if (path === "/github/device" && method === "DELETE") { device = null; return ok({ state: "none" }); }
  m = /^\/repos\/([a-z]+:[A-Za-z0-9._\/-]+)$/.exec(decodeURIComponent(path));
  if (m && method === "GET") return ok({ repos: await listRepos(m[1], query.get("fresh") === "1") });
  if (path === "/deploy" && method === "POST") {
    const b = await body();
    if (b.sealedPassword) { b.password = String((await unseal(b.sealedPassword)).password || ""); delete b.sealedPassword; }
    return ok(job(`Deploying ${b.repo || ""}`, (say) => deploy(b, say)));
  }
  m = /^\/jobs\/([0-9a-f]{12})$/.exec(path);
  if (m && method === "GET") { const j = jobs.get(m[1]); return j ? ok(j) : { status: 404, json: { error: "No such job." } }; }
  m = /^\/deploys\/(\d{1,5})(\/sync)?$/.exec(path);
  if (m && m[2] && method === "POST") return ok(await sync(m[1]));
  if (m && !m[2] && method === "DELETE") return ok(await undeploy(m[1]));
  return null;
}
