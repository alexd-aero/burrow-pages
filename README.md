<p align="center"><img src="logo.svg" width="96" alt="Burrow Pages"></p>

<h1 align="center">Burrow Pages</h1>

<p align="center"><b>Static websites from your GitHub and GitLab repositories, on a subdomain of yours, behind a password.</b><br>
An addon for <a href="https://github.com/alexd-aero/aegis-burrow">Aegis × Burrow</a>, in the <a href="https://github.com/alexd-aero/weft">Weft</a> format. Experimental.</p>

---

Sign in with a code, pick a repository (the most active ones first), choose a subdomain and who may open it, and it is live at `https://docs.your-domain`, only for whoever has your Aegis login or the site's own password. Private repositories included. Every push shows up within minutes.

No GitHub Pages settings, no DNS records, no `CNAME` file: Burrow does all of it.

> **Static websites only.** Burrow serves a repository's files as they are: HTML, CSS, JavaScript and images, already built (an `index.html` in `/`, `docs/`, `dist/`… or a `gh-pages` branch), or a Jekyll site that GitHub Pages builds. It runs no code: apps that need a server (Node, Python, PHP, a database) won't work. A repository without a static site is refused and nothing is changed.

## What it does

- **Checks your domain** when it installs: is it linked (so sites can get subdomains of their own), and does anything on it already point at GitHub or GitLab Pages, and for which account? A `CNAME` to `you.github.io`, GitHub's `A` records, a `_github-pages-challenge-you` verification record, the GitLab equivalents. The accounts it finds are added for you; remove any that aren't yours.
- **Accounts.** Add any GitHub or GitLab account by its **username** alone: Burrow lists its public repositories. Or **Sign in with GitHub**: Burrow shows a code, you enter it at [github.com/login/device](https://github.com/login/device) on any device, and private repositories show up too. Burrow never sees your password. Remove an account any time.
- **Smart sorting.** Repositories come sorted by their number of commits and how recently they were pushed to (stars and an existing Pages site help a little; forks and archived ones sink), with a search box.
- **Deploy.** Burrow downloads the repository and serves its files itself: a `gh-pages` branch first, then `/`, `docs/`, `public/`, `dist/`, `site/`, `_site/`, `build/` or `out/`, whichever holds an `index.html`. A private repository stays private: only Burrow downloads it, with your sign-in.
- **Follows every push.** Every 10 minutes (or **Sync now**) Burrow asks for the branch's newest commit and, when it changed, downloads it and switches over in one step.
- **Sites that need building** (Jekyll and the like): Burrow serves the site GitHub or GitLab Pages builds, and turns GitHub Pages on for the repository first when you are signed in and it is off. That copy on `github.io` is public, so Burrow only does this for public repositories.
- **Who can open it:** your Aegis login (the default) or a password of the site's own, sealed with ML-KEM-768 + X25519 on its way and kept as a scrypt hash. Never public.

## How it works

Burrow Pages is a Burrow-only addon (`"platforms": ["burrow"]`). Its manifest's `burrow` field asks Burrow (2.8.0+) to run `burrow/extension.mjs` inside itself while it is installed, and to show `burrow/ui.js` as a card on the Burrow page:

| | |
|---|---|
| `burrow/extension.mjs` | accounts, GitHub's device flow, repository lists, deploys, the sync, and one small file server per site (`127.0.0.1`, from port 47600) that Burrow publishes like any other tunnel |
| `burrow/ui.js` | the card: the domain check, accounts, sites, and the dialogs |
| `burrow/lib.mjs` | the pure parts: smart sorting, reading DNS records, picking what to serve |
| `scripts/` | install (checks Burrow, GitHub and GitLab, and your domain), status, uninstall, and the actions *Check every site*, *Pause every site*, *Resume every site* |

Everything lives in the addon's data folder: `state.json` (mode 600, it holds the GitHub sign-in) and `sites/<port>/` (the files). Uninstalling pauses the sites (a reinstall brings them back); uninstalling and deleting the data removes them.

The file servers answer `GET` and `HEAD` only, never outside the site's folder (links included), with `index.html` for folders, `404.html` when the site has one, and `ETag`s.

## GitHub sign-in

The device flow needs a GitHub OAuth app with **Device Flow** enabled (its *Authorization callback URL* is required by the form but never used; the repository's URL is fine). Its client ID is public (there is no secret); set it under *Burrow → Addons → Burrow Pages → ⋯ → Settings and reinstall*. Without one, accounts work by username (public repositories).

To revoke Burrow's sign-in on GitHub's side: [github.com/settings/applications](https://github.com/settings/applications).

## Install

It comes with Aegis × Burrow 2.8.0 and installs itself once. To add it by hand: *Burrow → Addons*, paste `https://github.com/alexd-aero/burrow-pages`.

## Tests

```bash
node --test test/*.test.mjs
```

## Credits

- [Aegis × Burrow](https://github.com/alexd-aero/aegis-burrow), the host it runs in.
- The [Weft Architecture](https://github.com/alexd-aero/weft), the addon format, shared with [Selkies Forge](https://github.com/adatskov-wcpss/animated-fiesta).

Made by Alexd Aero, with Claude. MIT licensed.
