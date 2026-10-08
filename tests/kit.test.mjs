// The kit's own tests: the plugin wiring, and that nothing here identifies a client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inKit = existsSync(join(KIT, ".claude-plugin", "plugin.json")); // this file is also copied into brand repos

test("session start: says nothing outside a Shopify repo, and when the kit is current", { skip: !inKit }, async () => {
  const { advice } = await import("../hooks/session-start.mjs");
  assert.equal(advice({ isShopify: false, installed: null, current: "a" }), null);
  assert.equal(advice({ isShopify: true, installed: "a", current: "a" }), null);
  assert.match(advice({ isShopify: true, installed: null, current: "a" }), /setup/);
  assert.match(advice({ isShopify: true, installed: "old", current: "a" }), /out of date/);
});

test("plugin.json has no version, so every commit reaches the team", { skip: !inKit }, () => {
  const plugin = JSON.parse(readFileSync(join(KIT, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(plugin.version, undefined);
});

test("no client names or real store addresses in anything published", { skip: !inKit }, () => {
  const namesFile = join(KIT, ".client-names");
  assert.ok(existsSync(namesFile), ".client-names is missing, so this check cannot run. Recreate it: one client name per line.");
  const names = readFileSync(namesFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: KIT, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = [];
  for (const f of tracked) {
    const full = join(KIT, f);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const text = readFileSync(full, "utf8");
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`, "i");
      if (re.test(text)) problems.push(`${f}: names ${n}`);
    }
    for (const m of text.matchAll(/([a-z0-9-]+)\.myshopify\.com/gi)) {
      if (!/^(acme|acme-store|x|example|your-store|something|fill-in)$/i.test(m[1])) problems.push(`${f}: real store address ${m[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("only install-shopify-cli.sh installs global npm packages, and nothing tells anyone to use sudo", { skip: !inKit }, () => {
  // Node from nodejs.org leaves npm's global folder owned by root, so a bare `npm install -g` fails
  // with EACCES on a staff Mac. The installer script falls back to a folder the person owns.
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: KIT, encoding: "utf8" })
    .split("\n").filter((f) => /\.(sh|md|mjs)$/.test(f) && f !== "install-shopify-cli.sh" && !f.startsWith("tests/"));
  const problems = [];
  for (const f of files) {
    const text = readFileSync(join(KIT, f), "utf8");
    if (/npm (install|i) (-g|--global)\b/.test(text)) problems.push(`${f}: npm install -g (use install-shopify-cli.sh)`);
    if (/\bsudo npm\b/.test(text)) problems.push(`${f}: sudo npm`);
  }
  assert.deepEqual(problems, []);
});

test("session start turns on marketplace auto-update, and leaves it alone once on", { skip: !inKit }, async () => {
  const { withAutoUpdate } = await import("../hooks/auto-update.mjs");
  const fresh = withAutoUpdate({ theme: "dark" });
  assert.equal(fresh.theme, "dark");
  assert.deepEqual(fresh.extraKnownMarketplaces.devote, { source: { source: "github", repo: "mdp-23/devote-shopify-claude-kit" }, autoUpdate: true });
  const other = { source: { source: "github", repo: "someone/else" } };
  const existing = withAutoUpdate({ extraKnownMarketplaces: { other, devote: { source: { source: "github", repo: "mdp-23/devote-shopify-claude-kit" } } } });
  assert.deepEqual(existing.extraKnownMarketplaces.other, other);
  assert.equal(existing.extraKnownMarketplaces.devote.autoUpdate, true);
  assert.equal(withAutoUpdate(existing), null);
  const hook = readFileSync(join(KIT, "hooks", "session-start.mjs"), "utf8");
  assert.match(hook, /enableAutoUpdate\(\)/);
});
