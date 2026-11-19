// npm run qa passes problems the theme already had when it was first pulled, and fails new ones.
//
// Exists because on one build (Nov 2026) the live theme came with offences against five guards,
// so the pre-push hook blocked every push for problems nobody on the build had made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const GUARD = "liquid-no-filters-in-tags.mjs";
const BAD = "{% if product.title | upcase == 'X' %}x{% endif %}\n";

function repoWith(files) {
  const repo = mkdtempSync(join(tmpdir(), "first-pulled-test-"));
  const put = (f, body) => { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), body); };
  for (const [f, body] of Object.entries(files)) put(f, body);
  const git = (...a) => execFileSync("git", a, { cwd: repo, env: GIT_ENV, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "theme as downloaded");
  // The kit's code only. A brand repo's *-baseline.json files point at its own history (a "from"
  // commit), which this temporary repo does not have, so every guard failed there (Nov 2026).
  cpSync(join(KIT, "scripts"), join(repo, "scripts"), { recursive: true, filter: (src) => !src.endsWith("-baseline.json") });
  // No Shopify CLI on PATH, so theme check says NOT CHECKED instead of running for real.
  const env = { ...GIT_ENV, PATH: dirname(execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split(/\r?\n/)[0]) };
  const qa = () => spawnSync(process.execPath, [join(repo, "scripts", "qa", "run-all.mjs")], { cwd: repo, env, encoding: "utf8" }).stdout;
  return { repo, put, qa };
}

test("a problem the first-pulled theme already had passes, even after its line moves", () => {
  const { repo, put, qa } = repoWith({ "sections/old.liquid": BAD });
  try {
    put("sections/old.liquid", "<p>a new first line</p>\n" + BAD);
    const out = qa();
    assert.match(out, new RegExp(`ok   ${GUARD} \\(1 problem the theme already had`), out);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("a problem the build added fails, and only it is listed", () => {
  const { repo, put, qa } = repoWith({ "sections/old.liquid": BAD });
  try {
    put("sections/new.liquid", BAD);
    const out = qa();
    assert.match(out, new RegExp(`FAIL ${GUARD}`), out);
    assert.match(out, /sections\/new\.liquid:1:/);
    assert.doesNotMatch(out, /sections\/old\.liquid:1:/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("a second copy of an inherited problem in the same file still fails", () => {
  const { repo, put, qa } = repoWith({ "sections/old.liquid": BAD });
  try {
    put("sections/old.liquid", BAD + BAD);
    assert.match(qa(), new RegExp(`FAIL ${GUARD}`));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
