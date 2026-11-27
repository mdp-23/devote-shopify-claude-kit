// The gate's own tests. Run with: npm test
//
// Every rule in ship-gate.mjs is a pure function for this reason: the awkward
// combinations are answerable here rather than by publishing a real theme to find
// out. If you change a rule, change its case here in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPublish,
  pushesEditorFilesDirectly,
  pushesMerchantFiles,
  mergeVerdict,
  codeReviewRecorded,
  verifiedWidths,
  previewLinked,
  mergeTargets,
  makesApproval,
  writesApprovalFile,
  isGitPush,
  skipsQa,
  isLivePullOnly,
  themeFoldersDirty,
} from "../scripts/qa/ship-gate.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("rule 5: Claude never makes an approval, however it is spelled", () => {
  for (const cmd of [
    'npm run approve -- --by "Marcel"',
    "node scripts/approve.mjs --by Marcel",
    "echo '{}' > .release-approval.json",
    "cp /tmp/x .release-approval.json",
    'cd theme && npm run approve -- --by "A"',
  ]) assert.equal(makesApproval(cmd), true, cmd);
  assert.equal(writesApprovalFile("/Users/a/repo/.release-approval.json"), true);
  assert.equal(writesApprovalFile(".release-approval.json"), true);
});

test("rule 5: releasing, deploying and other files stay allowed", () => {
  for (const cmd of ["npm run release", "npm run deploy", "npm run deploy -- --skip-walks", "git commit -m 'Release'"]) {
    assert.equal(makesApproval(cmd), false, cmd);
  }
  for (const cmd of [
    "git add scripts/approve.mjs",
    'git -C "/Users/a/Client Themes/acme" add scripts/approve.mjs tests/approval.test.mjs',
    "git diff -- scripts/approve.mjs",
    "git show HEAD:scripts/approve.mjs",
    "git commit -m 'Devote Shopify kit 1.2.3' && git log --stat -1 -- scripts/approve.mjs",
  ]) assert.equal(makesApproval(cmd), false, cmd);
  for (const cmd of [
    "git add scripts/approve.mjs && npm run approve -- --by A",
    "git show HEAD:.release-approval.json > .release-approval.json",
    "git checkout -- .release-approval.json",
    "git diff --output=.release-approval.json HEAD~1 -- scripts/approve.mjs",
  ]) assert.equal(makesApproval(cmd), true, cmd);
  assert.equal(writesApprovalFile("/Users/a/repo/scripts/approval.mjs"), false);
  assert.equal(writesApprovalFile("/Users/a/repo/releases.log"), false);
  assert.equal(writesApprovalFile(""), false);
});

test("rule 4: a git push is checked, a git stash push is not", () => {
  for (const cmd of [
    "git push",
    "git push origin main",
    "cd theme && git push -u origin hotfix/x",
    'git -C "/Users/a/Client Themes/acme" push origin develop',
    "git -c core.sshCommand=ssh --no-pager push",
    "GIT_SSH_COMMAND='ssh -i key' git push origin main",
  ]) assert.equal(isGitPush(cmd), true, cmd);
  for (const cmd of ["git stash push -- snippets", "git stash push -m 'before Live Sync' -- sections", "git status", "shopify theme push --unpublished"]) {
    assert.equal(isGitPush(cmd), false, cmd);
  }
});

test("rule 4: a push named inside quotes or a heredoc is data, not a push", () => {
  for (const cmd of [
    'grep -rn "deny | git push" scripts',
    "grep -E 'a|git push' notes.md",
    'git commit -m "fix: gate; git push now waits for qa"',
    'echo "then run: SKIP_QA=1 git push"',
    "cat >> notes.md <<'EOF'\nthen: a && git push\nEOF",
  ]) assert.equal(isGitPush(cmd), false, cmd);
  for (const cmd of [
    "npm test && git push",
    "git status\ngit push origin main",
    'git commit -m "a | b" && git push',
    "echo $(git push)",
    'bash -c "git status; git push"',
    "cat <<'EOF' | bash\ngit push\nEOF",
  ]) assert.equal(isGitPush(cmd), true, cmd);
});

test("rule 4: SKIP_QA=1 in front of every push skips the checks, as the deny message says", () => {
  for (const cmd of [
    "SKIP_QA=1 git push origin HEAD",
    'cd "/Users/a/Client Themes/acme" && SKIP_QA=1 git push -u origin hotfix/x',
    "GIT_SSH_COMMAND='ssh -i key' SKIP_QA=1 git push",
  ]) assert.equal(skipsQa(cmd), true, cmd);
  for (const cmd of [
    "git push",
    "SKIP_QA=0 git push",
    "SKIP_QA=1 git fetch && git push",
    "SKIP_QA=1 git push origin a && git push origin b",
    "echo SKIP_QA=1 && git push",
    "XSKIP_QA=1 git push",
    "SKIP_QA=1 npm run qa",
  ]) assert.equal(skipsQa(cmd), false, cmd);
});

