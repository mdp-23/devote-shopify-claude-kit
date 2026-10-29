// Walk: every form on the live site is still on the preview, sending to the same place.
//
// Exists because one rebuild (28 Oct 2026) swapped two marketing forms for theme forms that looked
// the same and sent nowhere useful: an application form built in the email platform became a
// Shopify contact form that only emailed the store, and the footer sign-up stopped adding people
// to the newsletter list, so the welcome flow stopped. Nothing failed and the pages looked right.
// The client's team noticed a day after launch. A form is judged by where its entries go, not by
// how it looks, so this walk compares destinations, page by page, live against preview.
//
//   LIVE_URL='https://<domain>/' PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run forms
//
// Run by npm run deploy after every push. Pages: the homepage, every page in the live sitemap,
// and the first product and collection the homepage links to (FORMS_PAGES, comma-separated
// paths, adds more). FAIL exits 1. A page that could not be fetched is NOT CHECKED and also
// exits 1: it is never a pass.
//
// A form counts as the same when the preview carries the same destination: the same embedded
// form id (Klaviyo and other form apps), the same third-party form host, the same Shopify form
// type, or the same external form action. A form rebuilt in the theme that posts to the old
// destination declares it with data-replaces-form="<signature>" (for example
// data-replaces-form="klaviyo:AbC123"), and only after it was checked to land in the same list
// or inbox. See "Forms keep their destination" in DEVOTE-KIT.md.
import { pathToFileURL } from "node:url";

// ------------------------------------------------------------------------------ pure functions

// Hosts that only serve forms. An iframe, script or form action on one of these is a form.
export const FORM_HOSTS = [
  "typeform.com", "jotform.com", "jotfor.ms", "hsforms.com", "hsforms.net", "hs-scripts.com",
  "docs.google.com/forms", "forms.gle", "list-manage.com", "tally.so", "formstack.com",
  "wufoo.com", "cognitoforms.com", "paperform.co", "fillout.com", "formspree.io", "usebasin.com",
  "forms.zohopublic.com", "airtable.com/embed", "getform.io", "123formbuilder.com",
];
// Onsite scripts that draw sign-up forms and pop-ups. If the live site loads one and the preview
// does not, every pop-up and embedded form from that app disappears with it.
export const FORM_APP_SCRIPTS = {
  "static.klaviyo.com/onsite": "Klaviyo onsite (pop-ups and embedded forms)",
  "privy.com": "Privy", "omnisend.com": "Omnisend", "justuno.com": "Justuno",
  "attn.tv": "Attentive", "postscript.io": "Postscript", "hsforms": "HubSpot forms",
};
// Shopify form types that are theme chrome, present on every theme in some shape.
const CHROME_FORM_TYPES = new Set(["product", "localization", "cart", "currency"]);

const attrs = (tag, name) => [...tag.matchAll(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "gi"))].map((m) => m[2] ?? m[3]);
const hostPath = (url) => { try { const u = new URL(url, "https://x.invalid"); return u.hostname === "x.invalid" ? null : (u.hostname + u.pathname).replace(/\/+$/, ""); } catch { return null; } };
const formHost = (url) => { const hp = hostPath(url); return hp && FORM_HOSTS.find((h) => hp.includes(h)); };

// Every destination a page's forms send to, as stable strings.
export function formSignatures(html, { siteHost } = {}) {
  const out = new Set();
  for (const m of html.matchAll(/\bklaviyo-form-([A-Za-z0-9]{6})\b/g)) out.add(`klaviyo:${m[1]}`);
  for (const m of html.matchAll(/\bdata-replaces-form\s*=\s*["']([^"']+)["']/gi))
    for (const s of m[1].split(/[\s,]+/).filter(Boolean)) out.add(s.replace(/^klaviyo-form-/, "klaviyo:"));
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (attrs(tag, "name")[0] !== "form_type") continue;
    const v = attrs(tag, "value")[0];
    if (v && !CHROME_FORM_TYPES.has(v)) out.add(`shopify:${v}`);
  }
  for (const m of html.matchAll(/<(iframe|script|form)\b[^>]*>/gi)) {
    for (const url of [...attrs(m[0], "src"), ...attrs(m[0], "action")]) {
      const h = formHost(url);
      if (h) { out.add(`embed:${hostPath(url)}`); continue; }
      // A form posting off-site to somewhere that is not a known form host still has a destination.
      if (m[1].toLowerCase() === "form" && /^https?:/i.test(url)) {
        const hp = hostPath(url);
        if (hp && siteHost && !hp.startsWith(siteHost) && !hp.includes("myshopify.com")) out.add(`action:${hp}`);
      }
    }
  }
  return [...out].sort();
}

