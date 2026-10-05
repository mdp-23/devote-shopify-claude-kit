// The visual walk's rules, without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bands, slug } from "../scripts/qa/visual-walk.mjs";

test("changed rows close together make one area; a long clean run starts another", () => {
  const rows = new Array(300).fill(0);
  for (let y = 10; y < 20; y++) rows[y] = 10;
  for (let y = 40; y < 45; y++) rows[y] = 10;
  for (let y = 200; y < 210; y++) rows[y] = 10;
  assert.deepEqual(bands(rows).map((b) => [b.top, b.bottom]), [[10, 44], [200, 209]]);
});

test("a few stray pixels are not a change", () => {
  const rows = new Array(100).fill(0); rows[50] = 3;
  assert.deepEqual(bands(rows), []);
});

test("a 12px chevron shift is a change", () => {
  const rows = new Array(100).fill(0);
  for (let y = 40; y < 52; y++) rows[y] = 8; // two chevrons, 12 rows
  assert.equal(bands(rows).length, 1);
});

test("page names are stable file names", () => {
  assert.equal(slug("/", 390), "home@390");
  assert.equal(slug("/search?q=fins", 1440), "search-q-fins@1440");
});
