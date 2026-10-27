// Burrow Pages, inside Burrow.
//
// Burrow loads this while the addon is installed (forge-addon.json "burrow":
// {"extension"}), hands it a context (its data folder, its settings, the
// linked domain, the tunnels it made, the notice bell) and asks it for:
//
//   mount()    the dashboard, at /__gate/pages under the gate's login
//   handle()   a few routes for the card on the Burrow page and the scripts
//              (/__gate/api/x/burrow-pages/… and /x/burrow-pages/… on the socket)
//
// The rest lives in lib/: sites and deploys (sites.mjs), the file and proxy
// servers (serve.mjs, proxy.mjs), GitHub and GitLab (git.mjs), builds
// (build.mjs), the numbers (stats.mjs), the dashboard (app.mjs).

import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Store } from "../lib/store.mjs";
import { Stats } from "../lib/stats.mjs";
import { Sites, SERVING_DEFAULTS } from "../lib/sites.mjs";
import { dashboard } from "../lib/app.mjs";
import { setAgent } from "../lib/git.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "2.2.0";
// Aegis × Burrow 2.29 hands a tunnel's password to another ({lockFrom: PORT})
const handsOver = () => { const [a, b] = String(ctx?.hostVersion || "0").split(".").map(Number); return a > 2 || (a === 2 && b >= 29); };
let ctx = null, store = null, stats = null, sites = null, app = null;

// Burrow's control socket: the addon's scripts get it as $BURROW_SOCKET. The
// extension uses it for one thing the context doesn't offer: taking over an
// old "site" tunnel (Burrow's own Pages proxy) when you move it in here.
function socketPath() {
  // <gate data>/addons/burrow-pages/data -> <gate data>/control.sock
  const p = join(ctx.dataDir, "..", "..", "..", "control.sock");
  try { return realpathSync(p); } catch { return p; }
}
function control(method, path, body) {
  return new Promise((ok, no) => {
    const r = request({ socketPath: socketPath(), method, path, headers: { "content-type": "application/json", "x-burrow-client": `burrow-pages/${VERSION}` }, timeout: 20000 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* text */ } res.statusCode < 400 ? ok(j) : no(new Error(j?.error || `Burrow said ${res.statusCode}`)); });
    });
    r.on("error", no); r.on("timeout", () => r.destroy(new Error("Burrow didn't answer")));
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

// ------------------------------------------------------------------ 1.x -> 2.0
// 1.x kept accounts in a list (with the GitHub token inside) and its sites as
// "deploys" keyed by tunnel port, files in sites/<port>/. Accounts and their
// sign-ins carry over; sites served from files become repository sites with
// their files and tunnels; 1.x sites that proxied a Pages site were Burrow
// "site" tunnels and show up on the dashboard, ready to move in.
function migrate() {
  const s = store.s;
  if (!Array.isArray(s.accounts) && !s.deploys) return;
  const accounts = Array.isArray(s.accounts) ? s.accounts : [];
  const tokens = [];
  s.accounts = {};
  for (const a of accounts) {
    if (!a?.id) continue;
    if (a.token) tokens.push([a.id, a.token]);
    s.accounts[a.id] = { id: a.id, provider: a.provider, username: a.username, name: a.name || "", avatar: a.avatar || "", kind: a.kind || "user", glid: a.glid,
                         added: a.added || Date.now(), via: a.token ? "github sign-in" : null, scopes: a.scopes || "", self: !!a.token };
  }
  for (const d of Object.values(s.deploys || {})) {
    if (d.mode !== "files") continue;
    const id = `s${randomBytes(5).toString("hex").slice(0, 7)}`, dep = `d${randomBytes(5).toString("hex").slice(0, 7)}`;
    const old = join(ctx.dataDir, "sites", String(d.port));
    let cur = null; try { cur = realpathSync(join(old, "current")); } catch { /* none */ }
    const site = { id, name: d.repo.split("/").pop(), type: "git", port: d.port, listen: d.listen, access: "login", created: d.synced || Date.now(), updated: Date.now(),
                   source: { provider: d.provider, account: d.account, repo: d.repo, branch: d.branch, path: d.path === "/" ? "" : d.path || "", mode: "static", autoDeploy: true, syncEvery: null, private: !!d.private },
                   serving: { ...SERVING_DEFAULTS }, maintenance: { on: false }, deploys: [], current: null };
    if (cur) {
      mkdirSync(join(ctx.dataDir, "sites", id, "deploys"), { recursive: true, mode: 0o700 });
      renameSync(cur, join(ctx.dataDir, "sites", id, "deploys", dep));
      site.deploys = [{ id: dep, at: d.synced || Date.now(), state: "ready", trigger: "1.x", commit: { sha: d.commit || "", message: "carried over from Burrow Pages 1.x" } }];
      site.current = dep;
      sites.swap(id, dep);
    }
    rmSync(old, { recursive: true, force: true });
    s.sites[id] = site;
  }
  delete s.deploys; delete s.repos; delete s.dismissed;
  store.save();
  for (const [id, t] of tokens) store.setToken(id, t);
  store.activity({ kind: "settings", text: `Updated to Burrow Pages ${VERSION}: ${Object.keys(s.accounts).length} account${Object.keys(s.accounts).length === 1 ? "" : "s"} and ${Object.keys(s.sites).length} site${Object.keys(s.sites).length === 1 ? "" : "s"} carried over` });
}

