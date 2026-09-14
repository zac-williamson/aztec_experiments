# Active risks

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
