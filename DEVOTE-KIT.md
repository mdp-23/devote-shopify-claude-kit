# Devote Shopify Kit

The shared rules for every Devote Shopify repo. CLAUDE.md loads this file, and the
Devote Shopify plugin replaces it whenever the kit changes, so never edit it in a brand
repo: the edit is lost on the next update. Anything about this store goes in CLAUDE.md.

## How this file works

Every rule below is either a safety rule or a bug that has already shipped
somewhere. Add to it the same way: a defect becomes a fix, a guard in
`scripts/qa/` that fails the build if it returns, and a line under "Lessons for this
brand" in CLAUDE.md. If the lesson would apply to any store, also tell Marcel so it
reaches the kit and every other brand.

A correction from a person is a defect report. Fix the class it belongs to, not
the instance in front of you.

Do not delete rules because they look obvious. They all look obvious afterwards.

---

## Never, on any store

1. **Never push to the live theme.** Not `--live`, not `--allow-live`, not by
   publishing what you pushed. Push unpublished, hand over a preview link, the
   client publishes.
2. **Never push `config/settings_data.json` or `templates/*.json`** unless that
   is the change and you just pulled them. They hold the merchant's theme editor
   work. A stale copy reverts it silently and the CLI says nothing.
3. **Never run a write script against a live store.** Use a development store.
4. **Never edit a client's theme in the admin code editor** while a repo exists.
   The next push overwrites it.
5. **Never commit a token.** A leaked Admin token is read and write on a live
   shopfront.

If a task needs one of these, say so rather than finding a way around it.

## Several people on one theme

Deploy never pushes an old copy over someone else's work. Before pushing, it pulls the theme's
code and compares each file with `.theme-baseline.json` (the theme as it was at this repo's last
sync; commit it):

- Someone else changed a file you did not touch: their version comes into the repo and nothing
  is pushed. Review `git diff`, commit, deploy again.
- You both changed the same file: their version goes in `.theme-incoming/` and nothing is pushed.
  Merge it into yours (keep both changes), delete `.theme-incoming/`, deploy again. Deploy refuses
  while that folder has anything in it.
- The first deploy from a repo to a theme has no record to compare with. If nobody else has
  pushed to that theme, `npm run deploy -- --first-sync`. If someone may have,
  `npm run deploy -- --pull` first and read the diff.

Two people deploying in the same few seconds can still race. Say in the team chat before a
deploy when someone else is on the same theme.

## What every deploy runs

`npm run deploy` refuses to push until the code review and security review are stamped (below)
and `npm run qa` passes. After pushing to the preview theme it runs `npm run seo`,
`npm run a11y`, `npm run widths` and `npm run speed` on `https://<domain>/?preview_theme_id=<id>` and exits 1 if any fails, so a
deploy that exits 0 has passed all seven. The domain comes from `--domain` in package.json's
deploy script. `--skip-walks` skips the walks while iterating and says so; the deploy before
a handover is always a full one.

## Accessibility

`npm run a11y` runs axe-core against WCAG 2.2 A and AA on every page in `design/seo-pages.json`,
at 390px and 1440px. Critical and serious problems fail the deploy; moderate and minor ones go
in the handover report. An older theme that arrives with problems gets a baseline
(`npm run a11y -- --write-baseline`, commit `scripts/qa/a11y-baseline.json`): its counts may only
fall, and a rule that was clean stays clean. Fix the class, not the element: a missing button
name on one product card is missing on every card that snippet draws. Axe cannot judge
everything (focus order, whether alt text is accurate, keyboard traps in a custom drawer), so
tab through any menu, drawer or modal you build before handing over.

## Reflect after every deploy

After any deploy that failed a check, and after any correction from a person, stop and write the
lesson down before moving on:

1. Fix the class, not the instance, and add a guard in `scripts/qa/` that fails if it returns.
2. If the lesson is about this store only, add it under "Lessons for this brand" in CLAUDE.md.
3. If it would help on any store, send it to the kit review:
   `node scripts/kit-suggest.mjs --lesson "..." --rule "..." --happened "..."`
   Never edit DEVOTE-KIT.md in a brand repo: it is replaced on the next update. Marcel reviews the
   suggestions weekly and what he approves reaches every Mac.

A deploy that passed first time with no corrections needs no reflection.

## Review before every code deploy

`npm run deploy` refuses to push theme code that /code-review and /security-review have not
seen. After changing any section, snippet, block, layout, asset, locale or the settings schema:

1. Run `/code-review` on the changes, then `/security-review`. Fix what they find.
2. Save each review's findings, and what you fixed, to `reviews/<date>-code-review.md` and
   `reviews/<date>-security-review.md`.
3. `npm run review:stamp -- --code reviews/<file> --security reviews/<file>`, then deploy.

The stamp is a hash of the code files; any change after it needs another review. Template and
settings JSON (editor content) deploy without one. Commit the reports and `.review-stamp.json`.
Why: Marcel, 1 Oct 2026, "make sure it runs a code review and security review before deploying".

## Pull first, every time, and deploy only with `npm run deploy`

People edit the theme in the editor while you build: templates, section groups, settings.
A plain `shopify theme push` sends your stale copy of those files and wipes their work.

```bash
npm run deploy                  # code only; editor-owned files never leave this machine
npm run deploy -- --with-json   # also your template/settings changes, only if nobody touched them
npm run deploy -- --pull        # bring editor changes into the repo
```

