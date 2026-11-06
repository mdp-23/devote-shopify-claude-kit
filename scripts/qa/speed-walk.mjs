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
import { onPasswordPage } from "./preview-session.mjs";

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
// A store that has not launched (deploy.mjs sets PRELAUNCH and PREVIEW_COOKIE): LIVE is the
// client's old site, not a Shopify theme, so it is shown for comparison only. Being slower than
// the old site does not fail; the mobile benchmark still does. The cookie (storefront password)
// goes to the preview runs only.
const PRELAUNCH = process.env.PRELAUNCH === "1";
const COOKIE = process.env.PREVIEW_COOKIE || "";
const RUNS = Number(process.env.RUNS || 5); // five: on one machine a live site swung from 55 to 87 between runs
const dir = mkdtempSync(join(tmpdir(), "speed-walk-"));

// The storefront password (before launch): Lighthouse's --extra-headers Cookie is lost on Shopify's
// preview redirect, which then sends the run to /password (one build measured an 82 KB password
// page as a score of 100). So the cookies go into a Chrome launched here, and Lighthouse runs in
// that Chrome without clearing its storage.
async function chromeWithCookies(url, cookie) {
  const { launch } = await import("chrome-launcher");
  const puppeteer = (await import("puppeteer-core")).default;
  const chrome = await launch({ chromeFlags: ["--headless=new"] });
  const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  const p = await b.newPage();
  const domain = new URL(url).hostname;
  await p.setCookie(...cookie.split(/;\s*/).filter((kv) => kv.includes("=")).map((kv) => { const k = kv.indexOf("="); return { name: kv.slice(0, k), value: kv.slice(k + 1), domain, path: "/", secure: true }; }));
  await p.close();
  b.disconnect();
  return chrome;
}

async function lighthouse(url, desktop, i, cookie) {
  const out = join(dir, `${desktop ? "d" : "m"}-${i}-${url.length}.json`);
  const chrome = cookie ? await chromeWithCookies(url, cookie) : null;
  const args = ["-y", "lighthouse@12", url, "--only-categories=performance", "--output=json",
    `--output-path=${out}`, "--quiet",
    desktop ? "--preset=desktop" : "--form-factor=mobile",
    ...(chrome ? [`--port=${chrome.port}`, "--disable-storage-reset"] : ["--chrome-flags=--headless=new"])];
  try {
    execFileSync("npx", args, { stdio: "ignore", timeout: 240000 });
  } catch {
    throw new Error(`Lighthouse did not finish for ${url}`);
  } finally {
    if (chrome) await chrome.kill();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  if (!r.audits) throw new Error(`Lighthouse returned no audits for ${url}: ${JSON.stringify(r.runtimeError || r.error)}`);
  const finalUrl = r.finalDisplayedUrl || r.finalUrl;
  if (onPasswordPage(finalUrl)) throw new Error(`NOT CHECKED: ${url} ended on the store password page, so the score would be the password page's`);
  const reqs = r.audits["network-requests"].details.items;
  return {
    score: Math.round(r.categories.performance.score * 100),
    lcp: r.audits["largest-contentful-paint"].numericValue / 1000,
    tbt: r.audits["total-blocking-time"].numericValue,
    cls: r.audits["cumulative-layout-shift"].numericValue,
    kb: Math.round(reqs.reduce((n, q) => n + (q.transferSize || 0), 0) / 1024),
    finalUrl,
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function measure(url, desktop, cookie = "") {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await lighthouse(url, desktop, i, cookie));
  const pick = (k) => median(runs.map((r) => r[k]));
  return { score: pick("score"), lcp: pick("lcp"), tbt: pick("tbt"), cls: pick("cls"), kb: pick("kb"), finalUrl: runs[0].finalUrl };
}

let worse = false;
console.log(`Median of ${RUNS} Lighthouse runs each\n`);
console.log("form     page     score   LCP s   TBT ms   CLS     KB");
for (const desktop of [false, true]) {
  const form = desktop ? "desktop" : "mobile ";
  let live, prev;
  try {
    live = await measure(LIVE, desktop);
    prev = await measure(PREVIEW, desktop, COOKIE);
  } catch (e) {
    console.log(String(e.message || e));
    process.exit(1);
  }
  for (const [name, r] of [[PRELAUNCH ? "old site" : "live   ", live], ["preview", prev]]) {
    console.log(`${form}  ${name}  ${String(r.score).padStart(5)}  ${r.lcp.toFixed(1).padStart(6)}  ${String(Math.round(r.tbt)).padStart(7)}  ${r.cls.toFixed(3)}  ${String(r.kb).padStart(5)}`);
  }
  if (prev.score < live.score || prev.lcp > live.lcp) {
    if (PRELAUNCH) console.log(`  slower than the old site on ${form.trim()} (not a fail before launch: the old site is not a Shopify theme)`);
    else {
      worse = true;
      console.log(`  WORSE: the preview is slower than live on ${form.trim()}`);
    }
  }
  if (!desktop && prev.score <= MOBILE_FLOOR) {
    worse = true;
    console.log(`  BELOW THE BENCHMARK: mobile scores ${prev.score}, and it must be above ${MOBILE_FLOOR}`);
  }
}
console.log("\nThe preview bar is hidden (pb=0); the preview redirect (about 800 ms) still counts against the preview.");
if (PRELAUNCH) console.log(`The store has not launched: "old site" is ${LIVE}, the client's current site, shown for comparison only.`);
process.exit(worse ? 1 : 0);
