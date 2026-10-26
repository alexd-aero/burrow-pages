// GitHub and GitLab: who you are, your repositories, their branches, their
// newest commit, their files, and a download of any of them.
//
// Sign-in: GitHub's device flow (a code you enter at github.com/login/device;
// no password or token is typed here) or a personal access token, for either.
// Without one, public repositories of any account still work.

import { get as httpsGet } from "node:https";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GH = process.env.BURROW_PAGES_GITHUB || "https://github.com";
const GH_API = process.env.BURROW_PAGES_GITHUB_API || "https://api.github.com";
const GL = process.env.BURROW_PAGES_GITLAB || "https://gitlab.com";
const GL_API = `${GL}/api/v4`;
let UA = "burrow-pages/2";
export const setAgent = (ua) => { UA = ua; };

export const NAME = { github: "GitHub", gitlab: "GitLab", url: "Git" };
export const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]{1,100}){0,4}$/;
export const REPO_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,6}$/;
export const BRANCH_RE = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._\/+-]{1,200}$/;

const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
const OAUTH = {
  device_flow_disabled: "Device Flow is off for this GitHub app: tick “Enable Device Flow” on it (github.com/settings/developers), then sign in again.",
  incorrect_client_credentials: "GitHub doesn't know that app's client ID. Check it under Settings → GitHub app.",
  unsupported_grant_type: "GitHub didn't accept the sign-in request.",
};

