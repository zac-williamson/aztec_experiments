# T02 compiler/source reconciliation — warnings remain open

Read-only comparison on 2026-09-17. No compilation, proof run, application change, or external review was performed. Machine-readable SHA-256 comparisons are in `compiler-reconciliation-008.json` beside this note.

## Source and artifact correspondence

All **160 selected contract-tree and application-artifact entries** from `execution/evidence/T01/source-012.json` match the current files byte for byte. This selection includes production Noir/Solidity, contract tests, portal output artifacts and all recorded application artifact copies. No contract or recorded contract artifact change since that inventory was found. This is a scoped comparison, not a claim that the whole application repository is unchanged.

All eight compiler inputs recorded in `T01/fresh-compiler-007/result.json` match current bytes. All 34 inputs in the current `.build/contracts-manifest.json` match current files. Current Billboard and PrivateFPC artifact hashes equal both compiler007's canonical artifact hashes and the current manifest. The portal bytecode-object hash equals the manifest, and the full portal artifact matches the T01 inventory.

| Item | SHA-256 |
|---|---|
| Current contracts manifest | `934697a1b4982eaf78fb7c0ef1a6ca978f70bc8a8c0f0616c898469b06cf8a57` |
| Billboard canonical artifact | `50009f964ca8496c645e8bbb4d9a3b18621c9b26a7a2c7376e4f33c3b7e53696` |
| PrivateFPC canonical artifact | `fbb13295be38ed5672447b8b132357c36eb08c8f85dd5d4e2f9c01a0adec1c8f` |
| Portal bytecode-object string | `3139214b21208db80da6f50a372fc9e277fae6907678b00e193da8c13353f2ea` |

Compiler007 is the prior isolated, constraint-checks-enabled two-contract compile: exit zero, 44.277 seconds, scratch cleanup recorded. Its raw private ACIR/canonical artifact correspondence still applies to these unchanged application artifacts. This note does not repeat compilation or establish correspondence of all protocol circuits and deployed verification keys.

## Preserve both complete diagnostic inventories

`P04/compiler-diagnostic-review.md` retains **26 original occurrences at 12 locations**. `T01/fresh-diagnostic-disposition-006.{md,json}` and compiler007 retain **57 fresh occurrences at 18 locations**. All 12 original locations recur; six newly observed locations contribute 18 occurrences, with multiplicity changes at original sites contributing the remaining increase of 13. Counts are observations, not counts of demonstrated vulnerabilities. No warning has been removed, suppressed, or resolved by this reconciliation.

The existing disposition remains: all 57 fresh occurrences require explicit independent Aztec/Noir review and relevant hostile-witness/privacy evidence. The original 26 remain preserved as the historical comparison, not an alternative smaller current inventory. Caller attribution remains 20 Billboard, 27 PrivateFee and ten framework-only occurrences; the latter must not be assigned to a contract by guesswork.

## What T02 adds

The completed flagged journey (`application-294e5d3a-f794-4316-94ef-86195d42b1f1.json`, 428824 ms) supplies a genuine private-fee author claim/post, a distinct authorized moderator flag, authenticated screening, exact replacement-note checks, early-withdrawal rejection, eligible exit and actual L1 refund. It adds actual application composition and accounting evidence; it does not establish all private-context/kernel constraints.

The completed redeposit journey (`application-b6698c24-7c15-4035-81cd-b3af28f32dc8.json`, 442386 ms) supplies two genuine claim/exit/refund cycles, incremented receipt nonce, distinct private deposit chains, precise old-claim rejection after redeposit, preservation of the fresh note/receipt, and old-exit replay rejection. Corrupted still-unconsumed Outbox membership rejects with `MerkleLib__InvalidRoot`; consumed old exit replay rejects with `Outbox__AlreadyNullified`. The latter check precedes membership in the pinned Outbox and must not be promoted to independent receipt-content/nonce-binding proof.

The integrated wrong-origin/absent-chain additions to the unflagged profile were source-reviewed but had no completed report in this directory at reconciliation time. Do not count them as passed evidence here. Their intended boundary is real Inbox origin-bound witness lookup and missing-note selection, followed by a legitimate claim control; neither is an arbitrary hostile oracle substitution proof.

All these profiles use genuine application proofs with controlled local bridge settlement. They do not claim network epoch proof qualification.

## Obligations not closed by these cases

- Private-call return hashes, side-effect counters, selectors/targets/arguments and static-call mode need hostile cross-circuit request tests and qualified review. Normal composed private-fee proofs are positive controls.
- Pending/settled note and nullifier request routing, wrong scopes, initialization ordering, omitted/duplicate/invented notes, executable class authorization and kernel discharge remain separate obligations. Exact honest notes and spent-message checks cover only specific exercised paths.
- Private fee mint/change delivery remains explicitly `onchain_unconstrained`. Sender-selected randomness, default tag sender, strategy/index manipulation, dropped/duplicate delivery and restart discovery need privacy/recovery evidence; successful credit spending does not establish resilience to malicious delivery hints.
- AES IV/padding entropy and ciphertext/metadata privacy are not proven by decryptability, application proof acceptance or artifact equality. Billboard constrained delivery and private-fee unconstrained delivery must retain separate analyses.
- Final-source diagnostic reconciliation, protocol artifact/verification-key correspondence and independent Aztec/Noir security review remain required by the existing P04/T01 disposition. No external review or compiler false-positive determination is asserted here.
