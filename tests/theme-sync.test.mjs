// Two people, one theme: what deploy pushes, takes in, or stops on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/theme-sync.mjs";

test("only you changed it: push", () => {
  assert.deepEqual(classify({ a: "1" }, { a: "1" }, { a: "2" }), { take: [], clash: [], unknown: [] });
});
test("only they changed it: take theirs, never push your old copy over it", () => {
  assert.deepEqual(classify({ a: "1" }, { a: "2" }, { a: "1" }).take, ["a"]);
});
test("they added a file you do not have: take it", () => {
  assert.deepEqual(classify({}, { a: "2" }, {}).take, ["a"]);
});
test("you both changed it: a clash to merge", () => {
  assert.deepEqual(classify({ a: "1" }, { a: "2" }, { a: "3" }).clash, ["a"]);
});
test("you both made the same change: nothing to do", () => {
  assert.deepEqual(classify({ a: "1" }, { a: "2" }, { a: "2" }), { take: [], clash: [], unknown: [] });
});
test("no record of the last sync: a difference cannot be judged", () => {
  assert.deepEqual(classify(null, { a: "2" }, { a: "3" }).unknown, ["a"]);
  assert.deepEqual(classify(null, { a: "2" }, { a: "2" }).unknown, []);
});
