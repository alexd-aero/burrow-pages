// Burrow Pages: its card on the Burrow page.
//
// Burrow imports this module (forge-addon.json "burrow": {"ui"}) and calls
// card(ctx) on every paint and wire(el, ctx) after it. ctx carries Burrow's
// helpers (api for our routes, modals, toasts, the tunnel row, the access and
// password fields) and the tunnels this addon made.

const S = { data: null, at: 0, loading: false, error: null, repos: {}, reposAt: {}, q: "", acct: null };
const BRANCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6M18 9.2c0 5-7 3.5-11 7.6"/></svg>';
const ROCKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c3-1 6 0 6 0s1 3 0 6l-6 6-4-4z"/><path d="m10 12-3 1-3 3 4 1M12 14l-1 3 1 4 3-3 1-3M15.5 8.5h.01"/></svg>';
const SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12A8 8 0 0 1 18 6.7"/><path d="M18 2.5v4.5h-4.5M6 21.5V17h4.5"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const PROV = { github: "GitHub", gitlab: "GitLab" };
const INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const COMMIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const LANG = { HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c", JavaScript: "#f1e05a", TypeScript: "#3178c6", Vue: "#41b883", Svelte: "#ff3e00",
               Astro: "#ff5a03", Ruby: "#701516", Python: "#3572A5", Go: "#00ADD8", Rust: "#dea584", Java: "#b07219", Shell: "#89e051",
               "C++": "#f34b7d", C: "#555555", "C#": "#178600", PHP: "#4F5D95", Kotlin: "#A97BFF", Swift: "#F05138", Markdown: "#083fa1", Dart: "#00B4AB" };
