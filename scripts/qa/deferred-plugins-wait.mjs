// Guard: jQuery plugins load with `defer`, so inline scripts must wait for them.
//
// Exists because on 1 Oct 2026 an older theme's plugins (slick, bootstrap, js.cookie, nice-select,
// equalheights, shopify_common) moved from blocking <head> scripts to deferred ones for speed. A deferred
// script runs after parsing, so an inline <script> that calls a plugin at the top level (the safety
// page's carousel, the customer address form) throws before the plugin exists. Any inline script that
// uses one must wait: $(function), $(document).ready, DOMContentLoaded or window load. Calls made only
// from event handlers inside such a wrapper are fine, which is why the check is per script block.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const layout = readFileSync(join(ROOT, "layout/theme.liquid"), "utf8");
if (!/slick\.min\.js[^\n]*defer|src="\{\{ 'slick\.min\.js' \| asset_url \}\}" defer/.test(layout)) process.exit(0); // plugins not deferred: nothing to check
const PLUGIN = /\.slick\(|\.(modal|collapse|tooltip|popover|dropdown|tab|carousel|scrollspy|toast)\(|\.niceSelect\(|\.equalHeights\(|Cookies\.(get|set|remove)\(|Shopify\.(CountryProvinceSelector|postLink|setSelectorByValue)\b/;
const WAITS = /\$\(\s*function|\$\(\s*document\s*\)\.ready|jQuery\(\s*function|DOMContentLoaded|addEventListener\(\s*['"]load['"]|\$\(\s*window\s*\)\.on\(\s*['"]load/;
const problems = [];
for (const dir of ["sections", "snippets", "templates", "templates/customers", "layout"]) {
  let files = [];
  try { files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".liquid")); } catch { continue; }
  for (const f of files) {
    if (/^(pagefly|judgeme|buddha|gts|livechat)/.test(f)) continue; // app-managed
    const src = readFileSync(join(ROOT, dir, f), "utf8").replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "");
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const body = m[1];
      // A block whose plugin calls all sit in handlers says so with a `deferred-plugins: handlers only` comment.
      if (PLUGIN.test(body) && !WAITS.test(body) && !/deferred-plugins: handlers only/.test(body)) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${dir}/${f}:${line}: inline script calls a deferred plugin without waiting for DOMContentLoaded`);
      }
    }
  }
}
if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
