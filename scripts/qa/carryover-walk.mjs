// Walk: everything the live theme does for particular products, customers or pages, and whether
// the new build still does it.
//
// Exists because a rebuild is checked by looking at the front end, and nobody remembers what the
// old theme quietly did for some products: a shipping note only on products with one tag, a free
// shipping badge only on one product type, a template only a few products use, an app block, a
// tracking script, an engraving field. Nothing fails when the new theme leaves one out, and the
// pages still look right. On one build a sign-up form went to the wrong place for a day before the
// client noticed (that one is npm run forms). This finds the rest, before launch.
//
//   npm run carryover                       # the live theme against this repo and its preview
//   npm run carryover -- --from <theme id>  # a different "before" theme, e.g. the one live before a launch
//   npm run carryover -- --fresh            # pull the before theme again instead of using today's copy
//
// Two parts:
//   1. Code. Pulls the before theme and lists what its Liquid and JSON depend on: product tags,
//      product types, vendors and handles in conditions, metafields and metaobjects, alternate
//      templates, app blocks and app embeds that are switched on, third-party scripts and pixels,
//      line item properties and cart attributes, cart thresholds and country conditions. Each one
//      the repo no longer mentions is a finding.
//   2. Product pages. Fetches a sample of product pages on the before theme and on the preview,
//      chosen to cover every tag, type and vendor the before theme tests, and finds text that the
//      before theme shows on some products and not others (a badge, a shipping note). Any such
//      text a product shows before and not on the preview is a finding.
//
// A finding is fixed in the build, or written into design/carryover.json under "handled" with
// what the new build does instead and who agreed, for example:
//   { "handled": { "tag:no-ship-wa": "Shipping note now comes from the shipping.note metafield (snippets/ship-note.liquid)" } }
// Anything neither fixed nor handled fails, and so does anything that could not be checked: NOT
// CHECKED is never a pass. Every run writes design/carryover-report.md (commit it), the list a
// person reads to know what the old theme did. Runs in every full npm run deploy.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { onPasswordPage } from "./preview-session.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEME_DIRS = ["layout", "sections", "snippets", "blocks", "templates", "config", "locales", "assets"];

// ------------------------------------------------------------------------------ pure functions

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KINDS = {
  tag: "product tag", "customer-tag": "customer tag", type: "product type", vendor: "vendor",
  handle: "handle", template: "alternate template", metafield: "metafield", metaobject: "metaobject",
  "app-block": "app block or app embed", script: "third-party script", pixel: "tracking or app code",
  property: "line item property", "cart-attribute": "cart attribute", "cart-threshold": "cart total threshold",
  country: "country condition", text: "text on product pages",
};
export const kindOf = (id) => id.slice(0, id.indexOf(":"));
export const describe = (id) => `${KINDS[kindOf(id)] || kindOf(id)} "${id.slice(id.indexOf(":") + 1)}"`;

