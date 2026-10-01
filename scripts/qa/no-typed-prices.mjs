// Guard: no price typed into theme copy. Prices come from the product (money filters, variant data).
//
// Exists because on 1 Oct 2026 Marcel: "don't include price anywhere because prices change, and no
// one's going to remember to go and update" them. A "$530" in a template setting or a section
// default goes stale the day the client changes a price. Code comments are ignored.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRICE = /\$\s?\d{2,5}(?:[.,]\d{2})?/;
const problems = [];
const files = [
  ...readdirSync(join(ROOT, "templates")).filter((f) => f.endsWith(".json")).map((f) => join("templates", f)),
  ...readdirSync(join(ROOT, "sections")).filter((f) => f.endsWith(".json")).map((f) => join("sections", f)),
  "config/settings_data.json",
];
for (const f of files) {
  let s; try { s = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
  s.split("\n").forEach((line, i) => { if (PRICE.test(line)) problems.push(`${f}:${i + 1}: typed price in theme copy: ${line.trim().slice(0, 90)}`); });
}
// section schema defaults (copy a merchant starts from), not code comments
for (const f of readdirSync(join(ROOT, "sections")).filter((f) => f.endsWith(".liquid"))) {
  const s = readFileSync(join(ROOT, "sections", f), "utf8");
  const schema = s.split("{% schema %}")[1] || "";
  schema.split("\n").forEach((line) => { if (/"default"/.test(line) && PRICE.test(line)) problems.push(`sections/${f}: typed price in a setting default: ${line.trim().slice(0, 90)}`); });
}
if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
