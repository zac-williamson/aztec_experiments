# Active risks

Baseline table descriptions below are historical, not current open/closed status.
Use graph.json and source-bound task evidence for current qualification. Later
sections record additional findings and dispositions.


P01: none of the implementation findings below is closed by writing the specification.

| Risk | Baseline / owner | Current evidence and resolution |
|---|---|---|
| Reusable identity from fees/funding | B01 / W01,T03 | Confirmed default-path concern. Prototype supported fee route; inspect complete observer traces. |
| Stale artifacts/ABI and miswired deployment | B02,B10,B11 / P02,A01,D01 | Local EVM/source evidence. Require pinned clean rebuild and fail-closed actual-address verification. |
| Counterfeit posting rights | B03 / C01 | Missing portal authentication confirmed. Need constrained check and negative proof-enabled tests. |
| Model output interpreted as shell | B04 / M01 | Unsafe construction confirmed. Argument arrays plus restricted signer, tested with inert adversarial data. |
| Wrong-chain historical note screening | B05 / C02,T01 | Missing constraints confirmed; full adversarial proof not yet executed. Do not label it reproduced before the experiment. |
| Counter contention and incomplete history | B06,B07 / C03,C04 | Source/model evidence. Same-anchor authors and long PXE histories required. |
| Exit resets economic debt | B08 / C05 | Source/model mismatch. Universal expired-debt exit default avoids new identity/custody mechanism. |
| False success and lost moderation duties | B09,B12 / W03,M02 | Mocked receipt/source evidence. Durable state, reorg reconciliation and confirmed retries. |
| Old security document overclaims | P01,T01 | Superseded by production specification. Meaningful state-transition assertions replace vacuous claims in T01. |
| Build stack cannot be reproduced on host | P02 | Exact beta.22 compiler previously obtained; full SDK/CLI/runtime not yet validated. Isolate versions; do not silently migrate protocols. |
| Underlying target unsuitable | X03 | Baseline notice is historical. Fresh official guidance and actual target observations required for final gate. |
| Review/operator inputs unavailable | X01,X02,O02 | External prerequisites, not blockers to local engineering. Prepare concrete packets first. |
| Browser/model capacity below targets | U01,M03,T04 | Budgets are predeclared targets, not measured claims. Retain failures and assess product tradeoffs explicitly. |

Each update records date, task, severity/impact, evidence, owner, next action and
disposition. Never close a risk because an unrelated test count increased.

## P04 additional dependency and compiler qualifications

N01 (additional risk, owned by A02): the exact 5.2 lock reports 84 total and 46 production-tree npm advisories. Exact
paths/severities are preserved in P04 evidence. A02 owns fixes/treatment and blocks
R01 audit-candidate freeze; no automatic dependency override or release waiver.

The matched compiler emitted 26 manual-constraint diagnostics in 12 upstream
locations. Source review found local/context/kernel checks and intentional random
padding, but no item is declared a proven false positive. T01/T02/T03/T05 and
R01/X01 must reconcile relevant adverse proof/privacy cases and independent
disposition against actual final artifacts. Details are in compiler-diagnostic-review.md.

## 2026-09-12 X03 official-guidance refresh

The bounded delegated primary-source recheck found no explicit later clearance lifting the August7 V5 deployment pause. The August17 package5.2 interoperability statement is separate from incident closure. See evidence/X03/clearance-recheck-2026-09-12.md for inspected sources/dates and limits. X03 remains a production-release blocker; local engineering continues. Final network state and fresh clearance still require verification.

## W01-F01 — RPC credential attachment to unrelated origins

Reproduced2026-09-15 with an in-memory fetch observer: the previous shared/app-env.js wrapper attached the configured RPC credential when any request URL contained `aztec-labs.com`, including that text in an unrelated origin's query. No network request or real credential was used. W01 owns remediation under fee/RPC/issuer observations (W01-A02); T05 must retain the regression on the final client candidate.

The wrapper now compares parsed origin and exact configured JSON-RPC pathname, preserves Request headers, and rejects redirects on credential-bearing requests. The baseline observation is `evidence/W01/rpc-credential-baseline.json`; two tests of the actual wrapper pass in `evidence/W01/rpc-credential-boundary-002.log`. Browser release qualification remains part of later client/release verification. This finding does not establish that any real credential was transmitted to a third party.

W01-F01 generated-page follow-up: a second immediately executed wrapper in shared/aztec-lib.js still used substring matching underneath the fixed app-env wrapper. Actual combined-source in-memory reproduction confirms credential leakage to an unrelated URL (rpc-duplicate-wrapper-baseline.json). Removed duplicate installation; all four app entrypoints already call the single app-env setup after it loads. Generated consumer checks and rebuilt pages verify the final boundary.

## T01 current compiler and formal disposition (2026-09-17)

Fresh source-bound compilation records57 manual-constraint occurrences at18sites
across Billboard and PrivateFPC, including all12 original locations. The increase
is not a count of vulnerabilities. All occurrences remain open qualifications;
sixnewsites include private-call counters/returns and the fee contract's explicitly
unconstrained note-delivery paths. See evidence/T01/fresh-diagnostic-disposition-006.md
and its complete bound inventory. Relevant application probes reduce uncertainty;
they do not prove protocol circuits or satisfy independent review.

Historical Lean/Verity models are retired, not repaired or accepted: True-valued
claims, an inconsistent constant-hash/injectivity assumption and missing fee
observations cannot support release. The maintained finite state models and
mutation controls are explicitly scoped specification checks.
