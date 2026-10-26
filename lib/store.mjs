// What Burrow Pages remembers, in its data folder (mode 700):
//
//   state.json      sites, accounts (no tokens), settings      0600, written whole, atomically
//   secrets.json    sign-in tokens, AES-256-GCM sealed          0600
//   secret.key      the key that seals them                     0600
//   activity.jsonl  what happened, newest last (kept to 2000 lines)
//
// Tokens never leave this file: the dashboard sees whether an account is
// signed in, never with what.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULTS = {
  keep: 10,                 // deploys kept per site (older ones are deleted)
  access: "login",          // a new site's default: login | password | public
  syncEvery: 5,             // minutes between looks for new commits (0 = only by hand)
  monitorEvery: 5,          // minutes between health checks
  build: true,              // offer container builds (when Docker is here)
  buildTimeout: 15,         // minutes
  buildMemory: 1536,        // MB
  notify: true,             // failures go to the dashboard's bell
};

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, "state.json");
    this.secFile = join(dir, "secrets.json");
    this.actFile = join(dir, "activity.jsonl");
    const kf = join(dir, "secret.key");
    if (!existsSync(kf)) writeFileSync(kf, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(kf);
    if (this.key.length !== 32) throw new Error("secret.key must hold 32 bytes");
    this.s = this.read();
    this.listeners = new Set();
  }

  read() {
    let s = {};
    try { s = JSON.parse(readFileSync(this.file, "utf8")); } catch { /* first start */ }
    return { version: 2, sites: {}, accounts: {}, settings: { ...DEFAULTS }, ...s, settings: { ...DEFAULTS, ...(s.settings || {}) } };
  }
  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.s, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
    for (const fn of this.listeners) try { fn(); } catch { /* a listener's problem */ }
  }
  // change and save in one go: mutate((s) => …) returns what fn returns
  mutate(fn) { const out = fn(this.s); this.save(); return out; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get settings() { return this.s.settings; }
  site(id) { return this.s.sites[id] || null; }
  sites() { return Object.values(this.s.sites); }

  // ---------------------------------------------------------------- secrets
  seal(text) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
  }
  open(blob) {
    try {
      const b = Buffer.from(String(blob), "base64url");
      const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
    } catch { return null; }
  }
  secrets() { try { return JSON.parse(readFileSync(this.secFile, "utf8")); } catch { return {}; } }
  token(accountId) { const v = this.secrets()[accountId]; return v ? this.open(v) : null; }
  setToken(accountId, token) {
    const all = this.secrets();
    if (token) all[accountId] = this.seal(token); else delete all[accountId];
    const tmp = `${this.secFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
    renameSync(tmp, this.secFile);
  }

  // ---------------------------------------------------------------- activity
  activity(entry) {
    const e = { t: Date.now(), ...entry };
    try {
      appendFileSync(this.actFile, JSON.stringify(e) + "\n", { mode: 0o600 });
      if (statSync(this.actFile).size > 1.5e6) {
        const keep = readFileSync(this.actFile, "utf8").trim().split("\n").slice(-2000).join("\n") + "\n";
        writeFileSync(this.actFile, keep, { mode: 0o600 });
      }
    } catch { /* the log is a nicety */ }
    return e;
  }
  recent({ site, limit = 200 } = {}) {
    let lines = [];
    try { lines = readFileSync(this.actFile, "utf8").trim().split("\n"); } catch { return []; }
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { const e = JSON.parse(lines[i]); if (!site || e.site === site) out.push(e); } catch { /* a torn line */ }
    }
    return out;
  }
}
