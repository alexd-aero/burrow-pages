// A site that lives somewhere else (a GitLab or GitHub Pages site, any
// website), answering on your address: https://docs.you.example ->
// https://group.gitlab.io/project/. 127.0.0.1 only, behind the site's tunnel.
//
//   paths        /x is fetched as <base>/x; the upstream's own redirects come back as yours
//   links        optionally, absolute links to the upstream in HTML/CSS/JS become yours
//   cache        optionally, pages are kept for N seconds, and kept serving for a
//                day if the upstream breaks (stale-if-error), so a hiccup there
//                isn't an outage here
//   privacy      the visitor's address, cookies of the gate and Cloudflare's
//                headers don't go upstream (unless you say to pass the address on)

import { createServer, request as httpRequest, Agent as HttpAgent } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";
import { isIP } from "node:net";
import { clientIp } from "./serve.mjs";

// a pool of connections per site: one slow upstream can't starve the others
const pools = new Map();
// insecure: a service on your own machine with a certificate of its own making (no checking it)
const agentFor = (id, https, insecure) => {
  const k = `${id}|${https ? "s" : ""}|${insecure ? "i" : ""}`;
  if (!pools.has(k)) pools.set(k, https ? new HttpsAgent({ keepAlive: true, maxSockets: 32, rejectUnauthorized: !insecure }) : new HttpAgent({ keepAlive: true, maxSockets: 32 }));
  return pools.get(k);
};
// the gate's (and Cloudflare's) cookies stay here; the site's own go on
const siteCookies = (c) => String(c || "").split(/;\s*/).filter((x) => x && !/^(__Host-aegis|aegis|__Secure-aegis|__cf|cf_)/i.test(x)).join("; ");
const MAX_BUFFER = 4 * 1024 * 1024;     // a page held to rewrite or cache
const MAX_INFLIGHT = 64;                // requests a site has upstream at once
// The path a visitor asked for, safe to put under the base: no ".." (raw or
// encoded), no encoded slashes, so nobody walks out of /project/ upstream.
export function cleanPath(raw) {
  const s = String(raw || "/");
  const q = s.indexOf("?"), path = q < 0 ? s : s.slice(0, q), query = q < 0 ? "" : s.slice(q);
  if (!path.startsWith("/") || /%2f|%5c|\\/i.test(path)) return null;
  let segs;
  try { segs = path.split("/").map((x) => decodeURIComponent(x)); } catch { return null; }
  if (segs.some((x) => x === ".." || x === "." || x.includes("/") || x.includes("\\") || x.includes("\0"))) return null;
  if (/[^\x21-\x7e]/.test(path + query)) return null;
  return path + query;
}
const HOP = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|host|cf-.*|cdn-loop|x-forwarded-.*|x-real-ip|true-client-ip|forwarded|x-burrow-.*|x-aegis-.*)$/i;
const RESP_DROP = /^(connection|keep-alive|transfer-encoding|proxy-.*|alt-svc|strict-transport-security)$/i;

