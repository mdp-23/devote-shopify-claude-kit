// PreToolUse (Bash): stops a global npm install that would fail for lack of admin rights.
//
// Node from nodejs.org leaves npm's global folder owned by root. On 22 Oct 2026 a new-brand run
// on a staff Mac skipped install-shopify-cli.sh, ran npm's global install itself, hit EACCES and
// told the person to send the error to Marcel. This sends Claude to the script instead.
// Silent when the global folder is writable, so it never blocks an install that would work.
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GLOBAL_INSTALL = /\b(sudo\s+)?npm\s+(install|i|add)\b[^;&|]*\s(-g|--global)\b/;

export function isGlobalInstall(command) {
  return GLOBAL_INSTALL.test(command || "");
}

export function globalFolderWritable(prefix) {
  const lib = join(prefix, "lib");
  const modules = join(lib, "node_modules");
  const target = existsSync(modules) ? modules : existsSync(lib) ? lib : prefix;
  try { accessSync(target, constants.W_OK); return true; } catch { return false; }
}

export function advice(command, writable) {
  if (!isGlobalInstall(command)) return null;
  if (/\bsudo\b/.test(command)) {
    return "Never install npm packages with sudo on a staff Mac. For the Shopify CLI run " +
      'sh "${CLAUDE_PLUGIN_ROOT}/install-shopify-cli.sh" instead; it installs into the person\'s own folder.';
  }
  if (writable) return null;
  return "npm's global folder needs admin rights on this Mac, so this install would fail with EACCES. " +
    'For the Shopify CLI run sh "${CLAUDE_PLUGIN_ROOT}/install-shopify-cli.sh" instead: it installs into ~/.npm-global ' +
    "and prints the shopify path on its last line. Do not ask the person to fix permissions.";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let command = "";
  try { command = JSON.parse(readFileSync(0, "utf8")).tool_input?.command || ""; } catch {}
  if (!isGlobalInstall(command)) process.exit(0);
  let writable = true;
  try { writable = globalFolderWritable(execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim()); } catch {}
  const msg = advice(command, writable);
  if (msg) {
    process.stderr.write(msg.replaceAll("${CLAUDE_PLUGIN_ROOT}", process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..")) + "\n");
    process.exit(2);
  }
}
