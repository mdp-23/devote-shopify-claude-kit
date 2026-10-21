# CLAUDE.md

@DEVOTE-KIT.md

This brand's own file. The shared Devote rules load from DEVOTE-KIT.md above and update
themselves. Everything below is about this store only, and the kit never overwrites it.

## Store

**FILL THIS IN.** Which store is live and which is the dev store, the live theme id (never
pushed to), and the preview theme id that `npm run deploy` in package.json targets.

## Commands

**FILL THIS IN.** Anything this repo runs beyond the standard set in DEVOTE-KIT.md. Delete
this section if there is nothing.

## Architecture

**FILL THIS IN.** Three things a session will get wrong if it guesses:

- Which theme this is (Horizon, Dawn, a custom theme) and which files are ours.
- Where the data lives: metafield namespaces, metaobject definitions, which app owns which
  block, what is hydrated by JS rather than rendered by Liquid.
- What is deliberately unusual, so nobody "fixes" it.

## Shipping

**FILL THIS IN.** Which preview theme work goes to, and who approves it. The default route to
live: `npm run deploy`, a person checks the review link and runs `npm run approve`, then
`npm run release` (DEVOTE-KIT.md, "Approve, then release"). Say here if this store differs.

## Lessons for this brand

Bugs and corrections that only apply to this store. A lesson that would apply to any store
goes here and to Marcel, so it reaches the kit.
