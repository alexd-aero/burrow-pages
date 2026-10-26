// A site's file server: 127.0.0.1 only, behind the site's tunnel. It serves
// the deploy that "current" points at, as a static host does:
//
//   /about        about.html, or about/index.html (clean URLs)
//   _redirects    and the dashboard's redirects: 301/302/…, 200 rewrites, splats
//   _headers      and the dashboard's headers, per path
//   SPA mode      unknown paths get /index.html (client-side routers)
//   404.html      the site's own "not found" page
//   maintenance   a 503 page while you work on it
//   compression   brotli or gzip (precompressed .br/.gz files first)
//   caching       ETag + 304; hashed build files cached for a year; HTML always checked
//   ranges        for video and audio
//
// Never served: dotfiles (.env, .git…) except /.well-known/, the rule files
// themselves, anything outside the deploy (links included). GET and HEAD only.

import { createServer } from "node:http";
import { createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { brotliCompress, gzip, constants as Z } from "node:zlib";
import { promisify } from "node:util";
import { headersFor, isHashed, matchRedirect, parseHeaders, parseRedirects } from "./rules.mjs";

const br = promisify(brotliCompress), gz = promisify(gzip);

export const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".rss": "application/rss+xml",
  ".atom": "application/atom+xml", ".csv": "text/csv; charset=utf-8", ".ics": "text/calendar; charset=utf-8", ".yaml": "text/yaml; charset=utf-8", ".yml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp", ".apng": "image/apng",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf", ".zip": "application/zip", ".wasm": "application/wasm",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg", ".mov": "video/quicktime", ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".opus": "audio/opus",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".txt.gz": "application/gzip",
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|rss\+xml|atom\+xml|manifest\+json|wasm|vnd\.ms-fontobject)|image\/(svg\+xml|x-icon|bmp)|font\/(ttf|otf)|model\/gltf\+json)/;

// compressed copies, kept in memory: 64 MB in all
class Lru {
  constructor(max) { this.max = max; this.size = 0; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (v) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k, v) {
    if (v.length > this.max / 8) return;
    const old = this.m.get(k); if (old) { this.m.delete(k); this.size -= old.length; }
    this.m.set(k, v); this.size += v.length;
    for (const [key, val] of this.m) { if (this.size <= this.max) break; this.m.delete(key); this.size -= val.length; }
  }
}
const zipped = new Lru(64 * 1024 * 1024);
const zipping = new Map();             // key -> promise: one compression per file at a time, however many ask
const ZIP_MAX = 4 * 1024 * 1024;       // bigger files go out uncompressed (or precompressed)

