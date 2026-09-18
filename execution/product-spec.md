# Production contract and acceptance specification

P01 execution, 2026-09-11 local date. This document defines intended behavior, not
verified current behavior. The historical security-properties document and baseline
review contain claims that must be re-established. The first release retains ETH
escrow and a designated censor. No new custody authority is introduced.

## Actors and observations

The depositor controls the L1 address and fresh claim secret. The author controls
the private Aztec wallet and the note for that deposit. They may be the same person,
but public posts must not contain a stable identifier joining them. The censor can
flag posts within the contract's declared window and transfer its own authority;
it cannot spend collateral or prevent an otherwise valid exit indefinitely. The
deployer wires exactly one intended portal and configuration before deposits open.
Authors fund an ownerless private-fee contract and spend their private credit.
No fee sponsor, coupon issuer or fee-service operator is part of the architecture. The feed operator reads public data only. Operators can fail or be malicious
within these privileges; their interfaces must not implicitly grant more authority.

Adversaries may control other depositors, L1 message senders, other Aztec contracts,
malformed historical notes, public post content, model responses, RPC responses and
transaction timing. They may replay, reorder and concurrently submit transactions.
Assume the accepted underlying protocol's cryptographic soundness/finality and
supported wallet cryptography, but verify application use of those primitives.
Independent network security clearance is required; application tests cannot prove
the base protocol sound.

A chain observer sees L1 funding/deposit/withdrawal bookends, public messages/posts,
flags, timing and transaction metadata including fee payer. The RPC may observe IP,
request timing and queries; the frontend host sees delivery requests. The public funding amount and timing remain visible; private credit does not hide
those funding bookends. Do not promise anonymity against a colluding
global network observer or self-identifying text. Minimize request/account coupling,
logs and telemetry, document remaining exposure, and never equate a hidden function
argument with full transaction privacy.

## State transitions

1. **Unconfigured → configured:** verify target, deployed code, initialization,
   L1/L2 actors, minimums, censor, policy and bridge addresses. One-time wiring uses
   verified actual addresses. An unavailable read is failure, not approval to link.
2. **No deposit → escrowed:** validate the exact configured minimum/maximum and
   single-active-deposit rule; retain amount, depositor and deposit identity and
   emit one domain-separated claim message. The frontend journals the transaction
   before reporting progress. Ordinary unsolicited ETH is rejected; forced ETH
   changes balance but not a depositor's credited liability.
3. **Escrowed → claimed:** consume the authentic intended portal message with its
   bound chain/version/actor/content and secret. Create one owned private right
   with an unambiguous deposit-chain identity and initial cooldown. Wrong origins,
   replay and incomplete configuration cannot create rights. A public post must
   never publish that private deposit identity.
4. **Claimed/active → posted:** consume and replace the rightful deposit note.
   Authenticate any history used for screening, enforce age/time and economic
   bounds, assign an independent post identity, and commit public content atomically.
   A public order index may be assigned during public execution; a private proof
   cannot depend on having reserved its live value. Dummy posts advance private
   screening without public content, under the same valid state constraints.
5. **Unflagged → flagged:** only the current authorized censor may flag an existing
   eligible post. Policy/model versions and decision provenance are retained by
   the service. Malformed model text has no signing or command authority. An
   application revert leaves the job incomplete. Onchain flags retain their existing
   finality semantics; human review may correct UI hiding and future policy but
   cannot promise reversal that the contract does not implement.
6. **Unscreened → screened:** confirmed board-note inclusion, owner, slot, time,
   chain identity and immediate link relationships all hold. Progress is monotone
   within one deposit chain and cannot cross an unscreened real post or reuse a
   different/old chain. A flag's economic effect is applied exactly once.
7. **Active → exit authorized:** all real posts are screened and all applicable
   cooldown/penalty debt has expired. Consume the note and emit the intended
   domain-separated withdrawal message. New posts cannot reuse the consumed right.
8. **Exit authorized → paid:** after actual bridge finality, consume exactly the
   correct withdrawal message, clear liability before external transfers, and pay
   the original L1 depositor exactly its recorded amount. Failure rolls back;
   retries cannot pay twice. A new deposit has a new chain identity.

Frontend/daemon stages distinguish prepared, submitted, pending, confirmed-success,
reverted, dropped, unknown and reorged. RPC timeout is unknown, not failure or success.
Persist enough provenance to reconcile each stage after reload or long absence.
Retain secret material only in the reviewed private wallet storage/backup path.

## Economic precision and exit default

Let amount A, minimum m, base cooldown b, multiplier k and saved-post cap M be
validated positive bounded integers. Define `c = max(1, ceil(b*m/A))`, with checked
wide multiplication and checked timestamp conversion. Upward rounding preserves the
intended upper rate bound; floor rounding may exceed it. C05 documents compatibility
with the experiment and tests exact integer values.

