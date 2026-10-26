// The dashboard: Burrow Pages' own app, served under the gate's login at
// /__gate/pages (the gate's mount: it checks the sign-in, cuts the prefix
// off, and adds our key to every request it passes on).
//
// Its HTTP server listens on 127.0.0.1 only, and answers nothing without the
// key: whatever else runs on this machine can't use it. Requests that change
// something must also carry "X-Pages: 1" and come from the dashboard's own
// origin (another site can't make a browser send that header), so a link or
// form elsewhere can't act for you.

import { createServer } from "node:http";
import { readFileSync, createReadStream, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { createGzip } from "node:zlib";
import { PassThrough } from "node:stream";
import * as git from "./git.mjs";
import { detect, subFrom } from "./detect.mjs";
import { docker } from "./build.mjs";
import { parseHeaders, parseRedirects } from "./rules.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
          + "form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };

export function dashboard({ store, sites, ctx, key, publicDir, version }) {
  const files = new Map();
  const asset = (name) => {
    if (!/^[a-z0-9-]+\.(html|js|css|svg|png|woff2)$/.test(name)) return null;
    // kept in memory, read again when the file changes
    try {
      // the page's links carry the newest script/style time, so a browser never keeps an old copy
      const f = join(publicDir, name);
      const mt = name === "index.html" ? Math.max(...["index.html", "app.js", "app.css"].map((x) => statSync(join(publicDir, x)).mtimeMs)) : statSync(f).mtimeMs;
      const hit = files.get(name);
      if (hit && hit.mt === mt) return hit;
      const b = readFileSync(f);
      const tag = `${version}.${Math.floor(mt / 1000).toString(36)}`;
      const v = { mt, body: name === "index.html" ? Buffer.from(b.toString().replace(/\{\{V\}\}/g, version).replace(/\?v=[^"]+"/g, (x) => `?v=${tag}"`)) : b, type: TYPES[extname(name)] };
      files.set(name, v); return v;
    } catch { return null; }
  };
  const keyBuf = Buffer.from(key);
  const authed = (req) => { const k = Buffer.from(String(req.headers["x-burrow-pages-key"] || "")); return k.length === keyBuf.length && timingSafeEqual(k, keyBuf); };

  // ------------------------------------------------------------ accounts
  const dev = { flow: null };
  const accountView = (a) => ({ id: a.id, provider: a.provider, username: a.username, name: a.name, avatar: !!a.avatar, kind: a.kind, signedIn: !!store.token(a.id),
                                via: a.via || null, scopes: a.scopes || "", added: a.added, sites: store.sites().filter((s) => s.source?.account === a.id).length });
  async function addAccount(b) {
    const provider = b.provider === "gitlab" ? "gitlab" : "github";
    let info, token = null, via = null;
    if (b.token) {
      token = String(b.token).trim();
      if (!/^[A-Za-z0-9_\-.]{20,255}$/.test(token)) fail(400, "That doesn't look like a token.");
      info = await git.whoami(provider, token); via = "token";
    } else info = await git.lookup(provider, b.username);
    const id = `${provider}:${info.username.toLowerCase()}`;
    store.mutate((s) => {
      const old = s.accounts[id] || {};
      s.accounts[id] = { ...old, id, provider, username: info.username, name: info.name, avatar: info.avatar, kind: info.kind, glid: info.glid ?? old.glid,
                         added: old.added || Date.now(), via: token ? via : old.via || null, scopes: token ? info.scopes : old.scopes || "", self: token ? true : !!old.self };
      delete s.repoCache?.[id];
    });
    if (token) store.setToken(id, token);
    store.activity({ kind: "account", text: `${git.NAME[provider]} account ${info.username} ${token ? "signed in" : "added"}` });
    return accountView(store.s.accounts[id]);
  }
  function deviceView() { const d = dev.flow; return d ? { state: d.state, user_code: d.user_code, uri: d.uri, expires: d.expires, error: d.error, account: d.account } : { state: "none" }; }
  async function deviceStart() {
    const clientId = String(store.settings.githubClientId || ctx.setting?.("GITHUB_CLIENT_ID") || "").trim();
    const d = await git.deviceStart(clientId);
    dev.flow = { ...d, state: "pending", error: null, account: null };
    const loop = async (flow) => {
      while (dev.flow === flow && flow.state === "pending") {
        await new Promise((ok) => setTimeout(ok, flow.interval * 1000));
        if (dev.flow !== flow) return;
        if (Date.now() > flow.expires) { flow.state = "expired"; return; }
        try {
          const r = await git.devicePoll(flow);
          if (r.token) {
            const info = await git.whoami("github", r.token);
            const id = `github:${info.username.toLowerCase()}`;
            store.mutate((s) => { const old = s.accounts[id] || {}; s.accounts[id] = { ...old, id, provider: "github", username: info.username, name: info.name, avatar: info.avatar, kind: "user", added: old.added || Date.now(), via: "github sign-in", scopes: r.scopes, self: true }; delete s.repoCache?.[id]; });
            store.setToken(id, r.token);
            store.activity({ kind: "account", text: `Signed in to GitHub as ${info.username}` });
            flow.account = accountView(store.s.accounts[id]); flow.state = "done"; return;
          }
          if (r.slower) flow.interval += 5;
          if (r.error) { flow.state = "error"; flow.error = r.error; return; }
        } catch (e) { flow.error = e.message; }
      }
    };
    loop(dev.flow);
    return deviceView();
  }
  async function reposOf(id, fresh) {
    const a = store.s.accounts[id] || fail(404, "No such account.");
    const c = store.s.repoCache?.[id];
    if (!fresh && c && Date.now() - c.at < 30 * 60e3) return c.list;
    const list = await git.repos(a, store.token(id));
    store.mutate((s) => { s.repoCache ||= {}; s.repoCache[id] = { at: Date.now(), list }; });
    return list;
  }
  const accountFor = (id) => (id ? store.s.accounts[id] || fail(404, "No such account.") : null);

  // ------------------------------------------------------------ the API
  async function api(req, res, rawPath, q) {
    const m = req.method;
    // account ids carry ":" (github:me), which the page sends encoded
    let path = rawPath;
    try { path = decodeURIComponent(rawPath); } catch { fail(400, "Bad address."); }
    const body = async (max = 1024 * 1024) => {
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > max) fail(413, "That's too much."); chunks.push(c); }
      if (!n) return {};
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(400, "That isn't JSON."); }
    };
    let x;
    // ---- everything at once, for the overview
    if (path === "/state" && m === "GET") {
      const d = ctx.domain?.() || null;
      return { version, host: ctx.hostVersion, zone: d?.zone || null, mainHost: d?.mainHost || null,
               sites: store.sites().map((s) => sites.summary(s)).sort((a, b) => b.updated - a.updated),
               accounts: Object.values(store.s.accounts).map(accountView), settings: { ...store.settings, githubClientId: undefined },
               github: { signIn: !!String(store.settings.githubClientId || ctx.setting?.("GITHUB_CLIENT_ID") || "").trim() },
               docker: await docker(), jobs: [...sites.jobs.values()].filter((j) => j.state === "running" || j.state === "queued").map(sites.jobView),
               legacy: ctx.tunnels.list().filter((t) => t.kind === "site").map((t) => ({ port: t.port, name: t.name, url: t.url, target: t.target, access: t.access, enabled: t.enabled, sub: t.sub })) };
    }
    if (path === "/activity" && m === "GET") return { items: store.recent({ site: q.get("site") || undefined, limit: Math.min(500, Number(q.get("limit")) || 150) }) };
    if (path === "/check-sub" && m === "GET") {
      try { const sub = await sites.checkSub(q.get("sub")); const d = ctx.domain?.(); return { ok: true, sub, host: d ? `${sub}.${hostSuffix(ctx)}` : null }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    if (path === "/settings" && m === "GET") return { ...store.settings, githubClientId: store.settings.githubClientId || "" };
    if (path === "/settings" && m === "PATCH") {
      const b = await body();
      store.mutate((s) => {
        const S = s.settings;
        if ("keep" in b) S.keep = Math.max(1, Math.min(50, Number(b.keep) || 10));
        if ("access" in b) S.access = ["login", "password", "public"].includes(b.access) ? b.access : "login";
        if ("syncEvery" in b) S.syncEvery = Math.max(0, Math.min(1440, Number(b.syncEvery) || 0));
        if ("monitorEvery" in b) S.monitorEvery = Math.max(1, Math.min(60, Number(b.monitorEvery) || 5));
        if ("buildTimeout" in b) S.buildTimeout = Math.max(1, Math.min(60, Number(b.buildTimeout) || 15));
        if ("buildMemory" in b) S.buildMemory = Math.max(256, Math.min(8192, Number(b.buildMemory) || 1536));
        if ("notify" in b) S.notify = !!b.notify;
        if ("githubClientId" in b) { const c = String(b.githubClientId || "").trim(); if (c && !/^[A-Za-z0-9.]{8,64}$/.test(c)) fail(400, "That isn't a GitHub client ID."); S.githubClientId = c; }
      });
      store.activity({ kind: "settings", text: "Burrow Pages settings changed" });
      return store.settings;
    }
    if (path === "/export" && m === "GET") {
      const out = { burrowPages: version, exported: new Date().toISOString(), settings: { ...store.settings },
                    sites: store.sites().map(({ deploys, health, sync, current, listen, port, ...s }) => ({ ...s, source: s.source ? { ...s.source, etag: undefined } : undefined })),
                    accounts: Object.values(store.s.accounts).map(({ id, provider, username, kind }) => ({ id, provider, username, kind })) };
      return { _download: { name: `burrow-pages-${new Date().toISOString().slice(0, 10)}.json`, type: "application/json", body: JSON.stringify(out, null, 2) } };
    }

    // ---- accounts and repositories
    if (path === "/accounts" && m === "POST") return addAccount(await body());
    if ((x = /^\/accounts\/([a-z]+:[A-Za-z0-9._\/-]+)$/.exec(path)) && m === "DELETE") {
      const id = x[1], a = store.s.accounts[id] || fail(404, "No such account.");
      const using = store.sites().filter((s) => s.source?.account === id);
      store.mutate((s) => { delete s.accounts[id]; delete s.repoCache?.[id]; for (const site of using) s.sites[site.id].source.account = null; });
      store.setToken(id, null);
      store.activity({ kind: "account", text: `${git.NAME[a.provider]} account ${a.username} removed` });
      return { removed: id, sites: using.length, note: using.length ? `${using.length} site${using.length === 1 ? "" : "s"} now read${using.length === 1 ? "s" : ""} its repository without signing in (private ones will fail).` : null };
    }
    if ((x = /^\/accounts\/([a-z]+:[A-Za-z0-9._\/-]+)\/repos$/.exec(path)) && m === "GET") return { repos: await reposOf(x[1], q.get("fresh") === "1") };
    if ((x = /^\/accounts\/([a-z]+:[A-Za-z0-9._\/-]+)\/avatar$/.exec(path)) && m === "GET") return avatar(x[1]);
    if (path === "/github/device" && m === "POST") return deviceStart();
    if (path === "/github/device" && m === "GET") return deviceView();
    if (path === "/github/device" && m === "DELETE") { dev.flow = null; return { state: "none" }; }
    if (path === "/repo" && m === "GET") {
      const a = accountFor(q.get("account")), provider = a?.provider || (q.get("provider") === "gitlab" ? "gitlab" : "github"), token = a ? store.token(a.id) : null;
      const r = await git.repo(provider, q.get("repo") || "", token);
      const br = await git.branches(provider, r.full, token).catch(() => [r.branch]);
      const order = [...new Set(["gh-pages", "pages", r.branch].filter((b) => br.includes(b)))];
      return { repo: r, branches: br, suggested: order[0] || r.branch };
    }
    if (path === "/detect" && m === "GET") {
      const a = accountFor(q.get("account")), provider = a?.provider || (q.get("provider") === "gitlab" ? "gitlab" : "github"), token = a ? store.token(a.id) : null;
      const repo = q.get("repo") || "", branch = q.get("branch") || "";
      if (!git.REPO_RE.test(repo) || !git.BRANCH_RE.test(branch)) fail(400, "Pick a repository and a branch.");
      const t = await git.tree(provider, repo, branch, token);
      const sub = String(q.get("path") || "").replace(/^\/+|\/+$/g, "");
      const inSub = sub ? t.files.filter((f) => f.startsWith(sub + "/")).map((f) => f.slice(sub.length + 1)) : t.files;
      const pkg = inSub.includes("package.json") ? await git.fileText(provider, repo, branch, sub ? `${sub}/package.json` : "package.json", token) : null;
      const d = detect(inSub, pkg);
      const dirs = [...new Set(t.files.filter((f) => f.endsWith("/index.html") || f === "index.html").map((f) => f.replace(/\/?index\.html$/, "")))].slice(0, 30);
      return { ...d, files: t.files.length, truncated: t.truncated, indexDirs: dirs, sub: subFrom(repo) };
    }

    // ---- sites
    if (path === "/sites" && m === "POST") {
      const b = await body();
      if (b.type === "git" && b.source && !b.source.private && b.source.account) b.source.private = !!(await git.repo(store.s.accounts[b.source.account]?.provider || "github", b.source.repo, store.token(b.source.account)).catch(() => ({}))).private;
      return sites.create(b);
    }
    if (path === "/rules/check" && m === "POST") {
      const b = await body();
      const r = parseRedirects(b.redirects), h = parseHeaders(b.headers);
      return { redirects: r.rules.map(({ from, to, status, force }) => ({ from, to, status, force })), headers: h.blocks.map(({ path, headers }) => ({ path, headers })), errors: [...r.errors.map((e) => `Redirects, ${e}`), ...h.errors.map((e) => `Headers, ${e}`)] };
    }
    if ((x = /^\/legacy\/(\d{5})\/adopt$/.exec(path)) && m === "POST") return ctx.adopt(Number(x[1]), await body());
    x = /^\/sites\/(s[a-z0-9]{6,10})(\/.*)?$/.exec(path);
    if (x) {
      const id = x[1], sub = x[2] || "";
      const s = store.site(id) || fail(404, "No such site.");
      if (!sub && m === "GET") return sites.full(s);
      if (!sub && m === "PATCH") return sites.update(id, await body());
      if (!sub && m === "DELETE") return sites.remove(id);
      if (sub === "/deploy" && m === "POST") { const b = await body(); return { job: sites.deploy(id, { trigger: "manual", clearCache: !!b.clearCache }).id }; }
      if (sub === "/sync" && m === "POST") { await sites.syncOne(id); return sites.full(store.site(id)); }
      if (sub === "/check" && m === "POST") return { health: await sites.check(id) };
      if (sub === "/purge" && m === "POST") { const { cache } = await import("./proxy.mjs"); cache.clear(`${id}|`); store.activity({ site: id, kind: "settings", text: `${s.name}: cache emptied` }); return { ok: true }; }
      if (sub === "/rollback" && m === "POST") return sites.rollback(id, String((await body()).deploy || ""));
      if (sub === "/stats" && m === "GET") return sites.stats.view(id, [1, 7, 30, 90].includes(Number(q.get("days"))) ? Number(q.get("days")) : 7);
      if (sub === "/files" && m === "GET") return sites.files(id, q.get("deploy") || null, q.get("path") || "");
      if (sub === "/download" && m === "GET") { const r = sites.deployRoot(id, q.get("deploy") || null); return { _stream: tarGz(r.root), name: `${subFrom(r.name)}-${r.deploy}.tar.gz` }; }
      if ((x = /^\/deploys\/(d[a-z0-9]{6,12})(\/log)?$/.exec(sub))) {
        if (x[2] && m === "GET") return { _text: sites.log(id, x[1]) };
        if (!x[2] && m === "DELETE") return sites.dropDeploy(id, x[1]);
      }
      if (sub === "/upload/start" && m === "POST") return sites.startUpload(id);
      if (sub === "/upload/file" && m === "PUT") return sites.uploadFile(id, q.get("path") || "", req, Number(req.headers["content-length"] || 0));
      if (sub === "/upload/archive" && m === "PUT") return sites.uploadArchive(id, req);
      if (sub === "/upload/finish" && m === "POST") return { job: sites.finishUpload(id, await body()).id };
    }
    if ((x = /^\/jobs\/([a-z0-9]{6,12})$/.exec(path)) && m === "GET") { const j = sites.jobs.get(x[1]) || fail(404, "No such job."); return sites.jobView(j); }
    return null;
  }

  async function avatar(id) {
    const a = store.s.accounts[id];
    if (!a?.avatar || !/^https:\/\/([a-z0-9-]+\.)*(githubusercontent\.com|gitlab\.com|gravatar\.com|gitlab-static\.net)\//.test(a.avatar)) fail(404, "No picture.");
    const hit = avatars.get(id);
    if (hit && Date.now() - hit.at < 864e5) return { _bin: hit };
    const r = await fetch(a.avatar + (a.avatar.includes("?") ? "&" : "?") + "s=96", { signal: AbortSignal.timeout(10000) }).catch(() => null);
    const type = r?.headers.get("content-type") || "";
    if (!r?.ok || !/^image\/(png|jpeg|gif|webp)/.test(type)) fail(404, "No picture.");
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 500000) fail(404, "No picture.");
    const v = { at: Date.now(), body, type };
    avatars.set(id, v);
    return { _bin: v };
  }
  const avatars = new Map();

  // ------------------------------------------------------------ live updates (server-sent events)
  const streams = new Set();
  const push = (event, data) => { const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of streams) r.write(line); };
  let changeT = null; const changed = new Set();
  sites.on("job", (j) => push("job", j));
  sites.on("change", (id) => { changed.add(id); clearTimeout(changeT); changeT = setTimeout(() => { for (const i of changed) { const s = store.site(i); push("site", s ? sites.summary(s) : { id: i, removed: true }); } changed.clear(); }, 250); });
  const ping = setInterval(() => { for (const r of streams) r.write(": ping\n\n"); }, 25000);

  // ------------------------------------------------------------ the server
  const server = createServer(async (req, res) => {
    const sec = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "Cache-Control": "no-store" };
    const json = (status, v) => { res.writeHead(status, { ...sec, "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(v)); };
    if (!authed(req)) { res.writeHead(403, { ...sec, "Content-Type": "text/plain" }); return res.end("Open Burrow Pages from your dashboard."); }
    let url;
    try { url = new URL(req.url, "http://x"); } catch { return json(400, { error: "Bad address." }); }
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      // Changes only from the dashboard's own page. X-Pages is a header another site can't
      // make a browser send without a CORS preflight, which nothing here answers. Origin can't
      // be used (the gate rewrites it on the way in); Sec-Fetch-Site, when the browser sends it, can.
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers["x-pages"] !== "1") return json(403, { error: "Use the dashboard." });
        const site = String(req.headers["sec-fetch-site"] || "");
        if (site && site !== "same-origin" && site !== "none") return json(403, { error: "Not from this dashboard." });
      }
      if (path === "/api/events" && req.method === "GET") {
        res.writeHead(200, { ...sec, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
        res.write("retry: 3000\n\n");
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      try {
        const out = await api(req, res, path.slice(4), url.searchParams);
        if (out === null) return json(404, { error: "Not found." });
        if (out?._download) { res.writeHead(200, { ...sec, "Content-Type": out._download.type, "Content-Disposition": `attachment; filename="${out._download.name}"` }); return res.end(out._download.body); }
        if (out?._text !== undefined) { res.writeHead(200, { ...sec, "Content-Type": "text/plain; charset=utf-8" }); return res.end(out._text); }
        if (out?._bin) { res.writeHead(200, { ...sec, "Content-Type": out._bin.type, "Cache-Control": "private, max-age=86400" }); return res.end(out._bin.body); }
        if (out?._stream) { res.writeHead(200, { ...sec, "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${out.name}"` }); out._stream.on("error", () => res.destroy()).pipe(res); return; }
        return json(200, out);
      } catch (e) {
        if (!e.status) ctx.log("dashboard:", e.stack || e.message);
        return json(e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || "Something went wrong." });
      }
    }
    // the app itself
    const name = path === "/" ? "index.html" : path.slice(1);
    const a = asset(name);
    if (!a) return json(404, { error: "Not found." });
    res.writeHead(200, { ...sec, "Content-Type": a.type, "Content-Security-Policy": CSP, "Cache-Control": name === "index.html" ? "no-cache" : "public, max-age=31536000, immutable" });
    res.end(req.method === "HEAD" ? undefined : a.body);
  });
  server.keepAliveTimeout = 65000;
  server.on("close", () => clearInterval(ping));
  return server;
}

function hostSuffix(ctx) {
  const t = ctx.tunnels.list().find((x) => x.host && x.sub);
  return t ? t.host.slice(t.sub.length + 1) : ctx.domain?.()?.zone || "";
}

// A deploy's folder as a .tar.gz stream (for "Download")
export function tarGz(root) {
  const out = new PassThrough(), gz = createGzip({ level: 6 });
  gz.pipe(out);
  (async () => {
    const header = (name, size, mtime, type = "0") => {
      const h = Buffer.alloc(512);
      let n = name, prefix = "";
      if (Buffer.byteLength(n) > 100) { const i = n.lastIndexOf("/", 154); prefix = n.slice(0, i); n = n.slice(i + 1); }
      h.write(n, 0, 100); h.write(type === "5" ? "0000755\0" : "0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
      h.write(size.toString(8).padStart(11, "0") + "\0", 124); h.write(Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0", 136);
      h.write("        ", 148); h.write(type, 156); h.write("ustar\0" + "00", 257); h.write(prefix, 345, 155);
      let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
      return h;
    };
    const write = (b) => new Promise((ok) => { if (gz.write(b)) ok(); else gz.once("drain", ok); });
    const walk = async (dir, rel) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { await write(header(r + "/", 0, Date.now(), "5")); await walk(p, r); }
        else if (e.isFile()) {
          const st = statSync(p);
          await write(header(r, st.size, st.mtimeMs));
          for await (const c of createReadStream(p)) await write(c);
          const pad = (512 - (st.size % 512)) % 512; if (pad) await write(Buffer.alloc(pad));
        }
      }
    };
    try { await walk(root, ""); await write(Buffer.alloc(1024)); gz.end(); } catch (e) { gz.destroy(e); out.destroy(e); }
  })();
  return out;
}
