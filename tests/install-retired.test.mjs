// install.sh takes out scripts the kit no longer uses, and every hook that still calls them.
//
// Exists because on one brand repo (Nov 2026) a gate script from before the kit stayed in
// scripts/qa after install, .claude/settings.json kept calling it as a hook, and the installer
// reported "already had the gate, left it alone". The Windows tests then failed on that file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inKit = existsSync(join(KIT, "install.sh")); // this file is also copied into brand repos
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };

test("a retired script is kept aside and its hook is taken out; the kit's gate stays", { skip: !inKit || process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "install-retired-"));
  const repo = join(dir, "repo"), bin = join(dir, "bin");
  try {
    const put = (f, body) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
    put(join(repo, "sections", "main.liquid"), "<p>x</p>\n");
    put(join(repo, "scripts", "qa", "editor-push-gate.mjs"), "process.exit(0);\n");
    put(join(repo, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [
            { type: "command", command: "node scripts/qa/editor-push-gate.mjs" },
            { type: "command", command: "node scripts/qa/ship-gate.mjs" },
          ] },
          { matcher: "Write", hooks: [{ type: "command", command: "node scripts/qa/editor-push-gate.mjs" }] },
        ],
      },
    }));
    execFileSync("git", ["init", "-q"], { cwd: repo, env: GIT_ENV });
    // No network: npm and claude are stubs that do nothing.
    put(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "npm"), 0o755);
    const PATH = [bin, dirname(process.execPath), "/usr/bin", "/bin", ...(process.env.PATH || "").split(":")].join(":");
    const r = spawnSync("sh", [join(KIT, "install.sh")], { cwd: repo, env: { ...GIT_ENV, PATH }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(existsSync(join(repo, "scripts", "qa", "editor-push-gate.mjs")), false);
    assert.equal(existsSync(join(repo, "scripts", "qa", "editor-push-gate.mjs.before-devote-kit")), true);
    const settings = readFileSync(join(repo, ".claude", "settings.json"), "utf8");
    assert.doesNotMatch(settings, /editor-push-gate/);
    const pre = JSON.parse(settings).hooks.PreToolUse;
    assert.ok(pre.some((e) => e.matcher === "Bash" && JSON.stringify(e).includes("ship-gate.mjs")));
    assert.ok(pre.every((e) => e.hooks.length), "no hook entry left empty");
    assert.match(r.stdout, /retired scripts\/qa\/editor-push-gate\.mjs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
