# rollingchat design system

The product name is **rollingchat** (one word), at rolling.chat. The wordmark sets
"rolling" in ink and "chat" in brand violet, weight 800, letter-spacing -0.045em,
beside a rounded violet tile carrying the rolling-bubble mark (a speech bubble with
a curling arrow). The lockup (`createBrand`) sets the tagline *Private messaging
board* under the wordmark; the compact header under 700px drops it and the drawer
shows it again. Social cards keep the longer line *Say it in public. Stay private.*

Privacy is said early and repeated where money moves. A first visit opens a
welcome dialog (read freely, post privately, fund once); the rail foot, the
context column ("Private by design") and the help page restate it; the connect,
funding, top-up, composer, gift and name forms each carry a `.privacy-note` lock
line saying the action is sent from the private Aztec account and never linked
to the wallet.

`style.css` is shared by the live application (`live.html`, `reader.mjs`,
`wallet-panel.mjs`, `profile-view.mjs`) and the disconnected design preview
(`index.html`, `app.mjs`, `fixtures.mjs`). Shared chrome (SVG icons, the wordmark,
loading skeletons, board tiles, `@bok` mention chips) lives in `model.mjs`, so no
renderer needs a new module and the live content security policy
(`style-src 'self'`, no inline styles) is respected: per-row values such as the
stagger index travel as custom properties through the CSSOM.

## Direction

Reddit for structure, X for the mention. A sticky full-width header holds the
wordmark, a pill search/explore link and the account button; a light left rail
lists navigation and boards with icons and tiles; the centre column (max 720px)
shows posts as cards; a right context column (300px) holds "Your place to talk",
"Meet Bok" and "How it works". Under 1150px the context column folds beneath the
feed; under 700px the rail becomes a drawer with a backdrop and the header
compacts. Threads indent replies with a guide line.

Bok is tagged like a person on X: `@bok` in a message renders as a teal mention
chip, the composer offers an `@bok` chip that inserts the mention at the caret,
and Bok's own posts carry a teal avatar, badge and left accent. The protocol is
unchanged: the mention in the text is still what selects the Bok action.

## Conversations