export async function start(c) {
  ctx = c;
  // ASCII only: Node sends "×" as a raw Latin-1 byte, and GitLab answers that with a 500
  setAgent(`burrow-pages/${VERSION} (Aegis x Burrow ${String(ctx.hostVersion).replace(/[^\x20-\x7e]/g, "")})`);
  store = new Store(ctx.dataDir);
  stats = new Stats(join(ctx.dataDir, "stats"));
  sites = new Sites({ store, stats, ctx: { ...ctx, notify: ctx.notify }, dataDir: ctx.dataDir });
  migrate();
  // 1.x's leftovers: its per-port folders with nothing in them
  for (const f of existsSync(join(ctx.dataDir, "sites")) ? readdirSync(join(ctx.dataDir, "sites")) : []) if (/^\d+$/.test(f) || f.startsWith(".dl-")) rmSync(join(ctx.dataDir, "sites", f), { recursive: true, force: true });
  await sites.start();

  // the dashboard: a key of its own (the gate adds it to every request it passes on)
  if (!store.s.app?.key) store.mutate((s) => { s.app = { ...(s.app || {}), key: randomBytes(32).toString("hex") }; });
  const ext = { ...ctx, adopt, adoptPort, returnPort, adoptable };
  app = dashboard({ store, sites, ctx: ext, key: store.s.app.key, publicDir: join(HERE, "..", "public"), version: VERSION });
  const want = store.s.app.port || 0;
  await new Promise((ok, no) => {
    const tryListen = (p) => {
      app.once("error", (e) => (p ? tryListen(0) : no(e)));
      app.listen(p, "127.0.0.1", () => ok());
    };
    tryListen(want);
  });
  const port = app.address().port;
  if (port !== store.s.app.port) store.mutate((s) => { s.app.port = port; });
  ctx.log(`dashboard on 127.0.0.1:${port}, ${store.sites().length} site${store.sites().length === 1 ? "" : "s"}`);
}

// An old "site" tunnel (Burrow's own Pages proxy) -> a proxy site here, at the same
// address. access "keep" keeps its password: Burrow (2.29+) hands the hash over, the
// password itself is never seen. The old tunnel goes first: its address is the one the new one takes.
async function adopt(port, b = {}) {
  const t = ctx.tunnels.list().find((x) => x.port === Number(port) && x.kind === "site");
  if (!t) { const e = new Error("No such site tunnel."); e.status = 404; throw e; }
  const keep = b.access === "keep" || (!b.access && t.locked && t.access === "password");
  if (keep && !t.locked) { const e = new Error("That tunnel has no password to keep."); e.status = 400; throw e; }
  if (keep && !handsOver()) { const e = new Error("Keeping its password needs Aegis × Burrow 2.29 or newer: update it, or pick who can open it."); e.status = 409; throw e; }
  const access = keep ? "password" : ["login", "password", "public"].includes(b.access) ? b.access : "login";
  if (access === "password" && !keep && !b.password) { const e = new Error("Set a password for it."); e.status = 400; throw e; }
  await control("DELETE", `/tunnels/${t.port}`);
  try { return await sites.create({ type: "proxy", name: String(b.name || t.name || t.sub).slice(0, 60), sub: t.sub, access, password: keep ? undefined : b.password, lockFrom: keep ? t.port : undefined, proxy: { upstream: t.target, cacheSeconds: 60 } }); }
  catch (e) { ctx.log(`moving ${t.sub} in failed after its old tunnel was removed (${t.target}):`, e.message); throw e; }
}

