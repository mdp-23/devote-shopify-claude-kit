// The accessibility walk's rules, without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, judge, merge } from "../scripts/qa/a11y-walk.mjs";

const v = (id, impact, n) => ({ id, impact, help: id, nodes: Array.from({ length: n }, (_, i) => ({ target: [`#el${i}`] })) });

test("critical and serious problems fail; moderate and minor only warn", () => {
  const issues = judge(summarise([v("button-name", "critical", 2), v("color-contrast", "serious", 1), v("region", "moderate", 5)]));
  assert.deepEqual(issues.filter((i) => i.level === "FAIL").map((i) => i.rule).sort(), ["button-name", "color-contrast"]);
  assert.deepEqual(issues.filter((i) => i.level === "WARN").map((i) => i.rule), ["region"]);
});

test("a baseline lets an older theme's backlog through, but never an increase", () => {
  const s = summarise([v("image-alt", "critical", 4)]);
  assert.equal(judge(s, { "image-alt": 4 })[0].level, "WARN");
  assert.equal(judge(s, { "image-alt": 3 })[0].level, "FAIL");
  assert.equal(judge(summarise([v("label", "critical", 1)]), { "image-alt": 4 })[0].level, "FAIL"); // a new rule is never baselined
});

test("phone and desktop: the worse count of each rule counts", () => {
  const m = merge(summarise([v("link-name", "serious", 1)]), summarise([v("link-name", "serious", 3), v("list", "moderate", 1)]));
  assert.equal(m["link-name"].nodes, 3);
  assert.equal(m.list.nodes, 1);
});

test("a clean page has no issues", () => {
  assert.deepEqual(judge(summarise([])), []);
});
