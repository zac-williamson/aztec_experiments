# Changes from the original repository

Based on vbuterin/aztec_experiments at `1849967d15d96ab96234091f2fa47d8762a6c06a`.
This is an engineering candidate, not a production-ready release. The original
Ethereum escrow, Aztec private posting and centrally administered moderation
architecture is retained. There are no existing deployments to preserve compatibility with.

| Area | Changes implemented |
|---|---|
| Escrow and bridge | Authenticated deposit/claim/withdrawal message commitments, compact deposit notes and replay/accounting controls. Genuine local deposit-to-refund journeys tested. |
| Screening | Screening is bound to authentic notes, their owner and deposit ancestry, with rejection controls and genuine application tests. |
| Concurrent posting | Independent post identities replace shared-counter contention. Ten authors proved from one common anchor and their posts were included in a bounded local test. |
| Moderation service | Shell-free model execution, process isolation and a restricted signing boundary replace the unsafe command/signing path. Full production moderation operations remain unfinished. |
| Private fees | Ownerless private fee contract funded by users, private balance payments and first-transaction bridge claims. Coupon contracts, issuer service, registration and storage were removed. |
| Client boundaries | Restricted RPC credential forwarding, canonical fee configuration, public funding-recovery metadata with wallet-derived secrets, and preservation of ambiguous submission errors. |
| Builds and tests | Pinned Aztec 5.2 toolchain, reproducible contract/client artifacts, dependency checks, CI/build controls and genuine application tests using official local settlement controls. No network epoch prover is needed by the current application harness. |
| Delivery records | Persistent dependency graph, requirements, decisions and source-bound test evidence, including retained failures and their diagnoses. |

## Evidence and limitations

See [current status](execution/status.md) for measured milestones and
[the execution graph](execution/GRAPH.md) for dependencies. Local proofs and
component tests do not establish economic finality, a production anonymity set,
independent audit approval or current target-network suitability. Historical
reports apply to the source and contract class recorded in each report.

Remaining work includes qualification of the replacement private fee route,
full screening history and policy/recovery behavior, remaining wallet/feed and
operator work, final candidate qualification, independent review, a representative
14-day soak, and target-network compatibility/release clearance. No public network
deployment or real-fund operation has been performed as part of this work.

The original README and formal-verification material are retained for attribution
and historical context; their claims must not be read as current release assurance.