// Code that tracks visitors or draws an app, by what it looks like inline. Lost with a theme swap
// unless it moved to an app embed or Customer events.
export const PIXELS = {
  "Google Tag Manager": /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/,
  "Google tag (gtag)": /googletagmanager\.com\/gtag\/js|\bgtag\(\s*['"]config['"]/,
  "Meta pixel": /connect\.facebook\.net\/[^"']*fbevents\.js|\bfbq\(\s*['"]init['"]/,
  "TikTok pixel": /analytics\.tiktok\.com|\bttq\.load\(/,
  "Pinterest tag": /s\.pinimg\.com\/ct\/core\.js|\bpintrk\(\s*['"]load['"]/,
  "Microsoft Clarity": /clarity\.ms\/tag/,
  "Hotjar": /static\.hotjar\.com|\bhjid\s*:/,
  "Microsoft Ads (UET)": /bat\.bing\.com\/bat\.js/,
  "Snapchat pixel": /sc-static\.net\/scevent/,
  "Klaviyo onsite": /static\.klaviyo\.com\/onsite/,
  "Afterpay messaging": /afterpay|clearpay/i,
  "Zip messaging": /static\.zipmoney|zip\.co\/|quadpay/i,
  "Humm messaging": /humm/i,
};

/** Which line a match is on, and that line trimmed, for the report. */
function where(path, text, index) {
  const line = text.slice(0, index).split("\n").length;
  const content = text.split("\n")[line - 1].trim().replace(/\s+/g, " ").slice(0, 140);
  return `${path}:${line}  ${content}`;
}

/**
 * What a theme's code depends on. files: { "snippets/x.liquid": "...", ... }.
 * Returns { id: [where it appears, ...] }, at most three places per id.
 */
export function themeSignals(files) {
  const out = {};
  const add = (id, path, text, index) => {
    const list = (out[id] ||= []);
    if (list.length < 3) list.push(where(path, text, index));
  };
  for (const [path, text] of Object.entries(files)) {
    if (/^templates\/[^/]+\.json$/.test(path) || /^templates\/[^/]+\.liquid$/.test(path)) {
      const m = path.match(/^templates\/(\w+)\.([^/]+)\.(json|liquid)$/);
      if (m && !/^(customers|metaobject)$/.test(m[1])) add(`template:${m[1]}.${m[2]}`, path, text, 0);
    }
    if (path.endsWith(".json")) {
      // App blocks and app embeds that are switched on. The uuid differs between installs, so the
      // app and block name are the signature.
      let data = null;
      try { data = JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")); } catch { data = null; }
      if (data) walkJson(data, (node) => {
        const t = typeof node?.type === "string" && node.type.match(/^shopify:\/\/apps\/([^/]+)\/blocks\/([^/]+)\//);
        if (t && node.disabled !== true) add(`app-block:${t[1]}/${t[2]}`, path, text, Math.max(0, text.indexOf(node.type)));
      });
    }
    if (!/\.(liquid|json)$/.test(path)) continue;
    const scan = (re, make) => { for (const m of text.matchAll(re)) { const id = make(m); if (id) add(id, path, text, m.index); } };
    scan(/([\w.[\]'"]+)\.tags\s+contains\s+['"]([^'"]+)['"]/g, (m) => `${/customer/.test(m[1]) ? "customer-tag" : "tag"}:${m[2]}`);
    scan(/\btag\s+(?:==|!=|contains)\s+['"]([^'"]+)['"]/g, (m) => `tag:${m[1]}`);
    scan(/['"]([^'"]+)['"]\s+(?:in|==)\s+[\w.]*\.tags\b/g, (m) => `tag:${m[1]}`);
    scan(/\b(?:product|item|card_product|prod|p)(?:\.product)?\.type\s*(?:==|!=|contains)\s*['"]([^'"]+)['"]/g, (m) => `type:${m[1]}`);
    scan(/\b(?:product|item|card_product|prod|p)(?:\.product)?\.vendor\s*(?:==|!=|contains)\s*['"]([^'"]+)['"]/g, (m) => `vendor:${m[1]}`);
    scan(/\b(product|collection|page|blog|article)\.handle\s*(?:==|!=|contains)\s*['"]([^'"]+)['"]/g, (m) => `handle:${m[1]}/${m[2]}`);
    scan(/\btemplate\.suffix\s*(?:==|!=|contains)\s*['"]([^'"]+)['"]/g, (m) => `template:*.${m[1]}`);
    scan(/\bmetafields\.([a-z0-9_-]+)\.([a-z0-9_-]+)/gi, (m) => `metafield:${m[1]}.${m[2]}`);
    scan(/\bmetafields\[\s*['"]([^'"]+)['"]\s*\]\s*\[\s*['"]([^'"]+)['"]\s*\]/g, (m) => `metafield:${m[1]}.${m[2]}`);
    scan(/\bmetaobjects\.([a-z0-9_-]+)/gi, (m) => (/^(values|size|first|last)$/.test(m[1]) ? null : `metaobject:${m[1]}`));
    scan(/\bmetaobjects\[\s*['"]([^'"]+)['"]\s*\]/g, (m) => `metaobject:${m[1]}`);
    scan(/name\s*=\s*["']properties\[([^\]"']+)\]/g, (m) => (m[1].includes("{{") ? null : `property:${m[1]}`));
    scan(/name\s*=\s*["']attributes\[([^\]"']+)\]/g, (m) => (m[1].includes("{{") ? null : `cart-attribute:${m[1]}`));
    scan(/\bcart\.(?:total_price|items_subtotal_price|original_total_price)\s*(?:>=|>|<=|<)\s*(\d{3,})/g, (m) => `cart-threshold:${m[1]}`);
    scan(/\b(?:iso_code|country_code)\s*(?:==|!=)\s*['"]([A-Z]{2})['"]/g, (m) => `country:${m[1]}`);
    if (path.endsWith(".liquid")) {
      scan(/<script\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"'{}\s]+)["']/gi, (m) => {
        let host; try { host = new URL(m[1], "https://x.invalid").hostname; } catch { return null; }
        return /(^|\.)(shopify\.com|shopifycdn\.com|shopifycloud\.com|myshopify\.com)$/.test(host) ? null : `script:${host}`;
      });
      for (const [name, re] of Object.entries(PIXELS)) {
        const m = text.match(re);
        if (m) add(`pixel:${name}`, path, text, m.index);
      }
    }
  }
  // An app's own namespace (reviews, page builders, filters) is one finding, not one per key:
  // the question is whether the app still renders, and the keys go with it.
  const byNs = {};
  for (const id of Object.keys(out)) if (kindOf(id) === "metafield") (byNs[id.slice(10, id.indexOf(".", 10))] ||= []).push(id);
  for (const [ns, ids] of Object.entries(byNs)) {
    if (ns === "custom" || ids.length < 3) continue;
    out[`metafield:${ns}.*`] = ids.flatMap((id) => out[id]).slice(0, 3);
    for (const id of ids) delete out[id];
  }
  return out;
}

function walkJson(node, visit) {
  if (Array.isArray(node)) { node.forEach((n) => walkJson(n, visit)); return; }
  if (node && typeof node === "object") { visit(node); Object.values(node).forEach((n) => walkJson(n, visit)); }
}

/**
 * Whether the new build still does what a signal points at. files: the new build, as above.
 * "html" is the preview's rendered homepage, for code an app embed or Customer events now loads.
 */
export function stillPresent(id, files, { html = "" } = {}) {
  const value = id.slice(id.indexOf(":") + 1);
  const all = Object.entries(files).filter(([p]) => /\.(liquid|json)$/.test(p)).map(([, t]) => t).join("\n");
  const quoted = (v) => new RegExp(`['"]${esc(v)}['"]`).test(all);
  switch (kindOf(id)) {
    case "tag": case "customer-tag": case "type": case "vendor": case "country": return quoted(value);
    case "handle": return quoted(value.slice(value.indexOf("/") + 1));
    case "template": {
      const [type, suffix] = [value.slice(0, value.indexOf(".")), value.slice(value.indexOf(".") + 1)];
      return Object.keys(files).some((p) => type === "*"
        ? new RegExp(`^templates/\\w+\\.${esc(suffix)}\\.(json|liquid)$`).test(p)
        : p === `templates/${type}.${suffix}.json` || p === `templates/${type}.${suffix}.liquid`);
    }
    case "metafield": {
      const [ns, key] = [value.slice(0, value.indexOf(".")), value.slice(value.indexOf(".") + 1)];
      if (key === "*") return new RegExp(`metafields\\.${esc(ns)}\\.|metafields\\[\\s*['"]${esc(ns)}['"]`).test(all);
      return new RegExp(`metafields\\.${esc(ns)}\\.${esc(key)}\\b|metafields\\[\\s*['"]${esc(ns)}['"]\\s*\\]\\s*\\[\\s*['"]${esc(key)}['"]`).test(all);
    }
    case "metaobject": return new RegExp(`metaobjects\\.${esc(value)}\\b|metaobjects\\[\\s*['"]${esc(value)}['"]|['"]${esc(value)}['"]`).test(all);
    case "app-block": {
      // Switched on somewhere in the new build's JSON (a template, a section group, or the app
      // embeds in settings_data.json, which deploy pulls from the preview).
      const sig = `shopify://apps/${value.replace("/", "/blocks/")}/`;
      return Object.entries(files).some(([p, t]) => p.endsWith(".json") && t.includes(sig) && Object.keys(themeSignals({ [p]: t })).includes(id));
    }
    case "script": return all.includes(value) || html.includes(value);
    case "pixel": return PIXELS[value] ? PIXELS[value].test(all) || PIXELS[value].test(html) : false;
    case "property": return all.includes(`properties[${value}]`) || quoted(value);
    case "cart-attribute": return all.includes(`attributes[${value}]`) || quoted(value);
    case "cart-threshold": return new RegExp(`\\b(${esc(value)}|${esc(String(Number(value) / 100))})\\b`).test(all);
    default: return false;
  }
}

/**
 * The page's own content, without the header, menus and footer (which every page shares and which a
 * redesign rewrites): the template's sections where the theme has them (shopify-section-template--),
 * else <main>, else the body without <header>, <nav> and <footer>.
 */
export function pageContent(html) {
  const parts = [];
  for (const m of html.matchAll(/<(div|section)\b[^>]*\bid\s*=\s*["']shopify-section-template--[^"']*["'][^>]*>/gi)) {
    parts.push(balanced(html, m.index, m[1].toLowerCase()));
  }
  if (parts.length) return parts.join("\n");
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1];
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  return body.replace(/<(header|nav|footer)\b[\s\S]*?<\/\1>/gi, " ");
}
function balanced(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

/** Visible text in a page's own content, as normalised phrases. Numbers become #. */
export function phrases(html) {
  const text = pageContent(html)
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(span|strong|em|b|i|a|small|sup|sub|u|mark|abbr|bdi|font)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
  const out = new Set();
  for (const raw of text.split(/<[^>]*>/)) {
    const p = norm(decode(raw));
    if (p.length >= 4 && p.length <= 160 && /[a-z]{3,}/i.test(p)) out.add(p);
  }
  return out;
}
const decode = (s) => s.replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&ndash;|&mdash;/g, "-");
export const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/\d+(?:[.,]\d+)*/g, "#");

/**
 * Text the before theme shows on some sampled products and not others, that a product shows
 * before and not on the preview. pages: [{ handle, before: Set, after: Set }]. "data" is every
 * phrase that is just product data (titles, vendors, types, tags, options), which any theme shows
 * its own way and is not a customisation. Lines that come and go together (a shipping tab, a
 * policy block) are one finding, named by its longest line, so a block is one decision.
 * Returns { issues: { "text:<line>": { lost: [handles], lines: n } }, constant: [lines] }.
 */
export function conditionalTextIssues(pages, data = new Set(), titles = []) {
  const counts = new Map();
  for (const p of pages) for (const ph of p.before) counts.set(ph, (counts.get(ph) || 0) + 1);
  const groups = new Map(), constant = [];
  // A breadcrumb or share line carries the product's own title, and two sizes of one product
  // read the same once numbers become #. Neither is something the theme decided to show.
  const long = titles.filter((t) => t.length >= 8);
  const words = (ph) => ph.split(" ").filter((w) => /[a-z]/.test(w)).length;
  for (const [ph, n] of counts) {
    if (data.has(ph) || long.some((t) => ph.includes(t))) continue;
    if (n === pages.length && pages.length > 1) {
      // Menu and footer labels are short and every page has them; a line worth a person's look is a sentence.
      if (words(ph) >= 4 && !pages.some((p) => joined(p.after).includes(ph))) constant.push(ph);
      continue;
    }
    if (n < 2 || words(ph) < 2) continue; // one product's own description, or a lone label
    const lost = pages.filter((p) => p.before.has(ph) && !joined(p.after).includes(ph)).map((p) => p.handle);
    if (!lost.length) continue;
    const key = pages.filter((p) => p.before.has(ph)).map((p) => p.handle).join(",") + "|" + lost.join(",");
    if (!groups.has(key)) groups.set(key, { lines: [], lost });
    groups.get(key).lines.push(ph);
  }
  const issues = {};
  for (const g of groups.values()) {
    const label = g.lines.sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    issues[`text:${label}`] = { lost: g.lost, lines: g.lines.length };
  }
  return { issues, constant };
}
const joinedCache = new WeakMap();
function joined(set) { if (!joinedCache.has(set)) joinedCache.set(set, [...set].join(" | ")); return joinedCache.get(set); }

/** Products to sample: some with and some without each tag, type and vendor the theme tests. */
export function sampleProducts(products, signals, { max = 40 } = {}) {
  const picked = new Map();
  const take = (list, n) => { for (const p of list.slice(0, n)) if (picked.size < max) picked.set(p.handle, p); };
  const has = (p, kind, v) => kind === "tag" ? (p.tags || []).some((t) => t === v || t.includes(v)) : kind === "type" ? p.product_type === v : p.vendor === v;
  for (const id of Object.keys(signals)) {
    const kind = kindOf(id);
    if (!["tag", "type", "vendor"].includes(kind)) continue;
    const v = id.slice(id.indexOf(":") + 1);
    take(products.filter((p) => has(p, kind, v)), 2);
  }
  const byType = new Map();
  for (const p of products) if (!byType.has(p.product_type)) byType.set(p.product_type, p);
  take([...byType.values()], 15);
  take(products, 6);
  return [...picked.values()];
}

/** How many products carry the tag, type, vendor or handle a signal tests. null: not countable. */
export function productCount(id, products) {
  const kind = kindOf(id), v = id.slice(id.indexOf(":") + 1);
  if (kind === "tag") return products.filter((p) => (p.tags || []).some((t) => t === v || t.includes(v))).length;
  if (kind === "type") return products.filter((p) => p.product_type === v).length;
  if (kind === "vendor") return products.filter((p) => p.vendor === v).length;
  if (kind === "handle" && v.startsWith("product/")) return products.filter((p) => p.handle === v.slice(8)).length;
  return null;
}

/**
 * How many products, collections, pages, blogs or articles are assigned an alternate template,
 * from the Admin API's templateSuffix. usage: { "product.rv": 12, ... } or null when unreadable.
 * A template no resource uses may still be loaded by a script with ?view=<suffix>; "code" is the
 * before theme's files (scripts included), searched for that.
 */
export function templateCount(id, usage, code) {
  if (!usage) return null;
  const value = id.slice(id.indexOf(":") + 1);
  const [type, suffix] = [value.slice(0, value.indexOf(".")), value.slice(value.indexOf(".") + 1)];
  const n = type === "*" ? Object.entries(usage).filter(([k]) => k.endsWith(`.${suffix}`)).reduce((a, [, v]) => a + v, 0) : usage[value];
  if (n) return n;
  const viewed = new RegExp(`view[=:]\\s*\\\\?['"]?${esc(suffix)}\\b`).test(code);
  if (viewed) return null; // used by a script, not by assignment: cannot be counted, so not "unused"
  return ["product", "collection", "page", "blog", "article"].includes(type) || type === "*" ? 0 : null;
}

/** Product data any theme shows in its own words, as phrases to leave out of the text check. */
export function dataPhrases(products) {
  const out = new Set();
  for (const p of products) {
    for (const s of [p.title, p.vendor, p.product_type, ...(p.tags || []), ...(p.options || []).flatMap((o) => [o.name, ...(o.values || [])]), ...(p.variants || []).map((v) => v.title)])
      if (s) out.add(norm(String(s)));
  }
  return out;
}

/**
 * A handled note that says nothing a person could check ("dropped", "not needed"). It must say
 * what the new build does instead, or who agreed to drop it and why.
 */
export function genericNote(note) {
  const t = String(note || "").trim().toLowerCase().replace(/[.!]+$/, "");
  return t.split(/\s+/).filter(Boolean).length < 4 || /^(dropped|removed|not needed|unused|n\/a|na|ok|fine|done|ignore|skip)$/.test(t);
}

/**
 * The verdict: every signal of the before theme, with its state.
 * found: { id: [where] }, present(id): bool, counts(id): number|null, handled: { id: note }.
 */
export function verdicts(found, { present, counts = () => null, handled = {} }) {
  return Object.keys(found).sort().map((id) => {
    if (present(id)) return { id, state: "kept", where: found[id] };
    if (handled[id]) return { id, state: "handled", note: handled[id], where: found[id] };
    const n = counts(id);
    if (n === 0) return { id, state: "unused", where: found[id] };
    return { id, state: "missing", count: n, where: found[id] };
  });
}

// ------------------------------------------------------------------------------ the walk

function readTheme(dir) {
  const files = {};
  for (const d of THEME_DIRS) {
    const full = join(dir, d);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full, { recursive: true })) {
      const p = join(full, String(f));
      if (!statSync(p).isFile() || !/\.(liquid|json)$/.test(p)) continue;
      files[relative(dir, p)] = readFileSync(p, "utf8");
    }
  }
  return files;
}

function readScripts(dir) {
  const full = join(dir, "assets");
  if (!existsSync(full)) return "";
  return readdirSync(full).filter((f) => /\.js$/.test(f)).map((f) => readFileSync(join(full, f), "utf8")).join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let UNLOCK = "";
async function get(url, cookie = "", tries = 4) {
  cookie = [UNLOCK, cookie].filter(Boolean).join("; ");
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Devote carryover walk)", ...(cookie ? { cookie } : {}) } }).catch(() => null);
    if (r && r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!r || !r.ok) return null;
    // Landed on the storefront password page: not the page that was asked for, so not checked.
    if (onPasswordPage(r.url)) return null;
    return r.text();
  }
  return null;
}
// Shopify answers ?preview_theme_id with a redirect that sets a cookie, then serves the live theme
// to any request without it. A preview page only counts once it is proved to be that theme.
async function previewSession(base, theme) {
  const first = await fetch(`${base}/?preview_theme_id=${theme}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Devote carryover walk)", ...(UNLOCK ? { cookie: UNLOCK } : {}) } }).catch(() => null);
  const cookie = (first?.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const themeOf = (html) => (html.match(/"themeId":"?(\d+)|\btheme_id:\s*(\d+)|Shopify\.theme\s*=\s*\{[^}]*"id":(\d+)/) || []).slice(1).find(Boolean);
  return async (path) => {
    const u = new URL(path, base); u.searchParams.set("preview_theme_id", theme);
    const html = await get(u.toString(), cookie);
    return html && (!themeOf(html) || themeOf(html) === String(theme)) ? html : null;
  };
}

function target() {
  let script = "";
  try { script = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))?.scripts?.deploy ?? ""; } catch {}
  const flag = (n) => { const m = script.match(new RegExp(`--${n}[ =](\\S+)`)); return m && !/FILL-IN/.test(m[1]) ? m[1] : null; };
  return { store: flag("store"), theme: flag("theme"), domain: (flag("domain") || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || null };
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const t = target();
  const store = arg("--store") || process.env.SHOPIFY_STORE || t.store;
  const preview = arg("--theme") || process.env.THEME_ID || t.theme;
  const domain = (arg("--domain") || process.env.SHOP_DOMAIN || t.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!store || !preview || !domain) { console.log("NOT CHECKED: package.json's deploy script needs --store, --theme and --domain."); process.exit(1); }
  const shopify = (args) => execFileSync("shopify", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

  // 1. The before theme: the live one unless --from names another.
  let before = arg("--from");
  if (!before) {
    try { before = String(JSON.parse(shopify(["theme", "list", "--store", store, "--role", "live", "--json"]))[0]?.id || ""); }
    catch (e) { console.log(`NOT CHECKED: could not read which theme is live on ${store} (${String(e.message).split("\n")[0]}).`); process.exit(1); }
  }
  if (!before) { console.log(`NOT CHECKED: Shopify listed no live theme on ${store}.`); process.exit(1); }
  if (before === String(preview)) { console.log("The preview is the before theme itself; nothing to compare."); process.exit(0); }
  const cache = join(tmpdir(), "devote-carryover", `${store}-${before}`);
  const fresh = process.argv.includes("--fresh") || !existsSync(join(cache, ".pulled")) || Date.now() - statSync(join(cache, ".pulled")).mtimeMs > 6 * 3600e3;
  if (fresh) {
    rmSync(cache, { recursive: true, force: true }); mkdirSync(cache, { recursive: true });
    console.log(`Pulling theme ${before} from ${store} (the before theme)...`);
    try { shopify(["theme", "pull", "--store", store, "--theme", before, "--path", cache, "--only", "layout/*", "--only", "sections/*", "--only", "snippets/*", "--only", "blocks/*", "--only", "templates/*", "--only", "templates/customers/*", "--only", "config/settings_data.json", "--only", "assets/*.js", "--only", "assets/*.liquid"]); }
    catch (e) { console.log(`NOT CHECKED: could not pull theme ${before} (${String(e.message).split("\n")[0]}).`); process.exit(1); }
    writeFileSync(join(cache, ".pulled"), new Date().toISOString());
  }
  const beforeFiles = readTheme(cache);
  if (!Object.keys(beforeFiles).length) { console.log(`NOT CHECKED: theme ${before} pulled empty.`); process.exit(1); }
  const afterFiles = readTheme(ROOT);
  const found = themeSignals(beforeFiles);

  // 2. The catalogue, to count products per tag, type and vendor and to pick a sample.
  // Before launch the real domain still serves the old site, so deploy points this at the
  // myshopify.com address and hands over the storefront password's cookie (PREVIEW_COOKIE).
  const base = process.env.CARRYOVER_BASE || `https://${domain}`;
  UNLOCK = process.env.PREVIEW_COOKIE || "";
  const products = [];
  let capped = false, catalogueOk = true;
  for (let page = 1; page <= 40; page++) {
    const body = await get(`${base}/products.json?limit=250&page=${page}`);
    if (body == null) { catalogueOk = page > 1; break; }
    let list = [];
    try { list = JSON.parse(body).products || []; } catch { catalogueOk = false; break; }
    products.push(...list);
    if (list.length < 250) break;
    if (page === 40) capped = true;
    await sleep(300);
  }
  // Which alternate templates anything is assigned to, from the Admin API. Unreadable (no
  // `shopify store auth` on this store) leaves them uncounted, never "unused".
  let usage = {};
  for (const [field, type] of [["products", "product"], ["collections", "collection"], ["pages", "page"], ["blogs", "blog"], ["articles", "article"]]) {
    let after = null;
    for (let i = 0; i < 60 && usage; i++) {
      const q = `{ ${field}(first: 250${after ? `, after: ${JSON.stringify(after)}` : ""}) { pageInfo { hasNextPage endCursor } nodes { templateSuffix } } }`;
      let data = null;
      try { const out = shopify(["store", "execute", "--store", store, "--query", q]); data = JSON.parse(out.slice(out.indexOf("{")))[field] || JSON.parse(out.slice(out.indexOf("{"))).data?.[field]; } catch { data = null; }
      if (!data) { usage = null; break; }
      for (const n of data.nodes) if (n.templateSuffix) usage[`${type}.${n.templateSuffix}`] = (usage[`${type}.${n.templateSuffix}`] || 0) + 1;
      if (!data.pageInfo.hasNextPage) break;
      after = data.pageInfo.endCursor;
    }
    if (!usage) break;
  }
  if (!usage) console.log(`NOTE  could not read which templates products and pages use (run: shopify store auth --store ${store} --scopes read_products,read_content), so no alternate template can be shown as unused`);
  const beforeCode = Object.values(beforeFiles).join("\n") + "\n" + readScripts(cache);
  const counts = (id) => kindOf(id) === "template" ? templateCount(id, usage, beforeCode) : (!catalogueOk || capped ? null : productCount(id, products));

  // 3. Product pages, before and preview.
  const beforePage = arg("--from") ? await previewSession(base, before) : (path) => get(base + path);
  const afterPage = await previewSession(base, preview);
  const afterHome = (await afterPage("/")) || "";
  const sample = sampleProducts(products, found);
  const pages = [], notChecked = [];
  for (const p of sample) {
    const [b, a] = [await beforePage(`/products/${p.handle}`), await afterPage(`/products/${p.handle}`)];
    await sleep(250);
    if (!b || !a) { notChecked.push(`/products/${p.handle}`); continue; }
    pages.push({ handle: p.handle, before: phrases(b), after: phrases(a) });
  }
  const text = conditionalTextIssues(pages, dataPhrases(products), products.map((p) => norm(p.title || "")));
  const textWhere = Object.fromEntries(Object.entries(text.issues).map(([id, g]) => [id, [
    ...(g.lines > 1 ? [`one block of ${g.lines} lines that show and hide together`] : []),
    ...g.lost.slice(0, 3).map((h) => `/products/${h}`),
  ]]));

  // 4. Verdicts.
  let handled = {};
  const ackFile = join(ROOT, "design", "carryover.json");
  if (existsSync(ackFile)) {
    try { handled = JSON.parse(readFileSync(ackFile, "utf8")).handled || {}; }
    catch { console.log("FAIL  design/carryover.json is not valid JSON, so nothing in it counts."); process.exit(1); }
  }
  for (const [id, note] of Object.entries(handled)) {
    if (genericNote(note)) { console.log(`FAIL  design/carryover.json: the note for ${id} ("${note}") does not say what the new build does instead, or who agreed to drop it and why.`); delete handled[id]; }
  }
  const all = { ...found, ...textWhere };
  const results = verdicts(all, {
    present: (id) => (kindOf(id) === "text" ? false : stillPresent(id, afterFiles, { html: afterHome })),
    counts, handled,
  });

  const missing = results.filter((r) => r.state === "missing");
  for (const r of missing) {
    const n = r.count == null ? "" : kindOf(r.id) === "template" ? ` (${r.count} assigned to it)` : ` (${r.count} product${r.count === 1 ? "" : "s"})`;
    console.log(`FAIL  the before theme uses ${describe(r.id)}${n} and the new build does not:\n        ${r.where.join("\n        ")}`);
  }
  for (const p of notChecked) console.log(`NOT CHECKED  ${p}: could not fetch it on the before theme or the preview`);
  if (!catalogueOk) console.log("NOT CHECKED  the product catalogue (/products.json), so tags, types and vendors could not be counted or sampled");
  if (capped) console.log("NOTE  the catalogue has more than 10,000 products; counts are not shown and the sample is from the first 10,000");
  for (const ph of text.constant.slice(0, 15)) console.log(`WARN  every sampled product page says "${ph}" on the before theme and none does on the preview. Fine if the design dropped it on purpose; say so in the handover.`);

  // 5. The report a person reads: what the old theme did and where each thing went.
  const label = { kept: "Kept", handled: "Handled differently", unused: "Not used by any product today", missing: "MISSING from the new build" };
  const lines = [
    "# What the Before Theme Does",
    "",
    `Written by \`npm run carryover\` on ${new Date().toISOString().slice(0, 10)}: theme ${before} on ${store} against this repo and preview theme ${preview}.`,
    `${pages.length} product pages compared${notChecked.length ? `, ${notChecked.length} could not be fetched` : ""}. Commit this file. Fix anything missing, or record what the new build does instead in design/carryover.json.`,
    "",
  ];
  for (const state of ["missing", "handled", "unused", "kept"]) {
    const rows = results.filter((r) => r.state === state);
    if (!rows.length) continue;
    lines.push(`## ${label[state]} (${rows.length})`, "");
    for (const r of rows) lines.push(`- ${describe(r.id)}${r.note ? `: ${r.note}` : ""}${r.count != null ? ` (${r.count} ${kindOf(r.id) === "template" ? "assigned" : "products"})` : ""}`, ...r.where.map((w) => `  - \`${w}\``));
    lines.push("");
  }
  if (text.constant.length) { lines.push("## Text on Every Product Page Before, None on the Preview", "", ...text.constant.map((p) => `- "${p}"`), ""); }
  mkdirSync(join(ROOT, "design"), { recursive: true });
  writeFileSync(join(ROOT, "design", "carryover-report.md"), lines.join("\n"));

  const n = (s) => results.filter((r) => r.state === s).length;
  console.log(`Carry-over: ${results.length} things the before theme does, ${n("kept")} kept, ${n("handled")} handled differently, ${n("unused")} unused, ${missing.length} missing, ${notChecked.length + (catalogueOk ? 0 : 1)} not checked. Report: design/carryover-report.md`);
  if (missing.length || notChecked.length || !catalogueOk) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
