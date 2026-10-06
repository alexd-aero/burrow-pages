// Burrow Pages' install check: is the linked domain eligible, and does it
// already point at GitHub or GitLab Pages (and for which account)?
// Reads Burrow's GET /dns (control socket) on stdin; prints what it found.
// The accounts it names are added on the card once the addon runs
// (extension.mjs, adoptFromDomain); remove any that aren't yours there.
import { detectSetups } from "./lib.mjs";

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let j;
  try { j = JSON.parse(raw); } catch { console.log("::warn Burrow didn't say which domain is linked."); return; }
  if (!j.domain) {
    console.log("No domain is linked yet: each site gets a random trycloudflare.com address.");
    console.log("::warn Link a domain (Settings → Domain) to give sites subdomains of your own.");
    return;
  }
  const zone = j.domain.zone;
  if (j.error) { console.log(`::warn Burrow couldn't read ${zone}'s DNS records (${j.error}). Sites still work.`); return; }
  console.log(`✓ ${zone} is eligible: sites can live at NAME.${zone}`);
  const setups = detectSetups(j.records);
  if (!setups.length) { console.log(`Nothing on ${zone} points at GitHub or GitLab Pages yet.`); return; }
  for (const s of setups) {
    const who = s.account ? `@${s.account}` : "an account the records don't name";
    console.log(`${s.provider === "github" ? "GitHub" : "GitLab"} Pages is set up on ${s.names.join(", ")} for ${who}${s.how.includes("verified") ? " (verified)" : ""}.`);
    if (s.account) console.log(`  @${s.account} is added as an account; remove it on the Burrow Pages card if it isn't yours.`);
    else console.log(`  ${s.provider === "github" ? "GitHub" : "GitLab"} doesn't publish which account owns it: add yours by its username on the Burrow Pages card.`);
  }
});
