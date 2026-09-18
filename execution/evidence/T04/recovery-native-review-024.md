# Recovery native integration review

Read-only source review of applied recovery integration. No source changes or heavy tests performed. No blocking defect found in the reviewed control, hook lifecycle, or canonical accounting paths.

## Controls and mode routing

- Parent accepts exactly one fixed mode argument. `--browser-post-recovery` implies browser-post preparation, selects T04 evidence, and supplies explicit `browserRecovery:true` / `browserJourney:false` private control.
- `validateBrowserControl` requires exactly five keys and boolean, mutually exclusive mode flags. `validateBrowserWorkerControl` checks the actual merged worker payload using the shared handoff validator. Recovery and ordinary post retain six handoff fields; journey alone adds its two fields. Missing flags, surplus fields, and both modes enabled fail validation.
- The wrapper permits the exact recovery argument and selects T04 output without changing the 540-second / 2-GiB limits. Parent fingerprints include the recovery driver and response-loss helper. Proof-stage observation is disabled for recovery.

## Genuine acceptance and cleanup

`completeU01BrowserPost` installs submission capture/normal prevalidation first, then response-loss interception, before RPC/browser handoff. The hook calls and awaits the original method. Only successful original acceptance produces the exclusive, atomic public acceptance file. Original rejection never advertises acceptance. The hook counts and rejects a second send before calling the original method.

Request-entry and accepted timestamps are recorded in the public file. The companion browser driver validates their order and requires completed full-browser closure within 15 seconds of request entry, leaving a margin before the production 20-second reconciliation timeout. Native acceptance alone does not establish canonical inclusion: that is independently checked later.

The native hook remains installed through the restored browser's recovery and final closure. Native code requires exactly one send, the same recovered hash, one captured transaction, a full same-profile restart, and no journal import. Only then is the held response released and the prior capture wrapper restored. Cleanup releases the response before closing RPC, restores capture next, and attempts every owned cleanup independently. An expired hook is rejected by the native `!loss.closed` assertion.

## Independent one-post / one-debit evidence

After the browser has closed, the native verifier opens a separate read-only wallet. `verifyU01BrowserPost` checks normal pre-submission validation, real proofs, canonical receipt/block/effect identity, one consumed original deposit nullifier, exact replacement deposit and post notes, post count increment by one, message content, inclusion time and cooldown. It checks the private balance decreased by exactly one configured maximum fee, the shared public fee payer decreased by the actual receipt fee, and the author's public fee balance remains zero.

Combined with the interception counter, this distinguishes one accepted post recovered through its receipt from a duplicate post/debit. It does not count locally discarded proofs and must not be described as doing so.

## Limits

This is source review, not a genuine restart qualification result. The live bounded run must still demonstrate persistence of the interrupted application's journal and successful original-receipt recovery. The 15-second constraint measures from entry to the local node wrapper, not from the browser's earlier call-site; the explicit five-second margin is intended to cover that local transport overhead. No claim of healthy production deployment or broader browser compatibility follows from this drill.
