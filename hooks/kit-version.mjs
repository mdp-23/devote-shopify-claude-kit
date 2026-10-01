// The kit's version: a hash of everything install.sh copies into a brand repo.
//
// install.sh writes it to .devote-kit-version in the brand repo, and the SessionStart hook
// compares that file with this kit's hash. One function computes both, so they cannot disagree.
// Run directly, it prints the hash for the kit it sits in.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARTS = ["DEVOTE-KIT.md", "install.sh", "scripts", "tests", ".claude/settings.json.example", "package.json.example", "seo-pages.json.example"];

function files(path) {
  const full = join(KIT, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).sort().flatMap((f) => files(join(path, f)));
}

export function kitVersion() {
  const hash = createHash("sha256");
  for (const f of PARTS.flatMap(files)) {
    hash.update(relative(KIT, f) + "\0");
    hash.update(readFileSync(f));
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(kitVersion());