const GREEN = [{ name: "theme-check", conclusion: "SUCCESS" }];
const REVIEWED = "Code review: /code-review high, 2 findings, 2 fixed.";
const LOOKED_AT = "Preview: https://acme.myshopify.com/?preview_theme_id=123456789\nChecked at 375px and 1440px.";

test("rule 1: publishing a theme is blocked, however it is spelled", () => {
  for (const cmd of [
    "shopify theme publish",
    "shopify theme push --live",
    "shopify theme push --allow-live --store acme",
    "npx shopify theme delete -t 123",
    "cd theme && shopify theme publish --store acme",
  ]) {
    assert.equal(isPublish(cmd), true, cmd);
  }
});

test("rule 1: the short flags and --publish are live too", () => {
  // Until 1.10.0 all of these went straight through: -l is --live, -a is --allow-live, and
  // -p / --publish publishes the theme it just pushed.
  for (const cmd of [
    "shopify theme push -l",
    "shopify theme push --store acme -a",
    "shopify theme push --theme 123 --publish",
    "shopify theme push -t 123 -p",
    "shopify theme push -nl",
    "shopify theme dev --store acme -a",
    "npx shopify theme push --only snippets/x.liquid -l",
    "shopify theme push --store x --theme 1 \\\n  -a",
    "shopify theme push --store x \\\n  --theme 1 \\\n  --publish",
  ]) assert.equal(isPublish(cmd), true, cmd);
});

test("rule 1: an environment that turns on live in shopify.theme.toml is live", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-toml-"));
  writeFileSync(join(root, "shopify.theme.toml"), '[environments.production]\nstore = "acme"\nlive = true\n');
  assert.equal(isPublish("shopify theme push -e production", { root }), true);
  assert.equal(isPublish("shopify theme push --environment production", { root }), true);
  const quiet = mkdtempSync(join(tmpdir(), "gate-toml-"));
  writeFileSync(join(quiet, "shopify.theme.toml"), '[environments.staging]\nstore = "acme"\ntheme = "123"\n');
  assert.equal(isPublish("shopify theme push -e staging", { root: quiet }), false);
});

test("live pull: a pull from live, and nothing else live, may run", () => {
  for (const cmd of [
    "shopify theme pull --live",
    "shopify theme pull --store acme --live",
    "shopify theme pull -l --store acme",
    "shopify theme pull --live --path /tmp/live-copy",
    "git stash && shopify theme pull --live --store acme && git stash pop",
  ]) {
    assert.equal(isPublish(cmd), true, cmd); // still goes through the clean-tree check
    assert.equal(isLivePullOnly(cmd), true, cmd);
  }
});

test("live pull: anything that writes to live in the same command is not a pull", () => {
  for (const cmd of [
    "shopify theme pull --live && shopify theme push --live",
    "shopify theme pull --live; shopify theme publish -t 1",
    "shopify theme pull --live --allow-live",
    "shopify theme pull --live && shopify theme push -a",
    "shopify theme pull --live $(shopify theme delete -t 1)",
    "shopify theme push --live",
    "echo --live",
  ]) assert.equal(isLivePullOnly(cmd), false, cmd);
});

test("an escaped backslash at a line end is not a continuation", () => {
  assert.equal(isLivePullOnly("echo foo \\\\\nshopify theme pull --live"), true);
  assert.equal(isPublish("echo done \\\\\nshopify theme push --unpublished"), false);
});

test("live pull: uncommitted theme work blocks it, a clean tree does not", () => {
  assert.deepEqual(themeFoldersDirty({ status: () => "" }).files, []);
  assert.deepEqual(themeFoldersDirty({ status: () => " M sections/header.liquid\n?? snippets/new.liquid\n" }).files, ["sections/header.liquid", "snippets/new.liquid"]);
  assert.ok(themeFoldersDirty({ status: () => { throw new Error("not a git repository"); } }).error);
});

test("rule 1: the safe theme commands stay allowed", () => {
  for (const cmd of [
    "shopify theme push --unpublished",
    "shopify theme share",
    "shopify theme pull --store acme",
    "shopify theme check",
    "shopify theme list --store acme",
    "shopify theme dev --store acme",
  ]) {
    assert.equal(isPublish(cmd), false, cmd);
  }
});

test("rule 1: quoting the command in a heredoc is not invoking it", () => {
  const cmd = [
    "gh pr create -F - <<'EOF'",
    "Nobody may run shopify theme publish against a client store.",
    "EOF",
  ].join("\n");
  assert.equal(isPublish(cmd), false);
});

test("rule 1: a heredoc fed to a shell really does execute, so it stays checked", () => {
  const cmd = ["bash <<'EOF'", "shopify theme publish", "EOF"].join("\n");
  assert.equal(isPublish(cmd), true);
});

