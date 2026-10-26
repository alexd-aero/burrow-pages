// Visitor numbers per site, counted where the files are served. No cookies,
// no scripts in your pages, no addresses kept: a visitor is a hash of their
// address and browser with a salt that changes every day, so the same person
// can't be followed from one day to the next.
//
// Kept: 48 hours by the hour and 90 days by the day (requests, bytes, visitors,
// errors); top pages, referrers, browsers, systems and devices for 30 days;
// the last 200 requests (address cut to /24 or /48).

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOUR = 3600e3, DAY = 864e5;
const TOP = 300;         // names kept per table per day
const dayOf = (t) => Math.floor(t / DAY), hourOf = (t) => Math.floor(t / HOUR);

export function agent(ua = "") {
  const u = String(ua);
  const bot = !u || /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|health check|burrow|aegis|curl|wget|python-requests|httpclient|go-http|node-fetch|undici|headless|lighthouse|uptime/i.test(u);
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /Firefox\//.test(u) ? "Firefox"
    : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : bot ? "Bot" : "Other";
  const os = /Windows/.test(u) ? "Windows" : /iPhone|iPad|iPod/.test(u) ? "iOS" : /Android/.test(u) ? "Android" : /CrOS/.test(u) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "Other";
  const device = bot ? "Bot" : /iPad|Tablet/.test(u) ? "Tablet" : /Mobi|iPhone|Android/.test(u) ? "Phone" : "Desktop";
  return { bot, browser, os, device };
}
export function maskIp(ip = "") {
  const s = String(ip).replace(/^::ffff:/, "");
  if (s.includes(":")) return s.split(":").slice(0, 3).join(":") + "::/48";
  const p = s.split("."); return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : "?";
}

