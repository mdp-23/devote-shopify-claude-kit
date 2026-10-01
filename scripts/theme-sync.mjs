// Code files and other people: what deploy may push, what it must take in, and what clashes.
//
// Exists because two people building the same theme from different Macs overwrote each other's
// code. Deploy pushed the whole local copy, so the second deploy quietly put back the old version
// of every snippet the first person had changed (Marcel, 2 Oct 2026: "if multiple people are
// working on the same theme, can this gate mitigate overwriting each other's files?"). Editor JSON
// already had a baseline; code files now have one too, in .theme-baseline.json: the hash of every
// code file as the theme held it the last time this repo synced with it.
//
// For each file, with base = baseline, remote = the theme now, local = this repo:
//   remote == base or remote == local   -> nobody else changed it, or they made the same change: push
//   remote != base and local == base    -> someone else changed it and you did not: take theirs
//   remote != base and local != base    -> you both changed it: a clash, merge before deploying
// A file with no baseline (the first deploy from this repo) cannot be told apart, so a difference
// there is reported and needs --first-sync to push over it.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const CODE_DIRS = ["sections", "snippets", "blocks", "layout", "assets"];
export const CODE_FILES = ["config/settings_schema.json"];
export const CODE_GLOBS = [...CODE_DIRS.map((d) => `${d}/*`), ...CODE_FILES];

export const hashFile = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 20);

// Code files under dir: everything in the code folders except the editor-owned section groups.
export function codeFilesIn(dir) {
  const out = [];
  for (const d of CODE_DIRS) {
    const full = join(dir, d);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) {
      const p = join(full, f);
      if (statSync(p).isFile() && !(d === "sections" && f.endsWith(".json"))) out.push(relative(dir, p));
    }
  }
  for (const f of CODE_FILES) if (existsSync(join(dir, f))) out.push(f);
  return out.sort();
}

// base, remote, local: { file: hash } (a file missing from local or remote is absent from its map).
export function classify(base, remote, local) {
  const take = [], clash = [], unknown = [];
  for (const f of Object.keys(remote).sort()) {
    const r = remote[f], l = local[f] ?? null;
    if (r === l) continue;
    if (!base) { unknown.push(f); continue; }
    const b = base[f] ?? null; // null: the file did not exist on the theme at the last sync
    if (r === b) continue; // only you changed it
    if (l === b) take.push(f); // only they changed it (or added it)
    else clash.push(f); // you both changed it
  }
  return { take, clash, unknown };
}
