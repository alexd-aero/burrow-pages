// Sites: what they are, their deploys, and keeping them up.
//
//   git      a GitHub or GitLab repository: its files as they are, or built in a
//            container; every push deployed (or only when you say)
//   upload   a folder, .zip or .tar.gz you drop on the dashboard
//   proxy    a site that lives elsewhere, answering on your address
//
// Every deploy is a folder of its own (sites/<id>/deploys/<deploy>), and
// "current" points at the one being served: switching, and rolling back, is
// one rename. The last N deploys are kept.
//
// Each site has a server on 127.0.0.1 (lib/serve.mjs or lib/proxy.mjs) and a
// Burrow tunnel in front of it, on your wildcard: login, password or public.

import { EventEmitter } from "node:events";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import * as git from "./git.mjs";
import { build as runBuild, docker, dropCache, OUTPUT_RE } from "./build.mjs";
import { detect, CONTENT_DIRS, subFrom } from "./detect.mjs";
import { untar, unzip, sniff, safeName, ArchiveError } from "./archive.mjs";
import { siteServer } from "./serve.mjs";
import { proxyServer, parseUpstream, probe, cache as proxyCache } from "./proxy.mjs";
import { parseHeaders, parseRedirects } from "./rules.mjs";

const PORT_BASE = 47600;
const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
const rid = (n = 6) => randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n + 2).toLowerCase();
const now = () => Date.now();

export const SERVING_DEFAULTS = { spa: false, cleanUrls: true, trailingSlash: true, notFound: "", redirects: "", headers: "", frame: "sameorigin",
                                  noindex: false, csp: "", compress: true, maxAge: 3600 };

export class Sites extends EventEmitter {
  constructor({ store, stats, ctx, dataDir }) {
    super();
    this.setMaxListeners(100);
    Object.assign(this, { store, stats, ctx, dataDir });
    this.root = join(dataDir, "sites");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.servers = new Map();        // site id -> http server
    this.jobs = new Map();           // job id -> job
    this.queue = new Map();          // site id -> promise chain (one job at a time per site)
    this.builds = Promise.resolve(); // one build at a time on this machine
    this.timers = [];
  }

  // ---------------------------------------------------------------- views
  tunnelOf(s) { return s?.port ? this.ctx.tunnels.list().find((t) => t.port === s.port) || null : null; }
  summary(s) {
    const t = this.tunnelOf(s), d = (s.deploys || []).find((x) => x.id === s.current) || null;
    const last = (s.deploys || [])[0] || null;
    return {
      id: s.id, name: s.name, type: s.type, created: s.created, updated: s.updated,
      url: t?.url || null, host: t?.host || null, sub: t?.sub || s.sub || null, access: t?.access || s.access, enabled: t ? t.enabled : false,
      tunnel: !!t, paused: !!s.paused, maintenance: !!s.maintenance?.on,
      source: s.type === "git" ? { provider: s.source.provider, repo: s.source.repo, branch: s.source.branch, mode: s.source.mode, autoDeploy: s.source.autoDeploy !== false, private: !!s.source.private }
            : s.type === "proxy" ? { upstream: s.proxy?.upstream } : { upload: true },
      current: d ? { id: d.id, at: d.at, sha: d.commit?.sha || null, message: d.commit?.message || d.note || "", files: d.files, bytes: d.bytes } : null,
      last: last ? { id: last.id, state: last.state, at: last.at, error: last.error || null } : null,
      health: s.health || null, busy: this.busy(s.id),
      spark: this.stats.spark(s.id), today: this.stats.today(s.id),
    };
  }
  full(s) {
    const t = this.tunnelOf(s);
    return { ...this.summary(s), source: s.source || null, proxy: s.proxy || null, serving: { ...SERVING_DEFAULTS, ...(s.serving || {}) },
             maintenance: s.maintenance || { on: false }, deploys: s.deploys || [], sync: s.sync || null,
             tunnelInfo: t ? { port: t.port, url: t.url, host: t.host, access: t.access, locked: t.locked, enabled: t.enabled, totals: t.totals, online: t.online, dns: t.dns, created: t.created } : null,
             rules: this.ruleCheck(s), storage: this.storageOf(s), jobs: [...this.jobs.values()].filter((j) => j.site === s.id).slice(-5).map(this.jobView) };
  }
  ruleCheck(s) {
    const r = parseRedirects(s.serving?.redirects), h = parseHeaders(s.serving?.headers);
    return { redirects: r.rules.length, headers: h.blocks.length, errors: [...r.errors.map((e) => `Redirects, ${e}`), ...h.errors.map((e) => `Headers, ${e}`)] };
  }
  storageOf(s) {
    let bytes = 0;
    for (const d of s.deploys || []) bytes += d.bytes || 0;
    return { deploys: (s.deploys || []).filter((d) => d.state === "ready").length, bytes };
  }
  busy(id) { return [...this.jobs.values()].some((j) => j.site === id && j.state === "running"); }