test("rule 2: a bare theme push would carry the merchant's files", () => {
  assert.equal(pushesMerchantFiles("shopify theme push --unpublished", { root: "/nonexistent" }), true);
});

test("rule 2: scoped, ignored or .shopifyignore'd pushes are fine", () => {
  assert.equal(
    pushesMerchantFiles("shopify theme push --only sections/hero.liquid", { root: "/nonexistent" }),
    false,
  );
  assert.equal(
    pushesMerchantFiles("shopify theme push --ignore config/settings_data.json", { root: "/nonexistent" }),
    false,
  );
});

test("rule 2: a command that is not a theme push is not this rule's business", () => {
  assert.equal(pushesMerchantFiles("git push origin HEAD", { root: "/nonexistent" }), false);
});

test("rule 3: no changed files is not a pass", () => {
  assert.equal(mergeVerdict({ files: [], body: REVIEWED, checks: GREEN }).allow, false);
});

test("rule 3: a visible change needs a preview link", () => {
  const v = mergeVerdict({
    files: ["sections/hero.liquid"],
    body: `Checked at 375px and 1440px.\n${REVIEWED}`,
    checks: GREEN,
  });
  assert.equal(v.allow, false);
  assert.match(v.reason, /links no preview/);
});

test("rule 3: a visible change needs a narrow width and a wide one", () => {
  const onlyWide = mergeVerdict({
    files: ["sections/hero.liquid"],
    body: `Preview: https://acme.myshopify.com/?preview_theme_id=1\nChecked at 1440px.\n${REVIEWED}`,
    checks: GREEN,
  });
  assert.equal(onlyWide.allow, false);
  assert.match(onlyWide.reason, /only 1440px/);
});

test("rule 3: a change nothing renders skips the looking rules", () => {
  assert.equal(
    mergeVerdict({ files: ["scripts/qa/a-new-guard.mjs"], body: REVIEWED, checks: GREEN }).allow,
    true,
  );
});

test("rule 3: a check still running is not green", () => {
  const v = mergeVerdict({
    files: ["scripts/qa/a-new-guard.mjs"],
    body: REVIEWED,
    checks: [{ name: "lighthouse", status: "IN_PROGRESS" }],
  });
  assert.equal(v.allow, false);
  assert.match(v.reason, /not all green/);
});

test("rule 3: no code review line, no merge", () => {
  const v = mergeVerdict({
    files: ["scripts/qa/a-new-guard.mjs"],
    body: "Fixes the thing.",
    checks: GREEN,
  });
  assert.equal(v.allow, false);
  assert.match(v.reason, /code review/i);
});

test("rule 3: a fully evidenced PR merges", () => {
  assert.equal(
    mergeVerdict({
      files: ["sections/hero.liquid", "assets/hero.css"],
      body: `${LOOKED_AT}\n\n${REVIEWED}`,
      checks: GREEN,
    }).allow,
    true,
  );
});

test("the code review line is a record, not a passing mention", () => {
  assert.equal(codeReviewRecorded("Code review: /code-review high, 0 findings."), true);
  assert.equal(codeReviewRecorded("- **Code review:** `/code-review max`, 1 fixed"), true);
  assert.equal(codeReviewRecorded("I should probably run /code-review on this"), false);
  assert.equal(codeReviewRecorded("Code review: /code-review low"), false);
});

test("a CSS pixel value is not a viewport", () => {
  assert.deepEqual([...verifiedWidths("padding: 24px; checked at 375px")], [375]);
});

test("a preview link is recognised in its usual shapes", () => {
  assert.equal(previewLinked("https://acme.myshopify.com/?preview_theme_id=12345"), true);
  assert.equal(previewLinked("https://acme.shopifypreview.com/"), true);
  assert.equal(previewLinked("I looked at it locally"), false);
});

test("the PR number is read from the command", () => {
  assert.deepEqual(mergeTargets("gh pr merge 41 --squash"), ["41"]);
  assert.deepEqual(mergeTargets("gh pr merge --squash 41"), ["41"]);
});

test("a repo with no qa script has no checks, and that is not a pass", async () => {
  const { hasQaScript } = await import("../scripts/qa/ship-gate.mjs");
  assert.equal(hasQaScript({ root: "/nonexistent" }), false);
});

test("rule 2a: editor JSON never goes out through a direct push", () => {
  assert.equal(pushesEditorFilesDirectly("shopify theme push --theme 1 --only templates/index.json"), true);
  assert.equal(pushesEditorFilesDirectly("shopify theme push --theme 1 --only 'sections/*.json'"), true);
  assert.equal(pushesEditorFilesDirectly("cd /tmp/x && shopify theme push --theme 1 --nodelete --path ."), true);
  assert.equal(pushesEditorFilesDirectly("shopify theme push --theme 1 --only assets/acme.css"), false);
  assert.equal(pushesEditorFilesDirectly("npm run deploy -- --with-json"), false);
});
