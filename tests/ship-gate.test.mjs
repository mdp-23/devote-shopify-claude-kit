// The gate's own tests. Run with: node --test tests/
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
} from "../scripts/qa/ship-gate.mjs";

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
