# Application qualification coverage — updated 2026-09-21

This is a work inventory, not completed acceptance evidence. Historical results
retain their source snapshots; final-source reconciliation remains T05 work.

| Area | Latest useful evidence | Remaining distinct work |
|---|---|---|
| Browser lifecycle | Actual MetaMask196, WebKit231 and installed Chrome238 completed deposit through refund; Firefox full journey also retained | Installed Safari26.5 directory/direct reader/refresh passed327; wallet/proving and final-source reconciliation remain. WebKit does not establish installed Safari wallet support |
| Private fee funding UI | Cold-browser266 and actual MetaMask284 passed genuine fee funding, private claims and paid posting | Final candidate binding; these checks use disposable local chains |
| Recovery | Actual withdrawal recovery251 and post recovery252 passed with full browser-process restart | Current-source stale-proof312 and same-note attribution313 passed; final candidate binding remains. Existing layered map is recovery-coverage-095.md |
| History | C04 17/33 stateful TXE lifecycles, authenticated seeded1,002note continuation/exit, actual1,100record native/browser persistence; targeted checks084/085 passed | Final candidate binding; no claim of1,001genuinely proven publications |
| Concurrency and traffic | Current withdrawal-traffic309 passed in359seconds: A's original proof survived B's post, B posted after A exited, private balances and pool reconciled. Evidence application-8d2b9c2a-274d-4a54-836e-e7ff3501d7db.json | Historical ten-author contention mechanism reconciled below; final-binary SCALE-01 rerun remains T05 work.309 is not ten-author throughput or single-block inclusion |
| Long absence | Current-source wallet-absence311 passed449seconds/2.08GiB with persisted account/contracts/note and real post after simulated30days | Secondpost stage was unusually slow; phase attribution remains unmeasured. Simulated chain time is not elapsed soak or browser crash qualification |
| Repeated deposits | Redeposit222 passed two real deposit/claim/withdraw/refund cycles, replay rejection and exact fees | Final candidate binding; no unrelated full rerun required |
| Mobile reading | Built mobile-sized reader083 and directory navigation passed | Representative physical-device qualification remains distinct |
| Wallet routes | Actual MetaMask196 full journey and284 cold fee funding; earlier approval rejection/funding recovery retained | Reconcile remaining interruption cases against final source. Bundled Chromium extension support is distinct from installed browsers |
| Performance | Source-matched Chrome294, Firefox290, WebKit291 each passed one cold+warm proof; browser-performance-pilots-20260921.json. Feed155 measured30cold loads, p951.629s |Chrome322 completed 30 cold and 30 warm samples, independently reviewed: cold initialization plus proof p95 37.90s, warm proof p95 35.78s. Firefox328 is in progress; WebKit remains incomplete. Pilots are excluded; see chrome-performance-results-322.md for scope |
| Remote recovery | Verified backup/download/offline authentication296–300; automatic EC2 reboot recovery302 in134seconds | Replacement-host recovery remains untested |
| Remote health | Native timer publishes aggregate health; CloudWatch missing/unhealthy alarm deployed and recovered toOK | No notification recipient. Backup-failure monitoring325 is implemented and locally tested but not deployed because AWS authentication expired |

No 1,001-proof repetitive campaign is required by the recorded C04 methodology.
No performance, actual-browser, recovery or external-wallet promise is removed by
this inventory. Local controlled settlement does not qualify network finality.

History source reconciliation: C04 source-final hashes match9089663, while its
recorded HEAD a208406 predates then-uncommitted C04 changes. Compare the hashed
files, not HEAD alone. Independent review found successor/hint queries and history
tests unchanged. Later C05 maturity/cooldown/recovery changes justify rerunning
only the five existing `test_history` contract tests on current source. All five passed in contract-history-085.log; final candidate binding remains T05.


## 2026-09-21 deployment and current checks

The public testnet board and directory are deployed at
https://d30njln0kead8n.cloudfront.net/. Readers open board URLs directly;
ordinary visitors no longer import connection settings. Discovery covers
published instances of the supported contract class on the selected network.
See hosted-directory-20260921.json for actual browser observations.

The EC2 moderator evaluated a post under changed rules, submitted its removal,
and the contract recorded removal without a collateral penalty. The original
policy was restored and a normal greeting was allowed. This live check occurred
before the old deadline; it does not replace local after-deadline coverage.
See live-retroactive-removal-20260921.json.

Native private-fee lifecycle measurement now includes maximum-size messages,
two timely flags, two-note screening, withdrawal and refund. The complete run
passed in440090ms with1642992KiB peak aggregate RSS and complete cleanup:
T02/application-df03392d-85d4-4588-9661-d5734069b85b.json. The maximum-size
post with two screening hints was simulated; actual screening and withdrawal
were proved. This is not arbitrary fee-balance fragmentation qualification.

A new browser preflight initially rejected legitimate entirely private claims
because it incorrectly required public output. Failure192 is retained. The
check now follows the pinned SDK transaction type;121 focused checks pass195.
Actual MetaMask browser196 passed450880ms with3665904KiB peak RSS, canonical
refund and cleanup. See application-57cfa893-b857-4394-a721-180f5ca0b79e.json.
Hosted publication is proceeding after that result. Static fee limits remain an operational limitation: actual wallet
state must fit before proving; no silent enlargement or payment fallback exists.

### Cold fee claim diagnostic 205 (2026-09-21)

