// Guard: the SEO basics a Horizon build gets wrong out of the box.
//
// Exists because a client SEO audit (30 Sep 2026) found, on the rebuild: two H1s on the homepage
// (Horizon's hidden shop-name H1 plus the hero), an Organization "url" that pointed at whichever
// page it was rendered on, indexable search result pages, and no meta description on any page
// whose merchant left the field blank. It checks only what the code decides on its own; what
// content and settings decide is checked on the rendered pages by seo-walk.mjs (`npm run seo`).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const problems = [];
const header = read("sections/header.liquid");
// Horizon keeps the head tags in snippets/meta-tags; older themes keep them in the layout.
const legacy = !existsSync(join(ROOT, "snippets/meta-tags.liquid"));
const meta = legacy ? read("layout/theme.liquid") : read("snippets/meta-tags.liquid");
if (/<h1 class="visually-hidden">/.test(header)) problems.push("sections/header.liquid: a hidden H1 makes a second H1 on the homepage; the hero carries the H1");
if (/request\.origin \| append: page\.url/.test(header)) problems.push("sections/header.liquid: Organization url must be the shop's home (shop.url), not the current page");
if (!/page_type == 'search'[\s\S]{0,120}noindex/.test(meta)) problems.push("snippets/meta-tags.liquid: search result pages need <meta name=\"robots\" content=\"noindex, follow\">");
if (!/if page_description == blank/.test(meta)) problems.push("snippets/meta-tags.liquid: pages with no description of their own need a fallback description");

// Section groups render on every page, so an H1 in one is a second H1 on every page that has its own.
const json = (p) => JSON.parse(read(p).replace(/\/\*[\s\S]*?\*\//g, ""));
const sectionTypes = (p) => [...new Set(Object.values(json(p).sections || {}).map((s) => s.type))];
const hasH1 = (type) => existsSync(join(ROOT, `sections/${type}.liquid`)) && /<h1[\s>]/i.test(read(`sections/${type}.liquid`));
for (const group of ["sections/header-group.json", "sections/footer-group.json"].filter((g) => existsSync(join(ROOT, g)))) {
  for (const t of sectionTypes(group).filter(hasH1)) problems.push(`sections/${t}.liquid: renders an <h1> from ${group}, so every page gets a second H1`);
}
// The homepage's H1 belongs to one section; two sections that each hard-code an <h1> is that audit's bug again.
if (existsSync(join(ROOT, "templates/index.json"))) {
  const h1s = sectionTypes("templates/index.json").filter(hasH1);
  if (h1s.length > 1) problems.push(`templates/index.json: ${h1s.length} sections hard-code an <h1> (${h1s.join(", ")}); the homepage gets one`);
}
// The tags every page needs come from these two files; a rebuild that drops one loses it site-wide.
if (!/<title>[\s\S]*?page_title[\s\S]*?<\/title>/.test(meta)) problems.push("snippets/meta-tags.liquid: <title> must render page_title");
if (!/rel="canonical"[\s\S]{0,40}canonical_url/.test(meta)) problems.push("snippets/meta-tags.liquid: <link rel=\"canonical\"> must render canonical_url");
if (!/name="description"/.test(meta)) problems.push("snippets/meta-tags.liquid: no <meta name=\"description\">");
const layout = read("layout/theme.liquid");
if (!legacy && !/render 'meta-tags'|render "meta-tags"/.test(layout)) problems.push("layout/theme.liquid: does not render snippets/meta-tags");
if (!/<html[^>]*\slang="\{\{/.test(layout)) problems.push("layout/theme.liquid: <html> needs lang=\"{{ request.locale.iso_code }}\"");
// Baseline: problems the theme already had when the kit arrived may stay until fixed; new ones fail.
const BASE = join(dirname(fileURLToPath(import.meta.url)), "seo-basics-baseline.json");
const known = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : [];
if (process.argv.includes("--write-baseline")) { (await import("node:fs")).writeFileSync(BASE, JSON.stringify(problems, null, 2) + "\n"); }
const fresh = problems.filter((p) => !known.includes(p));
for (const p of known.filter((k) => problems.includes(k))) console.log("  known (in baseline): " + p);
if (fresh.length) { for (const p of fresh) console.log("  " + p); process.exit(1); }
