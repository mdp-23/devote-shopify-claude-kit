// Walk: the design and the build, side by side, section by section and state by state.
//
// Exists because on 30 Sep 2026 Marcel found, by hand, one design miss after another: the
// "Choose your material" button in the wrong place, tabs that navigated, dark menu text on the
// video, no hero video, no red cart pulse, and a Fins dropdown that looked nothing like the board.
// Every one passed theme check and the guards, because nothing ever put the build next to the
// design. This does, and the pictures it writes are the check: open every one before handover.
//
//   npm run parity                      # every state in design/parity.json
//   npm run parity -- dropdown          # only states whose name contains "dropdown"
//
// For each state it renders the design file and the preview at the same viewport, scrolls the
// named element into view, runs the state's actions (hover, click), and writes
// parity/<state>.png with the design on the left and the build on the right.
// A selector that matches nothing fails the walk: a state that cannot be shown is not a pass.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { Launcher } from "chrome-launcher";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "design/parity.json"), "utf8"));
// each page can keep its states in design/parity/<page>.json, so parallel page builds never edit one file
const extra = join(ROOT, "design/parity");
if (existsSync(extra)) for (const f of readdirSync(extra).filter((f) => f.endsWith(".json")).sort()) {
  cfg.states.push(...JSON.parse(readFileSync(join(extra, f), "utf8")).states);
}
const only = process.argv[2];
const OUT = join(ROOT, "parity");
mkdirSync(OUT, { recursive: true });

