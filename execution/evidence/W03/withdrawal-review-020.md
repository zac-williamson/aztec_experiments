# Withdrawal absence recovery — AI review

Scope: bounded source review of `apps/src/billboard/user/engine.js` and
`scripts/test-engine-private-fee.mjs`. No application edits or heavy tests were
performed by this reviewer. This is AI review, not an independent audit.

## Findings and disposition

1. The initial missing-note branch matched the connected Ethereum account's
   active receipt but did not authenticate its relationship to the selected
   private deposit chain or Aztec owner. An unrelated canonical exit could
   therefore falsely complete the selected withdrawal request.
   **Addressed:** the revised branch restores authenticated claim custody,
   checks receipt amount and nonce, recomputes the chain from board, owner,
   deposit content and secret, and requires equality with the selected chain.
   The derivation matches `billboard/billboard_contract/src/lib.nr`'s
   `deposit_chain_id`.
2. Initial portal and block-number reads were outside the history timeout.
   **Addressed:** the revised branch bounds the entire lookup to 20 seconds
   and maps failure to an unknown recovery outcome.

Re-review found no remaining blocker in this branch. The existing history
lookup checks the exact exit leaf, canonical block and successful receipt.
Root reported 44 passing tests, including mismatched chain, missing custody
and stalled lookup; this reviewer did not independently rerun them.

## Follow-on: attributable same-note dummy recovery

A contract change is not inherently necessary, but persisting source-note
fields alone cannot prevent the prover selecting a successor note after a
state change. The pinned SDK exposes the ingredients for stronger binding:

- `node_modules/@aztec/stdlib/src/tx/private_execution_result.ts`:
  `PrivateCallExecutionResult.publicInputs` and nested execution results.
- `node_modules/@aztec/stdlib/src/kernel/private_circuit_public_inputs.ts`:
  call context and emitted `nullifiers`.
- `node_modules/@aztec/stdlib/src/kernel/nullifier.ts`:
  nullifier value, note-hash association and side-effect counter.
- `node_modules/@aztec/stdlib/src/hash/hash.ts`: `siloNullifier()`.
- `node_modules/@aztec/stdlib/src/kernel/private_kernel_tail_circuit_public_inputs.ts`:
  `getNonEmptyNullifiers()` in final transaction proof inputs.
- `billboard/billboard_contract/src/main.nr`: `post` selects and pops the
  deposit note by deposit-chain identity.

Proposed narrow recovery: attribute the deposit-note nullifier to the exact
billboard call, persist that evidence with the original operation before
submission, and require its correctly siloed value in both original and
replacement proven transactions. This binds replacement to the same consumed
note even if another note becomes selectable during proving.

Merely requiring any shared global nullifier is unsafe: it could belong to fee
payment. Requiring all global nullifiers would unnecessarily prohibit replacing
a consumed fee note. Fail closed on absent or ambiguous application-note
attribution. Verify SDK siloing, note attribution and final proof membership
with a genuine transaction and a state-change regression before enabling this
route; the source review alone does not qualify it. If attribution remains
ambiguous, enforce an expected deposit-head parameter in the contract instead.
