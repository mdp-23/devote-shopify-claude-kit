// npm run approve -- --by "Your name"
//
// Run by a person, in their own terminal, after opening the review link and checking the work.
// Claude never runs this (the ship gate refuses): an approval has to mean somebody looked.
// It records who approved which code, and only if the preview theme is showing exactly that code,
// so nobody approves one thing and releases another. See scripts/approval.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPROVAL, ROOT, deployTarget, reviewLink } from "./approval.mjs";
import { codeHash } from "./review-stamp.mjs";
import { CODE_GLOBS, codeFilesIn, hashFile } from "./theme-sync.mjs";

const i = process.argv.indexOf("--by");
const by = i > -1 ? (process.argv[i + 1] || "").trim() : "";
if (!by) { console.log('Say who is approving: npm run approve -- --by "Your name"'); process.exit(1); }

const target = deployTarget();
if (!target.store || !target.theme) { console.log("package.json's deploy script has no --store or --theme, so it is not known which preview you checked. Stopping."); process.exit(1); }

// The preview must hold this repo's code, or the approval is for something nobody looked at.
const pulled = mkdtempSync(join(tmpdir(), "approve-pull-"));
try {
  execFileSync("shopify", ["theme", "pull", "--store", target.store, "--theme", target.theme, "--path", pulled, ...CODE_GLOBS.flatMap((g) => ["--only", g])], { stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.log(`Could not read the preview theme, so it is not known what you checked. Stopping. (${String(e.message).split("\n")[0]})`);
  process.exit(1);
}
const preview = Object.fromEntries(codeFilesIn(pulled).map((f) => [f, hashFile(join(pulled, f))]));
if (!Object.keys(preview).length) { console.log("Pulled no code from the preview theme, so it is not known what you checked. Stopping."); process.exit(1); }
const differ = codeFilesIn(ROOT).filter((f) => preview[f] !== hashFile(join(ROOT, f)));
if (differ.length) {
  console.log("Not approved: the preview is not showing this repo's code, so what you checked is not what would go live:");
  for (const f of differ.slice(0, 20)) console.log(`  ${f}`);
  console.log("Deploy first (npm run deploy), check the review link again, then approve.");
  process.exit(1);
}

let commit = null;
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch {}
writeFileSync(APPROVAL, JSON.stringify({ by, at: new Date().toISOString(), store: target.store, previewTheme: target.theme, commit, codeHash: codeHash() }, null, 2) + "\n");
console.log(`Approved by ${by}: the code on ${reviewLink(target)}`);
console.log("Next: npm run release puts it on the live theme (same theme id). Any code change from here needs a new deploy and approval.");
