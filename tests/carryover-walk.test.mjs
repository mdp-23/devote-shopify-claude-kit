// The carry-over walk's rules, without a store. Run with: node --test tests/
//
// The first cases are what two rebuilds lost without anyone noticing (a delivery note shown only on
// some products, an email-platform embed). If you change a rule in scripts/qa/carryover-walk.mjs,
// change its case here in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  themeSignals, stillPresent, phrases, pageContent, conditionalTextIssues, sampleProducts,
  productCount, templateCount, verdicts, describe, norm, genericNote,
} from "../scripts/qa/carryover-walk.mjs";

const OLD = {
  "snippets/product-info.liquid": [
    "{% if product.tags contains 'local-only' %}<p>Pick up or local delivery only</p>{% endif %}",
    "{% if product.type == 'Mattress' %}<span class=\"badge\">Free shipping</span>{% endif %}",
    "{{ product.metafields.custom.delivery_date }}",
    "<input type=\"text\" name=\"properties[Engraving]\">",
    "{% if cart.total_price >= 9900 %}You get free shipping{% endif %}",
  ].join("\n"),
  "layout/theme.liquid": "<script src=\"https://static.hotjar.com/c/hotjar-1.js\"></script><script async src=\"https://www.googletagmanager.com/gtm.js?id=GTM-ABC123\"></script>",
  "templates/product.bulky.json": "{}",
  "config/settings_data.json": JSON.stringify({ current: { blocks: {
    a: { type: "shopify://apps/klaviyo-email-marketing-sms/blocks/klaviyo-onsite-embed/0d1e", disabled: false },
    b: { type: "shopify://apps/old-popup/blocks/embed/9f9f", disabled: true },
  } } }),
};

