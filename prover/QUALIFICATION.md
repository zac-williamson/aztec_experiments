# Remote prover qualification — 22 September 2026

The posting and funding pages use the production service composition root in
browser integration tests, through a same-origin HTTPS proxy and the HTTP queue.
Tests require completed remote jobs, so a silent local fallback cannot pass.

| Check | Result |
| --- | --- |
| Both built-page toggles default on when configured and switch off/on | Passed |
| Fresh-user fee funding → board deposit claim → post, application proofs disabled | Passed; 3 completed remote jobs, 0 failed |
| Same fresh-user flow, real native application proofs | Passed; browser verification and node acceptance; 3 completed remote jobs, 0 failed |
| Claim → post → screen → withdraw → Ethereum refund, real remote proofs | Passed; 4 completed remote jobs, 0 failed; exact outbox consumption checked |
| Packaged C8a.4xlarge service, systemd → Caddy → HTTP queue → native worker | Passed; real proof returned in 3.524 seconds; 112,288 compressed proof bytes |

The browser tests use isolated local devnets. Real-proof qualification enables
application proof verification; rollup proving remains disabled in the controlled
settlement fixture. The C8a test proves a genuine captured disposable board
transaction and verifies the proof before returning it. These tests do not submit transactions on public testnet; live deployment
status is recorded separately.

Reproduce the browser checks with the pinned Node version:

```sh
BOARD_TEST_PROOFS=disabled BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-cold-fees
BOARD_TEST_PROOFS=real BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-cold-fees
BOARD_TEST_PROOFS=real BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs browser-chrome-journey
node scripts/test-remote-prover-browser.mjs
```

Local evidence IDs:

- Disabled cold flow: `application-6691fd24-7969-473b-b50a-1e41ac4cee4d`
- Real full lifecycle: `application-842a6719-61fc-47ec-a991-efa72eabaece`
- Real cold flow: `application-91214949-dae8-44a4-b67e-5248fc8b78ad`

All C8a qualification instances have bounded shutdowns and are explicitly
terminated after testing. No signing keys or real-user wallet state are shipped
in the service package. Disposable witness captures are excluded from source
control and removed after qualification.

Live deployment details and the existing Spot shutdown deadline are in
[live-deployment.json](../deploy/prover/live-deployment.json).


## Wallet integration verification — 23 September 2026

Wallet discovery uses EIP-6963. The selected EIP-1193 provider is retained by the
account session for signing and account/network checks. A conflicting global
provider cannot select a different signer. Wallet setup cannot be skipped;
fee funding waits for successful account setup and stops on invalidation.

- 141 focused wallet, session, configuration, fee and harness checks passed.
- Actual MetaMask connection, rejected approval, explicit retry, fee deposit,
  collateral deposit/refund and canonical receipt recovery passed:
  `wallet-selection-extension-20260923k.json`.
- MetaMask with a conflicting immutable global provider completed deposit →
  claim → post → screen → withdraw → Ethereum refund, with four remote jobs:
  `application-34493c6f-e27d-43b7-9450-7b26406eb7c8.json`.
- Installed Google Chrome completed that same lifecycle:
  `application-9606a15e-398d-4d87-9003-4a907d9e487a.json`.

Fresh-account MetaMask fee approval → bridge deposit → private fee claim →
board deposit claim → first post passed with three remote jobs:
`application-8cd75142-18d9-4a4a-b283-987c1d4dd077.json`.

These wallet integration runs use proofs disabled on isolated devnets, as
requested. They verify transaction behavior and remote routing, not additional
cryptographic assurance. The earlier real native proof qualification above
covers the unchanged prover, circuit artifacts and worker. Independent read-only
review checked the selected-provider boundary and fixture scheduling; publication
barriers wait for actual local checkpoint convergence without substituting RPC
results or retrying transactions.

Live configuration preflight identified a stale FPC address and zero teardown
gas. The current artifact's canonical published address is
`0x28c2a3107cb397750c63c542dd0be34716d8b0b1d3e76b3b7dff85241ad09720`.
Its class, board class, portal bindings and network identity were checked against
public testnet. The corrected settings use SDK fallback gas allocation for the
network's advertised limits, including teardown, and retain the existing fee
price caps. This is a maximum reserve; unused gas returns to the private balance.

Chrome virtual-passkey creation, reload, discovery and recovery also passed:
`wallet-passkey-chrome-20260923.json` and `wallet-recovery-chrome-20260923.json`.
Published-page hashes and the live Chrome wallet chooser/toggle checks are saved
in `deploy/prover/live-deployment.json`. No user wallet or public-testnet transaction
was used for the live UI check.
