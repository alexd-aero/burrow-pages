import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.mjs";
import { Stats, agent, maskIp } from "../lib/stats.mjs";

test("tokens are sealed at rest and come back", () => {
  const d = mkdtempSync(join(tmpdir(), "bp-store-"));
  const s = new Store(d);
  s.setToken("github:me", "ghp_supersecret");
  assert.ok(!readFileSync(join(d, "secrets.json"), "utf8").includes("supersecret"));
  assert.equal(new Store(d).token("github:me"), "ghp_supersecret");
  s.setToken("github:me", null);
  assert.equal(s.token("github:me"), null);
});
test("activity is kept newest first", () => {
  const s = new Store(mkdtempSync(join(tmpdir(), "bp-store-")));
  s.activity({ site: "a", text: "one" }); s.activity({ site: "b", text: "two" });
  assert.deepEqual(s.recent().map((e) => e.text), ["two", "one"]);
  assert.deepEqual(s.recent({ site: "a" }).map((e) => e.text), ["one"]);
});
test("visitor numbers: no addresses kept, bots apart", () => {
  const st = new Stats(mkdtempSync(join(tmpdir(), "bp-stats-")));
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
  st.hit("x", { path: "/", status: 200, bytes: 100, ip: "198.51.100.7", ua, method: "GET" });
  st.hit("x", { path: "/about", status: 200, bytes: 50, ip: "198.51.100.7", ua, method: "GET" });
  st.hit("x", { path: "/", status: 200, bytes: 100, ip: "203.0.113.1", ua: "Googlebot/2.1", method: "GET" });
  const v = st.view("x", 1);
  assert.equal(v.totals.visitors, 1); assert.equal(v.totals.pageviews, 2); assert.equal(v.totals.bots, 1);
  assert.equal(v.devices[0].name, "Phone");
  st.flush();
  assert.ok(!JSON.stringify(readFileSync(join(st.dir, "x.json"), "utf8")).includes("198.51.100.7"));
  assert.equal(maskIp("198.51.100.7"), "198.51.100.0/24");
  assert.equal(agent("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537").browser, "Chrome");
});