export async function call(url, { token, provider = "github", method = "GET", body, accept = "application/json", raw, timeout = 20000, etag, form } = {}) {
  const headers = { "user-agent": UA, accept };
  if (provider === "github" && url.startsWith(GH_API)) headers["x-github-api-version"] = "2022-11-28";
  // GitHub: a bearer token. GitLab: a personal access token goes in its own header.
  if (token && provider === "gitlab") headers["private-token"] = token;
  else if (token) headers.authorization = `Bearer ${token}`;
  if (etag) headers["if-none-match"] = etag;
  let payload;
  if (form) { headers["content-type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, { method, headers, body: payload, redirect: "follow", signal: AbortSignal.timeout(timeout) }); }
  catch (e) { fail(502, `${new URL(url).host} didn't answer (${e.cause?.code || e.name === "TimeoutError" ? "timed out" : e.message}).`); }
  if (raw) return r;
  if (r.status === 304) return { notModified: true, headers: r.headers, json: null };
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const who = NAME[provider] || new URL(url).host;
    if ((r.status === 403 || r.status === 429) && r.headers.get("x-ratelimit-remaining") === "0") {
      const at = new Date(Number(r.headers.get("x-ratelimit-reset")) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      fail(429, `${who}'s request limit is used up until ${at}.${token ? "" : " Signing in gives you far more."}`);
    }
    // not a 401: that would read as "your dashboard session ended". The account needs signing in again.
    if (r.status === 401) { const e = new Error(`${who} refused this account's sign-in (it expired or was revoked). Sign in to it again.`); e.status = 424; e.code = "reauth"; throw e; }
    const why = j && (OAUTH[j.error] || j.error_description || j.message || j.error);
    fail(r.status === 404 ? 404 : r.status < 500 ? 400 : 502, why ? `${who}: ${typeof why === "string" ? why : JSON.stringify(why)}` : `${who} answered HTTP ${r.status}.`);
  }
  return { json: j, headers: r.headers };
}
const gh = async (path, o = {}) => (await call(path.startsWith("http") ? path : GH_API + path, { ...o, provider: "github" })).json;
const gl = async (path, o = {}) => (await call(path.startsWith("http") ? path : GL_API + path, { ...o, provider: "gitlab" })).json;
const glId = (full) => encodeURIComponent(full);

// ------------------------------------------------------------------ accounts
export async function whoami(provider, token) {
  if (provider === "github") {
    const res = await call(`${GH_API}/user`, { token, provider });
    const u = res.json;
    return { username: u.login, name: u.name || "", avatar: u.avatar_url || "", kind: "user", scopes: res.headers.get("x-oauth-scopes") || "" };
  }
  const u = await gl("/user", { token });
  return { username: u.username, name: u.name || "", avatar: u.avatar_url || "", kind: "user", glid: u.id, scopes: "" };
}

export async function lookup(provider, username) {
  username = String(username || "").trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?(?:github|gitlab)\.com\//i, "").replace(/\/+$/, "");
  if (provider === "github") username = username.split("/")[0];
  if (!USER_RE.test(username)) fail(400, "That doesn't look like a username.");
  if (provider === "github") {
    const u = await gh(`/users/${encodeURIComponent(username)}`).catch((e) => { if (e.status === 404) fail(404, `There is no GitHub account called ${username}.`); throw e; });
    return { username: u.login, name: u.name || "", avatar: u.avatar_url || "", kind: u.type === "Organization" ? "org" : "user" };
  }
  const users = await gl(`/users?username=${encodeURIComponent(username)}`);
  if (users?.length) return { username: users[0].username, name: users[0].name || "", avatar: users[0].avatar_url || "", kind: "user", glid: users[0].id };
  const g = await gl(`/groups/${encodeURIComponent(username)}`).catch(() => null);
  if (!g) fail(404, `There is no GitLab user or group called ${username}.`);
  return { username: g.full_path, name: g.name || "", avatar: g.avatar_url || "", kind: "group", glid: g.id };
}

// ------------------------------------------------------------------ GitHub device flow
export async function deviceStart(clientId) {
  if (!clientId) fail(409, "GitHub sign-in needs a GitHub app's client ID (Settings → GitHub app). A token or a username works without one.");
  const { json: d } = await call(`${GH}/login/device/code`, { method: "POST", form: { client_id: clientId, scope: "repo read:user" } })
    .catch((e) => { if (e.status === 404) fail(400, OAUTH.incorrect_client_credentials); throw e; });
  if (!d?.device_code) fail(502, d?.error_description || "GitHub didn't give a code.");
  return { clientId, code: d.device_code, user_code: d.user_code, uri: d.verification_uri || `${GH}/login/device`,
           expires: Date.now() + (d.expires_in || 900) * 1000, interval: Math.max(5, d.interval || 5) };
}
// one poll: {token} | {wait} | {slower} | {error}
export async function devicePoll(dv) {
  const { json: t } = await call(`${GH}/login/oauth/access_token`, { method: "POST",
    form: { client_id: dv.clientId, device_code: dv.code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" } });
  if (t?.access_token) return { token: t.access_token, scopes: t.scope || "" };
  if (t?.error === "authorization_pending") return { wait: true };
  if (t?.error === "slow_down") return { slower: true };
  if (t?.error === "expired_token") return { error: "The code expired. Start again." };
  if (t?.error === "access_denied") return { error: "You said no on GitHub." };
  return { error: OAUTH[t?.error] || t?.error_description || t?.error || "GitHub didn't answer the sign-in." };
}

// ------------------------------------------------------------------ repositories
function shapeGh(r) {
  return { provider: "github", full: r.full_name, name: r.name, owner: r.owner?.login || "", private: !!r.private, description: r.description || "",
           pushed: Date.parse(r.pushed_at) || 0, stars: r.stargazers_count || 0, fork: !!r.fork, archived: !!r.archived, language: r.language || "",
           branch: r.default_branch || "main", pages: !!r.has_pages, size: r.size || 0, url: r.html_url, topics: r.topics || [] };
}
function shapeGl(p) {
  return { provider: "gitlab", full: p.path_with_namespace, name: p.name, owner: p.namespace?.full_path || "", private: p.visibility !== "public",
           description: p.description || "", pushed: Date.parse(p.last_activity_at) || 0, stars: p.star_count || 0, fork: !!p.forked_from_project,
           archived: !!p.archived, language: "", branch: p.default_branch || "main", pages: false, size: 0, url: p.web_url, topics: p.topics || [], glid: p.id };
}

// The ones you'd want first: most commits, most recent activity. Stars and
// an existing Pages site help a little; forks and archived ones sink.
export function score(r, now = Date.now()) {
  const days = r.pushed ? Math.max(0, (now - r.pushed) / 864e5) : 3650;
  return 3 * Math.log2(1 + (r.commits || 0)) + 6 * Math.exp(-days / 30) + 1.5 * Math.log2(1 + (r.stars || 0))
       + (r.pages ? 2 : 0) + (["HTML", "CSS", "SCSS", "Vue", "Svelte", "Astro", "TypeScript", "JavaScript"].includes(r.language) ? 1 : 0)
       - (r.fork ? 3 : 0) - (r.archived ? 4 : 0);
}
export const smartSort = (list, now = Date.now()) => list.map((r) => ({ ...r, score: Math.round(score(r, now) * 100) / 100 }))
  .sort((a, b) => b.score - a.score || b.pushed - a.pushed || a.full.localeCompare(b.full));
export function countFromLink(link, got) { const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link || ""); return m ? Number(m[1]) : got; }

export async function repos(acct, token) {
  let list = [];
  if (acct.provider === "github") {
    const base = token ? "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100"
                       : `/${acct.kind === "org" ? "orgs" : "users"}/${encodeURIComponent(acct.username)}/repos?sort=pushed&per_page=100${acct.kind === "org" ? "" : "&type=owner"}`;
    for (let page = 1; page <= 5; page++) {
      const got = await gh(`${base}&page=${page}`, { token });
      list.push(...got.map(shapeGh));
      if (got.length < 100) break;
    }
    const top = [...list].sort((x, y) => y.pushed - x.pushed).slice(0, token ? 40 : 12);
    await Promise.all(top.map(async (r, i) => {
      await new Promise((ok) => setTimeout(ok, (i % 8) * 50));
      try {
        const res = await call(`${GH_API}/repos/${r.full}/commits?per_page=1`, { token, raw: true });
        if (res.status === 409) { r.commits = 0; return; }
        if (!res.ok) return;
        const body = await res.json().catch(() => []);
        r.commits = countFromLink(res.headers.get("link"), Array.isArray(body) ? body.length : 0);
      } catch { /* unknown */ }
    }));
  } else {
    const path = token && acct.self ? "/projects?membership=true&statistics=true"
      : acct.kind === "group" ? `/groups/${acct.glid}/projects?include_subgroups=true` : `/users/${acct.glid || encodeURIComponent(acct.username)}/projects?`;
    for (let page = 1; page <= 5; page++) {
      const got = await gl(`${path}${path.includes("?") ? "&" : "?"}order_by=last_activity_at&per_page=100&page=${page}`, { token });
      list.push(...got.map((p) => ({ ...shapeGl(p), commits: p.statistics?.commit_count ?? undefined })));
      if (got.length < 100) break;
    }
    const top = [...list].filter((r) => r.commits == null).sort((x, y) => y.pushed - x.pushed).slice(0, 20);
    await Promise.all(top.map(async (r) => {
      try {
        const res = await call(`${GL_API}/projects/${r.glid}/repository/commits?per_page=1`, { token, provider: "gitlab", raw: true });
        const n = res.headers.get("x-total"); if (res.ok && n) r.commits = Number(n);
        await res.body?.cancel();
      } catch { /* unknown */ }
    }));
  }
  return smartSort(list);
}

export async function repo(provider, full, token) {
  if (!REPO_RE.test(full)) fail(400, "Pick a repository.");
  return provider === "github" ? shapeGh(await gh(`/repos/${full}`, { token })) : shapeGl(await gl(`/projects/${glId(full)}`, { token }));
}

export async function branches(provider, full, token) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const got = provider === "github" ? await gh(`/repos/${full}/branches?per_page=100&page=${page}`, { token })
                                      : await gl(`/projects/${glId(full)}/repository/branches?per_page=100&page=${page}`, { token });
    out.push(...got.map((b) => b.name));
    if (got.length < 100) break;
  }
  return out;
}

// The branch's newest commit. With the ETag of the last answer, GitHub says
// "not modified" for free (it doesn't count against the request limit).
export async function head(provider, full, branch, token, etag) {
  if (provider === "url") return urlHead(full, branch);
  if (provider === "github") {
    const r = await call(`${GH_API}/repos/${full}/commits/${encodeURIComponent(branch)}`, { token, etag, provider });
    if (r.notModified) return { notModified: true, etag };
    const c = r.json;
    return { sha: c.sha, message: (c.commit?.message || "").split("\n")[0].slice(0, 200), author: c.commit?.author?.name || c.author?.login || "",
             date: Date.parse(c.commit?.author?.date) || 0, etag: r.headers.get("etag") || null, url: c.html_url };
  }
  const b = await gl(`/projects/${glId(full)}/repository/branches/${encodeURIComponent(branch)}`, { token });
  const c = b.commit;
  return { sha: c.id, message: (c.title || "").slice(0, 200), author: c.author_name || "", date: Date.parse(c.committed_date) || 0, etag: null, url: c.web_url };
}

// Every file's path, to see what the repository is before downloading it
export async function tree(provider, full, ref, token) {
  if (provider === "github") {
    const t = await gh(`/repos/${full}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { token });
    return { files: (t.tree || []).filter((x) => x.type === "blob").map((x) => x.path), truncated: !!t.truncated };
  }
  const files = [];
  for (let page = 1; page <= 20; page++) {
    const got = await gl(`/projects/${glId(full)}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=100&page=${page}`, { token });
    files.push(...got.filter((x) => x.type === "blob").map((x) => x.path));
    if (got.length < 100) return { files, truncated: false };
  }
  return { files, truncated: true };
}

export async function fileText(provider, full, ref, path, token, max = 256 * 1024) {
  const url = provider === "github"
    ? `${GH_API}/repos/${full}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`
    : `${GL_API}/projects/${glId(full)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`;
  const r = await call(url, { token, provider, raw: true, accept: provider === "github" ? "application/vnd.github.raw" : "*/*" });
  if (!r.ok) return null;
  const t = await r.text();
  return t.length > max ? null : t;
}

// The repository at a commit, as a .tar.gz stream (a folder on top, stripped later).
// Node's https, not fetch: GitLab answers fetch's browser-style headers
// (Sec-Fetch-Mode: cors) on archive downloads with 406. GitLab also allows
// only a few archive downloads a minute: a 429 waits as long as it asks.
export async function tarball(provider, full, ref, token) {
  const url = provider === "github" ? `${GH_API}/repos/${full}/tarball/${encodeURIComponent(ref)}`
                                    : `${GL_API}/projects/${glId(full)}/repository/archive.tar.gz?sha=${encodeURIComponent(ref)}`;
  const headers = { "user-agent": UA, accept: "*/*" };
  if (token && provider === "gitlab") headers["private-token"] = token; else if (token) headers.authorization = `Bearer ${token}`;
  for (let attempt = 0; ; attempt++) {
    const res = await get(url, headers);
    if (res.statusCode === 429 && attempt < 4) {
      res.resume();
      const wait = Math.min(90, Math.max(5, Number(res.headers["retry-after"]) || 20));
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    if (res.statusCode !== 200) { res.resume(); fail(res.statusCode === 404 ? 404 : 502, `Couldn't download ${full}@${String(ref).slice(0, 12)} (HTTP ${res.statusCode}${res.statusCode === 429 ? `: ${NAME[provider]} limits downloads, try again in a minute` : ""}).`); }
    return res;
  }
}
// GET with redirects (GitHub sends tarballs from codeload); credentials only to the first host
function get(url, headers, hops = 0) {
  return new Promise((ok, no) => {
    const u = new URL(url);
    const req = httpsGet(u, { headers, timeout: 60000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        const next = new URL(res.headers.location, u);
        const h = { ...headers };
        if (next.host !== u.host) { delete h.authorization; delete h["private-token"]; }
        return get(next.href, h, hops + 1).then(ok, no);
      }
      ok(res);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => no(Object.assign(new Error(`${u.host} didn't answer (${e.code || e.message}).`), { status: 502 })));
  });
}

export function newSettingsUrl(provider) {
  return provider === "github" ? "https://github.com/settings/tokens/new?description=Burrow%20Pages&scopes=repo"
                               : "https://gitlab.com/-/user_settings/personal_access_tokens?name=Burrow%20Pages&scopes=read_api,read_repository";
}

// ------------------------------------------------------------------ Pages sites
// A repository's own GitHub or GitLab Pages site, when it has one: {url} or null
export async function pagesSite(provider, full, token, repo = null) {
  try {
    if (provider === "github") {
      const p = await gh(`/repos/${full}/pages`, { token }).catch(() => null);
      if (p?.html_url) return { url: p.html_url.endsWith("/") ? p.html_url : p.html_url + "/", status: p.status || null, custom: !!p.cname };
      // GitHub only says where without a sign-in that can read it: its usual address, when the repository has Pages
      if (repo && !repo.pages) return null;
      const [owner, name] = full.split("/"), host = `${owner.toLowerCase()}.github.io`;
      const guess = name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
      const r = await fetch(guess, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!r || r.status >= 400) return null;
      const final = r.url && r.url !== guess ? r.url.replace(/[^/]*$/, "") : guess;      // a custom domain: where it lands
      return { url: final, guessed: true };
    }
    if (provider === "gitlab") {
      const p = await gl(`/projects/${glId(full)}/pages`, { token }).catch(() => null);
      if (p?.url) return { url: p.url.endsWith("/") ? p.url : p.url + "/", unique: !!p.is_unique_domain_enabled };
      // members of the project only see /pages: the usual address, if it answers
      const [ns, ...rest] = full.split("/");
      const guess = `https://${ns.toLowerCase()}.gitlab.io/${rest.join("/")}/`;
      const r = await fetch(guess, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null);
      return r && r.status < 400 ? { url: guess, guessed: true } : null;
    }
  } catch { /* none */ }
  return null;
}

// ------------------------------------------------------------------ any Git repository, by its https address
// Codeberg, Bitbucket, a Gitea of your own… read with git itself: public
// repositories over https only, no prompts, no hooks, links checked out as
// plain files, submodules left out.
export const GIT_URL_RE = /^https:\/\/[A-Za-z0-9.-]{1,253}(?::\d{2,5})?\/[A-Za-z0-9._~\/-]{1,300}$/;
const GIT_SAFE = ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.symlinks=false", "-c", "core.hooksPath=/dev/null",
                  "-c", "credential.helper=", "-c", "http.followRedirects=initial", "-c", "advice.detachedHead=false"];
function git(args, { timeout = 120000, cwd } = {}) {
  return new Promise((ok, no) => {
    execFile("git", [...GIT_SAFE, ...args], { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: tmpdir(), GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GIT_CONFIG_NOSYSTEM: "1", LANG: "C" } },
      (e, out, err) => {
        if (!e) return ok(out);
        const msg = String(err || e.message).trim().split("\n").filter((l) => !/^hint:/.test(l)).pop() || "git failed";
        no(Object.assign(new Error(/could not read Username|Authentication failed|terminal prompts disabled/i.test(msg) ? "That repository isn't public (only public ones work by address)." : /not found|does not exist/i.test(msg) ? "There is no repository at that address." : e.killed ? "git took too long." : msg.replace(/^fatal: /, "")), { status: 400 }));
      });
  });
}
export function cleanGitUrl(u) {
  let s = String(u || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(s)) s = "https://" + s.replace(/^[a-z]+:\/\//i, "");
  if (!GIT_URL_RE.test(s)) fail(400, "Give the repository's https address, like https://codeberg.org/you/site.");
  const host = new URL(s).hostname;
  if (/^169\.254\.|^fe80:|^metadata\./i.test(host)) fail(400, "That address is off limits.");
  return s;
}
export async function urlInfo(url) {
  url = cleanGitUrl(url);
  const out = await git(["ls-remote", "--symref", url, "HEAD", "refs/heads/*"], { timeout: 30000 });
  const branches = [], lines = out.split("\n");
  let def = null;
  for (const l of lines) {
    const m = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(l); if (m) def = m[1];
    const b = /^[0-9a-f]{40}\trefs\/heads\/(\S+)$/.exec(l); if (b) branches.push(b[1]);
  }
  if (!branches.length) fail(400, "That repository has no branches yet.");
  const name = url.split("/").pop().replace(/\.git$/, "");
  return { repo: { provider: "url", full: url, name, owner: new URL(url).hostname, private: false, description: "", branch: def || branches[0], url }, branches };
}
export async function urlHead(url, branch) {
  const out = await git(["ls-remote", cleanGitUrl(url), `refs/heads/${branch}`], { timeout: 30000 });
  const sha = (/^([0-9a-f]{40})/.exec(out) || [])[1];
  if (!sha) fail(404, `There is no branch called ${branch} there any more.`);
  return { sha, message: "", author: "", date: 0, etag: null, url: null };
}
// file names, and package.json, without downloading the files themselves
export async function urlTree(url, branch) {
  const dir = mkdtempSync(join(tmpdir(), "bp-git-"));
  try {
    await git(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--single-branch", "--no-recurse-submodules", "-b", branch, cleanGitUrl(url), dir], { timeout: 120000 });
    const files = (await git(["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"])).split("\n").filter(Boolean);
    const pkgAt = async (p) => (files.includes(p) ? git(["-C", dir, "show", `HEAD:${p}`], { timeout: 60000 }).catch(() => null) : null);
    return { files, truncated: false, pkgAt };
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  finally { setTimeout(() => rmSync(dir, { recursive: true, force: true }), 60000); }
}
// the repository's files at its branch, into a folder (no .git)
export async function urlCheckout(url, branch, into) {
  await git(["clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", "-b", branch, cleanGitUrl(url), into], { timeout: 600000 });
  rmSync(join(into, ".git"), { recursive: true, force: true });
}
