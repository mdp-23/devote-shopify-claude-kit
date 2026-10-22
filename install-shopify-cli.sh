#!/bin/sh
# Installs the Shopify CLI without sudo.
#
# Node from the nodejs.org installer puts npm's global folder in /usr/local, which belongs to
# root, so a plain `npm install -g` fails with EACCES. When that folder is not writable, npm is
# pointed at ~/.npm-global instead (a folder this user owns) and that folder's bin is added to
# PATH in ~/.zprofile and ~/.zshrc. Prints the shopify binary's path on the last line.
set -e

say()  { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

if command -v shopify >/dev/null 2>&1; then
  command -v shopify
  exit 0
fi

use_user_prefix() {
  USER_PREFIX="$HOME/.npm-global"
  say "   npm's global folder ($(npm prefix -g)) needs admin rights, so installing into $USER_PREFIX instead"
  mkdir -p "$USER_PREFIX"
  npm config set prefix "$USER_PREFIX"
  LINE='export PATH="$HOME/.npm-global/bin:$PATH"'
  for rc in "$HOME/.zprofile" "$HOME/.zshrc"; do
    grep -qsF "$LINE" "$rc" || printf '\n# npm global installs (added by the Devote Shopify kit)\n%s\n' "$LINE" >> "$rc"
  done
  PATH="$USER_PREFIX/bin:$PATH"
  export PATH
}

GLOBAL="$(npm prefix -g)"
SWITCHED=
if [ ! -w "$GLOBAL/lib" ] || { [ -d "$GLOBAL/lib/node_modules" ] && [ ! -w "$GLOBAL/lib/node_modules" ]; }; then
  use_user_prefix
  SWITCHED=1
fi

# The check above can miss (a folder that looks writable but is not, 22 Oct 2026), so a failed
# install into the global folder gets one retry in the person's own folder.
if ! npm install -g --no-audit --no-fund @shopify/cli@latest; then
  if [ -n "$SWITCHED" ]; then
    warn "Installing the Shopify CLI failed. Send the output above to Marcel."
    exit 1
  fi
  use_user_prefix
  if ! npm install -g --no-audit --no-fund @shopify/cli@latest; then
    warn "Installing the Shopify CLI failed. Send the output above to Marcel."
    exit 1
  fi
fi

BIN="$(command -v shopify || true)"
if [ -z "$BIN" ]; then
  warn "npm said it installed the Shopify CLI, but shopify is not on PATH ($PATH). Send the output above to Marcel."
  exit 1
fi
"$BIN" version >/dev/null
say "   Shopify CLI installed"
say "$BIN"