Editor-owned: `templates/*.json`, `config/settings_data.json`, `sections/*.json`. The
deploy pulls them first and compares with `.editor-baseline.json`. If the theme changed,
it copies their files into the repo and pushes nothing: review, commit, run again. The
ship gate blocks `shopify theme push --path` or `--only` on those files, because pushing
them from a temp folder is how the editor's work gets overwritten.

Exists because on one build the client changed the homepage video and copy in the editor
mid-build, and one more push of `templates/index.json` would have erased it.

---

## Commands

This store's own commands, store and theme ids are in CLAUDE.md. The standard set, theme:

```bash
shopify theme dev --store <store>     # local preview on :9292
shopify theme check                   # the linter
shopify theme push --unpublished      # first push of a new preview theme only; after that, npm run deploy
shopify theme share                   # preview theme plus a shareable link
npm run qa                            # scripts/qa plus theme check
npm run speed                         # Lighthouse, preview vs live, before every handover
npm run parity                        # design and preview side by side, every section and state
npm run seo                           # on-page SEO on the preview, one page per type, before every handover
npm run a11y                          # WCAG 2.2 AA (axe-core) on the preview, phone and desktop, before every handover
npm run widths                        # buttons, chevrons and the header at ten widths, 390px to 1920px
npm run deploy                        # the only push: QA, push, then SEO and speed on the preview
npm run deploy -- --skip-walks        # while iterating; never the deploy before a handover
```

App:

```bash
shopify app dev
shopify app deploy                    # new app version: config plus extensions
npm run qa                            # scripts/qa, typecheck, tests
```

`npm run qa` runs on every push, so it must be fast and must need nothing the
repo does not declare: no browser, no store credential, no network. Anything
needing a real store or browser is a `*-walk.mjs` run by hand.

## Architecture

CLAUDE.md holds the three things a session will get wrong if it guesses. If any is
missing there, fill it in before building:

- Which store is production, which is the dev store, which theme id is live.
- Where the data lives: metafield namespaces, metaobject definitions, which app
  owns which block, what is hydrated by JS rather than rendered by Liquid.
- What is deliberately unusual, so nobody "fixes" it.

---

## Liquid fails silently

`{{ prodcut.title }}` is not an error, it is a blank space. A filter on nil
returns nil. A broken `{% schema %}` removes the section from the editor with no
message. The page still renders, it is just wrong.

- **A blank is a defect until proven otherwise.** Look for the thing you expected,
  not at the page.
- **Run `shopify theme check` before every push.**
- **`{% render %}`, never `{% include %}`.** Isolated scope. `include` is
  deprecated and lets two sections fight over `forloop`.
- **Guard every metafield.** Unset is nil, and unguarded that is an empty heading
  with nothing under it.

### Filters inside if and for are ignored

`{% if a == a | upcase %}` compares the raw value and `{% for w in t | split: ' ' %}` loops
over nothing. No error, no warning. Assign the filtered value first, then test or loop over
it. `liquid-no-filters-in-tags.mjs` fails on the pattern.

### Absent must never look like zero, or like failed

The highest consequence bug class in commerce, because the wrong version is quiet.

- No `compare_at_price` is not 0% off.
- An unfilled metafield is an unasked question, not an empty answer. Render
  nothing, never a zero or a dash.
- A failed call returning `[]` is not "no orders". Separate "checked, nothing
  there" from "could not check", in the data and on screen.
- `all_products` caps at 20 lookups per page, `paginate` at 50. A list that stops
  at the cap is not the whole list. Say so.

### Money is not a number

- Shopify gives a decimal string with a currency code, or cents in the Cart API.
  Never parse either to a float. Work in minor units, format at the edge.
- **Never hardcode a currency symbol.** Use the `money` filters, or a two market
  store renders `$` for both.
- Tax inclusive and exclusive is per market, so the admin and the page
  legitimately differ. Name which you are showing.

### Not what they look like

- **Inventory is per location.** The sum is not what a customer can buy.
- **A product can exist and not be purchasable**, if it is not published to the
  Online Store channel. 404 on the storefront, fine in the admin.
- **"Today" is ambiguous.** Admin is shop local, the API is UTC. Fix a timezone
  and name it.
- **The theme editor is not the storefront.** `Shopify.designMode`, different
  section events, different app block behaviour. Editor-only is not verified.

---

## Verifying a change

### Verify on a preview theme, not in isolation

`shopify theme push --unpublished --json` gives you the URL. Open the storefront
preview, not the editor. Check 375px and a desktop width, and measure:

```js
// If these disagree, something inside has a min-content wider than the column.
[document.documentElement.scrollWidth, document.documentElement.clientWidth];
```

For a long unbroken token (URL, SKU, customer input) the fix is
`overflow-wrap: anywhere`. `break-word` does not reduce min-content width, so a
shrink to fit container still sizes to the longest run.

### Enumerate the states in a file

A state nobody wrote down is a state nobody checked. At minimum:

- Sold out, and in stock.
- One variant, and forty.
- No image, one, and a gallery.
- No `compare_at_price`, and on sale.
- Longest and shortest title in the catalogue.
- Logged out, and logged in with orders.
- Empty cart, and a cart at the free shipping threshold.
- A second market, with its currency and tax rule.

