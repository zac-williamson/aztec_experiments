# Internal privacy qualification

The same-board repeated/cross-author test passed in 367,706 ms with peak owned
RSS of 1,395,760 KiB. Both author wallets stopped; the supervisor confirmed no
owned processes or temporary directory remained. The actual evidence is
application-ba9199a9-b7f2-45a3-90e5-5e3532fff5aa.json.

A claimed genuine collateral and posted A1 then A2; B separately funded fees,
claimed genuine collateral and posted B1. Each claim and post used real private
proofs verified by the node. Both authors' Ethereum collateral funders and fee
funders were distinct from each other and the actual sequencer coinbase. Each
post consumed its expected deposit nullifier and created the exact next private
state, published content and canonical timestamp/deadline.

All three posts used the same ownerless fee payer. No exact author, other-author,
collateral-funder or fee-funder identity occurred in the inspected public fields.
Pairwise comparisons found zero shared nonzero note commitments, nullifiers or
private delivery tags. These are actual SDK Tx/TxEffect observations, not decrypted
witnesses; unequal opaque fields do not prove unlinkability. Exact per-owner credit
and aggregate public pool equations passed. Both public author FeeJuice balances
remained zero. Total funding was 2,000,000,000,000,000,000,000 units and actual
protocol fees were 104,776,033,400,000 units.

The complete Chromium lifecycle (browser-observations-048.md) separately measured
RPC/host observations and claim/post/screen/exit public fields. Five account-class
lookups disclose the author's address to the RPC endpoint. Eighteen argument
classifications were truncated; absence conclusions for those arguments remain
incomplete. Same-origin hosting exposes request timing/origin. Public Ethereum
bridging exposes funder, amount and timing; this test uses one disposable operator
to provision its separate test identities and is not anonymous funding evidence.

Focused production client/engine tests exercise insufficient credit, wrong payer,
invalid funding, unknown outcomes and recovery. They require explicit rejection
before fees/proof/submission where appropriate, retaining the selected private
route. They do not substitute for successful real transaction proof evidence.
Historical genuine W01 funding/recovery and U01 actual-state insufficient-credit
observations remain bound to their original sources; current browser restart is
being qualified separately in T04.

## Acceptance interpretation and review boundary

T03-A01 was explicitly clarified in decisions.md with independent internal review:
no reusable author-specific public payment/funding identifier in ordinary posting,
not absence of public bridge amounts/timing or arbitrary statistical correlation.
A deterministic leaked identity still fails. A03 now explicitly excludes alternate
payment routes, reflecting the user's no-fallback instruction. REQ06's documented
threat model is preserved; no cryptographic warning or audit obligation is closed.

The compiler inventory remains 26 original occurrences at 12 sites and 57 fresh
occurrences at 18 sites. This package supplies observations for delivery/tagging,
neutral public query sender, private fee ownership and rejection/recovery behavior.
Entropy, cryptographic tag derivation, protocol private-call assumptions and
unobserved derived identifiers remain independent-review obligations under X01/X02.

Commands use pinned Node 24.21.0 in the repository. Run049 is the explicit
repeated-private-posts scenario under unchanged 540-second/2-GiB supervision.
Six actual-SDK classification regressions and 45 harness checks passed; 113
private-fee client/engine/funding-engine checks also passed.
Shared sequential primitives were extracted from T02 without weakening its
screening/penalty/withdrawal checks. Final candidate reconciliation still reruns
or reconciles affected package acceptance; internal qualification is not release.
