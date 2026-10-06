// Burrow Pages: the pure parts (no network, no files), so they can be tested.

// ------------------------------------------------------------------ smart sorting
// Repositories you'd want to deploy first: the ones with the most commits and
// the most recent activity. Stars and an existing Pages site help a little;
// forks and archived ones sink.
export function score(r, now = Date.now()) {
  const days = r.pushed ? Math.max(0, (now - r.pushed) / 864e5) : 3650;
  return 3 * Math.log2(1 + (r.commits || 0))
       + 6 * Math.exp(-days / 30)
       + 1.5 * Math.log2(1 + (r.stars || 0))
       + (r.pages ? 2 : 0) + (r.hasIndex ? 1 : 0)
       - (r.fork ? 3 : 0) - (r.archived ? 4 : 0);
}
export function smartSort(repos, now = Date.now()) {
  return repos.map((r) => ({ ...r, score: Math.round(score(r, now) * 100) / 100 }))
    .sort((a, b) => b.score - a.score || (b.pushed || 0) - (a.pushed || 0) || a.full.localeCompare(b.full));
}

// The number of commits from a GitHub list call with per_page=1: the last
// page's number in its Link header is the count.
export function countFromLink(link, got) {
  const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link || "");
  return m ? Number(m[1]) : got;
}

// ------------------------------------------------------------------ the domain
// Does this domain already point somewhere at GitHub or GitLab Pages, and for
// which account? From its DNS records:
//   CNAME x -> USER.github.io                 GitHub, USER
//   TXT _github-pages-challenge-USER.x        GitHub, USER (a verified domain)
//   A 185.199.108-111.153, AAAA 2606:50c0:800N::153   GitHub (the apex; account from a challenge record)
//   CNAME x -> GROUP.gitlab.io                GitLab, GROUP
//   A 35.185.44.232, TXT _gitlab-pages-verification-code.x   GitLab
const GH_A = /^185\.199\.(108|109|110|111)\.153$/, GH_AAAA = /^2606:50c0:800[0-3]::153$/i, GL_A = /^35\.185\.44\.232$/;
export function detectSetups(records) {
  const out = new Map();     // "github:user" -> {provider, account, names}
  const add = (provider, account, name, how) => {
    const k = `${provider}:${account || ""}`;
    const s = out.get(k) || { provider, account: account || null, names: [], how: [] };
    if (!s.names.includes(name)) s.names.push(name);
    if (!s.how.includes(how)) s.how.push(how);
    out.set(k, s);
  };
  for (const r of records || []) {
    const name = String(r.name || "").toLowerCase(), c = String(r.content || "").toLowerCase().replace(/\.$/, "").replace(/^"|"$/g, "");
    let m;
    if (r.type === "CNAME" && (m = /^([a-z0-9-]+)\.github\.io$/.exec(c))) add("github", m[1], name, "CNAME");
    else if (r.type === "CNAME" && (m = /^([a-z0-9._-]+)\.gitlab\.io$/.exec(c))) add("gitlab", m[1], name, "CNAME");
    else if (r.type === "TXT" && (m = /^_github-pages-challenge-([a-z0-9-]+)\.(.+)$/.exec(name))) add("github", m[1], m[2], "verified");
    else if (r.type === "TXT" && (m = /^_gitlab-pages-verification-code\.(.+)$/.exec(name))) add("gitlab", null, m[1], "verified");
    else if ((r.type === "A" && GH_A.test(c)) || (r.type === "AAAA" && GH_AAAA.test(c))) add("github", null, name, "A");
    else if (r.type === "A" && GL_A.test(c)) add("gitlab", null, name, "A");
  }
  // an apex pointed at GitHub without a name: the verified account is the one
  const list = [...out.values()];
  for (const s of list.filter((x) => !x.account)) {
    const named = list.filter((x) => x.provider === s.provider && x.account);
    if (named.length === 1) { for (const n of s.names) if (!named[0].names.includes(n)) named[0].names.push(n); named[0].how.push(...s.how); s.merged = true; }
  }
  return list.filter((s) => !s.merged).map(({ merged, ...s }) => s);
}

// ------------------------------------------------------------------ what to serve
// The folder of a repository that is the website: the first of these holding
// an index.html. (Burrow serves files as they are; a site that needs a build
// step has to have its built output committed, e.g. on a gh-pages branch.)
export const CONTENT_DIRS = ["", "docs", "public", "dist", "site", "_site", "build", "out", "www", "html"];
export function pickContent(hasFile) {
  for (const d of CONTENT_DIRS) if (hasFile(d ? `${d}/index.html` : "index.html")) return d;
  return null;
}
// the branch to try first: a Pages branch, then the default one
export function branchOrder(branches, def) {
  const have = new Set(branches);
  return [...new Set(["gh-pages", "pages", def].filter((b) => b && have.has(b)))].concat(have.has(def) ? [] : [def]).filter(Boolean);
}

// ------------------------------------------------------------------ names
// owner/My_Cool.Site -> my-cool-site (a subdomain Burrow takes)
export function subFromRepo(name) {
  const s = String(name || "").toLowerCase().replace(/\.github\.io$|\.gitlab\.io$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "site";
}

// ------------------------------------------------------------------ files
export const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".csv": "text/csv",
};
