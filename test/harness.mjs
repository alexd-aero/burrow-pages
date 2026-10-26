// A stand-in for Aegis × Burrow, for trying Burrow Pages without a real gate:
// it loads the extension with a context like the gate's, mounts the dashboard
// at /__gate/pages, and gives each tunnel a port of its own on BIND.
//
//   BIND=127.0.0.1 PORT=4390 DATA=/tmp/bp-harness node test/harness.mjs
//
// Not shipped behaviour: no login, no TLS. For development only.

import { createServer, request } from "node:http";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ext from "../burrow/extension.mjs";

const BIND = process.env.BIND || "127.0.0.1", PORT = Number(process.env.PORT || 4390);
const ROOT = process.env.DATA || "/tmp/bp-harness";
if (process.env.FRESH === "1") rmSync(ROOT, { recursive: true, force: true });
const dataDir = join(ROOT, "data", "addons", "burrow-pages", "data");
mkdirSync(dataDir, { recursive: true });

const tunnels = new Map();         // port -> tunnel (kept in tunnels.json, as the gate keeps its own)
const TFILE = join(ROOT, "tunnels.json");
try { for (const t of JSON.parse(readFileSync(TFILE, "utf8"))) tunnels.set(t.port, t); } catch { /* none yet */ }
const saveT = () => writeFileSync(TFILE, JSON.stringify([...tunnels.values()]));
const fronts = new Map();          // port -> public listener
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const zone = "pages.test";
const pubPort = (t) => 20000 + (t.port % 10000);
function summary(t) { return { ...t, url: `http://${BIND}:${pubPort(t)}`, host: `${t.sub}.${zone}`, kind: t.kind || "port", target: t.site ? t.site.url : `http://${t.targetHost}:${t.targetPort}`, totals: {}, online: 0, locked: !!t.password }; }
function front(t) {
  if (fronts.has(t.port)) return;
  const srv = createServer((req, res) => {
    const cur = tunnels.get(t.port);
    if (!cur || !cur.enabled) { res.writeHead(404); return res.end("tunnel off"); }
    const up = request({ host: cur.targetHost, port: cur.targetPort, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress, "x-forwarded-host": req.headers.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(e.message); });
    req.pipe(up);
  });
  srv.listen(pubPort(t), BIND);
  fronts.set(t.port, srv);
}
const ctx = {
  id: "burrow-pages", hostVersion: "2.28.1-harness", dataDir, root: process.cwd(),
  log: (...a) => log("burrow-pages:", ...a),
  notify: (n) => log("NOTICE", n.level, n.title, "-", n.body),
  setting: (k) => (k === "GITHUB_CLIENT_ID" ? "Ov23liJcQorPMpS9k8BX" : ""),
  domain: () => ({ mainHost: `dash.${zone}`, zone, managed: true }),
  dns: async () => [],
  tunnels: {
    list: () => [...tunnels.values()].map(summary),
    create: async (spec) => {
      if (tunnels.has(spec.port)) throw new Error(`tunnel-${spec.port} already exists.`);
      if ([...tunnels.values()].some((t) => t.sub === spec.sub)) throw new Error(`${spec.sub} is taken.`);
      const t = { port: spec.port, targetHost: spec.targetHost, targetPort: spec.targetPort, sub: spec.sub, name: spec.name, access: spec.access || "login", password: !!spec.password, enabled: true, app: "burrow-pages", meta: spec.meta, created: Date.now() };
      tunnels.set(t.port, t); saveT(); front(t); log("tunnel created", t.port, "->", t.targetPort, t.sub, t.access);
      return summary(t);
    },
    update: async (port, p) => {
      const t = tunnels.get(port); if (!t) throw new Error("No such tunnel.");
      if (t.app !== "burrow-pages") throw new Error("That tunnel isn't this addon's.");
      if (p.sub && [...tunnels.values()].some((x) => x.sub === p.sub && x.port !== port)) throw new Error(`${p.sub} is taken.`);
      Object.assign(t, p, p.password ? { password: true } : {}); saveT(); log("tunnel updated", port, JSON.stringify(p).replace(/"password":"[^"]*"/, '"password":"…"'));
      return summary(t);
    },
    remove: async (port) => { const t = tunnels.get(port); if (t?.app !== "burrow-pages") throw new Error("That tunnel isn't this addon's."); tunnels.delete(port); saveT(); fronts.get(port)?.close(); fronts.delete(port); log("tunnel removed", port); return { removed: port }; },
  },
};
// an old "site" tunnel (Burrow's own Pages proxy), to try moving one in
for (const t of tunnels.values()) if (t.kind !== "site") front(t);
if (process.env.LEGACY && !tunnels.has(70001) && ![...tunnels.values()].some((t) => t.sub === "chat-demo-edu")) tunnels.set(70001, { port: 70001, kind: "site", sub: "chat-demo-edu", name: "Private", access: "password", password: true, enabled: true, app: null, site: { url: process.env.LEGACY }, targetHost: "x", targetPort: 443 });
// the control socket, for that move
const sock = join(ROOT, "data", "control.sock");
if (existsSync(sock)) rmSync(sock);
createServer((req, res) => {
  const m = /^\/tunnels\/(\d+)$/.exec(req.url);
  if (m && req.method === "DELETE") { tunnels.delete(Number(m[1])); saveT(); log("control: removed", m[1]); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ removed: Number(m[1]) })); }
  res.writeHead(404); res.end("{}");
}).listen(sock);

await ext.start(ctx);
const m = ext.mount();
log("dashboard upstream", m.upstream);
createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" ) { res.writeHead(302, { location: "/__gate/pages/" }); return res.end(); }
  if (!u.pathname.startsWith(m.prefix)) { res.writeHead(404); return res.end("harness: only /__gate/pages"); }
  const mm = ext.mount(), up = new URL(mm.upstream);
  const path = req.url.slice(mm.prefix.length) || "/";
  // as the gate's proxyMount does: Host and Origin become the upstream's, Referer goes
  const hdr = { ...req.headers, ...mm.headers, "x-forwarded-host": req.headers.host, host: up.host };
  if (hdr.origin) hdr.origin = `http://${up.host}`;
  delete hdr.referer;
  const r = request({ host: up.hostname, port: up.port, method: req.method, path, headers: hdr }, (x) => {
    const h = { ...x.headers }; if (typeof h.location === "string" && h.location.startsWith("/")) h.location = mm.prefix + h.location;
    res.writeHead(x.statusCode, h); x.pipe(res);
  });
  r.on("error", (e) => { res.writeHead(502); res.end(e.message); });
  req.pipe(r);
}).listen(PORT, BIND, () => log(`harness: http://${BIND}:${PORT}/__gate/pages/`));
process.on("SIGTERM", async () => { await ext.stop(); process.exit(0); });
process.on("SIGINT", async () => { await ext.stop(); process.exit(0); });