// a website, most likely: GitHub already serves it, or it is written in the web's own languages
const looksStatic = (r) => r.pages || ["HTML", "CSS", "SCSS"].includes(r.language);
const when = (t) => { if (!t) return "never"; const d = (Date.now() - t) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? `${Math.floor(d)} days ago` : d < 365 ? `${Math.floor(d / 30)} mo ago` : `${Math.floor(d / 365)} yr ago`; };
// said wherever a site is made: Burrow serves files, it runs no code
const STATIC_ONLY = `<div class="bp-static">${INFO}<div><b>Static websites only.</b> Burrow serves a repository's files as they are: HTML, CSS, JavaScript and images, already built (an <span class="mono">index.html</span> in <span class="mono">/</span>, <span class="mono">docs/</span>, <span class="mono">dist/</span>… or a <span class="mono">gh-pages</span> branch), or a Jekyll site GitHub Pages builds. Apps that need a server (Node, Python, PHP, a database) won't run.</div></div>`;
const subFromRepo = (n) => (String(n || "").toLowerCase().replace(/\.github\.io$|\.gitlab\.io$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "site");

const style = document.createElement("style");
style.textContent = `
.bp { padding: 18px 18px 10px; margin-bottom: 14px; border-color: rgba(61,220,151,.24);
      background: radial-gradient(120% 140% at 0% 0%, rgba(61,220,151,.08), transparent 55%), var(--card, #0f1012); }
.bp-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.bp-head .grow { min-width: 220px; }
.bp-head .integ-name { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bp-actions svg, .bp-btn svg { width: 15px; height: 15px; }
.bp-domain { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0 0; padding: 10px 12px; border-radius: 11px; font-size: 13px;
             border: 1px solid rgba(61,220,151,.22); background: rgba(61,220,151,.05); color: #cfe9dc; }
.bp-domain.warn { border-color: rgba(242,193,78,.3); background: rgba(242,193,78,.06); color: #ecdcb0; }
.bp-domain svg { flex: none; width: 16px; height: 16px; margin-top: 1px; color: #3ddc97; }
.bp-domain.warn svg { color: #f2c14e; }
.bp-domain p { margin: 0; }
.bp-inline { border: 0; background: none; padding: 0; font: inherit; color: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; } .bp-domain p + p { margin-top: 4px; color: var(--muted); }
.bp-accts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 12px 0 2px; }
.bp-k { font: 11px var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: .08em; margin-right: 4px; }
.bp-acct { display: inline-flex; align-items: center; gap: 8px; padding: 4px 6px 4px 4px; border: 1px solid var(--line-2); border-radius: 99px; background: rgba(255,255,255,.02); font-size: 12.5px; }
.bp-acct img { width: 22px; height: 22px; border-radius: 50%; background: #1a1b1e; }
.bp-acct .faint { font-size: 11px; }
.bp-acct.on { border-color: rgba(61,220,151,.35); }
.bp-x { border: 0; background: transparent; color: var(--faint); cursor: pointer; width: 20px; height: 20px; border-radius: 50%; font-size: 14px; line-height: 1; }
.bp-x:hover { color: var(--text); background: rgba(255,255,255,.08); }
.bp-sites { margin-top: 12px; border-top: 1px solid var(--line); }
.bp-site { border-bottom: 1px solid var(--line); } .bp-site:last-child { border-bottom: 0; }
.bp-site .prow { border-bottom: 0; }
.bp-sync { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 0 4px 10px 56px; font: 11.5px var(--mono); color: var(--faint); }
.bp-sync button { font: inherit; }
.bp-empty { margin: 12px 0 6px; color: var(--muted); font-size: 13px; }
.bp-code { font: 700 34px var(--mono); letter-spacing: .14em; text-align: center; padding: 18px 10px; margin: 6px 0 14px; border-radius: 14px;
           border: 1px solid rgba(61,220,151,.35); background: rgba(61,220,151,.06); color: #e8fff5; }
.bp-wait { display: flex; gap: 10px; align-items: center; color: var(--muted); font-size: 13px; }
.bp-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.15); border-top-color: #3ddc97; animation: bpspin .8s linear infinite; }
@keyframes bpspin { to { transform: rotate(360deg); } }
.bp-repos { max-height: min(56vh, 520px); overflow: auto; margin: 12px -4px 4px; padding: 2px 4px; display: grid; gap: 8px; }
.bp-repo { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 12px; background: rgba(255,255,255,.015); transition: border-color .15s, background .15s; }
.bp-repo:hover { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.03); }
.bp-repo.top { border-color: rgba(61,220,151,.28); }
.bp-rtop { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bp-rname { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bp-rname a { color: var(--text); text-decoration: none; font-weight: 600; font-size: 14px; letter-spacing: -.01em; overflow-wrap: anywhere; }
.bp-rname a:hover { text-decoration: underline; text-underline-offset: 3px; }
.bp-rname .own { color: var(--faint); font-weight: 400; }
.bp-tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 99px; font: 10.5px var(--mono); border: 1px solid var(--line-2); color: var(--muted); white-space: nowrap; }
.bp-tag.web { color: #9ef0c9; border-color: rgba(61,220,151,.35); background: rgba(61,220,151,.07); }
.bp-tag.priv { color: #f2d48a; border-color: rgba(242,193,78,.3); }
.bp-tag svg { width: 10px; height: 10px; }
.bp-desc { color: var(--muted); font-size: 12.5px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bp-rmeta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--faint); }
.bp-rmeta span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.bp-rmeta svg { width: 12px; height: 12px; }
.bp-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.bp-rtop .btn { flex: none; }
.bp-static { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 12px; padding: 10px 12px; border-radius: 11px; font-size: 12.5px; line-height: 1.5;
             border: 1px solid rgba(122,167,255,.3); background: rgba(122,167,255,.06); color: #d3defa; }
.bp-static b { color: #fff; }
.bp-static svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: #7aa7ff; }
.bp-tools { display: flex; gap: 8px; flex-wrap: wrap; }
.bp-tools { align-items: center; }
.bp-tools select, .bp-tools input#bpQ { flex: 1 1 160px; }
.bp-only { gap: 8px; flex: none; color: var(--muted); }
.bp-log { font: 11.5px/1.6 var(--mono); color: var(--muted); background: rgba(0,0,0,.25); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; max-height: 180px; overflow: auto; margin: 10px 0; white-space: pre-wrap; }
.modal.wide { max-width: 640px; }
@media (max-width: 600px) { .bp-sync { padding-left: 4px; } .bp-code { font-size: 26px; } }
`;
document.head.append(style);

// ------------------------------------------------------------------ data
function load(ctx, fresh) {
  if (S.loading) return;
  S.loading = true;
  ctx.api(`/state${fresh ? "?fresh=1" : ""}`).then((d) => { S.data = d; S.error = null; })
    .catch((e) => { S.error = e.message; }).finally(() => { S.loading = false; S.at = Date.now(); ctx.render(); });
}

// ------------------------------------------------------------------ the card
export function card(ctx) {
  if (!S.loading && Date.now() - S.at > 20000) load(ctx);
  const { h } = ctx, d = S.data, p = ctx.me?.pages || {};
  const accounts = d?.accounts || [];
  const deploys = new Map((d?.deploys || []).map((x) => [x.port, x]));
  const sites = ctx.tunnels;
  return `<section class="card lit bp" id="pagesCard">
    <div class="bp-head">
      <div class="integ-logo"><img src="${h(p.logo || "/__gate/logos/burrow-pages.svg")}" alt=""></div>
      <div class="grow">
        <div class="integ-name">Burrow Pages ${p.version ? `<span class="pill">v${h(p.version)}</span>` : ""}<span class="pill exp">experimental</span></div>
        <div class="integ-sub">Static websites from your GitHub and GitLab repositories, on your domain, behind your login or a password of their own.</div>
      </div>
      <div class="bp-actions">
        <button class="btn sm primary bp-btn" data-bp="deploy">${ROCKET} Deploy a repository</button>
        <button class="btn sm ghost" data-bp="by-address" title="A github.io or gitlab.io address that is already live">+ A Pages address</button>
      </div>
    </div>
    ${domainBox(ctx)}
    <div class="bp-accts"><span class="bp-k">Accounts</span>
      ${accounts.map((a) => `<span class="bp-acct${a.signedIn ? " on" : ""}">${a.avatar ? `<img src="/__gate/api/x/burrow-pages/avatar/${encodeURIComponent(a.id)}" alt="">` : ""}
        <b>@${h(a.username)}</b><span class="faint">${PROV[a.provider]} · ${a.signedIn ? "signed in" : "public repos"}${a.source === "your domain" ? " · found on your domain" : ""}</span>
        <button class="bp-x" data-bp="acct-rm" data-id="${h(a.id)}" title="Remove @${h(a.username)}" aria-label="Remove @${h(a.username)}">×</button></span>`).join("")}
      ${!d && !S.error ? '<span class="faint small">loading…</span>' : ""}
      <button class="chip" data-bp="acct-add">+ Add an account</button>
      <button class="chip" data-bp="gh-signin">Sign in with GitHub</button>
    </div>
    ${S.error ? `<p class="err-msg">${h(S.error)}</p>` : ""}
    ${sites.length ? `<div class="bp-sites">${sites.map((t) => siteBlock(ctx, t, deploys.get(t.port))).join("")}</div>`
      : `<p class="bp-empty">No sites yet. <b>Deploy a repository</b> that holds a static website: pick one (the most active first), a subdomain and who may open it, and Burrow serves it, private repositories included, and keeps it in step with every push.</p>`}
  </section>`;
}

function domainBox(ctx) {
  const { h } = ctx, dm = S.data?.domain;
  if (!dm) return "";
  const have = new Set((S.data?.accounts || []).map((a) => a.provider));
  const setups = (dm.setups || []).map((s) => `${PROV[s.provider]} Pages is already set up on ${s.names.map((n) => `<span class="mono">${h(n)}</span>`).join(", ")}${s.account ? ` for <b>@${h(s.account)}</b>` : ""}${s.how.includes("verified") ? " (verified)" : ""}.`
    + (s.account ? "" : ` Its DNS records don't say which ${PROV[s.provider]} account${have.has(s.provider) ? "." : `: <button class="link bp-inline" data-bp="acct-add" data-provider="${s.provider}">add it by its username</button>.`}`));
  return `<div class="bp-domain${dm.eligible ? "" : " warn"}">${dm.eligible ? CHECK : WARN}<div>
    <p>${dm.linked ? `<b>${h(dm.zone)}</b> is eligible. ` : ""}${h(dm.reason)}</p>
    ${setups.length ? setups.map((x) => `<p>${x}</p>`).join("") : dm.linked && dm.eligible ? `<p>Nothing on ${h(dm.zone)} points at GitHub or GitLab Pages yet.</p>` : ""}
  </div></div>`;
}

function siteBlock(ctx, t, d) {
  const { h } = ctx;
  if (!d) return `<div class="bp-site">${ctx.siteRow(t)}</div>`;
  const info = d.mode === "files"
    ? `${BRANCH.replace("<svg ", '<svg width="12" height="12" ')} ${h(d.repo)}@${h(d.branch)}${d.path && d.path !== "/" ? `/${h(d.path)}` : ""} · ${d.commit ? h(d.commit.slice(0, 7)) : "?"} · synced ${ctx.ago(d.synced)}${d.private ? ` · ${LOCK} private` : ""}
       <button class="btn sm ghost" data-bp="sync" data-port="${d.port}">${SYNC.replace("<svg ", '<svg width="12" height="12" ')} Sync now</button>`
    : `served by ${PROV[d.provider]} Pages · ${h(d.repo)}`;
  return `<div class="bp-site">${ctx.siteRow(t)}<div class="bp-sync">${info}
    <button class="btn sm ghost danger" data-bp="undeploy" data-port="${d.port}" data-name="${h(t.host || d.repo)}">Remove</button></div></div>`;
}

// ------------------------------------------------------------------ actions
export function wire(el, ctx) {
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bp]");
    if (!b) return;
    e.stopPropagation();
    const what = b.dataset.bp;
    try {
      if (what === "deploy") deployForm(ctx);
      else if (what === "by-address") ctx.tunnelForm(null, null, { site: true });
      else if (what === "acct-add") accountForm(ctx, b.dataset.provider);
      else if (what === "gh-signin") signIn(ctx);
      else if (what === "acct-rm") {
        const a = S.data.accounts.find((x) => x.id === b.dataset.id);
        if (!confirm(`Remove @${a.username} from Burrow Pages?${a.sites ? ` Its ${a.sites} site${a.sites === 1 ? "" : "s"} keep running but stop following new commits.` : ""}`)) return;
        const r = await ctx.api(`/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
        ctx.toast(r.note || `@${a.username} removed`); S.at = 0; delete S.repos[a.id]; load(ctx);
      } else if (what === "sync") {
        b.disabled = true; b.textContent = "Syncing…";
        const r = await ctx.api(`/deploys/${b.dataset.port}/sync`, { method: "POST", body: "{}" });
        ctx.toast(r.changed ? `Now at ${r.commit.slice(0, 7)}` : "Already up to date"); S.at = 0; load(ctx);
      } else if (what === "undeploy") {
        if (!confirm(`Remove ${b.dataset.name}? Its address stops working and Burrow deletes its copy of the files. The repository isn't touched.`)) return;
        await ctx.api(`/deploys/${b.dataset.port}`, { method: "DELETE" });
        ctx.toast("Removed"); S.at = 0; load(ctx); ctx.refresh();
      }
    } catch (ex) { ctx.toast(ex.message); b.disabled = false; }
  });
}

