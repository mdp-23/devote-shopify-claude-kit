// Guard: no filter inside another filter's arguments, e.g. image_tag: alt: x | default: '', class: 'y'.
//
// Exists because on a client's product page (1 Oct 2026) four image_tag calls passed
// `alt: something | default: ''` and one `alt: product.title | append: ' size guide'`. Liquid reads
// that `|` as the start of the next filter: the arguments after it never reach image_tag (so the
// class went missing and a 2400px banner overflowed the page), and append received the class
// argument and printed a Liquid error in the size guide. Assign the value first, then pass it.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const problems = [];
// image_tag and video_tag end the chain; a pipe after their arguments start is a filter inside them.
const BAD = /\|\s*(image_tag|video_tag|stylesheet_tag|script_tag|placeholder_svg_tag)\s*:[^}]*\|/;
for (const dir of ["sections", "snippets", "layout", "templates", "blocks"]) {
  let files = [];
  try { files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".liquid")); } catch { continue; }
  for (const f of files) {
    readFileSync(join(ROOT, dir, f), "utf8").split("\n").forEach((line, i) => {
      for (const tag of line.match(/\{\{[^}]*\}\}/g) || []) {
        if (BAD.test(tag)) problems.push(`${dir}/${f}:${i + 1}: a filter inside another filter's arguments; assign it first: ${tag.trim().slice(0, 110)}`);
      }
    });
  }
}
if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
