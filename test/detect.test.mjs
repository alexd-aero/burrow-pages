import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, subFrom } from "../lib/detect.mjs";

test("a plain static site, at the top or in docs/", () => {
  assert.deepEqual([detect(["index.html", "a.css"]).kind, detect(["index.html"]).dir], ["static", ""]);
  assert.equal(detect(["README.md", "docs/index.html"]).dir, "docs");
});
test("frameworks and their output", () => {
  const vite = detect(["package.json", "src/main.js", "index.html", "pnpm-lock.yaml"], JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }));
  assert.equal(vite.kind, "build"); assert.equal(vite.framework, "vite"); assert.equal(vite.build.output, "dist"); assert.match(vite.build.command, /pnpm/);
  assert.equal(detect(["package.json"], JSON.stringify({ dependencies: { astro: "4" }, scripts: { build: "astro build" } })).framework, "astro");
  assert.equal(detect(["hugo.toml", "content/a.md"]).framework, "hugo");
  assert.equal(detect(["_config.yml", "_posts/a.md", "index.html"]).framework, "jekyll");
  assert.equal(detect(["mkdocs.yml", "docs/index.md"]).framework, "mkdocs");
  const pre = detect(["package.json", "dist/index.html"], JSON.stringify({ devDependencies: { vite: "5" }, scripts: { build: "vite build" } }));
  assert.equal(pre.prebuilt, "dist");
});
test("nothing to serve", () => assert.equal(detect(["main.py", "README.md"]).kind, null));
test("names", () => { assert.equal(subFrom("me/My_Cool.Site"), "my-cool-site"); assert.equal(subFrom("me/me.github.io"), "me"); });
