# Initial escrow monitor implementation

Implemented one-shot public Ethereum escrow monitoring in `deploy/operations-monitor.mjs`, operator usage/limits in `docs/operations.md`, and six injected unit/adapter tests in `scripts/test-operations-monitor.mjs`.

Validation: pinned Node v24.21.0, `node --test scripts/test-operations-monitor.mjs`: six tests pass, about 0.2 seconds. No proof/build/browser work, live network reads, transactions, credential contact or service installation performed.

Coverage: aggregate liability versus balance, surplus distinct from deficit (without assuming surplus provenance), inactive portal, stale/future block, fixed privacy-safe failure classifications, hung-read deadline, exact installed portal runtime and configured identities, all state reads pinned to one canonical block hash.

Limitations: injected adapter tests are not live deployment evidence. Fee/transaction/feed/deadline/signer telemetry, externally delivered alerts, executable recovery/rotation rehearsals and exposed-credential inventory remain outstanding. O01 is not complete.
