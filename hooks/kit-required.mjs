// PreToolUse (Bash, Write, Edit, MultiEdit): Shopify themes and apps are only changed from a repo
// that has the Devote kit.
//
// The kit's safety gate, deploy checks and reviews live in each brand repo (.claude/settings.json),
// so they only exist where the kit was set up. Someone new opened a theme folder, or pulled one into
// a fresh folder, and Claude edited and pushed it with none of them: no speed, SEO or accessibility
// checks, no review, no protection for the theme editor's work (Marcel, 6 Nov 2026: "There's
// nothing stopping someone from just using Claude Code to develop on Shopify without any
// guardrails"). This hook is part of the plugin, so it runs in every folder on every Mac that has
// the plugin, and it stops three things until the kit is set up:
//
//   1. Writing or editing a theme file (sections, snippets, blocks, layout, assets, templates,
//      config, locales) or an app file in a folder without the kit.
//   2. A theme push, share, publish or delete, or an app deploy or release, from such a folder.
//   3. Changing theme files through the Admin API (themeFilesUpsert, themePublish and the rest, or
//      the REST assets endpoint) from anywhere: theme code reaches a store through npm run deploy and
//      npm run release, which carry the checks.
//
// Reading, pulling and theme dev stay allowed. The fix is always the same and takes a minute:
// /devote-shopify:setup in that folder, or /devote-shopify:new-brand for a store with no folder yet.
// Fails open on anything it cannot read: the brand repo's ship gate is the hard stop for publishing.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { executablePart } from "../scripts/qa/ship-gate.mjs";

const THEME_DIRS = new Set(["sections", "snippets", "blocks", "layout", "assets", "templates", "config", "locales"]);
const fsExists = (p) => existsSync(p);

/** The theme or app folder a path sits in, or null. A theme has layout/ and sections/ or templates/. */
export function projectRoot(path, exists = fsExists) {
  let dir = resolve(path);
  for (let i = 0; i < 40; i++) {
    const isTheme = exists(join(dir, "layout")) && (exists(join(dir, "sections")) || exists(join(dir, "templates")));
    if (isTheme || exists(join(dir, "shopify.app.toml"))) return { root: dir, kind: isTheme ? "theme" : "app" };
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

const hasKit = (root, exists) => exists(join(root, ".devote-kit-version"));

const SETUP = (root) =>
  `Set up the Devote Shopify kit first: run the /devote-shopify:setup skill in ${root} (or /devote-shopify:new-brand ` +
  "if this store has no brand folder in ~/Devote yet), tell the person in one line, then carry on. " +
  "The kit is what gives this work its safety gate, its deploy checks (speed, SEO, accessibility, forms, " +
  "what the live theme does) and its reviews. Do not work around this by editing or pushing from another folder.";

/** Why a file edit must wait for the kit, or null to let it through. */
export function editVerdict(filePath, { exists = fsExists } = {}) {
  if (!filePath) return null;
  const found = projectRoot(dirname(resolve(filePath)), exists);
  if (!found || hasKit(found.root, exists)) return null;
  const rel = relative(found.root, resolve(filePath)).split(sep);
  const inTheme = found.kind === "theme" && THEME_DIRS.has(rel[0]);
  const inApp = found.kind === "app" && (rel[0] === "extensions" || rel[0] === "app" || rel[0] === "shopify.app.toml");
  if (!inTheme && !inApp) return null;
  return `BLOCKED. ${found.root} is a Shopify ${found.kind} without the Devote kit, so this edit would skip every Devote check. ${SETUP(found.root)}`;
}

const STORE_WRITE = /(?:^|[;&|`(]|\s)(?:npx\s+|pnpm\s+dlx\s+|bunx\s+|yarn\s+)?shopify\s+(?:theme\s+(?:push|share|publish|delete)|app\s+(?:deploy|release))\b/;
const API_THEME_WRITE = /\b(?:themeFilesUpsert|themeFilesDelete|themeFilesCopy|themePublish|themeDelete|themeCreate|themeUpdate)\b|\/themes\/\d+\/assets(?:\.json)?\b[\s\S]*(?:-X\s*(?:PUT|POST|DELETE)|--request\s+(?:PUT|POST|DELETE)|--data|-d\s)|(?:-X\s*(?:PUT|POST|DELETE)|--request\s+(?:PUT|POST|DELETE))[\s\S]*\/themes\/\d+\/assets/;

/** The folder a command acts on: its --path, else a leading cd, else the session's folder. */
export function commandFolder(command, cwd) {
  const path = command.match(/--path[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const cd = command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)/);
  const pick = (m) => m && (m[1] || m[2] || m[3]).replace(/^~(?=\/|$)/, process.env.HOME || "~");
  const base = pick(cd) ? resolve(cwd, pick(cd)) : cwd;
  const p = pick(path);
  return p ? (isAbsolute(p) ? p : resolve(base, p)) : base;
}

/** Why a command must wait for the kit, or null to let it through. */
export function bashVerdict(command, cwd, { exists = fsExists } = {}) {
  const cmd = executablePart(command || "");
  // Only a command that talks to a store: a commit message or a grep that names a mutation is not one.
  if (API_THEME_WRITE.test(cmd) && /shopify\s+store\s+(?:execute|bulk)|\bcurl\b|\bwget\b|\bhttpie?\b|fetch\(|admin\/api/.test(cmd)) {
    return "BLOCKED. This changes theme files through the Admin API, which goes around the Devote kit's deploy " +
      "checks, its reviews and its protection for the theme editor's work. Theme code reaches a store only through " +
      "npm run deploy (the preview) and npm run release (the live theme, after a person approves) in the brand's kit repo.";
  }
  if (!STORE_WRITE.test(cmd)) return null;
  const folder = commandFolder(cmd, cwd);
  const found = projectRoot(folder, exists);
  if (found && hasKit(found.root, exists)) return null; // the brand repo's own ship gate takes it from here
  if (!found) {
    return `BLOCKED. ${folder} is not a Shopify theme or app folder with the Devote kit, so this would send code to a store ` +
      "with none of the Devote checks. Work from the brand's folder in ~/Devote and deploy with npm run deploy. " +
      "If the store has no folder yet, run the /devote-shopify:new-brand skill.";
  }
  return `BLOCKED. ${found.root} has no Devote kit, so this would send code to a store with none of the Devote checks. ${SETUP(found.root)}`;
}

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  process.exit(0);
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
  const input = payload.tool_input || {};
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let reason = null;
  try {
    reason = payload.tool_name === "Bash"
      ? bashVerdict(input.command || "", cwd)
      : editVerdict(input.file_path ? resolve(cwd, input.file_path) : "");
  } catch { reason = null; }
  if (reason) deny(reason);
}
