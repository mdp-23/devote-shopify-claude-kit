#!/bin/sh
# Set up a brand from scratch: a folder, the live theme, git, and the kit.
#
#   sh /path/to/devote-shopify-claude-kit/new-brand.sh acme acme-store.myshopify.com
#
# Creates ./acme in whatever folder you are currently in. Run it from wherever
# you keep client work, for example ~/Devote.
set -e

KIT="$(cd "$(dirname "$0")" && pwd)"
BRAND="$1"
STORE="$2"

say()  { printf '%s\n' "$1"; }
warn() { printf '!! %s\n' "$1"; }

if [ -z "$BRAND" ] || [ -z "$STORE" ]; then
  say "Usage: sh new-brand.sh <brand-folder-name> <store>.myshopify.com"
  say ""
  say "Example:"
  say "  sh new-brand.sh acme acme-store.myshopify.com"
  exit 1
fi

case "$STORE" in
  *.myshopify.com) ;;
  *) warn "The store should end in .myshopify.com (you gave: $STORE)"; exit 1 ;;
esac

if [ -e "$BRAND" ]; then
  warn "There is already something called '$BRAND' here."
  warn "If that is this brand's existing folder, open it and run install.sh instead."
  exit 1
fi

# --------------------------------------------------------------- prerequisites
say "Checking what is installed"

if ! /usr/bin/env which node >/dev/null 2>&1; then
  warn "Node is not installed, and both the Shopify CLI and this kit need it."
  warn "Install it from https://nodejs.org (take the LTS version), then run this again."
  exit 1
fi
say "   node: yes"

if /usr/bin/env which shopify >/dev/null 2>&1; then
  say "   Shopify CLI: yes"
else
  say "   Shopify CLI: not installed"
  printf "   Install it now? This runs: npm install -g @shopify/cli@latest  [y/N] "
  read -r reply
  case "$reply" in
    [Yy]*)
      npm install -g @shopify/cli@latest || {
        warn "That failed. It is usually a permissions problem with npm."
        warn "Ask Marcel, or try: sudo npm install -g @shopify/cli@latest"
        exit 1
      }
      ;;
    *)
      warn "Cannot continue without it. Install it yourself with:"
      warn "  npm install -g @shopify/cli@latest"
      exit 1
      ;;
  esac
fi

# ------------------------------------------------------------------ the folder
say ""
say "Creating $BRAND"
mkdir "$BRAND"
cd "$BRAND"
git init -q .

# ------------------------------------------------------------------- the theme
say ""
say "Downloading the live theme from $STORE"
say "A browser window will open so you can log in to Shopify. That is expected."
say ""
if ! shopify theme pull --store "$STORE" --live --path .; then
  warn ""
  warn "The download failed. The usual causes:"
  warn "  - you are not a staff member on $STORE, or lack theme permissions"
  warn "  - the store name is wrong"
  warn "Nothing was installed. Fix the access and run this again."
  cd ..
  rm -rf "$BRAND"
  exit 1
fi

git add -A
git commit -qm "The live theme as it stood on $(date '+%d %b %Y')"
say ""
say "Saved the live theme as your starting point, so you can always get back to it."

# --------------------------------------------------------------------- the kit
say ""
sh "$KIT/install.sh"

git add -A
git commit -qm "Add the Devote Shopify kit"

say ""
say "----------------------------------------------------------------"
say "$BRAND is ready at $(pwd)"
say "In Claude Code, start a new session in that folder and ask Claude to fill in CLAUDE.md."
