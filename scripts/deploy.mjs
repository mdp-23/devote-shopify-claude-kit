// The only way to push this theme. It never overwrites work someone did in the theme editor.
//
// Exists because on 30 Sep 2026 Marcel changed a client's homepage video, image and copy in the editor
// while code kept being pushed; one more push of templates/index.json would have wiped it.
// People edit a live Shopify theme in the editor, and a repo push does not know.
//
//   npm run deploy                   # QA, push code, then SEO, accessibility and speed on the preview
//   npm run deploy -- --skip-walks   # while iterating: no SEO or speed, and it says so (not for handover)
//   npm run deploy -- --with-json    # also push your template/settings changes, only if safe
//   npm run deploy -- --pull         # just bring editor changes into the repo
//   npm run deploy -- --with-json --json templates/product.json,templates/collection.json
//                                    # push only these editor files of yours (parallel page builds)
// Runs one at a time: a second deploy waits for the first (lock in .deploy.lock), so two
// people or agents deploying together never interleave a pull, a baseline and a push.
//
// Editor-owned files: templates/**/*.json, config/settings_data.json, sections/*.json (the
// header and footer groups) and locales/*.json (Edit default theme content). Every deploy first pulls them from the target theme and compares
// with .editor-baseline.json, the hashes of what the theme held at the last sync:
//   - theme differs from the baseline: someone edited it. Their files are written into the
//     repo, nothing is pushed, and the run stops. Review, commit, run again.
//   - theme matches the baseline: nobody has touched it since. Code is pushed; with
//     --with-json, your changed editor files are pushed too, and the baseline moves on.
// Target: --store and --theme, or SHOPIFY_STORE and THEME_ID. Set them in package.json's deploy script.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewStatus } from "./review-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const STORE = arg("--store") || process.env.SHOPIFY_STORE;
const THEME = arg("--theme") || process.env.THEME_ID;
if (!STORE || !THEME) { console.log("Say which store and theme: --store x.myshopify.com --theme <id>, or SHOPIFY_STORE and THEME_ID. Stopping."); process.exit(1); }
const WITH_JSON = process.argv.includes("--with-json");
const PULL_ONLY = process.argv.includes("--pull");
const BASELINE = join(ROOT, ".editor-baseline.json");
const ONLY_JSON = arg("--json") ? arg("--json").split(",").map((f) => f.trim()).filter(Boolean) : null;
// The store's real domain: the SEO and speed walks test the preview on it, because the
// myshopify.com address adds a redirect no visitor pays (see DEVOTE-KIT.md, speed).
const DOMAIN = (arg("--domain") || process.env.SHOP_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const SKIP_WALKS = process.argv.includes("--skip-walks");

// one deploy at a time
const LOCK = join(ROOT, ".deploy.lock");
for (let waited = 0; ; waited += 2) {
  try { mkdirSync(LOCK); break; } catch {
    if (waited === 0) console.log("Another deploy is running. Waiting for it to finish...");
    if (waited > 900) { console.log(`Still locked after 15 minutes. If no deploy is running, remove ${LOCK}.`); process.exit(1); }
    execFileSync("sleep", ["2"]);
  }
}
const unlock = () => { try { rmSync(LOCK, { recursive: true, force: true }); } catch {} };
process.on("exit", unlock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
// locales too: the theme editor's "Edit default theme content" writes locales/*.json
const EDITOR_GLOBS = ["templates/*.json", "templates/customers/*.json", "config/settings_data.json", "sections/*.json", "locales/*.json"];

const run = (args, opts = {}) => execFileSync("shopify", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
// A push "with errors" still exits 0 and prints success, while Shopify has silently kept the old
// copy of every rejected file (1 Oct 2026: an invalid header schema never uploaded and the
// deploy said "Code pushed"). Push with --json and stop on any rejected file.
function pushChecked(args, opts = {}) {
  const out = run([...args, "--json"], { ...opts, stdio: ["ignore", "pipe", "inherit"] });
  const at = out.lastIndexOf('{"theme"');
  let result = null;
  try { result = JSON.parse(out.slice(at)); } catch { result = null; }
  if (at < 0 || !result) { console.log("Could not read the push result, so it is not known what uploaded. Stopping."); process.exit(1); }
  const errors = result.theme && result.theme.errors;
  if (errors && Object.keys(errors).length) {
    console.log("Shopify rejected these files; the theme still has the old copies:");
    for (const [f, msgs] of Object.entries(errors)) console.log(`  ${f}: ${[].concat(msgs).join("; ")}`);
    process.exit(1);
  }
}
const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
function list(dir) {
  const out = [];
  for (const sub of ["templates", "templates/customers", "config", "sections", "locales"]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (!statSync(p).isFile() || !f.endsWith(".json")) continue;
      if (sub === "config" && f !== "settings_data.json") continue;
      out.push(relative(dir, p));
    }
  }
  return out.sort();
}

// 1. What does the theme hold right now?
const remote = mkdtempSync(join(tmpdir(), "editor-pull-"));
const only = EDITOR_GLOBS.flatMap((g) => ["--only", g]);
run(["theme", "pull", "--store", STORE, "--theme", THEME, "--path", remote, ...only]);
const remoteFiles = list(remote);
if (!remoteFiles.length) { console.log("Pulled nothing from the theme, so nothing is known about the editor. Stopping."); process.exit(1); }
const remoteHashes = Object.fromEntries(remoteFiles.map((f) => [f, hash(join(remote, f))]));
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8"))[THEME] || null : null;

const editedInEditor = baseline
  ? remoteFiles.filter((f) => remoteHashes[f] !== baseline[f])
  : remoteFiles.filter((f) => !existsSync(join(ROOT, f)) || hash(join(ROOT, f)) !== remoteHashes[f]);

function adoptRemote(files) {
  for (const f of files) { mkdirSync(dirname(join(ROOT, f)), { recursive: true }); cpSync(join(remote, f), join(ROOT, f)); }
  const all = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  all[THEME] = remoteHashes;
  writeFileSync(BASELINE, JSON.stringify(all, null, 2) + "\n");
}

if (PULL_ONLY || editedInEditor.length) {
  adoptRemote(editedInEditor.length ? editedInEditor : []);
  if (editedInEditor.length) {
    console.log(`The theme was edited in the editor since the last sync. Pulled into the repo:\n  ${editedInEditor.join("\n  ")}`);
    console.log("\nNothing was pushed. Review with git diff, commit, then run deploy again.");
    process.exit(PULL_ONLY ? 0 : 1);
  }
  console.log("No editor changes since the last sync. Baseline recorded.");
  process.exit(0);
}

// 2. Code only ships after /code-review and /security-review have seen it (scripts/review-stamp.mjs).
const review = reviewStatus();
if (!review.ok) {
  console.log(`Not deploying: ${review.why}.`);
  console.log("Run /code-review and /security-review on the changes, fix what they find, save both reports under reviews/, then:");
  console.log("  npm run review:stamp -- --code reviews/<report>.md --security reviews/<report>.md");
  process.exit(1);
}

// 2b. QA before anything leaves this machine. Brand repos are rarely pushed to git, so the
// pre-push hook alone meant QA never ran before a deploy (Marcel, 1 Oct 2026: "before it
// deploys, run the SEO check, the speed check, the reviews and the QA checks").
if (process.env.SKIP_QA === "1") {
  console.log("QA SKIPPED (SKIP_QA=1): deploying unchecked code. Say so in the handover.");
} else {
  for (const [label, cmd, args] of [["QA guards", process.execPath, [join(ROOT, "scripts/qa/run-all.mjs")]], ["tests", process.execPath, ["--test", ...readdirSync(join(ROOT, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => join(ROOT, "tests", f))]]]) {
    try { execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" }); }
    catch { console.log(`\nNot deploying: ${label} failed. Fix them, then run deploy again. Then reflect (DEVOTE-KIT.md, "Reflect after every deploy").`); process.exit(1); }
  }
}

// 3. Theme matches the baseline: push code. .shopifyignore keeps editor files out of it.
const ignore = readFileSync(join(ROOT, ".shopifyignore"), "utf8");
for (const g of ["templates/*.json", "config/settings_data.json", "sections/*.json", "locales/*.json"]) {
  if (!ignore.includes(g)) { console.log(`.shopifyignore must list ${g}. Stopping before a push that could carry editor files.`); process.exit(1); }
}
pushChecked(["theme", "push", "--store", STORE, "--theme", THEME, "--nodelete"], { cwd: ROOT });
console.log("Code pushed. Editor-owned files were not sent.");

// 4. Optionally, your own editor-file changes, now that the theme is known to be untouched.
if (WITH_JSON) {
  const mine = list(ROOT).filter((f) => remoteHashes[f] !== hash(join(ROOT, f)) && (!ONLY_JSON || ONLY_JSON.includes(f)));
  if (!mine.length) console.log("No template or settings changes of yours to push.");
  else {
    const stage = mkdtempSync(join(tmpdir(), "editor-push-"));
    for (const f of mine) { mkdirSync(dirname(join(stage, f)), { recursive: true }); cpSync(join(ROOT, f), join(stage, f)); }
    pushChecked(["theme", "push", "--store", STORE, "--theme", THEME, "--nodelete", "--path", stage]);
    const all = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    all[THEME] = { ...remoteHashes, ...Object.fromEntries(mine.map((f) => [f, hash(join(ROOT, f))])) };
    writeFileSync(BASELINE, JSON.stringify(all, null, 2) + "\n");
    console.log(`Pushed your changes to:\n  ${mine.join("\n  ")}\nBaseline updated. Commit .editor-baseline.json.`);
  }
}

// 5. SEO, accessibility and speed on the preview just pushed. They need the pushed theme, so they run after the
// push; the theme is an unpublished preview, so nothing a customer sees has changed. A FAIL here
// means the preview is not ready to hand over, and the exit code says so.
if (SKIP_WALKS) {
  console.log("\nSEO, accessibility and speed NOT CHECKED (--skip-walks). Run a full npm run deploy before any handover.");
  process.exit(0);
}
if (!DOMAIN) {
  console.log("\nSEO, accessibility and speed NOT CHECKED: no --domain in package.json's deploy script (the store's real domain, e.g. www.acme.com.au). Add it and deploy again.");
  process.exit(1);
}
const PREVIEW_URL = `https://${DOMAIN}/?preview_theme_id=${THEME}`;
const failedWalks = [];
for (const [label, script, env] of [
  ["SEO", "scripts/qa/seo-walk.mjs", { PREVIEW_URL }],
  ["accessibility", "scripts/qa/a11y-walk.mjs", { PREVIEW_URL }],
  ["speed", "scripts/qa/speed-walk.mjs", { PREVIEW_URL, LIVE_URL: `https://${DOMAIN}/`, RUNS: process.env.RUNS || "3" }],
]) {
  console.log(`\n${label} check on ${PREVIEW_URL}`);
  try { execFileSync(process.execPath, [join(ROOT, script)], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } }); }
  catch { failedWalks.push(label); }
}
if (failedWalks.length) {
  console.log(`\nPushed to the preview, but ${failedWalks.join(" and ")} failed. Not ready to hand over: fix it, deploy again, then reflect (DEVOTE-KIT.md, "Reflect after every deploy").`);
  process.exit(1);
}
console.log("\nPushed to the preview. QA, code review, security review, SEO, accessibility and speed all passed.");
