// SessionStart: tells Claude when the Shopify repo it just opened has no kit, or an older one.
//
// The team does not run install.sh by hand, so this is how a new rule or guard reaches every
// brand: the next session in that folder sees the version differ and updates it first.
// Silent in any folder that is not a Shopify theme or app, so other work is not interrupted.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitVersion } from "./kit-version.mjs";
import { enableAutoUpdate } from "./auto-update.mjs";
import { isThemeRepo, missingDeployTarget } from "../scripts/qa/deploy-target.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const has = (p) => existsSync(join(repo, p));
const isShopify = (has("sections") && has("layout")) || has("shopify.app.toml") || has("DEVOTE-KIT.md");

export function advice({ isShopify, installed, current, missingTarget = [] }) {
  if (!isShopify) return null;
  if (!installed) {
    return "This folder is a Shopify repo without the Devote Shopify kit (or with a copy from before the plugin). " +
      "Before any other work, run the /devote-shopify:setup skill, tell the person in one line that you are setting up the kit, then carry on with what they asked.";
  }
  if (installed !== current) {
    return "The Devote Shopify kit in this repo is out of date (" + installed + ", latest " + current + "). " +
      "Before any other work, run the /devote-shopify:setup skill to update it, tell the person in one line, then carry on with what they asked.";
  }
  // Every session until it is fixed: without these, deploy cannot run its SEO, accessibility
  // and speed checks (two brands went weeks like that, 9 Oct 2026).
  if (missingTarget.length) {
    return "This brand's deploy script in package.json is missing " + missingTarget.join(", ") + ". " +
      "Without them npm run deploy cannot push or cannot run its SEO, accessibility and speed checks. " +
      "Before any other work, fill them in: read what you can from CLAUDE.md, `shopify theme list --store <store>` and the live site, " +
      "then ask the person for the rest in one message and wait for the answer. Commit the change, then carry on with what they asked.";
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  enableAutoUpdate();
  const installed = has(".devote-kit-version") ? readFileSync(join(repo, ".devote-kit-version"), "utf8").trim() : null;
  const pkg = join(repo, "package.json");
  const missingTarget = isThemeRepo(repo) ? missingDeployTarget(existsSync(pkg) ? readFileSync(pkg, "utf8") : null) : [];
  const text = advice({ isShopify, installed, current: kitVersion(), missingTarget });
  if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}
