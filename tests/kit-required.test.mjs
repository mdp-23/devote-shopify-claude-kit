// The plugin hook that keeps Shopify work inside a repo with the Devote kit. Run with: node --test tests/
//
// The first cases are the gap it closes: a theme folder with no kit, where Claude edited and pushed
// with none of the checks (6 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inKit = existsSync(join(KIT, "hooks", "kit-required.mjs")); // brand repos get tests/, not hooks/

// A pretend disk: a bare theme, a theme with the kit, an app, and a folder that is neither.
const DISK = new Set([
  "/w/bare/layout", "/w/bare/sections",
  "/w/brand/layout", "/w/brand/templates", "/w/brand/.devote-kit-version",
  "/w/app/shopify.app.toml",
  "/w/notes",
]);
const exists = (p) => DISK.has(p);

test("editing a theme file in a folder without the kit is blocked, and says to run setup", { skip: !inKit }, async () => {
  const { editVerdict } = await import("../hooks/kit-required.mjs");
  assert.match(editVerdict("/w/bare/sections/main-product.liquid", { exists }), /\/devote-shopify:setup skill in \/w\/bare/);
  assert.match(editVerdict("/w/bare/snippets/deep/x.liquid", { exists }), /BLOCKED/);
  assert.match(editVerdict("/w/app/extensions/block/x.liquid", { exists }), /BLOCKED/);
});

test("the same edit in a kit repo, a non-theme file, or a folder that is not Shopify goes through", { skip: !inKit }, async () => {
  const { editVerdict } = await import("../hooks/kit-required.mjs");
  assert.equal(editVerdict("/w/brand/sections/main-product.liquid", { exists }), null);
  assert.equal(editVerdict("/w/bare/CLAUDE.md", { exists }), null, "setup writes CLAUDE.md and package.json");
  assert.equal(editVerdict("/w/bare/package.json", { exists }), null);
  assert.equal(editVerdict("/w/notes/todo.md", { exists }), null);
});

test("a theme push, share or publish from a folder without the kit is blocked", { skip: !inKit }, async () => {
  const { bashVerdict } = await import("../hooks/kit-required.mjs");
  for (const cmd of ["shopify theme push --unpublished", "shopify theme share", "npx shopify theme publish --theme 1", "shopify app deploy"])
    assert.match(bashVerdict(cmd, "/w/bare", { exists }) || "", /BLOCKED/, cmd);
  assert.match(bashVerdict("cd /w/bare && shopify theme push", "/w/notes", { exists }) || "", /no Devote kit/);
  assert.match(bashVerdict("shopify theme push --path /w/bare --unpublished", "/w/brand", { exists }) || "", /no Devote kit/);
  assert.match(bashVerdict("shopify theme push --path /tmp/x", "/w/brand", { exists }) || "", /not a Shopify theme or app folder/);
});

test("pushes from a kit repo, pulls and theme dev anywhere are left to the brand's own gate", { skip: !inKit }, async () => {
  const { bashVerdict } = await import("../hooks/kit-required.mjs");
  assert.equal(bashVerdict("shopify theme push --unpublished", "/w/brand", { exists }), null);
  assert.equal(bashVerdict("shopify theme pull --store x.myshopify.com", "/w/notes", { exists }), null);
  assert.equal(bashVerdict("shopify theme dev --store x.myshopify.com", "/w/bare", { exists }), null);
  assert.equal(bashVerdict("npm run deploy", "/w/brand", { exists }), null);
});

test("changing theme files through the Admin API is blocked from anywhere", { skip: !inKit }, async () => {
  const { bashVerdict } = await import("../hooks/kit-required.mjs");
  const upsert = "shopify store execute --store x.myshopify.com --query 'mutation { themeFilesUpsert(themeId: \"gid://shopify/OnlineStoreTheme/1\", files: []) { job { id } } }'";
  assert.match(bashVerdict(upsert, "/w/brand", { exists }) || "", /Admin API/);
  assert.match(bashVerdict("curl -X PUT https://x.myshopify.com/admin/api/2025-01/themes/1/assets.json -d @a.json", "/w/brand", { exists }) || "", /Admin API/);
  assert.equal(bashVerdict("git commit -m 'Block themeFilesUpsert outside the kit'", "/w/brand", { exists }), null, "naming a mutation is not calling it");
  assert.equal(bashVerdict("curl https://x.myshopify.com/admin/api/2025-01/themes/1/assets.json", "/w/brand", { exists }), null, "reading is fine");
});

test("session start asks for the carry-over check once per brand, after everything else is in place", { skip: !inKit }, async () => {
  const { advice } = await import("../hooks/session-start.mjs");
  assert.match(advice({ isShopify: true, installed: "a", current: "a", noCarryover: true }), /npm run carryover/);
  assert.equal(advice({ isShopify: true, installed: "a", current: "a", noCarryover: false }), null);
  assert.match(advice({ isShopify: true, installed: "old", current: "a", noCarryover: true }), /out of date/, "update the kit first");
});
