---
name: new-brand
description: Set up a new Devote Shopify brand from scratch, with a folder, the live theme, git and the Devote kit. Use when someone says "set up a new brand", "new Shopify client", "start a new store", or types /devote-shopify:new-brand. Only needs the store's normal website address; it finds the .myshopify.com address itself.
argument-hint: [website, e.g. www.acme.com.au]
allowed-tools: Bash, Read, Edit, Write
---

# New brand

The person using this is usually not technical. Do every step yourself, explain nothing they
did not ask about, and only stop for the Shopify login in the browser.

Argument: `$ARGUMENTS` (optional: the store's website).

1. Check `node --version` without mentioning it. If Node is missing, stop and tell them to install the LTS version
   from https://nodejs.org and then try again.
2. If no website was given, reply with just this and wait: "What's the website of the store
   you're setting up? Paste the normal address, for example www.acme.com.au." Once you have
   it, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/find-store.mjs" <what they pasted>
   ```

   It prints the store's real `domain`, a `brand` folder name and its `.myshopify.com`
   `store`. Say them back in one line ("Found it: acme-store.myshopify.com, folder
   ~/Devote/acme.") and carry on without waiting. If it prints an `error`, tell them what it
   says in one line and ask for the `.myshopify.com` address instead (Shopify admin, Settings,
   Domains). If `~/Devote/<brand>` already exists, say so and ask whether to open that folder
   instead. If they gave a `.myshopify.com` address directly, use it.
3. Check `shopify version`. If the Shopify CLI is missing, run
   `npm install -g @shopify/cli@latest`. If that fails on permissions, stop and tell them to
   send the error to Marcel.
4. Run `mkdir -p ~/Devote`, then from `~/Devote` run:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/new-brand.sh" <brand> <store>
   ```

   Use a 10 minute timeout. Before running it, tell them a browser window will open for
   the Shopify login and they need to log in there. They must be staff on that store with
   theme access; if the pull fails, say exactly that.
5. When it finishes, check it printed "the gate refuses to publish a theme. Good." If it
   did not, stop and tell them to send the output to Marcel. Do not carry on.
6. Fill in `~/Devote/<brand>/CLAUDE.md`. Read the theme (layout, sections, config) to work
   out what you can: which theme it is, which sections are custom. The store is the one
   they gave. Ask only what the code cannot tell you, in one message: the preview theme
   to build on (or offer to create one), and anything unusual about the store. Put the
   preview theme id and the store's real domain from step 1 (`--domain www.acme.com.au`)
   into the `deploy` script in its `package.json`.
7. Commit in that folder: `git add -A && git commit -m "Fill in CLAUDE.md for <brand>"`.
8. Finish with one line: the brand is ready, and to start working on it they start a new
   session and choose the folder `~/Devote/<brand>`.
