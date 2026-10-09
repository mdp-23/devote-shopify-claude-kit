---
name: setup
description: Install or update the Devote Shopify kit in the Shopify repo that is open. Use when the session start says the kit is missing or out of date, or someone says "set up the kit", "update the kit", or types /devote-shopify:setup.
allowed-tools: Bash, Read, Edit, Write
---

# Set up or update the kit in this repo

Do it all yourself and keep the person's attention on their own task: one line before you
start ("Updating the Devote kit in this repo first.") and one line when done.

1. Check you are at the root of a Shopify theme or app that is a git repo (`sections/` and
   `layout/`, or `shopify.app.toml`, plus `.git`). If it is not a git repo, run `git init`
   and commit everything as "Starting point before the Devote kit" first.
2. If `git status --porcelain` shows uncommitted work, commit it first as
   "Work in progress before the kit update", so the kit's changes sit in their own commit.
3. Run from the repo root:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/install.sh"
   ```

4. If it says the gate is NOT blocking, stop. Tell them to send the output to Marcel, and
   do no Shopify work in this repo until it is fixed.
5. If it printed `MIGRATE`, this repo's CLAUDE.md is from before the kit split it into two
   files. Rewrite CLAUDE.md into the shape of `${CLAUDE_PLUGIN_ROOT}/template/CLAUDE.md`:
   - Line 3 is `@DEVOTE-KIT.md`.
   - Keep everything that is about this store: store and theme ids, commands, architecture,
     shipping, and any lessons or rules that name this brand's files or sections. Put
     brand lessons under "Lessons for this brand".
   - Drop what is already in DEVOTE-KIT.md word for word or near enough. Compare section by
     section; when unsure whether a line is the brand's, keep it.
   - If the old file was not from the kit at all (no "Never, on any store" section), keep
     all of it and only add the `@DEVOTE-KIT.md` line and the template's headings it lacks.
6. If CLAUDE.md still has a FILL THIS IN section, fill it from the code and ask only what
   the code cannot answer.
7. **Setup is not finished until the `deploy` script in package.json has all three:**
   `--store` (the `.myshopify.com` address), `--theme` (the preview theme id) and `--domain`
   (the store's real domain, e.g. `www.acme.com.au`). Without the domain, every deploy skips
   the SEO, accessibility and speed checks. Read what you can from CLAUDE.md,
   `shopify theme list --store <store>` and the live site. For anything still missing, ask the
   person in one message ("To finish setting up I need: ...") and wait for the answer. Do not
   skip this step, do not leave a FILL-IN value, and do not carry on with other work until
   `node scripts/qa/deploy-target.mjs` passes.
   Also fill `design/seo-pages.json` with the brand name and one real URL per page type
   (read them off the live site), or the SEO check reports those pages as not checked.
8. If `scripts/qa/a11y-baseline.json` does not exist and the theme was not built by this kit,
   run `npm run a11y -- --write-baseline` against the preview (`PREVIEW_URL=...`), commit the
   baseline, and tell the person the counts in one line: the theme's existing accessibility
   problems are now recorded and may only fall, and new ones fail the deploy.
9. Run `npm run qa`. A failure in a guard the kit just added is a real defect in this
   theme: say which guard and file, and leave it for the person to decide, unless they
   asked you to fix things.
10. Commit: `git add -A && git commit -m "Devote Shopify kit <version from .devote-kit-version>"`.
   Do not push.
