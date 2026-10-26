// Burrow Pages: its card on the Burrow page. The work happens in its own app
// (/__gate/pages); this card says how the sites are doing and opens it.
//
// Burrow imports this module (forge-addon.json "burrow": {"ui"}) and calls
// card(ctx) on every paint and wire(el, ctx) after it.

const S = { data: null, at: 0, loading: false, error: null };
const OPEN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

const style = document.createElement("style");
style.textContent = `
.bpx { padding: 18px; margin-bottom: 14px; border-color: rgba(61,220,151,.22);
       background: radial-gradient(120% 140% at 0% 0%, rgba(61,220,151,.07), transparent 55%), var(--card, #0f1012); }
.bpx-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.bpx-head .grow { min-width: 200px; }
.bpx-acts { display: flex; gap: 8px; }
.bpx-list { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.bpx-site { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 11px; border: 1px solid var(--line, rgba(255,255,255,.07)); background: rgba(255,255,255,.015); min-width: 0; }
.bpx-site:hover { border-color: rgba(255,255,255,.18); }
.bpx-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #555a62; }
.bpx-dot.ok { background: #3ddc97; box-shadow: 0 0 0 3px rgba(61,220,151,.15); } .bpx-dot.bad { background: #ff5a52; } .bpx-dot.busy { background: #7aa7ff; } .bpx-dot.off { background: #f2c14e; }
.bpx-site b { display: block; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bpx-site span { display: block; font: 11.5px var(--mono, monospace); color: var(--muted, #8a8f97); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bpx-empty { margin: 12px 0 0; color: var(--muted, #8a8f97); font-size: 13px; }
`;
document.head.appendChild(style);

function load(ctx) {
  if (S.loading || Date.now() - S.at < 15000) return;
  S.loading = true;
  ctx.api("/summary").then((d) => { S.data = d; S.error = null; }).catch((e) => { S.error = e.message; })
    .finally(() => { S.loading = false; S.at = Date.now(); ctx.render(); });
}

const dot = (s) => s.busy ? "busy" : s.paused ? "off" : (s.health && !s.health.ok) || (!s.current && s.type !== "proxy") ? "bad" : "ok";

export function card(ctx) {
  load(ctx);
  const h = ctx.h, d = S.data;
  const list = d?.sites || [];
  const live = list.filter((s) => dot(s) === "ok").length;
  return `<section class="card lit bpx" id="pagesCard">
    <div class="bpx-head">
      <div class="integ-logo"><img src="/__gate/api/addons/burrow-pages/image" alt=""></div>
      <div class="grow">
        <div class="integ-name">Burrow Pages ${d?.version ? `<span class="pill">v${h(d.version)}</span>` : ""}</div>
        <div class="integ-sub">${d ? (list.length ? `${live} of ${list.length} site${list.length === 1 ? "" : "s"} live${d.jobs ? ` · ${d.jobs} deploying` : ""}` : "Static sites from GitHub, GitLab, an upload, or anywhere, on your addresses.") : S.error ? h(S.error) : "Loading…"}</div>
      </div>
      <div class="bpx-acts"><a class="btn sm" href="/__gate/pages/#/new">${PLUS} New site</a><a class="btn sm primary" href="/__gate/pages/">${OPEN} Open</a></div>
    </div>
    ${list.length ? `<div class="bpx-list">${list.slice(0, 12).map((s) => `<a class="bpx-site" href="/__gate/pages/#/site/${h(s.id)}"><i class="bpx-dot ${dot(s)}"></i><div style="min-width:0"><b>${h(s.name)}</b><span>${h(s.host || s.sub || "")}</span></div></a>`).join("")}</div>` : ""}
    ${d?.legacy ? `<p class="bpx-empty">${d.legacy} old site tunnel${d.legacy === 1 ? "" : "s"} can move in: <a class="link" href="/__gate/pages/">open Burrow Pages</a>.</p>` : ""}
  </section>`;
}

export function wire() { /* links only */ }
