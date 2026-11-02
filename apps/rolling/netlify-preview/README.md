# rollingchat review preview on Netlify

A shareable, throwaway deployment of `apps/rolling` for design review. It is not the
production server: the public API is a mock (`functions/api.mts`) with a seeded
conversation, and the wallet runtime is a mock (`mock-runtime.mjs`) with no custody,
chain or proofs. Posts made during a review are kept in Netlify Blobs, read as pending
for a few seconds and then confirmed, and can be cleared at any time.

| URL | What it shows |
| --- | --- |
| `/` | The live app (`live.html` + `reader.mjs`) against the mock API. |
| `/?unlocked=1` | The same, starting signed in so Reply opens the composer directly. |
| `/#/thread/101` | The seeded conversation that exercises every fold rule. |
| `/#/board/0` | The main board, where seeded replies are listed before their roots (feed grouping). |
| `/preview` | The separate design preview (`index.html` + `app.mjs` + fixtures). |
| `/archive` | The archive page. |

## Deploy

Requires the Netlify CLI, signed in to a team that owns the `rollingchat-preview` site
(https://rollingchat-preview.netlify.app; change the `--site` ID in `package.json` to
deploy somewhere else).

```sh
cd apps/rolling/netlify-preview
npm install
npm run deploy
```

`build.mjs` assembles `site/` from the real app files: the pages, every module reachable
from `reader.mjs` and `app.mjs`, the fonts and brand assets, the CDN headers (same CSP
as production, `no-store`, `noindex`) and the rewrites. `site/`, `node_modules/` and
`.netlify/` are ignored by git. The real `wallet-runtime.mjs` and the cache service
worker are deliberately left out.

The mock API answers the reader's `candidates`, `home`, `board`, `thread`, `post`,
`profile`, `directory`, `following` and `bookmarks` routes with `contextPosts` for
replies, and streams revision events on `/api/events` so the page refreshes when a
review post lands or settles. The mock runtime replays the progress stages a real
session reports (estimating, preparing, proving, submitting, included); posts and
gifts return as included and confirm a few seconds later, names confirm directly
and join the owned list, and top-ups walk the funding steps. Run it locally with
`node build.mjs && netlify dev --offline --port 4500 --dir site --functions functions`.