Initial eligibility is claim time plus c. For a post at time t with f newly screened
flagged posts, use an explicitly tested save-up rule with at most M immediate posts
after dormancy. A reference specification is
`effective = max(previous_next, saturating_sub(t, c*(M-1)))`, require
`t >= effective`, then set `next = effective + c*(1 + (k-1)*f)` with checked arithmetic.
M=1 permits no accumulated burst. This avoids calling an M+1 burst an M-post limit.
P04/C05 may choose an equivalent state representation but must preserve the bound.

For the first release, withdrawal waits until the resulting next-eligible timestamp
in every case, including recently screened real posts. Waiting out the debt before
redepositing prevents penalty reset without new identity tracking or administrator
custody. Finite debt plus a responsive protocol and correctly funded client must
permit finite exit; the censor cannot extend a finalized screened flag indefinitely.

Do not introduce a unilateral timeout refund or admin sweep. Recovery first means
resuming legitimate claims/exits from persisted data. Any later cross-chain refund
mechanism must invalidate/reconcile rights atomically enough to preserve liabilities.
Lost secrets and a permanently unavailable underlying chain are explicit limitations,
not reasons to manufacture an unsafe refund path.

## Requirement-to-test matrix

Test IDs below are planned acceptance scenarios, not assertions that test files or
passing results already exist. Implement them in the appropriate package's suite.

| Requirement | Invariant and actor | Failure behavior | Planned acceptance scenarios / owner |
|---|---|---|---|
| REQ01 | Builder produces the same contract/VK/SDK/app outputs from immutable inputs; deployer uses those outputs. | Missing tool, stale artifact, unpinned dependency or ABI mismatch fails build/preflight. | BUILD-01 clean double build; BUILD-02 stale artifact mutation; BUILD-03 SDK worker/prover provenance — P02/A01/D01. |
| REQ02 | Depositor rights and liabilities correspond to exactly one authentic collateral claim and one payment. | Wrong portal/actor/version/amount/secret, replay, reentrancy and uninitialized states revert atomically. | BRIDGE-01 valid roundtrip; BRIDGE-02 origin matrix; BRIDGE-03 replay/conservation/reentrancy/forced-ETH — C01/C06/T02. |
| REQ03 | Author screens only authentic notes from the same owner, slot, board and deposit ancestry. | Foreign or skipped history cannot advance progress. | NOTE-01 foreign origin; NOTE-02 wrong owner/slot; NOTE-03 two deposits and old roots; NOTE-04 skipped/too-young links — C02/T01/T02. |
| REQ04 | Concurrent authors and long-lived accounts retain complete history and finite exit. | Genuine conflicts are surfaced and re-proved; no global-counter starvation or fixed lifetime page cutoff. | SCALE-01 ten same-anchor authors; SCALE-02 1,000 posts/account across cycles; SCALE-03 required hints after 16/32/1,000; SCALE-04 exit during traffic — C03/C04/T04. |
| REQ05 | Author's checked rate/penalty debt follows the model; no withdrawal/reset or overflow bypass. | Invalid parameters fail before accepting collateral; ineligible actions revert; eligible exit works. | ECON-01 rounding/burst boundaries; ECON-02 flags/withdraw/redeposit; ECON-03 overflow/time fuzz; ECON-04 finite exit — C05/C06/T01/T02. |
| REQ06 | Chain observer sees no reusable author tag introduced by fees/funding/posting; remaining network/content limits are explicit. | Unsupported fee route or insufficient private credit never silently falls back to a per-author public fee payer. | PRIV-01 full observable footprint; PRIV-02 repeated posts/accounts/funding; PRIV-03 fee outage/recovery; PRIV-04 RPC/host/funding traces — W01/T03. |
| REQ07 | Wallet secrets remain private; author state reconciles with actual successful receipts across interruption. | Unknown/reverted/dropped/reorged outcomes remain distinct; no duplicate collateral movement. | WALLET-01 backup/restore; WALLET-02 log scan; TX-01 receipt matrix; TX-02 crash every stage; TX-03 >500-block absence/reorg — W02/W03/T04. |
| REQ08 | Only allowed censor operations use signing authority; every eligible job is durable and policy-correct. | Malformed model data is inert; failed flags retry until deadline or explicit terminal incident. | MOD-01 hostile arguments; MOD-02 restricted signer; MOD-03 lease/crash/retry; MOD-04 empty-board policy refresh; MOD-05 actual model evaluation/deadlines — M01/M02/M03. |
| REQ09 | Reader needs no wallet; supported authors can use safe accessible browser flows. | Bad content stays text; unavailable proving is explained; feed pagination/reorg errors recover. | FEED-01 incremental/reorg; UI-01 complete browser journey; UI-02 hostile rendering/keyboard; HOST-01 HTTPS/headers/workers — F01/U01/T04. |
| REQ10 | Operator can detect liabilities, fee/job failure and recover within budgets; deployment uses verified actual addresses. | Bad configuration fails closed; no alert or recovery path leaks secrets. | OPS-01 drift/fee/deadline alerts; OPS-02 rotation/outage drills; DEPLOY-01 missing CREATE2; DEPLOY-02 wrong/unreadable wiring — D01/O01/O02/T06. |
| REQ11 | Reviewer can reproduce meaningful evidence for one candidate including real proofs and actual elapsed operation. | Mocked proofs, vacuous assertions, missing review, changed source or unrun soak block sign-off. | ASSURE-01 mutation-sensitive invariants; ASSURE-02 independent audit closure; ASSURE-03 final suite; ASSURE-04 336-hour soak — T01/X01/X02/T05/T06. |
| REQ12 | Deployer/operator uses a currently suitable requested target with explicit consistent config. | Stale/uncleared guidance, mismatched rollup, unapproved retargeting or missing ownership blocks release. | NET-01 official guidance refresh; NET-02 node/L1 preflight; OWNER-01 actual handover — X03/O02/R04. |

