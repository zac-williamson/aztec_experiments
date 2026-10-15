# Rolling Chat design prototype

G03 / RC03–RC08, RC16, RC40, RC44–RC46. Draft 3, pages 2–5, 9 and 11.
Design-stage evidence only: every social action changes disposable memory; no wallet,
chain, model, account registration, proof, payment or recovery is implemented here.

## Plan before implementation

Palette: deep harbor #182335 for the navigation rail; slate #233147 for the header;
paper #f4f6f9 for reading; ink #26364b; violet #6654be for primary controls;
sea-glass #cbeae4 for topic accents. Human identity accents vary by name. Bok has
a distinct square bot avatar; Anonymous never receives a reusable identifier.

Type: Avenir Next where installed, system sans-serif elsewhere. Body 16px/1.6;
headings 28px/1.2; metadata 13px. Reading lines stay below 76 characters.

Layout: left-aligned, persistent dark community navigation, a continuous light
conversation column, and a quiet right margin for context and effective rules.
No hero or dashboard metrics: the conversation is the subject.

    community rail | Home / Following              | community context
                   | compose invitation            | effective rules
                   | post                          | discover subboards
                   | reply / like / quote / save   |
                   | post                          |

A narrow layout folds the rail into a keyboard-operable menu, retains the feed,
and places contextual information after the primary content. Threads preserve
canonical reply and root references; Back restores scroll and focus.

## Pre-build critique

A three-column social feed is familiar by requirement. The memorable distinction
is the oversized linked rolling-loop wordmark paired with topic-shaped color
markers in a dark rail, rather than a colored SaaS hero. Revised an initial card-grid
idea to a continuous feed separated by semantic post boundaries. Use readable
light surfaces within the specified navy atmosphere, instead of low-contrast dark
body text. No decorative gradients, stock art, network fonts or motion.

## Reversible design assumptions

Home sorts curated fixture posts by likes, then timestamp, then stable ID;
Following sorts followed fixture boards/identities by descending timestamp then ID.
New subboards do not automatically enter Home. These demonstrate proposed defaults,
not final production ranking. Local-only follows/bookmarks reset on refresh.
Rejected boards retain directory tombstones; posting is blocked. Local rule updates
and appeals have no claimed permission. Account and moderation forms are explicit
previews; cost figures are illustrative, never quotes or account balances.

The lead selected an ASCII name policy for the first release: 1–32 characters per
component, letters/spaces/apostrophes/hyphens, first and last characters letters;
case-insensitive comparison with collapsed spaces; first name Bok reserved. This
replaces any earlier Unicode working default. The prototype explains this policy
but does not pretend to enforce authenticated registration.

## Verification and handoff

Run `node apps/rolling/serve.mjs` (loopback port 4317) and
`node --test apps/rolling/model.test.mjs`. No dependencies or install required.
Source separation: fixtures.mjs contains public demonstration content; model.mjs
contains pure allowance/ranking/link validation; app.mjs contains rendering and
local interactions. Replace fixtures via a future API adapter, preserving IDs.
No fixture state is persisted, and no secrets may be entered into this preview.
Browser checks: browse → directory search → subboard → thread → Back; compose
emoji and oversized text; keyboard dialog open/Escape/focus return; 390px layout;
loading, empty, removed-parent and retry states via the preview-state selector.
This does not establish real proof, chain-social-state, recovery or funding acceptance.
