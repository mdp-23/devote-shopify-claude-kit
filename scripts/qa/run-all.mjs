// The one command that checks this repo: theme check, then every guard.
//
// A guard is any *.mjs in scripts/qa except this file, ship-gate.mjs (a hook,
// not a guard) and anything *-walk.mjs (needs a browser or a live store, so it
// is run by hand). A guard fails by exiting non-zero and printing why.
//
// Nothing here ever reports a pass for a check that did not run. A missing
// Shopify CLI and an empty guards folder both say so, loudly, and the exit code
// stays 0 because neither is a defect in the code being checked.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(["run-all.mjs", "ship-gate.mjs"]);
const notRun = [];
const failed = [];

function have(cmd) {
  try {
    execFileSync("/usr/bin/env", ["which", cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// 1. Theme check
if (!have("shopify")) {
  notRun.push("theme check (the Shopify CLI is not installed: https://shopify.dev/docs/api/shopify-cli)");
} else {
  // Baseline pattern: this theme came with offences of its own (1 Oct 2026). Each file's
  // count is committed in theme-check-baseline.json and may only fall; a file not in the baseline
  // (a new file) must have none. --write-baseline records the current counts after a clean-up.
  const BASE = join(HERE, "theme-check-baseline.json");
  let out = "";
  try {
    out = execFileSync("shopify", ["theme", "check", "--output", "json", "--fail-level", "crash"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = (e.stdout || "").toString();
  }
  let results = null;
  try { results = JSON.parse(out.slice(out.indexOf("["))); } catch { results = null; }
  if (!Array.isArray(results)) {
    failed.push("theme check");
    console.log("  FAIL theme check (could not read its JSON output, so nothing was checked)");
  } else {
    const ROOT = join(HERE, "..", "..");
    const counts = {};
    for (const f of results) {
      const rel = f.path.startsWith(ROOT) ? f.path.slice(ROOT.length + 1) : f.path;
      const n = f.offenses.filter((o) => o.severity === 0 || o.severity === "error").length;
      if (n) counts[rel] = n;
    }
    if (process.argv.includes("--write-baseline")) {
      writeFileSync(BASE, JSON.stringify(counts, null, 2) + "\n");
      console.log(`  wrote ${BASE}`);
    }
    const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : {};
    const worse = Object.entries(counts).filter(([f, n]) => n > (base[f] || 0));
    if (worse.length) {
      failed.push("theme check");
      for (const [f, n] of worse) console.log(`  theme check: ${f} has ${n} errors, baseline ${base[f] || 0}`);
      console.log("  FAIL theme check (run shopify theme check on those files)");
    } else {
      console.log("  ok   theme check (no file above its baseline)");
    }
  }
}

// 2. Guards
const guards = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !SKIP.has(f) && !f.endsWith("-walk.mjs"))
  .sort();

if (guards.length === 0) {
  notRun.push("the guards (none written yet: see the table in CLAUDE.md for the first thirteen)");
}

for (const guard of guards) {
  try {
    execFileSync(process.execPath, [join(HERE, guard)], { stdio: "inherit" });
    console.log(`  ok   ${guard}`);
  } catch {
    failed.push(guard);
    console.log(`  FAIL ${guard}`);
  }
}

// 3. Say what happened, including what did not happen
console.log("");
if (notRun.length) {
  console.log("NOT CHECKED:");
  for (const n of notRun) console.log(`  - ${n}`);
  console.log("");
}
if (failed.length) {
  console.log(`${failed.length} failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(notRun.length ? "Everything that could run, passed." : "All checks passed.");
