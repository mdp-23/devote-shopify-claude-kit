// The SEO walk's rules, without a store. Run with: node --test tests/
//
// Each case is a page shape that either shipped (30 Sep 2026) or would be a false alarm.
// If you change a rule in scripts/qa/seo-walk.mjs, change its case here in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripPreviewParams,
  pageTypeOf,
  titleIssues,
  descriptionIssues,
  h1Issues,
  headingOrderIssues,
  altStuffing,
  imageIssues,
  canonicalIssues,
  robotsIssues,
  ogIssues,
  hreflangIssues,
  jsonLdIssues,
  duplicateIssues,
  linkVerdict,
  linkIsCheckable,
  robotsTxtIssues,
} from "../scripts/qa/seo-walk.mjs";

const levels = (issues) => issues.map((i) => i.level);
const PREVIEW = "https://www.acme.com/products/fin?preview_theme_id=123&pb=0";

test("preview parameters are stripped, real ones kept", () => {
  assert.equal(stripPreviewParams(PREVIEW), "https://www.acme.com/products/fin");
  assert.equal(stripPreviewParams("https://www.acme.com/collections/a?page=2&_pos=1&_sid=x#top"), "https://www.acme.com/collections/a?page=2");
});

test("page types come from the path", () => {
  assert.equal(pageTypeOf("/"), "home");
  assert.equal(pageTypeOf("/products/fin"), "product");
  assert.equal(pageTypeOf("/collections/fins/products/fin"), "product");
  assert.equal(pageTypeOf("/collections/shoes?view=maker"), "collection");
  assert.equal(pageTypeOf("/blogs/news"), "blog");
  assert.equal(pageTypeOf("/blogs/news/tagged/leather"), "blog");
  assert.equal(pageTypeOf("/blogs/news/a-post"), "article");
  assert.equal(pageTypeOf("/pages/faq"), "page");
  assert.equal(pageTypeOf("/search?q=fins"), "search");
});

test("title: missing fails, length outside 30 to 60 warns, in range passes", () => {
  assert.deepEqual(levels(titleIssues("  ")), ["FAIL"]);
  assert.deepEqual(levels(titleIssues("Acme Shoes")), ["WARN"]);
  assert.deepEqual(levels(titleIssues("x".repeat(61))), ["WARN"]);
  assert.deepEqual(titleIssues("Leather Trail Shoes, Handmade | Acme"), []);
  assert.deepEqual(titleIssues("x".repeat(30)), []);
  assert.deepEqual(titleIssues("x".repeat(60)), []);
});

test("title: a brand twice fails when the suffix adds it, warns when the page's own name has it", () => {
  const suffix = titleIssues("Trail Shoes Handmade in Australia | Acme | Acme", { brand: "Acme", h1: "Trail Shoes" });
  assert.deepEqual(levels(suffix), ["FAIL"]);
  const named = titleIssues("Acme Rain Jacket for Hiking and Camping | Acme", { brand: "Acme", h1: "Acme Rain Jacket" });
  assert.deepEqual(levels(named), ["WARN"]);
  assert.deepEqual(titleIssues("Leather Trail Shoes, Handmade in Ballarat | Acme", { brand: "Acme", h1: "Leather" }), []);
  // "Acmes" is not the brand
  assert.deepEqual(titleIssues("Shoes for Acmes Who Want Leather Soles | Acme", { brand: "Acme", h1: "x" }), []);
});

test("meta description: missing or doubled fails, length warns, search is exempt", () => {
  assert.deepEqual(levels(descriptionIssues([])), ["FAIL"]);
  assert.deepEqual(levels(descriptionIssues(["a".repeat(100), "b".repeat(100)])), ["FAIL"]);
  assert.deepEqual(levels(descriptionIssues(["Too short."])), ["WARN"]);
  assert.deepEqual(levels(descriptionIssues(["x".repeat(319)])), ["WARN"]);
  assert.deepEqual(descriptionIssues(["x".repeat(70)]), []);
  assert.deepEqual(descriptionIssues(["x".repeat(160)]), []);
  assert.deepEqual(descriptionIssues([], { indexable: false }), []);
});

test("H1: exactly one, and a hidden second one still counts (a client homepage)", () => {
  assert.deepEqual(h1Issues([{ text: "Fins" }]), []);
  assert.deepEqual(levels(h1Issues([])), ["FAIL"]);
  const two = h1Issues([{ text: "Acme Shoes", hidden: true }, { text: "Trail Shoes Handcrafted" }]);
  assert.deepEqual(levels(two), ["FAIL"]);
  assert.match(two[0].msg, /\(hidden\)/);
});

