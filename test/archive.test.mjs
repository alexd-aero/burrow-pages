import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync, deflateRawSync } from "node:zlib";
import { untar, unzip, safeName, sniff } from "../lib/archive.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "bp-arch-"));
// a tar entry made by hand, so it can be as hostile as we like
function entry(name, body = "", type = "0", link = "") {
  const h = Buffer.alloc(512), data = Buffer.from(body);
  h.write(name.slice(0, 100), 0); h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(data.length.toString(8).padStart(11, "0") + "\0", 124); h.write("00000000000\0", 136);
  h.write("        ", 148); h.write(type, 156); h.write(link, 157); h.write("ustar\0" + "00", 257);
  let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const tgz = (...parts) => gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

test("safe names", () => {
  assert.equal(safeName("a/./b//c"), "a/b/c");
  assert.equal(safeName("../x"), "x");                 // stays inside
  assert.equal(safeName("/etc/passwd"), "etc/passwd");
  assert.equal(safeName("a\\b"), null);
  assert.equal(safeName("a\0"), null);
});

test("tar.gz: files land, the top folder is stripped, hostile entries don't", async () => {
  const d = tmp();
  const buf = tgz(entry("repo-abc/index.html", "<h1>hi</h1>"), entry("repo-abc/css/a.css", "b{}"), entry("repo-abc/../../escape.txt", "no"),
                  entry("repo-abc/link", "", "2", "/etc/passwd"), entry("repo-abc/hard", "", "1", "repo-abc/index.html"), entry("repo-abc/dir/", "", "5"));
  const r = await untar(Readable.from([buf]), d, { strip: 1 });
  assert.equal(readFileSync(join(d, "index.html"), "utf8"), "<h1>hi</h1>");
  assert.equal(readFileSync(join(d, "css/a.css"), "utf8"), "b{}");
  assert.ok(!existsSync(join(d, "link")) && !existsSync(join(d, "hard")));
  assert.ok(!existsSync(join(d, "..", "escape.txt")));
  assert.ok(r.files >= 2);
  rmSync(d, { recursive: true, force: true });
});

test("tar.gz: limits count what comes out", async () => {
  const d = tmp();
  const big = entry("x/a.bin", "a".repeat(5000));
  await assert.rejects(untar(Readable.from([tgz(big)]), d, { strip: 1, limits: { maxFile: 1000 } }), /over/);
  await assert.rejects(untar(Readable.from([tgz(entry("x/a", "1"), entry("x/b", "2"), entry("x/c", "3"))]), tmp(), { strip: 1, limits: { maxFiles: 2 } }), /more than 2 files/);
  rmSync(d, { recursive: true, force: true });
});

// a zip made by hand: stored or deflated entries, optional symlink attribute
function zip(files) {
  const locals = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = Buffer.from(f.body || ""), data = f.deflate ? deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(f.claim ?? raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((f.link ? 0o120777 : 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("zip: stored and deflated, one top folder stripped, links and traversal skipped", async () => {
  const d = tmp(), f = join(tmp(), "a.zip");
  writeFileSync(f, zip([{ name: "site/index.html", body: "<p>z</p>", deflate: true }, { name: "site/img/a.txt", body: "plain" },
                        { name: "site/evil", body: "/etc/passwd", link: true }, { name: "site/../../x.txt", body: "no" }]));
  assert.equal(await sniff(f), "zip");
  await unzip(f, d);
  assert.equal(readFileSync(join(d, "index.html"), "utf8"), "<p>z</p>");
  assert.equal(readFileSync(join(d, "img/a.txt"), "utf8"), "plain");
  assert.ok(!existsSync(join(d, "evil")));
  // "site/../../x.txt" is cleaned to x.txt, inside: nothing lands outside the folder
  assert.deepEqual(readdirSync(d).sort(), ["img", "index.html", "x.txt"]);
  assert.ok(!existsSync(join(d, "..", "x.txt")));
});

test("zip: a file bigger than it claims is refused (zip bomb)", async () => {
  const f = join(tmp(), "b.zip");
  writeFileSync(f, zip([{ name: "x.txt", body: "a".repeat(200000), deflate: true, claim: 10 }]));
  await assert.rejects(unzip(f, tmp()), /bigger than it says|over/);
});
