# Board directory acceptance

Local implementation, not a claim of live CloudFront deployment.

Visitors follow Browse boards and choose explicit board links. Discovery scans
public contract publications from the supported class registration block,
inclusively, with a pinned checkpoint and bounded pagination. It verifies class,
portal binding and activation. Unknown classes, unpublished instances, and
instances originally published under another class are outside coverage.
There is no separate indexer or curated registry. On-chain names/descriptions
are unavailable, so shortened addresses identify cards. Coverage and incomplete
setup are shown explicitly. RPC failures remain errors; incompatible portals
cannot suppress later valid entries.

Validation: pinned Node24.21.0, macOS Chromium. Ran node --test for
scripts/test-board-directory.mjs, test-public-feed.mjs,
test-public-feed-source.mjs, test-u01-hosting.mjs and
test-frontend-provenance.mjs:69/69 passed. Built with node apps/build.mjs.
Ran scripts/run-bounded-browser-check.mjs scripts/test-public-feed-browser.mjs
execution/evidence/T04/board-directory-184.json:passed, owned cleanup complete.
Controlled two-board RPC data exercises the actual built pages, mobile390x844
and desktop1280x900 navigation, exact selected-board links, stale settings,
and an incompatible first portal followed by a usable second board.

A separate real public-testnet read found the new active board in1.98seconds
and completed discovery through block89924. This does not simulate extra live
boards or establish compatibility with older classes. The earlier genesis scan
is preserved as diagnostic evidence; the registration-bound query replaces it.

Independent internal review by application_change_review approved application
logic and harness structure, including same-block registration/publication,
reorg checks, explicit incompatible ABI handling and both viewports. No new
lifecycle owner, hidden retries or fallback paths were introduced. This review
is not an external security audit.
