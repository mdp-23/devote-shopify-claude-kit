// Guard: no filters inside an if, elsif, unless or for tag.
//
// Liquid does not apply them there and says nothing: `if a == a | upcase` compares the raw value
// and `for w in title | split: ' '` loops over nothing, so on 30 Sep 2026 a client's card titles
// stayed in capitals with every check green. Assign the filtered value first, then test it.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const problems = [];
for (const dir of ["sections", "snippets", "blocks", "layout", "templates"]) {
  let files = [];
  try { files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".liquid")); } catch { continue; }
  for (const f of files) {
    const lines = readFileSync(join(ROOT, dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      // {% if x | f %} tags, and bare `if x | f` lines inside {% liquid %} blocks
      const tag = line.match(/(?:\{%-?\s*|^\s*)(if|elsif|unless|for)\s+([^%]*?)(?:-?%\}|$)/);
      if (!tag) return;
      const cond = tag[2].replace(/'[^']*'|"[^"]*"/g, "");
      if (/(?<!\|)\|(?!\|)/.test(cond)) problems.push(`${dir}/${f}:${i + 1}: filter inside a ${tag[1]} tag is ignored: ${line.trim().slice(0, 90)}`);
    });
  }
}
if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