Put the list in `scripts/qa/<feature>-walk.mjs`. Fixing one state is half a fix:
ask which states share the shape.

### Performance

Judged on Core Web Vitals whether or not anybody asked. Before a PR:

- Every image through `image_url: width: N`, `loading="lazy"` below the fold. A
  full size image scaled in CSS is the usual bad LCP.
- No new render blocking script, no jQuery, no library for one animation.
- **Mobile performance must score above 80.** `npm run speed` runs Lighthouse on the
  preview against live, median of three runs, and exits 1 at 80 or below, or when the
  preview is slower than live. Numbers go in the PR or the handover message. Worse numbers
  are the report, and the work is not finished.
- **PageSpeed Insights cannot test a preview theme.** It drops `preview_theme_id` and
  quietly tests the live site. Use `npm run speed`, with the preview on the store's real
  domain (`https://<domain>/?preview_theme_id=<id>`): the myshopify.com address adds a
  redirect that costs about 10 points and that no real visitor pays.
- **A hero video is not the LCP.** Render the poster as a responsive image with
  `fetchpriority="high"`, attach the video after `load` from the smallest MP4 that fits
  the screen, fade it in once playing. Straight `video_tag` autoplay made LCP 6 to 10 s.
  Put the poster on the `<video>` itself (`poster` attribute, plus a preload with
  `fetchpriority="high"`), not as a separate image behind it: Chrome counts a video's first frame
  as a paint, and on a separate element that frame, seconds after load, replaced the poster as LCP
  (a client homepage, 1 Oct 2026: mobile LCP 28 s; with the attribute 3.3 s, score 48 to 79). Where
  Liquid offers only a large MP4, phones that play HLS natively can take the `m3u8` source instead.

### SEO checks

**Run `npm run seo` before every handover. FAILs block the handover; WARNs go in the report.**
`PREVIEW_URL='https://<domain>/?preview_theme_id=<id>' npm run seo` opens one page per type
(listed in `design/seo-pages.json` with the brand name, or `SEO_PAGES=/,/products/x`), strips
the preview bar and preview parameters so it reads what visitors get, and checks:

| Check | FAIL | WARN | Why |
| --- | --- | --- | --- |
| H1 | not exactly one, hidden ones included | | audit tools flag a second H1, and a client homepage shipped one |
| Heading order | a level skipped (H1 then H3) in `<main>` | | screen readers navigate by the outline |
| Title | missing, same as another page, brand twice from the suffix | outside 30 to 60 characters | Google cuts titles at about 600 px and wants one per page |
| Meta description | missing, doubled, same as another page | outside 70 to 160 characters | Google builds a snippet from the menu when there is none |
| Canonical | missing, relative, a variant or preview URL, another page | a `?view=` template canonicalising to the default | Google indexes the canonical, not the page you built |
| Indexing | noindex on a real page, search pages indexable, no `lang` | | search results are thin pages Google should not index |
| Images in `<main>` | no alt attribute | empty alt on a content image, alt stuffing | empty alt is right only for decoration (W3C) |
| Open Graph | no og:title, description, type or url | no og:image | shares show an empty card |
| JSON-LD | does not parse; Organization url not the homepage; no Organization or WebSite on home, Product with offers on products, BreadcrumbList on collections, products and articles, Article on articles | empty fields (a blank product description) | what Google reads for rich results |
| Links | 404, or a redirect chain | one redirect | dead ends and wasted crawl |
| Site | robots.txt or sitemap.xml missing, `Disallow: /` | | crawlers find every page through them |

`scripts/qa/seo-basics.mjs` holds the same line in the code, in `npm run qa`: no H1 in the
header or footer groups, one hard-coded H1 on the homepage, and the title, canonical,
description and `lang` tags in place. A page the walk could not load is NOT CHECKED and
exits 1, never a pass.

---

## Apps

Delete this section in a theme repo.

- **GraphQL, not REST.** REST is legacy.
- **One API version, in one module.** Versions are quarterly with a limited
  support window, so a version scattered across ten files is an outage with a
  date on it.
- **Rate limits are cost based.** Read `extensions.cost.throttleStatus` and back
  off on it rather than assuming a requests per second figure. Bulk Operations
  for anything large.
- **Cursors, never page numbers.**
- **Webhooks: verify, respond, then work.**
  - HMAC against the **raw** body. Parsing and re-stringifying breaks every
    signature.
  - 200 within the timeout, work in a queue.
  - **At least once delivery, so handlers are idempotent.** Key on the webhook id.
  - Public apps need the compliance webhooks (`customers/data_request`,
    `customers/redact`, `shop/redact`) to actually do the thing.
- **Read every write's errors.** A 200 with `userErrors` populated is a failure,
  and an unread one is a change you told the client you made.

---

## Lessons from real builds

Each of these reached a client review once. They are here so they reach nobody else.

### Check every width, and look at what renders

- **Phones and 1440px are not the only screens.** Laptops (990px to 1400px) and tablets (768px)
  are where a split section squeezes its text column and a long header menu runs into the icons.
  `npm run widths` measures ten widths on every page in `design/seo-pages.json`. On one build a
  button broke over two lines at 1000px and the menu sat under the search icon from 768px to
  1180px, and every check at 390px and 1440px passed.
