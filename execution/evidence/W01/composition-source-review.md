# W01 independent composition source review

Reviewed the source hashes in `composition-source-review-hashes.json` while the
parent supervised the genuine run. No source edits, network calls, proofs or
heavy tests were performed in this review. The funding helper was authored in
this lane earlier; its review here is explicitly self-review, not independent
implementation review. The sponsor orchestration/client/routing files were
independently read against the installed SDK and sponsor contract.

## Disposition

No blocking composition defect was found for the current **claim, no-post exit,
and L1 refund** route. This is a source-review disposition, conditional on actual
successful run evidence; it is not a runtime pass or complete W01 acceptance.

- Both local artifact hashes are checked against the build manifest before
  sponsorship setup. The client verifies actual sponsor/board instance addresses,
  original/current class IDs, chain/version and immutable board target before
  requesting authorization.
- The production depth-10 coupon hash uses the contract domain and MERKLE_HASH
  separator, binding chain/version/sponsor/window/batch/index/owner/blind. The
  test's all-zero sibling path is still a concrete one-leaf proof, not fake
  membership. Batch registration is itself proven, validated and included.
- The client signs the actual delegated board call for the sponsor caller and
  uses a fresh nonzero authorization nonce. ABI encoding/decoding copies action
  values before signing; sponsor encoding is checked before requesting auth.
  `ContractFunctionInteraction.request(options)` in installed5.2 appends the
  supplied auth witnesses to the payload, so the proof helper retains them.
- `NO_FROM` makes the sponsor the transaction root. Owner scopes and
  `sendMessagesAs` are retained for note discovery without changing fee payer.
  The proof helper checks the actual proven fee payer, not just requested options.
- The fee-cap calculation equals pinned `GasSettings.getFeeLimit()` (DA plus L2
  gas limits times their maximum fees; teardown is within those limits). The
  contract independently enforces coupon lifetime, gas bounds and single use.
- Claim/exit preserve existing membership-root/canonical-anchor checks, exact
  delivered/consumed note checks, node validation and successful inclusion. The
  exit asserts the note has no prior posts; the scope intentionally excludes
  sponsored posting.
- Sponsor shared funding starts at zero, uses actual L1 mint/deposit/Inbox
  membership, proves an ordinary operator-paid claim and verifies full sponsor
  credit plus exact operator debit against the receipt fee. Final bridge checks
  sponsor debit equals claim plus exit receipt fees and author balance remains0.
  These assertions prevent genesis-funding or author-payment substitution from
  silently satisfying the shared-sponsorship result.

## Findings and required qualifications

**W01-R01 — Standalone client registration precondition (nonblocking here).**
`prepareSponsoredAction` validates both contract instances but registers only the
sponsor. Current C01 claim/exit callers already register the board in each wallet,
so their composition supplies this prerequisite. Before exposing this preparation
API to a freshly created browser wallet, either register the already-verified
board instance inside the client or document/test the caller prerequisite. Merely
constructing `Contract.at(boardAddr,boardAbi,wallet)` is not a PXE registration.

**W01-R02 — Replay evidence is narrower than sponsorship replay (scope).**
The preserved deposit replay diagnostic constructs a fresh direct account claim
request and requires the specific consumed-message witness error. It therefore
still tests application Inbox replay, not sponsor coupon replay. An unfunded
account error would fail the check rather than count as success. Do not describe
this result as a genuine sponsored coupon double-spend test; coupon reuse needs
its own applicable contract/runtime evidence.

**W01-R03 — Current coupon issuance does not establish privacy (scope).**
The fixture constructs owner/blind/coupons in trusted local memory and registers
one-ticket batches. It records `issuerQualified:false`; this is appropriate.
Single-ticket batches, visible funding timing and a trusted local issuer do not
establish issuance unlinkability or a production anonymity set. A real issuer,
public RPC privacy, posting and operational funding policy remain separate work.
Shared FeeJuice replenishment shows that an author need not own a public fee
balance; it does not alone prove end-to-end anonymity.

**W01-R04 — Read readiness differs from proving anchor (fail-closed usability).**
The client preflights batch activity/config at latest state, while the author PXE
uses checkpointed anchors. The actual contract enforces state/window validity at
its chosen proof anchor, so this does not bypass security checks. Near a new batch
or epoch boundary a preflight may succeed before proving can; callers must sync
and re-prepare when needed. The present harness waits ordinary inclusion, syncs
its wallet and requires substantial window time, reducing this test risk.

No skipped fee enforcement is used for submitted/proven transactions: the client's
`skipFeeEnforcement:true` applies only to static public config/batch simulations
under `NO_FROM`. Actual proof construction and `node.isValidTx(tx)` retain normal
fee enforcement. The parent still explicitly uses controlled test settlement for
L1 refund and does not claim a genuine rollup epoch proof or production readiness.
