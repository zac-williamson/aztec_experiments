# T03 preparation — measured privacy evidence gaps

Read-only preparation, 2026-09-17. T03 is not activated by this note; T02 remains the prerequisite until root completes it. No new tests, network calls or source edits were performed.

Reviewed current T03 criteria, P01 observer model/REQ06, A01 provenance evidence, W01 private-fee privacy observations, private-fee client/payment/funding code, user engine routing, browser RPC fixture, hosting configuration, U01 actual browser-post041 and T02 journey evidence. A01 is artifact provenance; P01/W01 supply the relevant privacy model. Historical P01 sponsor/coupon terminology must be reconciled with the current ownerless FPC without rewriting historical evidence.

## What is already established

The public fee payer is a deterministic shared ownerless FPC. `shared/private-fee-client.mjs` verifies canonical instance identity and separates owner from payer; ordinary spending checks private credit and throws `PRIVATE_FEE_BALANCE_INSUFFICIENT` before preparation if insufficient. The user engine requires private-fee configuration and does not intentionally select a per-author public fee route on failure. Payment methods explicitly name the shared FPC.

W01 and T02 genuine transactions reconcile exact private debit, public pool protocol fee debit and zero author public FeeJuice balance. U01 browser041 independently verifies a real browser-generated first post and canonical note/public effects using this route. These observations establish the selected fee route; they do not inspect every public transaction field or all RPC request parameters for author linkage.

Funding is visibly public: Ethereum sender, amount, approval/deposit timing, FPC recipient and secret hash are observable. Cold-start FeeJuice claim increases the FPC public pool and can correlate the first transaction with funding. Current funding code derives secret/salt using the wallet key and owner but sends the shared FPC as public recipient. Public recovery records intentionally include sender/nonce/amount/transaction metadata, not the private secret. This is not anonymous bridging.

U01 browser041 records same-origin request paths and zero external requests, not per-method RPC argument exposure or an observer timeline. TLS/CSP/no-referrer/no default Caddy access-log directive reduce avoidable exposure; neither prevents RPC/frontend-host correlation. No network anonymity layer is present.

## Smallest concrete evidence additions

### 1. Chain footprint audit on existing genuine transaction objects

Extend the existing bounded application harness with a test-only in-memory classifier, close to post inclusion/verification, rather than starting a new protocol fixture. Inspect actual public transaction/effect representations and decoded L1 approval/deposit/claim events. Record field names/roles and fixed booleans for matches to disposable author, shared FPC, board, moderator and L1 funder; do not serialize private witness/note preimages or arbitrary payloads. Explicitly distinguish public effects from PXE-local inputs.

Cover at least a cold-start claim and two ordinary posts by the same author, plus a different author sharing the same canonical FPC. Existing independent genuine reports show the same canonical payer, but a report-only comparison cannot prove the absence of another reusable public author tag across posts. Reuse an existing posting/recovery profile that already prepares multiple transactions, or add only one additional post to a bounded profile if it fits the unchanged budget. Two small serial profiles are preferable to a new giant fixture or higher resource limits.

Assertions: author is not fee payer; no author account appears in identified public call arguments/log fields unless explicitly explained; payer remains the same across owners; post nonce/nullifiers differ; no public registration/funding event exposes the reusable author address. Treat exact-byte substring scans only as additional smoke checks, not an exhaustive privacy proof. Public keys/derived tags require semantic field inspection and independent cryptographic review.

### 2. RPC and frontend observer traces during the actual browser run

Instrument only the test transport boundary (`scripts/u01-browser-rpc.mjs`) and browser request listener, leaving SDK/engine/prover behavior unchanged. Classify each parsed RPC batch in memory: allowlisted method, relative time bucket, bounded request/response size, occurrence count, and whether known disposable author/funder/board/FPC values occur in named public parameter positions. Persist only classifications, never raw bodies, headers, tokens, keys, addresses inferred from private inputs or error payloads. Preserve batch semantics, body limits and Origin/token guards.

Separate observations for Ethereum RPC, Aztec RPC and static host. Ethereum RPC necessarily sees the funding sender; determine whether Aztec node queries expose the author account, note discovery tags or contract-instance registration lookups. Host traces should cover cold versus warm wallet initialization and post/screen/withdraw selection, recording paths and timing only. Current grouped bundle/deferred object construction should not create operation-specific artifact fetches; verify actual footprints rather than inferring this from imports. Note that the current driver uses a combined same-origin test proxy: an operator of that proxy can associate both RPC channels and static traffic. Production configurations with separate origins change observer access, not the underlying timing leakage.

