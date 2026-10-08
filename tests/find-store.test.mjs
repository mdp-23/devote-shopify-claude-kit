import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseDomain, brandFromDomain, storeFromMeta, storeFromHtml } from "../find-store.mjs";

test("a pasted website becomes a bare domain", () => {
  assert.equal(normaliseDomain("https://www.acme.com.au/collections/all?x=1"), "www.acme.com.au");
  assert.equal(normaliseDomain("  WWW.Acme.com.au "), "www.acme.com.au");
  assert.equal(normaliseDomain(""), "");
});

test("the brand folder comes from the domain's first label", () => {
  assert.equal(brandFromDomain("www.acme.com.au"), "acme");
  assert.equal(brandFromDomain("acme-store.myshopify.com"), "acme-store");
});

test("meta.json gives the store address, and anything else gives none", () => {
  assert.equal(storeFromMeta('{"myshopify_domain":"acme-store.myshopify.com"}'), "acme-store.myshopify.com");
  assert.equal(storeFromMeta("<html>not json</html>"), "");
  assert.equal(storeFromMeta('{"myshopify_domain":null}'), "");
});

test("the page's own Shopify.shop wins over other addresses in it", () => {
  const html = '<script src="https://example.myshopify.com/a.js"></script><script src="https://example.myshopify.com/b.js"></script><script>Shopify.shop = "acme-store.myshopify.com";</script>';
  assert.equal(storeFromHtml(html), "acme-store.myshopify.com");
});

test("with no Shopify.shop, the address named most often is the store", () => {
  const html = "acme-store.myshopify.com acme-store.myshopify.com example.myshopify.com";
  assert.equal(storeFromHtml(html), "acme-store.myshopify.com");
  assert.equal(storeFromHtml("<html>a site not on Shopify</html>"), "");
});