The run failed before proving at 113,933 ms and cleaned up completely. Evidence:
`application-974a3acf-accf-432c-b168-020e2eb09b66.json`. The preserved RPC error is
`Rollup__UnavailableTempCheckpointLog(6,5,267)`: simulation requested checkpoint 6
while the Ethereum contract pending tip was 5. Published npm 5.2.0 source and
executed JavaScript were independently compared byte-for-byte by author_testnet_flow;
this path is not a local SDK patch. The SDK derives the proposed parent's fees
using its grandparent from Ethereum. A proposed frontier more than one checkpoint
ahead of Ethereum exposes that assumption. Why that gap formed remains unresolved.

The cold fixture kept forced empty checkpoints enabled through browser claiming.
The scoped correction ends empty production once the required Inbox witness exists,
drains in-flight publication using the official sequencer pause/start, checks the
node frontier against Ethereum, and then releases the browser. It does not alter
application validation or resolve the upstream pipelined-simulation limitation.
One bounded qualification is planned after independent review; no blind retry.

Qualification208 failed121338ms in new barrier because root called archiver getL2Tips on the node; public API is getChainTips. Cleanup complete. Evidence application-42be481e-799b-44f7-a228-e2906b529062.json. This is a harness defect, not a repeated fee claim result. Corrected and actual SDK binding checked209; independent reviewer rechecked all helper APIs.

Cold browser211 passed293640ms,peak2140368KiB,cleanupcomplete. Evidence application-89b9c4d2-ff37-45ae-94df-3fe874688115.json. Publication barriers recorded proposed/checkpointed/L1 equality at checkpoints6 and23. Three genuine browser proofs took about30s,34s,36s. Author public Fee Juice balance stayed zero. No changes to application fee validation were needed.

## Current integration checkpoint, 2026-09-21

Application commit e64c95c passed artifacts, 88 boundary checks, 45 identity
contract checks, harness checks, component checks (with two reviewed stale
fixture corrections), 36 portal checks and SDK-manifest checks. See
integration-20260921.json for source fingerprints and exact command logs.
Genuine repeat-deposit run222 passed in332274ms with1782144KiB peak aggregate
RSS, both refunds, replay rejection and cumulative private-fee accounting;
owned processes and temporary files were cleaned up. Evidence:
../T02/application-ac9f887d-0e40-470e-b264-ff4ec8a082e5.json.

The earlier integration review identified these distinct runs, now completed below:
`browser-webkit-journey`, `browser-chrome-journey`,
`browser-withdraw-recovery`, and `browser-post-recovery`.
Do not repeat plain post scenarios after those full journeys pass. Installed
Safari remains a separate gap. Actual-extension cold funding subsequently passed284;
WebKit and bundled Chromium are not substitutes for installed Safari.

Firefox230 passed an actual private-fee post in258654ms/3005472KiB with cleanup. Earlier225 pre-proof proxy502 remains unexplained; diagnostic capture changed no transport behavior. A passing rerun does not close that reliability issue.


### Recovery and browser reconciliation, 2026-09-21

WebKit231 and installed Chrome238 completed full browser lifecycles with genuine
private-fee proofs, canonical refunds and complete cleanup. Their source snapshots
are retained in application-fd86abc8-2204-4e63-a28d-3a3d6746b0f8.json and
application-248a2a3e-7f24-4288-867f-631f865b8c89.json. Later recovery changes require
the affected recovery checks again; these successes do not qualify installed Safari.

A concurrent connection-boundary probe reproduced36HTTP502 responses among192
requests in the local proxy. Its idle connection lifetime now ends before the
upstream closes it. The exact configuration passed192requests with192upstream
calls, zero errors and no retries. See proxy-keepalive-20260921.json. The historical
225failure cannot be attributed conclusively because its diagnostics were discarded.

Withdrawal recovery244 exposed a real application defect: status lost the saved
withdrawal hash after restart. The run was intentionally stopped, with complete
cleanup. Regression246 reproduced it. The reviewed correction preserves the
reference until the exact refund is verified and offers wallet connection from
the refund page.123focusedchecks and the harness tier passed; actual withdrawal recovery251 passed in206056ms with complete cleanup. Post
recovery252 also passed with complete cleanup. See withdrawal-recovery-fix-20260921.json.


Wallet-absence311 timing limitation: its second-post stage took about221seconds,
but combines wallet preparation, fee checks, proving, public simulation, inclusion
and synchronization. It is not a measured221-second proof. Independent source
review found no loop over the simulated30days: eligibility was already satisfied
and cooldown catch-up is arithmetic. Add phase timing to existing helpers when
next changing them; this successful run alone does not justify a corrective rerun.


Ten-author source reconciliation (independent application_change_review): retained
`../C03/application-db6d60e3-d8cf-43a4-9c5d-e6f3a796c23c.json` proved ten posts at
one identical anchor before submission and verified all canonical inclusions.
The board-scoped nonce identity in `lib.nr` is unchanged. Current `main.nr` still
consumes the author's private deposit during preparation and assigns public order
only during public execution. Added policy/deadline metadata introduces no private
read of shared posting order. Note layout, cooldown and helper adaptations do not
introduce another-author dependencies for these first posts. Current309 supplies
complementary current-note/private-fee evidence, not ten simultaneous post proofs.
This reconciles the contention fix; any final-binary SCALE-01 execution remains
part of final release qualification rather than a newly identified defect.
