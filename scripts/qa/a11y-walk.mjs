// Walk: accessibility on the preview theme, one URL per page type, on a phone and a desktop.
//
// Exists because accessibility was checked by nobody: no guard, no walk, and a theme can pass
// every visual check while a screen reader user cannot name a button or reach the cart
// (Marcel, 2 Oct 2026: "add accessibility checks to the dev kit").
//
// Runs axe-core (Deque's engine, the one behind Lighthouse's accessibility score) against WCAG 2.2
// A and AA on each page at 390px and 1440px.
//   PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run a11y
//
// Pages: design/seo-pages.json (the same one page per type the SEO walk uses), or A11Y_PAGES.
// Critical and serious problems FAIL and exit 1. Moderate and minor ones are WARN for the report.
// Older themes arrive with problems of their own: `npm run a11y -- --write-baseline` records the
// count per page type and rule in scripts/qa/a11y-baseline.json, and after that a FAIL is only a
// count that went up. The backlog may only fall.
// A page that could not be loaded or checked is NOT CHECKED and exits 1: it is never a pass.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pageTypeOf, withPreview } from "./seo-walk.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = join(ROOT, "scripts", "qa", "a11y-baseline.json");
export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const WIDTHS = [["phone", 390, 844], ["desktop", 1440, 900]];
const BLOCKING = new Set(["critical", "serious"]);

// ------------------------------------------------------------------------------ pure functions

// Collapse axe's violations into { ruleId: { impact, nodes, help, sample } } for one page.
export function summarise(violations) {
  const out = {};
  for (const v of violations) {
    const prev = out[v.id];
    const nodes = (prev?.nodes || 0) + v.nodes.length;
    out[v.id] = { impact: v.impact || prev?.impact || "minor", nodes, help: v.help, sample: prev?.sample || v.nodes[0]?.target?.join(" ") || "" };
  }
  return out;
}

// Judge one page type's summary against its baseline ({ ruleId: count }).
// A blocking rule above its baseline is a FAIL; anything else that is present is a WARN.
export function judge(summary, baseline = {}) {
  const issues = [];
  for (const [rule, s] of Object.entries(summary)) {
    const allowed = baseline[rule] || 0;
    if (BLOCKING.has(s.impact) && s.nodes > allowed) {
      issues.push({ level: "FAIL", rule, msg: `${s.impact}: ${s.help} (${s.nodes} element${s.nodes === 1 ? "" : "s"}${allowed ? `, baseline ${allowed}` : ""}) e.g. ${s.sample}` });
    } else {
      issues.push({ level: "WARN", rule, msg: `${s.impact}: ${s.help} (${s.nodes})${allowed ? `, within baseline ${allowed}` : ""}` });
    }
  }
  return issues;
}

// Merge the phone and desktop summaries for a page: the worse count of each rule counts.
export function merge(a, b) {
  const out = { ...a };
  for (const [rule, s] of Object.entries(b)) if (!out[rule] || s.nodes > out[rule].nodes) out[rule] = s;
  return out;
}

// ----------------------------------------------------------------------------------- the walk

function pagesToCheck() {
  if (process.env.A11Y_PAGES) return process.env.A11Y_PAGES.split(",").map((s) => s.trim()).filter(Boolean);
  const file = join(ROOT, "design", "seo-pages.json");
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return cfg.pages || null;
}

async function main() {
  const RAW = process.env.PREVIEW_URL || process.argv.find((a) => a.startsWith("http"));
  if (!RAW) {
    console.log("Nothing checked. Give it the preview URL:");
    console.log("  PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run a11y");
    process.exit(1);
  }
  const base = new URL(RAW);
  const writeBaseline = process.argv.includes("--write-baseline");
  const pages = pagesToCheck();
  if (!pages) { console.log("NOT CHECKED: no pages. List one URL per page type in design/seo-pages.json."); process.exit(1); }

  let puppeteer, Launcher, axeSource;
  try {
    puppeteer = (await import("puppeteer-core")).default;
    ({ Launcher } = await import("chrome-launcher"));
    axeSource = readFileSync(createRequire(join(ROOT, "package.json")).resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    console.log("NOT CHECKED: puppeteer-core, chrome-launcher or axe-core is not installed. Run: npm i -D puppeteer-core chrome-launcher axe-core");
    process.exit(1);
  }
  const chrome = Launcher.getInstallations()[0];
  if (!chrome) { console.log("NOT CHECKED: no Chrome found on this machine."); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();

  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const notChecked = [];
  const results = {};
  for (const path of pages) {
    if (/FILL-IN/.test(path)) { notChecked.push(`${path}: fill in a real URL in design/seo-pages.json`); continue; }
    let summary = {};
    for (const [label, width, height] of WIDTHS) {
      await page.setViewport({ width, height });
      const res = await page.goto(withPreview(path, base), { waitUntil: "load", timeout: 90000 }).catch((e) => ({ error: e.message }));
      if (!res || res.error || res.status() >= 400) { notChecked.push(`${path} (${label}): ${res?.error || `returned ${res?.status?.()}`}`); summary = null; break; }
      await new Promise((ok) => setTimeout(ok, 1000)); // app widgets that render after load
      const violations = await page.evaluate(async (src, tags) => {
        // Shopify's preview bar is never served to visitors.
        document.querySelectorAll('#preview-bar-iframe, #PBarNextFrameWrapper, [id^="PBar"], iframe[src*="preview_bar"]').forEach((e) => e.remove());
        if (!window.axe) (0, eval)(src);
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
      }, axeSource, TAGS).catch((e) => ({ error: e.message }));
      if (violations.error) { notChecked.push(`${path} (${label}): axe did not run (${violations.error})`); summary = null; break; }
      summary = merge(summary, summarise(violations));
    }
    if (summary) results[path] = summary;
  }
  await browser.close();

  if (writeBaseline) {
    const out = {};
    for (const [path, s] of Object.entries(results)) {
      const t = pageTypeOf(path);
      out[t] = out[t] || {};
      for (const [rule, v] of Object.entries(s)) if (BLOCKING.has(v.impact)) out[t][rule] = Math.max(out[t][rule] || 0, v.nodes);
    }
    writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
    console.log(`Wrote ${BASELINE}. Commit it; from now on the counts may only fall.`);
  }

  let fails = 0, warns = 0;
  for (const [path, s] of Object.entries(results)) {
    const issues = judge(s, writeBaseline ? JSON.parse(readFileSync(BASELINE, "utf8"))[pageTypeOf(path)] : baseline[pageTypeOf(path)]);
    const f = issues.filter((i) => i.level === "FAIL"), w = issues.filter((i) => i.level === "WARN");
    fails += f.length; warns += w.length;
    console.log(`${f.length ? "FAIL" : "ok  "} ${path}`);
    for (const i of [...f, ...w]) console.log(`  ${i.level === "FAIL" ? "FAIL" : "warn"} ${i.rule}: ${i.msg}`);
  }
  if (notChecked.length) {
    console.log(`\nNOT CHECKED (${notChecked.length})`);
    for (const n of notChecked) console.log(`  ${n}`);
  }
  console.log(`\n${fails} FAIL, ${warns} WARN, ${notChecked.length} not checked (WCAG 2.2 AA, phone and desktop). FAILs block the handover.`);
  process.exit(fails || notChecked.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
