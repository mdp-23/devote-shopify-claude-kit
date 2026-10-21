// npm run release
//
// Puts approved work onto the live theme itself, so the live theme keeps its id (apps and
// integrations are tied to it). Only after a person ran `npm run approve` for this exact code.
// See scripts/approval.mjs for the whole flow.
//
// What it pushes, and what it never does:
//   - code files (sections, snippets, blocks, layout, assets, settings schema) that differ from live
//   - template and settings JSON that live does not have yet (a new page template)
//   - never a template or settings file live already has: those hold the live store's editor work
//   - never over a live file this repo has never seen: someone changed live outside the repo
//     (the code editor, an app). Those are brought into .theme-incoming/ and nothing is pushed.
//   - nothing is deleted on the live theme
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { APPROVAL, ROOT, approvalVerdict, deployTarget, inGitHistory, readApproval, reviewLink, unknownLiveChanges } from "./approval.mjs";
import { codeHash, reviewStatus } from "./review-stamp.mjs";
import { CODE_GLOBS, codeFilesIn, hashFile } from "./theme-sync.mjs";

const target = deployTarget();
if (!target.store) { console.log("package.json's deploy script has no --store. Stopping."); process.exit(1); }
const STORE = target.store;
const run = (args, opts = {}) => execFileSync("shopify", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });

// One release or deploy at a time (the same lock deploy uses).
const LOCK = join(ROOT, ".deploy.lock");
for (let waited = 0; ; waited += 2) {
  try { mkdirSync(LOCK); break; } catch {
    if (waited === 0) console.log("A deploy or release is running. Waiting for it to finish...");
    if (waited > 900) { console.log(`Still locked after 15 minutes. If nothing is running, remove ${LOCK}.`); process.exit(1); }
    execFileSync("sleep", ["2"]);
  }
}
process.on("exit", () => { try { rmSync(LOCK, { recursive: true, force: true }); } catch {} });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

// 1. A person approved exactly this code, and the reviews saw it.
const approval = readApproval();
const verdict = approvalVerdict(approval, { codeHash: codeHash(), store: STORE });
if (!verdict.ok) {
  console.log(`Not releasing: ${verdict.why}.`);
  if (target.theme) console.log(`Deploy (npm run deploy), have a person check ${reviewLink(target)} and run npm run approve -- --by "Their name" in their own terminal, then release.`);
  process.exit(1);
}
const review = reviewStatus();
if (!review.ok) { console.log(`Not releasing: ${review.why}.`); process.exit(1); }

// 2. Which theme is live. Could not check means stop.
let live;
try { live = JSON.parse(run(["theme", "list", "--store", STORE, "--role", "live", "--json"]))[0]; }
catch (e) { console.log(`Could not read which theme is live on ${STORE}. Stopping. (${String(e.message).split("\n")[0]})`); process.exit(1); }
if (!live?.id) { console.log(`Shopify listed no live theme on ${STORE}. Stopping.`); process.exit(1); }
const LIVE = String(live.id);
if (LIVE === String(target.theme)) { console.log("The deploy target is the live theme itself; there is nothing to release. Stopping."); process.exit(1); }

// 3. Code: what differs from live, and whether live holds anything this repo has never seen.
const liveCode = mkdtempSync(join(tmpdir(), "release-code-"));
run(["theme", "pull", "--store", STORE, "--theme", LIVE, "--path", liveCode, ...CODE_GLOBS.flatMap((g) => ["--only", g])]);
const liveFiles = new Set(codeFilesIn(liveCode));
if (!liveFiles.size) { console.log("Pulled no code from the live theme, so it is not known what it holds. Stopping."); process.exit(1); }
const changed = codeFilesIn(ROOT).filter((f) => !liveFiles.has(f) || hashFile(join(liveCode, f)) !== hashFile(join(ROOT, f)));
const strangers = unknownLiveChanges(changed.filter((f) => liveFiles.has(f)), (f) => inGitHistory(join(liveCode, f)));
if (strangers.length) {
  const INCOMING = join(ROOT, ".theme-incoming");
  for (const f of strangers) { mkdirSync(dirname(join(INCOMING, f)), { recursive: true }); cpSync(join(liveCode, f), join(INCOMING, f)); }
  console.log("Not releasing: these files were changed on the live theme outside this repo, and releasing would overwrite them:");
  for (const f of strangers) console.log(`  ${f}`);
  console.log("Live's versions are in .theme-incoming/. Merge them into the repo, delete .theme-incoming/, deploy, get a new approval, then release.");
  process.exit(1);
}

// 4. Editor files: only ones live does not have yet.
const EDITOR_DIRS = ["templates", "templates/customers", "config", "sections", "locales"];
const liveEditor = mkdtempSync(join(tmpdir(), "release-editor-"));
run(["theme", "pull", "--store", STORE, "--theme", LIVE, "--path", liveEditor, "--only", "templates/*.json", "--only", "templates/customers/*.json", "--only", "config/settings_data.json", "--only", "sections/*.json", "--only", "locales/*.json"]);
const editorIn = (dir) => EDITOR_DIRS.flatMap((d) => {
  const full = join(dir, d);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".json") && statSync(join(full, f)).isFile() && (d !== "config" || f === "settings_data.json"))
    .map((f) => `${d}/${f}`);
});
const liveEditorFiles = new Set(editorIn(liveEditor));
if (!liveEditorFiles.size) { console.log("Pulled no templates from the live theme, so it is not known which exist. Stopping."); process.exit(1); }
const newTemplates = editorIn(ROOT).filter((f) => !liveEditorFiles.has(f));

const files = [...changed, ...newTemplates];
if (!files.length) { console.log("The live theme already has this code. Nothing to release."); rmSync(APPROVAL, { force: true }); process.exit(0); }

// 5. Push just those files onto the live theme. A push "with errors" exits 0, so read the result.
const stage = mkdtempSync(join(tmpdir(), "release-push-"));
for (const f of files) { mkdirSync(dirname(join(stage, f)), { recursive: true }); cpSync(join(ROOT, f), join(stage, f)); }
const out = run(["theme", "push", "--store", STORE, "--theme", LIVE, "--path", stage, "--nodelete", "--allow-live", "--json"], { stdio: ["ignore", "pipe", "inherit"] });
let result = null;
try { result = JSON.parse(out.slice(out.lastIndexOf('{"theme"'))); } catch {}
if (!result) { console.log("Could not read the push result, so it is not known what reached the live theme. Check it now. Stopping."); process.exit(1); }
const errors = result.theme?.errors;
if (errors && Object.keys(errors).length) {
  console.log("Shopify rejected these files; the live theme still has the old copies:");
  for (const [f, msgs] of Object.entries(errors)) console.log(`  ${f}: ${[].concat(msgs).join("; ")}`);
  process.exit(1);
}

// 6. One approval, one release. Keep a record of who approved what went live.
rmSync(APPROVAL, { force: true });
appendFileSync(join(ROOT, "releases.log"), JSON.stringify({ at: new Date().toISOString(), approvedBy: approval.by, approvedAt: approval.at, commit: approval.commit, liveTheme: LIVE, files }) + "\n");
console.log(`Live: ${files.length} file(s) pushed to the live theme "${live.name}" (#${LIVE}), approved by ${approval.by}. The theme id is unchanged.`);
for (const f of files) console.log(`  ${f}`);
console.log(`\nCheck it: https://${target.domain || STORE}/`);
console.log("Then merge this branch into main and commit releases.log.");
