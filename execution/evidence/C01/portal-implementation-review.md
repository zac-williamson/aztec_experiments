# C01 portal implementation and qualification

2026-09-14. Engineering lane handoff; not external audit or C01 completion.

The fresh portal accepts constructor `(address rollup,bytes32 board,uint256 version,uint256 minDeposit,uint256 maxDeposit,bytes32 configHash)`. It pins code-bearing Inbox/Outbox actors obtained from the rollup, canonical nonzero board/config Fields, positive u32 version, positive u64 deployment chain, and `1 <= min <= max <= 2^96-1`. It begins disabled; permissionless `activate(epoch,checkpointCount,leafIndex,path)` consumes the exact configured Ready envelope through the pinned Outbox before enabling deposits. There is no administrator activation/refund/sweep route.

`deposit(bytes32 secretHash)` requires activation and unchanged chain, canonical nonzero secret hash, configured amount bounds and no live receipt. Checked u64 nonces persist after refunds. The exact V1 claim message goes through the pinned Inbox. `withdraw(epoch,checkpointCount,leafIndex,path)` reads the caller's receipt, clears it and subtracts liability before Outbox/ETH calls, under the same OpenZeppelin reentrancy guard used by deposit/activation. Any failure rolls back the entire operation. Direct ETH receipt rejects; forced ETH remains surplus.

## ABI handoff

- Immutable getters: `MIN_DEPOSIT`, `MAX_DEPOSIT`, `L2_CONTRACT`, `ROLLUP`, `INBOX`, `OUTBOX`, `VERSION`, `L1_CHAIN_ID`, `CONFIG_HASH`.
- `activeDeposit(address)` and `getDeposit(address)` return `(uint64 nonce,uint128 amount)`; `lastDepositNonce(address)` returns u64. `totalDeposited()` returns uint256; `depositsEnabled()` returns bool.
- `Activated(bytes32 indexed configHash)`.
- `Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)`.
- `Withdrawn(address indexed depositor,uint64 nonce,uint128 amount)`.
- The legacy `deposits(address)` selector is absent from production. It remains solely in the historical bad-artifact test interface.
- `PortalMessages.sol` is the actual production internal Ready/receipt codec: fixed static ABI words, domain strings right-padded to bytes32, protocol SHA-to-Field. Root owns config/policy codecs; the portal receives configHash and authenticates it in Ready.

## Actual checks

From `billboard/portal`, with pinned Forge 1.4.1, solc 0.8.27, Prague and the existing separate regression output/cache profile:

```
FOUNDRY_PROFILE=regression /Users/zac/.foundry/bin/forge test --offline --no-match-contract PortalGeneratedArtifactTest -vv
```

The final bounded 120-second-supervised run exited 0 in 3.46 seconds: **26 passed, 0 failed, 0 skipped**. Raw command/outcome: `portal-focused-final.json`; output: `portal-focused-final.log`. Inputs, package/protocol source hashes and compiled test artifact bytecode hash are in `portal-source-context.json`. The test process exited normally; no chain/browser/background service was started. Whitespace validation passed.

Coverage consists of 16 V1 tests, four actual production codec vectors (Ready, claim, exit, u64/u96 receipt boundary), three source accounting tests, and three unchanged historical bad-bytecode controls. The latter still demonstrate below-configured-minimum acceptance and stale aggregate liability, and fail the current artifact equality guard. The old bytes' fixed digest remains checked before execution.

Canonical Inbox tests check returned full envelope hash and actual insertion count. Canonical Outbox tests authenticate every Ready/exit content word and mutated sender/version/recipient/chain envelopes, invalid path/index/checkpoint, one-time activation, repeated withdrawal and old-receipt rejection after redeposit. Additional controls cover min/max values, secret bounds, one live receipt, nonce overflow, pinned bridge actors, invalid constructor actors/scalars, failed Inbox rollback, failed refund rollback including canonical Outbox nullification, successful retry, callback reentrancy and forced surplus conservation.

## Failure retained and limits

The first run compiled and passed 23 tests but failed one test setup: Forge rejects `vm.chainId` values >=2^64 before calling the constructor. `portal-focused-attempt1.{json,log}` preserves this. The final tests exercise zero-chain rejection and max-u64 constructor acceptance. **The constructor's above-u64 chain rejection has not been executed.** The production bound was not removed or weakened. A test-only subclass seeds the last nonce solely to exercise overflow; production exposes no such setter.

The canonical Outbox is real pinned code, but `RootPublisher` intentionally stands in for the rollup and supplies chosen roots through `Outbox.insert`; single-leaf witnesses suffice for these focused checks. No rollup proof is produced or accepted. This proves local bridge membership/nullification behavior against those roots, not that the board emitted a message or burned an authenticated L2 right. The canonical Inbox uses a dummy fee-token address; no fee-token operation is exercised. The failing Inbox and old accounting mocks are explicitly limited rollback/accounting controls.

The generated application artifact suite was **excluded**, not passed: root owns regenerating both portal bytecode copies and running the full suite against the new source. No generated app artifact was edited here. Full claim/exit cross-chain execution, genuine proofs, final integrated consumer verification, C02–C06 and external review remain open. The compiler's selfdestruct deprecation warning applies only to the deliberate test-only force-surplus constructor.