// A port tunnel from Burrow's Tunnels tab -> a port site here, at the same address
// (its name, or its number when it has none) and with its password (handed over).
// The old tunnel goes first: its address is the one the new one takes; if the new
// site can't be made, the old tunnel is put back as it was.
const adoptable = (t) => (t.kind || "port") === "port" && !t.app;
async function adoptPort(port, b = {}) {
  const t = ctx.tunnels.list().find((x) => x.port === Number(port) && adoptable(x));
  if (!t) { const e = new Error("No such port tunnel (or it belongs to an addon)."); e.status = 404; throw e; }
  const keep = (b.access === "keep" || !b.access) && t.access === "password" && t.locked;
  if (keep && !handsOver()) { const e = new Error("Keeping its password needs Aegis × Burrow 2.29 or newer: update it, or pick who can open it."); e.status = 409; throw e; }
  const access = keep ? "password" : ["login", "password", "public"].includes(b.access) ? b.access : t.access === "password" ? "login" : t.access;
  if (access === "password" && !keep && !b.password) { const e = new Error("Set a password for it."); e.status = 400; throw e; }
  const target = { machine: "this", host: t.targetHost || "127.0.0.1", port: t.targetPort || t.port, scheme: t.scheme === "https" ? "https" : "http", insecure: true, keepHost: !!t.preserveHost };
  sites.cleanTarget(target);                                    // fails before anything changes
  await control("DELETE", `/tunnels/${t.port}`);
  try {
    return await sites.create({ type: "port", name: String(b.name || t.name || t.sub || `Port ${t.port}`).slice(0, 60), sub: t.sub || undefined, tunnelPort: t.sub ? undefined : t.port,
                                access, password: keep ? undefined : b.password, lockFrom: keep ? t.port : undefined, target });
  } catch (e) {
    await control("POST", "/tunnels", { port: t.port, targetHost: t.targetHost, targetPort: t.targetPort, scheme: t.scheme, sub: t.sub || undefined, name: t.name || "",
                                        preserveHost: !!t.preserveHost, access: t.access, ...(t.access === "password" && t.locked ? { lockFrom: t.port } : {}) }).catch(() => {});
    throw e;
  }
}
// ...and back: a plain tunnel in the Tunnels tab again, same address, same password
async function returnPort(id) {
  const s = store.site(id);
  if (!s || s.type !== "port") { const e = new Error("Only a port site can go back to the Tunnels tab."); e.status = 400; throw e; }
  if (s.target.machine !== "this") { const e = new Error("A port of another machine stays here: the Tunnels tab can't reach other machines."); e.status = 400; throw e; }
  const t = sites.tunnelOf(s);
  const sub = t?.sub || null;
  // its key: its own number when it has no name (that number is its address), else the port it points at
  const key = sub ? s.target.port : s.port;
  if (sub && ctx.tunnels.list().some((x) => x.port === key && x.port !== s.port)) { const e = new Error(`Burrow already has a tunnel on port ${key}.`); e.status = 409; throw e; }
  const spec = { port: key, targetHost: s.target.host, targetPort: s.target.port, scheme: s.target.scheme, sub: sub || undefined, name: s.name,
                 preserveHost: !!s.target.keepHost, access: t?.access || s.access, ...(t?.locked && t.access === "password" ? { lockFrom: s.port } : {}) };
  await sites.remove(id);
  await control("POST", "/tunnels", spec);
  return { returned: key };
}

export async function stop() {
  await sites?.stop();
  await new Promise((ok) => { if (!app) return ok(); app.close(() => ok()); app.closeAllConnections?.(); setTimeout(ok, 2000); });
  app = null;
}

export function mount() {
  if (!app?.listening || !store?.s.app?.key) return null;
  return { prefix: "/__gate/pages", upstream: `http://127.0.0.1:${app.address().port}`, headers: { "x-burrow-pages-key": store.s.app.key },
           name: "Burrow Pages", tile: { text: "Your static sites: from GitHub, GitLab, an upload, or anywhere." } };
}

// The card on the Burrow page and the scripts
export async function handle({ method, path, json }) {
  const ok = (j) => ({ status: 200, json: j });
  if (path === "/summary" && method === "GET") {
    const list = store.sites().map((s) => sites.summary(s)).sort((a, b) => b.updated - a.updated);
    return ok({ version: VERSION, sites: list, app: !!app?.listening,
                jobs: [...sites.jobs.values()].filter((j) => j.state === "running").length,
                legacy: ctx.tunnels.list().filter((t) => t.kind === "site").length });
  }
  if (path === "/status" && method === "GET") {
    const all = store.sites(), on = all.filter((s) => !s.paused).length, down = all.filter((s) => s.health && !s.health.ok && !s.paused).length;
    return ok({ sites: all.length, on, down, dashboard: "/__gate/pages/" });
  }
  if (path === "/pause-all" && method === "POST") { let n = 0; for (const s of store.sites()) if (!s.paused) { await sites.update(s.id, { paused: true }); n++; } return ok({ paused: n }); }
  if (path === "/resume-all" && method === "POST") { let n = 0; for (const s of store.sites()) if (s.paused) { await sites.update(s.id, { paused: false }); n++; } return ok({ resumed: n }); }
  if (path === "/check-all" && method === "POST") {
    await sites.checkAll();
    return ok({ sites: store.sites().map((s) => ({ name: s.name, ok: !!s.health?.ok, error: s.health?.error || null, url: sites.tunnelOf(s)?.url || null })) });
  }
  // move an old site tunnel in: {port, access, password?, name?}
  if (path === "/adopt" && method === "POST") { const b = (await json()) || {}; const out = await adopt(b.port, b); return ok({ site: out.site }); }
  if (path === "/sites" && method === "GET") return ok({ sites: store.sites().map((s) => sites.summary(s)) });
  if (path === "/adopt-port" && method === "POST") { const b = (await json()) || {}; const out = await adoptPort(b.port, b); return ok({ site: out.site }); }
  if (path === "/return-port" && method === "POST") return ok(await returnPort(String(((await json()) || {}).site || "")));
  if (path === "/sync-all" && method === "POST") { for (const s of store.sites()) if (s.type === "git") await sites.syncOne(s.id); return ok({ ok: true }); }
  return null;
}
