# How the Kit Is Delivered (Technical Reference)

**If you just want to use it, read START-HERE.md.**

## The plugin

This repo is a Claude Code marketplace (`devote`) holding one plugin (`devote-shopify`).
It is added to the shared admin@devote claude.ai account (claude.ai, Customize, Plugins, Add,
Add marketplace, Add from a repository: `mdp-23/devote-shopify-claude-kit`), and every Mac
signed in to the desktop app with that account loads it in the Code tab. Confirmed on a team
Mac, 1 Oct 2026: asking Claude "what devote-shopify skills do you have?" lists both skills.
Both also show in the slash menu once the app has synced.

On a machine with a different account, install it in the Code tab:

```
/plugin marketplace add mdp-23/devote-shopify-claude-kit
/plugin install devote-shopify@devote
```

plugin.json has no version on purpose, so the version is the git commit and every push reaches
everyone on their next session.

## What it does

- **SessionStart hook** (`hooks/session-start.mjs`): in a Shopify repo, compares
  `.devote-kit-version` with a hash of this kit (`hooks/kit-version.mjs`). Missing or different,
  it tells Claude to run the setup skill before anything else. Silent in any other folder.
- **`/devote-shopify:setup`**: runs `install.sh` in the open repo and commits the result.
- **`/devote-shopify:new-brand [website]`**: asks for the store's website if not given, finds its
  `.myshopify.com` address with `find-store.mjs`, then runs `new-brand.sh` in `~/Devote`.

## What install.sh puts in a brand repo

```
DEVOTE-KIT.md                 shared rules, replaced on every update
CLAUDE.md                     the brand's own file, created from template/ once, never overwritten
scripts/qa/*, scripts/*.mjs   the ship gate, deploy, guards and walks
tests/*.test.mjs              the gate's tests
.claude/settings.json         the gate as a PreToolUse hook, merged into any existing file
.shopifyignore                editor-owned files never pushed
package.json                  qa, deploy, speed, parity and seo scripts
.git/hooks/pre-push           npm run qa before any push
.devote-kit-version           which kit this repo has
```

It also installs `shopify-ai-toolkit` at project scope and checks the gate actually denies a
publish. If that check fails, the repo is unprotected: fix it before using it.

By hand, from inside a brand repo: `sh /path/to/devote-shopify-claude-kit/install.sh`.

## Prove the gate

```bash
node --test tests/ship-gate.test.mjs
printf '{"tool_input":{"command":"shopify theme publish"}}' | node scripts/qa/ship-gate.mjs
```

The second prints a deny. If it prints nothing, the hook is doing nothing.
