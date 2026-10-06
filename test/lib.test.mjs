import { test } from "node:test";
import assert from "node:assert/strict";
import { branchOrder, countFromLink, detectSetups, pickContent, smartSort, subFromRepo } from "../burrow/lib.mjs";

const DAY = 864e5, NOW = Date.parse("2026-10-06T12:00:00Z");

test("smart sort: commits and recent activity first; forks and archives sink", () => {
  const r = (full, o) => ({ full, pushed: NOW - (o.days ?? 1) * DAY, commits: o.commits ?? 10, ...o });
  const out = smartSort([
    r("me/old-big", { days: 400, commits: 900 }),
    r("me/fresh-small", { days: 0, commits: 3 }),
    r("me/active", { days: 2, commits: 400 }),
    r("me/fork", { days: 1, commits: 400, fork: true }),
    r("me/dead", { days: 1, commits: 400, archived: true }),
  ], NOW).map((x) => x.full);
  assert.equal(out[0], "me/active");
  assert.ok(out.indexOf("me/fork") > out.indexOf("me/active"));
  assert.ok(out.indexOf("me/dead") > out.indexOf("me/fork"), "archived below a fork of the same size");
});

test("commits from GitHub's Link header", () => {
  assert.equal(countFromLink('<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=1234>; rel="last"', 1), 1234);
  assert.equal(countFromLink(null, 1), 1);
  assert.equal(countFromLink("", 0), 0);
});

test("which accounts the domain points at", () => {
  const s = detectSetups([
    { type: "CNAME", name: "www.example.com", content: "Alexd-Aero.github.io" },
    { type: "A", name: "example.com", content: "185.199.108.153" },
    { type: "TXT", name: "_github-pages-challenge-alexd-aero.example.com", content: "\"abc\"" },
    { type: "CNAME", name: "docs.example.com", content: "mygroup.gitlab.io" },
    { type: "CNAME", name: "aegis.example.com", content: "x.cfargotunnel.com" },
    { type: "MX", name: "example.com", content: "mail.example.com" },
  ]);
  const gh = s.find((x) => x.provider === "github");
  assert.equal(gh.account, "alexd-aero");
  assert.deepEqual(gh.names.sort(), ["example.com", "www.example.com"]);
  assert.ok(gh.how.includes("verified"));
  assert.equal(s.filter((x) => x.provider === "github").length, 1, "the apex joins the verified account");
  assert.equal(s.find((x) => x.provider === "gitlab").account, "mygroup");
  assert.equal(detectSetups([{ type: "A", name: "example.com", content: "185.199.110.153" }])[0].account, null);
  assert.deepEqual(detectSetups([]), []);
});

test("what to serve, and from which branch", () => {
  const files = (...p) => (x) => p.includes(x);
  assert.equal(pickContent(files("index.html", "docs/index.html")), "");
  assert.equal(pickContent(files("docs/index.html")), "docs");
  assert.equal(pickContent(files("dist/index.html", "README.md")), "dist");
  assert.equal(pickContent(files("README.md")), null);
  assert.deepEqual(branchOrder(["main", "gh-pages", "dev"], "main"), ["gh-pages", "main"]);
  assert.deepEqual(branchOrder(["main"], "main"), ["main"]);
});

test("a subdomain from a repository's name", () => {
  assert.equal(subFromRepo("My_Cool.Site"), "my-cool-site");
  assert.equal(subFromRepo("alexd-aero.github.io"), "alexd-aero");
  assert.equal(subFromRepo("---"), "site");
  assert.equal(subFromRepo("x".repeat(60)).length, 40);
});
