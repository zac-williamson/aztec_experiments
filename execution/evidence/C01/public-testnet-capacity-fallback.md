# Public testnet capacity fallback — read-only preparation

Observed 2026-09-14. No account creation, faucet requests, transactions, RPC identity probes, installs, or network configuration changes. This is an advertised candidate, not a verified usable endpoint or a completed C01 proof gate.

## Candidate and compatibility

The official [testnet getting-started guide](https://docs.aztec.network/developers/getting_started_on_testnet) currently identifies **5.2.0**, installs that exact toolchain, and uses `https://v5.testnet.rpc.aztec-labs.com`. It says proving is required and provides SponsoredFPC `0x130925fbd734a252e3d8ddff87f6c346052dd5c13314eb96026b32baa1923296` for fee sponsorship. Thus the guide describes a route using this project's pinned SDK without operating a local epoch prover. Client private proving remains necessary.

The [network reference](https://docs.aztec.network/networks) still labels testnet **5.1.0**. Its advertised scope is:

| Field | Published value |
| --- | --- |
| L1 chain | Sepolia, `11155111` |
| Aztec rollup version | `1821665230` |
| Registry | `0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba` |
| Rollup | `0xD73A91bdcF6891C7642F3e460036e1ef2CC23178` |
| Inbox | `0x3047dBF2b7dd9f58AC41113525480F94745a4f7C` |
| Outbox | `0x905f80009bBef9d9426675B45009922971eD42fF` |
| Honk verifier | `0x31F98dfC544E52e4170c0Dc64098049651db48C1` |

That page describes proven transactions and free sponsored transactions on a decentralized staging network. The differing documentation version labels must remain explicit. The official [5.2 release notes](https://github.com/AztecProtocol/aztec-packages/releases), dated August 17, say protocol constants are unchanged and 5.1/5.2 nodes interoperate against the existing rollup. This supports compatibility as a hypothesis; it does not identify the software, canonical contracts, verifier runtime, or current proving progress behind this particular RPC.

## Free funding and service limits

Official docs link [Nethermind's Fee Juice faucet](https://aztec-faucet.nethermind.io/) for test gas. The browser fetcher returned an internal retrieval error for that provider page, so this review did not establish its current eligibility, quota, availability, or terms. No request was attempted. The documented SponsoredFPC can remove an initial L2 Fee Juice requirement, but its live funding and service limits were not checked.

Our end-to-end portal test also needs **Sepolia ETH for L1 contract deployment and activation**. L2 fee sponsorship does not cover that. The official material retrieved here did not establish a currently usable free Sepolia ETH allocation for this run. Do not buy funds, assume a faucet allowance, or treat an advertised free transaction path as an unlimited proving service.

## Deployment notice and next boundary

The [August 7 V5 incident notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability) remains published and asks teams planning V5 deployment to pause pending further guidance. A bounded official-source search found no later clearance. The notice does not explicitly exempt public test deployments; the concurrently available testnet guide is not incident-response clearance. X03 remains unchanged. Ordinary disposable testing and a production launch are different decisions; this review does not authorize either a provider request or a deployment.

Before selecting this fallback, do read-only identity and liveness qualification: reconcile the node's reported chain/rollup/protocol information with Sepolia's canonical registry and deployed verifier, then observe actual proven/finalized checkpoint advancement across time. Check provider terms and free L1/L2 funding availability. If these pass and the test scope is authorized, use fresh disposable identities and normal supported transactions, and require the covering L1 proof event, finalized checkpoint, genuine Outbox witness, and portal activation. No public prover-admin access is needed or assumed. Testnet settlement may remove local server-proof resource demand; its liveness, quotas, timing and finality are outside our control and still need direct evidence.

Read historical context: `P02/current-network-inputs.md`, `P04/compatibility-preparation.md`, and `C01/proof-environment-preparation.md`. This note refreshes published facts without rewriting those earlier observations or claiming that public metadata satisfies current network acceptance.

Root subsequently made one read-only `node_getNodeInfo` request to the documented
endpoint. The retained response (`testnet-node-info-2026-09-14.json`) reports
nodeVersion5.2.0-nightly.20260815, chain11155111, rollupVersion1821665230 and
realProofs:true. Its Rollup address is0xd73a91bdcf6891c7642f3e460036e1ef2cc23178.
This establishes an endpoint response and self-reported identity only. It does
not establish canonical L1 state, current proving/finality, exact circuit hashes,
faucet eligibility, or permission/clearance to deploy. No transaction was sent.
