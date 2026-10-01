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

say "Installing the Devote Shopify kit into: $REPO"
say ""

# ---------------------------------------------------------------- sanity check
if [ "$KIT" = "$REPO" ]; then
  warn "You are inside the kit folder, not your Shopify repo."
  warn "Change into your repo first, then run this again."
  exit 1
fi

if [ ! -d .git ]; then
  warn "This folder is not a git repository."
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
cp "$KIT/scripts/qa/ship-gate.mjs" scripts/qa/ship-gate.mjs
cp "$KIT/scripts/qa/run-all.mjs" scripts/qa/run-all.mjs
cp "$KIT/scripts/qa/speed-walk.mjs" scripts/qa/speed-walk.mjs
cp "$KIT/scripts/qa/seo-walk.mjs" scripts/qa/seo-walk.mjs
cp "$KIT/scripts/qa/a11y-walk.mjs" scripts/qa/a11y-walk.mjs
cp "$KIT/scripts/qa/design-parity-walk.mjs" scripts/qa/design-parity-walk.mjs
cp "$KIT/scripts/qa/seo-basics.mjs" scripts/qa/seo-basics.mjs
cp "$KIT/scripts/qa/liquid-no-filters-in-tags.mjs" scripts/qa/liquid-no-filters-in-tags.mjs
cp "$KIT/scripts/qa/no-typed-prices.mjs" scripts/qa/no-typed-prices.mjs
cp "$KIT/scripts/qa/no-filter-inside-filter-args.mjs" scripts/qa/no-filter-inside-filter-args.mjs
cp "$KIT/scripts/qa/sized-images-shrink.mjs" scripts/qa/sized-images-shrink.mjs
cp "$KIT/scripts/qa/deferred-plugins-wait.mjs" scripts/qa/deferred-plugins-wait.mjs
mkdir -p design
cp "$KIT/scripts/upload-files.py" scripts/upload-files.py
cp "$KIT/scripts/deploy.mjs" scripts/deploy.mjs
cp "$KIT/scripts/theme-sync.mjs" scripts/theme-sync.mjs
cp "$KIT/scripts/review-stamp.mjs" scripts/review-stamp.mjs
cp "$KIT/scripts/kit-suggest.mjs" scripts/kit-suggest.mjs
mkdir -p reviews
cp "$KIT/tests/ship-gate.test.mjs" tests/ship-gate.test.mjs
cp "$KIT/tests/seo-walk.test.mjs" tests/seo-walk.test.mjs
cp "$KIT/tests/a11y-walk.test.mjs" tests/a11y-walk.test.mjs
cp "$KIT/tests/theme-sync.test.mjs" tests/theme-sync.test.mjs
[ -f design/seo-pages.json ] || cp "$KIT/seo-pages.json.example" design/seo-pages.json
say "   DEVOTE-KIT.md, scripts/qa/ship-gate.mjs, scripts/qa/speed-walk.mjs, scripts/qa/seo-walk.mjs, scripts/upload-files.py, scripts/deploy.mjs, tests/ship-gate.test.mjs, tests/seo-walk.test.mjs, design/seo-pages.json (fill in the brand and one URL per page type)"

# --------------------------------------------------------------- .shopifyignore
say "2. Protecting the merchant's theme editor settings"
touch .shopifyignore
for line in "config/settings_data.json" "templates/*.json" "sections/*.json" "locales/*.json"; do
  grep -qxF "$line" .shopifyignore || printf '%s\n' "$line" >> .shopifyignore
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
    const pre = merged.hooks.PreToolUse || (merged.hooks.PreToolUse = []);
    const already = JSON.stringify(pre).includes("ship-gate.mjs");
    if (!already) pre.push(...mine.hooks.PreToolUse);
    fs.writeFileSync(".claude/settings.json", JSON.stringify(merged, null, 2) + "\n");
    console.log(already
      ? "   your .claude/settings.json already had the gate, left it alone"
      : "   merged the gate into your existing .claude/settings.json");
  ' "$KIT/.claude/settings.json.example"
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
    for (const [k, v] of Object.entries(add)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; added.push(k); }
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
npm install --save-dev --no-audit --no-fund puppeteer-core@23 chrome-launcher@1 axe-core@4 >/dev/null 2>&1 \
  && say "   installed" || warn "   could not install; run: npm i -D puppeteer-core chrome-launcher axe-core"
grep -q '^node_modules/' .gitignore 2>/dev/null || printf 'node_modules/\n/parity/\n.deploy.lock/\n' >> .gitignore
grep -q '^.theme-incoming/' .gitignore 2>/dev/null || printf '.theme-incoming/\n' >> .gitignore
grep -q '^.theme-incoming/' .shopifyignore 2>/dev/null || printf '.theme-incoming/\n' >> .shopifyignore
grep -q '^design/' .shopifyignore 2>/dev/null || printf 'node_modules/\nparity/\ndesign/\nscripts/\n' >> .shopifyignore

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
cat > .git/hooks/pre-push <<'HOOK'
#!/bin/sh
# Claude Code's own gate only sees Claude. This covers what people type.
if node -e 'process.exit(require("./package.json").scripts?.qa ? 0 : 1)' 2>/dev/null; then
  exec npm run qa
fi
HOOK
chmod +x .git/hooks/pre-push
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

say ""
say "Done. Kit version $(cat .devote-kit-version)."
grep -q 'FILL THIS IN' CLAUDE.md && say "Left to do: fill in the FILL THIS IN sections of CLAUDE.md."
say "Then commit: git add -A && git commit -m 'Devote Shopify kit'"
