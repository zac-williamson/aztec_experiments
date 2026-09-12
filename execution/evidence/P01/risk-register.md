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
