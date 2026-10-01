# Start Here

The Devote Shopify kit stops Claude from breaking a client's Shopify store. It refuses to
publish a theme, refuses to push over the client's theme editor changes, and runs the checks
before anything leaves your computer.

Use the Code tab of the Claude desktop app: the kit works on folders on your own Mac, so it
does not work in the web app. Once it is installed it keeps itself up to date.

## Installing It (Once per Claude Account)

Already on the admin@devote account. For any other account, one person signed in to that
account does this once, and every Mac using the account gets it:

1. Go to claude.ai/customize/plugins.
2. Click **+ Add**, then **Add marketplace**, then **Add from a repository**.
3. Paste `mdp-23/devote-shopify-claude-kit` and click **Sync**.
4. Install **Devote shopify** from it.
5. Quit the desktop app (Cmd+Q) and reopen it. Typing `/devote-` in the Code tab should show
   `/devote-shopify:setup` and `/devote-shopify:new-brand`.

Each Mac also needs Node, once: install the LTS version from nodejs.org.

---

## Working on a brand

1. Open Claude Code.
2. Start a new session and choose the brand's folder, for example `~/Devote/acme`.
3. Ask for what you need.

If the kit in that folder is missing or out of date, Claude sets it up first and says so in
one line. You do not have to do anything.

One folder per brand, always. Never work on two brands in one folder.

## Setting up a new brand

1. Open Claude Code and start a session in any folder.
2. Type `set up a new brand`, then give Claude the brand's short name and its store address
   (Shopify admin, Settings, Domains). Or type `/devote-shopify:new-brand` and pick it from the menu.
3. A browser window opens. Log in to Shopify there. You need to be staff on that store with
   theme access.
4. Answer Claude's questions about the store.

When it is done, start a new session in the brand's new folder and work as normal.

---

## What changes for you

Claude will refuse to publish a theme. It gives you a preview link instead, which you send to
the client, and the client presses publish. If the client has approved and needs it published,
publish it yourself in the Shopify admin. Do not ask Claude to work around it.

**If Claude says it is blocked**, read the message. It says which rule stopped it and what to
do instead.

## The one habit worth having

When you find a bug, tell Claude to fix the *type* of bug, not just the one you found:

```
That price shows as $0 when there is no sale price. Fix it everywhere it can happen, and add a check so it cannot come back.
```

If the fix would help on every store, tell Marcel so it goes into the kit for everyone.

## If something looks wrong

- **Claude is blocked and you do not know why**: copy the message and send it to Marcel.
- **Claude says the gate is not blocking**: stop working in that folder and tell Marcel.
- **Anything else**: ask Claude. The rules it follows are in the folder's CLAUDE.md and
  DEVOTE-KIT.md.