const chrome = Launcher.getInstallations()[0];
if (!chrome) {
  console.log("No Chrome found, so nothing was compared.");
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const failures = [];

async function shoot(side, s) {
  const page = await browser.newPage();
  await page.setViewport({ width: s.width, height: s.height || 900, deviceScaleFactor: 1 });
  const url = side.file ? pathToFileURL(resolve(ROOT, side.file)).href : side.url || cfg.preview;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  if (side.css) await page.addStyleTag({ content: side.css });
  // a state that needs data the preview does not have (a cart with an item) is staged by script
  if (side.script) await page.evaluate(side.script);
  const el = side.selector ? await page.$(side.selector) : null;
  if (side.selector && !el) throw new Error(`nothing matches ${side.selector}`);
  if (el) {
    // Horizon scrolls inside .page-wrapper, a plain page scrolls the document: move whichever
    // one actually scrolls until the element's top sits `offset` px below the viewport top.
    const moved = await el.evaluate(async (n, offset) => {
      // exactly one scroller: the first that can actually scroll, never two at once
      const cands = [document.querySelector(".page-wrapper"), document.scrollingElement].filter(Boolean);
      const sc = cands.find((c) => c.scrollHeight > c.clientHeight + 5 && (c === document.scrollingElement || /auto|scroll/.test(getComputedStyle(c).overflowY))) || document.scrollingElement;
      const scrollers = [sc];
      for (let i = 0; i < 8; i++) {
        const delta = n.getBoundingClientRect().top - offset;
        if (Math.abs(delta) < 2) break;
        for (const s of scrollers) s.scrollTop += delta;
        await new Promise((r) => setTimeout(r, 350));
      }
      // near the end of the page there is no room left to scroll; that is where it belongs
      const atEnd = scrollers.some((s) => Math.ceil(s.scrollTop + s.clientHeight) >= s.scrollHeight - 2);
      const off = Math.round(n.getBoundingClientRect().top - offset);
      return atEnd && off > 0 ? 0 : off;
    }, side.offset || 0);
    if (Math.abs(moved) > 40 && !side.allowOffscreen) throw new Error(`could not scroll ${side.selector} into place (${moved}px off)`);
  }
  for (const a of side.actions || []) {
    const t = await page.$(a.selector);
    if (!t) throw new Error(`action target missing: ${a.selector}`);
    if (a.do === "hover") await t.hover();
    if (a.do === "click") await t.click();
    await new Promise((r) => setTimeout(r, a.wait || 700));
  }
  await new Promise((r) => setTimeout(r, 600));
  // a state can carry measurements: a script returning a list of problems (empty means pass).
  // Spacing and alignment fail here even when nobody spots them in the picture.
  // Every state, whatever it is about: no image on screen may have collapsed to nothing. A shared
  // layout rule once squeezed a section's photo to 0px wide while the state being walked was a
  // different section, and a 0px box read as "not visible" rather than as broken.
  if (!side.file) {
    const collapsed = await page.evaluate(() => [...document.images].filter((i) => {
      if (!i.getClientRects().length || (i.getAttribute("width") && +i.getAttribute("width") < 3)) return false;
      const r = i.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return false;
      return (r.height > 20 && r.width < 3) || (r.width > 20 && r.height < 3);
    }).map((i) => (i.alt || i.currentSrc.split("/").pop().split("?")[0]).slice(0, 50)));
    if (collapsed.length) throw new Error(`image collapsed to nothing: ${collapsed.join(", ")}`);
    // Buttons side by side are one row: a secondary next to a primary is the same height.
    const pairs = await page.evaluate(() => [...document.querySelectorAll(".dv-btn2")].filter((b) => {
      if (!b.getClientRects().length) return false;
      const sib = [...b.parentElement.children].find((x) => x !== b && x.classList.contains("dv-btn") && x.getClientRects().length);
      if (!sib) return false;
      const r1 = b.getBoundingClientRect(), r2 = sib.getBoundingClientRect();
      return Math.abs(r1.top - r2.top) < 4 && Math.abs(r1.height - r2.height) > 1;
    }).map((b) => b.textContent.trim().slice(0, 30)));
    if (pairs.length) throw new Error(`button beside a primary is a different height: ${pairs.join(", ")}`);
    // A multiplied image blends with the nearest background behind it, but content-visibility,
    // contain: paint, isolation or opacity on the way up cuts it off from that background, and the
    // photo's white shows again (the product gallery's later slides, 1 Oct 2026).
    const cutOff = await page.evaluate(() => [...document.images].filter((i) => {
      if (!i.getClientRects().length || getComputedStyle(i).mixBlendMode !== "multiply") return false;
      const r = i.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.width < 20) return false;
      for (let e = i.parentElement; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") return false;
        if (cs.contentVisibility === "auto" || /paint|strict|content/.test(cs.contain) || cs.isolation === "isolate" || +cs.opacity < 1) return true;
      }
      return false;
    }).map((i) => (i.alt || i.currentSrc.split("/").pop().split("?")[0]).slice(0, 40)));
    if (cutOff.length) throw new Error(`multiplied image cut off from its background: ${cutOff.join(", ")}`);
    // A button's label is one line. "Shop Composite Medium Flex Fins" wrapped to two on phones
    // (1 Oct 2026); a label taller than its line height has wrapped.
    const wrapped = await page.evaluate(() => [...document.querySelectorAll(".dv-btn, .dv-btn2")].filter((b) => {
      if (!b.getClientRects().length) return false;
      const range = document.createRange(); range.selectNodeContents(b);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top)));
      return lines.size > 1 || b.scrollWidth > b.clientWidth + 1;
    }).map((b) => b.textContent.trim().slice(0, 40)));
    if (wrapped.length) throw new Error(`button label does not fit on one line: ${wrapped.join(", ")}`);
    // The page never scrolls sideways. Measured as an iPhone renders it, with content-visibility
    // off, because content-visibility's paint containment had been hiding cards' screen-reader
    // labels that sat outside their row, and the page swiped into white space (1 Oct 2026).
    const wide = await page.evaluate(() => {
      const st = document.createElement("style");
      st.textContent = "* { content-visibility: visible !important; }";
      document.head.appendChild(st);
      const w = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const out = w > 1 ? [...document.querySelectorAll("body *")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .filter((el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return getComputedStyle(el).position === "absolute" || getComputedStyle(el).position === "fixed"; return true; })
        .slice(0, 3).map((el) => String(el.className).trim().split(/\s+/)[0] || el.tagName) : [];
      st.remove();
      return w > 1 ? `${w}px (${out.join(", ")})` : "";
    });
    if (wide) throw new Error(`page scrolls sideways by ${wide}`);
    // A sideways row with more cards than fit has a way across on a desktop: its arrows. "Shop the
    // range" had them switched off and could not be moved with a mouse (1 Oct 2026).
    if (s.width >= 990) {
      const stranded = await page.evaluate(() => [...document.querySelectorAll(".dv-row, .dv-vrow")].filter((r) => {
        if (!r.getClientRects().length || r.closest("[hidden]")) return false;
        if (r.scrollWidth <= r.clientWidth + 2 || getComputedStyle(r).overflowX === "visible") return false;
        const sec = r.closest("[data-dv-section]") || r.parentElement;
        const arrows = sec.querySelector("[data-dv-row-next], [data-dv-vnext]");
        return !arrows || !arrows.getClientRects().length;
      }).map((r) => (r.closest("section")?.querySelector("h2")?.textContent || r.className).trim().slice(0, 40)));
      if (stranded.length) throw new Error(`sideways row overflows with no arrows: ${stranded.join(", ")}`);
    }
  }
  if (side.check) {
    // A check may be written as an expression or as a function; a function is called. It must
    // return a list: anything else fails, because a check that silently returned a function (not
    // its result) passed eight states on 1 Oct 2026 while the menu it guarded was broken.
    const problems = await page.evaluate((src) => { const v = (0, eval)(src); return typeof v === "function" ? v() : v; }, side.check);
    if (!Array.isArray(problems)) throw new Error(`check returned ${JSON.stringify(problems)}, not a list of problems`);
    if (problems.length) throw new Error(problems.join("; "));
  }
  const buf = await page.screenshot({ type: "png" });
  await page.close();
  return buf;
}

for (const s of cfg.states) {
  if (only && !s.name.includes(only)) continue;
  try {
    const [d, b] = [await shoot(s.design, s), await shoot(s.build, s)];
    const dFile = join(OUT, `.${s.name}.design.png`), bFile = join(OUT, `.${s.name}.build.png`);
    writeFileSync(dFile, d); writeFileSync(bFile, b);
    // design left, build right, a grey gutter between them
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", dFile, "-i", bFile, "-filter_complex",
      "[0]pad=iw+40:ih:0:0:color=0x888888[l];[l][1]hstack=2", join(OUT, `${s.name}.png`)]);
    rmSync(dFile); rmSync(bFile);
    console.log(`  wrote parity/${s.name}.png`);
  } catch (e) {
    failures.push(`${s.name}: ${e.message}`);
    console.log(`  FAIL  ${s.name}: ${e.message}`);
  }
}
await browser.close();
console.log(failures.length ? `\n${failures.length} state(s) could not be compared.` : "\nOpen every picture above and compare before handing over. The pictures are the check.");
process.exit(failures.length ? 1 : 0);