// ------------------------------------------------------------------ add an account (just the username)
function accountForm(ctx, provider) {
  const st = { provider: provider === "gitlab" ? "gitlab" : "github" };
  ctx.openModal(`<h2>Add an account</h2>
    <p>Just its username. Burrow lists its public repositories; to deploy private ones, <b>Sign in with GitHub</b> instead.</p>
    <form id="bpAcF" autocomplete="off">
      <div class="field"><span>Where</span><div class="seg" id="bpProv"><button type="button" data-v="github" class="${st.provider === "github" ? "on" : ""}">GitHub</button><button type="button" data-v="gitlab" class="${st.provider === "gitlab" ? "on" : ""}">GitLab</button></div></div>
      <label class="field"><span>Username <span class="faint">(a user, or an organization / group)</span></span><input class="input mono" id="bpUser" placeholder="${st.provider === "github" ? "octocat" : "gitlab-org"}" spellcheck="false" autocapitalize="none"></label>
      <div class="err-msg" id="bpErr"></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary" id="bpGo">Add it</button></div>
    </form>`, (m) => {
    m.querySelector("#bpUser").focus();
    m.querySelector("#bpProv").addEventListener("click", (e) => {
      const x = e.target.closest("button"); if (!x) return;
      st.provider = x.dataset.v; m.querySelectorAll("#bpProv button").forEach((y) => y.classList.toggle("on", y === x));
      m.querySelector("#bpUser").placeholder = st.provider === "github" ? "octocat" : "gitlab-org";
    });
    m.querySelector("#bpAcF").addEventListener("submit", async (e) => {
      e.preventDefault();
      const go = m.querySelector("#bpGo"); go.disabled = true; go.textContent = "Looking it up…";
      try {
        const a = await ctx.api("/accounts", { method: "POST", body: JSON.stringify({ provider: st.provider, username: m.querySelector("#bpUser").value }) });
        ctx.closeModal(); ctx.toast(`@${a.username} added`); S.at = 0; load(ctx);
      } catch (ex) { m.querySelector("#bpErr").textContent = ex.message; go.disabled = false; go.textContent = "Add it"; }
    });
  });
}