## Predeclared measurement budgets

These are engineering acceptance targets to measure, not forecasts of current
Aztec performance. Retain the same benchmark conditions and report p50/p95/max,
sample count and errors. A target that proves infeasible is an explicit requirement
issue to resolve, not an invitation to change the denominator or hide failures.

| Area | Workload and target |
|---|---|
| Correctness/privacy | Zero unauthorized collateral/notes/flags, false-success receipts, duplicated payments or preventable reusable-author public tags in mandatory scenarios. Every negative case fails at the intended boundary. |
| Load/history | Ten distinct authors prepare from one anchor; all make progress. At least 1,000 lifetime posts per long-history test account across three deposit cycles. No new contract-imposed cutoff or shared-counter invalidation. Each legitimate attempt either succeeds or receives an actionable recoverable outcome; no unexplained starvation over ten consecutive blocks after eligibility. |
| Browser reference | Current stable Chrome/Firefox/Safari desktop; record exact versions. Reference hardware: Apple Silicon with at least 16 GB RAM, and a comparable Linux/Windows Chromium host if available; record actual CPU/RAM. Cold proving p95 <=180 s and warm proving p95 <=90 s over >=30 posts per supported engine, excluding documented chain inclusion/finality waits. Initial public-feed p95 <=3 s over 30 fresh loads at 20 Mbps/100 ms RTT; no private wallet/proving download required for reading. |
| Transactions | Pending status visible within 1 s of submit acknowledgement. Reconcile a restored client within 60 s of healthy RPC access, excluding proof computation and chain finality. Persist every acknowledged stage; at least three injected interruption points per stage, including immediately before and after response persistence. |
| Moderation | Holdout corpus >=300 labeled cases with >=50 multilingual and >=50 prompt-injection/formatting cases. False-positive rate <=2% and false-negative rate <=5% on the explicitly labeled policy corpus; separately report ambiguous cases and class denominators. Real model response p95 <=10 s on recorded production-like hardware. Complete eligible flag submission with >=20% of censor window remaining under the declared admission rate; no correctness assumption that the model is infallible. |
| Moderation load | Baseline supported arrival rate one post/minute sustained and a burst of ten posts, plus a two-hour backlog/recovery trial. Scale application admission or worker capacity only with measured privacy-preserving limits; test ten simultaneous authors independently of sustained admission policy. |
| Feed | Query work proportional to new/reorged events plus bounded page size; 100-post pages p95 <=2 s from healthy local service with 10,000 public posts. Demonstrate rollback/replay of at least a three-block reorg fixture. |
| Operations | Critical injected incidents alert within 60 s; runbook restores service within 30 min after dependencies return. Private-fee tests enforce the configured per-transaction maximum and fail closed on exhausted user credit, with no public-fee fallback or automatic funding. No monetary production budget is inferred: local tests use fake/test-only units; O02 obtains an actual approved cap. |
| Soak | Fourteen consecutive actual days, >=99.5% application-service availability excluding explicitly itemized base-network outages (report both inclusive and exclusive availability), zero unresolved correctness/privacy incidents, monitoring coverage >=99.9%, and every required failure drill. Material code changes restart affected release evidence and the representative soak. |

If hardware or public testnet access is unavailable, retain the target and record the
missing environment. Node health does not substitute for official production clearance.

## Open inputs and risk ownership

The implementation may proceed using synthetic moderation policy, fresh local
identities and bounded fake fee budgets. Before production, obtain actual policy,
private-fee route and funding limits, operator/incident owners and credential restrictions in O02. Prepare
the audit packet in R01 before seeking a reviewer; X01/X02 require independent
Aztec/Noir and Solidity review. Only X03 can establish current target suitability;
if V5 is unsuitable, propose the migration delta and get the user's target decision.
No current input requires pausing P02 or isolated code repair.

Track B01–B12 under their existing graph packages. Highest uncertainty is complete
transaction privacy (W01/T03), constrained note-origin/ancestry (C02/T01), reproducible
SDK/prover compatibility (P02), and actual proof-enabled cross-chain recovery (T02).
Resolve these with discriminating local prototypes before relying on them. Keep
new findings in execution/risk-register.md and add graph dependencies when needed.
