# Historical formal-model disposition

Status: retired; no current proof acceptance. File references below name retained
source declarations rather than unstable line numbers. Header warnings apply to
all old comments claiming completion or verification. This disposition follows
source inspection, not a successful execution of the historical formal toolchain.

## Vacuity and inconsistent assumptions

- `bridge_model/Bridge.lean`: `P1_deposit_soundness`, `P16_withdraw_soundness`,
  `P5_no_over_withdraw` and `bridge_conservation` have conclusion `True` and proof
  `by trivial`. They constrain no transition or balance. The two
  `l1_l2_*_hash_agreement` axioms also conclude `True`; they express no transcript
  equality and cannot establish agreement with the actual bridge messages.
- `billboard_aztec_lean/BillboardAztec.lean`: `poster_liveness`,
  `sequential_screening_enforced`, `post_notes_append_only`,
  `dummy_posts_advance_screening`, `flag_penalty_applies_to_next_post`,
  `observer_view_has_no_post_owner`, `links_not_in_observer_view`,
  `cooldown_not_observable`, `post_notes_no_nullifier`,
  `deposit_note_anti_forking` and `post_atomicity` conclude `True`.
  Authorization-shaped statements ending `sender ≠ censor → True` likewise
  establish no enforcement. Their reassuring names are not their propositions.
- The same file defines `poseidon2_hash_with_separator` to return constant `0`,
  then asserts `poseidon2_injective` for arbitrary arrays of length two. Equal
  constant outputs would imply distinct length-two arrays are equal. This is an
  inconsistent modeling assumption, not an abstraction of collision resistance.
  Even a real finite-field two-to-one-field hash cannot be globally injective over
  its entire input domain. Computational collision resistance must not be replaced
  by impossible mathematical injectivity. Results using this context cannot be
  accepted as security evidence; no Lean execution is needed to identify the
  contradictory definition/axiom pair.
- `sha256_to_field` is also constant `0`. `deposit_hash_agreement`,
  `withdraw_hash_agreement`, `nhk_app_opacity` and `nullifier_unlinkability` are
  `True`-valued assumptions rather than meaningful cryptographic games/equalities.
- `billboard_portal_verity/Proofs/Basic.lean` includes
  `deposit_effects_before_interactions` and `withdraw_effects_before_interactions`
  as `True := by trivial`, alongside success-path/external-stub assumptions.
  Guard proofs and storage observations, even if checked, would not prove bridge
  authenticity, conservation or reentrancy of the actual Solidity implementation.

## Privacy and liveness claims withdrawn

`post_unlinkability_master` constructs arbitrary `AztecState` records with empty
inboxes/deposit-note sets and assigns post notes to different owners while keeping
`to_observer_view` identical. Its statement does not require those states to be
reachable by valid application transitions, authenticate their notes, or exhibit
indistinguishable real transactions. An observer projection that omits private
assignments by definition is not an anonymity proof. The model omits the current
ownerless private-fee funding/spending path, L1 funding amounts and timings, shared
fee contract activity, RPC/host observations, and user content/timing correlation.
No unlinkability/privacy assurance is retained from this theorem.

`deposit_safety_master` and associated delay formulas must not be presented as
unconditional current withdrawal guarantees. Source correspondence, admission and
screening deadlines, censorship/network availability, fee funding, note availability,
current contract arithmetic bounds and reachable-state assumptions require separate
qualification. A formula over an old model does not establish operational liveness.

## Concrete implementation drift

The old Verity portal models amount-only `deposits` and `totalDeposited` storage,
a five-argument constructor with an explicit Inbox, and amount/depositor hash
stubs. Current `billboard/portal/src/BillboardPortal.sol` instead has six constructor
arguments, nine immutables, rollup-derived Inbox/Outbox, authenticated Ready
activation, deposit bounds, nonce-bearing active receipts and replay-resistant
message consumption. `PortalMessages.sol` defines versioned domain-separated
messages binding the network, portal, board and relevant receipt fields. The old
model does not certify these mechanisms or their conservation.

The historical L2/bridge model uses global post indices, old note shapes, constant
hashes and simplified consumption sets. Current `billboard_contract/src/main.nr`
and `lib.nr` define authenticated claims, deposit-chain/owner ancestry, stable post
identity, captured policy version, full-history screening, bounded economics and
current withdrawal semantics. The current private-fee contract and user recovery
journals add further state/observations absent from those models. The title
“Aztec v5” is not source or artifact version binding; the application pins 5.2.0,
and no exact matching historical formal build is supplied here.

## Review disposition

Retain the old files solely as historical material, with explicit retirement
headers. Do not count theorem totals, `True` propositions, hash stubs, unexecuted
builds or privacy narratives toward T01 or release acceptance. The new
`fv/model-checks/` checks are finite executable models with intentionally broken
controls, not replacement Lean proofs. Root must record actual executed results,
bounds and source hashes separately. Independent review must assess model/source
correspondence, cryptographic assumptions, private-fee metadata and remaining
compiler diagnostics; this AI inspection does not replace that review.