// ------------------------------------------------------------------ sign in with GitHub (device flow)
async function signIn(ctx) {
  const { h } = ctx;
  let dv;
  try { dv = await ctx.api("/github/device", { method: "POST", body: "{}" }); }
  catch (ex) {
    ctx.openModal(`<h2>Sign in with GitHub</h2><p>${h(ex.message)}</p>
      <div class="modal-actions"><button class="btn primary" data-act="close">OK</button></div>`);
    return;
  }
  ctx.openModal(`<h2>Sign in with GitHub</h2>
    <p>Open <a class="link" href="${h(dv.verification_uri)}" target="_blank" rel="noopener">${h(dv.verification_uri.replace(/^https:\/\//, ""))}</a> on any device, sign in, and enter this code. Burrow never sees your password.</p>
    <div class="bp-code" id="bpCode">${h(dv.user_code)}</div>
    <div class="row" style="gap:8px;justify-content:center;margin-bottom:14px">
      <button class="btn sm" id="bpCopy">Copy the code</button>
      <a class="btn sm primary" href="${h(dv.verification_uri)}" target="_blank" rel="noopener">Open GitHub</a>
    </div>
    <div class="bp-wait" id="bpWait"><i class="bp-spin"></i><span>Waiting for you to approve Burrow Pages on GitHub…</span></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Close</button></div>`, (m) => {
    m.querySelector("#bpCopy").addEventListener("click", async () => { await navigator.clipboard.writeText(dv.user_code); ctx.toast("Code copied"); });
    const tick = async () => {
      if (!document.body.contains(m)) return;
      let s;
      try { s = await ctx.api("/github/device"); } catch { setTimeout(tick, 4000); return; }
      if (s.state === "pending") { setTimeout(tick, 3000); return; }
      const w = m.querySelector("#bpWait");
      if (s.state === "done") {
        ctx.closeModal(); ctx.toast(`Signed in to GitHub as @${s.account.username}`); S.at = 0; delete S.repos[s.account.id]; load(ctx);
        return;
      }
      w.innerHTML = `<span class="err-msg" style="margin:0">${s.state === "expired" ? "The code expired." : s.state === "denied" ? "GitHub says it was cancelled." : h(s.error || "Something went wrong.")}</span>
        <button class="btn sm" id="bpAgain">Get a new code</button>`;
      w.querySelector("#bpAgain").addEventListener("click", () => { ctx.closeModal(); signIn(ctx); });
    };
    setTimeout(tick, 3000);
  });
}

