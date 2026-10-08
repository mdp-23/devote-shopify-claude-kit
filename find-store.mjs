#!/usr/bin/env node
// Find a Shopify store's .myshopify.com address from its normal website.
//
//   node find-store.mjs www.acme.com.au
//
// Prints JSON: { domain, brand, store }, or { domain, error } and exits 1.
// Reads /meta.json first (most themes serve it), then the homepage HTML, where
// Shopify writes `Shopify.shop = "<store>.myshopify.com"`. Headless stores have
// no meta.json but still carry the address in the page.

export function normaliseDomain(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    return new URL(s).hostname;
  } catch {
    return "";
  }
}

// The brand folder name: the domain's first label without www, lower case, letters, digits and hyphens.
export function brandFromDomain(domain) {
  const label = domain.replace(/^www\./, "").split(".")[0] || "";
  return label.replace(/[^a-z0-9-]/g, "");
}

export function storeFromMeta(text) {
  try {
    const d = JSON.parse(text).myshopify_domain;
    return typeof d === "string" && d.endsWith(".myshopify.com") ? d : "";
  } catch {
    return "";
  }
}

export function storeFromHtml(html) {
  const declared = html.match(/Shopify\.shop\s*=\s*["']([a-z0-9-]+\.myshopify\.com)["']/i);
  if (declared) return declared[1].toLowerCase();
  // Otherwise the address mentioned most often (apps and scripts repeat the store's own).
  const counts = {};
  for (const m of html.matchAll(/\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/gi)) {
    const k = m[1].toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : "";
}

async function get(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) devote-shopify-kit" },
    signal: AbortSignal.timeout(15000),
  });
  return { ok: res.ok, url: res.url, text: await res.text() };
}

async function main() {
  const domain = normaliseDomain(process.argv[2]);
  if (!domain) {
    console.log(JSON.stringify({ error: "Give the store's website, for example www.acme.com.au" }));
    process.exit(1);
  }
  if (domain.endsWith(".myshopify.com")) {
    console.log(JSON.stringify({ domain, brand: brandFromDomain(domain), store: domain }));
    return;
  }

  let finalDomain = domain;
  let store = "";
  let reached = false;
  try {
    const meta = await get(`https://${domain}/meta.json`);
    reached = true;
    finalDomain = new URL(meta.url).hostname;
    if (meta.ok) store = storeFromMeta(meta.text);
  } catch {}
  if (!store) {
    try {
      const home = await get(`https://${domain}/`);
      reached = true;
      finalDomain = new URL(home.url).hostname;
      store = storeFromHtml(home.text);
    } catch {}
  }

  if (!reached) {
    console.log(JSON.stringify({ domain, error: `Could not open https://${domain}. Check the address.` }));
    process.exit(1);
  }
  if (!store) {
    console.log(JSON.stringify({ domain: finalDomain, error: "The site opened but shows no Shopify store address. It may not be on Shopify." }));
    process.exit(1);
  }
  console.log(JSON.stringify({ domain: finalDomain, brand: brandFromDomain(finalDomain), store }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
