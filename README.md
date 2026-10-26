<p align="center"><img src="logo.svg" width="96" alt="Burrow Pages"></p>

<h1 align="center">Burrow Pages</h1>

<p align="center"><b>Your static websites on your own addresses: from GitHub or GitLab, from an upload, or a site that lives elsewhere.</b><br>
An addon for <a href="https://github.com/alexd-aero/aegis-burrow">Aegis × Burrow</a>, in the <a href="https://github.com/alexd-aero/weft">Weft</a> format.</p>

---

Pick a repository, a folder on your computer, or the address of a site that already exists. It answers at `https://NAME.your-domain` over HTTPS, behind your Aegis login, a password of its own, or open to everyone (still behind your gate's shield). Every push goes live by itself, any earlier deploy is one click from live again, and you see who visits without a cookie or a script in your pages.

## What's new in 2.0

2.0 is a rewrite. 1.x was a card on the Burrow page that proxied GitHub Pages; 2.0 is an app of its own.

- **Its own dashboard** at `/__gate/pages`, under your gate's login, on phones too: sites, deploys, analytics, files, settings, accounts and activity, with deploy logs streaming live.
- **Builds.** Vite, Astro, Next (static export), Nuxt, SvelteKit, Gatsby, Create React App, Vue CLI, Angular, Eleventy, Docusaurus, VitePress, Parcel, Hugo, Jekyll and MkDocs are recognised and built in a locked-down Docker container. Anything with a build command works.
- **Three kinds of site:** a repository (GitHub or GitLab, private ones too), an upload (a folder, `.zip`, `.tar.gz` or `.tar`), or a site elsewhere (any http(s) address, cached so an outage there isn't one here).
- **Rollbacks.** The last 10 deploys keep their files; making one live again is one rename.
- **Serving like a real host:** `_redirects` and `_headers` (and the same rules on the dashboard), single-page-app mode, clean URLs, a not-found page, maintenance mode, brotli and gzip, ETags, immutable caching for hashed build files, byte ranges for video.
- **Analytics without cookies**: visitors, page views, referrers, browsers, systems, devices, status codes, missing pages and the last requests, counted where the files are served.
- **Health checks** every few minutes, with your dashboard's bell when a site goes down or a deploy fails.
- **Public sites.** 1.x could only put a site behind a password.
- **GitLab sign-in** with a token, and GitHub's sign-in with a code, as before.

Sites, accounts and sign-ins from 1.x carry over. Sites 1.x proxied from GitHub or GitLab Pages are plain Burrow tunnels; the dashboard offers to move them in (same address).

## Using it

**New site → From a repository.** Connect an account (sign in to GitHub with a code, paste a GitHub or GitLab token, or name any account for its public repositories). Repositories come with the most commits and the most recent activity first. Pick one and a branch: Burrow looks at its files and says what it is (a site ready to serve from `/`, `docs/`, `dist/`…, or one that needs building, and with what). Pick its address and who can open it. Deploy.

**New site → Upload files.** Name it, pick its address, then drop a folder or an archive. Upload a new version whenever you like from the site's page.

**New site → A site elsewhere.** Paste its address (`https://group.gitlab.io/project/`, `you.github.io/repo`, any website). A path is kept: `/x` is fetched as `/project/x`.

### A site's page

| Tab | |
|---|---|
| Overview | what's live (commit, author, size), the source, health over the last checks, today's numbers, recent events |
| Deploys | every deploy with its log; make any kept one live, download it, delete it |
| Analytics | 24 hours to 90 days: the chart, top pages, referrers, browsers, systems, devices, status codes, 404s, the last requests |
| Files | what is being served, folder by folder |
| Settings | name and address; who can open it; branch, folder, build and how often to look for commits; serving options; redirects; headers; maintenance; remove |

After a rollback, new pushes wait until you say (otherwise the next push would undo it).

### Redirects and headers

The syntax most static hosts share, in a `_redirects` / `_headers` file at the root of the site or on the Settings tab (the dashboard's come first):

```
/old-page        /new-page              301
/blog/*          /posts/:splat          302
/app/*           /app/index.html        200      # served from there, the address stays
/secret          /                      301!     # ! = even when /secret exists
```

```
/*
  Permissions-Policy: camera=(), microphone=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Headers that belong to the connection or the gate (`Set-Cookie`, `Strict-Transport-Security`, `Content-Length`…) are refused.

## How it works

Burrow Pages is a Burrow-only addon. Its manifest's `burrow` field asks Burrow (2.15+) to run `burrow/extension.mjs` inside itself, to mount its dashboard at `/__gate/pages` behind the gate's login, and to show `burrow/ui.js` as a card on the Burrow page.

| | |
|---|---|
| `burrow/extension.mjs` | the entry: starts everything, the mount, routes for the card and the scripts, the 1.x migration |
| `lib/sites.mjs` | sites, deploys, rollbacks, uploads, following pushes, health checks |
| `lib/serve.mjs` | a site's file server (127.0.0.1 only, behind its tunnel) |
| `lib/proxy.mjs` | a site that lives elsewhere: the proxy, its cache, its health check |
| `lib/git.mjs` | GitHub and GitLab: accounts, sign-in, repositories, commits, downloads |
| `lib/detect.mjs` | what a repository is and how it builds |
| `lib/build.mjs` | builds in Docker |
| `lib/archive.mjs` | unpacking `.tar.gz` and `.zip`, safely |
| `lib/rules.mjs` | `_redirects` and `_headers` |
| `lib/stats.mjs` | visitor numbers |
| `lib/store.mjs` | state, sealed sign-ins, the activity log |
| `lib/app.mjs`, `public/` | the dashboard and its API |
| `scripts/` | install, status, uninstall, and the actions *Open*, *Check every site*, *Look for new commits*, *Pause*, *Resume* |

Each site has a small server on `127.0.0.1` and a Burrow tunnel in front of it on your domain; the tunnel decides who gets in (login, password or public). Each deploy is a folder of its own and `current` points at the live one, so a deploy or a rollback switches in one step and a visitor never sees half of one.

Everything lives in the addon's data folder (mode 700): `state.json`, `secrets.json` (sign-ins, sealed with AES-256-GCM under `secret.key`), `activity.jsonl`, `stats/` and `sites/<id>/` (deploys, logs). Uninstalling pauses the sites (a reinstall brings them back); uninstalling and deleting the data removes them, their tunnels and their build caches.

## Security

- **Nothing runs from a site.** Files are served as they are. Hidden files (`.env`, `.git/…`) are never served (except `/.well-known/`), nor anything outside the deploy, links included.
- **Archives are unpacked by Burrow Pages' own readers**, not the system's: only plain files and folders, names cleaned of `..` and absolute paths, and limits on total size, number of files and each file, counted on what comes out (so a zip bomb stops early).
- **Builds run in a throwaway container**: the repository is copied in (never mounted), all capabilities dropped but the few package managers need, `no-new-privileges`, memory, process, CPU and time limits, and only the output folder copied out. A build runs the repository's own code with network access: build what you trust.
- **The dashboard** answers only requests the gate passes on (each carries a key of its own), and anything that changes something must come from the dashboard's own page.
- **Sign-ins** are sealed at rest and never sent to the page; removing an account forgets its token.
- **Proxied sites** don't pass the gate's cookies, Cloudflare's headers or the visitor's address upstream (unless you say to), and can't point at cloud metadata addresses.
- **Visitor numbers** keep no addresses: a visitor is a hash with a salt that changes daily, and the last requests show addresses cut to /24 or /48.

## GitHub sign-in

The device flow needs a GitHub OAuth app with **Device Flow** enabled. Burrow Pages' own (client ID `Ov23liJcQorPMpS9k8BX`) is built in; its client ID is public and there is no secret. To use your own, set its client ID under Burrow Pages → Settings → GitHub sign-in. Revoke a sign-in on GitHub's side at [github.com/settings/applications](https://github.com/settings/applications).

## Install

It comes with Aegis × Burrow and installs itself once. To add it by hand: *Burrow → Addons*, paste `https://github.com/alexd-aero/burrow-pages`.

## Tests

```bash
node --test test/*.test.mjs
```

`test/harness.mjs` runs the addon outside a gate (a stand-in context, the dashboard at `http://127.0.0.1:4390/__gate/pages/`, a port per tunnel) for trying changes. It has no login: never expose it.

## Credits

- [Aegis × Burrow](https://github.com/alexd-aero/aegis-burrow), the host it runs in.
- The [Weft Architecture](https://github.com/alexd-aero/weft), the addon format, shared with [Selkies Forge](https://github.com/adatskov-wcpss/animated-fiesta).

Made by Alexd Aero, with Claude. MIT licensed.