A thread is a tree, not a list. The root post keeps its card; replies share one
surface below it, each nested under the post it answers (`record.parent`) with a
clickable thread line on the left (Reddit's bar), a collapse toggle, and a one-line
collapsed summary ("Rowan Lake · 18 min · 3 replies"). `model.mjs` owns the tree
(`threadTree`), the fold policy (`threadFolds`) and the DOM controller
(`createThreadView`) shared by the live reader and the preview.

Fold policy, in order: direct replies are always open (the API pages them); a
reply at depth 3 or deeper starts collapsed when it has no likes, no Bok in its
branch and is not its parent's only reply; depth 5 and beyond waits behind
"Continue this conversation · N replies"; more than five replies under one comment
show five and "Show N more replies"; removed replies start collapsed with their
branch. A pending reply (just posted) and a linked post open every fold on their
path, and a reader's own collapse or expand choice always wins and is kept per
conversation across paging, live refresh and Back. A reply whose parent is not in
the loaded conversation sits at root level and keeps its "In reply to" line.

The composer shows "Replying to {author}" with a quoted excerpt of the answered
post; the excerpt is display-only and never part of the signed action.

Home and board feeds show one card per conversation (`createFeedConversation`).
Public pages list newest first, so a reply can arrive before its root; the card
is keyed by `record.root`, items are inserted in chain order (`compareChainOrder`)
and the root heads the card whenever it appears, replacing any context copy. The
API ships each reply's immediate parent as `contextPosts`; a parent that is not on
the page renders as a context row (clamped, "Show more"), and a reply whose root
is unavailable gets a "Part of a longer conversation" header linking into the
thread. Feed cards preview three direct replies before "Show N more replies"
(`FEED_THREAD_POLICY`); deeper branches stay behind the thread page.

## Tokens

Colour (light): background `#f6f7fb`, surfaces `#fff` / `#f1f2f8` / `#e9ebf3`,
lines `#e5e8f0` / `#d3d8e4`, ink `#0f172a`, secondary `#334155`, muted `#64748b`,
faint `#94a3b8`. Brand violet `#5b4df0` (strong `#4a3dd6`, soft `#ecebff`, ink
`#3a2fb5`). Bok teal `#0f9b8e` (strong `#0b7f75`, soft `#dff5f1`, ink `#0b6b62`).
Status: ok `#178a5c`, warn `#9a6700`, danger `#c0392b`, each with a soft tint.
Identity accents: mint, lilac, peach, sky, lemon, rose (`.tone-1`…`.tone-6`).

Type: DM Sans variable (optical size 9–40, weight 100–1000), self-hosted in
`fonts/` under the OFL with latin and latin-ext subsets; fallback `system-ui`.
Body 15px/1.55, post body 16px/1.6, h1 28px/1.2 weight 800, metadata 12–13px,
monospace for hashes and recovery values. Radii 8/10/14/20px and pills; three
shadow steps; 56px header; 240px rail.

## Motion

Everything is short and purposeful, and every rule sits behind
`prefers-reduced-motion`: route content rises in (240ms), feed rows stagger by
35ms per row, buttons lift on hover and press to 97%, the like heart pops when
pressed, dialogs scale and fade in with a blurred backdrop, the drawer slides,
skeleton cards shimmer while a feed loads, pending posts pulse a dot, the brand
mark rolls in. Live feed refreshes swap content without replaying motion.

## Signup and account

The account dialog is one decision per screen with a three-step progress strip
(Connect wallet · Set up posting · Start talking) shown only while onboarding.
Wallet choices are large rows with provider icons; the funding receipt is a list
of lines with a highlighted maximum total; the primary action is full width.
The composer keeps its form fields and adds a tools row: `@bok` chip, preview
toggle and byte counter. File inputs are visually hidden behind a "Choose an
image" button and a chosen-file label; no native control is shown.

Every paid action (post, reply, gift, name, bio, avatar, board, top-up, funding
claim) drives one transaction status (`createTransactionStatus` in `model.mjs`):
a headline, a five-step track (Prepare · Prove · Send · Included · Confirmed)
with an animated current segment, a one-line explanation of the step and the
privacy line. It sits at the top of the account dialog or inline name form while
they are open and scrolls into view when it appears; once the dialog closes on
inclusion it continues as a dismissible strip at the bottom of the page until
the final confirmation, then hides itself. The plain-text live region keeps the
screen-reader announcement.

The inline "Create a name" form has a Cancel button, closes on Escape, closes
when another posting name is chosen, and does not follow route changes.

## Metadata

`live.html` carries the description, canonical URL, theme colour, Open Graph and
Twitter cards (`og.png`, 1200×630), SVG and PNG favicons, Apple touch icon,
web-app manifest and a font preload. `index.html` (preview) and `archive.html`
are `noindex`. Regenerate `og.png` and the PNG icons from the same wordmark
template if the brand changes; `favicon.svg` is the vector source.

## Verification

`node --check` the modules, `node --test apps/rolling/*.test.mjs` for the unit
suites and `node --test apps/rolling/*.browser.test.mjs` for the Playwright
suites (`feed-context.browser.test.mjs` covers feed grouping against a public
fixture). `apps/rolling/netlify-preview` serves the live app against a mock API
and mock wallet runtime that replay the progress stages, so the status bar and
feed grouping can be reviewed without a chain. Browser checks: home → board →
thread → back restores scroll and focus;
directory search; composer with `@bok` chip, emoji and oversized text; keyboard
dialog open/Escape/focus return; 390px drawer and backdrop; reduced-motion mode;
loading, empty, pending and failure states via the preview-state selector.
