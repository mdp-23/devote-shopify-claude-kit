// What differs on Windows, in one place, so every script starts commands the same way.
//
// Exists because a developer on Windows (Nov 2026) could not deploy or run QA: the scripts started
// the Shopify CLI with execFileSync("shopify", ...), and on Windows the CLI is shopify.cmd, which
// Node does not start without a shell (ENOENT, or EINVAL since Node 20). Deploy stopped at "Could
// not read which theme is live" and QA said the CLI was not installed when it was. The same went
// for npx and npm, for `sleep`, for `/usr/bin/env which`, and for the check that a script was run
// directly (process.argv[1] against the module's path), which differs in slashes and drive-letter
// form there, so kit-version.mjs printed nothing and install.sh wrote an empty .devote-kit-version.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// The full path of a command on PATH, or null. On Windows only the PATHEXT forms count: the npm
// global folder also holds an extension-less shell script of the same name, which Node cannot run.
export function which(cmd, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const win = platform === "win32";
  const path = env.PATH ?? env.Path ?? "";
  const exts = win ? (/\.[a-z0-9]+$/i.test(cmd) ? [""] : (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)) : [""];
  for (const dir of path.split(win ? ";" : ":").filter(Boolean)) {
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      if (exists(full)) return full;
    }
  }
  return null;
}

// Where each command's own Node entry point sits, relative to its .cmd shim (npm's global folder) or
// to node.exe (npm and npx ship inside Node's own folder on Windows).
const ENTRY = {
  shopify: (shim, opts) => [shim && join(dirname(shim), "node_modules", "@shopify", "cli", "bin", "run.js"),
    opts.env.APPDATA && join(opts.env.APPDATA, "npm", "node_modules", "@shopify", "cli", "bin", "run.js")],
  npm: () => [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")],
  npx: () => [join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")],
};

// How to start a command: { file, args } for execFileSync, or { shell } for execSync when Windows
// has only a .cmd shim and no entry point could be found.
export function command(cmd, args, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (platform !== "win32" || !ENTRY[cmd]) return { file: cmd, args };
  const opts = { env, platform, exists };
  const shim = which(cmd, opts);
  const entry = ENTRY[cmd](shim, opts).find((p) => p && exists(p));
  if (entry) return { file: process.execPath, args: [entry, ...args] };
  // Last resort: through cmd.exe, each argument quoted. Plain double quotes keep & | < > ^ literal.
  const q = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`);
  return { shell: [shim ? `"${shim}"` : cmd, ...args.map(q)].join(" ") };
}

// execFileSync for the commands that are .cmd shims on Windows (shopify, npm, npx); anything else
// passes straight through.
export function execCli(cmd, args = [], opts = {}) {
  const c = command(cmd, args);
  return c.shell ? execSync(c.shell, opts) : execFileSync(c.file, c.args, opts);
}

export const haveCli = (cmd) => Boolean(which(cmd));

// A pause without a `sleep` binary (Windows has none).
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Was this module run directly (node scripts/x.mjs), not imported? Compared as real paths, and on
// Windows without case and with Git Bash's /d/ form read as D:/.
export function isMain(metaUrl, argv1 = process.argv[1], platform = process.platform) {
  if (!argv1) return false;
  const win = platform === "win32";
  const norm = (p) => {
    if (win) p = p.replace(/^\/([a-z])\//i, "$1:/");
    let r;
    try { r = realpathSync(p); } catch { r = resolve(p); }
    return win ? r.replace(/\\/g, "/").toLowerCase() : r;
  };
  return norm(argv1) === norm(fileURLToPath(metaUrl));
}

// A path in a theme or repo as every baseline and stamp keys it: relative to the root, with forward
// slashes. Exists because on Windows (Nov 2026) relative() gave "assets\x.woff", so a baseline
// written by a Windows deploy matched nothing on a Mac and the other way round, and theme check's
// "d:\..." paths never started with ROOT's "D:\...", so its baseline kept absolute paths. The
// win32 relative() compares drive letters and folders without case.
export const slashes = (p) => String(p).replace(/\\/g, "/");
export function repoPath(root, p, platform = process.platform) {
  const api = platform === "win32" ? win32 : posix;
  return slashes(api.isAbsolute(p) ? api.relative(root, p) : p);
}
// A baseline read from disk with its file keys in that form, so one written before this fix (or on
// the other platform) still matches.
export const slashKeys = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [slashes(k), v])) : o);
