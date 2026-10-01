// Walk: on-page SEO on the preview theme, one URL per page type, as a visitor and Google get it.
//
// Exists because a client SEO audit (30 Sep 2026) found defects no guard caught: two H1s on the
// homepage, an Organization url pointing at whichever page rendered it, indexable search pages,
// product headings jumping H1 to H3, and no meta description on most pages. seo-basics.mjs guards
// those shapes in the code; this walk checks the rendered pages, where a merchant setting, an app
// or a template the guard never read can still break them.
//
// Needs network and Chrome, so it is a walk, run by hand before every handover, not in `npm run qa`.
//   PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run seo
//
// Pages come from design/seo-pages.json ({ "brand": "...", "pages": ["/", "/products/x", ...] }),
// or SEO_PAGES (comma-separated paths), or else one of each type found in the homepage's links.
// FAIL is a defect in the theme or setup and exits 1. WARN is content someone has to write (an
// empty product description, a title outside 30 to 60 characters) and goes in the handover report.
// A page or link that could not be fetched is NOT CHECKED and also exits 1: it is never a pass.
//
// Sources for each rule: Google Search Central (title links, snippets, canonicals, robots meta,
// image SEO, structured data for Product, BreadcrumbList and Article, hreflang), ogp.me, the W3C
// WAI decorative-images tutorial, and axe-core's heading rules. See "SEO checks" in CLAUDE.md.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ------------------------------------------------------------------------------ pure functions
// Every rule is a pure function of what was read from the page, so tests/seo-walk.test.mjs can
// answer the awkward cases without a store.

const fail = (check, msg) => ({ level: "FAIL", check, msg });
const warn = (check, msg) => ({ level: "WARN", check, msg });
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

// Shopify adds these to preview and tracking URLs; no visitor or crawler ever sees them on the
// published theme, so they are removed before any URL is compared or reported.
const PREVIEW_PARAMS = ["preview_theme_id", "pb", "_ab", "_fd", "_sc", "_pos", "_sid", "_ss", "_psq", "_v", "oseid"];
export function stripPreviewParams(url) {
  const u = new URL(url);
  for (const p of PREVIEW_PARAMS) u.searchParams.delete(p);
  u.hash = "";
  return u.toString();
}

export function pageTypeOf(path) {
  const p = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (/^\/(collections\/[^/]+\/)?products\/[^/]+$/.test(p)) return "product";
  if (/^\/collections\/[^/]+$/.test(p)) return "collection";
  if (/^\/blogs\/[^/]+\/tagged\/[^/]+$/.test(p) || /^\/blogs\/[^/]+$/.test(p)) return "blog";
  if (/^\/blogs\/[^/]+\/[^/]+$/.test(p)) return "article";
  if (/^\/pages\/[^/]+$/.test(p)) return "page";
  if (p === "/search") return "search";
  return "other";
}

// Search result pages are thin, near-infinite and Google asks sites to keep them out of the index.
export const shouldIndex = (type) => type !== "search";

