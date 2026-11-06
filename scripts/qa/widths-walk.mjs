// Walk: at every width from a phone to a wide desktop, every button label fits on one line with its
// spaces, every dropdown chevron sits level with its label, and the header menu stays clear of the
// search, account and cart icons, and no picture is drawn at a different shape from its file.
//
// Exists because the other walks measure 390px and 1440px only, and on one build every one of
// these reached the client between those widths: a button squeezed onto two lines at a 1000px
// laptop, the header menu running under the icons from 768px to 1180px after its "More" overflow
// broke, chevrons lifted 12px when their tap target grew, and a quiz's budget answers reading
// "AROUND$530" because flex dropped the spaces around a price.
//   PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run widths
// Pages: design/seo-pages.json, or WIDTH_PAGES. Steps of a multi-step form that start hidden are
// opened and measured if they carry data-step. A page that could not be loaded is NOT CHECKED and
// exits 1: it is never a pass.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCookies } from "./preview-session.mjs";
import { withPreview } from "./seo-walk.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WIDTHS = [390, 768, 990, 1024, 1100, 1180, 1280, 1366, 1440, 1920];
const BUTTONS = '.button, .button-secondary, [class*="btn"]:is(a, button)';

function pagesToCheck() {
  if ((process.env.WIDTH_PAGES || process.env.BUTTON_PAGES)) return (process.env.WIDTH_PAGES || process.env.BUTTON_PAGES).split(",").map((s) => s.trim()).filter(Boolean);
  const file = join(ROOT, "design", "seo-pages.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).pages : ["/"];
}

// Runs in the page: labels of visible buttons whose text runs over more than one line or out of the box.
function wrappedButtons(selector) {
  const st = document.createElement("style");
  st.textContent = "* { content-visibility: visible !important; }";
  document.head.appendChild(st);
  return [...document.querySelectorAll(selector)].filter((b) => {
    if (!b.getClientRects().length || !b.textContent.trim()) return false;
    const cs = getComputedStyle(b);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    // Only text a sighted visitor sees: a screen-reader label clipped to 1px wraps by design.
    const seen = (el) => { for (let e = el; e && e !== b.parentElement; e = e.parentElement) { const r = e.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2 || +getComputedStyle(e).opacity === 0) return false; } return true; };
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const tops = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !seen(n.parentElement)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 4) tops.add(Math.round(r.top));
    }
    return tops.size > 1 || (tops.size > 0 && b.scrollWidth > b.clientWidth + 1);
  }).map((b) => b.textContent.trim().replace(/\s+/g, " ").slice(0, 40));
}

// Runs in the page: the header menu's last visible link ends before the first header icon starts,
// and the header fits the screen. Any header: Horizon's #header-component, else the first
// <header>, else [data-header]. On one build a custom header was never checked, because this only
// knew Horizon's. Generic: the main nav's last visible link is the menu end, and visible elements
// after the nav (search, account, cart) are the icons.
export function headerClash() {
  const hdr = document.querySelector("#header-component") || document.querySelector("header") || document.querySelector("[data-header]");
  if (!hdr) return [];
  const out = [];
  // seen by a visitor: laid out, not hidden, and not inside a faded-out dropdown or overlay
  const shown = (e) => {
    if (!e.getClientRects().length || !(e.getBoundingClientRect().width > 0) || getComputedStyle(e).visibility === "hidden") return false;
    for (let x = e; x && x !== hdr.parentElement; x = x.parentElement) if (+getComputedStyle(x).opacity === 0) return false;
    return true;
  };
  let links = [...hdr.querySelectorAll(".menu-list__list-item")].filter((l) => !l.slot && shown(l));
  let icons = [...hdr.querySelectorAll(".header__column--right > *")].filter(shown);
  if (!links.length || !icons.length) {
    // the main nav: the visible one with the most links
    const navs = [...hdr.querySelectorAll("nav")].filter(shown);
    const nav = navs.sort((a, b) => b.querySelectorAll("a").length - a.querySelectorAll("a").length)[0];
    if (nav) {
      links = [...nav.querySelectorAll("a")].filter(shown);
      const after = [...hdr.querySelectorAll("*")].filter((e) => !nav.contains(e) && !e.contains(nav) && (nav.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) && shown(e));
      // the outermost of them only, so a cart button and its svg count once
      icons = after.filter((e) => !after.some((o) => o !== e && o.contains(e)));
      // an icon sits on the same row as the menu; a second header row (a search bar) is not one
      const nr = nav.getBoundingClientRect();
      icons = icons.filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > nr.top && r.top < nr.bottom; });
    }
  }
  if (links.length && icons.length) {
    const end = Math.max(...links.map((l) => l.getBoundingClientRect().right));
    const start = Math.min(...icons.map((i) => i.getBoundingClientRect().left));
    if (end > start + 1) out.push(`header menu runs ${Math.round(end - start)}px under the icons`);
  }
  for (const i of icons) if (i.getBoundingClientRect().right > document.documentElement.clientWidth + 1) { out.push("header icons run off the screen"); break; }
  // A dropdown's chevron sits level with its label. It rose 12px when its tap target grew to 24px
  // for WCAG and Horizon's translateY(-50%) came with it.
  for (const l of links) {
    const svg = l.querySelector(".menu-list__disclosure svg"), title = l.querySelector(".menu-list__link-title");
    if (!svg || !title || !svg.getClientRects().length) continue;
    const a = svg.getBoundingClientRect(), t = title.getBoundingClientRect();
    const off = Math.round((a.top + a.height / 2) - (t.top + t.height / 2));
    if (Math.abs(off) > 3) { out.push(`menu chevron sits ${Math.abs(off)}px ${off < 0 ? "above" : "below"} its label`); break; }
  }
  return out;
}

