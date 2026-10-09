// Whether a store is a development store, asked of Shopify, never of the repo.
//
// The one exception to "never push to the live theme" (DEVOTE-KIT.md, "Never, on any store"):
// on a development store nobody is shopping, and a build there is often pushed straight to the
// live theme. A developer asked for that on 9 Oct 2026. The answer comes from
// `shopify store info`, so a repo setting or a line in CLAUDE.md cannot switch it on, and it
// switches off by itself once the store is handed to the client and leaves the Devote
// organisation.
//
// "dev" is a development store in the Partner organisation. "client-transfer" is one being
// built for a client and not yet handed over. Anything else (a client's own store, a store
// we only collaborate on, where Shopify returns no type at all) is a real shopfront.
import { execFileSync } from "node:child_process";

export const DEV_TYPES = new Set(["dev", "client-transfer"]);

export function isDevType(type) {
  return DEV_TYPES.has(String(type || "").toLowerCase());
}

/** Every store a shell command names with --store, -s or SHOPIFY_FLAG_STORE. */
export function storesInCommand(command) {
  const found = [
    ...command.matchAll(/(?:--store[=\s]+|(?:^|\s)-s\s+|SHOPIFY_FLAG_STORE=)['"]?(?:https?:\/\/)?([A-Za-z0-9.-]+)/g),
  ].map((m) => normaliseStore(m[1]));
  return [...new Set(found)];
}

export function normaliseStore(store) {
  const s = String(store || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!s) return "";
  return s.includes(".") ? s : `${s}.myshopify.com`;
}

/**
 * Ask Shopify what kind of store this is.
 * @returns {{ dev: boolean, type: string|null, error: string|null }}
 *   error is set when the question could not be answered. That is not an answer of "no":
 *   callers must refuse and say the check failed, not that the store is a real one.
 */
export function checkStore(store, { exec = execFileSync } = {}) {
  if (!store) return { dev: false, type: null, error: "no store named, so there is nothing to check" };
  let out;
  try {
    out = exec("shopify", ["store", "info", "--store", store, "--json"], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60_000,
    });
  } catch (e) {
    return { dev: false, type: null, error: `shopify store info failed: ${String(e.message).split("\n")[0]}` };
  }
  let info;
  try { info = JSON.parse(out.slice(out.indexOf("{"))); } catch { info = null; }
  if (!info || !info.subdomain) return { dev: false, type: null, error: "shopify store info returned nothing readable" };
  const type = info.type ?? null;
  return { dev: isDevType(type), type, error: null };
}
