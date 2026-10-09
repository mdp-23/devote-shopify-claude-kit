// The development-store exception to "never push to the live theme".
// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStore, isDevType, normaliseStore, storesInCommand } from "../scripts/dev-store.mjs";
import { publishVerdict } from "../scripts/qa/ship-gate.mjs";

// Stand-in for Shopify: stores starting "dev-" are development stores.
const fake = (store) => (store.startsWith("dev-") ? { dev: true, type: "dev", error: null } : { dev: false, type: null, error: null });

test("only Shopify's development types count", () => {
  assert.equal(isDevType("dev"), true);
  assert.equal(isDevType("client-transfer"), true);
  for (const t of ["production", "collaborator", "", null, undefined]) assert.equal(isDevType(t), false, String(t));
});

test("stores are read however the command spells them", () => {
  assert.deepEqual(storesInCommand("shopify theme push --live --store acme"), ["acme.myshopify.com"]);
  assert.deepEqual(storesInCommand("shopify theme publish --store=https://acme.myshopify.com/ -t 1"), ["acme.myshopify.com"]);
  assert.deepEqual(storesInCommand("shopify theme publish -s acme -t 1"), ["acme.myshopify.com"]);
  assert.deepEqual(storesInCommand("SHOPIFY_FLAG_STORE=acme shopify theme push --live"), ["acme.myshopify.com"]);
  assert.equal(normaliseStore("ACME"), "acme.myshopify.com");
});

test("a live push or publish on a development store is allowed", () => {
  for (const cmd of ["shopify theme push --live --store dev-acme", "shopify theme publish -t 1 --store dev-acme"]) {
    assert.equal(publishVerdict(cmd, { check: fake }).allow, true, cmd);
  }
});

test("a real store stays blocked", () => {
  const v = publishVerdict("shopify theme push --live --store acme", { check: fake });
  assert.equal(v.allow, false);
  assert.match(v.reason, /not a development store/);
});

test("every publishing step must name its store, or it is blocked", () => {
  assert.equal(publishVerdict("shopify theme push --live", { check: fake }).allow, false);
  assert.equal(publishVerdict("shopify theme push --live --store dev-acme && shopify theme publish -t 1", { check: fake }).allow, false);
  assert.equal(publishVerdict("shopify theme push --live --store dev-acme; shopify theme publish --store acme -t 1", { check: fake }).allow, false);
});

test("deleting a theme is never allowed, even on a development store", () => {
  assert.equal(publishVerdict("shopify theme delete -t 1 --store dev-acme", { check: fake }).allow, false);
});

test("could not check is a refusal that says so, not a pass", () => {
  const v = publishVerdict("shopify theme push --live --store dev-acme", { check: () => ({ dev: false, type: null, error: "offline" }) });
  assert.equal(v.allow, false);
  assert.match(v.reason, /could not confirm/);
});

test("checkStore reads Shopify's answer and reports failures as failures", () => {
  const json = (o) => () => JSON.stringify(o);
  assert.deepEqual(checkStore("acme.myshopify.com", { exec: json({ subdomain: "acme.myshopify.com", type: "dev" }) }), { dev: true, type: "dev", error: null });
  assert.deepEqual(checkStore("acme.myshopify.com", { exec: json({ subdomain: "acme.myshopify.com" }) }), { dev: false, type: null, error: null });
  assert.ok(checkStore("acme.myshopify.com", { exec: () => { throw new Error("not logged in"); } }).error);
  assert.ok(checkStore("acme.myshopify.com", { exec: () => "garbage" }).error);
  assert.ok(checkStore("", {}).error);
});