export class Stats {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true, mode: 0o700 }); this.sites = new Map(); this.dirty = new Set(); }
  file(id) { return join(this.dir, `${id}.json`); }
  get(id) {
    let s = this.sites.get(id);
    if (s) return s;
    try { s = JSON.parse(readFileSync(this.file(id), "utf8")); } catch { s = null; }
    s = { hours: {}, days: {}, tops: {}, recent: [], total: { r: 0, b: 0, v: 0 }, salt: null, saltDay: 0, seen: [], since: Date.now(), ...(s || {}) };
    s.seenSet = new Set(s.seen || []);
    this.sites.set(id, s);
    return s;
  }
  // one request: {path, status, bytes, ms, ip, ua, referer, method}
  hit(id, r) {
    const s = this.get(id), t = Date.now(), d = dayOf(t), h = hourOf(t);
    if (s.saltDay !== d) { s.salt = randomBytes(16).toString("hex"); s.saltDay = d; s.seenSet = new Set(); }
    const a = agent(r.ua);
    const page = r.status < 300 && /^(GET|HEAD)$/.test(r.method || "GET") && (/\.html?$/.test(r.path) || !/\.[a-z0-9]{1,6}$/i.test(r.path));
    let fresh = false;
    if (!a.bot && page) {
      const v = createHash("sha256").update(`${s.salt}|${r.ip}|${r.ua}`).digest("base64url").slice(0, 16);
      if (!s.seenSet.has(v) && s.seenSet.size < 200000) { s.seenSet.add(v); fresh = true; }
    }
    const bump = (o) => { o.r = (o.r || 0) + 1; o.b = (o.b || 0) + (r.bytes || 0); if (fresh) o.v = (o.v || 0) + 1; if (page && !a.bot) o.p = (o.p || 0) + 1;
                          if (r.status >= 400) o.e = (o.e || 0) + 1; if (r.status >= 500) o.x = (o.x || 0) + 1; if (a.bot) o.bot = (o.bot || 0) + 1; };
    bump(s.hours[h] ||= {}); bump(s.days[d] ||= {}); bump(s.total);
    const tops = s.tops[d] ||= { pages: {}, refs: {}, browsers: {}, os: {}, devices: {}, codes: {}, missing: {} };
    const inc = (tab, k) => { if (!k) return; if (k in tab || Object.keys(tab).length < TOP) tab[k] = (tab[k] || 0) + 1; };
    if (page && !a.bot) inc(tops.pages, r.path.slice(0, 200));
    if (r.status === 404) inc(tops.missing, r.path.slice(0, 200));
    inc(tops.codes, String(r.status));
    if (!a.bot && fresh) { inc(tops.browsers, a.browser); inc(tops.os, a.os); inc(tops.devices, a.device); }
    if (r.referer && page) {
      try { const host = new URL(r.referer).hostname.replace(/^www\./, ""); if (host && host !== r.host) inc(tops.refs, host); } catch { /* not a URL */ }
    }
    s.recent.push({ t, m: r.method, p: r.path.slice(0, 200), s: r.status, b: r.bytes || 0, ms: r.ms || 0, ip: maskIp(r.ip), ua: `${a.browser} · ${a.os}`, bot: a.bot || undefined });
    if (s.recent.length > 200) s.recent.splice(0, s.recent.length - 200);
    this.dirty.add(id);
  }
  // trim old buckets and write what changed
  flush() {
    const t = Date.now(), h0 = hourOf(t) - 48, d0 = dayOf(t) - 90, t0 = dayOf(t) - 30;
    for (const id of this.dirty) {
      const s = this.sites.get(id); if (!s) continue;
      for (const k of Object.keys(s.hours)) if (Number(k) < h0) delete s.hours[k];
      for (const k of Object.keys(s.days)) if (Number(k) < d0) delete s.days[k];
      for (const k of Object.keys(s.tops)) if (Number(k) < t0) delete s.tops[k];
      s.seen = [...s.seenSet];
      const { seenSet, ...save } = s;
      try { const tmp = `${this.file(id)}.tmp`; writeFileSync(tmp, JSON.stringify(save), { mode: 0o600 }); renameSync(tmp, this.file(id)); } catch { /* next time */ }
    }
    this.dirty.clear();
  }
  drop(id) { this.sites.delete(id); this.dirty.delete(id); try { writeFileSync(this.file(id), "{}"); } catch { /* gone */ } }

  // the dashboard's view: a range of days (1, 7, 30, 90)
  view(id, days = 7) {
    const s = this.get(id), t = Date.now(), d = dayOf(t), h = hourOf(t);
    const series = [];
    if (days <= 1) for (let i = 23; i >= 0; i--) { const k = h - i; series.push({ t: k * HOUR, ...(s.hours[k] || {}) }); }
    else for (let i = days - 1; i >= 0; i--) { const k = d - i; series.push({ t: k * DAY, ...(s.days[k] || {}) }); }
    const sum = (f) => series.reduce((a, x) => a + (x[f] || 0), 0);
    const merge = (tab) => {
      const out = {};
      for (let i = 0; i < Math.min(days, 30); i++) for (const [k, v] of Object.entries(s.tops[d - i]?.[tab] || {})) out[k] = (out[k] || 0) + v;
      return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n }));
    };
    // the period before, for the arrows
    let prev = { r: 0, v: 0, p: 0, b: 0 };
    if (days > 1) for (let i = days; i < days * 2; i++) { const x = s.days[d - i]; if (x) for (const k in prev) prev[k] += x[k] || 0; }
    return {
      days, series, since: s.since,
      totals: { requests: sum("r"), bytes: sum("b"), visitors: sum("v"), pageviews: sum("p"), errors: sum("e"), serverErrors: sum("x"), bots: sum("bot") },
      previous: days > 1 ? prev : null,
      pages: merge("pages"), referrers: merge("refs"), browsers: merge("browsers"), os: merge("os"), devices: merge("devices"),
      codes: merge("codes"), missing: merge("missing"),
      recent: s.recent.slice(-60).reverse(), allTime: s.total,
    };
  }
  // a 24-hour sparkline of requests, for the cards
  spark(id) { const s = this.get(id), h = hourOf(Date.now()); const out = []; for (let i = 23; i >= 0; i--) out.push(s.hours[h - i]?.r || 0); return out; }
  today(id) { const s = this.get(id); return s.days[dayOf(Date.now())] || {}; }
}