// What people paste -> {url, host, port, https, base}
export function parseUpstream(input) {
  let s = String(input || "").trim();
  if (!s) throw Object.assign(new Error("Enter the address of the site."), { status: 400 });
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { throw Object.assign(new Error("That doesn't look like an address."), { status: 400 }); }
  if (u.username || u.password) throw Object.assign(new Error("Leave sign-in details out of the address."), { status: 400 });
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // cloud metadata services never: they hand out this machine's credentials
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host) || host === "metadata.google.internal" || host === "100.100.100.200") throw Object.assign(new Error("That address is off limits."), { status: 400 });
  if (!isIP(host) && !/^[a-z0-9.-]{1,253}$/.test(host)) throw Object.assign(new Error("That host name doesn't look right."), { status: 400 });
  let base = u.pathname.replace(/\/+$/, "") + "/";
  if (!/^\/[A-Za-z0-9._~%!$&'()*+,;=:@\/-]*$/.test(base)) throw Object.assign(new Error("That path has characters an address can't have."), { status: 400 });
  const https = u.protocol === "https:";
  return { url: `${u.protocol}//${u.host}${base}`, host, hostHeader: u.host, port: Number(u.port || (https ? 443 : 80)), https, base };
}

const mapPath = (up, p) => (up.base === "/" ? p : up.base + p.replace(/^\//, ""));
function mapBack(up, loc, pubOrigin) {
  try {
    const u = new URL(loc, up.url);
    if (u.host.toLowerCase() !== up.hostHeader.toLowerCase()) return loc;
    let p = u.pathname;
    if (up.base !== "/" && (p + "/").startsWith(up.base)) p = "/" + p.slice(up.base.length);
    else if (up.base !== "/") return loc;              // outside the site: leave it pointing upstream
    return (pubOrigin || "") + p + u.search + u.hash;
  } catch { return loc; }
}

class Cache {
  constructor() { this.m = new Map(); this.size = 0; this.max = 96 * 1024 * 1024; }
  get(k) { return this.m.get(k) || null; }
  set(k, v) {
    const old = this.m.get(k); if (old) { this.size -= old.body.length; this.m.delete(k); }
    if (v.body.length > 8 * 1024 * 1024) return;
    this.m.set(k, v); this.size += v.body.length;
    for (const [key, val] of this.m) { if (this.size <= this.max) break; this.m.delete(key); this.size -= val.body.length; }
  }
  clear(prefix) { for (const k of [...this.m.keys()]) if (!prefix || k.startsWith(prefix)) { this.size -= this.m.get(k).body.length; this.m.delete(k); } }
}
export const cache = new Cache();

export function proxyServer({ site, onHit, onUpstream }) {
  let inflight = 0;
  const server = createServer((req, res) => {
    try { handle(req, res); }
    catch (e) {
      try { if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Something went wrong."); } else res.destroy(); } catch { res.destroy(); }
      console.error("burrow-pages: proxy", e?.message);
    }
  });
  function handle(req, res) {
    const t0 = Date.now(), s = site();
    let status = 0, bytes = 0, path = "/";
    res.on("finish", () => { try { onHit?.({ path, status, bytes, ms: Date.now() - t0, ip: clientIp(req), ua: req.headers["user-agent"] || "", referer: req.headers.referer || "", host: String(req.headers.host || "").split(":")[0], method: req.method }); } catch { /* */ } });
    const p = s?.proxy || {};
    let up;
    try { up = parseUpstream(p.upstream); } catch { status = 502; res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("This site has no upstream address."); }
    try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { path = req.url; }
    const want = cleanPath(req.url);
    if (!want) { status = 400; res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Bad address."); }
    if (inflight >= MAX_INFLIGHT) { status = 503; res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5" }); return res.end("Too busy. Try again in a moment."); }
    const sv = s.serving || {};
    const base = { "X-Content-Type-Options": "nosniff" };
    if (sv.noindex) base["X-Robots-Tag"] = "noindex, nofollow";
    // a port of another machine whose link is down for a moment (it comes back by itself)
    if (p.down) { status = 502; res.writeHead(502, { ...base, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5", "Cache-Control": "no-store" }); return res.end(`${p.down}. Try again in a moment.`); }
    if (s.maintenance?.on) { status = 503; res.writeHead(503, { ...base, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600" }); return res.end(s.maintenance.message || "Back soon."); }

    const pubHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const pubOrigin = pubHost && !/^127\.|^localhost/.test(pubHost) ? `https://${pubHost}` : "";
    const rewrite = !!p.rewriteLinks;
    const ttl = Math.max(0, Math.min(86400, Number(p.cacheSeconds) || 0));
    const ae = String(req.headers["accept-encoding"] || "");
    const encKey = rewrite ? "id" : /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gz" : "id";
    const key = `${s.id}|${encKey}|${want}`;
    // a page for one visitor (cookies, a sign-in) is never cached or served from the cache
    const cacheable = req.method === "GET" && !req.headers.authorization && !req.headers.range && !req.headers.cookie;
    const hit = cacheable ? cache.get(key) : null;
    const sendCached = (c, how) => {
      status = c.status; bytes = c.body.length;
      res.writeHead(c.status, { ...c.headers, "X-Burrow-Pages-Cache": how, Age: String(Math.floor((Date.now() - c.at) / 1000)) });
      res.end(c.body);
    };
    if (hit && ttl && Date.now() - hit.at < ttl * 1000) return sendCached(hit, "hit");

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.test(k)) headers[k] = v;
    // the gate's own cookies stay with the gate (it already strips them; this is the belt to its braces)
    if (headers.cookie) { const c = siteCookies(headers.cookie); if (c) headers.cookie = c; else delete headers.cookie; }
    // keepHost: the app sees the public address (apps that build links from Host, or check it)
    if (p.keepHost && pubHost) headers.host = pubHost;
    else {
      headers.host = up.hostHeader;
      if (headers.origin && pubOrigin && headers.origin === pubOrigin) headers.origin = `${up.https ? "https" : "http"}://${up.hostHeader}`;
      if (headers.referer && pubOrigin && headers.referer.startsWith(pubOrigin)) headers.referer = `${up.https ? "https" : "http"}://${up.hostHeader}${mapPath(up, headers.referer.slice(pubOrigin.length) || "/")}`;
    }
    if (rewrite) headers["accept-encoding"] = "identity";
    if (p.forwardIp) { headers["x-forwarded-for"] = clientIp(req); headers["x-forwarded-proto"] = "https"; if (pubHost) headers["x-forwarded-host"] = pubHost; }
    if (hit) { if (hit.headers.etag) headers["if-none-match"] = hit.headers.etag; }

    const mod = up.https ? httpsRequest : httpRequest;
    inflight++;
    let counted = true;
    const done = () => { if (counted) { counted = false; inflight--; } };
    res.on("close", done);
    const upReq = mod({ host: up.host, port: up.port, servername: isIP(up.host) ? undefined : up.host, method: req.method, path: mapPath(up, want), headers,
                        agent: agentFor(s.id, up.https, !!p.insecure), timeout: Math.max(5, Number(p.timeout) || 30) * 1000 }, (upRes) => {
      onUpstream?.(true, upRes.statusCode);
      // not modified: the cached copy is good again
      if (upRes.statusCode === 304 && hit) { upRes.resume(); hit.at = Date.now(); return sendCached(hit, "revalidated"); }
      if (upRes.statusCode >= 500 && hit && Date.now() - hit.at < 864e5) { upRes.resume(); return sendCached(hit, "stale"); }
      const out = { ...base };
      for (const [k, v] of Object.entries(upRes.headers)) if (!RESP_DROP.test(k)) out[k] = v;
      if (typeof out.location === "string") out.location = mapBack(up, out.location, "");
      const type = String(out["content-type"] || "");
      const textual = /^(text\/html|text\/css|application\/javascript|text\/javascript|application\/json|image\/svg\+xml)/.test(type);
      const vary = String(out.vary || "").toLowerCase().split(/\s*,\s*/).filter((v) => v && v !== "accept-encoding");
      const mayCache = cacheable && ttl && upRes.statusCode === 200 && !out["set-cookie"] && !vary.length && !/no-store|private/i.test(String(out["cache-control"] || ""));
      if ((rewrite && textual && upRes.statusCode === 200) || mayCache) {
        const chunks = []; let n = 0, over = false;
        upRes.on("data", (c) => { if (over) return; n += c.length; if (n > MAX_BUFFER) { over = true; chunks.length = 0; upRes.destroy(); return; } chunks.push(c); });
        upRes.on("end", () => {
          if (over) return;
          let body = Buffer.concat(chunks);
          if (rewrite && textual && !out["content-encoding"]) {
            const from = [`https://${up.hostHeader}${up.base}`, `http://${up.hostHeader}${up.base}`, `//${up.hostHeader}${up.base}`];
            let txt = body.toString("utf8");
            for (const f of from) txt = txt.split(f).join(pubOrigin ? `${pubOrigin}/` : "/");
            body = Buffer.from(txt, "utf8");
            delete out.etag;
          }
          out["content-length"] = body.length;
          status = upRes.statusCode; bytes = body.length;
          if (mayCache) cache.set(key, { status, headers: { ...out }, body, at: Date.now() });
          res.writeHead(status, { ...out, "X-Burrow-Pages-Cache": mayCache ? "miss" : "off" });
          res.end(req.method === "HEAD" ? undefined : body);
        });
        upRes.on("error", () => { if (over && !res.headersSent) { status = 502; res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }); res.end("That page is over 4 MB: too large to pass through with link rewriting or caching on."); } else res.destroy(); });
        upRes.on("close", () => { if (over && !res.headersSent) { status = 502; res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }); res.end("That page is over 4 MB: too large to pass through with link rewriting or caching on."); } });
        return;
      }
      status = upRes.statusCode;
      res.writeHead(status, out);
      upRes.on("data", (c) => { bytes += c.length; });
      upRes.pipe(res);
    });
    upReq.on("timeout", () => upReq.destroy(new Error("timed out")));
    // the visitor left: so does the upstream request
    res.on("close", () => { if (!res.writableFinished) upReq.destroy(); });
    upReq.on("error", (e) => {
      onUpstream?.(false, e.message);
      if (res.headersSent) return res.destroy();
      if (hit && Date.now() - hit.at < 864e5) return sendCached(hit, "stale");
      status = 502;
      const msg = `${up.hostHeader} isn't answering (${e.code || e.message}). Try again in a moment.`;
      bytes = msg.length;
      res.writeHead(502, { ...base, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" });
      res.end(msg);
    });
    req.pipe(upReq);
  }

  // WebSockets pass straight through
  server.on("upgrade", (req, socket, head) => {
    const s = site(); let up;
    try { up = parseUpstream(s?.proxy?.upstream); } catch { return socket.destroy(); }
    const want = cleanPath(req.url);
    if (!want || /[\r\n]/.test(JSON.stringify(req.headers))) return socket.destroy();
    const p = s.proxy || {};
    const conn = up.https ? tlsConnect({ host: up.host, port: up.port, servername: isIP(up.host) ? undefined : up.host, rejectUnauthorized: !p.insecure }) : netConnect({ host: up.host, port: up.port });
    conn.on(up.https ? "secureConnect" : "connect", () => {
      const lines = [`${req.method} ${mapPath(up, want)} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) if (!/^(host|cf-.*|x-forwarded-.*|x-real-ip|true-client-ip|forwarded|cookie)$/i.test(k)) lines.push(`${k}: ${v}`);
      const pubHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
      lines.push(`host: ${p.keepHost && pubHost ? pubHost : up.hostHeader}`);
      const c = siteCookies(req.headers.cookie); if (c) lines.push(`cookie: ${c}`);
      if (p.forwardIp) { lines.push(`x-forwarded-for: ${clientIp(req)}`, "x-forwarded-proto: https"); if (pubHost) lines.push(`x-forwarded-host: ${pubHost}`); }
      conn.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) conn.write(head);
      conn.pipe(socket); socket.pipe(conn);
    });
    conn.on("error", () => socket.destroy()); socket.on("error", () => conn.destroy());
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  return server;
}

// Is the upstream there? {ok, status, ms, error}
// insecure: don't check its certificate (a service on your own machine). For a
// port of an app, anything that answers HTTP below 500 is "up" (a login page's 401 too).
export async function probe(upstream, { insecure, app } = {}) {
  const up = parseUpstream(upstream), t0 = Date.now();
  return new Promise((ok) => {
    const mod = up.https ? httpsRequest : httpRequest;
    const r = mod({ host: up.host, port: up.port, path: up.base, method: "GET", servername: isIP(up.host) ? undefined : up.host, rejectUnauthorized: !insecure,
                    headers: { host: up.hostHeader, "user-agent": "burrow-pages (health check)" }, timeout: 12000 }, (res) => {
      res.resume();
      ok({ ok: app ? res.statusCode < 500 : res.statusCode < 400, status: res.statusCode, ms: Date.now() - t0 });
    });
    r.on("timeout", () => r.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    r.on("error", (e) => ok({ ok: false, status: 0, ms: Date.now() - t0, error: why(e) }));
    r.end();
  });
}

// "fetch failed" says nothing: the cause underneath does (ECONNREFUSED, ENOTFOUND…)
const WHY = { ECONNREFUSED: "connection refused", ENOTFOUND: "no such host", ETIMEDOUT: "timed out", ECONNRESET: "connection reset", EHOSTUNREACH: "host unreachable", CERT_HAS_EXPIRED: "its certificate has expired", UND_ERR_CONNECT_TIMEOUT: "timed out" };
function why(e) {
  const c = e?.cause?.code || e?.cause?.errors?.[0]?.code || e?.code;
  if (e?.name === "TimeoutError") return "timed out";
  return WHY[c] || c || e?.cause?.message || e?.message || "no answer";
}
