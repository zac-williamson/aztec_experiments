# Browser storage and application failure handling

Pinned Playwright1.63.0 fixes upstream persistent WebKit OPFS support. Normal
wallet qualification now uses one explicit fresh persistent profile for every
engine. There is no attempt in another mode after failure. Unsupported private
browsing is not relabelled supported. The application readiness check is unchanged.

| Engine | Hosting/wallet/history elapsed | Peak aggregate RSS KiB | 1,100-note workload |
| --- | ---: | ---: | ---: |
| WebKit26.6 | 22560 ms | 385776 | 5908 ms |
| Chromium | 9204 ms | 790624 | 1970 ms |
| Firefox | 12132 ms | 1392832 | 4529 ms |

Source-bound reports: U01/webkit-hosting-065.json,
U01/chromium-hosting-066.json, U01/firefox-hosting-066.json. Each verifies actual
built pages, isolated HTTPS, actual worker/WASM initialization, OPFS readiness,
SQLite roundtrip, encrypted wallet creation and shared synthetic history against
the actual application IndexedDB store, including reopen. All cleanup passed.
No network proofs or actual transaction proofs are claimed by these components.

Receipt UI067 verifies no claim merely on page entry, no engine call with a
missing hash, and exactly one claim with the entered hash. Its engine seam is
explicitly synthetic; canonical receipt security is tested separately.

Firefox146 real post057 failed at540159ms, peak1261696KiB; cleanup passed.
Observed chonk start196483ms, accumulation entries196696/202336/210234/266598/
309440/418349ms, finalization418976ms. Finalization did not finish before deadline.
This localizes slow execution to actual proof processing. Historical Chromium041
used the same proof sequence and finished its accumulation about20seconds after
start and finalization in15seconds. That comparison is diagnostic, not a controlled
cross-version benchmark. No larger budget or new proof bypass was introduced.
The newer pinned Firefox has passed storage, but has not yet passed actual proofs.

Application regressions065:113 passed. They cover request attempts, cached sync,
registration, simulation, configuration reads, unreadable flags, deployment lookup,
portal binding re-read, exact receipt recovery and confirmed-claim sync failure.
Existing state-conflict/reconciliation gates remain. Before-fix failures058/061
are retained. One exploratory dead-window test was removed because the value was
unused; deleting its read is preferable to imposing an unnecessary RPC dependency.
The first portal regression failed at an earlier already-protected read; corrected
fixture fails the second read to exercise the actual swallowed-error boundary.

Broader integration067:72/73 passed. The failure was an outdated public-policy
fixture expecting the moderator address. Correcting it to pass/assert actual SDK
NO_FROM yielded3/3 targeted checks068; independent reviewer approved unchanged
policy/version semantics and stronger public caller-privacy expectation.

Independent read-only structural review: browser_harness_review. Root alone
integrated source. Review required exact no-eval aliases, authoritative CSP-event
assertion, robust nested cleanup, explicit cache-reuse counter, valid-post failure
coverage and retention of dummy-state negative cases; all were integrated.

Long-history capacity is a seeded storage/transition qualification. It does not
claim1,000 executed published transactions. The literal T04 lifetime-publication
workload remains open. Underlying SDK owner/slot selection still scans linearly.