test("heading order: a skipped level fails, going back up does not", () => {
  const h = (...ls) => ls.map((level) => ({ level, text: `H${level}` }));
  assert.deepEqual(headingOrderIssues(h(1, 2, 3, 2, 3, 4, 2)), []);
  assert.deepEqual(headingOrderIssues(h(1, 2, 3, 4, 2, 2)), []);
  assert.deepEqual(levels(headingOrderIssues(h(1, 3))), ["FAIL"]); // a client product page
  assert.deepEqual(levels(headingOrderIssues(h(1, 2, 4))), ["FAIL"]);
  assert.deepEqual(levels(headingOrderIssues(h(3))), ["FAIL"]); // content that starts at H3 under the page's H1
  assert.deepEqual(headingOrderIssues(h(2, 3)), []); // an H1 above <main> is fine
});

test("alt stuffing: over 125 characters, or one word three times", () => {
  assert.equal(altStuffing("Blue Dragons fin blades by Tiani Dun, top view"), null);
  assert.equal(altStuffing(""), null);
  assert.equal(altStuffing(null), null);
  assert.match(altStuffing("x".repeat(126)), /126/);
  assert.match(altStuffing("leather shoes leather trail shoes leather hiking"), /leather/);
  assert.equal(altStuffing("Acme Australia Acme USA Ranger leather trail shoes"), null); // twice is not three
  assert.equal(altStuffing("the fin and the blade and the pocket"), null); // stopwords do not count
});

test("images: no alt attribute fails, empty alt on content warns, decorative empty alt passes", () => {
  const img = (o) => ({ src: "https://cdn/x.jpg", alt: "", decorative: false, visible: true, ...o });
  assert.deepEqual(levels(imageIssues([img({ alt: null })])), ["FAIL"]);
  assert.deepEqual(levels(imageIssues([img({ alt: null, decorative: true, visible: false })])), ["FAIL"]);
  assert.deepEqual(levels(imageIssues([img({})])), ["WARN"]);
  assert.deepEqual(imageIssues([img({ decorative: true })]), []);
  assert.deepEqual(imageIssues([img({ visible: false })]), []); // a hover image nobody sees
  assert.deepEqual(imageIssues([img({ alt: "Blue Dragons fin blades" })]), []);
  assert.deepEqual(levels(imageIssues([img({ alt: "fins fins fins" })])), ["WARN"]);
});

test("canonical: absolute, this page, no variant or preview, and not another page type", () => {
  const c = (href, url = PREVIEW, o) => levels(canonicalIssues([href], url, o));
  assert.deepEqual(c("https://www.acme.com/products/fin"), []);
  assert.deepEqual(c("https://www.acme.com/products/fin/"), []);
  assert.deepEqual(c("https://acme.myshopify.com/products/fin"), []); // host differs on a myshopify preview
  assert.deepEqual(c("/products/fin"), ["FAIL"]);
  assert.deepEqual(c("https://www.acme.com/products/fin?variant=42"), ["FAIL"]);
  assert.deepEqual(c("https://www.acme.com/products/fin?preview_theme_id=123"), ["FAIL"]);
  assert.deepEqual(c("https://www.acme.com/"), ["FAIL"]);
  assert.deepEqual(c("https://www.acme.com/products/other"), ["FAIL"]);
  assert.deepEqual(levels(canonicalIssues([], PREVIEW)), ["FAIL"]);
  assert.deepEqual(levels(canonicalIssues(["https://a.com/products/fin", "https://a.com/products/fin"], PREVIEW)), ["FAIL"]);
  // a product reached through a collection canonicalises to /products/
  assert.deepEqual(c("https://www.acme.com/products/fin", "https://www.acme.com/collections/fins/products/fin?preview_theme_id=1"), []);
  // pagination keeps its own canonical
  assert.deepEqual(c("https://www.acme.com/collections/fins?page=2", "https://www.acme.com/collections/fins?page=2"), []);
  // ?view= alternate template canonicalising to the base URL
  assert.deepEqual(c("https://www.acme.com/pages/makers", "https://www.acme.com/pages/makers?view=makers"), ["WARN"]);
  // search is noindex, so its self-canonical with ?q= is fine
  assert.deepEqual(levels(canonicalIssues([], "https://www.acme.com/search?q=a", { indexable: false })), []);
});