- **An accessibility fix is a visual change.** Growing a control to the 24px WCAG target moves
  anything Horizon positions with `translateY(-50%)` by half the new height: a menu chevron rose
  12px. Changing a Horizon component's markup (a `<ul>` to a `<div>` with `role="list"`) can break
  its script: `overflow-list.js` type-checked for `<ul>` and `<li>`, threw, and the menu's "More"
  overflow stopped. After any a11y fix, screenshot the component and read its JS for
  `instanceof` checks. Guard: `overflow-list-accepts-its-markup`.
- **A label that mixes words and a price goes in one `<span>`.** In a flex button, the money
  filter's own `<span>` becomes a separate flex item and the spaces around it vanish
  ("AROUND$530").
- **Check what is on screen, not the DOM text.** `textContent` read "Around $530" while the page
  showed "AROUND$530". Open every screenshot and look at it; the walk measures gaps on screen.
  Steps of a multi-step form that start hidden get `data-step` so the walk opens and measures them.

### Match the design, not just the brief

- **Run `npm run parity` and open every picture before anyone else sees the build.** The
  design goes in `design/` as HTML (export the board, images in `design/img/`), and
  `design/parity.json` lists every section and state: each at desktop and 390px, plus open
  menus, cart with items, filled forms. The walk renders design and preview side by side into
  `parity/*.png`. The pictures are the check; a guard passing proves nothing about looks.
  It exists because a client found, by hand, a dropdown, a footer, a button position and a
  video row that did not match the board, after every automated check had passed.
- **Put the build next to the design, section by section, before anyone else sees it.**
  Rendering, no overflow and working interactions are not the check. The check is: same
  order, same elements in the same places, same behaviour. "Choose your material" under
  the carousel instead of in the heading row, and tabs that navigated instead of
  filtering, both passed every automated check.
- **Behaviour is part of the design.** Tabs above a carousel switch the carousel in
  place. They are buttons with `role="tab"`, never links out to a collection.
- **If the design says video, ship a video.** A still with a video slot is unfinished.
- **Every interactive state gets its own row in `parity.json`: hover each menu item, not
  just the one with a dropdown.** Hovering a plain item made Horizon's header go solid white
  while the text stayed white, and nobody had hovered anything but "Fins".
- **Measure spacing, don't eyeball it.** A state can carry a `check` script that returns a
  list of problems; the walk fails on any. The menu's 22px gaps and the chevron's 5px offset
  are measured on every run, because a crowded menu item passed a screenshot review.
- **Research before asking the client.** If the answer is in their product data, catalogue,
  videos or reviews, find it (one client's product rule was in every product's option labels) and
  cite it. Ask only what no source can answer.
- **A stock theme's header and footer are not the design.** Horizon's mega menu is full
  width with a sliding panel and turns the header dark while open; its footer prints menu
  titles as column headings. Both needed overriding or replacing to match a board. Check them
  in the walk like any section.
- **Port every state the design shows, not only the layout.** The pulsing red cart glow for
  a cart with items was signed off on the board and never made it into the theme. List the
  states in the design (hover, active, cart with items, sticky header, empty and filled) and
  tick each one off on the preview.
- **A multi-step selector guides people through it.** Number the steps 1, 2, 3; the next
  unanswered step pulses; the result waits for every answer, then lights up (and scrolls into
  view on a phone). An instruction line people have to read is not guidance.
- **Text over a photo or video must be readable.** A transparent header over the hero
  needs its light text colour set; the default is dark text on a dark video. A frosted
  header (and its dropdown panel) needs a little smoke in the glass, a near-black rgba of
  .15 or more, at every width: white glass alone vanishes over a pale frame of the film.
  A fix reported on one screen size is a fix for all of them; one went into a phone
  media query and came back from desktop the same day. Write a guard for this theme's header CSS.
- **Proof-point icons are drawn once, in a shared snippet, and say something about the brand.**
  A stock clock and a cartoon hand on a trust bar read as cheap (1 Oct 2026). Use marks
  with meaning: a laurel for heritage, the country outline with the workshop town dotted for
  "made by hand". Every place that shows the same proof (homepage strip, product page row)
  renders the same snippet, and each icon is checked at its real size, not blown up.
- **Check scale at a real viewport.** Sizes lifted from a 1440px board looked oversized
  on a laptop: buttons went from 62px to 48px, headings down a step.
- **On-page copy follows the brand voice, placeholders included.** "Three questions away"
  read as AI. "Fill in the questions to the left to find your perfect match" did not.
  Where a line points at layout ("to the left"), give phones their own wording ("above").

- **Know what a variant option means before you draw it.** One client's Black/White option is
  the fin's rail colour, not the design's colour, so colour swatches on the cards told
  people a design came in two colourways. Read the option against the product photos; if it
  is not the thing the swatch would show, leave swatches off.
- **Treat every image in a card the same way.** Stores mix studio shots on white with
  lifestyle photos, and the hover image is often the studio one. If the first image
  multiplies into a tinted well, the second must too, or hover flashes a white box.
- **A result button names the result.** "Shop Composite Soft Flex Fins", built from the
  result, beats a generic "Choose your pattern". Keep prices out of a recommendation;
  the product page carries them.
- **Every piece of client feedback that touched a design choice goes back into the design
  file as well as the theme,** or the parity walk starts flagging the fix as a miss.

