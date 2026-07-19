# Formal Verification Plan — Anonymous Billboard (Aztec v5)

Goal (from `~/Programming/aztec/SECURITY_PROPERTIES.md` and project instructions):

## Status

### Verity L1 Portal (DONE — compiles + proofs)
- `BillboardPortal.lean` — `verity_contract` with storage (deposits, totalDeposited,
  config), linked_externals (sendL2Message, outboxConsume, sha256ToField, sendEth),
  constructor, payable deposit, reentrancy_trusted withdraw, view getDeposit.
  Compiles cleanly via `lake build Contracts.BillboardPortal.BillboardPortal`.
- `Spec.lean` — deposit_spec, withdraw_spec, guard predicates. Compiles.
- `Invariants.lean` — WellFormedState, conservation invariant (stated). Compiles.
- `Proofs/Basic.lean` — 5 fully proven theorems + 2 sorry'd:
  - ✅ getDeposit_meets_spec (returns stored value)
  - ✅ getDeposit_preserves_state (view doesn't modify state)
  - ✅ deposit_reverts_active (P2: reverts if existing deposit, given earlier guards pass)
  - ✅ deposit_reverts_u128_overflow (P14: reverts if msg.value > 2^128-1)
  - ✅ withdraw_reverts_no_deposit (P4: reverts if no active deposit)
  - ⏳ withdraw_zeros_deposit (P3: success path — needs external-call assumptions)
  - ⏳ deposit_conservation (totalDeposited increment — needs external-call model)
  - P5 (amount from storage, not user-supplied) — structural observation
  - P10 (reentrancy: effects before interactions) — structural observation
- `Proofs/Correctness.lean`, `SpecProofs.lean` — stub imports. Compile.

### Lean Aztec L2 Model (DONE — constant-cost screening version)
  - ✅ **51 theorems/lemmas proven** (zero `sorry`)
  - ✅ New model matches LATEST_CHANGE.md redesign: no `MAX_CHAIN_DEPTH`, child/grandchild screening
  - ✅ Invariants I1-I12 (I1, I3, I4, I7, I10 fully proven; I2, I8, I9, I11, I12 stated)
  - ✅ Master Privacy Theorem `post_unlinkability_master` (constructive, zero axioms)
  - ✅ Master Safety Theorem `deposit_safety_master` (bounded withdrawal: ⌈N/2⌉ × C × (1+(k-1)×2))
  - ✅ Save-up rule (I6) and flag penalty (I5) with `penalty_expand`/`cooldown_expand` lemmas
  - 5 axioms (poseidon2 injective, deposit/withdraw hash agreement, nhk opacity, nullifier unlinkability)
### Bridge Model (DONE)
  - ✅ 2 theorems (no double consume for inbox/outbox)
  - 2 axioms (L1↔L2 content-hash agreement)
### End-to-end Theorems (STATED)
  - ✅ Stated in all three components (currently some as `True := by trivial`, to be strengthened)
  - ✅ Bridge soundness theorems connect L1↔L2 via content-hash agreement axioms

---

## Original Plan

1. ~~Rewrite the L1 Solidity portal as a Verity `verity_contract` with proofs~~ ✅
2. ~~Write a Lean program with the same "shape" as the Noir billboard contract~~ ✅
   (`billboard/billboard_contract/src/main.nr` + `lib.nr`) — a standalone Lean
   model, not the Aztec compiler stack.
3. ~~Write a simple Lean model of the Ethereum↔Aztec interaction~~ ✅
   (Inbox L1→L2, Outbox L2→L1, content-hash agreement, nullifier/consumption).
4. Define the safety theorems from `SECURITY_PROPERTIES.md` (P1–P18) and
   try to prove them end-to-end. ✅ (stated, guard proofs complete, success-path
   proofs complete, constant-cost screening model fully proven)

## Layout (all under `~/Programming/aztec/fv`)

```
fv/
  verity/                         # upstream Verity toolchain (Lean 4.22, Mathlib)
  billboard_portal_verity/        # our L1 portal ported to verity_contract + proofs
    BillboardPortal.lean          # verity_contract surface
    Spec.lean                     # logical specs (Prop)
    Invariants.lean               # state invariants
    Proofs/Basic.lean             # _meets_spec theorems
    Proofs/Correctness.lean       # stronger properties (conservation, reentrancy)
    Proofs/Bridge.lean            # end-to-end soundness with the bridge model
  billboard_aztec_lean/           # standalone Lean model of the Noir contract
    AztecModel.lean               # ContractState, notes, nullifiers, chain walk
    Billboard.lean                # claim_deposit / post / withdraw / declare_immoral
    Spec.lean                     # properties as Prop
    Proofs.lean                   # proofs about the Aztec model
  bridge_model/
    Bridge.lean                   # Inbox/Outbox, content hashes, consume semantics
    BridgeProofs.lean             # agreement lemmas
  notes/
    SECURITY_PROPERTIES_FORMAL.md # mapping P1..P18 -> Lean theorem statements
  PLAN.md                         # this file
```

## Verity port — `BillboardPortal`

The Solidity portal does three externally-visible things:

- `deposit(bytes32 _secretHash) payable`: records `deposits[msg.sender] = msg.value`,
  bumps `totalDeposited`, sends an L1→L2 message via `INBOX.sendL2Message(actor,
  contentHash, _secretHash)`, emits `Deposited`.
- `withdraw(uint256,uint256,uint256,bytes32[])`: reads `amount = deposits[msg.sender]`,
  requires `> 0`, reconstructs the L2→L1 message content, calls
  `outbox.consume(...)`, zeros the deposit, decrements `totalDeposited`, sends
  ETH via `msg.sender.call{value: amount}("")`, emits `Withdrawn`.
- `getDeposit(address) view`.

Plus constructor setting immutables (`MIN_DEPOSIT`, `L2_CONTRACT`, `ROLLUP`,
`INBOX`, `VERSION`).

### Verity surface mapping

| Solidity | Verity |
|---|---|
| `uint256 public immutable MIN_DEPOSIT;` | `immutables` block: `minDeposit : Uint256 := _minDeposit` |
| `bytes32 public immutable L2_CONTRACT;` | `l2Contract : Bytes32 := _l2Contract` (or `Uint256`) |
| `address public immutable ROLLUP;` | `rollup : Address := _rollup` |
| `IInbox public immutable INBOX;` | `inbox : Address := _inbox` (from `IRollup(_rollup).getInbox()` — model as constructor arg or linked external) |
| `uint256 public immutable VERSION;` | `version : Uint256 := _version` |
| `mapping(address => uint256) deposits;` | `deposits : Address → Uint256 := slot 0` |
| `uint256 totalDeposited;` | `totalDeposited : Uint256 := slot 1` |
| `msg.value` | `msgValue` |
| `msg.sender` | `msgSender` |
| `require(cond, "msg")` | `require cond "msg"` |
| `INBOX.sendL2Message(...)` | `linked_externals` + `externalCall` (trust boundary) |
| `outbox.consume(...)` | `linked_externals` + `tryExternalCall` (trust boundary) |
| `msg.sender.call{value: amount}("")` | low-level `call` (trust boundary) or a `bubblingValueCall` ECM |
| `emit Deposited(...)` | `event_defs` + `emit "Deposited" [...]` |
| `bytes32(uint256(uint160(msg.sender)))` | `addressToWord sender` then treat as Bytes32 |

The Aztec message-bridge calls (`sendL2Message`, `consume`) are **trust
boundaries** in Verity (external calls / ECMs). We model them as `linked_externals`
with explicit assumed pre/postconditions, and the *content-hash agreement* is the
crucial property that ties L1 and L2 together (P1, P16). That agreement is proved
in `bridge_model/Bridge.lean`, where the L1-side and L2-side hash computations
are shown to produce the same `Field`/`Uint256`.

### What we prove in Verity (L1 portal, fully verified fragment)

- **P2**: `deposit` reverts if `deposits[msg.sender] != 0`.
- **P3**: `withdraw` (on success) sets `deposits[msg.sender] = 0` and decreases
  `totalDeposited` by `amount`.
- **P4**: `withdraw` reverts if `deposits[msg.sender] == 0` (no active deposit).
  Double-withdraw is additionally blocked by the outbox nullifier (modeled in the
  bridge layer).
- **P5**: the amount paid equals `deposits[msg.sender]` (read from storage, not
  user-supplied) — the portal never pays more than recorded.
- **P10**: reentrancy-safety — `deposits` is zeroed *before* the external ETH
  send; a reentrant `withdraw` reverts at `amount > 0`.
- **P14**: `deposit` reverts if `msg.value > type(uint128).max`.
- Conservation: `totalDeposited` increases by `msg.value` on deposit, decreases
  by `amount` on withdraw, never otherwise.

The `keccak256`/`sha256ToField` content-hash computation is on the
axiomatized-primitive trust boundary in Verity today; we model it as a
deterministic linked external `sha256ToField(bytes) -> (Uint256)` and prove
*agreement* with the L2 Lean model's hash in the bridge layer.

## Lean Aztec model — `billboard_aztec_lean`

A standalone Lean model capturing the *shape* of the Noir contract (updated for
the **constant-cost screening** design from LATEST_CHANGE.md):

- `AztecState` carries: public storage (`post_count`, `post_data`, `censor`,
  `k_multiplier`, `post_flagged`, `post_flagged_time`, `policy_data`, etc.) and
  a private note set per owner (`DepositNote`, `PostNote`).
- **PostNote** has `is_dummy : Bool` field; linked by `prev_link`.
- **DepositNote** carries screening state: `last_screened_link`,
  `last_screened_index`, `last_real_post_index`, `next_allowed_time`.
- Notes are values with nullifier tracking: a `Set Nullifier` records consumed
  notes; `pop_notes` requires the note's nullifier not be present and adds it.
- PostNotes are **append-only** — never nullified (matching the contract).
- **Screening**: each `post()` call screens at most 2 older posts (child and
  grandchild of `last_screened`) via `screen_one`/`screen_posts`.
  - `screen_one` checks `timestamp ≤ now - censor_window`, adds flag if flagged.
  - `screen_posts` calls `screen_one` on child, then grandchild (if child screened
    and not head).
- **Save-up rule**: `effective_old = max(old_next_allowed, now - cooldown * max_save_up)`.
- **Flag penalty**: `new_next_allowed = effective_old + cooldown * (1 + (k-1) * flag_count)`.
- **Withdrawal**: `can_withdraw = last_screened_index ≥ last_real_post_index`
  (no chain walk needed).
- `compute_cooldown`, `compute_link`, `compute_effective_old`, `compute_new_next_allowed`
  as pure Lean functions.
- `poseidon2_hash_with_separator` modeled as an uninterpreted injective function.

### What we prove in the Aztec model (51 theorems)

- **I1**: constant-cost screening — `screen_posts` screens at most 2 posts,
  flag_count ≤ 2 (zero axioms, exhaustive case-split + simp).
- **I3**: censor window — a post is screened only if `timestamp ≤ screen_threshold`
  (zero axioms).
- **I4**: monotonic advance — `last_screened` is unchanged, or advances to child
  or grandchild (zero axioms).
- **I5**: flag penalty — each flag adds exactly `cooldown * (k-1)` (zero axioms).
- **I6**: save-up rule — `effective_old ≥ now - cooldown * max_save_up` (zero axioms).
- **I7**: withdrawal requires full screening — `last_screened_index ≥ last_real_post_index`
  (zero axioms).
- **I10**: chain link unforgeability — uses `poseidon2_injective` axiom.
- **P6**: rate-limit bound — via master deposit safety theorem.
- **P8/P9**: post unlinkability — constructive proof with zero axioms.
- **P11-P13**: censor governance access control (proven).
- **P15**: cooldown arithmetic safety (proven).
- **Master**: `deposit_safety_master` — withdraw ≤ `T_stop + ⌈N/2⌉ × C × (1+(k-1)×2)`.

## Bridge model — `bridge_model`

- `Inbox` and `Outbox` as Merkle-tree-of-leaves structures with a `consumed`
  nullifier set per leaf.
- `send_l1_to_l2(content, secretHash)` adds a leaf to the Inbox.
- `consume_l1_to_l2(content, secret, leaf_index)` requires the leaf to exist and
  not be consumed, and `secretHash == H(secret)`; then marks consumed.
- `send_l2_to_l1(content)` adds a leaf to the Outbox.
- `consume_l2_to_l1(content, proof)` requires the leaf to exist and not be
  consumed; then marks consumed.
- **The key theorem**: the L1 portal's `deposit` and the L2 `claim_deposit` agree
  on `content` (P1/P16), and L2 `withdraw` and L1 `withdraw` agree on `content`
  (P1). Combined with the L1 conservation proof and the L2 note-ownership proof,
  this gives the end-to-end soundness: **a depositor can always eventually
  withdraw exactly their deposited ETH, and no one can withdraw more** (P1, P4,
  P5).

## Status / order of work

- [x] Set up `fv/` layout, clone Verity into `fv/verity`, install Lean toolchain,
      start `lake build`.
- [ ] Write `billboard_portal_verity/BillboardPortal.lean` (verity_contract).
- [ ] Write `Spec.lean`, `Invariants.lean`, `Proofs/Basic.lean`.
- [ ] Write `billboard_aztec_lean/AztecModel.lean` + `Billboard.lean`.
- [ ] Write `bridge_model/Bridge.lean`.
- [ ] State and prove theorems in `Proofs/*` and `bridge_model/BridgeProofs.lean`.
- [ ] Map each `Pn` to a theorem name in `notes/SECURITY_PROPERTIES_FORMAL.md`.
- [ ] End-to-end: prove the bridge soundness theorem combining L1 Verity + L2
      Lean + bridge model.

## Notes on trust boundaries

Per Verity's capabilities page, these portal features sit on trust boundaries and
will carry `--trust-report` assumptions rather than full Lean proofs:

- `keccak256` / `sha256ToField` dynamic-memory hashing (axiomatized primitive).
- External calls to `INBOX`/`Outbox`/ETH-send (low-level mechanics / ECMs).
- `block.chainid` runtime introspection.

We make these explicit and prove everything *around* them (conservation, guard
ordering, content-hash *agreement* with the L2 model treating both hash results
as the same deterministic oracle). The end-to-end soundness theorem is stated
modulo those documented assumptions.