Reuse one next genuine browser-post run for actual transaction timing; do the cheap operation selection/cold-warm asset comparisons with the existing HTTPS UI fixtures, explicitly labelled as request-footprint/UI evidence. No new network epoch prover is needed.

### 3. Fee exhaustion and failure route, without an extra successful proof

Add focused assertions to the existing private-fee-client/user-routing tests: zero and below-maximum credit, exact maximum, missing configuration, wrong canonical FPC, failed balance read, changed network and malformed/consumed recovery input. Capture invocation counts at the fee-routing boundary. Require no fallback payment method, no switch to owner public fees, no automatic fresh funding or unsigned resend, no false success, and preservation of the pending recovery record.

For actual-state evidence, reuse a genuine funded wallet after a completed action. Select valid gas settings whose maximum exceeds its known remaining credit, call the production preparer, and require the exact insufficient-private-balance code before proving/submission. Verify the valid private note/balance and public pool did not change. This is a read-only preparation failure using genuine state, not a completed hostile proof. A zero-public-balance author is helpful but cannot by itself show no fallback was attempted: assert attempted calls too.

Recovery tests should restore the same encrypted wallet/journal and public funding record; inspect no private material is emitted in UI/log/storage export, recipient stays canonical, and recovery success does not create a different per-author public fee route. Existing W03 journal/anvil and U01 fixture tests can be extended with these route assertions rather than duplicated. Genuine crash/reload at each browser lifecycle stage remains T04.

### 4. Funding/cold-start correlation and user claims

Reconcile actual L1 funding events and first L2 claim/post timing from existing W01/T02 evidence where retained. If existing reports lack L1 event fields, collect them through the same next bounded run; do not reconstruct missing observations from assumed code behavior. Record that unique amounts, immediate claiming, repeated L1 sender and small populations can correlate funding with the first action even though the recurring public payer is shared.

Publish a current privacy statement covering chain observer, funding observer, Ethereum/Aztec RPC operators, frontend host, collusion, local wallet/journal compromise and self-identifying content. Explicitly separate ordinary private credit spending from public funding/withdrawal bookends and cold-start linkage. Do not promise protection supplied only by an imagined large anonymity set or independent third-party routing.

T03-A01's phrase “No reusable public author fee-payer or funding linkage” must be assessed against measured cold-start behavior. Public L1 funder identity and amount correlation already exist; hiding the reusable Aztec account does not make bridging anonymous. If actual footprint reveals a deterministic reusable author tag, fix it before passing. If only permitted observer/timing bookends remain, document the threat-model interpretation explicitly rather than weakening the criterion silently.

## Specific gaps by acceptance

| Criterion | Present evidence | Missing evidence |
|---|---|---|
| A01 | Canonical shared payer, private debit/public fee reconciliation, zero author public balance | Semantic complete public footprint across repeated posts and owners; measured cold-start/funding correlation; confirmation no reusable author tag elsewhere |
| A02 | Known observer limits, same-origin path list, zero external requests, security headers | Actual per-method/parameter role classifications, relative timeline/size traces, separate observer views and cold/warm operation footprint |
| A03 | Fail-closed source, private-fee unit tests, W03 recovery and UI fixtures | Explicit no-fallback/no-resend invocation checks across exhaustion/recovery errors plus genuine-state insufficient-credit preparation rejection |
| A04 | W01 and browser docs state public funding/network limits | Current source-bound privacy statement with measured traces, small-set/content/timing limits, and direct mapping from each product claim to evidence |

## Execution order and ownership

After T02 completion: inventory existing test coverage first; implement the cheap routing/record-sanitization checks and trace collector; add the collector to one already bounded actual application/browser workload; review observed leaks before expanding tests. Keep 540-second/2-GiB serialization and source fingerprints. Preserve all original26/fresh57 diagnostics and assign tagging/default-sender/randomness/recovery privacy cases to the diagnostic register. Ordinary payment success cannot discharge unconstrained-delivery/privacy obligations. Kernel soundness and independent cryptographic disposition remain X01/X02; observable recovery/fallback failures remain internal work.
