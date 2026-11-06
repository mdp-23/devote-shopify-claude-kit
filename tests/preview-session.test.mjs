// Before launch the walks must test the myshopify.com preview, never the old site on the real domain.
// Run with: node --test tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cookiesFrom, mergeCookies, servesShopify, unlock, walkTarget } from "../scripts/qa/preview-session.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// A fake fetch: each call answers with the next response, and the calls are recorded.
function stub(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status = 200, headers = {}, setCookie = [] } = next;
    const h = new Headers(headers);
    h.getSetCookie = () => setCookie;
    return { status, headers: h, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return calls;
}

test("servesShopify: each of Shopify's headers counts", async () => {
  for (const headers of [{ "x-shopid": "1" }, { "powered-by": "Shopify" }, { "x-shopify-stage": "production" }]) {
    stub([{ headers }]);
    assert.equal(await servesShopify("www.example.com.au"), true);
  }
});

test("servesShopify: an old site with no Shopify headers is false", async () => {
  stub([{ headers: { server: "Apache", "x-powered-by": "PHP/8.2" } }]);
  assert.equal(await servesShopify("www.example.com.au"), false);
});

test("servesShopify: follows redirects itself, at most 3 hops", async () => {
  const calls = stub([
    { status: 301, headers: { location: "https://example.com.au/" } },
    { status: 302, headers: { location: "/home" } },
    { headers: { "x-shopid": "9" } },
  ]);
  assert.equal(await servesShopify("example.com.au"), true);
  assert.equal(calls[0].opts.redirect, "manual");
  assert.equal(calls[2].url, "https://example.com.au/home");

  stub([1, 2, 3, 4].map(() => ({ status: 301, headers: { location: "https://loop.example/" } })).concat([{ headers: { "x-shopid": "1" } }]));
  assert.equal(await servesShopify("loop.example"), false);
});

test("servesShopify: a network error is unknown (null), never false", async () => {
  stub([new Error("getaddrinfo ENOTFOUND")]);
  assert.equal(await servesShopify("www.example.com.au"), null);
});

test("unlock: posts the storefront form and returns the cookies", async () => {
  const calls = stub([{ status: 302, setCookie: ["_shopify_y=abc; path=/; secure", "storefront_digest=d1g; path=/; HttpOnly"] }]);
  assert.equal(await unlock("https://some-store.example", "pa ss&1"), "_shopify_y=abc; storefront_digest=d1g");
  assert.equal(calls[0].url, "https://some-store.example/password");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.redirect, "manual");
  assert.equal(calls[0].opts.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0].opts.body, "form_type=storefront_password&utf8=%E2%9C%93&password=pa%20ss%261");
});

test("unlock: no storefront_digest means the password was rejected", async () => {
  stub([{ status: 302, setCookie: ["_shopify_y=abc; path=/"] }]);
  await assert.rejects(unlock("https://some-store.example", "wrong"), /storefront password rejected/);
});

test("cookie helpers", () => {
  assert.equal(cookiesFrom(["a=1; Path=/", "b=2"]), "a=1; b=2");
  assert.equal(mergeCookies("a=1; b=2", "b=3; c=4"), "a=1; b=3; c=4");
  assert.equal(mergeCookies("", undefined), "");
});

const base = { domain: "www.example.com.au", store: "some-store.myshopify.example", theme: "123" };

test("walkTarget: a domain on Shopify keeps the preview on the real domain", () => {
  assert.deepEqual(walkTarget({ ...base, servesShopify: true }), {
    previewUrl: "https://www.example.com.au/?preview_theme_id=123", liveUrl: "https://www.example.com.au/", prelaunch: false, needsPassword: false,
  });
});

test("walkTarget: could not check carries on as before", () => {
  const t = walkTarget({ ...base, servesShopify: null });
  assert.equal(t.prelaunch, false);
  assert.equal(t.previewUrl, "https://www.example.com.au/?preview_theme_id=123");
});

test("walkTarget: not launched, with a password, walks the myshopify preview and keeps the old site to compare", () => {
  assert.deepEqual(walkTarget({ ...base, servesShopify: false, password: "x" }), {
    previewUrl: "https://some-store.myshopify.example/?preview_theme_id=123", liveUrl: "https://www.example.com.au/", prelaunch: true, needsPassword: false,
  });
});

test("walkTarget: not launched, no password, walks nothing", () => {
  const t = walkTarget({ ...base, servesShopify: false, password: "" });
  assert.equal(t.needsPassword, true);
  assert.equal(t.previewUrl, null);
});
