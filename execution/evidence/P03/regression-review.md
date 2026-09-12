# P03 independent AI integration review: shell and receipt regressions

## Disposition

No blocking correctness or evidence-presentation finding in the reviewed shell and receipt lanes. The focused independent rerun passed **14 tests, 0 failures, 0 skips/cancellations**. This is a separate AI integration-review lane, not an external security or cryptographic audit. The reviewer authored the portal test lane and does not claim independent review of that work here.

Read-only source review covered `scripts/test-shell-baseline.mjs`, its historical fixture and provenance manifest, `scripts/test-receipt-baseline.mjs`, current `shared/aztec-lib.js` receipt handling, current `censor-daemon/signer.mjs`, SDK 5.0.0 receipt definitions, and the corresponding P03 evidence. No application code was edited during this review.

## Shell regression

The baseline fixture preserves the historical `cliBaseArgs` and `runCli` function bodies inside a factory that requires an injected capture function. It has no subprocess import or default executor. The test supplies a capture and never sends the historical command string to a shell. It verifies that backtick and dollar-substitution markers survive quote escaping, then exercises the actual repaired `createSigner().flag()` interface and verifies one inert argument element, `shell: false`, fixed operation, executable, wallet and portal.

Independent provenance verification read the original source with `git show 1849967d15d96ab96234091f2fa47d8762a6c06a:censor-daemon/daemon.mjs`. The original whole-source hash, extracted function-segment hash, verbatim presence of that segment inside the fixture and final fixture hash all matched the adjacent manifest. Running the test uses the maintained fixture and actual signer export; it does not slice the current daemon source.

This lane proves unsafe historical command construction and the repaired argument-construction boundary. It does not execute a shell or measure a real model's prompt-injection reliability. Real OS argument preservation is separately covered by the existing M01 harmless argv-echo regression, not inferred from this capture-only test.

## Receipt regression

The harness evaluates the complete unchanged `shared/aztec-lib.js` in a VM and invokes its real `createAztecWallet(...).sendTx(...)`. It replaces the SDK base wallet's simulation/request plumbing, prover and node calls with controlled fixtures; it does not reimplement or source-slice the receipt branch being tested. Current SDK 5.0.0 `PendingTxReceipt`, `MinedTxReceipt` and `DroppedTxReceipt` objects are used. This matters because a mined receipt's status (`proposed` or `finalized`) is distinct from its `executionResult` (`success` or `reverted`).

The normal control demonstrates pending-to-successful-mined confirmation. The failure reproductions show actual SDK reverted and dropped receipts resolving through the unchanged production `!r.isPending()` branch and producing a success-labelled confirmation. The already-submitted/nullifier-error branch also confirms a reverted receipt. These passing test results are explicitly classified as successful reproduction of unsafe baseline behavior, not as safe transaction handling.

Additional controls cover perpetual pending/missing timeouts, transient receipt lookup retry without additional proof/submission, proving failure, and a rejecting pre-prove hook. The unknown-status control separately checks the SDK schema and injects a corresponding RPC error; it does not claim that a real RPC client/deserializer was exercised. The historical `app_logic_reverted` shape is separately labelled as a historical representation rather than a valid current SDK response.

The report's executed-source hash matches the current shared file. Other wallet implementations in user/censor/deploy/Fee Juice engines are explicitly marked `runtimeExercised: false`; their same-looking receipt predicate is source-inspection evidence only. The report states that time is simulated and no real proof, existing wallet, remote RPC or transaction is used.

## Required downstream disposition

- B09 remains open for W03. When receipt handling is repaired, replace the intentionally unsafe baseline assertions with successful-execution requirements while retaining bad fixtures as rejection controls. Do not merely rename the unsafe observations as passing production behavior.
- W03 must exercise every consumer, transaction submission/receipt failure path and restart/reconciliation behavior; this shared-wallet-only reproduction does not cover those consumers end to end.
- M01 remains the source of actual OS argument-handling/container-boundary checks; this P03 shell comparison adds historical provenance and discriminating construction evidence.
- Final release and real-chain/proof gates remain separate. Neither the mocked receipt result nor this AI review substitutes for them.

## Independent verification

Command from repository root:

```bash
/Users/zac/.nvm/versions/node/v24.15.0/bin/node --test scripts/test-shell-baseline.mjs scripts/test-receipt-baseline.mjs
```

Observed exit 0, 14 passed, 0 failed/skipped/cancelled; duration 344.951833 ms. This rerun did not set `RECEIPT_BASELINE_REPORT` and did not overwrite the implementing lane's report. Existing raw lane logs are `shell-baseline.log` and `receipt-baseline.log`.

A separate standard-library provenance check returned:

```json
{"historicalSourceHashMatches":true,"historicalSegmentHashMatches":true,"verbatimSegmentInFixture":true,"fixtureHashMatches":true}
```

`git diff --check` exited 0 at review time. No full build, Noir/TXE suite, network proof or container isolation suite was rerun in this bounded review lane.

Reviewed SHA-256 fingerprints:

```text
b954492e8cb56531ca5569481ba00b020d74c15228bd819d9d1cfc5e1ab6f960  scripts/test-shell-baseline.mjs
503c892d8102c525b2d2b1463729b35ba66151174da532d5bd209dad803d1865  scripts/fixtures/legacy-daemon-command.mjs
a36ca2c1ae95a9150e6427b05b7e8dfd24a2e49632ba7b1bb1b8f3511defe3f0  scripts/fixtures/legacy-daemon-command.json
f5520d82660fb17d7ff19574d68252ae6d47b780d317eebb1ca3371d6680f3c1  scripts/test-receipt-baseline.mjs
b867434132547ab82ffb401b9f7af9b2e0167d73909b7634e2a0901ca4355ea2  shared/aztec-lib.js
251e856ce7f8152ae453af6fb3edf1d8bf79ee8b2c35950c03b226da83e4657a  censor-daemon/signer.mjs
f78e382870af38a2edf9a30ce5ec80a3894bd2bce617d573bebc288f67531323  execution/evidence/P03/receipt-baseline.json
fcd99d308f5a705d6243dadfe5646953f5ff7781976eef2e8b0892fec88fe155  execution/evidence/P03/shell-baseline.md
```
