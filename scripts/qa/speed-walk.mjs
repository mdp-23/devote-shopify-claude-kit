// Walk: Lighthouse on the preview theme against the live site, mobile and desktop.
//
// Exists because the kit's rule "Lighthouse against the preview, numbers in the PR" was a
// sentence, and on 30 Sep 2026 a rebuild went to Marcel with no speed numbers at all.
// PageSpeed Insights cannot stand in for this: it drops ?preview_theme_id and tests the live
// theme, so it reports the wrong site with full confidence.
//
// Needs network, Chrome and npx, so it is a walk, run by hand, not part of `npm run qa`.
//   PREVIEW_URL=... LIVE_URL=... npm run speed        # RUNS=3 by default
//
// Prints the median of RUNS for each page and form factor. Exits 1 when the preview is slower
// than live on score or LCP, so a worse result is the report, not a footnote. A run that
// produces no result fails loudly; it is never counted as a pass.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREVIEW_RAW = process.env.PREVIEW_URL || process.argv[2];
// Shopify's preview bar (about 370 KB, and it sometimes starts before the first paint) is never
// served to real visitors, so it is hidden with pb=0; the preview redirect still costs ~800 ms
// that a published theme will not (1 Oct 2026).
const PREVIEW = PREVIEW_RAW && !/[?&]pb=0/.test(PREVIEW_RAW) ? PREVIEW_RAW + (PREVIEW_RAW.includes("?") ? "&" : "?") + "pb=0" : PREVIEW_RAW;
const LIVE = process.env.LIVE_URL || process.argv[3];
if (!PREVIEW || !LIVE) {
  console.log("Nothing measured. Give it the preview and the live URL:");
  console.log("  PREVIEW_URL='https://<store>.myshopify.com/?preview_theme_id=<id>' LIVE_URL='https://<domain>/' npm run speed");
  process.exit(1);
}
// Devote's benchmark: mobile performance must sit above 80 (Marcel, 30 Sep 2026).
const MOBILE_FLOOR = 80;
const RUNS = Number(process.env.RUNS || 5); // five: on one machine a live site swung from 55 to 87 between runs
const dir = mkdtempSync(join(tmpdir(), "speed-walk-"));

function lighthouse(url, desktop, i) {
  const out = join(dir, `${desktop ? "d" : "m"}-${i}-${url.length}.json`);
  const args = ["-y", "lighthouse@12", url, "--only-categories=performance", "--output=json",
    `--output-path=${out}`, "--chrome-flags=--headless=new", "--quiet",
    desktop ? "--preset=desktop" : "--form-factor=mobile"];
  try {
    execFileSync("npx", args, { stdio: "ignore", timeout: 240000 });
  } catch {
    throw new Error(`Lighthouse did not finish for ${url}`);
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  if (!r.audits) throw new Error(`Lighthouse returned no audits for ${url}: ${JSON.stringify(r.runtimeError || r.error)}`);
  const reqs = r.audits["network-requests"].details.items;
  return {
    score: Math.round(r.categories.performance.score * 100),
    lcp: r.audits["largest-contentful-paint"].numericValue / 1000,
    tbt: r.audits["total-blocking-time"].numericValue,
    cls: r.audits["cumulative-layout-shift"].numericValue,
    kb: Math.round(reqs.reduce((n, q) => n + (q.transferSize || 0), 0) / 1024),
    finalUrl: r.finalDisplayedUrl || r.finalUrl,
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function measure(url, desktop) {
  const runs = Array.from({ length: RUNS }, (_, i) => lighthouse(url, desktop, i));
  const pick = (k) => median(runs.map((r) => r[k]));
  return { score: pick("score"), lcp: pick("lcp"), tbt: pick("tbt"), cls: pick("cls"), kb: pick("kb"), finalUrl: runs[0].finalUrl };
}

let worse = false;
console.log(`Median of ${RUNS} Lighthouse runs each\n`);
console.log("form     page     score   LCP s   TBT ms   CLS     KB");
for (const desktop of [false, true]) {
  const form = desktop ? "desktop" : "mobile ";
  const live = measure(LIVE, desktop);
  const prev = measure(PREVIEW, desktop);
  for (const [name, r] of [["live   ", live], ["preview", prev]]) {
    console.log(`${form}  ${name}  ${String(r.score).padStart(5)}  ${r.lcp.toFixed(1).padStart(6)}  ${String(Math.round(r.tbt)).padStart(7)}  ${r.cls.toFixed(3)}  ${String(r.kb).padStart(5)}`);
  }
  if (prev.score < live.score || prev.lcp > live.lcp) {
    worse = true;
    console.log(`  WORSE: the preview is slower than live on ${form.trim()}`);
  }
  if (!desktop && prev.score <= MOBILE_FLOOR) {
    worse = true;
    console.log(`  BELOW THE BENCHMARK: mobile scores ${prev.score}, and it must be above ${MOBILE_FLOOR}`);
  }
}
console.log("\nThe preview bar is hidden (pb=0); the preview redirect (about 800 ms) still counts against the preview.");
process.exit(worse ? 1 : 0);
