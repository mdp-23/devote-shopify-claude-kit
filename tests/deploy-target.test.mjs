// The deploy script must name the store, the preview theme and the real domain.
// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingDeployTarget } from "../scripts/qa/deploy-target.mjs";

const pkg = (deploy) => JSON.stringify({ scripts: { deploy } });

test("a complete deploy script passes", () => {
  assert.deepEqual(missingDeployTarget(pkg("node scripts/deploy.mjs --store something.myshopify.com --theme 123 --domain www.something.com.au")), []);
});

test("each missing piece is named", () => {
  assert.equal(missingDeployTarget(pkg("node scripts/deploy.mjs")).length, 3);
  const noDomain = missingDeployTarget(pkg("node scripts/deploy.mjs --store something.myshopify.com --theme 123"));
  assert.equal(noDomain.length, 1);
  assert.match(noDomain[0], /--domain/);
});

test("the template's FILL-IN values do not count as filled in", () => {
  const t = pkg("node scripts/deploy.mjs --store FILL-IN.myshopify.com --theme FILL-IN-PREVIEW-THEME-ID --domain FILL-IN-www.store-domain.com.au");
  assert.equal(missingDeployTarget(t).length, 3);
});

test("the myshopify address is not the real domain", () => {
  assert.match(missingDeployTarget(pkg("node scripts/deploy.mjs --store something.myshopify.com --theme 1 --domain something.myshopify.com"))[0], /--domain/);
});

test("no package.json, or no deploy script, is all three missing", () => {
  assert.equal(missingDeployTarget(null).length, 3);
  assert.equal(missingDeployTarget("{}").length, 3);
});
