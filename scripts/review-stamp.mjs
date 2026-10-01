// The review gate: `npm run deploy` refuses to push theme code that has not been through
// /code-review and /security-review since it last changed (Marcel, 1 Oct 2026).
//
// How it works. The code files (sections, snippets, blocks, layout, assets, locales and the
// settings schema) are hashed together. After running both reviews and fixing what they find,
// save each review's report under reviews/ and stamp:
//
//   npm run review:stamp -- --code reviews/<date>-code-review.md --security reviews/<date>-security-review.md
//
// The stamp records the hash. deploy.mjs recomputes it and stops if any code file changed since,
// so a fix made after the review needs another review before it ships. Template and settings
// JSON (editor content) are not part of the hash: content changes deploy without a review.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const STAMP = join(ROOT, ".review-stamp.json");
// locales are editor-owned (Edit default theme content writes them), so they are content, not code
const DIRS = ["sections", "snippets", "blocks", "layout", "assets"];
const FILES = ["config/settings_schema.json"];

export function codeFiles() {
  const out = [];
  for (const d of DIRS) {
    const dir = join(ROOT, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isFile() && !(d === "sections" && f.endsWith(".json"))) out.push(p);
    }
  }
  for (const f of FILES) if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  return out.sort();
}

export function codeHash() {
  const h = createHash("sha256");
  for (const p of codeFiles()) { h.update(relative(ROOT, p)); h.update("\0"); h.update(readFileSync(p)); h.update("\0"); }
  return h.digest("hex").slice(0, 20);
}

export function reviewStatus() {
  if (!existsSync(STAMP)) return { ok: false, why: "no review has been stamped yet" };
  const s = JSON.parse(readFileSync(STAMP, "utf8"));
  const now = codeHash();
  if (s.hash !== now) return { ok: false, why: `code changed since the last review (${s.at}, ${s.code} and ${s.security})` };
  return { ok: true, stamp: s };
}

// CLI: stamp after both reviews
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const code = arg("--code"), security = arg("--security");
  const problems = [];
  const newest = Math.max(...codeFiles().map((p) => statSync(p).mtimeMs));
  for (const [label, f] of [["--code (the /code-review report)", code], ["--security (the /security-review report)", security]]) {
    if (!f) { problems.push(`missing ${label}`); continue; }
    const p = resolve(ROOT, f);
    if (!existsSync(p)) { problems.push(`${f} does not exist`); continue; }
    if (readFileSync(p, "utf8").trim().length < 80) problems.push(`${f} is empty: paste the review's findings and what was fixed`);
    if (statSync(p).mtimeMs < newest) problems.push(`${f} is older than the latest code change: the review did not see the current code`);
  }
  if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
  const stamp = { hash: codeHash(), code, security, at: new Date().toISOString() };
  writeFileSync(STAMP, JSON.stringify(stamp, null, 2) + "\n");
  console.log(`Stamped ${stamp.hash}. npm run deploy will push this code; any further code change needs another review.`);
}
