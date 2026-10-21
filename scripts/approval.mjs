// Approve, then release: how an approved preview reaches the live theme without a new theme id.
//
// Exists because a client's live theme id has to stay the same (apps and integrations are tied to
// it), so publishing the preview theme was not an option, and until 21 Oct 2026 the only way to
// get approved work onto the live theme was for a person to run a live push by hand (Marcel: "we
// want the team to be able to merge with main once it has been approved by them manually checking
// the preview link").
//
//   1. npm run deploy                     the work goes to the preview theme; deploy prints the review link
//   2. a person opens the link and checks it
//   3. npm run approve -- --by "Name"     that person, in their own terminal. Claude never runs it:
//                                          the ship gate refuses, so an approval always means a person looked
//   4. npm run release                    Claude or the person: pushes the approved code onto the live theme
//
// The approval is for one exact set of code (the same hash the review stamp uses), so any change
// after it needs a new deploy, a new look and a new approval. It is used up by the release.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APPROVAL = join(ROOT, ".release-approval.json");

/** Store, preview theme and domain, read from package.json's deploy script: one place, not two. */
export function deployTarget({ root = ROOT } = {}) {
  let script = "";
  try { script = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.scripts?.deploy ?? ""; } catch {}
  const flag = (name) => { const m = script.match(new RegExp(`--${name}[ =](\\S+)`)); return m && !/FILL-IN/.test(m[1]) ? m[1] : null; };
  return { store: flag("store"), theme: flag("theme"), domain: (flag("domain") || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || null };
}

/** The link a person opens to check work on a preview theme. */
export function reviewLink({ store, theme, domain }, path = "/") {
  const host = domain || store;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${host}${p}${p.includes("?") ? "&" : "?"}preview_theme_id=${theme}`;
}

/**
 * Whether an approval covers the code about to be released.
 * @returns {{ ok: boolean, why?: string }}
 */
export function approvalVerdict(approval, { codeHash, store }) {
  if (!approval) return { ok: false, why: "nobody has approved this work yet (no .release-approval.json)" };
  if (!approval.by) return { ok: false, why: "the approval does not say who approved it" };
  if (approval.store !== store) return { ok: false, why: `the approval is for ${approval.store}, not ${store}` };
  if (approval.codeHash !== codeHash) return { ok: false, why: `the code changed after ${approval.by} approved it, so what they checked is not what would go live` };
  return { ok: true };
}

export function readApproval() {
  if (!existsSync(APPROVAL)) return null;
  try { return JSON.parse(readFileSync(APPROVAL, "utf8")); } catch { return null; }
}

/**
 * Of the files live holds differently from the repo, the ones this repo has never had a copy of.
 * Those were changed on the live theme outside the repo (the admin code editor, an app, another
 * agency), and a release would overwrite them unseen. "known" says whether a file's exact content
 * is anywhere in this repo's git history.
 */
export function unknownLiveChanges(differing, known) {
  return differing.filter((f) => !known(f));
}

/** Whether these exact bytes have ever been committed in this repo. */
export function inGitHistory(path, { cwd = ROOT } = {}) {
  try {
    const blob = execFileSync("git", ["hash-object", path], { cwd, encoding: "utf8" }).trim();
    execFileSync("git", ["cat-file", "-e", blob], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
