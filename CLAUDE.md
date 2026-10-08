# The Devote Shopify kit (this repo)

This is the kit itself, published as the `devote-shopify` Claude Code plugin from the `devote`
marketplace in this repo. It is not a brand repo: never run install.sh here.

## What goes where

- `DEVOTE-KIT.md`: the shared rules every brand repo loads. New lessons from any build go
  under "Lessons from real builds".
- `template/CLAUDE.md`: what a new brand's own CLAUDE.md starts as.
- `scripts/`, `tests/`: copied into every brand repo by `install.sh`.
- `skills/`, `hooks/`, `.claude-plugin/`: the plugin. The SessionStart hook compares a brand's
  `.devote-kit-version` with `hooks/kit-version.mjs` and has Claude run the setup skill when
  they differ. `hooks/auto-update.mjs` turns on marketplace auto-update, which Claude Code
  leaves off for third-party marketplaces, so a commit here reaches every Mac after a restart
  and then every brand on its next session.

## Rules for changing it

1. **This repo is public. No client names, store addresses, theme ids or quotes that identify a
   client.** Write "a client" or "one build". `tests/no-client-names.test.mjs` fails on any name
   in `.client-names` (kept on this machine, never committed) and on any real
   `.myshopify.com` address. Add new clients to `.client-names`.
2. **No `version` in plugin.json.** The plugin's version is the commit, so every push reaches the
   team. A version field that is not bumped freezes them on the old kit.
3. A guard only goes in the kit if it works on any theme. One that scans one brand's file names
   belongs in that brand's repo.
4. Run `node --test tests/*.test.mjs` before every commit, then push. Pushing is the release.
   `.githooks/pre-commit` runs them and blocks the commit if they fail; on a fresh clone turn it
   on with `git config core.hooksPath .githooks`. Never commit with `--no-verify`.