test("robots: noindex fails on an indexable page and is required on search", () => {
  assert.deepEqual(robotsIssues([], { indexable: true }), []);
  assert.deepEqual(levels(robotsIssues(["noindex, follow"], { indexable: true })), ["FAIL"]);
  assert.deepEqual(levels(robotsIssues(["none"], { indexable: true })), ["FAIL"]);
  assert.deepEqual(robotsIssues(["noindex, follow"], { indexable: false }), []);
  assert.deepEqual(levels(robotsIssues([], { indexable: false })), ["FAIL"]);
  assert.deepEqual(robotsIssues(["index, follow"], { indexable: true }), []);
});

test("Open Graph: title, description, type and url fail when missing, image warns", () => {
  const og = { title: "t", description: "d", image: "https://cdn/i.jpg", type: "website", url: "https://a.com/" };
  assert.deepEqual(ogIssues(og), []);
  assert.deepEqual(levels(ogIssues({ ...og, image: "" })), ["WARN"]);
  assert.deepEqual(levels(ogIssues({ ...og, type: "" })), ["FAIL"]);
});

test("hreflang: absolute and lists this page", () => {
  const set = [{ lang: "x-default", href: "https://a.com/pages/faq" }, { lang: "de", href: "https://a.com/de/pages/faq" }];
  assert.deepEqual(hreflangIssues(set, "https://a.com/pages/faq"), []);
  assert.deepEqual(hreflangIssues([], "https://a.com/pages/faq"), []);
  assert.deepEqual(levels(hreflangIssues([{ lang: "de", href: "/de/pages/faq" }, set[0]], "https://a.com/pages/faq")), ["FAIL"]);
  assert.deepEqual(levels(hreflangIssues([set[1]], "https://a.com/pages/faq")), ["FAIL"]);
});

const ld = (o) => JSON.stringify({ "@context": "https://schema.org", ...o });
const ORG = ld({ "@type": "Organization", name: "Acme", url: "https://a.com" });
const CRUMBS = ld({ "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "Home", item: "https://a.com/" },
  { "@type": "ListItem", position: 2, name: "Fin" },
] });
const GROUP = {
  "@type": "ProductGroup", name: "Blue Dragons", description: "Blades.", hasVariant: [
    { "@type": "Product", name: "Ranger - Leather", image: "https://cdn/1.jpg", offers: { "@type": "Offer", price: "685.00", priceCurrency: "AUD" } },
  ],
};

test("JSON-LD: a block that does not parse fails", () => {
  assert.deepEqual(levels(jsonLdIssues(["{ nope", ORG], "page")), ["FAIL"]);
});

test("JSON-LD: the homepage needs Organization or WebSite, and its url is the homepage", () => {
  assert.deepEqual(jsonLdIssues([ORG], "home"), []);
  assert.deepEqual(jsonLdIssues([ld({ "@type": "WebSite", name: "Acme", url: "https://a.com/" })], "home"), []);
  assert.deepEqual(levels(jsonLdIssues([], "home")), ["FAIL"]);
  // the audit's bug: url built from the current page
  assert.deepEqual(levels(jsonLdIssues([ld({ "@type": "Organization", name: "Acme", url: "https://a.com/pages/contact-us" })], "page")), ["FAIL"]);
});

test("JSON-LD: product needs Product or ProductGroup with offers; an empty description warns", () => {
  assert.deepEqual(jsonLdIssues([ORG, CRUMBS, ld(GROUP)], "product"), []);
  assert.deepEqual(levels(jsonLdIssues([ORG, CRUMBS], "product")), ["FAIL"]);
  const noOffers = { ...GROUP, hasVariant: [{ "@type": "Product", name: "v", image: "i" }] };
  assert.deepEqual(levels(jsonLdIssues([CRUMBS, ld(noOffers)], "product")), ["FAIL"]);
  const noPrice = { ...GROUP, hasVariant: [{ "@type": "Product", name: "v", image: "i", offers: { price: "", priceCurrency: "AUD" } }] };
  assert.ok(levels(jsonLdIssues([CRUMBS, ld(noPrice)], "product")).includes("FAIL"));
  const emptyDesc = jsonLdIssues([CRUMBS, ld({ ...GROUP, description: "", category: "" })], "product");
  assert.deepEqual(levels(emptyDesc), ["WARN"]);
  assert.match(emptyDesc[0].msg, /category/);
  assert.match(emptyDesc[0].msg, /description/);
  const plain = ld({ "@type": "Product", name: "Mask", image: "i", description: "d", offers: [{ price: "90", priceCurrency: "AUD" }] });
  assert.deepEqual(jsonLdIssues([CRUMBS, plain], "product"), []);
});