export function formAppScripts(html) {
  return Object.entries(FORM_APP_SCRIPTS).filter(([needle]) => html.includes(needle)).map(([, label]) => label).sort();
}

// What the preview lost on one page. Extra forms on the preview are not a defect.
export function formIssues(path, live, preview) {
  const missing = live.signatures.filter((s) => !preview.signatures.includes(s));
  const out = missing.map((s) => ({ level: "FAIL", check: "form", msg: `${path}: the live site has ${describe(s)} here and the preview does not. Put it back, or rebuild it to post to the same place and mark it data-replaces-form="${s}".` }));
  for (const app of live.apps.filter((a) => !preview.apps.includes(a)))
    out.push({ level: "FAIL", check: "form app", msg: `${path}: ${app} loads on the live site but not on the preview, so its pop-ups and forms will not show. Turn its app embed on in the preview theme.` });
  return out;
}

export function describe(sig) {
  const [kind, rest] = [sig.slice(0, sig.indexOf(":")), sig.slice(sig.indexOf(":") + 1)];
  if (kind === "klaviyo") return `Klaviyo form ${rest}`;
  if (kind === "shopify") return `a Shopify ${rest} form`;
  if (kind === "embed") return `a form from ${rest}`;
  if (kind === "action") return `a form posting to ${rest}`;
  return sig;
}

export function pagesFromSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

// ------------------------------------------------------------------------------ the walk

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, cookie = "", tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Devote forms walk)", ...(cookie ? { cookie } : {}) } }).catch(() => null);
    if (r && r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!r || !r.ok) return null;
    return r.text();
  }
  return null;
}

async function main() {
  const LIVE = process.env.LIVE_URL, PREVIEW = process.env.PREVIEW_URL;
  if (!LIVE || !PREVIEW) { console.log("Set LIVE_URL and PREVIEW_URL (see the top of scripts/qa/forms-walk.mjs)."); process.exit(1); }
  const base = new URL(LIVE).origin, siteHost = new URL(LIVE).hostname;
  // Shopify answers ?preview_theme_id with a redirect that sets a cookie, then serves the live
  // theme to any request without it. Every preview page is fetched with that cookie, and a page
  // is only compared once the preview is proved to be a different theme from the live one.
  const first = await fetch(PREVIEW, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Devote forms walk)" } }).catch(() => null);
  const cookie = (first?.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const theme = new URL(PREVIEW).searchParams.get("preview_theme_id");
  const themeOf = (html) => (html.match(/"themeId":"(\d+)"|\btheme_id:\s*(\d+)/) || []).slice(1).find(Boolean);
  const previewOf = (path) => { const u = new URL(path, base); u.searchParams.set("preview_theme_id", theme); return u.toString(); };

  const home = await get(base + "/");
  if (!home) { console.log(`NOT CHECKED: could not fetch ${base}/`); process.exit(1); }
  const paths = new Set(["/"]);
  const index = await get(base + "/sitemap.xml");
  for (const sm of pagesFromSitemap(index || "").filter((u) => /sitemap_pages/.test(u))) {
    for (const u of pagesFromSitemap((await get(sm)) || "")) paths.add(new URL(u).pathname);
  }
  for (const re of [/href="(\/(?:collections\/[^/"?#]+\/)?products\/[^"?#]+)"/, /href="(\/collections\/[^/"?#]+)"/]) {
    const m = home.match(re); if (m) paths.add(m[1]);
  }
  for (const p of (process.env.FORMS_PAGES || "").split(",").map((s) => s.trim()).filter(Boolean)) paths.add(p);

  const issues = [], notChecked = [];
  let withForms = 0;
  for (const path of paths) {
    const [lh, ph] = [await get(new URL(path, base).toString()), await get(previewOf(path), cookie)];
    await sleep(300);
    if (!lh || !ph || (themeOf(ph) && themeOf(ph) !== theme)) { notChecked.push(path); continue; }
    const live = { signatures: formSignatures(lh, { siteHost }), apps: formAppScripts(lh) };
    const preview = { signatures: formSignatures(ph, { siteHost }), apps: formAppScripts(ph) };
    if (live.signatures.length) withForms++;
    issues.push(...formIssues(path, live, preview));
  }
  for (const i of issues) console.log(`${i.level}  ${i.msg}`);
  for (const p of notChecked) console.log(`NOT CHECKED  ${p}: could not fetch it on the live site or the preview`);
  console.log(`Forms: ${paths.size} pages compared, ${withForms} with forms on the live site, ${issues.length} problems, ${notChecked.length} not checked.`);
  if (issues.length || notChecked.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
