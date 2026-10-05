// Guard: assets/overflow-list.js accepts every element snippets/overflow-list.liquid can render.
//
// Exists because on one build an accessibility fix rendered Horizon's overflow list as <div> where
// its script demanded a <ul> and <li>. The script threw on start-up, so the header menu never
// folded its last links into "More", and from 768px to 1180px the menu ran under the search and
// account icons. Fails if the script type-checks for a tag the snippet does not always render.
// Skips a theme without Horizon's overflow list.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (!existsSync(join(ROOT, "assets", "overflow-list.js")) || !existsSync(join(ROOT, "snippets", "overflow-list.liquid"))) {
  console.log("no Horizon overflow list in this theme, nothing to check");
  process.exit(0);
}
const js = readFileSync(join(ROOT, "assets", "overflow-list.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const liquid = readFileSync(join(ROOT, "snippets", "overflow-list.liquid"), "utf8");
const strict = { HTMLUListElement: /<ul\b/, HTMLLIElement: /<li\b/, HTMLDivElement: /<div\b/ };
const bad = [];
for (const [type, tag] of Object.entries(strict)) {
  if (!new RegExp(`instanceof\\s+${type}\\b`).test(js)) continue;
  // The snippet may switch the tag with a variable, in which case the literal is not always rendered.
  const variable = /<\{\{\s*(list|item)_tag\s*\}\}/.test(liquid);
  if (variable || !tag.test(liquid)) bad.push(type);
}
if (bad.length) {
  console.log(`  assets/overflow-list.js requires ${bad.join(" and ")}, which snippets/overflow-list.liquid does not always render`);
  process.exit(1);
}
console.log("overflow-list.js accepts every tag its snippet renders");