// ------------------------------------------------------------------ deploy a repository
function deployForm(ctx) {
  const { h } = ctx, accounts = S.data?.accounts || [];
  if (!accounts.length) {
    ctx.openModal(`<h2>Deploy a repository</h2><p>First add the account it is in: <b>Sign in with GitHub</b> (private repositories too), or add any GitHub or GitLab username.</p>
      <div class="modal-actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="bpA">Add an account</button><button class="btn primary" id="bpS">Sign in with GitHub</button></div>`, (m) => {
      m.querySelector("#bpA").addEventListener("click", () => { ctx.closeModal(); accountForm(ctx); });
      m.querySelector("#bpS").addEventListener("click", () => { ctx.closeModal(); signIn(ctx); });
    });
    return;
  }
  if (!S.acct || !accounts.some((a) => a.id === S.acct)) S.acct = (accounts.find((a) => a.signedIn) || accounts[0]).id;
  ctx.openModal(`<h2>Deploy a static website</h2>
    <p>From one of your repositories, sorted by commits and recent activity. Burrow serves its files itself, behind a password, and follows every push.</p>
    ${STATIC_ONLY}
    <div class="bp-tools">
      <select class="input" id="bpAcct">${accounts.map((a) => `<option value="${h(a.id)}" ${a.id === S.acct ? "selected" : ""}>@${h(a.username)} · ${PROV[a.provider]}${a.signedIn ? "" : " (public)"}</option>`).join("")}</select>
      <input class="input" id="bpQ" placeholder="Search" value="${h(S.q)}" spellcheck="false">
      <button class="btn sm ghost" id="bpRe" title="Ask again">${SYNC}</button>
      <label class="row bp-only"><span class="switch"><input type="checkbox" id="bpWeb" ${S.webOnly ? "checked" : ""}><i></i></span><span class="small">Likely websites only</span></label>
    </div>
    <div class="bp-repos" id="bpList"><div class="bp-wait"><i class="bp-spin"></i>Asking for the repositories…</div></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Close</button></div>`, (m) => {
    m.querySelector(".modal")?.classList.add("wide");
    const list = m.querySelector("#bpList");
    const draw = () => {
      const all = S.repos[S.acct];
      if (!all) return;
      const q = S.q.toLowerCase().trim();
      const rows = all.filter((r) => (!q || `${r.full} ${r.description} ${r.language}`.toLowerCase().includes(q)) && (!S.webOnly || looksStatic(r)));
      list.innerHTML = rows.length ? rows.slice(0, 150).map((r, i) => {
        const [own, ...rest] = r.full.split("/");
        return `<div class="bp-repo${!q && i < 3 ? " top" : ""}">
          <div class="bp-rtop">
            <div class="bp-rname"><a href="${h(r.url || "#")}" target="_blank" rel="noopener"><span class="own">${h(own)}/</span>${h(rest.join("/"))}</a>
              ${r.private ? `<span class="bp-tag priv">${LOCK} private</span>` : ""}${looksStatic(r) ? '<span class="bp-tag web">website</span>' : ""}${r.pages ? '<span class="bp-tag">on Pages</span>' : ""}${r.fork ? '<span class="bp-tag">fork</span>' : ""}${r.archived ? '<span class="bp-tag">archived</span>' : ""}</div>
            ${r.deployed ? `<span class="pill ok">live at ${h(r.deployed.sub || "a tunnel")}</span>` : `<button class="btn sm primary" data-full="${h(r.full)}">Deploy</button>`}
          </div>
          ${r.description ? `<div class="bp-desc">${h(r.description)}</div>` : ""}
          <div class="bp-rmeta">${r.commits != null ? `<span>${COMMIT}${ctx.fmtN(r.commits)} commit${r.commits === 1 ? "" : "s"}</span>` : ""}<span>${CLOCK}${when(r.pushed)}</span>${r.language ? `<span><i class="bp-dot" style="background:${LANG[r.language] || "#8a8f97"}"></i>${h(r.language)}</span>` : ""}${r.stars ? `<span>${STAR}${ctx.fmtN(r.stars)}</span>` : ""}</div>
        </div>`;
      }).join("") : `<p class="muted small">${q ? "Nothing matches." : S.webOnly ? "None of these look like a website (on Pages, or written in HTML/CSS). Switch the filter off to see them all." : "No repositories here."}</p>`;
    };
    const fetchRepos = async (fresh) => {
      if (S.repos[S.acct] && !fresh) { draw(); return; }
      list.innerHTML = '<div class="bp-wait"><i class="bp-spin"></i>Asking for the repositories and counting their commits…</div>';
      try { S.repos[S.acct] = (await ctx.api(`/repos/${encodeURIComponent(S.acct)}${fresh ? "?fresh=1" : ""}`)).repos; draw(); }
      catch (ex) { list.innerHTML = `<p class="err-msg">${h(ex.message)}</p>`; }
    };
    m.querySelector("#bpAcct").addEventListener("change", (e) => { S.acct = e.target.value; fetchRepos(); });
    m.querySelector("#bpQ").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
    m.querySelector("#bpRe").addEventListener("click", () => fetchRepos(true));
    m.querySelector("#bpWeb").addEventListener("change", (e) => { S.webOnly = e.target.checked; draw(); });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-full]"); if (!b) return;
      const r = S.repos[S.acct].find((x) => x.full === b.dataset.full);
      ctx.closeModal(); deployStep(ctx, r);
    });
    fetchRepos();
    m.querySelector("#bpQ").focus();
  });
}

function deployStep(ctx, r) {
  const { h } = ctx, st = { access: "login" }, domain = S.data?.domain;
  ctx.openModal(`<h2>Deploy ${h(r.name)}</h2>
    <p><span class="mono">${h(r.full)}</span>${r.private ? " is private: only Burrow downloads it, with your sign-in, and it is served only to whoever has the password." : "."}
      Burrow looks for a static website in it (an <span class="mono">index.html</span>); a repository without one is refused, and nothing is changed.</p>
    <form id="bpDF" autocomplete="off">
      <label class="field"><span>Its address</span>
        <div class="addr"><input class="input mono" id="bpSub" maxlength="40" value="${h(subFromRepo(r.name))}" spellcheck="false" autocapitalize="none"><span class="mono zone">.${h(domain?.zone || ctx.zone || "your-domain")}</span></div></label>
      ${domain && !domain.linked ? `<p class="faint small" style="margin:-6px 0 12px">No domain is linked: it gets a random trycloudflare.com address for now.</p>` : ""}
      <label class="field"><span>Branch</span>
        <select class="input" id="bpBranch"><option value="">Auto — a Pages branch, else ${h(r.branch)}</option></select></label>
      <div class="field"><span>Who can open it</span><div id="bpAccBox">${ctx.accessSeg("bpAccess", "login", true)}</div></div>
      ${ctx.pwFields(false)}
      <div class="bp-log" id="bpLog" hidden></div>
      <div class="err-msg" id="bpErr"></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary" id="bpGo">${ROCKET} Deploy</button></div>
    </form>`, (m) => {
    const pwBox = m.querySelector("#fPwBox");
    pwBox.hidden = true;
    const sel = m.querySelector("#bpBranch");
    ctx.api(`/branches?account=${encodeURIComponent(S.acct)}&repo=${encodeURIComponent(r.full)}&default=${encodeURIComponent(r.branch)}`)
      .then((bl) => { for (const b of bl.branches) { const o = document.createElement("option"); o.value = b; o.textContent = b + (b === bl.default ? " — picked by Auto" : ""); sel.append(o); } })
      .catch(() => { sel.disabled = true; });
    m.querySelector("#bpAccBox").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.access = b.dataset.v;
      m.querySelectorAll("#bpAccBox button").forEach((x) => x.classList.toggle("on", x === b));
      pwBox.hidden = st.access !== "password";
      if (!pwBox.hidden) m.querySelector("#fPw").focus();
    });
    m.querySelector("#bpSub").focus();
    m.querySelector("#bpDF").addEventListener("submit", async (e) => {
      e.preventDefault();
      const go = m.querySelector("#bpGo"), err = m.querySelector("#bpErr"), log = m.querySelector("#bpLog");
      err.textContent = "";
      try {
        const pw = st.access === "password" ? await ctx.sealedPw(m, true) : {};
        go.disabled = true; go.textContent = "Deploying…";
        const { job } = await ctx.api("/deploy", { method: "POST", body: JSON.stringify({ account: S.acct, repo: r.full, sub: m.querySelector("#bpSub").value.trim().toLowerCase(), branch: m.querySelector("#bpBranch").value, access: st.access, ...pw }) });
        log.hidden = false;
        for (;;) {
          await new Promise((ok) => setTimeout(ok, 900));
          const j = await ctx.api(`/jobs/${job}`);
          log.textContent = j.log.join("\n"); log.scrollTop = log.scrollHeight;
          if (j.state === "running") continue;
          if (j.state === "error") throw new Error(j.error);
          ctx.closeModal();
          ctx.toast(`${r.name} is live${j.result.tunnel.host ? ` at ${j.result.tunnel.host}` : ""}`);
          S.at = 0; delete S.repos[S.acct]; load(ctx); ctx.refresh();
          return;
        }
      } catch (ex) { err.textContent = ex.message; go.disabled = false; go.innerHTML = `${ROCKET} Deploy`; }
    });
  });
}
