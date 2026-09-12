# B09 receipt baseline reproduction

The actual wallet `sendTx` method in `shared/aztec-lib.js` resolves and emits its
success confirmation for reverted and dropped transactions. The decisive check
is `r && !r.isPending()`; it establishes that polling can stop, but does not
establish successful execution. This baseline remains unsafe and is assigned to
W03 for repair.

`scripts/test-receipt-baseline.mjs` evaluates the complete, unchanged shared
production script in a VM, calls its public `createAztecWallet` factory, and
invokes the returned wallet's real `sendTx` method. No function is extracted by
source slicing and no production test hook or refactor was required. Twelve
focused tests passed on Node 24.15.0; passing here means the recorded baseline
and controls were reproduced, not that the application is safe.

The tests use actual installed Aztec stdlib 5.0.0 receipt classes. A successful
control polls pending then returns a successful finalized receipt. A pending
receipt followed by a mined receipt with `executionResult: 'reverted'` also
resolves and logs confirmation. A real `DroppedTxReceipt` produces the same
unsafe result. The already-submitted/nullifier-error path also confirms a
reverted receipt without a second proof or submission attempt.

Aztec 5.0.0 represents a mined revert through `executionResult`, alongside a
status such as `proposed` or `finalized`. The historical
`status: 'app_logic_reverted'` fixture is exercised separately and explicitly
labelled; it is not a valid current SDK receipt. Unknown statuses fail the
actual SDK receipt schema. Other controls cover a malformed receipt, pending
and missing receipt timeouts, transient receipt RPC failure followed by
success, a rejected pre-proof hook, and failed proving. Those failures do not
emit confirmation.

Source inspection finds the same unsafe polling predicate in the user, censor,
deploy, and fee-juice engine wallet copies. Their paths and source hashes are
recorded in `receipt-baseline.json`. These duplicate engine entry points were
not executed by this harness, so this evidence establishes their shared source
defect rather than full runtime behavior in every consumer.

Simulation, proving, submission, and receipt RPC are controlled fixtures; time
is simulated. No real wallet, proof generation, remote RPC, transaction, or
complete engine action was used. This test does not establish finality policy,
live node behavior, cryptographic correctness, or production readiness. W03
must replace the assertions that intentionally accept unsafe behavior with
successful-execution requirements, choose the intended confirmation level,
and exercise every repaired consumer.

Reproduce with:

```sh
RECEIPT_BASELINE_REPORT=execution/evidence/P03/receipt-baseline.json node --test scripts/test-receipt-baseline.mjs
```

The pinned toolchain is required. The checked-in log is
`execution/evidence/P03/receipt-baseline.log`; the JSON binds observations to the
executed production source hash and installed receipt type version.