  // ---------------------------------------------------------------- jobs
  jobView = (j) => ({ id: j.id, site: j.site, kind: j.kind, label: j.label, state: j.state, phase: j.phase, started: j.started, ended: j.ended, error: j.error, log: j.log.slice(-400), result: j.result });
  job(site, kind, label, work) {
    const j = { id: rid(8), site, kind, label, state: "queued", phase: "Waiting for the job before it", log: [], started: now(), ended: null, error: null, result: null };
    this.jobs.set(j.id, j);
    for (const [k, v] of this.jobs) if (v.state !== "running" && v.state !== "queued" && now() - v.started > 6 * 3600e3) this.jobs.delete(k);
    const say = (line) => {
      const l = String(line).slice(0, 400);
      j.phase = l.trim().startsWith("$") || line.startsWith("  ") ? j.phase : l;
      j.log.push(`${new Date().toISOString().slice(11, 19)}  ${l}`);
      if (j.log.length > 5000) j.log.splice(0, j.log.length - 5000);
      this.emit("job", this.jobView(j));
    };
    const prev = this.queue.get(site) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      j.state = "running"; j.started = now(); this.emit("job", this.jobView(j));
      try { j.result = await work(say, j); j.state = "done"; }
      catch (e) { j.state = "failed"; j.error = e.message; say(`✗ ${e.message}`); }
      finally { j.ended = now(); this.emit("job", this.jobView(j)); this.emit("change", site); }
    });
    this.queue.set(site, run);
    return j;
  }

  // ---------------------------------------------------------------- servers and ports
  dir(id) { return join(this.root, id); }
  currentDir(id) { try { return realpathSync(join(this.dir(id), "current")); } catch { return null; } }
  usedPorts() { return new Set([...this.ctx.tunnels.list().map((t) => t.port), ...this.ctx.tunnels.list().map((t) => t.targetPort), ...this.store.sites().map((s) => s.listen)]); }
  async listen(s) {
    const old = this.servers.get(s.id);
    if (old?.listening) return old.address().port;
    const srv = s.type === "proxy"
      ? proxyServer({ site: () => this.store.site(s.id), onHit: (r) => this.stats.hit(s.id, r), onUpstream: () => {} })
      : siteServer({ site: () => this.store.site(s.id), root: () => this.currentDir(s.id), onHit: (r) => this.stats.hit(s.id, r) });
    const used = this.usedPorts();
    const tryPort = (p) => new Promise((ok) => {
      const bad = () => { srv.off("listening", good); ok(false); };
      const good = () => { srv.off("error", bad); ok(true); };
      srv.once("error", bad); srv.once("listening", good);
      srv.listen(p, "127.0.0.1");
    });
    const candidates = [s.listen, ...Array.from({ length: 400 }, (_, i) => PORT_BASE + i)].filter(Boolean);
    for (const p of candidates) {
      if (p !== s.listen && used.has(p)) continue;
      if (await tryPort(p)) {
        this.servers.set(s.id, srv);
        if (p !== s.listen) this.store.mutate((st) => { if (st.sites[s.id]) st.sites[s.id].listen = p; });
        return p;
      }
    }
    fail(503, "No free port on this machine for the site's server.");
  }
  close(id) { const srv = this.servers.get(id); if (srv) { srv.close(); srv.closeAllConnections?.(); } this.servers.delete(id); }

  // ---------------------------------------------------------------- tunnels
  async checkSub(sub, exceptPort) {
    sub = String(sub || "").trim().toLowerCase();
    if (!SUB_RE.test(sub)) fail(400, "An address is letters, digits and dashes (like docs or my-site), up to 63.");
    const taken = this.ctx.tunnels.list().find((t) => t.sub === sub && t.port !== exceptPort);
    if (taken) fail(409, `${sub} is already in use${taken.name ? ` (by ${taken.name})` : ""}.`);
    return sub;
  }
  async makeTunnel(s, { access, password, lockFrom }) {
    const listen = await this.listen(s);
    const t = await this.ctx.tunnels.create({ port: listen, targetHost: "127.0.0.1", targetPort: listen, scheme: "http", name: s.name.slice(0, 60),
                                             sub: s.sub, access, password, ...(lockFrom ? { lockFrom } : {}), preserveHost: false, meta: { site: s.id, type: s.type } });
    this.store.mutate((st) => { Object.assign(st.sites[s.id], { port: t.port, listen, access: t.access }); delete st.sites[s.id].sub; });
    return t;
  }

  // ---------------------------------------------------------------- creating
  async create(spec) {
    const type = ["git", "upload", "proxy"].includes(spec.type) ? spec.type : fail(400, "Pick what the site is: a repository, an upload, or a site elsewhere.");
    const name = String(spec.name || "").trim().slice(0, 60) || fail(400, "Give the site a name.");
    const sub = await this.checkSub(spec.sub);
    const access = ["login", "password", "public"].includes(spec.access) ? spec.access : this.store.settings.access;
    if (access === "password" && !String(spec.password || "") && !spec.lockFrom) fail(400, "Set the site's password.");
    const id = `s${rid(7)}`;
    const s = { id, name, type, sub, access, created: now(), updated: now(), deploys: [], current: null, serving: { ...SERVING_DEFAULTS, ...cleanServing(spec.serving || {}) }, maintenance: { on: false } };
    if (type === "git") s.source = await this.cleanSource(spec.source || {});
    if (type === "proxy") s.proxy = cleanProxy(spec.proxy || {});
    this.store.mutate((st) => { st.sites[id] = s; });
    this.store.activity({ site: id, kind: "created", text: `${name} created (${type === "git" ? s.source.repo : type === "proxy" ? s.proxy.upstream : "upload"})` });
    try {
      const t = await this.makeTunnel(s, { access, password: spec.password, lockFrom: spec.lockFrom });
      if (type === "proxy") {
        // a proxy has nothing to deploy: it is live once its tunnel is
        this.store.mutate((st) => { st.sites[id].health = null; });
        this.check(id).catch(() => {});
        return { site: this.summary(this.store.site(id)), tunnel: t };
      }
      if (type === "upload") return { site: this.summary(this.store.site(id)), tunnel: t };
      const j = this.deploy(id, { trigger: "create" });
      return { site: this.summary(this.store.site(id)), job: j.id };
    } catch (e) {
      this.close(id);
      this.store.mutate((st) => { delete st.sites[id]; });
      rmSync(this.dir(id), { recursive: true, force: true });
      throw e;
    }
  }

  async cleanSource(src, old = {}) {
    const provider = src.provider === "gitlab" ? "gitlab" : src.provider === "github" ? "github" : old.provider || fail(400, "GitHub or GitLab?");
    const repo = String(src.repo ?? old.repo ?? "");
    if (!git.REPO_RE.test(repo)) fail(400, "Pick a repository.");
    const account = src.account ?? old.account ?? null;
    if (account && !this.store.s.accounts[account]) fail(400, "That account isn't connected any more.");
    const branch = String(src.branch ?? old.branch ?? "");
    if (!git.BRANCH_RE.test(branch)) fail(400, "Pick a branch.");
    const path = String(src.path ?? old.path ?? "").replace(/^\/+|\/+$/g, "");
    if (path && !safeName(path)) fail(400, "The folder must be a path inside the repository.");
    const mode = (src.mode ?? old.mode) === "build" ? "build" : "static";
    const out = { provider, account, repo, branch, path, mode, autoDeploy: (src.autoDeploy ?? old.autoDeploy) !== false,
                  syncEvery: src.syncEvery === null || src.syncEvery === "" ? null : Number.isFinite(Number(src.syncEvery ?? old.syncEvery)) ? Math.max(0, Math.min(1440, Number(src.syncEvery ?? old.syncEvery))) : null,
                  private: !!(src.private ?? old.private) };
    if (mode === "build") {
      const b = { ...(old.build || {}), ...(src.build || {}) };
      const image = String(b.image || "node:22-alpine").trim(), output = String(b.output || "dist").replace(/^\/+|\/+$/g, ""), command = String(b.command || "").trim();
      if (!/^[a-z0-9][a-z0-9._\/-]{0,127}(?::[A-Za-z0-9._-]{1,128})?$/.test(image)) fail(400, "That build image name doesn't look right.");
      if (!OUTPUT_RE.test(output)) fail(400, "The output folder must be a path inside the repository, like dist.");
      if (!command || command.length > 2000) fail(400, "Give the build a command.");
      const env = {};
      for (const [k, v] of Object.entries(b.env || {})) { if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) fail(400, `${k} isn't an environment variable name.`); env[k] = String(v).slice(0, 4000); }
      if (Object.keys(env).length > 50) fail(400, "That's a lot of variables (50 at most).");
      out.build = { image, command, output, env, framework: b.framework || null };
    }
    return out;
  }

  // ---------------------------------------------------------------- changing
  async update(id, p) {
    const s = this.store.site(id) || fail(404, "No such site.");
    const t = this.tunnelOf(s);
    const tp = {};
    if ("name" in p) { const n = String(p.name || "").trim().slice(0, 60); if (!n) fail(400, "A site needs a name."); tp.name = n; }
    if ("sub" in p && p.sub !== t?.sub) tp.sub = await this.checkSub(p.sub, s.port);
    if ("access" in p || p.password) {
      const access = ["login", "password", "public"].includes(p.access) ? p.access : t?.access || s.access;
      if (access === "password" && !p.password && !t?.locked) fail(400, "Set a password for it.");
      tp.access = access; if (p.password) tp.password = String(p.password);
    }
    if ("paused" in p) tp.enabled = !p.paused;
    let source = null, proxy = null;
    if (p.source && s.type === "git") source = await this.cleanSource(p.source, s.source);
    if (p.proxy && s.type === "proxy") proxy = cleanProxy({ ...s.proxy, ...p.proxy });
    if (t && Object.keys(tp).length) await this.ctx.tunnels.update(s.port, tp);
    const changed = [];
    this.store.mutate((st) => {
      const x = st.sites[id];
      if (tp.name) { x.name = tp.name; changed.push("name"); }
      if ("access" in tp) { x.access = tp.access; changed.push(tp.password ? "password" : "access"); }
      if (tp.sub) changed.push("address");
      if ("paused" in p) { x.paused = !!p.paused; changed.push(p.paused ? "paused" : "resumed"); }
      if (source) {
        const rebuild = ["repo", "branch", "path", "mode", "provider"].some((k) => source[k] !== x.source[k]) || JSON.stringify(source.build) !== JSON.stringify(x.source.build);
        x.source = { ...source, etag: rebuild ? null : x.source.etag };
        changed.push("source");
        if (rebuild) x.needsDeploy = true;
      }
      if (proxy) { x.proxy = proxy; proxyCache.clear(`${id}|`); changed.push("upstream"); }
      if (p.serving) { x.serving = { ...SERVING_DEFAULTS, ...(x.serving || {}), ...cleanServing(p.serving) }; changed.push("serving"); }
      if (p.maintenance) { x.maintenance = { on: !!p.maintenance.on, title: String(p.maintenance.title || "").slice(0, 120), message: String(p.maintenance.message || "").slice(0, 600) }; changed.push(x.maintenance.on ? "maintenance on" : "maintenance off"); }
      x.updated = now();
    });
    if (changed.length) this.store.activity({ site: id, kind: "settings", text: `${s.name}: ${changed.join(", ")} changed` });
    const x = this.store.site(id);
    let job = null;
    if (x.needsDeploy && p.deploy !== false) { this.store.mutate((st) => { delete st.sites[id].needsDeploy; }); job = this.deploy(id, { trigger: "settings" }).id; }
    this.emit("change", id);
    return { site: this.full(x), job };
  }

  async remove(id, { keepTunnel } = {}) {
    const s = this.store.site(id) || fail(404, "No such site.");
    if (s.port && !keepTunnel) await this.ctx.tunnels.remove(s.port).catch((e) => { if (!/No such/i.test(e.message)) throw e; });
    this.close(id);
    rmSync(this.dir(id), { recursive: true, force: true });
    this.stats.drop(id);
    proxyCache.clear(`${id}|`);
    if (s.type === "git" && s.source?.mode === "build") dropCache(id);
    this.store.mutate((st) => { delete st.sites[id]; });
    this.store.activity({ site: id, kind: "removed", text: `${s.name} removed` });
    this.emit("change", id);
    return { removed: id };
  }

  // ---------------------------------------------------------------- deploying
  deploy(id, { trigger = "manual", ref, clearCache } = {}) {
    const s = this.store.site(id) || fail(404, "No such site.");
    if (s.type !== "git") fail(400, s.type === "proxy" ? "A site elsewhere has nothing to deploy." : "Upload new files to deploy this site.");
    return this.job(id, "deploy", `Deploy ${s.name}`, (say) => this.deployGit(id, { trigger, ref, clearCache }, say));
  }

  async deployGit(id, { trigger, ref, clearCache }, say) {
    const s = this.store.site(id), src = s.source;
    const token = src.account ? this.store.token(src.account) : null;
    const dep = { id: `d${rid(7)}`, at: now(), state: "building", trigger, mode: src.mode, branch: src.branch };
    this.record(id, dep);
    const t0 = now();
    const work = join(this.dir(id), `.work-${dep.id}`);
    try {
      say(`Looking at ${src.repo}@${src.branch}`);
      const head = ref ? { sha: ref, message: "", author: "" } : await git.head(src.provider, src.repo, src.branch, token);
      dep.commit = { sha: head.sha, message: head.message, author: head.author, date: head.date, url: head.url };
      say(`Commit ${head.sha.slice(0, 7)}${head.message ? `: ${head.message}` : ""}${head.author ? ` (${head.author})` : ""}`);
      say(`Downloading ${src.repo}`);
      mkdirSync(work, { recursive: true, mode: 0o700 });
      const repoDir = join(work, "repo");
      const stream = await git.tarball(src.provider, src.repo, head.sha, token);
      const got = await untar(stream, repoDir, { strip: 1 });
      say(`  ${got.files} files, ${mb(got.bytes)}`);
      let site;
      if (src.mode === "build") {
        if (clearCache) { say("Clearing the build cache"); await dropCache(id); }
        say(`Building with ${src.build.image}`);
        const out = join(work, "out");
        const prior = this.builds;
        let release; this.builds = new Promise((ok) => (release = ok));
        await prior.catch(() => {});
        try {
          const r = await runBuild({ src: src.path ? join(repoDir, src.path) : repoDir, out, id: `${id}-${dep.id}`.toLowerCase(), cacheKey: id, image: src.build.image, command: src.build.command,
                                     output: src.build.output, env: src.build.env, memory: this.store.settings.buildMemory, timeout: this.store.settings.buildTimeout }, say);
          dep.buildSeconds = r.seconds;
        } finally { release(); }
        site = out;
      } else {
        site = src.path ? join(repoDir, src.path) : repoDir;
        if (!existsSync(site)) fail(400, `${src.path}/ isn't in ${src.repo}@${src.branch}.`);
        if (!existsSync(join(site, "index.html"))) {
          const guess = CONTENT_DIRS.find((d) => d && existsSync(join(repoDir, d, "index.html")));
          say(`⚠ No index.html in ${src.path || "the top folder"}${guess ? ` (there is one in ${guess}/: set the folder to ${guess} in the site's settings)` : ""}.`);
        }
      }
      await this.publish(id, dep, site, say);
      dep.seconds = Math.round((now() - t0) / 1000);
      this.store.mutate((st) => { const x = st.sites[id]; if (x) { x.sync = { ...(x.sync || {}), at: now(), sha: head.sha, error: null }; } });
      this.record(id, dep);
      this.store.activity({ site: id, kind: "deploy", text: `${s.name} deployed ${head.sha.slice(0, 7)}${head.message ? ` “${head.message.slice(0, 80)}”` : ""} (${trigger})`, deploy: dep.id });
      return { deploy: dep.id, url: this.tunnelOf(this.store.site(id))?.url || null };
    } catch (e) {
      dep.state = "failed"; dep.error = e.message; dep.seconds = Math.round((now() - t0) / 1000);
      this.record(id, dep);
      this.store.activity({ site: id, kind: "failed", text: `${s.name}: deploy failed: ${e.message}`, deploy: dep.id });
      this.alert(id, `${s.name}: a deploy failed`, e.message, `deploy-${id}`);
      throw e;
    } finally {
      rmSync(work, { recursive: true, force: true });
      this.saveLog(id, dep.id);
    }
  }

  // a finished folder -> a deploy that is served
  async publish(id, dep, from, say) {
    // a deploy holds plain files only: a build's output (docker cp) may carry links, which could point anywhere
    const links = dropLinks(from);
    if (links) say(`Left out ${links} link${links === 1 ? "" : "s"} (a site is served from plain files only)`);
    const files = countFiles(from);
    if (!files.n) fail(400, "There is nothing to serve: the folder is empty.");
    const dest = join(this.dir(id), "deploys", dep.id);
    mkdirSync(join(this.dir(id), "deploys"), { recursive: true, mode: 0o700 });
    renameSync(from, dest);
    Object.assign(dep, { state: "ready", files: files.n, bytes: files.bytes, hasIndex: existsSync(join(dest, "index.html")),
                         has404: existsSync(join(dest, "404.html")), rules: { redirects: existsSync(join(dest, "_redirects")), headers: existsSync(join(dest, "_headers")) } });
    say(`Publishing ${files.n} files (${mb(files.bytes)})`);
    this.swap(id, dep.id);
    this.store.mutate((st) => { const x = st.sites[id]; if (x) { x.current = dep.id; x.updated = now(); } });
    this.record(id, dep);
    this.prune(id);
    if (!this.servers.get(id)?.listening) await this.listen(this.store.site(id));
    const t = this.tunnelOf(this.store.site(id));
    say(`✓ Live${t?.url ? ` at ${t.url}` : ""}`);
  }

  swap(id, depId) {
    const link = join(this.dir(id), "current"), tmp = `${link}.${now()}`;
    symlinkSync(join("deploys", depId), tmp);
    renameSync(tmp, link);
  }
  record(id, dep) {
    this.store.mutate((st) => {
      const x = st.sites[id]; if (!x) return;
      x.deploys = [dep, ...(x.deploys || []).filter((d) => d.id !== dep.id)].slice(0, 60);
    });
    this.emit("change", id);
  }
  prune(id) {
    const keep = Math.max(1, Number(this.store.settings.keep) || 10);
    const s = this.store.site(id); if (!s) return;
    const ready = (s.deploys || []).filter((d) => d.state === "ready");
    const drop = ready.slice(keep).filter((d) => d.id !== s.current);
    for (const d of drop) rmSync(join(this.dir(id), "deploys", d.id), { recursive: true, force: true });
    if (drop.length) this.store.mutate((st) => { for (const d of st.sites[id].deploys) if (drop.some((x) => x.id === d.id)) { d.state = "pruned"; } });
  }
  saveLog(id, depId) {
    const j = [...this.jobs.values()].reverse().find((x) => x.site === id);
    if (!j) return;
    try { mkdirSync(join(this.dir(id), "logs"), { recursive: true, mode: 0o700 }); writeFileSync(join(this.dir(id), "logs", `${depId}.log`), j.log.join("\n") + "\n", { mode: 0o600 }); } catch { /* */ }
  }
  log(id, depId) {
    if (!/^d[a-z0-9]{6,12}$/.test(depId)) fail(400, "No such deploy.");
    try { return readFileSync(join(this.dir(id), "logs", `${depId}.log`), "utf8"); } catch { fail(404, "That deploy's log is gone."); }
  }

  rollback(id, depId) {
    const s = this.store.site(id) || fail(404, "No such site.");
    const d = (s.deploys || []).find((x) => x.id === depId && x.state === "ready") || fail(404, "That deploy isn't kept any more.");
    if (!existsSync(join(this.dir(id), "deploys", depId))) fail(404, "That deploy's files are gone.");
    this.swap(id, depId);
    this.store.mutate((st) => {
      const x = st.sites[id]; x.current = depId; x.updated = now();
      // a newer push would undo the rollback: stop following pushes until you say
      if (x.type === "git" && x.source.autoDeploy !== false) { x.source.autoDeploy = false; x.source.pausedByRollback = true; }
    });
    this.store.activity({ site: id, kind: "rollback", text: `${s.name} rolled back to ${d.commit?.sha?.slice(0, 7) || d.id}${s.type === "git" ? "; deploying pushes is paused" : ""}`, deploy: depId });
    this.emit("change", id);
    return { current: depId };
  }
  dropDeploy(id, depId) {
    const s = this.store.site(id) || fail(404, "No such site.");
    if (s.current === depId) fail(409, "That's the deploy being served. Roll back to another first.");
    rmSync(join(this.dir(id), "deploys", depId), { recursive: true, force: true });
    rmSync(join(this.dir(id), "logs", `${depId}.log`), { force: true });
    this.store.mutate((st) => { st.sites[id].deploys = st.sites[id].deploys.filter((d) => d.id !== depId); });
    this.emit("change", id);
    return { removed: depId };
  }

  // ---------------------------------------------------------------- uploads
  // a staging folder files arrive in, one request each (folder uploads), or one archive
  uploadDir(id) { return join(this.dir(id), ".upload"); }
  async uploadFile(id, rel, stream, size) {
    const s = this.store.site(id) || fail(404, "No such site.");
    if (s.type !== "upload") fail(400, "This site isn't deployed from uploads.");
    const name = safeName(rel);
    if (!name || name.split("/").some((p) => p.startsWith(".") && p !== ".well-known")) return { skipped: rel };
    if (size > 200 * 1024 * 1024) fail(413, `${name} is over 200 MB.`);
    const dest = join(this.uploadDir(id), "files", name);
    mkdirSync(join(dest, ".."), { recursive: true, mode: 0o755 });
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    let n = 0;
    stream.on("data", (c) => { n += c.length; if (n > 200 * 1024 * 1024) stream.destroy(new Error("too big")); });
    await pipeline(stream, createWriteStream(dest, { mode: 0o644 }));
    return { saved: name, bytes: n };
  }
  async uploadArchive(id, stream) {
    const s = this.store.site(id) || fail(404, "No such site.");
    if (s.type !== "upload") fail(400, "This site isn't deployed from uploads.");
    const dir = this.uploadDir(id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "archive");
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    let n = 0;
    stream.on("data", (c) => { n += c.length; if (n > 1024 * 1024 * 1024) stream.destroy(new Error("The archive is over 1 GB.")); });
    await pipeline(stream, createWriteStream(file, { mode: 0o600 }));
    return { bytes: n };
  }
  startUpload(id) { const dir = this.uploadDir(id); rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dir, "files"), { recursive: true, mode: 0o700 }); return { ok: true }; }
  finishUpload(id, { note } = {}) {
    const s = this.store.site(id) || fail(404, "No such site.");
    return this.job(id, "deploy", `Deploy ${s.name}`, async (say) => {
      const dir = this.uploadDir(id), dep = { id: `d${rid(7)}`, at: now(), state: "building", trigger: "upload", note: String(note || "").slice(0, 120) || "Uploaded files" };
      this.record(id, dep);
      const t0 = now();
      try {
        let from = join(dir, "files");
        const archive = join(dir, "archive");
        if (existsSync(archive)) {
          const kind = await sniff(archive);
          if (!kind) fail(400, "That file isn't a .zip, .tar.gz or .tar.");
          say(`Unpacking the ${kind === "zip" ? ".zip" : kind === "tgz" ? ".tar.gz" : ".tar"}`);
          from = join(dir, "unpacked");
          const r = kind === "zip" ? await unzip(archive, from) : await untar(createReadStream(archive), from, { gzip: kind === "tgz", strip: 0 });
          say(`  ${r.files} files, ${mb(r.bytes)}`);
          // a single folder holding everything (a tar of a folder): serve what's inside it
          const top = readdirSync(from);
          if (top.length === 1 && statSync(join(from, top[0])).isDirectory() && !existsSync(join(from, "index.html"))) from = join(from, top[0]);
        }
        if (!existsSync(from)) fail(400, "Nothing was uploaded.");
        const guess = !existsSync(join(from, "index.html")) && CONTENT_DIRS.find((d) => d && existsSync(join(from, d, "index.html")));
        if (guess) { say(`Serving ${guess}/ (it holds the index.html)`); from = join(from, guess); }
        await this.publish(id, dep, from, say);
        dep.seconds = Math.round((now() - t0) / 1000);
        this.record(id, dep);
        this.store.activity({ site: id, kind: "deploy", text: `${s.name} deployed from an upload (${dep.files} files)`, deploy: dep.id });
        return { deploy: dep.id };
      } catch (e) {
        dep.state = "failed"; dep.error = e instanceof ArchiveError ? `The archive ${e.message}.` : e.message; this.record(id, dep);
        this.store.activity({ site: id, kind: "failed", text: `${s.name}: upload failed: ${dep.error}`, deploy: dep.id });
        throw new Error(dep.error);
      } finally { rmSync(dir, { recursive: true, force: true }); this.saveLog(id, dep.id); }
    });
  }

  // ---------------------------------------------------------------- files of a deploy
  files(id, depId, rel = "") {
    const s = this.store.site(id) || fail(404, "No such site.");
    const d = depId || s.current;
    if (!d || !/^d[a-z0-9]{6,12}$/.test(d)) fail(404, "No deploy yet.");
    const root = join(this.dir(id), "deploys", d);
    const name = rel ? safeName(rel) : "";
    if (name === null) fail(400, "Bad path.");
    const dir = join(root, name || "");
    let real; try { real = realpathSync(dir); } catch { fail(404, "No such folder."); }
    if (real !== realpathSync(root) && !real.startsWith(realpathSync(root) + sep)) fail(400, "Bad path.");
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { fail(404, "No such folder."); }
    return { deploy: d, path: name || "", entries: list.filter((e) => e.isFile() || e.isDirectory()).slice(0, 2000).map((e) => {
      let size = 0, n = 0;
      if (e.isFile()) try { size = statSync(join(dir, e.name)).size; } catch { /* */ }
      else { const c = countFiles(join(dir, e.name), 20000); size = c.bytes; n = c.n; }
      return { name: e.name, dir: e.isDirectory(), size, files: n };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)) };
  }
  deployRoot(id, depId) {
    const s = this.store.site(id) || fail(404, "No such site.");
    const d = depId || s.current;
    if (!d || !/^d[a-z0-9]{6,12}$/.test(d)) fail(404, "No deploy yet.");
    const root = join(this.dir(id), "deploys", d);
    if (!existsSync(root)) fail(404, "That deploy's files are gone.");
    return { root, deploy: d, name: s.name };
  }

  // ---------------------------------------------------------------- following pushes
  async syncOne(id) {
    const s = this.store.site(id);
    if (!s || s.type !== "git" || s.paused || this.busy(id)) return;
    const src = s.source, token = src.account ? this.store.token(src.account) : null;
    try {
      const h = await git.head(src.provider, src.repo, src.branch, token, src.etag || null);
      this.store.mutate((st) => { const x = st.sites[id]; if (x) { x.sync = { ...(x.sync || {}), checked: now(), error: null }; if (h.etag) x.source.etag = h.etag; } });
      if (h.notModified) return;
      const cur = (s.deploys || []).find((d) => d.id === s.current);
      const lastTried = (s.deploys || [])[0];
      if (cur?.commit?.sha === h.sha) return;
      if (lastTried?.commit?.sha === h.sha && lastTried.state === "failed") return;      // don't retry a failed commit forever
      this.store.mutate((st) => { if (st.sites[id]) st.sites[id].sync.pending = h.sha; });
      this.emit("change", id);
      if (src.autoDeploy !== false) this.deploy(id, { trigger: "push" });
    } catch (e) {
      this.store.mutate((st) => { const x = st.sites[id]; if (x) x.sync = { ...(x.sync || {}), checked: now(), error: e.message }; });
    }
  }
  async syncAll() {
    const every = Number(this.store.settings.syncEvery) || 0;
    for (const s of this.store.sites()) {
      if (s.type !== "git") continue;
      const m = s.source.syncEvery == null ? every : s.source.syncEvery;
      if (!m) continue;
      if (now() - (s.sync?.checked || 0) < m * 60e3 - 5000) continue;
      await this.syncOne(s.id);
      await new Promise((ok) => setTimeout(ok, 400));
    }
  }

  // ---------------------------------------------------------------- health
  async check(id) {
    const s = this.store.site(id); if (!s) return null;
    const t = this.tunnelOf(s);
    let r;
    if (s.type === "proxy") r = await probe(s.proxy.upstream).catch((e) => ({ ok: false, error: e.message }));
    else {
      const port = this.servers.get(id)?.address()?.port, t0 = now();
      if (!port) r = { ok: false, error: "its server isn't running" };
      else if (!s.current) r = { ok: true, status: 0, ms: 0, note: "no deploy yet" };
      else {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "user-agent": "burrow-pages (health check)" }, signal: AbortSignal.timeout(8000), redirect: "manual" });
          await res.body?.cancel();
          r = { ok: res.status < 500, status: res.status, ms: now() - t0 };
        } catch (e) { r = { ok: false, error: e.cause?.code || e.message, ms: now() - t0 }; }
      }
    }
    const was = s.health;
    const h = { ok: !!r.ok, status: r.status || 0, ms: r.ms || 0, error: r.error || null, at: now(),
                since: was && was.ok === !!r.ok ? was.since : now(), checks: ((was?.checks || []).concat(r.ok ? 1 : 0)).slice(-288) };
    this.store.mutate((st) => { if (st.sites[id]) st.sites[id].health = h; });
    if (was && was.ok && !h.ok && t?.enabled && !s.paused) this.alert(id, `${s.name} is down`, s.type === "proxy" ? `${s.proxy.upstream} isn't answering (${r.error || `HTTP ${r.status}`}).` : `Its server didn't answer (${r.error || `HTTP ${r.status}`}).`, `down-${id}`, "warn");
    if (was && !was.ok && h.ok) this.store.activity({ site: id, kind: "up", text: `${s.name} is answering again` });
    else if (was && was.ok && !h.ok) this.store.activity({ site: id, kind: "down", text: `${s.name} stopped answering: ${r.error || `HTTP ${r.status}`}` });
    this.emit("change", id);
    return h;
  }
  async checkAll() { for (const s of this.store.sites()) { if (!s.paused) await this.check(s.id).catch(() => {}); } }
  alert(id, title, body, key, level = "warn") {
    if (!this.store.settings.notify) return;
    try { this.ctx.notify?.({ level, title, body, key, link: `/__gate/pages/#/site/${id}` }); } catch { /* the bell is optional */ }
  }

  // ---------------------------------------------------------------- start and stop
  async start() {
    for (const s of this.store.sites()) {
      // a deploy cut short by a restart
      if ((s.deploys || []).some((d) => d.state === "building")) this.store.mutate((st) => { for (const d of st.sites[s.id].deploys) if (d.state === "building") { d.state = "failed"; d.error = "Interrupted by a restart."; } });
      rmSync(join(this.dir(s.id), ".upload"), { recursive: true, force: true });
      for (const f of (existsSync(this.dir(s.id)) ? readdirSync(this.dir(s.id)) : [])) if (f.startsWith(".work-")) rmSync(join(this.dir(s.id), f), { recursive: true, force: true });
      try {
        const port = await this.listen(s);
        const t = this.tunnelOf(s);
        if (t && t.targetPort !== port) await this.ctx.tunnels.update(s.port, { targetHost: "127.0.0.1", targetPort: port }).catch((e) => this.ctx.log(`${s.name}: couldn't point its tunnel at ${port}:`, e.message));
        if (!t) this.ctx.log(`${s.name}: its tunnel is gone (removed in Burrow?); it stays here until you remove it`);
      } catch (e) { this.ctx.log(`${s.name}:`, e.message); }
    }
    this.timers.push(setInterval(() => this.syncAll().catch(() => {}), 60e3));
    this.timers.push(setInterval(() => this.checkAll().catch(() => {}), Math.max(1, Number(this.store.settings.monitorEvery) || 5) * 60e3));
    this.timers.push(setInterval(() => this.stats.flush(), 60e3));
    setTimeout(() => { this.syncAll().catch(() => {}); this.checkAll().catch(() => {}); }, 15000);
  }
  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.stats.flush();
    for (const id of [...this.servers.keys()]) this.close(id);
  }
}

