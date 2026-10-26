import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRedirects, matchRedirect, parseHeaders, headersFor, isHashed, compilePath } from "../lib/rules.mjs";

test("paths with placeholders and a splat", () => {
  assert.deepEqual(compilePath("/blog/:year/*")("/blog/2026/a/b"), { year: "2026", splat: "a/b" });
  assert.deepEqual(compilePath("/a/*")("/a"), { splat: "" });
  assert.equal(compilePath("/a/:x")("/a/b/c"), null);
});

test("redirects: status, force, splats, and a real file wins", () => {
  const { rules, errors } = parseRedirects("/old /new\n/blog/* /posts/:splat 302\n/app/* /app/index.html 200\n/gone / 301!\nbad\n/x https://e.com 200\n/y ftp://z");
  assert.equal(rules.length, 4);
  assert.equal(errors.length, 3);
  const has = (p) => p === "/gone" || p === "/app/real.js";
  assert.deepEqual(pick(matchRedirect(rules, "/old", has)), { to: "/new", status: 301 });
  assert.deepEqual(pick(matchRedirect(rules, "/blog/2026/hi", has)), { to: "/posts/2026/hi", status: 302 });
  assert.equal(matchRedirect(rules, "/app/real.js", has), null);
  assert.deepEqual(pick(matchRedirect(rules, "/app/deep/route", has)), { to: "/app/index.html", status: 200 });
  assert.deepEqual(pick(matchRedirect(rules, "/gone", has)), { to: "/", status: 301 });
});
const pick = (r) => r && { to: r.to, status: r.status };

test("a redirect can't become protocol-relative", () => {
  const { rules } = parseRedirects("/go/* /:splat 302");
  assert.equal(matchRedirect(rules, "/go//evil.example", () => false).to, "/evil.example");
});

test("headers: per path, and the dangerous ones refused", () => {
  const { blocks, errors } = parseHeaders("/*\n  X-Frame-Options: DENY\n  Set-Cookie: a=b\n/assets/*\n  Cache-Control: max-age=60\nX-Orphan: 1");
  assert.equal(errors.length, 2);
  assert.deepEqual(headersFor(blocks, "/assets/a.js"), { "x-frame-options": "DENY", "cache-control": "max-age=60" });
  assert.deepEqual(headersFor(blocks, "/"), { "x-frame-options": "DENY" });
});

test("hashed build files", () => {
  assert.ok(isHashed("/assets/index-BxY7_a9Q.js"));
  assert.ok(isHashed("/app.3f9a2c1d.css"));
  assert.ok(!isHashed("/my-component.js"));
  assert.ok(!isHashed("/jquery.min.js"));
});

test("header values a server can't send are refused, not crashed on later", () => {
  const { blocks, errors } = parseHeaders("/*\n  X-A: caf\u00e9 ok\n  X-B: euro \u20ac\n  X-C: ctl \u0001");
  assert.equal(blocks[0].headers.length, 1);
  assert.equal(errors.length, 2);
  assert.equal(parseRedirects("/a /\u20ac 301").rules.length, 0);
});
