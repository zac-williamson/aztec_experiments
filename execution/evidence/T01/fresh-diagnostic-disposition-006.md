# Fresh compiler diagnostic disposition — unresolved

The final `fresh-compiler-007/result.json` records compiler exit 0, successful application artifact reconciliation, and owned scratch cleanup after 44.277 seconds. Earlier 004–006 records retain failed inventory/checker assumptions; they are not compiler failures. Raw private-function equality and the pinned synthetic public-dispatcher comparison establish the recorded build correspondence, not soundness.

The fresh two-contract compile emits **57 manual-constraint diagnostics at 18 locations**, compared with P04's 26 occurrences at 12 locations. All 12 original locations still occur. Six locations are newly observed, accounting for 18 occurrences; changed multiplicities at the original sites account for the remaining net increase of 13. An occurrence count is not a vulnerability count. Reduced multiplicity at AES padding does not establish resolution.

The adjacent JSON retains every fresh occurrence verbatim, the full original 26-occurrence inventory, per-site counts, caller attribution, source hashes/excerpts, and final compile/artifact comparison identities. Attribution is deliberately limited to the recorded stack: 20 occurrences explicitly name Billboard source, 27 name PrivateFee source, and 10 show only framework-generated callers. Do not guess the owning contract for those 10 from ordering alone.

## Newly observed locations

1. **private_context.nr:1184:13 — 5 occurrences (2 Billboard, 3 PrivateFee).** `call_private_function_internal` supplies an end side-effect counter and return-value hash. The source pushes a private-call request; its comment assigns subsequent validation to the kernel. This adds a concrete cross-circuit obligation: corrupt returns hash, end counter, target/selector/arguments and static-call mode; verify actual call/request composition rejects the corruption. Recursive private-fee balance subtraction and board cross-contract note delivery are relevant caller paths. Normal composed proofs are controls, not hostile-request coverage.
2. **note/lifecycle.nr:55:31 — 3 PrivateFee occurrences.** Sender-chosen randomness enters the note commitment. The source rationale explicitly trusts the sender, who already knows the preimage, not to defeat recipient privacy. Review entropy generation, chosen-randomness privacy assumptions, note uniqueness and authentic balance-note discovery. There need not be a constraint forcing one particular oracle random value; this is not sufficient to dismiss the warning.
3. **utils/remove_constraints.nr:19:13 — 3 PrivateFee occurrences.** The helper asserts its condition is compile-time constant, then intentionally runs a delivery function unconstrained on the selected branch. This is framework application behavior, **not** the compiler check being disabled. Establish which effects are unconstrained in the emitted artifact: they must not substitute for balance arithmetic, note commitments, spend nullifiers or fee payer authorization. Wrong/missing delivery can still create privacy or recoverability failures even when balance constraints hold.
4. **messages/delivery/tag.nr:69:26 — 3 PrivateFee occurrences.** The tagging index is oracle-supplied; `source.constrain_tag_secret` is called only for `onchain_constrained`. The actual private-fee contract uses `MessageDelivery::onchain_unconstrained()` for mint/change notes. Test dropped, duplicated and extreme indices, restart discovery and successful spending of the exact resulting balance notes. Do not transfer the Billboard constrained-handshake justification to this fee path.
5. **messages/delivery/tag.nr:52:37 — 3 PrivateFee occurrences.** The oracle selects a tagging strategy. The source comment's protection against unbacked tags specifically concerns constrained delivery. Unconstrained fee-note delivery needs explicit strategy/recipient discovery and recovery tests; establish that changing a discovery strategy cannot change balance ownership, private fee authorization or emitted committed state.
6. **messages/delivery/mod.nr:150:13 — 1 PrivateFee occurrence.** The default tag sender comes from the wallet oracle and is not application ownership authorization. Test an unavailable/wrong default sender, ensure it cannot alter balance-note owner or fee payer, and verify honest sender discovery after restart. Review the wallet's custody of tagging/handshake state separately from signing keys.

## Production-relevant distinction

Billboard note emission uses constrained on-chain delivery. The current private fee contract explicitly uses unconstrained on-chain delivery at its mint, mint-and-pay and change-note sites. That distinction is documented source behavior, not a newly proven exploit. Fee balances/ownership must remain constrained independently; inability to discover a private balance note is nevertheless an application recovery/privacy concern. Existing real private-fee payments show a functioning honest path, not robustness to malicious delivery hints.

All original P04 obligations remain in `compiler-diagnostic-coverage-001.md`. The new bounded C02 note-membership probes address one application membership boundary only. They do not disposition private-call counters, fee-note delivery randomness/tagging, kernel request discharge, emitted-protocol source correspondence or network verification keys.

**Disposition: all 57 fresh occurrences remain open for explicit independent Aztec/Noir review and relevant hostile-witness/privacy evidence.** Compilation and matching raw application function bytes do not prove these warnings benign. No warning was suppressed, relabeled as resolved or removed from the register.

## Complete per-location count

| Site | P04 | Current | Billboard stack | PrivateFee stack | Framework-only |
|---|---:|---:|---:|---:|---:|
| `context/private_context.nr:1184:13` | 0 | 5 | 2 | 3 | 0 |
| `context/private_context.nr:561:38` | 2 | 4 | 0 | 0 | 4 |
| `context/private_context.nr:829:36` | 1 | 3 | 1 | 2 | 0 |
| `history/note.nr:46:28` | 1 | 1 | 1 | 0 | 0 |
| `history/storage.nr:26:28` | 3 | 4 | 4 | 0 | 0 |
| `keys/getters/mod.nr:27:51` | 2 | 4 | 2 | 2 | 0 |
| `messages/delivery/mod.nr:150:13` | 0 | 1 | 0 | 1 | 0 |
| `messages/delivery/tag.nr:52:37` | 0 | 3 | 0 | 3 | 0 |
| `messages/delivery/tag.nr:69:26` | 0 | 3 | 0 | 3 | 0 |
| `messages/delivery/tag_derivation.nr:88:18` | 2 | 5 | 2 | 3 | 0 |
| `messages/encryption/aes128.nr:260:25` | 2 | 2 | 2 | 0 | 0 |
| `messages/encryption/aes128.nr:356:38` | 2 | 1 | 1 | 0 | 0 |
| `messaging.nr:35:9` | 1 | 1 | 1 | 0 | 0 |
| `note/lifecycle.nr:55:31` | 0 | 3 | 0 | 3 | 0 |
| `note/note_getter.nr:173:39` | 2 | 4 | 2 | 2 | 0 |
| `nullifier/utils.nr:18:52` | 4 | 6 | 1 | 2 | 3 |
| `oracle/get_contract_instance.nr:18:29` | 4 | 4 | 1 | 0 | 3 |
| `utils/remove_constraints.nr:19:13` | 0 | 3 | 0 | 3 | 0 |
