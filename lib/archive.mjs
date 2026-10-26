// Unpacking what we didn't make: a repository's .tar.gz, or a .zip or .tar.gz
// someone uploaded. Our own readers, not the system's tar, so every rule is
// ours to keep:
//
//   - only plain files and folders are written: links, devices and the like
//     are skipped (a link could point anywhere on this machine)
//   - every name is cleaned: no absolute paths, no "..", no NUL, no "\"
//   - limits on the total size, the number of files and each file's size,
//     counted on what comes out, not on what the archive claims (zip bombs)
//
// Nothing here runs anything it unpacks.

import { createGunzip, createInflateRaw } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

export const LIMITS = { maxBytes: 1024 * 1024 * 1024, maxFiles: 50000, maxFile: 200 * 1024 * 1024 };

export class ArchiveError extends Error { constructor(msg) { super(msg); this.status = 400; } }

// "a/./b//c" -> "a/b/c"; null when it isn't a safe relative name
export function safeName(name) {
  let s = String(name || "");
  if (!s || s.includes("\0") || s.includes("\\")) return null;
  s = posix.normalize("/" + s).slice(1);
  if (!s || s === "." || s.split("/").some((p) => p === ".." || p === "")) return s === "" ? "" : null;
  if (s.length > 1024 || s.split("/").length > 64) return null;
  return s;
}

class Budget {
  constructor(limits) { this.l = { ...LIMITS, ...limits }; this.bytes = 0; this.files = 0; }
  file(name) { if (++this.files > this.l.maxFiles) throw new ArchiveError(`more than ${this.l.maxFiles} files`); }
  add(n, fileBytes) {
    this.bytes += n;
    if (this.bytes > this.l.maxBytes) throw new ArchiveError(`unpacks to more than ${Math.round(this.l.maxBytes / 1048576)} MB`);
    if (fileBytes > this.l.maxFile) throw new ArchiveError(`a single file is over ${Math.round(this.l.maxFile / 1048576)} MB`);
  }
}

// a file being written: created with its folders, closed on end or error
async function writer(root, rel, budget) {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const fh = await open(path, "wx", 0o644);
  let n = 0;
  return {
    async write(buf) { n += buf.length; budget.add(buf.length, n); await fh.write(buf); },
    close: () => fh.close(),
  };
}

// Strips the first `strip` folders from a name ("owner-repo-abc123/index.html" -> "index.html")
function stripped(name, strip) {
  const parts = name.split("/");
  return parts.length > strip ? parts.slice(strip).join("/") : "";
}

// ------------------------------------------------------------------ .tar.gz
// A readable stream of a .tar.gz (or .tar when gzip is false) -> files under root.
export async function untar(readable, root, { strip = 0, gzip = true, limits } = {}) {
  const budget = new Budget(limits);
  const src = gzip ? readable.pipe(createGunzip()) : readable;
  readable.on?.("error", (e) => src.destroy(e));
  let buf = Buffer.alloc(0);
  let entry = null;               // {left, pad, out}
  let longName = null, paxPath = null;
  let ended = false;
  const files = [];

  const field = (b, off, len) => { const s = b.subarray(off, off + len); const z = s.indexOf(0); return (z >= 0 ? s.subarray(0, z) : s).toString("utf8"); };
  const octal = (b, off, len) => {
    if (b[off] & 0x80) {                    // base-256 for big sizes
      let v = 0; for (let i = off + 1; i < off + len; i++) v = v * 256 + b[i]; return v;
    }
    const s = field(b, off, len).trim(); return s ? parseInt(s, 8) : 0;
  };
  const pax = (data) => {
    const out = {}; let i = 0; const s = data.toString("utf8");
    while (i < s.length) {
      const sp = s.indexOf(" ", i); if (sp < 0) break;
      const len = parseInt(s.slice(i, sp), 10); if (!len) break;
      const rec = s.slice(sp + 1, i + len - 1); const eq = rec.indexOf("=");
      if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
      i += len;
    }
    return out;
  };

  try {
    for await (const chunk of src) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (!ended) {
        if (entry) {
          if (entry.left > 0) {
            if (!buf.length) break;
            const take = Math.min(entry.left, buf.length);
            const part = buf.subarray(0, take);
            if (entry.out) await entry.out.write(part);
            else if (entry.collect) entry.collect.push(Buffer.from(part));
            buf = buf.subarray(take); entry.left -= take;
            if (entry.left > 0) break;
          }
          if (buf.length < entry.pad) break;
          buf = buf.subarray(entry.pad);
          const done = entry; entry = null;
          if (done.out) await done.out.close();
          if (done.type === "L") longName = Buffer.concat(done.collect).toString("utf8").replace(/\0+$/, "");
          if (done.type === "x") paxPath = pax(Buffer.concat(done.collect)).path || null;
          continue;
        }
        if (buf.length < 512) break;
        const h = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (h.every((x) => x === 0)) { ended = true; break; }
        const sum = h.reduce((a, x, i) => a + (i >= 148 && i < 156 ? 32 : x), 0);
        if (sum !== octal(h, 148, 8)) throw new ArchiveError("isn't a tar archive (bad header)");
        const type = String.fromCharCode(h[156] || 48);
        const size = octal(h, 124, 12);
        const prefix = field(h, 345, 155);
        let name = longName || paxPath || (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
        longName = paxPath = null;
        const pad = (512 - (size % 512)) % 512;
        if (type === "L" || type === "x") {
          if (size > 1024 * 1024) throw new ArchiveError("a header is too large");
          entry = { type, left: size, pad, collect: [] }; continue;
        }
        if (type === "g") { entry = { type, left: size, pad }; continue; }
        const rel = safeName(stripped(name.replace(/\/+$/, ""), strip));
        if (type === "0" || type === "\0" || type === "7") {
          if (rel) {
            budget.file(rel);
            budget.add(0, size);
            files.push(rel);
            entry = { type, left: size, pad, out: await writer(root, rel, budget) };
          } else entry = { type, left: size, pad };
          continue;
        }
        if (type === "5" && rel) await mkdir(join(root, rel), { recursive: true, mode: 0o755 });
        entry = { type, left: size, pad };          // links and the rest: skipped
      }
      if (ended) break;
    }
  } finally {
    if (entry?.out) await entry.out.close().catch(() => {});
    src.destroy?.(); readable.destroy?.();
  }
  if (!ended && entry) throw new ArchiveError("the archive ends in the middle of a file");
  return { files: files.length, bytes: budget.bytes, names: files };
}

