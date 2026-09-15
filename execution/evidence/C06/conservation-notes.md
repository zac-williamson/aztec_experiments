# C06 conservation test lane

`PortalConservation.t.sol` uses the actual BillboardPortal and pinned canonical Inbox/Outbox, reusing `RootPublisher` from the established V1 fixture. Root publication is test-authorized: these tests do not execute or prove an L2 burn or network epoch.

A separate three-account model tracks credited amounts, lifetime nonces and forced surplus. After every operation it checks every active receipt, the sum against `totalDeposited`, solvency, and exact separation of forced surplus. Refunds check the recipient's balance delta and canonical Outbox consumption. Failed proofs must remain unconsumed. Failed deposits, absent-receipt refunds and unsolicited ETH must leave the model intact. A deterministic original-stale-aggregate regression withdraws, redeposits with nonce two, rejects the former receipt in a fresh root and fully drains liabilities while preserving forced surplus.

Generated cases use 24 fixed operations across three accounts, with 32 fuzz cases requested by inline Foundry configuration. Recommended focused command:

```sh
FOUNDRY_PROFILE=regression forge test --match-contract PortalConservationTest --fuzz-runs 32
```

No tests or builds were run in this delegated source lane. Root serializes execution and records actual results. Canonical proof validation plus controlled root publication is not evidence of rollup-proof correctness or recovery authorization from L2; the separate application bridge checks cover that boundary.
