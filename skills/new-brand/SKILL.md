---
name: new-brand
description: Set up a new Devote Shopify brand from scratch, with a folder, the live theme, git and the Devote kit. Use when someone says "set up a new brand", "new Shopify client", "start a new store", or types /devote-shopify:new-brand with a brand name and a .myshopify.com store.
argument-hint: <brand-folder-name> <store>.myshopify.com
allowed-tools: Bash, Read, Edit, Write
---

# New brand

The person using this is usually not technical. Do every step yourself, explain nothing they
did not ask about, and only stop for the Shopify login in the browser.

Arguments: `$ARGUMENTS` (brand folder name, then the store's `.myshopify.com` address).

1. If either argument is missing, ask for it in one question: the brand's short name (lower
   case, no spaces, for example `acme`) and its `something.myshopify.com` address. The
   address is in Shopify admin under Settings, then Domains.
2. Check `node --version`. If Node is missing, stop and tell them to install the LTS version
   from https://nodejs.org and then try again.
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
   preview theme id and the store's real domain (`--domain www.acme.com.au`) into the
   `deploy` script in its `package.json`.
7. Commit in that folder: `git add -A && git commit -m "Fill in CLAUDE.md for <brand>"`.
8. Finish with one line: the brand is ready, and to start working on it they start a new
   session and choose the folder `~/Devote/<brand>`.
