// Guard: package.json's deploy script names the store, the preview theme and the store's real
// domain. Without the domain, deploy cannot run the SEO, accessibility and speed checks; without
// the store and theme it cannot push at all. Two brands ran for weeks with these missing and
// their checks never ran once (9 Oct 2026). Setup and new-brand must ask for them, and the
// SessionStart hook reminds every session until they are filled in.
//
// Theme repos only: an app (no sections/ and layout/) does not deploy a theme.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILLER = /fill-?in|example|acme|your-store|<|>/i;

/**
 * What the deploy script is missing, as words to show a person. Empty means complete.
 * @param {string|null} packageJson the text of package.json, or null when there is none
 */
export function missingDeployTarget(packageJson) {
  let deploy = "";
  try { deploy = JSON.parse(packageJson ?? "")?.scripts?.deploy || ""; } catch { deploy = ""; }
  const flag = (name) => deploy.match(new RegExp(`--${name}[=\\s]+['"]?([^\\s'"]+)`))?.[1] || "";
  const store = flag("store"), theme = flag("theme"), domain = flag("domain");
  const missing = [];
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(store) || FILLER.test(store)) missing.push("the store's .myshopify.com address (--store)");
  if (!/^\d+$/.test(theme)) missing.push("the preview theme id (--theme)");
  if (!domain || FILLER.test(domain) || /myshopify\.com/i.test(domain) || !domain.includes(".")) missing.push("the store's real website domain, e.g. www.acme.com.au (--domain)");
  return missing;
}

export function isThemeRepo(root) {
  return existsSync(join(root, "sections")) && existsSync(join(root, "layout"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (!isThemeRepo(root)) process.exit(0);
  const pkg = join(root, "package.json");
  const missing = missingDeployTarget(existsSync(pkg) ? readFileSync(pkg, "utf8") : null);
  if (missing.length) {
    console.log(`  FAIL package.json's deploy script is missing ${missing.join(", ")}.`);
    console.log("       Without them deploy cannot push, or pushes without the SEO, accessibility and speed checks.");
    console.log('       Ask the person for anything you cannot read off CLAUDE.md or the live site, then set: "deploy": "node scripts/deploy.mjs --store <x>.myshopify.com --theme <preview id> --domain <www.site.com.au>"');
    process.exit(1);
  }
}