test("JSON-LD: collections, products and articles need a complete BreadcrumbList", () => {
  assert.deepEqual(jsonLdIssues([CRUMBS], "collection"), []);
  assert.deepEqual(levels(jsonLdIssues([ORG], "collection")), ["FAIL"]);
  const noItem = ld({ "@type": "BreadcrumbList", itemListElement: [{ position: 1, name: "Home" }, { position: 2, name: "Fins" }] });
  assert.deepEqual(levels(jsonLdIssues([noItem], "collection")), ["FAIL"]);
  assert.deepEqual(jsonLdIssues([ORG], "page"), []); // pages are not required to carry one
});

test("JSON-LD: articles need Article with a headline and date; a missing image warns", () => {
  const art = { "@type": "Article", headline: "Leather or synthetic", datePublished: "2026-09-30", author: { "@type": "Organization", name: "Acme" }, image: "https://cdn/a.jpg" };
  assert.deepEqual(jsonLdIssues([CRUMBS, ld(art)], "article"), []);
  assert.deepEqual(levels(jsonLdIssues([CRUMBS], "article")), ["FAIL"]);
  assert.deepEqual(levels(jsonLdIssues([CRUMBS, ld({ ...art, image: undefined })], "article")), ["WARN"]);
  assert.ok(levels(jsonLdIssues([CRUMBS, ld({ ...art, headline: "" })], "article")).includes("FAIL"));
});

test("duplicates: the same title on two pages fails on both, case and spacing ignored", () => {
  const pages = [{ path: "/", title: "Acme  Fins" }, { path: "/pages/faq", title: "acme fins" }, { path: "/blogs/x", title: "Other" }];
  const d = duplicateIssues(pages, "title", "title");
  assert.deepEqual([...d.keys()].sort(), ["/", "/pages/faq"]);
  assert.equal(duplicateIssues([{ path: "/", title: "" }, { path: "/a", title: "" }], "title", "title").size, 0);
});

test("links: 4xx fails, a chain fails, one redirect warns, 200 passes, unreachable is not a verdict", () => {
  assert.equal(linkVerdict({ status: 200, hops: 0 }), undefined);
  assert.equal(linkVerdict({ status: 404, hops: 0 }).level, "FAIL");
  assert.equal(linkVerdict({ status: 200, hops: 2, finalUrl: "x" }).level, "FAIL");
  assert.equal(linkVerdict({ status: 200, hops: 1, finalUrl: "x" }).level, "WARN");
  assert.equal(linkVerdict({ error: "timeout" }), null);
});

test("links: only crawlable pages on this store are checked", () => {
  const o = "https://www.acme.com";
  assert.equal(linkIsCheckable("https://www.acme.com/collections/fins", o), true);
  assert.equal(linkIsCheckable("https://acme.com/pages/faq", o), true);
  assert.equal(linkIsCheckable("https://instagram.com/acme", o), false);
  assert.equal(linkIsCheckable("mailto:hi@acme.com", o), false);
  assert.equal(linkIsCheckable("https://www.acme.com/cart", o), false);
  assert.equal(linkIsCheckable("https://www.acme.com/account/login", o), false);
  assert.equal(linkIsCheckable("https://www.acme.com/collections/fins?filter.v.price.gte=10", o), false);
  assert.equal(linkIsCheckable("https://www.acme.com/collections/fins?sort_by=price", o), false);
});

test("robots.txt: needs a Sitemap line and must not block everything", () => {
  const shopify = "User-agent: *\nDisallow: /cart\nDisallow: /search\n\nSitemap: https://a.com/sitemap.xml\n";
  assert.deepEqual(robotsTxtIssues(200, shopify), []);
  assert.deepEqual(levels(robotsTxtIssues(404, "")), ["FAIL"]);
  assert.deepEqual(levels(robotsTxtIssues(200, "User-agent: *\nDisallow: /cart\n")), ["FAIL"]);
  assert.deepEqual(levels(robotsTxtIssues(200, "User-agent: *\nDisallow: /\nSitemap: https://a.com/sitemap.xml")), ["FAIL"]);
  assert.deepEqual(robotsTxtIssues(200, "User-agent: Nutch\nDisallow: /\n\nUser-agent: *\nDisallow: /cart\nSitemap: https://a.com/s.xml"), []);
});
