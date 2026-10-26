// Redirects and headers, in the syntax most static hosts share (Netlify's
// _redirects and _headers files). A site can ship them as files, and you can
// add more on the dashboard; the dashboard's come first.
//
//   _redirects   /old        /new          301
//                /blog/*     /posts/:splat 302
//                /u/:name    /people/:name 200    (200 = served from there, the address stays)
//                /*          /index.html   200    (a single-page app)
//                /secret     /             301!   (! = even when /secret exists)
//
//   _headers     /*
//                  X-Frame-Options: DENY
//                /assets/*
//                  Cache-Control: public, max-age=31536000, immutable
//
// Pure: no files, no network.

const MAX_RULES = 1000;
const STATUS = new Set([200, 301, 302, 303, 307, 308, 404, 410, 451]);
// headers a site may not set: they belong to the connection, the gate, or the browser's safety
const NO_HEADER = /^(content-length|transfer-encoding|connection|keep-alive|upgrade|te|trailer|host|set-cookie|strict-transport-security|alt-svc|server|date|proxy-.*|x-burrow-.*|x-aegis-.*)$/i;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

const clean = (line) => line.replace(/\s+#.*$/, "").trim();

// "/a/:x/*" -> a matcher returning {x, splat} or null
export function compilePath(from) {
  const parts = String(from).split("/");
  const names = [];
  let re = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i > 0) re += "\\/";
    if (p === "*" && i === parts.length - 1) { re = re.replace(/\\\/$/, "") + "(?:\\/([\\s\\S]*))?"; names.push("splat"); break; }
    if (p.startsWith(":") && /^:[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(p)) { re += "([^/]+)"; names.push(p.slice(1)); continue; }
    re += p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const rx = new RegExp(`^${re}\\/?$`, "i");
  return (path) => {
    const m = rx.exec(path);
    if (!m) return null;
    const out = {};
    names.forEach((n, i) => { out[n] = m[i + 1] ?? ""; });
    return out;
  };
}

export function parseRedirects(text, origin = "file") {
  const rules = [], errors = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let n = 0; n < lines.length && rules.length < MAX_RULES; n++) {
    const line = clean(lines[n]);
    if (!line || line.startsWith("#")) continue;
    const f = line.split(/\s+/);
    if (f.length < 2) { errors.push(`line ${n + 1}: needs a "from" and a "to"`); continue; }
    const [from, to] = f;
    let status = 301, force = false;
    if (f[2]) {
      const m = /^(\d{3})(!?)$/.exec(f[2]);
      if (!m || !STATUS.has(Number(m[1]))) { errors.push(`line ${n + 1}: ${f[2]} isn't a status this host uses`); continue; }
      status = Number(m[1]); force = m[2] === "!";
    }
    if (!from.startsWith("/")) { errors.push(`line ${n + 1}: "${from}" must start with /`); continue; }
    if (!/^[\x21-\x7e]+$/.test(to)) { errors.push(`line ${n + 1}: "to" must be plain ASCII (encode other characters, like %E2%82%AC)`); continue; }
    if (!(to.startsWith("/") || /^https?:\/\/[^\s]+$/i.test(to))) { errors.push(`line ${n + 1}: "${to}" must be a path or an http(s) address`); continue; }
    if (/^https?:/i.test(to) && status === 200) { errors.push(`line ${n + 1}: 200 serves a page of this site, so "to" must be a path`); continue; }
    rules.push({ from, to, status, force, origin, line: n + 1, match: compilePath(from) });
  }
  return { rules, errors };
}

// The first rule that applies to this path. exists(path) says whether the
// site has that file: a rule without ! only applies when it doesn't.
export function matchRedirect(rules, path, exists) {
  for (const r of rules) {
    const p = r.match(path);
    if (!p) continue;
    if (!r.force && exists(path)) continue;                  // a real file wins, unless the rule says !
    // what came from the request is encoded again: a Location must be a valid header (no CR/LF, no raw "€")
    let to = r.to.replace(/:([A-Za-z_][A-Za-z0-9_]{0,30})/g, (all, k) => (k in p ? encodeURI(p[k]).replace(/[?#]/g, encodeURIComponent) : all));
    if (!/^https?:/i.test(to)) to = "/" + to.replace(/^\/+/, "");      // never "//evil.example"
    return { to, status: r.status, rule: r };
  }
  return null;
}

export function parseHeaders(text, origin = "file") {
  const blocks = [], errors = [];
  let cur = null;
  const lines = String(text || "").split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = clean(raw);
    if (!line || line.startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      if (!line.startsWith("/")) { errors.push(`line ${n + 1}: a path (like /*) comes first`); cur = null; continue; }
      if (blocks.length >= MAX_RULES) break;
      cur = { path: line, match: compilePath(line), headers: [], origin, line: n + 1 };
      blocks.push(cur);
      continue;
    }
    if (!cur) { errors.push(`line ${n + 1}: which path is this header for?`); continue; }
    const i = line.indexOf(":");
    const name = i > 0 ? line.slice(0, i).trim() : "", value = i > 0 ? line.slice(i + 1).trim() : "";
    if (!HEADER_NAME.test(name)) { errors.push(`line ${n + 1}: "${name || line}" isn't a header name`); continue; }
    if (NO_HEADER.test(name)) { errors.push(`line ${n + 1}: ${name} can't be set by a site`); continue; }
    // what Node accepts in a header: tab, printable ASCII, and Latin-1 (anything else would throw when sent)
    if (!/^[\t\x20-\x7e\x80-\xff]*$/.test(value) || value.length > 4000) { errors.push(`line ${n + 1}: that value can't be sent (plain ASCII only)`); continue; }
    cur.headers.push([name, value]);
  }
  return { blocks: blocks.filter((b) => b.headers.length), errors };
}

export function headersFor(blocks, path) {
  const out = {};
  for (const b of blocks) if (b.match(path)) for (const [k, v] of b.headers) {
    const key = k.toLowerCase();
    out[key] = out[key] && key !== "cache-control" && key !== "content-security-policy" ? `${out[key]}, ${v}` : v;
  }
  return out;
}

// Build output names like app.3f9a2c1d.js or index-BxY7_a9Q.css never change
// content: cache them for a year.
// (a hash has a digit somewhere: "my-component.js" is not one)
export const isHashed = (path) => /[.-](?=[A-Za-z_]*\d)[A-Za-z0-9_]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|webp|avif|svg|gif|ico|wasm)$/.test(path);