- **Split a multi-page build so builders never share a file.** Each page gets its own
  section, snippet and asset prefix, its own `design/parity/<page>.json`, and its own
  template JSON pushed with `npm run deploy -- --with-json --json templates/<its>.json`.
  Shared pieces (the product card, the header, the stylesheet) are extracted before the
  split and owned by one person. `npm run deploy` takes a lock, so parallel deploys queue.

- **A change to a shared class gets the full walk, never a filtered one.** On one build a
  `flex: 1 1 0` added to `.dv-split > .dv-media` to fix one section collapsed another section's photo
  in another to 0px, because that section's own rule had turned off grow and shrink. The walk
  was run for the section being fixed only. Run `npm run parity` with no filter after any edit
  to shared CSS, and read the failures before deploying anything else.
- **A zero-size box is broken, never "not visible".** A check that skips elements with no
  width passes the exact bug it exists for. Skip only what is not rendered
  (`!el.getClientRects().length`); a rendered box of 0px fails. The walk now fails any state
  with a visible image collapsed to nothing, whatever the state is about.
- **Photos keep their colour.** Text over a photo sits on a bottom blur that fades out
  upwards (`.dv-fade`: masked backdrop blur, a light tint only at the very bottom). No dark
  layer across the whole image, no multiply tint, no desaturate filter. Write a guard for this theme's
  own sections that fails on a full-cover layer still dark at the top.
- **An image box sets the size and the photo crops to it.** `object-fit: cover`, image
  absolute inside a box with its own height or aspect ratio. A tall upload loses top and
  bottom, a wide one loses the sides; the photo never decides how wide its box is.
- **Product shots blend like the product cards wherever they appear.** A picked image of a
  product on white shows as a white box; pick the product and render its featured image,
  multiplied into the tinted background.

- **Horizon ships SEO defects; fix them on day one.** A hidden shop-name H1 on the homepage
  (two H1s with the hero), an Organization `url` built from the current page, indexable
  search pages, a title suffix that doubles when a merchant's SEO title already names the
  brand, and no description where the merchant left one blank. `seo-basics.mjs` guards all
  of them. Fallback descriptions must be true for every product type: "handmade" on a
  fallback reached products made overseas before it was caught.

- **A check that returns nothing is not a pass.** A `check` written as a bare arrow function
  was evaluated to the function itself, read as "no problems", and passed eight states while the
  menu it guarded was covered. The walk now calls a function check and fails anything that is not
  a list. Prove every new check by breaking the thing it guards and watching it fail.
- **Page layers stay under the header.** Filter bars, sort menus and sticky bars use Horizon's
  layer scale (`var(--layer-raised)`, `--layer-heightened`, `--layer-sticky`), never a raw
  z-index of 12 or more, or the header's dropdown slides under them. Guard this theme's own CSS for it.
- **Open the cart drawer at the click.** Shopify takes 0.75 to 3 s to add a line (the first add
  of a visit creates the cart). Horizon fires its cart event before the request, so open the
  drawer then, with a solid "Adding to cart" state, and let the response fill it.
- **A secondary button beside a primary one matches its height.** The walk fails a mismatched pair.

- **content-visibility cuts a blend off from its backdrop.** `content-visibility: auto`,
  `contain: paint`, `isolation` and opacity each start a new group, so a `mix-blend-mode:
  multiply` image inside can only blend with what is inside that group. Put the tinted
  background on the contained element itself. The walk fails a multiplied image cut off this way.

- **Collection copy goes under the products, not above them.** The top of a collection shows
  its title and one sentence with "Read more"; the full description sits in an About block
  below the grid. A block of copy above the products makes shoppers bounce (Marcel, 1 Oct 2026),
  and search engines read it wherever it is.
- **Never type a price into copy.** Descriptions, meta descriptions, articles, section defaults:
  prices change and nobody updates the copy. Prices come from the product's price field only.
  `no-typed-prices.mjs` fails on a "$" amount in templates, section groups and setting defaults.

- **Sideways rows load ahead.** Native lazy loading waits until each card in a horizontal
  row is scrolled to, so on a slow connection the row fills in card by card (1 Oct
  2026). After `load`, observe each row and switch its lazy images to eager when it comes
  within a screen. On desktop Horizon scrolls the page inside `.page-wrapper`: an observer
  rooted on the viewport is clipped at the fold and never fires early, so root it on the
  wrapper when that is the scroller. Test with a throttled headless Chrome, never the app's
  browser pane: a hidden pane never fires IntersectionObserver at all.

- **iOS will not swipe a row inside `content-visibility: auto`.** Every iPhone browser is
  WebKit, and WebKit does not touch-scroll a container whose content grows after it is created,
  which is what content-visibility does to a row below the fold (a "Shop the range" row, Chrome
  on iPhone). A trackpad still scrolls it and Chrome's swipe emulation passes, so only a real
  iPhone shows it. Under `@supports (-webkit-touch-callout: none)`, give any content-visibility
  holder that `:has()` a sideways row `content-visibility: visible`. Lighthouse runs Chrome, so
  scores do not move.
- **Every sideways scroller is `position: relative`.** A scroller only clips what it
  contains, and an absolutely placed child (a visually hidden label in a card) belongs to the
  nearest positioned ancestor. Placed against the section, the labels sat outside the row and
  the page swiped sideways into white space on iPhones, once content-visibility (whose paint
  containment had hidden it) was turned off there. The parity walk now fails any state where
  the page scrolls sideways with content-visibility forced off.
