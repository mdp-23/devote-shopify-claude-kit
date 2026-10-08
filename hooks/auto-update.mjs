// Turns on auto-update for this kit's marketplace in the person's ~/.claude/settings.json.
//
// Claude Code does not auto-update third-party marketplaces unless asked, so without this a push
// to the kit never reaches anyone: their plugin stays on the commit they first installed. Called
// from the SessionStart hook on every session, so it fixes itself on any Mac the plugin is on.
// Only writes when something is missing, and never touches a settings file it cannot parse.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const REPO = "mdp-23/devote-shopify-claude-kit";

export function withAutoUpdate(settings) {
  const markets = settings.extraKnownMarketplaces ?? {};
  const entry = markets.devote ?? { source: { source: "github", repo: REPO } };
  if (entry.autoUpdate === true) return null;
  return { ...settings, extraKnownMarketplaces: { ...markets, devote: { ...entry, autoUpdate: true } } };
}

export function enableAutoUpdate(file = join(homedir(), ".claude", "settings.json")) {
  try {
    const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const next = withAutoUpdate(settings);
    if (!next) return false;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}
