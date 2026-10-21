import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalVerdict, deployTarget, reviewLink, unknownLiveChanges } from "../scripts/approval.mjs";

const OK = { by: "Sam", store: "acme.myshopify.com", codeHash: "abc" };
const NOW = { codeHash: "abc", store: "acme.myshopify.com" };

test("an approval covers exactly the code a person checked", () => {
  assert.deepEqual(approvalVerdict(OK, NOW), { ok: true });
});

test("no approval, no release", () => {
  assert.match(approvalVerdict(null, NOW).why, /nobody has approved/);
  assert.match(approvalVerdict({ ...OK, by: "" }, NOW).why, /who approved/);
});

test("code changed after the approval is not approved", () => {
  assert.match(approvalVerdict(OK, { ...NOW, codeHash: "def" }).why, /changed after Sam approved/);
});

test("an approval for another store does not carry over", () => {
  assert.match(approvalVerdict(OK, { ...NOW, store: "example.myshopify.com" }).why, /is for acme/);
});

test("a live file the repo has never seen stops the release", () => {
  const known = new Set(["sections/a.liquid"]);
  assert.deepEqual(unknownLiveChanges(["sections/a.liquid", "snippets/b.liquid"], (f) => known.has(f)), ["snippets/b.liquid"]);
  assert.deepEqual(unknownLiveChanges([], () => false), []);
});

test("the review link uses the real domain, and works on any page", () => {
  const t = { store: "acme.myshopify.com", theme: "123", domain: "www.acme.com.au" };
  assert.equal(reviewLink(t), "https://www.acme.com.au/?preview_theme_id=123");
  assert.equal(reviewLink(t, "/products/socks"), "https://www.acme.com.au/products/socks?preview_theme_id=123");
  assert.equal(reviewLink(t, "/search?q=a"), "https://www.acme.com.au/search?q=a&preview_theme_id=123");
  assert.equal(reviewLink({ ...t, domain: null }), "https://acme.myshopify.com/?preview_theme_id=123");
});

test("the deploy target is read from package.json, and a FILL-IN is not a value", () => {
  const dir = mkdtempSync(join(tmpdir(), "target-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { deploy: "node scripts/deploy.mjs --store acme.myshopify.com --theme 123 --domain https://www.acme.com.au/" } }));
  assert.deepEqual(deployTarget({ root: dir }), { store: "acme.myshopify.com", theme: "123", domain: "www.acme.com.au" });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { deploy: "node scripts/deploy.mjs --store FILL-IN.myshopify.com --theme FILL-IN-PREVIEW-THEME-ID --domain FILL-IN-www.x" } }));
  assert.deepEqual(deployTarget({ root: dir }), { store: null, theme: null, domain: null });
});