test("finds what an old theme does for particular products", () => {
  const ids = Object.keys(themeSignals(OLD));
  for (const id of ["tag:local-only", "type:Mattress", "metafield:custom.delivery_date", "property:Engraving",
    "cart-threshold:9900", "script:static.hotjar.com", "pixel:Google Tag Manager", "template:product.bulky",
    "app-block:klaviyo-email-marketing-sms/klaviyo-onsite-embed"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("app-block:old-popup/embed"), "an app embed switched off is not something the theme does");
});

test("each finding says where it is", () => {
  const where = themeSignals(OLD)["tag:local-only"];
  assert.match(where[0], /^snippets\/product-info\.liquid:1 /);
});

test("a new build that dropped them is missing every one", () => {
  const found = themeSignals(OLD);
  const blank = { "sections/main-product.liquid": "{{ product.title }}" };
  for (const id of Object.keys(found)) assert.equal(stillPresent(id, blank), false, id);
});

test("a new build that carries them over keeps them, however it is written", () => {
  const next = {
    "blocks/badges.liquid": "{% if product.tags contains \"local-only\" %}{{ 'products.local' | t }}{% endif %}{%- if product.type == \"Mattress\" -%}x{%- endif -%}",
    "blocks/delivery.liquid": "{{ product.metafields['custom']['delivery_date'].value }}",
    "snippets/engrave.liquid": "<input name=\"properties[Engraving]\">",
    "config/settings_data.json": JSON.stringify({ current: { free_shipping_threshold: 99, blocks: {
      k: { type: "shopify://apps/klaviyo-email-marketing-sms/blocks/klaviyo-onsite-embed/77aa" } } } }),
    "templates/product.bulky.json": "{}",
  };
  for (const id of ["tag:local-only", "type:Mattress", "metafield:custom.delivery_date", "property:Engraving",
    "cart-threshold:9900", "template:product.bulky", "app-block:klaviyo-email-marketing-sms/klaviyo-onsite-embed"])
    assert.equal(stillPresent(id, next), true, id);
});

test("a tracking script the new theme loads through an app embed or Customer events still counts", () => {
  assert.equal(stillPresent("pixel:Google Tag Manager", {}, { html: "<script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-ABC123\">" }), true);
  assert.equal(stillPresent("script:static.hotjar.com", {}, { html: "" }), false);
});

test("an app embed copied but switched off on the new theme is still missing", () => {
  const off = { "config/settings_data.json": JSON.stringify({ current: { blocks: {
    k: { type: "shopify://apps/klaviyo-email-marketing-sms/blocks/klaviyo-onsite-embed/77aa", disabled: true } } } }) };
  assert.equal(stillPresent("app-block:klaviyo-email-marketing-sms/klaviyo-onsite-embed", off), false);
});

test("an app's own metafield namespace is one finding, the store's custom fields stay one each", () => {
  const ids = Object.keys(themeSignals({ "snippets/r.liquid": "{{ product.metafields.judgeme.badge }}{{ shop.metafields.judgeme.settings }}{{ shop.metafields.judgeme.medals }}{{ product.metafields.custom.a }}{{ product.metafields.custom.b }}{{ product.metafields.custom.c }}" }));
  assert.ok(ids.includes("metafield:judgeme.*"));
  assert.ok(!ids.includes("metafield:judgeme.badge"));
  assert.ok(ids.includes("metafield:custom.a") && ids.includes("metafield:custom.c"));
  assert.equal(stillPresent("metafield:judgeme.*", { "blocks/x.liquid": "{{ product.metafields.judgeme.badge }}" }), true);
});

test("page text leaves out the header, menus and footer", () => {
  const html = '<body><header>Menu Saddlery</header><div id="shopify-section-template--1__main" class="shopify-section"><div><p>Pick up or <strong>local</strong> delivery only</p></div></div><footer>Join us</footer></body>';
  assert.doesNotMatch(pageContent(html), /Saddlery|Join us/);
  assert.ok(phrases(html).has("pick up or local delivery only"));
  const old = "<body><header>Menu</header><p>Ships in 3 days</p><footer>Bye</footer></body>";
  assert.deepEqual([...phrases(old)], ["ships in # days"]);
});

const page = (handle, before, after) => ({ handle, before: new Set(before.map(norm)), after: new Set(after.map(norm)) });

test("a note the old theme showed on some products, missing on the preview, is a finding", () => {
  const pages = [
    page("barrow", ["Pick up or local delivery only", "Add to cart"], ["Add to cart"]),
    page("spirits", ["Pick up or local delivery only", "Add to cart"], ["Add to cart"]),
    page("rope", ["Add to cart"], ["Add to cart"]),
  ];
  const { issues } = conditionalTextIssues(pages);
  assert.deepEqual(Object.keys(issues), ["text:pick up or local delivery only"]);
  assert.deepEqual(issues["text:pick up or local delivery only"].lost, ["barrow", "spirits"]);
});

test("the same note on the preview, inside other markup, passes", () => {
  const pages = [
    page("barrow", ["Pick up or local delivery only"], ["Delivery: pick up or local delivery only."]),
    page("spirits", ["Pick up or local delivery only"], ["pick up or local delivery only"]),
    page("rope", ["Rope"], ["Rope"]),
  ];
  assert.deepEqual(conditionalTextIssues(pages).issues, {});
});

test("one product's own description, its title and lone labels are not findings", () => {
  const pages = [
    page("a", ["This barrow has a steel tray and pneumatic tyre", "Low density poly pipe 25mm", "Home / Low density poly pipe 25mm", "Gifts"], []),
    page("b", ["Low density poly pipe 13mm", "Home / Low density poly pipe 13mm", "Gifts"], []),
    page("c", [], []),
  ];
  const titles = ["Low density poly pipe 25mm", "Low density poly pipe 13mm"].map(norm);
  assert.deepEqual(conditionalTextIssues(pages, new Set(titles), titles).issues, {});
});

test("lines that show and hide together are one finding", () => {
  const block = ["Shipping within Australia is $10", "Express post is $15", "International orders take 10 days"];
  const pages = [page("a", block, []), page("b", block, []), page("c", ["Other text here"], [])];
  const { issues } = conditionalTextIssues(pages);
  assert.equal(Object.keys(issues).length, 1);
  assert.equal(Object.values(issues)[0].lines, 3);
});

test("a sentence on every product page before and none after is a warning, menu labels are not", () => {
  const all = ["Free shipping over $99 within Australia", "Tights & leggings"];
  const { constant } = conditionalTextIssues([page("a", all, []), page("b", all, [])]);
  assert.deepEqual(constant, ["free shipping over $# within australia"]);
});

test("the sample covers products with and without each tested tag and type", () => {
  const products = [
    { handle: "a", tags: ["local-only"], product_type: "Barrow" },
    { handle: "b", tags: ["local-only"], product_type: "Barrow" },
    { handle: "c", tags: [], product_type: "Mattress" },
    { handle: "d", tags: [], product_type: "Rope" },
  ];
  const handles = sampleProducts(products, { "tag:local-only": [], "type:Mattress": [] }).map((p) => p.handle).sort();
  assert.deepEqual(handles, ["a", "b", "c", "d"]);
  assert.equal(productCount("tag:local-only", products), 2);
  assert.equal(productCount("type:Ute", products), 0);
  assert.equal(productCount("metafield:custom.x", products), null);
});

test("an alternate template nobody uses is unused; one loaded by a script, or uncountable, is not", () => {
  assert.equal(templateCount("template:product.rv", { "product.rv": 4 }, ""), 4);
  assert.equal(templateCount("template:product.old", { "product.rv": 4 }, ""), 0);
  assert.equal(templateCount("template:product.quickshop", {}, "fetch(url + '?view=quickshop')"), null);
  assert.equal(templateCount("template:search.json", {}, ""), null);
  assert.equal(templateCount("template:product.rv", null, ""), null, "Admin unreadable is not zero");
});

test("missing, handled, unused and kept are told apart", () => {
  const found = { "tag:a": ["x"], "tag:b": ["x"], "tag:c": ["x"], "tag:d": ["x"] };
  const v = verdicts(found, {
    present: (id) => id === "tag:a",
    handled: { "tag:b": "Replaced by the shipping.local metafield, agreed with the client" },
    counts: (id) => (id === "tag:c" ? 0 : id === "tag:d" ? null : 5),
  });
  assert.deepEqual(v.map((r) => r.state), ["kept", "handled", "unused", "missing"]);
});

test("a handled note has to say what the new build does", () => {
  for (const n of ["dropped", "Not needed", "ok", "n/a", "fine", ""]) assert.ok(genericNote(n), n);
  assert.ok(!genericNote("Dropped: the client stopped local delivery in September (Jane, 3 Nov)"));
  assert.equal(describe("tag:local-only"), 'product tag "local-only"');
});
