#!/bin/sh
# Devote Shopify kit installer. Run once, from inside your Shopify repo:
#
#   sh /path/to/devote-shopify-claude-kit/install.sh
#
# Safe to run twice. It never overwrites your work: anything it would replace is
# copied to <file>.before-devote-kit first, and it says what it did.
set -e

KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(pwd)"

say()  { printf '%s\n' "$1"; }
warn() { printf '!! %s\n' "$1"; }
# Appends lines to a file, on a new line even when the file does not end with one: on one repo the
# .gitignore did not, and the kit's first entry joined the repo's last line.
add_lines() {
  f="$1"; shift
  if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\n' >> "$f"; fi
  printf '%s\n' "$@" >> "$f"
}

say "Installing the Devote Shopify kit into: $REPO"
say ""

# ---------------------------------------------------------------- sanity check
if [ "$KIT" = "$REPO" ]; then
  warn "You are inside the kit folder, not your Shopify repo."
  warn "Change into your repo first, then run this again."
  exit 1
fi

# Not "[ -d .git ]": in a git worktree .git is a file, and the installer refused worktrees (21 Oct 2026).
# --show-cdup, not a path comparison: on Windows git prints D:/repo and Git Bash /d/repo for the same
# folder, so comparing them refused every repo there (Nov 2026).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1 || [ -n "$(git rev-parse --show-cdup)" ]; then
  warn "This folder is not the top of a git repository."
  warn "Open your Shopify repo and run this from there."
  exit 1
fi

if [ ! -d sections ] && [ ! -d extensions ] && [ ! -f shopify.app.toml ]; then
  warn "This does not look like a Shopify theme or app (no sections/, no"
  warn "extensions/, no shopify.app.toml). Carrying on anyway, but check you are"
  warn "in the right folder."
  say ""
fi

# ------------------------------------------------------------------- the files
say "1. Copying the files in"
mkdir -p scripts/qa tests .claude

# DEVOTE-KIT.md is the kit's and is replaced every time. CLAUDE.md is the brand's and is
# never overwritten: a new repo gets the template, an old one that does not load
# DEVOTE-KIT.md yet is reported so the setup skill can move its brand notes across.
cp "$KIT/DEVOTE-KIT.md" DEVOTE-KIT.md
if [ ! -f CLAUDE.md ]; then
  cp "$KIT/template/CLAUDE.md" CLAUDE.md
  say "   created CLAUDE.md (fill in the FILL THIS IN sections)"
elif ! grep -q '^@DEVOTE-KIT.md' CLAUDE.md; then
  say "   MIGRATE: CLAUDE.md does not load DEVOTE-KIT.md yet. It was left as it is."
