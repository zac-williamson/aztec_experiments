# Ready activation correction

The application deployment engine called `getL2Tips`, an internal block-source method absent from the pinned public Aztec node RPC schema. The actual public method is `getChainTips` (`@aztec/stdlib/src/interfaces/aztec-node.ts`, interface and runtime schema). Its `finalized.block.number` shape is unchanged.

The maintained `activateReady` helper now uses that method. `runDeploy` directly calls this same helper, exposed through `BillboardDeployActivation` for behavioral tests. It refreshes the transaction receipt each polling cycle, requires successful execution, rejects dropped/unknown/incomplete mined receipts, and waits on pending/proposed receipts. It checks finalized height and the canonical block hash at the current receipt height. After receiving a membership witness, it repeats those checks and requires unchanged receipt location before sending activation. The actual witness API and four portal arguments remain unchanged. A successful L1 receipt and enabled portal are both required afterward. The broader custom wallet's pre-existing nonpending-receipt predicate is unchanged and remains W03 work.

Source fingerprints after tests:

- `apps/src/billboard/deploy/engine.js`: SHA256 `f838f18fac069021cc5a03fc79ab8cda89e3b01be93f47cc0e3c9ea9b8697a45`.
- `scripts/test-c01-deploy-activation.mjs`: SHA256 `41ca0591d12661d219f272d0a4f1455af8c0ee398f02884103fe0a895a123c45`.

Executed from repository root with the existing pinned executable:

```
./.build/A02-node/node-v24.21.0-darwin-arm64/bin/node --test scripts/test-c01-deploy-activation.mjs
```

Result: exit 0; 15 tests passed, 0 failed, 0 skipped/cancelled; reported duration 692.272209 ms. `git diff --check` for owned source/test paths also exited 0. The complete production engine is evaluated; tests call the exact helper used by `runDeploy`, without copied algorithms or source-slicing assertions. The node fixture deliberately has no `getL2Tips` alias and uses installed SDK status/result enums. Controls cover normal finality advancement and exact activation arguments; unfinalized/pending/proposed receipts; absent witnesses; reverted/missing-success/dropped/unknown receipts; missing inclusion metadata; stale canonical block hashes; re-inclusion during witness resolution; drop during witness resolution; malformed finalized tip; failed L1 activation; and a portal remaining disabled.

These are controlled RPC/portal behavioral tests, with an injected test clock. They do not prove SDK server behavior, cryptography, real-chain finality, or successful application deployment. No proof, network, wallet, or actual transaction was executed. No generated application output or active real-network harness source was changed. Parent must rebuild affected application outputs and bind subsequent integration evidence to these source changes. On-chain Outbox consumption remains the final authentication check; the helper cannot make independent RPC reads atomic against a concurrent reorg.

## Follow-up public block response qualification

Review raised whether `block.hash` must instead be called as an async method. The installed internal `L2Block` indeed has `hash()`, but this application uses public `AztecNode.getBlock`, whose result is `BlockResponse`. `NodeBlockProvider.getBlock` maps internal blocks through `blockResponseFromL2Block` (which calls `await block.hash()` once and stores its result), or maps metadata through `blockResponseFromBlockData`. Both projections return a `hash: BlockHash` property. The public RPC `BlockResponseSchema` decodes that property. Production property access therefore remains correct and unchanged. `checkpointNumber` is also a required public response field, so the settlement helper's use of that field is valid.

The regression fixture now uses the installed RPC `jsonStringify` followed by the installed `BlockResponseSchema`, producing actual `BlockHash` objects. A new control checks the internal prototype method/public property distinction and rejects a method-valued wire hash. Initial fixture qualification exposed two test-data mistakes: the original repeated `aa`/`bb` dummy hashes exceeded the Field modulus (8/16 failed), then parsing live SDK objects instead of their wire representation failed schema conversion (8/16 failed). Those attempts were failures of the newly strengthened fixture, not successful product checks. The fixture now uses small valid Field hashes and the actual SDK JSON codec.

Final rerun of the same Node 24.21 command: exit 0, **16/16 passed**, no failed/skipped/cancelled tests, 528.720833 ms. Diff check exited 0. Final test SHA256 is `171e410311ca65f57764dc447c74e4552fd4b8374372be4f5f249a21911e61f4`; engine SHA256 remains `f838f18fac069021cc5a03fc79ab8cda89e3b01be93f47cc0e3c9ea9b8697a45`. No live server call or cryptographic hash computation was introduced by the fixture.