- **Horizon colours every `<summary>` on hover, and a phone tap leaves hover stuck.** On a dark
  footer the tapped accordion heading went black on black. Reset it once for the brand's
  own markup: `:is([class*="dv-"], [class*="dv-"] *) > summary:hover { color: inherit }`, and
  tap every accordion on a dark surface at 390px before handing over.
- **A full-photo section fits one screen under the sticky header.** Desktop height
  `min(<design height>, 100svh - var(--header-height))`; on phones the photo takes what the text
  panel leaves (clamp) and long copy is cut to one paragraph. Measure at 1440x900, 1280x720,
  390x844 and 375x667 (1 Oct 2026).
- **One tap plays a YouTube film on a phone only if the player exists before the tap.** A player
  built on the tap starts after it, iOS does not count that as the visitor's gesture, and YouTube
  shows its own play button. Build the player under the poster as the card comes into view, set
  the poster to `pointer-events: none`, fade it when the player reports playing.
- **Dots and ticks under a slider are buttons.** Visitors click them. A labelled button with a
  44px (or 24px on dense dots) hit area, drawn small with a pseudo-element.
- **Tabs load ahead too.** A hidden tab panel's lazy image only starts when the tab is
  clicked, a one to two second blank on every tab. When the section nears
  the screen, switch hidden panels' images to eager (and the first few cards of a hidden row).
- **Every sideways row that overflows has arrows on desktop.** Render them always and hide
  them in JS when the cards fit; never behind a "show arrows" setting, which left a row that
  could not be moved with a mouse. The parity walk fails an overflowing row with no arrows.
- **A cropped photo keeps its subject.** Images fill their box, so a portrait photo in a
  landscape box on a phone can lose the person entirely (a swimmer under a yacht read as a
  yacht). Give image blocks a focus setting (object-position), default the image's Shopify
  focal point, and look at every crop at 390px and desktop before handing over.
- **Button labels stay on one line.** A derived label ("Shop Composite Medium Flex Fins")
  wrapped on phones. Size for the longest label at 360px; the parity walk fails a wrapped one.
- **A push "with errors" exits 0.** Shopify keeps the old copy of every file it rejects (an invalid
  schema, a Liquid syntax error) and the CLI still prints success. `npm run deploy` now pushes with
  `--json` and stops on any rejected file (1 Oct 2026: the header never uploaded and the
  deploy said "Code pushed"). Read every push's errors; a blank `default` on a text setting is one.
- **No filter inside another filter's arguments.** `image_tag: alt: x | default: '', class: 'y'`
  ends image_tag at the pipe: the class is lost and `append` receives the extra argument and prints
  a Liquid error. Assign the value first. `no-filter-inside-filter-args.mjs`.
- **An older theme gets baselines, not a pass.** On a theme that arrives with theme-check errors
  (one older theme: 82 in 32 files), `scripts/qa/theme-check-baseline.json` records each file's count from
  the live theme and the check fails only when a file goes up; a new file must have none. Write it
  from a pull of the live theme, never from the working copy, or your own errors become baseline.
  `seo-basics.mjs` reads the layout when there is no `snippets/meta-tags` and keeps a baseline of
  what live already got wrong.

- **Faster first paint exposes late CSS.** Removing render-blocking scripts lets the page paint
  before a section's own `<style>` (often at the end of the section) and before unsized images arrive,
  so it jumps (1 Oct 2026: collection 0 to 0.18, Safety 0.47). Put section styles before the
  markup, size images with width/height plus `height: auto; max-width: 100%`, and measure layout shift
  preview against live with the same headless method, never one against Lighthouse's other run.
  `sized-images-shrink.mjs`, `deferred-plugins-wait.mjs`.
### Store content

- **Images go in the store's Files and are set through the section's image picker.**
  Never ship photos in `assets/` as fallbacks, and never add a "default image file" text
  field beside a picker: it is a second image setting nobody asked for.
  `python3 scripts/upload-files.py --store <store> <files>` uploads and prints the
  `shopify://shop_images/...` value to put in the template.
- **Never edit the live theme's menus.** Create new menus for the new theme
  (`menuCreate`) and point every menu setting at them: header, mobile drawer and each footer
  column. One footer column left on the store's old menu reads as "the old menu is still
  there".
- **Store writes need `shopify store auth`**, which installs Shopify's "CLI Connector
  App" on the store with the scopes you ask for (for example `write_files`,
  `write_online_store_navigation`, `write_content`). Tell the person approving it what it
  is. It can be removed under Settings, Apps when the build is done.
- **Blog embeds style themselves inline.** A post is rendered by whichever theme is live, so
  a video embed that relies on the new theme's CSS shows as a tiny box on the old one.
- **Copy that goes in the footer is brand copy too.** "Newsletter sign up" is a label, not a
  line; write it in the brand's voice, and never promise a send frequency nobody confirmed.
- **Content that goes public waits for a yes.** Blog posts, pages and menus for a new
  theme are created unpublished or unlinked, and published only on the client's go.

### Access and tooling

- **Open a client store from the Partner Dashboard** (Stores, the store, Log in) the first
  time. Typing `<store>.myshopify.com/admin` fails until that collaborator login exists.