export const MAINTENANCE = (title, msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b0c0e;color:#e9eaec;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
main{max-width:460px;text-align:center}.dot{width:12px;height:12px;border-radius:50%;background:#f2c14e;margin:0 auto 22px;box-shadow:0 0 0 6px rgba(242,193,78,.15);animation:p 2s ease-in-out infinite}
h1{font-size:22px;margin:0 0 8px;font-weight:650}p{margin:0;color:#9a9ea6}@keyframes p{50%{box-shadow:0 0 0 12px rgba(242,193,78,.04)}}</style></head>
<body><main><div class="dot"></div><h1>${title}</h1><p>${msg}</p></main></body></html>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The client's address: the gate is the only thing that talks to us, and says who it is for
export const clientIp = (req) => {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const remote = req.socket.remoteAddress || "";
  return xf && /^(127\.|::1$|::ffff:127\.)/.test(remote) ? xf : remote;
};

// site(): the site's current settings (read on every request: changes apply at once)
// root(): the deploy folder being served, or null
// onHit(r): for the visitor numbers
export function siteServer({ site, root, onHit }) {
  let rulesFor = null, rules = null;
  const loadRules = (dir, s) => {
    const key = `${dir}|${s.serving?.redirects || ""}|${s.serving?.headers || ""}`;
    if (rulesFor === key) return rules;
    const read = (f) => { try { const p = realpathSync(join(dir, f)); if (!p.startsWith(dir + sep)) return ""; const st = statSync(p); return st.isFile() && st.size < 512 * 1024 ? readFileSync(p, "utf8") : ""; } catch { return ""; } };
    const rd = [...parseRedirects(s.serving?.redirects, "dashboard").rules, ...parseRedirects(read("_redirects")).rules];
    const hd = [...parseHeaders(read("_headers")).blocks, ...parseHeaders(s.serving?.headers, "dashboard").blocks];
    rulesFor = key; rules = { redirects: rd, headers: hd };
    return rules;
  };

  async function handle(req, res) {
    const t0 = Date.now();
    let status = 200, bytes = 0, path = "/";
    const s = site();
    const finish = () => { try { onHit?.({ path, status, bytes, ms: Date.now() - t0, ip: clientIp(req), ua: req.headers["user-agent"] || "", referer: req.headers.referer || "", host: String(req.headers.host || "").split(":")[0], method: req.method }); } catch { /* numbers are a nicety */ } };
    res.on("finish", finish);
    const sv = s?.serving || {};
    const base = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };
    if (sv.frame !== "allow") base["X-Frame-Options"] = sv.frame === "deny" ? "DENY" : "SAMEORIGIN";
    if (sv.noindex) base["X-Robots-Tag"] = "noindex, nofollow";
    if (sv.csp) base["Content-Security-Policy"] = sv.csp;
    const end = (code, text, extra = {}) => {
      status = code;
      const body = req.method === "HEAD" ? undefined : text;
      bytes = text ? Buffer.byteLength(text) : 0;
      res.writeHead(code, { ...base, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra });
      res.end(body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return end(405, "Only GET and HEAD.", { Allow: "GET, HEAD" });
    let url;
    // "http://x" + the path, not new URL(path, base): "//_headers" would read as a host name
    try { url = new URL("http://x" + (String(req.url).startsWith("/") ? req.url : "/" + req.url)); path = decodeURIComponent(url.pathname); } catch { return end(400, "Bad address."); }
    if (path.includes("\0") || path.includes("\\") || path.length > 2048) return end(400, "Bad address.");
    if (s?.maintenance?.on) {
      status = 503;
      const html = MAINTENANCE(esc(s.maintenance.title || "Back soon"), esc(s.maintenance.message || "This site is being worked on. Try again in a little while."));
      bytes = Buffer.byteLength(html);
      res.writeHead(503, { ...base, "Content-Type": "text/html; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    const dir = root();
    if (!dir) return end(503, "This site has no deploy yet. Try again in a moment.");
    const R = loadRules(dir, s);
    const inside = (p) => p === dir || p.startsWith(dir + sep);
    // judged on the path inside the deploy, after resolving: "/_headers/", "//_headers" and "/x/../_headers" are all /_headers
    const hidden = (abs) => {
      const rel = abs.slice(dir.length).split(sep).filter(Boolean);
      return rel.some((seg, i) => seg.startsWith(".") && !(i === 0 && seg === ".well-known" && rel.length > 1)) || (rel.length === 1 && /^_(redirects|headers)$/.test(rel[0]));
    };
    // the file a path means, or null
    const fileOf = (p) => {
      const abs = resolve(dir, "." + p);
      if (!inside(abs) || hidden(abs)) return null;
      const tryFile = (f) => { try { const st = statSync(f); if (st.isFile()) { const real = realpathSync(f); return inside(real) ? { file: real, st } : null; } } catch { /* none */ } return null; };
      let st = null;
      try { st = statSync(abs); } catch { /* none */ }
      if (st?.isDirectory()) return tryFile(join(abs, "index.html")) ? { ...tryFile(join(abs, "index.html")), dir: true } : null;
      return tryFile(abs) || (!extname(abs) && sv.cleanUrls !== false ? tryFile(abs + ".html") || tryFile(abs + ".htm") : null);
    };

    // redirects and rewrites first (a real file wins unless the rule says !)
    let target = path;
    const rd = matchRedirect(R.redirects, path, (p) => !!fileOf(p));
    if (rd) {
      if (rd.status === 200) target = rd.to.split("?")[0];
      else if (rd.status === 404 || rd.status === 410 || rd.status === 451) { target = rd.to.split("?")[0]; status = rd.status; }
      else return end(rd.status, `Moved to ${rd.to}`, { Location: rd.to + (url.search && !rd.to.includes("?") ? url.search : ""), "Cache-Control": rd.status === 301 || rd.status === 308 ? "public, max-age=3600" : "no-cache" });
    }
    let hit = fileOf(target);
    if (hit?.dir && !target.endsWith("/") && sv.trailingSlash !== false) return end(301, "Moved.", { Location: url.pathname + "/" + url.search });
    if (!hit && sv.spa && !extname(target)) hit = fileOf("/index.html");
    if (!hit) {
      const nf = fileOf(sv.notFound || "/404.html");
      if (!nf) return end(404, "Not found.");
      hit = nf; status = 404;
    }
    const { file, st } = hit;
    const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const head = { ...base, "Content-Type": type, ETag: etag, "Last-Modified": new Date(st.mtimeMs).toUTCString(), "Accept-Ranges": "bytes", Vary: "Accept-Encoding" };
    head["Cache-Control"] = status !== 200 ? "no-cache" : /^text\/html/.test(type) ? "no-cache" : isHashed(file) ? "public, max-age=31536000, immutable" : `public, max-age=${Math.max(0, Number(sv.maxAge ?? 3600))}`;
    for (const [k, v] of Object.entries(headersFor(R.headers, path))) head[k.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase())] = v;
    if (status === 200 && (req.headers["if-none-match"] === etag || (!req.headers["if-none-match"] && req.headers["if-modified-since"] && Date.parse(req.headers["if-modified-since"]) >= Math.floor(st.mtimeMs / 1000) * 1000))) {
      status = 304; res.writeHead(304, { ETag: etag, "Cache-Control": head["Cache-Control"], Vary: "Accept-Encoding" }); return res.end();
    }

    // compressed: a precompressed sibling, or made now (and kept)
    const ae = String(req.headers["accept-encoding"] || "");
    const enc = sv.compress === false || !COMPRESSIBLE.test(type) || st.size < 1024 || req.headers.range ? null : /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : null;
    if (enc) {
      const pre = (() => { try { const f = file + (enc === "br" ? ".br" : ".gz"); const s2 = statSync(f); return s2.isFile() && inside(realpathSync(f)) ? { f, size: s2.size } : null; } catch { return null; } })();
      if (pre) {
        head["Content-Encoding"] = enc; head["Content-Length"] = pre.size; delete head["Accept-Ranges"];
        res.writeHead(status, head); bytes = pre.size;
        if (req.method === "HEAD") return res.end();
        return createReadStream(pre.f).on("error", () => res.destroy()).pipe(res);
      }
      if (st.size <= ZIP_MAX) {
        const key = `${file}|${etag}|${enc}`;
        let body = zipped.get(key);
        if (!body) {
          let job = zipping.get(key);
          if (!job) {
            job = (async () => {
              const raw = await readFile(file);
              const out = enc === "br" ? await br(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: 5, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : await gz(raw, { level: 6 });
              zipped.set(key, out);
              return out;
            })().catch(() => null).finally(() => zipping.delete(key));
            zipping.set(key, job);
          }
          body = await job;
        }
        if (body) {
          head["Content-Encoding"] = enc; head["Content-Length"] = body.length; delete head["Accept-Ranges"];
          res.writeHead(status, head); bytes = body.length;
          return res.end(req.method === "HEAD" ? undefined : body);
        }
      }
    }

    // a range (video, audio, big downloads)
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (range && status === 200 && (!req.headers["if-range"] || req.headers["if-range"] === etag)) {
      let a = range[1] === "" ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
      let b = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (!(a <= b) || a >= st.size) { status = 416; res.writeHead(416, { ...base, "Content-Range": `bytes */${st.size}` }); return res.end(); }
      status = 206; bytes = b - a + 1;
      res.writeHead(206, { ...head, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Content-Length": bytes });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file, { start: a, end: b }).on("error", () => res.destroy()).pipe(res);
    }
    head["Content-Length"] = st.size; bytes = st.size;
    res.writeHead(status, head);
    if (req.method === "HEAD") return res.end();
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }
  // Nothing may escape: this runs inside the gate, and an unhandled rejection there stops everything
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      try {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }); res.end("Something went wrong serving this page."); }
        else res.destroy();
      } catch { res.destroy(); }
      if (!/ERR_INVALID_CHAR|ERR_HTTP_INVALID_HEADER_VALUE/.test(e?.code || "")) console.error("burrow-pages: serving", req.url, e?.message);
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 120000;
  return server;
}
