# T02-A04 public testnet review — 2026-09-17

Read-only review; no transactions, accounts, funds, installation, version changes or retargeting. Local references: `toolchain.json`, P04 `compatibility-preparation.md`, X03 `clearance-recheck-2026-09-12.md`. Current pins remain Aztec 5.2.0 / Noir beta.25 / Node 24.21.0.

**Finding: a documented V5 public testing candidate exists; live compatibility and deployment clearance are not established. This is not confirmed incompatibility or proof the network is unavailable. T02-A04 remains unqualified.**

## Current primary sources (retrieved 2026-09-17)

- [Official network reference](https://docs.aztec.network/networks), undated: lists Testnet software 5.1.0, Sepolia chain `11155111`, rollup version `1821665230`, RPC `https://v5.testnet.rpc.aztec-labs.com`. Documented L1 Registry is `0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba`, rollup `0xD73A91bdcF6891C7642F3e460036e1ef2CC23178`, inbox `0x3047dBF2b7dd9f58AC41113525480F94745a4f7C`, outbox `0x905f80009bBef9d9426675B45009922971eD42fF`. Documentation describes Testnet as the staging environment before Alpha. These are published expectations, not live chain observations.
- [Official releases index](https://github.com/AztecProtocol/aztec-packages/releases), 5.2.0 dated 2026-08-17: explicitly states unchanged protocol constants, 5.1/5.2 node interoperability and no coordinated redeployment requirement. This supports testing the pinned application on the documented V5 testnet; the version-table difference alone is not evidence of incompatibility. Direct tag page retrieval omitted most release-body text; the index supplied it.
- [Official registry guidance](https://docs.aztec.network/operate/operators/prover/claiming-rewards), undated: canonical rollup identity comes from the Registry `getCanonicalRollup()` result. Published addresses cannot replace that read.
- [Official V5 incident notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability), 2026-08-07: still asks planned V5 deployments to pause pending further guidance and describes a protocol proving-system exposure. No explicit later clearance appeared in the inspected official blog/release indexes or domain-filtered guidance searches. This bounded search is not proof that no other guidance exists. The notice does not explicitly resolve a disposable Sepolia rehearsal exception; neither a testnet RPC listing nor a later maintenance release supplies that clearance.

## Remaining check / unblock

1. Obtain applicable official follow-up or clarification of disposable public testnet rehearsals; retain X03 production clearance separately. Continue local application work in parallel.
2. Read the candidate RPC node info and Sepolia Registry at recorded block heights; reconcile chain/version/canonical rollup, inbox/outbox, protocol contract identities and artifact roots with the pinned SDK and candidate deployment manifest. No such RPC checks were performed here.
3. Only then qualify the actual public testnet deployment and application journey, including private fee funding, post/flag/screen/exit and L1 refund under real settlement. Local accelerated fixtures do not satisfy this acceptance item.

The installer version-manifest web fetch returned an internal retrieval error; prior P04 metadata was not reclassified as fresh evidence. No result here authorizes funds or changes the target.
