// Building a site that needs it (Vite, Astro, Hugo, Jekyll…) in a throwaway
// Docker container. The repository is copied in (never mounted: the build
// can't touch this machine's files), the command runs with limits on memory,
// processes, CPUs and time, and only the output folder is copied back out.
//
// The build runs the repository's own code (its package.json scripts and
// dependencies), with network access to install them: build what you trust.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const IMAGE_RE = /^[a-z0-9][a-z0-9._\/-]{0,127}(?::[A-Za-z0-9._-]{1,128})?$/;
export const OUTPUT_RE = /^(?!.*\.\.)[A-Za-z0-9._\/-]{1,200}$/;

function run(cmd, args, { onLine, timeout, input } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "", err = "", killed = false, partial = "";
    const t = timeout ? setTimeout(() => { killed = true; p.kill("SIGKILL"); }, timeout) : null;
    const feed = (d, isErr) => {
      const s = d.toString();
      if (isErr) err = (err + s).slice(-20000); else out = (out + s).slice(-200000);
      if (!onLine) return;
      partial += s;
      const lines = partial.split(/\r?\n|\r/);
      partial = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l);
    };
    p.stdout.on("data", (d) => feed(d, false));
    p.stderr.on("data", (d) => feed(d, true));
    p.on("error", (e) => { if (t) clearTimeout(t); no(e); });
    p.on("close", (code) => {
      if (t) clearTimeout(t);
      if (partial.trim() && onLine) onLine(partial);
      if (killed) return no(Object.assign(new Error("took too long and was stopped"), { status: 504 }));
      code === 0 ? ok(out) : no(Object.assign(new Error((err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit ${code}`), { code }));
    });
    if (input) p.stdin.end(input);
  });
}

let dockerState = null;
export async function docker(fresh) {
  if (dockerState && !fresh && Date.now() - dockerState.at < 5 * 60e3) return dockerState;
  try {
    const v = (await run("docker", ["version", "--format", "{{.Server.Version}}|{{.Server.Arch}}"], { timeout: 8000 })).trim().split("|");
    dockerState = { ok: true, version: v[0], arch: v[1], at: Date.now() };
  } catch (e) {
    dockerState = { ok: false, error: /ENOENT/.test(e.message) ? "Docker isn't installed on this machine." : /permission denied/i.test(e.message)
      ? "This user can't use Docker (add it to the docker group)." : `Docker didn't answer: ${e.message}`, at: Date.now() };
  }
  return dockerState;
}

// build({src, out, image, command, output, env, id, memory, timeout, cpus}, say)
export async function build(o, say) {
  const d = await docker();
  if (!d.ok) throw Object.assign(new Error(d.error), { status: 409 });
  if (!IMAGE_RE.test(o.image || "")) throw Object.assign(new Error("That image name doesn't look right."), { status: 400 });
  if (!OUTPUT_RE.test(o.output || "")) throw Object.assign(new Error("The output folder must be a path inside the repository, like dist."), { status: 400 });
  if (!String(o.command || "").trim()) throw Object.assign(new Error("Give the build a command."), { status: 400 });
  const name = `burrow-pages-build-${o.id}`;
  await run("docker", ["rm", "-f", name], { timeout: 20000 }).catch(() => {});

  // the image, once
  const have = await run("docker", ["image", "inspect", "--format", "{{.Id}}", o.image], { timeout: 15000 }).then(() => true, () => false);
  if (!have) {
    say(`Downloading the build image ${o.image}`);
    let last = 0;
    await run("docker", ["pull", o.image], { timeout: 15 * 60e3, onLine: (l) => { if (Date.now() - last > 3000 || /Status|Digest/.test(l)) { last = Date.now(); say(`  ${l.slice(0, 160)}`); } } });
  }

  const env = [];
  for (const [k, v] of Object.entries(o.env || {})) if (/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) env.push("-e", `${k}=${String(v).slice(0, 4000)}`);
  const memory = Math.max(256, Math.min(8192, Number(o.memory) || 1536));
  const args = ["create", "--name", name, "--label", "burrow-pages=build",
    "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE", "--cap-add", "FOWNER", "--cap-add", "SETUID", "--cap-add", "SETGID",
    "--security-opt", "no-new-privileges", "--pids-limit", "1024", "--memory", `${memory}m`, "--memory-swap", `${memory}m`,
    "--cpus", String(Math.max(0.5, Math.min(8, Number(o.cpus) || 2))),
    // package caches survive between builds of the same site
    "-v", `burrow-pages-cache-${o.cacheKey || o.id}:/cache`,
    "-e", "CI=true", "-e", "npm_config_cache=/cache/npm", "-e", "YARN_CACHE_FOLDER=/cache/yarn", "-e", "COREPACK_HOME=/cache/corepack",
    "-e", "npm_config_store_dir=/cache/pnpm", "-e", "BUNDLE_PATH=/cache/bundle", "-e", "PIP_CACHE_DIR=/cache/pip", "-e", "HUGO_CACHEDIR=/cache/hugo",
    "-e", "NODE_OPTIONS=--max-old-space-size=" + Math.floor(memory * 0.75),
    ...env, "-w", "/work", "--entrypoint", "sh", o.image, "-c", `set -e; ${o.command}`];
  const started = Date.now();
  try {
    await run("docker", args, { timeout: 60000 });
    say("Copying the repository into the build container");
    await run("docker", ["cp", `${o.src}/.`, `${name}:/work`], { timeout: 5 * 60e3 });
    say(`$ ${o.command}`);
    let lines = 0;
    await run("docker", ["start", "-a", name], {
      timeout: Math.max(1, Number(o.timeout) || 15) * 60e3,
      onLine: (l) => { if (++lines <= 4000) say(`  ${l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").slice(0, 300)}`); else if (lines === 4001) say("  … (the rest of the build log is cut)"); },
    }).catch((e) => { throw Object.assign(new Error(`The build failed: ${e.message}`), { status: e.status || 422 }); });
    say(`Built in ${Math.round((Date.now() - started) / 1000)} s; copying ${o.output}/ out`);
    mkdirSync(o.out, { recursive: true, mode: 0o755 });
    await run("docker", ["cp", `${name}:/work/${o.output.replace(/^\/+|\/+$/g, "")}/.`, o.out], { timeout: 5 * 60e3 })
      .catch(() => { throw Object.assign(new Error(`The build finished but made no ${o.output}/ folder. Check the output folder in the site's settings.`), { status: 422 }); });
    if (!existsSync(join(o.out, "index.html")) && !readdirSync(o.out).length) throw Object.assign(new Error(`${o.output}/ is empty after the build.`), { status: 422 });
    return { seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    await run("docker", ["rm", "-f", name], { timeout: 30000 }).catch(() => {});
  }
}

export async function dropCache(key) { await run("docker", ["volume", "rm", "-f", `burrow-pages-cache-${key}`], { timeout: 30000 }).catch(() => {}); }
