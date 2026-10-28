# Rolling analytics

This is first-party measurement for the operator, with no persistent visitor
profiles. Analytics never receives wallet/account identifiers, post IDs, post
text, transaction hashes, page paths, search text, raw referrers, IP addresses,
user-agent strings, coordinates or exact event timestamps.

## Browser collection

`apps/rolling/analytics.mjs` maintains one page session in memory. Reloading starts
a new page session; it does **not** count unique people. Once-per-session flags
deduplicate the acquisition milestones. Existing accounts can skip payment, so
the displayed step totals are not a mandatory linear funnel. `first_post` means
the first successfully rendered included post **in that page session**, not a
person's first-ever post.

The reader passes only `onAnalytics(name, {count?, durationMs?})` into the wallet.
Native inclusion and actual feed rendering are distinct milestones. Transaction
identity stays inside the existing wallet logic and never reaches analytics.
Human post counts count posts; one atomic thread can contain several posts.
`post_visible` counts completed publishing interactions, not all rows in a thread.
Bok request/completion events describe the user's observed request transaction;
one multi-post transaction may contain multiple individual Bok requests. Use
worker accounting for authoritative request volumes.

Reading time includes visible page activity, with a 60-second inactivity cutoff.
It is an approximation, not proof of attention. It excludes hidden tabs.
Browser errors are counted without sending their message, stack or source URL.
Delivery is best effort and never retried automatically. A missing network event
must never affect an account or publishing action.

`feed_impression` counts an available card at least half visible in a feed;
`feed_open` counts that card's View conversation link being selected. Each is
deduplicated per post in the current page session, across navigation and live
refreshes, up to 1,000 cards. Clicking a card before its visibility callback also
counts its impression. Temporary IDs stay inside the reader and never enter
analytics. Conversation/post detail pages and removed cards are excluded. The
ratio of these totals measures feed-to-conversation opens, not unique people or
individual-post popularity. Browsers without IntersectionObserver provide only
clicked-card impressions; analytics blocking and transport loss can bias ratios.

Collection runs only on the explicit live origins in the module, and only on the
root/index page. It is off on localhost, staging and automated browsers, and
honours Do Not Track and Global Privacy Control. The footer offers opt-out. The
only persistent browser value is the visitor's non-identifying opt-out boolean
`rolling.analytics.disabled=1`; no cookie, visitor identifier or fingerprint is
created. Removing the preference enables collection again unless DNT/GPC applies.

Referrers become one of `direct/search/x/reddit/telegram/discord/github/other`.
Campaigns are limited to `none/launch/community/newsletter/other`. Unknown campaign
values become `other` in the browser. Edit the fixed registry in
`analytics-schema.mjs` to add a named campaign; never accept arbitrary query text.
The server separately rejects any campaign outside its configured registry.

## Ingestion and storage contract

Serve `POST /_ops/events` on the application origin. JSON shape:

```json
{"v":1,"batch":"0123456789abcdef0123456789abcdef","source":"x","campaign":"launch","device":"mobile","events":[{"name":"visit","count":1,"bucket":"none"}],"test":false}
```

Each batch has an unrelated, one-use random ID. The server uses it only for a
bounded 15-minute in-memory duplicate check. It is not a visit identifier and is
never written to the database. A process restart drops that duplicate cache;
the client sends no automatic retry. This is analytics, not financial accounting.

`openAnalyticsStore({filename, campaigns?, now?, retentionDays?})` returns:

- `ingest(payload)`: accepted counter, duplicate/ignored flags; invalid shapes
  throw `AnalyticsInputError` with a safe fixed error code and no payload text.
- `summary({days:7|30, from?, to?})`: totals, UTC daily totals, independent source,
  campaign and device breakdowns, page-session milestones and duration buckets.
- `close()`: closes SQLite and clears transient duplicate state.

Persisted rows are only `(day, event, dimension, value, bucket, count)`.
Source, campaign and device are separate dimensions; they cannot be joined into
fine-grained visitor cohorts. Source/campaign attribution is limited to
acquisition milestones and engaged sessions; devices get aggregate traffic and
error counts. Duration samples are bucketed before sending. No raw event log or
exact event time exists. Aggregate retention defaults to 90 days; ingestion and
dashboard reads prune older rows. Keep periodic dashboard/monitor summaries
running to prune during traffic-free periods.

The HTTP/proxy owner must require same-origin JSON, bound bodies (8 KiB suffices
for 32 allowed events), reject unknown keys, and suppress raw request/access logs
for ingestion at every proxy layer. Do not copy headers or request metadata into
`ingest`. The store also has global bounded admission and deduplication limits;
no IP rate-limiting key is retained. Browser metrics are untrusted observations,
can be blocked or forged, and must not control financial or deployment decisions.

## Public community summary

`readCommunitySummary({filename, days:7|30, now?, maxPosts?})` opens the existing
`rolling-public-v3.sqlite` read-only as its normal owner. It reads the current
projection generation in one snapshot and returns counts, not public post IDs or
text. Run this independently from the browser ingestion service and publish only
its resulting aggregate object to the dashboard. Do not grant analytics access to
private wallet, signing or payment stores.

The source timestamp is the authenticated `PostPublished.timestamp`, checked
against the native block header in `shared/rolling/public-events.mjs`. Human/Bok
posts and replies are separate; removed posts and rejected boards are excluded.
The 24-hour response denominator includes only human-started threads at least 24
hours old. A human reply may be from the same anonymous author; no author linkage
is inferred. This is a summary of the current public index, not independent proof
that its network synchronization is fresh. Display it alongside index freshness.
Missing, incompatible or oversized observations return `status: unavailable`,
never invented zeroes or a healthy state.

## Verification

```sh
node --test ops/analytics.test.mjs ops/community.test.mjs apps/rolling/analytics.test.mjs apps/rolling/wallet-composer.test.mjs
python3 -m unittest discover -s deploy/restoration-20261021/ui -p test_publish.py
```

Focused checks exercise strict rejection of identifying fields, aggregate-only
persistence, independent dimensions, deduplication/expiry, retention, opt-out,
DNT/GPC/test suppression, hidden/idle time, and actual wallet inclusion/render
boundaries. Browser deployment inventory includes both new analytics modules.