// Runs in the page: pictures drawn at a different shape from the file. On one build a header
// logo, held at a set height in a flex row with max-width: 100%, was narrowed by the row at laptop
// widths while its height stayed, so it squashed sideways. Only object-fit: fill (the default)
// stretches; cover and contain keep the shape on purpose.
export function squashedImages() {
  const out = [];
  for (const img of document.querySelectorAll("img")) {
    if (!img.getClientRects().length || !img.complete || !img.naturalWidth || !img.naturalHeight) continue;
    const cs = getComputedStyle(img);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.objectFit !== "fill") continue;
    // the content box: padding and borders are not the picture
    const w = img.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = img.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w < 24 || h < 24) continue;
    const drawn = w / h, file = img.naturalWidth / img.naturalHeight;
    if (Math.abs(drawn / file - 1) > 0.03) {
      let name = img.getAttribute("alt") || "";
      try { const u = new URL(img.currentSrc || img.src); if (/^https?:$/.test(u.protocol)) name = u.pathname.split("/").pop() || name; } catch {}
      out.push(name.slice(0, 60) || "(no name)");
    }
  }
  return out;
}

// Runs in the page: flex boxes whose words run together. Flex drops the spaces between a text run
// and an inline element (a price from the money filter prints its own <span>), so "Around $530"
// rendered as "AROUND$530". Measured on screen: a space in the source must leave a gap.
function joinedWords() {
  const st = document.createElement("style");
  st.textContent = "* { content-visibility: visible !important; }";
  document.head.appendChild(st);
  // A multi-step form shows one step at a time; open every data-step so later answers are measured too.
  document.querySelectorAll("[data-step][hidden]").forEach((q) => { q.hidden = false; });
  const box = (n) => { if (n.nodeType === 1) return n.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(n); const rs = [...r.getClientRects()]; return rs.length ? rs.at(-1) : null; };
  const firstBox = (n) => { if (n.nodeType === 1) return n.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects()[0] || null; };
  const out = [];
  for (const e of document.querySelectorAll("button, a, label")) {
    if (!e.getClientRects().length || !/flex|grid/.test(getComputedStyle(e).display)) continue;
    const kids = [...e.childNodes].filter((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.textContent.trim()));
    for (let i = 1; i < kids.length; i++) {
      const A = kids[i - 1], B = kids[i];
      // a space in the source between two pieces of a label...
      const spaced = /\s$/.test(A.textContent) || /^\s/.test(B.textContent) || (A.nextSibling !== B && A.nextSibling?.nodeType === 3 && !A.nextSibling.textContent.trim() && A.nextSibling.textContent.length);
      if (!spaced) continue;
      const ra = box(A), rb = firstBox(B);
      if (!ra || !rb || Math.abs(ra.top - rb.top) > 4) continue;
      // ...must leave a gap on screen, unless the flex gap already does
      if (rb.left - ra.right < 2 && (parseFloat(getComputedStyle(e).columnGap) || 0) < 2) { out.push(e.textContent.replace(/\s+/g, " ").trim().slice(0, 40)); break; }
    }
  }
  return out;
}

async function main() {
  const RAW = process.env.PREVIEW_URL || process.argv.find((a) => a.startsWith("http"));
  if (!RAW) { console.log("Nothing checked. Give it the preview URL:\n  PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run widths"); process.exit(1); }
  const base = new URL(RAW);
  const puppeteer = (await import("puppeteer-core")).default;
  const { Launcher } = await import("chrome-launcher");
  const chrome = Launcher.getInstallations()[0];
  if (!chrome) { console.log("NOT CHECKED: no Chrome found on this machine."); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  let fails = 0, unchecked = 0;
  try {
    for (const path of pagesToCheck()) {
      const page = await browser.newPage();
      await applyCookies(page, base.toString());
      const found = {};
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
        const res = await page.goto(withPreview(path, base), { waitUntil: "load", timeout: 90000 }).catch((e) => ({ error: e.message }));
        if (res?.error || (res && res.status && res.status() >= 400)) { unchecked++; console.log(`NOT CHECKED ${path} at ${w}px: ${res.error || res.status()}`); continue; }
        await page.evaluate(() => document.fonts.ready);
        for (const label of new Set(await page.evaluate(wrappedButtons, BUTTONS))) (found[`"${label}" wraps`] ||= []).push(w);
        for (const msg of await page.evaluate(headerClash)) (found[msg] ||= []).push(w);
        for (const label of new Set(await page.evaluate(joinedWords))) (found[`"${label}" has words run together`] ||= []).push(w);
        for (const name of new Set(await page.evaluate(squashedImages))) (found[`picture squashed: ${name}`] ||= []).push(w);
      }
      const bad = Object.entries(found);
      fails += bad.length;
      console.log(bad.length ? `FAIL ${path}\n${bad.map(([l, ws]) => `     ${l} at ${ws.join(", ")}px`).join("\n")}` : `ok   ${path}`);
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${fails} FAIL, ${unchecked} not checked (${WIDTHS.length} widths from ${WIDTHS[0]}px to ${WIDTHS.at(-1)}px).`);
  process.exit(fails || unchecked ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
