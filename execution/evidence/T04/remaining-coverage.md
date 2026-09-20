# Application qualification coverage — 2026-09-19

This is a work inventory, not completed acceptance evidence. Historical results
retain their source snapshots; final-source reconciliation remains T05 work.

| Area | Existing evidence | Remaining distinct work |
|---|---|---|
| Browser lifecycle | Chromium048, Firefox084, WebKit086 and installed Chrome102 and current-reader-repair133 deposit through refund | Remaining actual release-browser qualification, including installed Safari |
| Private fee funding UI | Cold-browser094 passes actual fee-juice.html deposit/private claim, collateral claim and paid post with exact accounting | Final-source reconciliation and external-wallet route |
| Recovery | Chromium050 accepted post and096 accepted withdrawal response loss with full persistent browser restart; W03 receipt/persistence and chain tests | Layered map in recovery-coverage-095.md: durable boundary095/097, fresh-engine claim/screen100, builtUI reload101, real-Anvil mined response loss. Final-source reconciliation remains; no per-stage genuine-browser duplication claimed |
| History | C04 17/33 stateful TXE lifecycles, seeded1,002note authenticated continuation/exit, actual1,100record native/browser persistence | Current native-store084 passes11checks at1,100synthetic records in302ms and client checks3/3; contract/ABI final-source reconciliation remains |
| Concurrency and traffic | Ten same-anchor authors with genesis fixture fees; two private-fee authors and original withdrawal proof076 | Reconcile source; do not claim ten-author private-fee throughput or single-block inclusion |
| Long absence | Native persisted wallet075 reopens after simulated30days, authenticates retained state and posts | Not a real elapsed soak or browser crash qualification |
| Repeated deposits | Genuine T02 redeposit/refund and replay rejection | Reconcile current source; retain multi-cycle contract evidence |
| Reader on mobile | Wallet-free paginated actual built page, safe text rendering and persistence | Passed mobile-reader083 at390x844 after scoped wrapping fix; physical-device qualification remains distinct |
| Wallet routes | Real pinned MetaMask132: connection, rejected approval, explicit retry, canonical fee deposit and persistent recovery; built-in Aztec wallet | Final-source reconciliation and extension-backed board collateral/refund interactions; bundledChromium extension result is distinct from installedChrome lifecycle |
| Performance | Per-run phase/wall-time/resource records | Feed099 passes30sample Chromium shaped cold-load and10000-history warm API-page targets. Application-proof30sample per-engine campaign remains; sync CPU/storage still processes full cached history |

No 1,001-proof repetitive campaign is required by the recorded C04 methodology.
No performance, actual-browser, recovery or external-wallet promise is removed by
this inventory. Local controlled settlement does not qualify network finality.

History source reconciliation: C04 source-final hashes match9089663, while its
recorded HEAD a208406 predates then-uncommitted C04 changes. Compare the hashed
files, not HEAD alone. Independent review found successor/hint queries and history
tests unchanged. Later C05 maturity/cooldown/recovery changes justify rerunning
only the five existing `test_history` contract tests on current source. All five passed in contract-history-085.log; final candidate binding remains T05.
