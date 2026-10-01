// Sends a lesson that would help every Devote store to Marcel's weekly kit review.
//
// Exists because brand folders live on each person's own Mac, so a lesson learnt there never
// reached the kit (Marcel, 2 Oct 2026: the kit should reflect after each deploy and get better).
// Store-only lessons go in the brand's CLAUDE.md instead. This never edits the kit: Marcel approves
// what goes in. The form needs no login; it posts to a Google Form whose responses only he can read.
//
//   node scripts/kit-suggest.mjs --lesson "..." --rule "..." --happened "..."
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSfgTYp6be_ahb0W8Hzbn3hxZmq_bxBSnbNJ-a9jN2l_bbXUbg/formResponse";
const FIELDS = { lesson: "entry.867450419", rule: "entry.456012717", happened: "entry.1868132", brand: "entry.254203459", version: "entry.847451385" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const lesson = arg("--lesson"), rule = arg("--rule"), happened = arg("--happened");
if (!lesson || !rule || !happened) {
  console.log('Usage: node scripts/kit-suggest.mjs --lesson "what was learnt" --rule "the rule or check that would stop it" --happened "what went wrong"');
  process.exit(1);
}
const version = existsSync(join(ROOT, ".devote-kit-version")) ? readFileSync(join(ROOT, ".devote-kit-version"), "utf8").trim() : "unknown";
const body = new URLSearchParams({ [FIELDS.lesson]: lesson, [FIELDS.rule]: rule, [FIELDS.happened]: happened, [FIELDS.brand]: basename(ROOT), [FIELDS.version]: version });

const res = await fetch(FORM, { method: "POST", body, redirect: "manual" }).catch((e) => ({ error: e.message }));
// Google answers a good submission with 200 (or a redirect to the thank-you page).
if (res.error || !(res.status === 200 || (res.status >= 300 && res.status < 400))) {
  console.log(`NOT SENT: ${res.error || `the form answered ${res.status}`}. Put the lesson under "Lessons for this brand" in CLAUDE.md marked "kit suggestion", and say in the handover that it did not send.`);
  process.exit(1);
}
console.log("Sent to the kit review. Marcel decides whether it goes into the kit.");
