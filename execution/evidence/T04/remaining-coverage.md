# Application qualification coverage — 2026-09-19

This is a work inventory, not completed acceptance evidence. Historical results
retain their source snapshots; final-source reconciliation remains T05 work.

| Area | Existing evidence | Remaining distinct work |
|---|---|---|
| Browser lifecycle | Chromium048, Firefox084 and WebKit086 deposit through refund | Actual stable release browser qualification, including installed Safari |
| Private fee funding UI | Cold-browser094 passes actual fee-juice.html deposit/private claim, collateral claim and paid post with exact accounting | Final-source reconciliation and external-wallet route |
| Recovery | Chromium050 accepted post response loss and full persistent browser restart; W03 receipt/persistence and chain tests | Map three interruption points per stage to existing tests; genuine distinct claim/screen/exit browser recovery. Existing real-Anvil W03 deposit/refund and fee-funding tests already cover mined response loss with file-journal restart; browser integration is separate |
| History | C04 17/33 stateful TXE lifecycles, seeded1,002note authenticated continuation/exit, actual1,100record native/browser persistence | Current native-store084 passes11checks at1,100synthetic records in302ms and client checks3/3; contract/ABI final-source reconciliation remains |
| Concurrency and traffic | Ten same-anchor authors with genesis fixture fees; two private-fee authors and original withdrawal proof076 | Reconcile source; do not claim ten-author private-fee throughput or single-block inclusion |
| Long absence | Native persisted wallet075 reopens after simulated30days, authenticates retained state and posts | Not a real elapsed soak or browser crash qualification |
| Repeated deposits | Genuine T02 redeposit/refund and replay rejection | Reconcile current source; retain multi-cycle contract evidence |
| Reader on mobile | Wallet-free paginated actual built page, safe text rendering and persistence | Passed mobile-reader083 at390x844 after scoped wrapping fix; physical-device qualification remains distinct |
| Wallet routes | Disposable Ethereum signing adapter and built-in Aztec wallet | Actual promised external Ethereum wallet integration |
| Performance | Per-run phase/wall-time/resource records | Declared30sample browser campaign and shaped-network feed measurements; no percentile claim from single runs |

No 1,001-proof repetitive campaign is required by the recorded C04 methodology.
No performance, actual-browser, recovery or external-wallet promise is removed by
this inventory. Local controlled settlement does not qualify network finality.

History source reconciliation: C04 source-final hashes match9089663, while its
recorded HEAD a208406 predates then-uncommitted C04 changes. Compare the hashed
files, not HEAD alone. Independent review found successor/hint queries and history
tests unchanged. Later C05 maturity/cooldown/recovery changes justify rerunning
only the five existing `test_history` contract tests on current source. All five passed in contract-history-085.log; final candidate binding remains T05.
