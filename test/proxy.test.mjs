import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { proxyServer, parseUpstream, cleanPath } from "../lib/proxy.mjs";

let up, upPort, px, base, down = false, seen = [];
const site = { id: "p1", proxy: {}, serving: {}, maintenance: { on: false } };
before(async () => {
  up = createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie || "", xff: req.headers["x-forwarded-for"] || "" });
    if (down) { res.writeHead(500); return res.end("broken"); }
    if (req.url === "/proj/go") { res.writeHead(302, { location: `http://127.0.0.1:${upPort}/proj/there` }); return res.end(); }
    if (req.url === "/proj/vary") { res.writeHead(200, { "content-type": "text/plain", vary: "Cookie" }); return res.end(`vary ${seen.length}`); }
    if (req.url === "/proj/page") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<a href="http://127.0.0.1:${upPort}/proj/x">x</a>`); }
    res.writeHead(200, { "content-type": "text/plain" }); res.end(`upstream ${req.url}`);
  });
  await new Promise((ok) => up.listen(0, "127.0.0.1", ok));
  upPort = up.address().port;
  site.proxy = { upstream: `http://127.0.0.1:${upPort}/proj/`, cacheSeconds: 0 };
  px = proxyServer({ site: () => site });
  await new Promise((ok) => px.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${px.address().port}`;
});
after(() => { up.close(); px.close(); });

test("addresses people paste", () => {
  assert.equal(parseUpstream("group.gitlab.io/proj").url, "https://group.gitlab.io/proj/");
  assert.throws(() => parseUpstream("http://169.254.169.254/latest/"), /off limits/);
  assert.throws(() => parseUpstream("https://user:pw@x.com/"), /sign-in/);
});
test("paths map onto the base; redirects come back as ours", async () => {
  assert.equal(await (await fetch(base + "/a/b?c=1")).text(), "upstream /proj/a/b?c=1");
  const r = await fetch(base + "/go", { redirect: "manual" }); assert.equal(r.headers.get("location"), "/there");
});
test("the gate's cookies and the visitor's address stay here", async () => {
  await fetch(base + "/c", { headers: { cookie: "__Host-aegis=secret; theme=dark", "x-forwarded-for": "203.0.113.9" } });
  const last = seen.at(-1);
  assert.equal(last.cookie, "theme=dark"); assert.equal(last.xff, ""); assert.equal(last.host, `127.0.0.1:${upPort}`);
});
test("links rewritten when asked", async () => {
  site.proxy.rewriteLinks = true;
  assert.equal(await (await fetch(base + "/page")).text(), `<a href="/x">x</a>`);
  site.proxy.rewriteLinks = false;
});
test("the cache rides out an outage", async () => {
  site.proxy.cacheSeconds = 1;
  await fetch(base + "/cached");
  down = true;
  await new Promise((ok) => setTimeout(ok, 1100));
  const r = await fetch(base + "/cached");
  assert.equal(r.status, 200); assert.equal(r.headers.get("x-burrow-pages-cache"), "stale"); assert.equal(await r.text(), "upstream /proj/cached");
  down = false; site.proxy.cacheSeconds = 0;
});

test("no walking out of the base path upstream", async () => {
  // raw requests: fetch would tidy "/../" away before sending
  const raw = (p) => new Promise((ok) => { const r = request(base + "/", { path: p }, (x) => { x.resume(); ok(x.statusCode); }); r.on("error", () => ok(0)); r.end(); });
  for (const p of ["/../admin", "/%2e%2e/admin", "/..%2fadmin", "/a/%2F/b", "/a/./b"]) assert.equal(await raw(p), 400, p);
  assert.equal(cleanPath("/../x"), null); assert.equal(cleanPath("/%2e%2e/x"), null); assert.equal(cleanPath("/ok/x?a=1"), "/ok/x?a=1");
  assert.ok(!seen.some((x) => x.url.includes("..")));
});
test("pages for one visitor are never cached for everyone", async () => {
  site.proxy.cacheSeconds = 60;
  const n0 = seen.length;
  await fetch(base + "/mine", { headers: { cookie: "session=alice" } });
  await fetch(base + "/mine");
  assert.equal(seen.length - n0, 2);                   // the cookie request wasn't cached
  const a = await (await fetch(base + "/vary")).text(), b = await (await fetch(base + "/vary")).text();
  assert.notEqual(a, b);                               // Vary: Cookie isn't cached
  site.proxy.cacheSeconds = 0;
});
