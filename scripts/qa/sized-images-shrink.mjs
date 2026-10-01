// Guard: an image given width and height attributes must still shrink to its container.
//
// Exists because on 1 Oct 2026 the Safety page's carousel images got width/height attributes (to stop
// layout shift) and rendered at their natural 1146px on a phone until slick started. The page was
// 1146px wide at that moment, slick read that as desktop, and the video slider started with two
// 123px slides instead of one full-width one. An <img> with a width attribute in a section needs
// max-width: 100% inline, or a class that sets it (img-fluid, w-100), or image_tag (Shopify sizes it).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const problems = [];
for (const dir of ["sections", "snippets"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".liquid") && !/^(pagefly|pf-|judgeme|buddha)/.test(f))) {
    const src = readFileSync(join(ROOT, dir, f), "utf8");
    for (const m of src.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      if (!/(\s|\})width=/.test(tag)) continue;
      if (/max-width:\s*100%|\b(img-fluid|w-100)\b|position:\s*absolute/.test(tag)) continue;
      if (/width="(\d{1,3})"/.test(tag) && Number(tag.match(/width="(\d{1,3})"/)[1]) <= 300) continue; // small fixed images (cards, icons)
      problems.push(`${dir}/${f}:${src.slice(0, m.index).split("\n").length}: <img> with a width attribute but nothing to stop it overflowing; add max-width: 100%`);
    }
  }
}
if (problems.length) { for (const p of problems) console.log("  " + p); process.exit(1); }
