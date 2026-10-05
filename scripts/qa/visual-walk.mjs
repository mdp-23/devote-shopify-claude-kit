// Walk: every page at four widths, compared pixel by pixel with the last screenshots someone
// looked at and approved. Any change, wanted or not, is listed with where it is on the page and a
// picture that marks it in red. Nothing changes the look of the site without someone seeing it.
//
// Exists because on one build a menu chevron rose 12px on every page after an accessibility fix,
// and a screenshot showing it was taken and not seen: it was taken to check something else. A
// reviewer looks where they expect a change; this looks everywhere. (The client saw it first.)
//
//   PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run visual
//   npm run visual -- --approve        after opening every marked picture and confirming each change was meant
//
// Pages: design/seo-pages.json, or VISUAL_PAGES. Widths: 390, 768, 1024, 1440.
// Approved screenshots live in design/visual-baseline/ (not committed: a machine with none says
// NO BASELINE and fails until someone has looked at every page and approved). Current shots and
// the marked pictures go to parity/visual/.
// design/visual.json settles what changes between two loads of the same code:
//   "mask": ["selector"]                      blanked on every page (rotating announcements, live widgets)
//   "maskOn": { "/search": ["selector"] }     blanked on pages whose path starts with the key
//                                             (search results tie-break in no fixed order)
//   "ready": { "[data-slot]": ".is-loaded" }  if the page has the first, wait for the second
//                                             (a section fetched into the page after load);
//                                             if it never comes, that page is NOT CHECKED
//   "skip": ["/search"]                       pages left out, with the reason in the brand's notes
//                                             (search results tie-break in no fixed order, so
//                                             even the grid's height changes between loads)
// VISUAL_TRY_CSS='<css>' adds CSS to every page before the shot, to prove the walk catches a change
// (plant the bug, watch it fail, take it away) without deploying a broken theme.
// A page that could not be loaded is NOT CHECKED and exits 1: it is never a pass.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WIDTHS = [390, 768, 1024, 1440];
const BASE = join(ROOT, "design", "visual-baseline");
const OUT = join(ROOT, "parity", "visual");
const MAX_HEIGHT = 20000;

// ------------------------------------------------------------------------------ pure functions

export function slug(path, width) {
  const s = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "home";
  return `${s}@${width}`;
}

// Rows that hold changed pixels, grouped into bands so a report says where on the page to look.
// A band ends after `gap` clean rows. Bands with fewer than `minPixels` changed pixels are noise;
// three chevrons lifted 12px are about 100.
export function bands(rowCounts, { gap = 40, minPixels = 30 } = {}) {
  const out = [];
  let cur = null, clean = 0;
  rowCounts.forEach((n, y) => {
    if (n > 0) {
      if (!cur) cur = { top: y, bottom: y, pixels: 0 };
      cur.bottom = y; cur.pixels += n; clean = 0;
    } else if (cur && ++clean > gap) { out.push(cur); cur = null; clean = 0; }
  });
  if (cur) out.push(cur);
  return out.filter((b) => b.pixels >= minPixels);
}

// ----------------------------------------------------------------------------------- the walk