- **A brand-new theme needs its JSON templates once.** `.shopifyignore` keeps
  `templates/*.json` and `config/settings_data.json` out of every push, so a new
  unpublished theme gets no pages and 404s. Push those files to that new theme only,
  once, from a copy of just those files, before anyone edits it in the editor. After that
  the normal rule applies: pull before you touch them.
- **Horizon scrolls inside `.page-wrapper`, not the window.** Measure overflow and scroll
  positions there.
- **That same scroller defeats `loading="lazy"`.** On Horizon every lazy image on the page
  downloaded before the hero painted (2.2 MB), costing about 10 mobile points. Put
  `content-visibility: auto; contain-intrinsic-size: auto 760px` on below-the-fold sections.
- **Horizon loads every product-page module on every page.** On a homepage with no Horizon
  product cards, skip them there (`unless template.name == 'index'` around variant-picker,
  product-form, media, slideshow and the rest in `snippets/scripts.liquid`), then test the
  menu, search and cart drawer still work.
- **Lighthouse on one machine swings by 15 to 30 points.** One live site scored 55 and 87 an
  hour apart. `npm run speed` takes the median of five; never report a single run, and re-run
  it after every round of changes, since each new section or image set moves it.
- **In zsh, an unquoted `$FILES` is one argument, not many.** `shopify theme push $FILES` with
  `FILES="--only a --only b"` pushed none of the files and reported success (1 Oct 2026).
  Build an array: `args=(); for f in ...; do args+=(--only "$f"); done; shopify theme push "${args[@]}"`.
  Then pull the theme and diff it against the repo before testing anything.
- **Test the code Shopify is serving, not the code you pushed.** After a push the storefront can render
  the previous layout for a few minutes. Before any browser check, fetch the page and confirm a string
  from the change is in the HTML; until then every test passes against the old code.
- **In zsh, `$var:path` is a modifier, not a string.** Write `"${var}:path"` in git
  commands, or `git show $c:file` runs something else entirely.

---

## Guards: `scripts/qa/` is the repo's memory

Every guard exists because that bug shipped, and its header says which. The fix
and the guard land in the same commit, proven by reverting the fix and watching
the guard fail.

Keep them narrow. A guard that fires on legitimate work gets deleted, which is
worse than no guard. Where proof needs a browser or a store, the guard checks the
authoring shape and welds to a `*-walk.mjs`, matching its assertion rather than a
word in a comment.

**A guard that cannot run must not report a pass.** Missing dependency means fail
loudly. A silent skip exiting 0 is the bug it exists to catch.

### Write these on day one

| Guard | Fails on |
| --- | --- |
| `no-live-push.mjs` | `--live`, `--allow-live` or `theme publish` in any script or workflow |
| `merchant-files-are-not-pushed.mjs` | a push not excluding `config/settings_data.json` and `templates/*.json` |
| `no-committed-secrets.mjs` | a token, a client secret, a committed `.env` |
| `one-api-version.mjs` | an API version outside the module that owns it |
| `money-is-not-a-float.mjs` | float arithmetic on a price, amount or total |
| `a-currency-is-formatted.mjs` | a hardcoded currency symbol |
| `a-metafield-is-guarded.mjs` | a metafield with no absent branch, or defaulted to 0 |
| `an-image-has-a-width.mjs` | `image_url` with no width, or a lazy image above the fold |
| `a-section-has-a-schema.mjs` | no valid schema, duplicate setting ids, settings with no default |
| `a-webhook-verifies-its-hmac.mjs` | a route reading the body before verifying, or verifying a parsed body |
| `a-webhook-is-idempotent.mjs` | a handler with no idempotency key |
| `a-mutation-reads-its-errors.mjs` | `userErrors` never checked |
| `theme-check-clean.mjs` | new offences above a baseline that may only fall |

For a rule arriving late, use the baseline pattern: commit the current violation
count per file and fail when one goes up. The backlog only falls.

---

## Shipping

This brand's own shape is in CLAUDE.md. The shape that works: a branch push builds a preview, a merge
to main reaches staging, a person publishes the live theme.

`scripts/qa/ship-gate.mjs` enforces it as a `PreToolUse` hook on Bash (wired in
`.claude/settings.json`) and denies the tool call for:

1. **Publishing.** `theme publish`, `theme delete`, `--live`, `--allow-live`. No
   bypass.
2. **A push carrying merchant files.** Denied until `.shopifyignore` covers them
   or the push names its files with `--only`. No bypass.
3. **A merge with no evidence.** It reads the PR and checks the three rules below.
4. **A push that is not green.** `npm run qa` first. Bypass `SKIP_QA=1`, and say
   so if you use it.

If the gate blocks something legitimate, fix the gate and its test in the same
commit. Do not reword a command to slip past it.

### Push, then a PR

Two gates run on push: `npm run qa` plus typecheck, then a review of the outgoing
diff for correctness regressions, instance-not-class fixes, absent looking like
failed, and removed guards. Not style.

The PR says what changed, the issue it closes, the preview URL, and what was and
was not verified. "Not opened in a browser" is the honest sentence. "All guards
green" over a page nobody looked at is a lie in the PR body.

### Every PR gets a code review

