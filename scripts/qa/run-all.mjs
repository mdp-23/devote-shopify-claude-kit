// The one command that checks this repo: theme check, then every guard.
//
// A guard is any *.mjs in scripts/qa except this file, ship-gate.mjs (a hook,
// not a guard) and anything *-walk.mjs (needs a browser or a live store, so it
// is run by hand). A guard fails by exiting non-zero and printing why.
//
// Nothing here ever reports a pass for a check that did not run. A missing
// Shopify CLI and an empty guards folder both say so, loudly, and the exit code
// stays 0 because neither is a defect in the code being checked.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execCli, haveCli, repoPath, slashKeys } from "../platform.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(["run-all.mjs", "ship-gate.mjs"]);
const notRun = [];
const failed = [];


// 1. Theme check
if (!haveCli("shopify")) {
  notRun.push("theme check (the Shopify CLI is not installed: https://shopify.dev/docs/api/shopify-cli)");
} else {
  // Baseline pattern: this theme came with offences of its own (1 Oct 2026). Each file's
  // count is committed in theme-check-baseline.json and may only fall; a file not in the baseline
  // (a new file) must have none. --write-baseline records the current counts after a clean-up.
  const BASE = join(HERE, "theme-check-baseline.json");
  let out = "";
  try {
    out = execCli("shopify", ["theme", "check", "--output", "json", "--fail-level", "crash"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
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
      const rel = repoPath(ROOT, f.path);
      const n = f.offenses.filter((o) => o.severity === 0 || o.severity === "error").length;
      if (n) counts[rel] = n;
    }
    if (process.argv.includes("--write-baseline")) {
      writeFileSync(BASE, JSON.stringify(counts, null, 2) + "\n");
      console.log(`  wrote ${BASE}`);
    }
    const base = existsSync(BASE) ? slashKeys(JSON.parse(readFileSync(BASE, "utf8"))) : {};
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
//
// A problem the theme already had when it was first pulled passes; only what the build adds fails.
// Exists because on one build (Nov 2026) the live theme came with offences against five guards, so
// every push was blocked by problems nobody on the build had made, and pushes went out with
// --no-verify. When a guard fails, it is run again on the theme as first pulled: the commit in
// hard-coded-text-baseline.json ("from") when that file exists, otherwise the repo's first commit,
// the same starting point no-hard-coded-text.mjs uses. Each problem it prints there, line numbers
// aside, may stay (as often as it was there). no-hard-coded-text.mjs keeps its own comparison.
const ROOT = join(HERE, "..", "..");
const OWN_BASELINE = new Set(["no-hard-coded-text.mjs"]);
const THEME_DIRS = ["sections", "snippets", "blocks", "layout", "templates", "config", "locales"];
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (args, input) => execFileSync("git", args, { cwd: ROOT, input, env: GIT_ENV, maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const problemLines = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("known (in baseline)"));
const withoutLineNumber = (l) => l.replace(/^([^\s:]+):\d+(?=:)/, "$1");

function runGuard(root, guard) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "qa", guard)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// The theme as first pulled, written to a temp folder with the current guards beside it. Built once.
let firstPulled;
function firstPulledTree() {
  if (firstPulled !== undefined) return firstPulled;
  try {
    const BASE = join(HERE, "hard-coded-text-baseline.json");
    let ref = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")).from : null;
    if (!ref) { const roots = git(["rev-list", "--max-parents=0", "HEAD"]).toString().trim().split("\n"); ref = roots[roots.length - 1]; }
    const files = git(["ls-tree", "-r", "--name-only", ref, "--", ...THEME_DIRS]).toString().split("\n").filter(Boolean);
    const dir = mkdtempSync(join(tmpdir(), "first-pulled-"));
    const buf = git(["cat-file", "--batch"], files.map((f) => `${ref}:${f}`).join("\n") + "\n");
    let pos = 0;
    for (const f of files) {
      const nl = buf.indexOf(10, pos);
      const header = buf.slice(pos, nl).toString();
      pos = nl + 1;
      if (/ missing$/.test(header)) continue;
      const size = Number(header.split(" ")[2]);
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), buf.slice(pos, pos + size));
      pos += size + 1;
    }
    mkdirSync(join(dir, "scripts", "qa"), { recursive: true });
    for (const f of readdirSync(HERE)) if (f.endsWith(".mjs") || f.endsWith(".json")) copyFileSync(join(HERE, f), join(dir, "scripts", "qa", f));
    for (const f of readdirSync(join(HERE, ".."))) if (f.endsWith(".mjs")) copyFileSync(join(HERE, "..", f), join(dir, "scripts", f));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    firstPulled = { dir, ref: String(ref).slice(0, 7) };
  } catch (e) {
    firstPulled = { error: String(e.stderr || e.message).trim().split("\n")[0] };
  }
  return firstPulled;
}

// The problems this guard reports now that it did not report on the theme as first pulled.
function newProblems(guard, now) {
  const tree = firstPulledTree();
  if (tree.error) return { lines: now, why: `could not read the theme as first pulled (${tree.error})` };
  const then = runGuard(tree.dir, guard);
  const known = new Map();
  if (then.code !== 0) for (const l of problemLines(then.out)) known.set(withoutLineNumber(l), (known.get(withoutLineNumber(l)) || 0) + 1);
  const lines = [];
  for (const l of now) {
    const k = withoutLineNumber(l);
    if (known.get(k)) known.set(k, known.get(k) - 1);
    else lines.push(l);
  }
  return { lines, ref: tree.ref };
}

const guards = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !SKIP.has(f) && !f.endsWith("-walk.mjs"))
  .sort();

if (guards.length === 0) {
  notRun.push("the guards (none written yet: see the table in CLAUDE.md for the first thirteen)");
}

for (const guard of guards) {
  const r = runGuard(ROOT, guard);
  if (r.code === 0) {
    process.stdout.write(r.out);
    console.log(`  ok   ${guard}`);
    continue;
  }
  const now = problemLines(r.out);
  // A guard that crashed, or one that keeps its own baseline, fails as it is.
  const fresh = OWN_BASELINE.has(guard) || !now.length ? { lines: null } : newProblems(guard, now);
  if (fresh.lines && !fresh.lines.length) {
    console.log(`  ok   ${guard} (${now.length} problem${now.length === 1 ? "" : "s"} the theme already had at ${fresh.ref}, the theme as first pulled)`);
    continue;
  }
  process.stdout.write(fresh.lines ? fresh.lines.map((l) => "  " + l + "\n").join("") : r.out);
  process.stderr.write(r.err);
  if (fresh.why) console.log(`  (${fresh.why}, so every problem counts)`);
  else if (fresh.lines && fresh.lines.length < now.length) console.log(`  (${now.length - fresh.lines.length} more the theme already had at ${fresh.ref} are allowed)`);
  failed.push(guard);
  console.log(`  FAIL ${guard}`);
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
