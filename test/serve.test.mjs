import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { siteServer } from "../lib/serve.mjs";

const root = mkdtempSync(join(tmpdir(), "bp-serve-"));
const site = { id: "s1", serving: { spa: false, cleanUrls: true, trailingSlash: true, redirects: "/old /new.html 301\n/blog/* /posts/:splat 301", headers: "/*\n  X-Test: yes" }, maintenance: { on: false } };
let srv, base, hits = [];
before(async () => {
  mkdirSync(join(root, "docs"), { recursive: true }); mkdirSync(join(root, ".git")); mkdirSync(join(root, ".well-known"));
  writeFileSync(join(root, "index.html"), "<h1>home</h1>" + "x".repeat(3000));
  writeFileSync(join(root, "about.html"), "about");
  writeFileSync(join(root, "new.html"), "new");
  writeFileSync(join(root, "docs/index.html"), "docs");
  writeFileSync(join(root, "404.html"), "custom 404");
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(root, ".git/config"), "[core]");
  writeFileSync(join(root, ".well-known/security.txt"), "contact");
  writeFileSync(join(root, "_redirects"), "/r /about 302");
  writeFileSync(join(root, "video.mp4"), Buffer.alloc(10000, 1));
  writeFileSync(join(root, "app.3f9a2c1d.js"), "console.log(1)");
  symlinkSync("/etc/passwd", join(root, "leak"));
  srv = siteServer({ site: () => site, root: () => root, onHit: (r) => hits.push(r) });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());
const get = (p, h = {}) => fetch(base + p, { headers: h, redirect: "manual" });

test("pages, clean URLs and folders", async () => {
  assert.equal((await get("/")).status, 200);
  assert.equal(await (await get("/about")).text(), "about");
  const r = await get("/docs"); assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/docs/");
  assert.equal(await (await get("/docs/")).text(), "docs");
});
test("never served: dotfiles, links out, rule files", async () => {
  for (const p of ["/.env", "/.git/config", "/leak", "/_redirects", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd"]) {
    const r = await get(p); assert.equal(r.status, 404, p); assert.equal(await r.text(), "custom 404", p);
  }
  assert.equal(await (await get("/.well-known/security.txt")).text(), "contact");
});
test("redirects from the dashboard and from _redirects; headers", async () => {
  const a = await get("/old"); assert.equal(a.status, 301); assert.equal(a.headers.get("location"), "/new.html");
  const b = await get("/r"); assert.equal(b.status, 302); assert.equal(b.headers.get("location"), "/about");
  assert.equal((await get("/")).headers.get("x-test"), "yes");
  assert.equal((await get("/")).headers.get("x-content-type-options"), "nosniff");
});
test("SPA mode", async () => {
  assert.equal((await get("/some/route")).status, 404);
  site.serving.spa = true;
  const r = await get("/some/route"); assert.equal(r.status, 200); assert.match(await r.text(), /home/);
  assert.equal((await get("/missing.png")).status, 404);
  site.serving.spa = false;
});
test("caching, compression and ranges", async () => {
  const a = await get("/");
  assert.equal(a.headers.get("cache-control"), "no-cache");
  const etag = a.headers.get("etag");
  assert.equal((await get("/", { "if-none-match": etag })).status, 304);
  assert.match((await get("/app.3f9a2c1d.js")).headers.get("cache-control"), /immutable/);
  const z = await fetch(base + "/", { headers: { "accept-encoding": "br" } });
  assert.equal(z.headers.get("content-encoding"), "br");
  const g = await fetch(base + "/", { headers: { "accept-encoding": "gzip" } });
  assert.equal(g.headers.get("content-encoding"), "gzip");
  const r = await get("/video.mp4", { range: "bytes=100-199" });
  assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), "bytes 100-199/10000"); assert.equal((await r.arrayBuffer()).byteLength, 100);
});
test("only GET and HEAD; maintenance", async () => {
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  site.maintenance = { on: true, title: "Back <soon>", message: "x" };
  const r = await get("/"); assert.equal(r.status, 503); assert.match(await r.text(), /Back &lt;soon&gt;/);
  site.maintenance = { on: false };
});
test("every request is counted", () => assert.ok(hits.length > 10 && hits.every((x) => typeof x.status === "number")));

test("odd characters in a redirect's splat never crash the server (they're encoded)", async () => {
  for (const p of ["/blog/%E2%82%AC", "/blog/a%0d%0aSet-Cookie:%20x=1", "/blog/%01", "/blog/a?b#c"]) {
    const r = await get(p);
    assert.equal(r.status, 301, p);
    assert.ok(!/[\r\n]/.test(r.headers.get("location")), p);
    assert.ok(!r.headers.get("set-cookie"), p);
  }
  assert.equal((await get("/")).status, 200);          // still alive
});
test("the rule files can't be fetched by any spelling", async () => {
  for (const p of ["/_headers", "/_headers/", "//_headers", "/%2F_headers", "/x/../_redirects", "/_redirects/."]) assert.equal((await get(p)).status, 404, p);
});