Run `/code-review high <PR number>` before merging, `max` for anything touching a
live store, auth, tokens, money, or the gates. Fix what it confirms in the same
branch. A finding you reject gets a reason in the PR body. Record the review on
its own line, then merge. A fix bigger than a line or two gets reviewed again.

### What a merge requires

1. Every check green. Not amber, not still running.
2. Anything that renders was looked at below 768px and above, on a preview theme.
3. The PR body records the code review.

`mergeVerdict` checks all three before the merge runs. None of them routes
anything to a person: they send you to look, then you merge.

**Rule 2 must never decide the scope.** Dropping a template from a PR to avoid
the browser trip, or deferring the visible half to the next PR, is the rule
working backwards.

---

## How to work

**Spend subagents to protect the main context.** The main thread holds the plan
and the constraints. Send exploration and research out, keep the conclusion. One
question per subagent, independent ones in a single message so they run at once.
"Which templates render this snippet", "what does this app block inject", "where
else is this metafield read" are three subagents and three sentences back.

**Ask once whether the elegant version exists.** If the fix feels hacky, a special
case, a flag threaded through three snippets, build the version you would write
knowing what you now know. Ask once, and skip it for obvious fixes.

**Simplest change that works.** Impact as little code as possible.

**No band-aids.** Find the root cause. A temporary fix with no follow-up is a
permanent fix that is also wrong, and the next agency inherits it.

**Touch only what the task needs.** Every unrelated line is a bug you volunteered
for and a merge conflict for whoever is next to you. This is in tension with "fix
the class, not the instance", and the resolution is to sweep the class of the
reported bug and nothing else.

### Not taken from the circulated CLAUDE.md

- **`tasks/todo.md` and `tasks/lessons.md`.** Durable lessons go in `scripts/qa/`
  as a guard, in-flight steps go in the todo tool. A lesson as prose degrades
  silently; the same lesson as a guard fails the build.
- **"Check in before starting implementation."** The plan is a thinking tool, not
  a gate.
- **"Would a staff engineer approve this?"** Naming the states and the widths
  beats a rhetorical question that passes every defect here.

## Plan before you build

**Anything past a one line fix gets a written plan**, in the issue or the PR
description, and then you execute it. Plan when the change touches more than one
file, changes the data model, changes what the merchant maintains, or you have
not opened this theme before. Skip it for a typo or a padding fix.

Five questions, because getting one wrong means redoing the work:

1. **What is this theme built on.** A fork of Dawn or a paid theme, plus years of
   edits and app injections. Assuming Dawn's structure is the usual wrong turn.
2. **Does something already do this.** An installed app or a theme setting nobody
   has opened.
3. **Where does the data live.** Section setting, metafield, metaobject, line item
   property, or an app. The expensive one to reverse: once 400 products are
   filled in, changing a namespace or type is a migration. Write down what you
   chose.
4. **Theme edit or app block.** A theme edit dies the day the client changes
   theme. An app block survives.
5. **Can Liquid do this.** Discounts, shipping and payment customisation are
   Functions. Finding that out after building it in Liquid wastes the build.

Write the plan, then start. "Here is my plan, shall I proceed?" is the round trip
this file exists to remove. The exception is question 3: if the data model
decision changes what gets built, ask it as one short question with a
recommendation, and keep building everything that does not depend on it.

**At the second failed attempt at the same thing, stop editing.** Name the
assumption that might be wrong and check it. Usual culprits: you are editing a
section the template does not use, an app block renders over your change, the
editor differs from the storefront, or the asset is cached.

## How work runs here

**The client or the account manager describes the problem. The rest is yours.**
Brief it, plan it, build it, verify it, PR, review, merge, next one. Keep going
until the queue is done or you are blocked.

Do not end a turn asking whether to continue. The open issue list is the plan.

Three things stop you:

1. **A credential only a person can issue.** A collaborator request, an API scope,
   a Partners invite. Say which and what it unblocks.
2. **A decision that changes what gets built**, where guessing wrong wastes the
   work. Not an ordering preference: pick one and say which.
3. **Anything on the never list.**

Finish everything that is not blocked first, then say in one line what is blocked.

## Reporting back

**One sentence when the work is done.** What works, where it landed, preview or
live.

> Preview is up: PR #41 merged, the size guide renders from the metafield and
> falls back to nothing when a product has none.

Say **live** only once the theme is published and you have loaded the published
URL. A merge is not a publish.

**If something needs a person, a second line starting "Needs you:"**, naming the
one thing and what it unblocks. If nothing does, there is no second line.

> Needs you: publish the preview theme once the client signs off.

Two lines maximum. What changed, which files, what was checked: all of it belongs
in the PR body.

A handover is not finished until `npm run parity` has run and every picture has been
looked at, `npm run speed` has passed, and `npm run seo` and `npm run a11y` have no FAIL. Its WARNs go in the
handover report as content for the merchant to write. If any of these did not happen, say so
in the line.

---

## Skills

`shopify-ai-toolkit@claude-plugins-official` is declared in
`.claude/settings.json` and installed by `install.sh`. Its skills read the
real documentation rather than recalling it, which matters because the APIs
change quarterly: `shopify-liquid`, `shopify-admin`, `shopify-use-shopify-cli`,
`shopify-functions`, `shopify-hydrogen`, `shopify-polaris-*`.

Use them before writing a query from memory.

`/code-review` is built into Claude Code, so there is nothing to install for the
review step in Shipping.