// ------------------------------------------------------------------ helpers
export function cleanServing(v) {
  const out = {};
  if ("spa" in v) out.spa = !!v.spa;
  if ("cleanUrls" in v) out.cleanUrls = !!v.cleanUrls;
  if ("trailingSlash" in v) out.trailingSlash = !!v.trailingSlash;
  if ("noindex" in v) out.noindex = !!v.noindex;
  if ("compress" in v) out.compress = !!v.compress;
  if ("frame" in v) out.frame = ["sameorigin", "deny", "allow"].includes(v.frame) ? v.frame : "sameorigin";
  if ("maxAge" in v) out.maxAge = Math.max(0, Math.min(31536000, Number(v.maxAge) || 0));
  if ("notFound" in v) { const p = String(v.notFound || "").trim(); if (p && !/^\/[A-Za-z0-9._\/-]{1,200}$/.test(p)) fail(400, "The not-found page is a path, like /404.html."); out.notFound = p; }
  if ("csp" in v) { const c = String(v.csp || "").trim(); if (/[\r\n]/.test(c) || c.length > 4000) fail(400, "That Content-Security-Policy can't be sent."); out.csp = c; }
  if ("redirects" in v) { const t = String(v.redirects || ""); if (t.length > 100000) fail(400, "Too many redirects."); out.redirects = t; }
  if ("headers" in v) { const t = String(v.headers || ""); if (t.length > 100000) fail(400, "Too many headers."); out.headers = t; }
  return out;
}
export function cleanProxy(p) {
  const up = parseUpstream(p.upstream);
  return { upstream: up.url, cacheSeconds: Math.max(0, Math.min(86400, Number(p.cacheSeconds) || 0)), rewriteLinks: !!p.rewriteLinks,
           forwardIp: !!p.forwardIp, timeout: Math.max(5, Math.min(120, Number(p.timeout) || 30)) };
}
export function countFiles(dir, cap = 1e7) {
  let n = 0, bytes = 0;
  const walk = (d) => {
    let list = [];
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (n >= cap) return;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { n++; try { bytes += statSync(p).size; } catch { /* */ } }
    }
  };
  walk(dir);
  return { n, bytes };
}
// every symlink under dir removed (not followed); returns how many
export function dropLinks(dir) {
  let n = 0;
  const walk = (d) => {
    let list = [];
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) { rmSync(p, { force: true }); n++; }
      else if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return n;
}
export const mb = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
export { subFrom, detect, docker, sep };