function config() {
  const file = join(ROOT, "design", "visual.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function pagesToCheck() {
  if (process.env.VISUAL_PAGES) return process.env.VISUAL_PAGES.split(",").map((s) => s.trim()).filter(Boolean);
  const file = join(ROOT, "design", "seo-pages.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).pages : ["/"];
}

function withPreview(path, base) {
  const u = new URL(path, base.origin);
  for (const [k, v] of base.searchParams) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  u.searchParams.set("pb", "0");
  return u.toString();
}

// Runs in the page: freeze everything that moves, load everything lazy, scroll the page's own
// scroller to the end and back so scroll-triggered loading runs, then unroll it for one tall shot.
// The scroll happens before the unroll so a sticky header sees the page return to the top.
async function settle(masks, tryCss) {
  const st = document.createElement("style");
  st.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; content-visibility: visible !important; }
    ${masks.length ? `${masks.join(", ")} { visibility: hidden !important; }` : ""}
    ${tryCss || ""}`;
  document.head.appendChild(st);
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = "eager"; });
  const scrollers = [document.querySelector(".page-wrapper"), document.scrollingElement].filter((e) => e && e.scrollHeight > e.clientHeight + 4);
  const sc = scrollers[0] || document.scrollingElement;
  const step = innerHeight * 0.8;
  for (let y = 0; y < sc.scrollHeight; y += step) { sc.scrollTop = y; await new Promise((r) => setTimeout(r, 120)); }
  sc.scrollTop = 0;
  // a sticky header or sticky buy bar settles on the last scroll it saw: nudge, return, let it settle
  await new Promise((r) => setTimeout(r, 300));
  sc.scrollTop = 2; await new Promise((r) => setTimeout(r, 150));
  sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 700));
  const unroll = document.createElement("style");
  unroll.textContent = "html, body, .page-wrapper { height: auto !important; max-height: none !important; overflow: visible !important; }";
  document.head.appendChild(unroll);
  await document.fonts.ready;
}

// Runs in the page: every image loaded and decoded, or 10 seconds, whichever comes first.
async function imagesDone() {
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = "eager"; });
  await Promise.race([
    Promise.all([...document.images].map((i) => (i.complete ? (i.decode ? i.decode().catch(() => {}) : null) : new Promise((r) => { i.onload = i.onerror = r; })))),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
  await new Promise((r) => setTimeout(r, 300));
}

// Runs in the page, last thing before the shot: Horizon's header takes its top-of-page look only
// after an upward scroll that ends at the top, and a second scroll event at the top (no movement)
// switches it back to its scrolled look. Never fire a synthetic scroll; if the header is not in
// its top-of-page state, scroll down a little and back up, and check again.
async function headerAtTop() {
  const sc = [document.querySelector(".page-wrapper"), document.scrollingElement].find((e) => e && e.scrollTop > 0) || document.scrollingElement;
  for (let t = 0; t < 4; t++) {
    const h = document.querySelector("[data-sticky-state]");
    if (!h || h.dataset.stickyState === "inactive") return;
    sc.scrollTop = 80; await new Promise((r) => setTimeout(r, 300));
    sc.scrollTop = 0; await new Promise((r) => setTimeout(r, 600));
  }
  // then hold it there until the shot: a late scroll event from the unroll could flip it, and every
  // page is shot as a visitor first sees it, at the top
  const h = document.querySelector("[data-sticky-state]");
  if (h) {
    h.dataset.stickyState = "inactive";
    new MutationObserver(() => { if (h.dataset.stickyState !== "inactive") h.dataset.stickyState = "inactive"; })
      .observe(h, { attributes: true, attributeFilter: ["data-sticky-state"] });
  }
}

async function main() {
  const approve = process.argv.includes("--approve");
  const RAW = process.env.PREVIEW_URL || process.argv.find((a) => a.startsWith("http"));
  if (!RAW) { console.log("Nothing checked. Give it the preview URL:\n  PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run visual"); process.exit(1); }
  let puppeteer, Launcher, PNG, pixelmatch;
  try {
    puppeteer = (await import("puppeteer-core")).default;
    ({ Launcher } = await import("chrome-launcher"));
    ({ PNG } = await import("pngjs"));
    pixelmatch = (await import("pixelmatch")).default;
  } catch {
    console.log("NOT CHECKED: run npm i -D puppeteer-core chrome-launcher pngjs pixelmatch");
    process.exit(1);
  }
  const chrome = Launcher.getInstallations()[0];
  if (!chrome) { console.log("NOT CHECKED: no Chrome found on this machine."); process.exit(1); }
  mkdirSync(BASE, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const base = new URL(RAW);
  const cfg = config();
  const masks = cfg.mask || [];
  if (approve && process.env.VISUAL_TRY_CSS) { console.log("refusing to approve with VISUAL_TRY_CSS set"); process.exit(1); }
  // Four browsers with one tab each, never four tabs in one browser: headless Chrome renders only
  // the front tab, so scroll-triggered loading (IntersectionObserver) never runs in the others and
  // the walk reports changes the site does not have.
  const browsers = await Promise.all(Array.from({ length: 4 }, () => puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 120000 })));
  let changed = 0, missing = 0, unchecked = 0;
  const skip = cfg.skip || [];
  const jobs = pagesToCheck().filter((p) => !skip.some((k) => p.startsWith(k))).flatMap((path) => WIDTHS.map((w) => ({ path, w })));
  if (skip.length) console.log(`left out by design/visual.json: ${skip.join(", ")}`);
  const lines = new Array(jobs.length);
  async function one({ path, w }, browser) {
    const name = slug(path, w);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      // Infinite scroll would add a second page of results while the walk scrolls, so a later
      // page of a list is never fetched: the same first page is compared every time.
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (["xhr", "fetch"].includes(r.resourceType()) && +u.searchParams.get("page") > 1) r.abort(); else r.continue();
      });
      const res = await page.goto(withPreview(path, base), { waitUntil: "load", timeout: 90000 }).catch((e) => ({ error: e.message }));
      if (res?.error || (res?.status && res.status() >= 400)) { unchecked++; return `NOT CHECKED ${path} at ${w}px: ${res.error || res.status()}`; }
      // the pointer starts at the top-left corner, over the header; a transparent header hovered
      // turns solid, so park it off the page
      await page.mouse.move(-10, -10).catch(() => {});
      const pageMasks = [...masks, ...Object.entries(cfg.maskOn || {}).filter(([k]) => path.startsWith(k)).flatMap(([, v]) => v)];
      await page.evaluate(settle, pageMasks, process.env.VISUAL_TRY_CSS || "");
      for (const [has, wait] of Object.entries(cfg.ready || {})) {
        if (!(await page.$(has))) continue;
        const ok = await page.waitForSelector(wait, { timeout: 30000 }).then(() => true, () => false);
        if (!ok) { unchecked++; return `NOT CHECKED ${path} at ${w}px: ${wait} never appeared, so the page was not finished loading`; }
      }
      // Rows and sections fetched after load (recommendations, an embedded quiz) arrive late. Some
      // pages never go fully quiet (video players, review widgets), so the wait is short and capped.
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 8000 }).catch(() => {});
      await page.evaluate(imagesDone);
      await page.evaluate(headerAtTop);
      const h = Math.min(MAX_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight));
      // where the photos are: a photo fetched at another size resamples a little differently on
      // every load, so photo areas are compared loosely and everything else (icons, text, layout) strictly
      const photos = await page.evaluate(() => [...document.querySelectorAll("img, video, picture")].map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 24 && r.height > 24).map((r) => [Math.floor(r.left + scrollX), Math.floor(r.top + scrollY), Math.ceil(r.right + scrollX), Math.ceil(r.bottom + scrollY)]));
      const cur = join(OUT, `${name}.png`);
      await page.screenshot({ path: cur, clip: { x: 0, y: 0, width: w, height: h }, captureBeyondViewport: true });
      const ref = join(BASE, `${name}.png`);
      if (approve) { copyFileSync(cur, ref); return `approved ${path} at ${w}px`; }
      if (!existsSync(ref)) { missing++; return `NO BASELINE ${path} at ${w}px: look at parity/visual/${name}.png, then npm run visual -- --approve`; }
      const a = PNG.sync.read(readFileSync(ref)), b = PNG.sync.read(readFileSync(cur));
      const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
      const crop = (img) => { if (img.width === W && img.height === H) return img.data; const o = new PNG({ width: W, height: H }); PNG.bitblt(img, o, 0, 0, W, H, 0, 0); return o.data; };
      const diff = new PNG({ width: W, height: H });
      const loose = new PNG({ width: W, height: H });
      // strict outside photos on purpose: three 11px chevrons lifted 12px change only about 100 pixels
      pixelmatch(crop(a), crop(b), diff.data, W, H, { threshold: 0.1, includeAA: false });
      pixelmatch(crop(a), crop(b), loose.data, W, H, { threshold: 0.3, includeAA: false });
      const inPhoto = new Uint8Array(W * H);
      for (const [l, t, r, btm] of photos) for (let y = Math.max(0, t); y < Math.min(H, btm); y++) inPhoto.fill(1, y * W + Math.max(0, l), y * W + Math.min(W, r));
      const red = (d, i) => d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0;
      const rows = new Array(H).fill(0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = y * W + x, i = k * 4;
        if (inPhoto[k] ? red(loose.data, i) : red(diff.data, i)) rows[y]++;
        else if (inPhoto[k] && red(diff.data, i)) { diff.data[i] = 255; diff.data[i + 1] = 200; diff.data[i + 2] = 200; } // resampling only: pale, not counted
      }
      const found = bands(rows);
      const grew = b.height - a.height;
      if (!found.length && Math.abs(grew) <= 2) return `same ${path} at ${w}px`;
      changed++;
      writeFileSync(join(OUT, `${name}.diff.png`), PNG.sync.write(diff));
      const where = found.slice(0, 6).map((x) => `y ${x.top}-${x.bottom}`).join(", ");
      return `CHANGED ${path} at ${w}px: ${found.length} area${found.length === 1 ? "" : "s"}${where ? ` (${where})` : ""}${grew ? `, page ${grew > 0 ? "taller" : "shorter"} by ${Math.abs(grew)}px` : ""}\n        look: parity/visual/${name}.diff.png (red = changed) beside parity/visual/${name}.png`;
    } catch (e) {
      unchecked++; return `NOT CHECKED ${path} at ${w}px: ${e.message}`;
    } finally { await page.close().catch(() => {}); }
  }
  try {
    // four browsers at once: one page's four widths load together
    let next = 0;
    await Promise.all(browsers.map(async (browser) => {
      while (next < jobs.length) { const i = next++; lines[i] = await one(jobs[i], browser); console.log(lines[i]); }
    }));
  } finally { await Promise.all(browsers.map((b) => b.close())); }
  if (approve) { console.log("\nApproved. These are now what the next run compares against."); process.exit(unchecked ? 1 : 0); }
  console.log(`\n${changed} CHANGED, ${missing} with no baseline, ${unchecked} not checked. Open every marked picture: approve only when each change was meant (npm run visual -- --approve).`);
  process.exit(changed || missing || unchecked ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