fi
# Every script and test the kit has, not a hand-kept list: the list missed the visual and widths
# walks, which deploy runs, so a brand's deploy failed on scripts it never received (21 Oct 2026).
mkdir -p design reviews
for f in "$KIT"/scripts/*.mjs "$KIT"/scripts/*.py "$KIT"/scripts/qa/*.mjs; do
  cp "$f" "${f#"$KIT"/}"
done
for f in "$KIT"/tests/*.test.mjs; do
  case "$(basename "$f")" in
    find-store.test.mjs|install-retired.test.mjs) ;; # test the kit's own new-brand helper and installer, which brand repos do not have
    *) cp "$f" "tests/$(basename "$f")" ;;
  esac
done
[ -f design/seo-pages.json ] || cp "$KIT/seo-pages.json.example" design/seo-pages.json
# Scripts a brand repo had from before the kit, or the kit has dropped, that would otherwise keep
# running: npm run qa runs every guard in scripts/qa, and a hook in .claude/settings.json kept
# calling one (Nov 2026: editor-push-gate.mjs, from before the kit, failed the Windows tests).
# Each is kept as <file>.before-devote-kit, and step 3 takes its hook entries out.
RETIRED="scripts/qa/editor-push-gate.mjs"
for f in $RETIRED; do
  if [ -f "$f" ]; then
    mv "$f" "$f.before-devote-kit"
    say "   retired $f, which the kit no longer uses (kept as $f.before-devote-kit)"
  fi
done
say "   DEVOTE-KIT.md, every script in scripts/ and scripts/qa/, the tests, design/seo-pages.json (fill in the brand and one URL per page type)"

# --------------------------------------------------------------- .shopifyignore
say "2. Protecting the merchant's theme editor settings"
touch .shopifyignore
for line in "config/settings_data.json" "templates/*.json" "sections/*.json" "locales/*.json"; do
  grep -qxF "$line" .shopifyignore || add_lines .shopifyignore "$line"
done
say "   .shopifyignore now covers config/settings_data.json, templates/*.json and sections/*.json (deploy with npm run deploy)"

# ------------------------------------------------------------ .claude/settings
say "3. Turning on the safety gate"
if [ -f .claude/settings.json ]; then
  node -e '
    const fs = require("fs");
    const mine = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const theirs = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
    if (!fs.existsSync(".claude/settings.json.before-devote-kit")) fs.copyFileSync(".claude/settings.json", ".claude/settings.json.before-devote-kit");
    const merged = { ...theirs };
    merged.enabledPlugins = { ...(theirs.enabledPlugins || {}), ...mine.enabledPlugins };
    merged.permissions = { ...(theirs.permissions || {}) };
    // Older kits shipped two deny rules mixing * with :*, which never match; replace them.
    const broken = new Set(["Bash(shopify theme push:* --live:*)", "Bash(shopify theme push:* --allow-live:*)"]);
    merged.permissions.deny = [...new Set([...(theirs.permissions?.deny || []).filter((r) => !broken.has(r)), ...mine.permissions.deny])];
    merged.hooks = theirs.hooks || {};
    // Take out every hook that calls a retired script, so no hook points at a file that is gone.
    const retired = process.argv.slice(2).map((f) => f.split("/").pop());
    const dropped = [];
    for (const [event, entries] of Object.entries(merged.hooks)) {
      if (!Array.isArray(entries)) continue;
      merged.hooks[event] = entries.map((e) => {
        const hooks = (e.hooks || []).filter((h) => {
          const hit = retired.find((r) => String(h.command || "").includes(r));
          if (hit) dropped.push(event + " " + hit);
          return !hit;
        });
        return { ...e, hooks };
      }).filter((e) => e.hooks.length || !Array.isArray(e.hooks));
    }
    if (dropped.length) console.log("   took the hooks for retired scripts out of .claude/settings.json: " + dropped.join(", "));
    const pre = merged.hooks.PreToolUse || (merged.hooks.PreToolUse = []);
    // Add each gate hook from the kit whose matcher is not wired to the gate yet, so a new one
    // (the Write and Edit gate for approvals, 21 Oct 2026) reaches repos that already had the Bash one.
    const added = [];
    for (const entry of mine.hooks.PreToolUse) {
      const wired = pre.some((p) => p.matcher === entry.matcher && JSON.stringify(p).includes("ship-gate.mjs"));
      if (!wired) { pre.push(entry); added.push(entry.matcher); }
    }
    fs.writeFileSync(".claude/settings.json", JSON.stringify(merged, null, 2) + "\n");
    console.log(added.length
      ? "   added the gate for " + added.join(", ") + " to your .claude/settings.json"
      : "   your .claude/settings.json already had the gate, left it alone");
  ' "$KIT/.claude/settings.json.example" $RETIRED
else
  cp "$KIT/.claude/settings.json.example" .claude/settings.json
  say "   created .claude/settings.json"
fi

# --------------------------------------------------------------- package.json
say "4. Setting up the checks"
if [ -f package.json ]; then
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts;
    if (!fs.existsSync("package.json.before-devote-kit")) fs.copyFileSync("package.json", "package.json.before-devote-kit");
    pkg.scripts = pkg.scripts || {};
    let added = [];
    // npm init writes a "test" that only fails ("no test specified"); it counts as no script.
    for (const [k, v] of Object.entries(add)) if (!pkg.scripts[k] || /no test specified/.test(pkg.scripts[k])) { pkg.scripts[k] = v; added.push(k); }
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    console.log(added.length ? "   added scripts: " + added.join(", ") : "   your scripts were already there");
  ' "$KIT/package.json.example"
else
  node -e '
    const fs = require("fs");
    const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    fs.writeFileSync("package.json", JSON.stringify({ private: true, ...add }, null, 2) + "\n");
  ' "$KIT/package.json.example"
  say "   created package.json"
fi

# ------------------------------------------------------- walk dependencies
say "4b. Installing what the design walk needs (headless Chrome driver)"
npm install --save-dev --no-audit --no-fund puppeteer-core@23 chrome-launcher@1 axe-core@4 pngjs@7 pixelmatch@7 >/dev/null 2>&1 \
  && say "   installed" || warn "   could not install; run: npm i -D puppeteer-core chrome-launcher axe-core pngjs pixelmatch"
grep -q '^node_modules/' .gitignore 2>/dev/null || add_lines .gitignore 'node_modules/' '/parity/' '.deploy.lock/'
grep -q 'visual-baseline' .gitignore 2>/dev/null || add_lines .gitignore '/design/visual-baseline/'
grep -q '^.theme-incoming/' .gitignore 2>/dev/null || add_lines .gitignore '.theme-incoming/'
# An approval is one person's go for one release on this machine, used up by the release. Never shared through git.
grep -q '^.release-approval.json' .gitignore 2>/dev/null || add_lines .gitignore '.release-approval.json'
# A store that has not launched: the storefront password the walks use to open the myshopify.com preview.
grep -q '^.storefront-password' .gitignore 2>/dev/null || add_lines .gitignore '.storefront-password'
grep -q '^.theme-incoming/' .shopifyignore 2>/dev/null || add_lines .shopifyignore '.theme-incoming/'
grep -q '^design/' .shopifyignore 2>/dev/null || add_lines .shopifyignore 'node_modules/' 'parity/' 'design/' 'scripts/'

# -------------------------------------------------------------------- plugin
say "5. Installing the Shopify plugin for Claude"
if command -v claude >/dev/null 2>&1; then
  claude plugin install shopify-ai-toolkit@claude-plugins-official --scope project --yes \
    && say "   installed" \
    || warn "   could not install it. Open Claude Code and run: /plugin"
else
  warn "   the claude command is not on your PATH. Skipping the plugin."
fi

# ------------------------------------------------------------------ git hook
say "6. Installing the git hook"
# git's own hooks folder, not .git/hooks: in a worktree .git is a file
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"
cat > "$HOOKS_DIR/pre-push" <<'HOOK'
#!/bin/sh
# Claude Code's own gate only sees Claude. This covers what people type.
# SKIP_QA=1 git push skips it, the same bypass the gate and deploy take; say so in the handover.
if [ "$SKIP_QA" = "1" ]; then
  echo "Pre-push checks SKIPPED (SKIP_QA=1): pushing unchecked."
  exit 0
fi
if node -e 'process.exit(require("./package.json").scripts?.qa ? 0 : 1)' 2>/dev/null; then
  exec npm run qa
fi
HOOK
chmod +x "$HOOKS_DIR/pre-push"
say "   done"

# -------------------------------------------------------------------- verify
say ""
say "7. Checking the gate actually works"
if printf '{"tool_input":{"command":"shopify theme publish"}}' | node scripts/qa/ship-gate.mjs | grep -q deny; then
  say "   the gate refuses to publish a theme. Good."
else
  warn "   THE GATE IS NOT BLOCKING. Do not rely on it. Send this output to Marcel."
  exit 1
fi

node "$KIT/hooks/kit-version.mjs" > .devote-kit-version
# An empty file reads as "no kit" to the session hook, which then asks for setup every session.
if [ ! -s .devote-kit-version ]; then
  warn "Could not work out the kit version (.devote-kit-version is empty). Send this output to Marcel."
  exit 1
fi

say ""
say "Done. Kit version $(cat .devote-kit-version)."
grep -q 'FILL THIS IN' CLAUDE.md && say "Left to do: fill in the FILL THIS IN sections of CLAUDE.md."
node scripts/qa/deploy-target.mjs >/dev/null 2>&1 || say "Left to do: package.json's deploy script needs --store, --theme and --domain. Ask for whatever is missing before finishing."
say "Then commit: git add -A && git commit -m 'Devote Shopify kit'"
