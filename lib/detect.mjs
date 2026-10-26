// What a repository (or an upload) is, from its file names and package.json:
// a site ready to serve as it is, or one that needs building first, and with
// what. Pure: it is handed the names and the package.json text.

export const CONTENT_DIRS = ["", "docs", "public", "dist", "site", "_site", "build", "out", "www", "html", "web"];

const NODE = "node:22-alpine";
// framework -> how it builds and where the site ends up
export const PRESETS = {
  vite:       { name: "Vite",          image: NODE, command: "build", output: "dist" },
  astro:      { name: "Astro",         image: NODE, command: "build", output: "dist" },
  next:       { name: "Next.js (static export)", image: NODE, command: "build", output: "out" },
  nuxt:       { name: "Nuxt",          image: NODE, command: "generate", output: ".output/public" },
  sveltekit:  { name: "SvelteKit (static)", image: NODE, command: "build", output: "build" },
  gatsby:     { name: "Gatsby",        image: NODE, command: "build", output: "public" },
  cra:        { name: "Create React App", image: NODE, command: "build", output: "build" },
  vuecli:     { name: "Vue CLI",       image: NODE, command: "build", output: "dist" },
  angular:    { name: "Angular",       image: NODE, command: "build", output: "dist" },
  eleventy:   { name: "Eleventy",      image: NODE, command: "build", output: "_site" },
  docusaurus: { name: "Docusaurus",    image: NODE, command: "build", output: "build" },
  vitepress:  { name: "VitePress",     image: NODE, command: "docs:build", output: "docs/.vitepress/dist" },
  parcel:     { name: "Parcel",        image: NODE, command: "build", output: "dist" },
  node:       { name: "npm build script", image: NODE, command: "build", output: "dist" },
  hugo:       { name: "Hugo",          image: "hugomods/hugo:exts", script: "hugo --minify", output: "public" },
  jekyll:     { name: "Jekyll",        image: "ruby:3.3-alpine", script: "apk add --no-cache build-base >/dev/null && (bundle install || gem install jekyll) && (bundle exec jekyll build || jekyll build)", output: "_site" },
  mkdocs:     { name: "MkDocs",        image: "python:3.12-alpine", script: "pip install --no-cache-dir -q mkdocs mkdocs-material $( [ -f requirements.txt ] && echo '-r requirements.txt' ) && mkdocs build", output: "site" },
};

const DEPS = [
  ["astro", "astro"], ["next", "next"], ["nuxt", "nuxt"], ["@sveltejs/kit", "sveltekit"], ["gatsby", "gatsby"],
  ["react-scripts", "cra"], ["@vue/cli-service", "vuecli"], ["@angular/core", "angular"], ["@11ty/eleventy", "eleventy"],
  ["@docusaurus/core", "docusaurus"], ["vitepress", "vitepress"], ["parcel", "parcel"], ["vite", "vite"],
];

function packageManager(files) {
  const has = (f) => files.includes(f);
  if (has("pnpm-lock.yaml")) return { pm: "pnpm", install: "corepack enable && pnpm install --frozen-lockfile", run: "pnpm run" };
  if (has("yarn.lock")) return { pm: "yarn", install: "corepack enable && yarn install --frozen-lockfile || yarn install", run: "yarn run" };
  if (has("bun.lockb") || has("bun.lock")) return { pm: "bun", install: "npm i -g bun >/dev/null && bun install", run: "bun run" };
  if (has("package-lock.json") || has("npm-shrinkwrap.json")) return { pm: "npm", install: "npm ci --no-audit --no-fund", run: "npm run" };
  return { pm: "npm", install: "npm install --no-audit --no-fund", run: "npm run" };
}

// files: every path in it (no leading /); pkg: package.json's text or null
export function detect(files, pkg = null) {
  const set = new Set(files);
  const has = (p) => set.has(p);
  const out = { kind: null, framework: null, dir: null, build: null, notes: [] };

  // a build config the repository has
  let json = null;
  try { json = pkg ? JSON.parse(pkg) : null; } catch { out.notes.push("package.json isn't valid JSON"); }
  const deps = { ...(json?.dependencies || {}), ...(json?.devDependencies || {}) };
  const scripts = json?.scripts || {};
  let fw = null;
  for (const [dep, id] of DEPS) if (dep in deps) { fw = id; break; }
  if (!fw && json && (scripts.build || scripts.generate)) fw = "node";
  if (!fw && (has("hugo.toml") || has("hugo.yaml") || has("hugo.json") || ((has("config.toml") || has("config.yaml")) && [...set].some((f) => f.startsWith("content/") || f.startsWith("layouts/") || f.startsWith("themes/"))))) fw = "hugo";
  if (!fw && has("mkdocs.yml")) fw = "mkdocs";
  const jekyll = has("_config.yml") || has("Gemfile") && [...set].some((f) => f.startsWith("_posts/") || f.startsWith("_layouts/"));
  if (!fw && jekyll) fw = "jekyll";

  // a folder that is already the site: an index.html that isn't a template
  const ready = CONTENT_DIRS.find((d) => has(d ? `${d}/index.html` : "index.html"));
  if (fw) {
    const p = PRESETS[fw];
    const pm = packageManager(files);
    const cmd = p.script || `${pm.install} && ${pm.run} ${scripts[p.command] ? p.command : scripts.build ? "build" : p.command}`;
    let output = p.output;
    if (fw === "angular" && json?.name) output = `dist/${json.name}/browser`;
    out.kind = "build"; out.framework = fw;
    out.build = { image: p.image, command: cmd, output, name: p.name };
    if (fw === "next") out.notes.push("Next.js builds a static site only with output: 'export' in next.config.");
    if (fw === "sveltekit") out.notes.push("SvelteKit needs @sveltejs/adapter-static.");
    // a committed build next to the sources: serving it needs no build at all
    if (ready !== undefined && ready !== "" && ["dist", "build", "out", "_site", "public", "site"].includes(ready) && fw !== "hugo") {
      out.notes.push(`A built copy is already committed in ${ready}/: it can be served as it is.`);
      out.prebuilt = ready;
    }
    return out;
  }
  if (ready !== undefined) {
    out.kind = "static"; out.dir = ready;
    return out;
  }
  out.kind = null;
  out.notes.push("No index.html and no build setup this host knows.");
  return out;
}

// A name for the subdomain: owner/My_Cool.Site -> my-cool-site
export function subFrom(name) {
  const s = String(name || "").split("/").pop().toLowerCase().replace(/\.github\.io$|\.gitlab\.io$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "site";
}
