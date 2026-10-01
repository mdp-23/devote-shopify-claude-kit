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