// ------------------------------------------------------------------ .zip
// A .zip file on disk -> files under root. Stored and deflated entries; no
// encryption. A single folder holding everything is stripped by default.
export async function unzip(file, root, { strip = "auto", limits } = {}) {
  const budget = new Budget(limits);
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const read = async (pos, len) => { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, pos); return b.subarray(0, bytesRead); };
    // the end of central directory record: in the last 64 KiB + 22 bytes
    const tailLen = Math.min(size, 65557);
    const tail = await read(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new ArchiveError("isn't a zip file");
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) {
      // zip64: the locator sits right before the EOCD
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new ArchiveError("a zip64 archive without its locator");
      const at = Number(tail.readBigUInt64LE(loc + 8));
      const rec = await read(at, 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ArchiveError("a broken zip64 archive");
      count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48));
    }
    if (count > budget.l.maxFiles * 2) throw new ArchiveError(`more than ${budget.l.maxFiles} files`);
    if (cdSize > 64 * 1024 * 1024) throw new ArchiveError("its index is too large");
    const cd = await read(cdOff, cdSize);
    const entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new ArchiveError("a broken zip index");
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      const attr = cd.readUInt32LE(p + 38);
      let off = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nlen).toString("utf8");
      // zip64 sizes and offset live in the extra field (id 1)
      for (let x = p + 46 + nlen, end = x + xlen; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      p += 46 + nlen + xlen + clen;
      const mode = (attr >>> 16) & 0o170000;
      if (name.endsWith("/")) continue;
      if (mode === 0o120000 || (mode && mode !== 0o100000)) continue;          // links and the like
      if (flags & 1) throw new ArchiveError("the zip is password-protected");
      if (method !== 0 && method !== 8) throw new ArchiveError(`a file in it uses compression this host doesn't read (method ${method})`);
      if (/^__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
      entries.push({ name, method, csize, usize, off });
    }
    // one folder holding everything (a zipped folder): serve what's inside it
    let cut = 0;
    if (strip === "auto") {
      const tops = new Set(entries.map((e) => e.name.split("/")[0]));
      if (tops.size === 1 && entries.every((e) => e.name.includes("/"))) cut = 1;
    } else cut = Number(strip) || 0;
    const names = [];
    for (const e of entries) {
      const rel = safeName(stripped(e.name, cut));
      if (!rel) continue;
      budget.file(rel);
      budget.add(0, e.usize);
      const lh = await read(e.off, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new ArchiveError("a broken zip entry");
      const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const out = await writer(root, rel, budget);
      try {
        if (e.csize > 0) {
          const raw = createReadStream(file, { start, end: start + e.csize - 1 });
          const body = e.method === 8 ? raw.pipe(createInflateRaw()) : raw;
          raw.on("error", (err) => body.destroy(err));
          let got = 0;
          for await (const c of body) {
            got += c.length;
            if (got > e.usize + 1024) { body.destroy(); throw new ArchiveError("a file in it is bigger than it says"); }
            await out.write(c);
          }
        }
      } finally { await out.close(); }
      names.push(rel);
    }
    return { files: names.length, bytes: budget.bytes, names };
  } finally { await fh.close(); }
}

// What kind of archive a file is, from its first bytes
export async function sniff(file) {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(512); const { bytesRead } = await fh.read(b, 0, 512, 0);
    if (bytesRead >= 4 && b.readUInt32LE(0) === 0x04034b50) return "zip";
    if (bytesRead >= 2 && b[0] === 0x1f && b[1] === 0x8b) return "tgz";
    if (bytesRead >= 262 && b.subarray(257, 262).toString() === "ustar") return "tar";
    return null;
  } finally { await fh.close(); }
}

export async function sizeOf(file) { return (await stat(file)).size; }