const STOP = new Set(["and", "the", "for", "with", "from", "our", "your", "you", "are", "this", "that", "of", "in", "on", "to", "a", "an", "by"]);
const words = (s) => clean(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
const countOf = (hay, needle) => (needle ? (hay.toLowerCase().match(new RegExp(`\\b${needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) || []).length : 0);

// Google truncates title links by pixel width (about 600 px, 50 to 60 characters); under 30 says
// too little to earn the click. Length is the merchant's SEO title, so it warns; absence fails.
export function titleIssues(title, { brand, h1 } = {}) {
  const t = clean(title);
  if (!t) return [fail("title", "no <title>")];
  const out = [];
  if (t.length < 30 || t.length > 60) out.push(warn("title", `${t.length} characters, aim for 30 to 60: "${t}"`));
  // A brand twice reads as boilerplate and wastes the width; when the page's own name does not
  // carry the brand, the second copy came from the theme's title suffix, which is a defect.
  if (brand && countOf(t, brand) >= 2) {
    const fromName = countOf(clean(h1), brand) >= 1;
    out.push((fromName ? warn : fail)("title", `"${brand}" appears twice${fromName ? " (the page's own name carries it; set an SEO title)" : " (the title suffix adds it again)"}: "${t}"`));
  }
  return out;
}

// Google shows about 155 to 160 characters of a snippet; under 70 is rarely enough to use.
export function descriptionIssues(descriptions, { indexable = true } = {}) {
  const ds = descriptions.map(clean).filter(Boolean);
  if (!indexable) return [];
  if (ds.length === 0) return [fail("description", "no meta description (the theme's fallback should supply one)")];
  if (ds.length > 1) return [fail("description", `${ds.length} meta description tags`)];
  const d = ds[0];
  if (d.length < 70 || d.length > 160) return [warn("description", `${d.length} characters, aim for 70 to 160: "${d.slice(0, 80)}${d.length > 80 ? "..." : ""}"`)];
  return [];
}

// One H1 names the page. Google tolerates two, but SEO audit tools flag a second one, hidden or
// not, and that flag is what started this walk (30 Sep 2026).
export function h1Issues(h1s) {
  if (h1s.length === 1) return [];
  if (h1s.length === 0) return [fail("h1", "no H1")];
  return [fail("h1", `${h1s.length} H1s: ${h1s.map((h) => `"${clean(h.text).slice(0, 40)}"${h.hidden ? " (hidden)" : ""}`).join(", ")}`)];
}

// A heading may go at most one level deeper than the one before it (axe heading-order). Google
// says order does not matter to ranking; it matters to the outline screen readers navigate by.
export function headingOrderIssues(headings) {
  const out = [];
  let prev = 1; // the page's H1 comes first; its count is h1Issues' job
  for (const h of headings) {
    if (h.level > prev + 1) out.push(fail("headings", `H${prev} then H${h.level} "${clean(h.text).slice(0, 40)}"`));
    prev = h.level;
  }
  return out;
}

// JAWS reads alt in 125-character chunks, so longer alt is a caption in the wrong place; a word
// three times is the keyword stuffing Google's image guidelines say can be treated as spam.
export function altStuffing(alt) {
  const a = clean(alt);
  if (a.length > 125) return `${a.length} characters`;
  const seen = {};
  for (const w of words(a)) if ((seen[w] = (seen[w] || 0) + 1) === 3) return `"${w}" three times`;
  return null;
}

// img: { src, alt (null when the attribute is missing), decorative, visible }.
// Empty alt is right only for decoration (W3C WAI): role=presentation, aria-hidden, or inside a
// link or button whose own text names it. A missing attribute is the theme's fault; an empty alt
// on a content image is usually the merchant's blank alt field, so it warns.
export function imageIssues(imgs) {
  const out = [];
  const missing = imgs.filter((i) => i.alt === null);
  const empty = imgs.filter((i) => i.alt !== null && !clean(i.alt) && !i.decorative && i.visible);
  const stuffed = imgs.map((i) => [i, altStuffing(i.alt)]).filter(([, why]) => why);
  const name = (i) => (i.src || "").split("/").pop().split("?")[0].slice(0, 40) || "(no src)";
  const list = (xs) => xs.slice(0, 4).map(name).join(", ") + (xs.length > 4 ? ` and ${xs.length - 4} more` : "");
  if (missing.length) out.push(fail("alt", `${missing.length} image(s) with no alt attribute: ${list(missing)}`));
  if (empty.length) out.push(warn("alt", `${empty.length} content image(s) with empty alt: ${list(empty)}`));
  for (const [i, why] of stuffed.slice(0, 3)) out.push(warn("alt", `stuffed alt (${why}) on ${name(i)}: "${clean(i.alt).slice(0, 60)}..."`));
  return out;
}

// Canonicals must be absolute (Google), name this page and not a variant, a preview or another
// page type. A product reached through /collections/x/products/y rightly canonicalises to /products/y.
export function canonicalIssues(canonicals, requestedUrl, { indexable = true } = {}) {
  if (!indexable) return [];
  const cs = canonicals.map(clean).filter(Boolean);
  if (cs.length === 0) return [fail("canonical", "no canonical link")];
  if (cs.length > 1) return [fail("canonical", `${cs.length} canonical links`)];
  const c = cs[0];
  if (!/^https?:\/\//.test(c)) return [fail("canonical", `not absolute: ${c}`)];
  const cu = new URL(c);
  const out = [];
  if (cu.searchParams.has("preview_theme_id")) out.push(fail("canonical", `points at the preview: ${c}`));
  if (cu.searchParams.has("variant")) out.push(fail("canonical", `points at a variant URL: ${c}`));
  const req = new URL(stripPreviewParams(requestedUrl));
  const reqPath = req.pathname.replace(/^\/collections\/[^/]+(\/products\/)/, "$1").replace(/\/+$/, "") || "/";
  const canPath = cu.pathname.replace(/\/+$/, "") || "/";
  if (pageTypeOf(canPath) !== pageTypeOf(reqPath)) out.push(fail("canonical", `a ${pageTypeOf(reqPath)} page canonicalises to a ${pageTypeOf(canPath)} URL: ${c}`));
  else if (canPath !== reqPath) out.push(fail("canonical", `points at a different page: ${c}`));
  // An alternate template reached by ?view= canonicalises to the default template's URL, so Google
  // indexes the default page, not this one. Assign the template to the page in admin instead.
  if (req.searchParams.has("view") && !cu.searchParams.has("view")) out.push(warn("canonical", `?view=${req.searchParams.get("view")} canonicalises to ${cu.pathname}, which renders the default template`));
  return out;
}

// robots: every meta robots / googlebot content plus the X-Robots-Tag header.
export function robotsIssues(robots, { indexable }) {
  const noindex = robots.some((r) => /\b(noindex|none)\b/i.test(r));
  if (indexable && noindex) return [fail("robots", `noindex on an indexable page (${robots.join("; ")})`)];
  if (!indexable && !noindex) return [fail("robots", "search results are indexable: needs <meta name=\"robots\" content=\"noindex, follow\">")];
  return [];
}

export const langIssues = (lang) => (clean(lang) ? [] : [fail("lang", "<html> has no lang")]);

// ogp.me requires title, type, image and url; a share with no description shows an empty card.
// The image is the merchant's (product media or the social sharing image), so it warns.
export function ogIssues(og) {
  const out = [];
  for (const k of ["title", "description", "type", "url"]) if (!clean(og[k])) out.push(fail("og", `no og:${k}`));
  if (!clean(og.image)) out.push(warn("og", "no og:image (set a social sharing image in Online Store > Preferences)"));
  return out;
}

// hreflang: absolute URLs, and the set lists this page itself (Google's localized versions guide).
export function hreflangIssues(alternates, canonical) {
  if (!alternates.length) return [];
  const out = [];
  const rel = alternates.filter((a) => !/^https?:\/\//.test(a.href));
  if (rel.length) out.push(fail("hreflang", `relative hreflang URL(s): ${rel.map((a) => a.href).join(", ")}`));
  if (canonical && /^https?:\/\//.test(canonical)) {
    const self = new URL(stripPreviewParams(canonical)).pathname.replace(/\/+$/, "");
    const listed = alternates.some((a) => /^https?:\/\//.test(a.href) && new URL(stripPreviewParams(a.href)).pathname.replace(/\/+$/, "") === self);
    if (!listed) out.push(fail("hreflang", "the hreflang set does not list this page itself"));
  }
  return out;
}

// JSON-LD: every block parses, the page type carries the schema Google reads for it, and the
// fields Google requires are not empty. Empty optional strings (a blank description) warn.
const typesOf = (n) => [].concat(n?.["@type"] || []);
export function flattenLd(blocks) {
  const nodes = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n["@type"]) nodes.push(n);
    if (n["@graph"]) walk(n["@graph"]);
  };
  blocks.forEach(walk);
  return nodes;
}
const blank = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

export function jsonLdIssues(rawBlocks, type) {
  const out = [];
  const parsed = [];
  for (const raw of rawBlocks) {
    try { parsed.push(JSON.parse(raw)); } catch (e) { out.push(fail("json-ld", `does not parse: ${e.message.slice(0, 60)}`)); }
  }
  const nodes = flattenLd(parsed);
  const of = (...ts) => nodes.filter((n) => typesOf(n).some((t) => ts.includes(t)));

  // Empty strings on any typed top-level node: Google reads "" as a value, not an absence.
  for (const n of nodes) {
    const empties = Object.entries(n).filter(([k, v]) => !k.startsWith("@") && typeof v === "string" && !v.trim()).map(([k]) => k);
    if (empties.length) out.push(warn("json-ld", `${typesOf(n).join("/")} has empty ${empties.join(", ")}`));
  }

  // The Organization is the site's, on every page: its url is the homepage, never this page.
  for (const o of of("Organization", "OnlineStore", "WebSite")) {
    if (o.url && /^https?:/.test(o.url) && new URL(o.url).pathname.replace(/\/+$/, "") !== "") out.push(fail("json-ld", `${typesOf(o)[0]} url is not the homepage: ${o.url}`));
  }
  if (type === "home" && !of("Organization", "OnlineStore", "WebSite").length) out.push(fail("json-ld", "no Organization or WebSite on the homepage"));

  if (type === "product") {
    const products = of("Product", "ProductGroup");
    if (!products.length) out.push(fail("json-ld", "no Product or ProductGroup"));
    for (const p of products.filter((n) => !typesOf(n).includes("Product") || !nodes.some((g) => typesOf(g).includes("ProductGroup") && [].concat(g.hasVariant || []).includes(n)))) {
      if (blank(p.name)) out.push(fail("json-ld", `${typesOf(p)[0]} has no name`));
      const variants = typesOf(p).includes("ProductGroup") ? [].concat(p.hasVariant || []) : [p];
      if (!variants.length) out.push(fail("json-ld", "ProductGroup has no hasVariant"));
      const offers = variants.flatMap((v) => [].concat(v.offers || []));
      if (!offers.length) out.push(fail("json-ld", `${typesOf(p)[0]} has no offers`));
      if (offers.some((o) => blank(o.price) || blank(o.priceCurrency))) out.push(fail("json-ld", "an offer has no price or priceCurrency"));
      if (blank(p.image) && variants.every((v) => blank(v.image))) out.push(warn("json-ld", `${typesOf(p)[0]} has no image`));
      if (p.description === undefined) out.push(warn("json-ld", `${typesOf(p)[0]} has no description`));
    }
  }

  if (["collection", "product", "article"].includes(type)) {
    const crumbs = of("BreadcrumbList");
    if (!crumbs.length) out.push(fail("json-ld", "no BreadcrumbList"));
    for (const b of crumbs) {
      const items = [].concat(b.itemListElement || []);
      if (!items.length) out.push(fail("json-ld", "BreadcrumbList has no itemListElement"));
      items.forEach((it, i) => {
        if (blank(it.position) || blank(it.name ?? it.item?.name)) out.push(fail("json-ld", `breadcrumb ${i + 1} has no position or name`));
        if (i < items.length - 1 && blank(typeof it.item === "object" ? it.item?.["@id"] ?? it.item?.url : it.item)) out.push(fail("json-ld", `breadcrumb ${i + 1} has no item URL`));
      });
    }
  }

  if (type === "article") {
    const arts = of("Article", "BlogPosting", "NewsArticle");
    if (!arts.length) out.push(fail("json-ld", "no Article or BlogPosting"));
    for (const a of arts) {
      if (blank(a.headline)) out.push(fail("json-ld", "Article has no headline"));
      if (blank(a.datePublished)) out.push(fail("json-ld", "Article has no datePublished"));
      if (blank(a.image)) out.push(warn("json-ld", "Article has no image (give the article a featured image)"));
      if (blank(a.author)) out.push(warn("json-ld", "Article has no author"));
    }
  }
  return out;
}

// Titles and descriptions must differ page to page (Google: unique per page). In a one-per-type
// sample, a repeat means a template fallback, not a coincidence.
export function duplicateIssues(pages, key, check) {
  const byValue = new Map();
  for (const p of pages) {
    const v = clean(p[key]).toLowerCase();
    if (!v) continue;
    byValue.set(v, [...(byValue.get(v) || []), p]);
  }
  const out = new Map();
  for (const [, ps] of byValue) {
    if (ps.length < 2) continue;
    for (const p of ps) out.set(p.path, [fail(check, `same ${key} as ${ps.filter((q) => q !== p).map((q) => q.path).join(", ")}`)]);
  }
  return out;
}

// A link that 404s is a dead end; a redirect chain wastes crawl and link equity. One redirect is
// usually a menu or content link to an old handle, so it warns with the URL to change it to.
export function linkVerdict({ status, hops, finalUrl, error }) {
  if (error) return null; // could not check, reported separately
  if (status >= 400) return fail("links", `${status}`);
  if (hops >= 2) return fail("links", `redirect chain of ${hops} to ${finalUrl}`);
  if (hops === 1) return warn("links", `redirects to ${finalUrl}`);
  return undefined;
}

// Robots-disallowed, session or asset URLs: not pages a crawler follows.
export function linkIsCheckable(url, origin) {
  let u;
  try { u = new URL(url, origin); } catch { return false; }
  const o = new URL(origin);
  if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== o.hostname.replace(/^www\./, "")) return false;
  if (/^\/(cart|checkout|checkouts|account|orders|search|cdn|services|wpm|web-pixels)(\/|$)/.test(u.pathname)) return false;
  if ([...u.searchParams.keys()].some((k) => /^(filter\.|sort_by|q$|variant$|page$)/.test(k))) return false;
  if (/\/collections\/[^/]+\/[^/]*\+/.test(u.pathname)) return false;
  return true;
}

export function robotsTxtIssues(status, text) {
  if (status !== 200) return [fail("robots.txt", `returns ${status}`)];
  const out = [];
  if (!/^sitemap:\s*\S+/im.test(text)) out.push(fail("robots.txt", "no Sitemap: line"));
  // "Disallow: /" in the * group blocks the whole store.
  const star = text.split(/^user-agent:/im).find((g) => /^\s*\*\s*$/m.test(g.split("\n")[0]));
  if (star && /^disallow:\s*\/\s*$/im.test(star)) out.push(fail("robots.txt", "Disallow: / for every crawler"));
  return out;
}

export const sitemapIssues = (status, text) => (status !== 200 ? [fail("sitemap", `returns ${status}`)] : /<(sitemapindex|urlset)\b/.test(text) ? [] : [fail("sitemap", "is not a sitemap")]);

// ----------------------------------------------------------------------------------- the walk

const DEFAULT_TYPES = ["home", "collection", "product", "blog", "article", "page", "search"];

function loadConfig() {
  const file = join(ROOT, "design", "seo-pages.json");
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const env = process.env.SEO_PAGES ? process.env.SEO_PAGES.split(",").map((s) => s.trim()).filter(Boolean) : null;
  return { brand: process.env.SEO_BRAND || cfg.brand || "", pages: env || cfg.pages || null, linkCap: Number(process.env.SEO_LINK_CAP || cfg.linkCap || 25), from: env ? "SEO_PAGES" : cfg.pages ? "design/seo-pages.json" : "the homepage's links" };
}

export function readPage() {
  // Runs in the browser. Shopify's preview bar is removed first: visitors never get it.
  document.querySelectorAll('#preview-bar-iframe, #PBarNextFrameWrapper, [id^="PBar"], iframe[src*="preview_bar"]').forEach((e) => e.remove());
  const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !el.closest('[aria-hidden="true"], [inert]');
  const main = document.querySelector("main") || document.body;
  const attr = (sel, a = "content") => [...document.querySelectorAll(sel)].map((e) => e.getAttribute(a) || "");
  const named = (el) => (el.getAttribute("aria-label") || "").trim() || [...el.childNodes].some((n) => (n.nodeType === 3 ? n.textContent.trim() : n.nodeName !== "IMG" && n.textContent.trim()));
  return {
    lang: document.documentElement.getAttribute("lang") || "",
    title: document.title,
    descriptions: attr('meta[name="description"]'),
    canonicals: attr('link[rel="canonical"]', "href"),
    robots: attr('meta[name="robots"], meta[name="googlebot"]'),
    og: Object.fromEntries(["title", "description", "image", "type", "url"].map((k) => [k, attr(`meta[property="og:${k}"]`)[0] || ""])),
    hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((e) => ({ lang: e.hreflang, href: e.getAttribute("href") || "" })),
    h1s: [...document.querySelectorAll("h1")].map((h) => ({ text: h.textContent, hidden: !shown(h) || getComputedStyle(h).clipPath !== "none" || getComputedStyle(h).clip !== "auto" })),
    headings: [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(shown).map((h) => ({ level: +h.tagName[1], text: h.textContent })),
    images: [...main.querySelectorAll("img")].map((i) => {
      const host = i.closest("a, button");
      return {
        src: i.currentSrc || i.getAttribute("src") || i.getAttribute("data-src") || "",
        alt: i.hasAttribute("alt") ? i.getAttribute("alt") : null,
        decorative: /^(presentation|none)$/.test(i.getAttribute("role") || "") || !!i.closest('[aria-hidden="true"]') || (!!host && !!named(host)) || (i.width <= 1 && i.height <= 1 && i.complete),
        visible: shown(i),
      };
    }),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    // Links in the content first, so the cap keeps the ones this page is responsible for.
    links: [...new Set([...main.querySelectorAll("a[href]"), ...document.querySelectorAll("a[href]")].map((a) => a.href))],
  };
}

export function withPreview(path, base) {
  const u = new URL(path, base.origin);
  for (const [k, v] of base.searchParams) if (k === "preview_theme_id") u.searchParams.set(k, v);
  if (base.searchParams.has("preview_theme_id")) u.searchParams.set("pb", "0");
  return u.toString();
}

async function fetchFollow(url, headers, maxHops = 5) {
  let hops = 0;
  let current = url;
  for (let tries = 0; ; ) {
    let r;
    try {
      r = await fetch(current, { redirect: "manual", headers });
    } catch (e) {
      return { error: e.message };
    }
    // Shopify rate-limits fast clients; wait as long as it asks, then try again.
    if (r.status === 429 && tries++ < 5) { await new Promise((ok) => setTimeout(ok, 1000 * (Number(r.headers.get("retry-after")) || 3 * tries))); continue; }
    if (r.status === 429) return { error: "rate limited (429)" };
    await r.arrayBuffer().catch(() => {});
    if (r.status >= 300 && r.status < 400 && r.headers.get("location") && hops < maxHops) {
      hops++;
      current = new URL(r.headers.get("location"), current).toString();
      continue;
    }
    return { status: r.status, hops, finalUrl: stripPreviewParams(current) };
  }
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function main() {
  const RAW = process.env.PREVIEW_URL || process.argv[2];
  if (!RAW) {
    console.log("Nothing checked. Give it the preview URL:");
    console.log("  PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run seo");
    process.exit(1);
  }
  const base = new URL(RAW);
  const themeId = base.searchParams.get("preview_theme_id");
  const cfg = loadConfig();

  let puppeteer, Launcher;
  try {
    puppeteer = (await import("puppeteer-core")).default;
    ({ Launcher } = await import("chrome-launcher"));
  } catch {
    console.log("NOT CHECKED: puppeteer-core and chrome-launcher are not installed. Run: npm i -D puppeteer-core chrome-launcher");
    process.exit(1);
  }
  const chrome = Launcher.getInstallations()[0];
  if (!chrome) { console.log("NOT CHECKED: no Chrome found on this machine."); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (["image", "media", "font"].includes(r.resourceType()) ? r.abort() : r.continue()));

  const notChecked = [];
  async function visit(path) {
    const url = withPreview(path, base);
    const res = await page.goto(url, { waitUntil: "load", timeout: 90000 }).catch((e) => ({ error: e.message }));
    if (!res || res.error) return { error: res?.error || "no response" };
    const served = /theme;desc="(\d+)"/.exec(res.headers()["server-timing"] || "")?.[1];
    if (themeId && served && served !== themeId) return { error: `served theme ${served}, not the preview ${themeId}` };
    await new Promise((ok) => setTimeout(ok, 800)); // app scripts that inject JSON-LD after load
    return { status: res.status(), xRobots: res.headers()["x-robots-tag"] || "", data: await page.evaluate(readPage) };
  }

  // Which pages
  let paths = cfg.pages;
  if (!paths) {
    const home = await visit("/");
    if (home.error) { console.log(`NOT CHECKED: the homepage did not load (${home.error})`); await browser.close(); process.exit(1); }
    paths = ["/"];
    for (const t of DEFAULT_TYPES.slice(1, -1)) {
      const hit = home.data.links.map((l) => new URL(l)).find((u) => u.hostname === base.hostname && pageTypeOf(u.pathname) === t);
      if (hit) paths.push(hit.pathname); else notChecked.push(`${t}: no ${t} link on the homepage; list one in design/seo-pages.json`);
    }
    paths.push("/search?q=a");
  }

  const pages = [];
  for (const path of paths) {
    const type = pageTypeOf(path);
    const r = await visit(path);
    if (r.error || r.status !== 200) { notChecked.push(`${path}: ${r.error || `returned ${r.status}`}`); continue; }
    const d = r.data;
    const indexable = shouldIndex(type);
    const h1 = d.h1s[0]?.text || "";
    const issues = {
      h1: h1Issues(d.h1s),
      headings: headingOrderIssues(d.headings),
      title: titleIssues(d.title, { brand: cfg.brand, h1 }),
      description: descriptionIssues(d.descriptions, { indexable }),
      canonical: [...canonicalIssues(d.canonicals, withPreview(path, base), { indexable }), ...hreflangIssues(d.hreflang, d.canonicals[0])],
      robots: [...robotsIssues([...d.robots, r.xRobots].filter(Boolean), { indexable }), ...langIssues(d.lang)],
      alt: imageIssues(d.images),
      og: ogIssues(d.og),
      "json-ld": jsonLdIssues(d.ld, type),
      links: [],
    };
    pages.push({ path, type, title: d.title, description: indexable ? d.descriptions[0] : "", links: d.links, issues });
  }

  for (const [key, check] of [["title", "title"], ["description", "description"]]) {
    for (const [path, extra] of duplicateIssues(pages, key, check)) pages.find((p) => p.path === path).issues[check].push(...extra);
  }

  // Internal links: deduped across pages, capped per page, fetched with the preview's cookie so
  // the preview theme answers.
  const cookie = (await page.cookies(base.origin)).map((c) => `${c.name}=${c.value}`).join("; ");
  await browser.close();
  const seen = new Map();
  let checkedLinks = 0;
  for (const p of pages) {
    const fresh = [...new Set(p.links.map((l) => { try { return stripPreviewParams(l); } catch { return null; } }).filter((l) => l && linkIsCheckable(l, base.origin)))].filter((l) => !seen.has(l)).slice(0, cfg.linkCap);
    const results = await pool(fresh, 2, (l) => fetchFollow(l, { cookie, "user-agent": "Mozilla/5.0 devote-seo-walk" }));
    fresh.forEach((l, i) => seen.set(l, results[i]));
    checkedLinks += fresh.length;
    for (const l of p.links.map((x) => { try { return stripPreviewParams(x); } catch { return null; } })) {
      const r = l && seen.get(l);
      if (!r) continue;
      if (r.error) { notChecked.push(`link ${l}: ${r.error}`); seen.set(l, { reported: true }); continue; }
      if (r.reported) continue;
      const v = linkVerdict(r);
      if (v) { p.issues.links.push({ ...v, msg: `${new URL(l).pathname}${new URL(l).search}: ${v.msg}` }); seen.set(l, { reported: true }); }
    }
  }

  // Site-wide
  const site = [];
  const get = async (p) => { try { const r = await fetch(new URL(p, base.origin)); return [r.status, await r.text()]; } catch (e) { notChecked.push(`${p}: ${e.message}`); return [0, ""]; } };
  site.push(...robotsTxtIssues(...(await get("/robots.txt"))), ...sitemapIssues(...(await get("/sitemap.xml"))));

  // Report
  const cols = ["h1", "headings", "title", "description", "canonical", "robots", "alt", "og", "json-ld", "links"];
  const short = { h1: "H1", headings: "Hn", title: "title", description: "desc", canonical: "canon", robots: "index", alt: "alt", og: "og", "json-ld": "ld", links: "links" };
  const cell = (is) => (is.some((i) => i.level === "FAIL") ? "FAIL" : is.length ? "warn" : "ok");
  const pw = Math.min(46, Math.max(4, ...pages.map((p) => p.path.length)));
  console.log(`SEO walk: ${pages.length} pages from ${cfg.from}, ${checkedLinks} internal links, preview theme ${themeId || "(none: checking the live theme)"}\n`);
  console.log(`${"type".padEnd(10)} ${"page".padEnd(pw)} ${cols.map((c) => short[c].padEnd(5)).join(" ")}`);
  for (const p of pages) console.log(`${p.type.padEnd(10)} ${(p.path.length > pw ? p.path.slice(0, pw - 1) + "~" : p.path).padEnd(pw)} ${cols.map((c) => cell(p.issues[c]).padEnd(5)).join(" ")}`);

  const all = pages.flatMap((p) => cols.flatMap((c) => p.issues[c].map((i) => ({ ...i, path: p.path }))));
  all.push(...site.map((i) => ({ ...i, path: "(site)" })));
  for (const level of ["FAIL", "WARN"]) {
    const xs = all.filter((i) => i.level === level);
    if (!xs.length) continue;
    console.log(`\n${level} (${xs.length})`);
    for (const i of xs) console.log(`  ${i.path}  ${i.check}: ${i.msg}`);
  }
  if (notChecked.length) {
    console.log(`\nNOT CHECKED (${notChecked.length})`);
    for (const n of notChecked) console.log(`  ${n}`);
  }
  const fails = all.filter((i) => i.level === "FAIL").length;
  console.log(`\n${fails} FAIL, ${all.length - fails} WARN${notChecked.length ? `, ${notChecked.length} not checked` : ""}. FAILs block the handover; WARNs go in the report.`);
  process.exit(fails || notChecked.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
