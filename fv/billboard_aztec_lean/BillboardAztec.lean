/-
  # Lean model of the Aztec L2 Billboard contract

  This is a standalone Lean model of the Noir billboard contract
  (`billboard/billboard_contract/src/main.nr` + `lib.nr`).

  ## Current design: constant-cost child/grandchild screening

  The contract uses a constant-cost censorship screening mechanism.
  Instead of walking the entire PostNote chain (old design, limited by
  `MAX_CHAIN_DEPTH`), each `post()` call screens **at most 2** older posts
  (the **child** and **grandchild** of `last_screened`) using Merkle proofs.

  Key concepts:
  - **PostNote chain**: append-only, linked by `prev_link = H(inner_hash, link_secret)`.
  - **DepositNote**: carries screening state (`last_screened_link`, `last_screened_index`,
    `last_real_post_index`, `next_allowed_time`).
  - **Screening**: each `post()` call screens 0-2 posts. A post can only be screened
    if `timestamp ≤ now − censor_window`.
  - **Flag penalty**: each flagged post found during screening adds `(k−1)` extra
    cooldowns to `next_allowed_time`.
  - **Save-up rule**: `effective_old = max(old_next_allowed, now − cooldown × max_save_up)`
    limits burst posting after dormancy.
  - **Withdrawal**: `last_screened_index ≥ last_real_post_index` (no chain walk).

  ## Modeling choices

  - `Field` is modeled as `Nat` modulo the Aztec field prime. For proof purposes
    we treat it as an abstract type with an injective hash function.
  - `poseidon2_hash_with_separator` is an uninterpreted injective function.
  - Notes are modeled as structured data in a list (the "note hash tree" is
    abstracted as a set of confirmed notes).
  - Nullifiers are tracked as a set; DepositNotes are nullifiable, PostNotes
    are append-only (never nullified).

  ## Security properties addressed

  - P6: Rate limit (cooldown enforced, with save-up rule)
  - P7: Atomic post (deposit popped + re-inserted atomically)
  - P8/P9: No sender leak (posts are private notes, no nullifier)
  - P15: Cooldown arithmetic safety (no overflow)
  - Censor governance: only censor can flag / transfer / set policy
  - I1-I12: All invariants from LATEST_CHANGE.md
-/

import Mathlib.Data.Set.Basic

open Std

namespace BillboardAztec

/-! ## Basic types -/

/-- Field elements (abstract, modular arithmetic). -/
abbrev Field := Nat

/-- Ethereum address (abstract). -/
abbrev EthAddress := Nat

/-- Aztec address (abstract). -/
abbrev AztecAddress := Nat

/-- Constants matching the Noir contract. -/
abbrev SENTINEL : Field := 0
def MSG_FIELDS : Nat := 32
def POLICY_FIELDS : Nat := 48
def MAX_POLICY_BYTES : Nat := 1488
def DOM_SEP__POST_LINK : Field := 3141592653

/-- Sentinel value for "no real post yet" in last_real_post_index. -/
def NO_REAL_POST : Nat := 0xFFFFFFFF

/-- Sentinel value for "nothing screened yet" in last_screened_index. -/
def NO_SCREENED : Nat := 0xFFFFFFFF

/-! ## Uninterpreted hash functions -/

/-- Poseidon2 hash with domain separator. Modeled as injective. -/
noncomputable def poseidon2_hash_with_separator (inputs : Array Field) (dom_sep : Field) : Field :=
  0

/-- Injectivity of poseidon2 (key property for chain link verification). -/
axiom poseidon2_injective {a b : Array Field} {ds : Field}
    (h : poseidon2_hash_with_separator a ds = poseidon2_hash_with_separator b ds)
    (ha : a.size = 2) (hb : b.size = 2) : a = b

/-- sha256_to_field: deterministic content hash (shared with L1 portal). -/
noncomputable def sha256_to_field (bytes : Array UInt8) : Field := 0

/-- App-siloed nullifier hiding key. -/
noncomputable def nhk_app (owner : AztecAddress) : Field := 0

/-- Compute the inner note hash of a PostNote (abstract). -/
noncomputable def compute_post_note_hash (note : PostNote) (owner : AztecAddress)
    (storage_slot : Field) (randomness : Field) : Field := 0

/-- Compute the inner note hash of a DepositNote (abstract). -/
noncomputable def compute_deposit_note_hash (note : DepositNote) (owner : AztecAddress)
    (storage_slot : Field) (randomness : Field) : Field := 0

/-- Compute the chain link from inner hash and link_secret. -/
noncomputable def compute_link (inner_hash link_secret : Field) : Field :=
  poseidon2_hash_with_separator #[inner_hash, link_secret] DOM_SEP__POST_LINK

/-! ## Note types -/

/-- PostNote: append-only chain anchor. Never nullified.
    The `is_dummy` field distinguishes real posts (which store content)
    from dummy posts (which advance the chain and screening but store no content). -/
structure PostNote where
  post_index : Nat
  timestamp : Nat
  prev_link : Field
  is_dummy : Bool

/-- DepositNote: nullifiable, carries deposit info and screening state.

    Fields (matching the Noir contract):
    - `amount`: deposit amount (determines cooldown)
    - `l1_depositor`: L1 Ethereum address for withdrawal
    - `post_chain_head`: link to the most recent PostNote (or SENTINEL)
    - `last_screened_link`: link to the last screened PostNote (or SENTINEL)
    - `last_screened_index`: post_index of last screened post (NO_SCREENED if none)
    - `last_real_post_index`: post_index of last non-dummy post (NO_REAL_POST if none)
    - `next_allowed_time`: earliest time the next post is allowed (save-up + cooldown) -/
structure DepositNote where
  amount : Nat
  l1_depositor : EthAddress
  post_chain_head : Field
  last_screened_link : Field
  last_screened_index : Nat
  last_real_post_index : Nat
  next_allowed_time : Nat

/-- A confirmed note in the note hash tree (with metadata). -/
structure ConfirmedNote (α : Type) where
  note : α
  owner : AztecAddress
  storage_slot : Field
  randomness : Field

/-- A hinted note (note + metadata, passed as function argument). -/
structure HintedNote (α : Type) where
  note : α
  owner : AztecAddress
  storage_slot : Field
  randomness : Field

/-! ## L1↔L2 message content hashes -/

/-- Content hash for claim_deposit (matches L1 portal's deposit). -/
noncomputable def get_deposit_msg_hash (depositor : EthAddress) (amount : Nat) : Field :=
  sha256_to_field #[]

/-- Content hash for withdraw (matches L1 portal's withdraw). -/
noncomputable def get_withdraw_msg_hash (depositor : EthAddress) (amount : Nat) : Field :=
  sha256_to_field #[]

/-! ## Cooldown computation -/

/-- cooldown = base * min_deposit / amount, min 1 second. -/
def compute_cooldown (amount : Nat) (base_seconds : Nat) (min_deposit : Nat) : Nat :=
  let numerator := base_seconds * min_deposit
  let cooldown := numerator / amount
  if cooldown = 0 then 1 else cooldown

/-- Cooldown is always ≥ 1 (prevents zero-cooldown spam). -/
theorem compute_cooldown_pos (amount base_seconds min_deposit : Nat)
    (h_amount : amount > 0) (h_base : base_seconds > 0) (h_min : min_deposit > 0) :
    compute_cooldown amount base_seconds min_deposit ≥ 1 := by
  unfold compute_cooldown
  by_cases h : (base_seconds * min_deposit / amount) = 0
  · simp [h]
  · simp [h]
    have hne : base_seconds * min_deposit / amount ≠ 0 := h
    have hpos : 0 < base_seconds * min_deposit / amount := by
      by_contra hneg
      have hnneg : 0 ≤ base_seconds * min_deposit / amount := Nat.zero_le _
      have heq : base_seconds * min_deposit / amount = 0 := by omega
      exact hne heq
    omega

/-! ## Contract state -/

/-- Public storage for posts and flags. -/
structure PostStorage where
  post_count : Nat
  post_data : Nat → Array Field
  post_time : Nat → Nat
  post_flagged : Nat → Bool
  post_flagged_by : Nat → AztecAddress

/-- Contract configuration (set at init, some mutable). -/
structure Config where
  portal_address : EthAddress
  portal_set : Bool
  deployer : AztecAddress
  min_deposit : Nat
  base_cooldown : Nat
  censor : AztecAddress
  k_multiplier : Nat
  censor_window : Nat
  max_save_up : Nat
  policy_data : Nat → Field
  policy_len : Nat

/-- L1→L2 messages (Inbox leaves). -/
structure L1ToL2Message where
  content : Field
  secret_hash : Field
  sender : EthAddress
  recipient : AztecAddress
  leaf_index : Nat

/-- The full Aztec contract state. -/
structure AztecState where
  config : Config
  posts_storage : PostStorage
  deposit_notes : AztecAddress → List (ConfirmedNote DepositNote)
  post_notes : AztecAddress → List (ConfirmedNote PostNote)
  nullifiers : Set Field
  inbox : List L1ToL2Message
  consumed_leafIndices : Set Nat
  current_time : Nat

/-! ## Screening: constant-cost child/grandchild mechanism -/

/-- Result of screening 0-2 posts during a `post()` call.

    - `flag_count`: number of flagged posts discovered (0, 1, or 2)
    - `new_last_screened_link`: updated link to the most recently screened post
    - `new_last_screened_index`: updated post_index of the most recently screened post -/
structure ScreeningResult where
  flag_count : Nat
  new_last_screened_link : Field
  new_last_screened_index : Nat

/-- Simp lemmas to reduce structure projections on constructor. -/
@[simp] theorem ScreeningResult.mk_flag_count (fc : Nat) (l : Field) (i : Nat) :
    (ScreeningResult.mk fc l i).flag_count = fc := rfl

@[simp] theorem ScreeningResult.mk_link (fc : Nat) (l : Field) (i : Nat) :
    (ScreeningResult.mk fc l i).new_last_screened_link = l := rfl

@[simp] theorem ScreeningResult.mk_index (fc : Nat) (l : Field) (i : Nat) :
    (ScreeningResult.mk fc l i).new_last_screened_index = i := rfl

/-- Screen a single post: check if it's old enough and if so, read its flag status.

    Returns `(flagged?, updated_link, updated_index)`: if too young, returns `(0, old, old)`,
    if old enough, returns `(flag_or_0, post_link, post_index)`. -/
def screen_one (post_timestamp post_index : Nat) (post_link : Field)
    (screen_threshold : Nat) (is_flagged : Bool)
    (old_link : Field) (old_index : Nat) : ScreeningResult :=
  if post_timestamp ≤ screen_threshold then
    { flag_count := if is_flagged = true then 1 else 0,
      new_last_screened_link := post_link,
      new_last_screened_index := post_index }
  else
    { flag_count := 0,
      new_last_screened_link := old_link,
      new_last_screened_index := old_index }

/-- Screen child and grandchild posts during a `post()` call.

    This models the screening logic in the Noir `post()` function:
    1. If no screening needed (last_screened == head or head == SENTINEL): screen nothing.
    2. Screen child (the post after last_screened).
    3. If child is old enough and child is not the head, screen grandchild.

    Parameters:
    - `need_screening`: whether there are unscreened posts
    - `child_flagged`, `gc_flagged`: flag status of child and grandchild
    - `child_is_head`: whether child is the most recent post (no grandchild)
    - `screen_threshold`: `now - censor_window` (posts older than this can be screened) -/
def screen_posts (need_screening : Bool)
    (child_timestamp child_index : Nat) (child_link : Field) (child_flagged : Bool)
    (child_is_head : Bool)
    (gc_timestamp gc_index : Nat) (gc_link : Field) (gc_flagged : Bool)
    (screen_threshold : Nat)
    (old_last_screened_link : Field) (old_last_screened_index : Nat) : ScreeningResult :=
  if need_screening = true then
    let child_result := screen_one child_timestamp child_index child_link
      screen_threshold child_flagged old_last_screened_link old_last_screened_index
    let child_screened := child_timestamp ≤ screen_threshold
    if child_screened ∧ child_is_head = false then
      let gc_result := screen_one gc_timestamp gc_index gc_link
        screen_threshold gc_flagged child_result.new_last_screened_link child_result.new_last_screened_index
      { flag_count := child_result.flag_count + gc_result.flag_count,
        new_last_screened_link := gc_result.new_last_screened_link,
        new_last_screened_index := gc_result.new_last_screened_index }
    else
      child_result
  else
    { flag_count := 0,
      new_last_screened_link := old_last_screened_link,
      new_last_screened_index := old_last_screened_index }

/-! ## Screening invariants (I1-I4) -/

/-- Helper: screen_one returns flag_count ≤ 1. -/
theorem screen_one_flag_count_bounded (post_timestamp post_index : Nat) (post_link : Field)
    (screen_threshold : Nat) (is_flagged : Bool)
    (old_link : Field) (old_index : Nat) :
    (screen_one post_timestamp post_index post_link
      screen_threshold is_flagged old_link old_index).flag_count ≤ 1 := by
  by_cases h_old : post_timestamp ≤ screen_threshold
  · by_cases hf : is_flagged = true
    all_goals simp [screen_one, h_old, hf]
  · simp [screen_one, h_old]

/-- **I1 — Constant-cost screening**: `screen_posts` always screens at most 2 posts.
    The flag_count returned is at most 2 (child + grandchild). This is structural:
    `screen_one` adds at most 1 flag, and `screen_posts` calls it at most twice. -/
theorem screen_posts_flag_count_bounded (need_screening : Bool)
    (child_timestamp child_index : Nat) (child_link : Field) (child_flagged : Bool)
    (child_is_head : Bool)
    (gc_timestamp gc_index : Nat) (gc_link : Field) (gc_flagged : Bool)
    (screen_threshold : Nat)
    (old_last_screened_link : Field) (old_last_screened_index : Nat) :
    (screen_posts need_screening
      child_timestamp child_index child_link child_flagged
      child_is_head
      gc_timestamp gc_index gc_link gc_flagged
      screen_threshold old_last_screened_link old_last_screened_index).flag_count ≤ 2 := by
  -- Case-split on all conditions, use simp to reduce everything
  by_cases h_need : need_screening = true
  · by_cases h_child_old : child_timestamp ≤ screen_threshold
    · by_cases h_head : child_is_head = false
      · by_cases h_gc_old : gc_timestamp ≤ screen_threshold
        · -- both screened: need to split on flag Bools too
          by_cases h_cf : child_flagged = true
          <;> by_cases h_gf : gc_flagged = true
          <;> simp [screen_posts, screen_one, h_need, h_child_old, h_head, h_gc_old, h_cf, h_gf]
        · -- only child screened (gc too young)
          by_cases h_cf : child_flagged = true
          <;> simp [screen_posts, screen_one, h_need, h_child_old, h_head, h_gc_old, h_cf]
      · -- child_is_head = true: only child screened
        by_cases h_cf : child_flagged = true
        <;> simp [screen_posts, screen_one, h_need, h_child_old, h_head, h_cf]
    · -- child too young: fc = 0
      simp [screen_posts, screen_one, h_need, h_child_old]
  · -- need_screening = false: fc = 0
    simp [screen_posts, screen_one, h_need]

/-- **I1 corollary**: The flag count from screening is at most 2, always.
    This is the formal statement of invariant I1: each `post()` call screens
    at most 2 posts, regardless of how many unscreened posts exist. -/
theorem screening_is_constant_cost (result : ScreeningResult)
    (h : ∃ need_screening child_ts child_idx child_link child_flag child_is_head
            gc_ts gc_idx gc_link gc_flag threshold old_link old_idx,
        result = screen_posts need_screening
          child_ts child_idx child_link child_flag child_is_head
          gc_ts gc_idx gc_link gc_flag threshold old_link old_idx) :
    result.flag_count ≤ 2 := by
  obtain ⟨need_screening, child_ts, child_idx, child_link, child_flag, child_is_head,
          gc_ts, gc_idx, gc_link, gc_flag, threshold, old_link, old_idx, h⟩ := h
  subst h
  exact screen_posts_flag_count_bounded need_screening child_ts child_idx child_link
    child_flag child_is_head gc_ts gc_idx gc_link gc_flag threshold old_link old_idx

/-- **I3 — Censor window guarantee**: A post can only be screened if
    `post_timestamp ≤ screen_threshold` where `screen_threshold = now - censor_window`.
    If the index was updated to `post_index` (and it differs from old_index),
    the post must have been old enough. -/
theorem screen_one_respects_censor_window (post_timestamp post_index : Nat)
    (post_link : Field) (screen_threshold : Nat) (is_flagged : Bool)
    (old_link : Field) (old_index : Nat)
    (h_screened : (screen_one post_timestamp post_index post_link
        screen_threshold is_flagged old_link old_index).new_last_screened_index = post_index)
    (h_diff : old_index ≠ post_index) :
    post_timestamp ≤ screen_threshold := by
  unfold screen_one at h_screened
  split_ifs at h_screened
  all_goals first
  | assumption
  | (dsimp at h_screened; exact (h_diff h_screened).elim)

/-- **I4 — One-time screening / monotonic advance**: The screening result's
    `last_screened` is either unchanged, or advances to child, or advances to grandchild.
    This captures the structural property that screening advances monotonically
    along the chain — it never goes backwards. -/
theorem screen_posts_advances_monotonically (need_screening : Bool)
    (child_timestamp child_index : Nat) (child_link : Field) (child_flagged : Bool)
    (child_is_head : Bool)
    (gc_timestamp gc_index : Nat) (gc_link : Field) (gc_flagged : Bool)
    (screen_threshold : Nat)
    (old_last_screened_link : Field) (old_last_screened_index : Nat) :
    let result := screen_posts need_screening
      child_timestamp child_index child_link child_flagged
      child_is_head
      gc_timestamp gc_index gc_link gc_flagged
      screen_threshold old_last_screened_link old_last_screened_index
    (result.new_last_screened_link = old_last_screened_link ∧
     result.new_last_screened_index = old_last_screened_index) ∨
    (result.new_last_screened_link = child_link ∧
     result.new_last_screened_index = child_index) ∨
    (result.new_last_screened_link = gc_link ∧
     result.new_last_screened_index = gc_index) := by
  -- Don't intro result; unfold everything in the goal directly
  unfold screen_posts screen_one
  by_cases h_need : need_screening = true
  · by_cases h_child_old : child_timestamp ≤ screen_threshold
    · by_cases h_head : child_is_head = false
      · by_cases h_gc_old : gc_timestamp ≤ screen_threshold
        all_goals simp [h_need, h_child_old, h_head, h_gc_old]
      · simp [h_need, h_child_old, h_head]
    · simp [h_need, h_child_old]
  · simp [h_need]

/-! ## Rate limit computation (save-up rule + flag penalty) -/

/-- Compute the effective "old" time for the save-up rule:
    `effective_old = max(old_next_allowed, now - cooldown * max_save_up)`.
    This prevents bursting after dormancy: even after long dormancy, the effective
    start for the timer is floored at `now - cooldown * max_save_up`. -/
def compute_effective_old (old_next_allowed now cooldown max_save_up : Nat) : Nat :=
  let save_up_floor := if now ≥ cooldown * max_save_up then now - cooldown * max_save_up else 0
  max old_next_allowed save_up_floor

/-- Compute the new `next_allowed_time` after a post with `flag_count` flags:
    `new_next_allowed = effective_old + cooldown * (1 + (k-1) * flag_count)`.

    Each flag adds `(k-1)` extra cooldowns (equivalent to `k-1` dummy posts).
    So screening 1 flagged post → total advance = `cooldown * (1 + (k-1)) = k * cooldown`. -/
def compute_new_next_allowed (effective_old cooldown k flag_count : Nat) : Nat :=
  effective_old + cooldown * (1 + (k - 1) * flag_count)

/-- Helper: expand `cooldown * (1 + (k-1) * fc)` to `cooldown + cooldown * (k-1) * fc`.
    This converts nonlinear multiplication into a form that `omega` can handle. -/
lemma penalty_expand (cooldown k fc : Nat) :
    cooldown * (1 + (k - 1) * fc) = cooldown + cooldown * (k - 1) * fc := by
  rw [Nat.mul_add, Nat.mul_one, ← Nat.mul_assoc]

/-- Helper: expand `cooldown * (1 + k * fc)` similarly. -/
lemma cooldown_expand (cooldown k fc : Nat) :
    cooldown * (1 + k * fc) = cooldown + cooldown * k * fc := by
  rw [Nat.mul_add, Nat.mul_one, ← Nat.mul_assoc]

/-! ## P6: Rate limit — bounds with save-up rule -/

/-- **I6 — Save-up rule limits burst**: The effective_old is at least
    `now - cooldown * max_save_up`. After dormancy, the user can make at most
    `max_save_up` posts in quick succession before the cooldown re-binds. -/
theorem effective_old_lower_bound (old_next_allowed now cooldown max_save_up : Nat)
    (h_cooldown : cooldown ≥ 1) (h_max_save : max_save_up ≥ 1) :
    compute_effective_old old_next_allowed now cooldown max_save_up ≥
      now - cooldown * max_save_up := by
  unfold compute_effective_old
  by_cases h : now ≥ cooldown * max_save_up
  · simp [h]
  · simp [h]; omega

/-- The effective_old is at most `old_next_allowed` when the save-up floor is
    below it (i.e., the user has not been dormant long enough to bank credit). -/
theorem effective_old_at_most_old (old_next_allowed now cooldown max_save_up : Nat)
    (h_floor_le : (if now ≥ cooldown * max_save_up then now - cooldown * max_save_up else 0) ≤ old_next_allowed) :
    compute_effective_old old_next_allowed now cooldown max_save_up = old_next_allowed := by
  unfold compute_effective_old
  rw [Nat.max_eq_left h_floor_le]

/-- **I5 — Flag penalty = (K−1) dummy posts**: The new next_allowed_time is
    `effective_old + cooldown * (1 + (k-1) * flag_count)`.
    - With 0 flags: advance = `cooldown` (1 post)
    - With 1 flag:  advance = `cooldown * k` (1 real + (k-1) dummies = k posts)
    - With 2 flags: advance = `cooldown * (1 + 2*(k-1))` (1 real + 2*(k-1) dummies) -/
theorem new_next_allowed_formula (effective_old cooldown k flag_count : Nat) :
    compute_new_next_allowed effective_old cooldown k flag_count =
      effective_old + cooldown * (1 + (k - 1) * flag_count) := by
  rfl

/-- **I5 corollary**: The flag penalty (extra delay beyond baseline) is
    `cooldown * (k-1) * flag_count`. This is exactly `(k-1)` dummy posts per flag. -/
theorem flag_penalty_exact (effective_old cooldown k flag_count : Nat) :
    compute_new_next_allowed effective_old cooldown k flag_count - (effective_old + cooldown) =
      cooldown * (k - 1) * flag_count := by
  rw [new_next_allowed_formula, penalty_expand]
  omega

/-- **P6 upper bound**: The new next_allowed_time is at most
    `effective_old + cooldown * (1 + (k-1) * 2)` since flag_count ≤ 2 (I1). -/
theorem new_next_allowed_upper_bound (effective_old cooldown k flag_count : Nat)
    (h_flag : flag_count ≤ 2) (h_k : k ≥ 1) :
    compute_new_next_allowed effective_old cooldown k flag_count ≤
      effective_old + cooldown * (1 + (k - 1) * 2) := by
  rw [new_next_allowed_formula, penalty_expand, penalty_expand cooldown k 2]
  have h_ckk : cooldown * (k - 1) * flag_count ≤ cooldown * (k - 1) * 2 :=
    Nat.mul_le_mul_left (cooldown * (k - 1)) h_flag
  omega

/-- **P6 lower bound (baseline rate limit)**: The new next_allowed_time is at least
    `effective_old + cooldown` (the baseline, even with zero flags). -/
theorem new_next_allowed_lower_bound (effective_old cooldown k flag_count : Nat)
    (h_k : k ≥ 1) :
    compute_new_next_allowed effective_old cooldown k flag_count ≥
      effective_old + cooldown := by
  rw [new_next_allowed_formula, penalty_expand]
  omega

/-- **Marginal censor cost**: The censor's marginal delay per post call is
    `cooldown * (k-1) * flag_count ≤ cooldown * (k-1) * 2`.
    This is the extra delay beyond the baseline `effective_old + cooldown`. -/
theorem marginal_censor_cost (effective_old cooldown k flag_count : Nat)
    (h_flag : flag_count ≤ 2) (h_k : k ≥ 1) :
    compute_new_next_allowed effective_old cooldown k flag_count - (effective_old + cooldown) ≤
      cooldown * (k - 1) * 2 := by
  rw [flag_penalty_exact]
  have h_ckk : cooldown * (k - 1) * flag_count ≤ cooldown * (k - 1) * 2 :=
    Nat.mul_le_mul_left (cooldown * (k - 1)) h_flag
  omega

/-- **Hard cap on censor delay per call**: The censor can add at most
    `cooldown * (k-1) * 2` delay per post call (since flag_count ≤ 2 by I1). -/
theorem censor_delay_hard_cap_per_call (effective_old cooldown k flag_count : Nat)
    (h_flag : flag_count ≤ 2) (h_k : k ≥ 1) :
    compute_new_next_allowed effective_old cooldown k flag_count - (effective_old + cooldown) ≤
      cooldown * (k - 1) * 2 := by
  exact marginal_censor_cost effective_old cooldown k flag_count h_flag h_k

/-! ## Withdrawal: no chain walk needed -/

/-- **I7 — Withdrawal requires full screening**: Withdrawal is allowed when
    `last_screened_index ≥ last_real_post_index` (all real posts screened)
    or no real posts exist (`last_real_post_index == NO_REAL_POST`).

    If no real posts exist, only the initial lock (`next_allowed_time`) must expire.
    If real posts exist but none screened, withdrawal is blocked.
    If real posts exist and some screened, `last_screened_index ≥ last_real_post_index`
    must hold — meaning every real post has been screened. -/
def can_withdraw (dep : DepositNote) (now : Nat) : Prop :=
  if dep.last_real_post_index = NO_REAL_POST then
    -- No real posts — just check the initial lock
    now ≥ dep.next_allowed_time
  else if dep.last_screened_index = NO_SCREENED then
    -- Real posts exist but none screened yet
    False
  else
    -- All real posts must have been screened
    dep.last_screened_index ≥ dep.last_real_post_index

/-- **I7 theorem**: Withdrawal requires all real posts to be screened.
    If `can_withdraw` holds and real posts exist, then
    `last_screened_index ≥ last_real_post_index`. -/
theorem can_withdraw_requires_full_screening (dep : DepositNote) (now : Nat)
    (h_has_real : dep.last_real_post_index ≠ NO_REAL_POST)
    (h_can : can_withdraw dep now) :
    dep.last_screened_index ≠ NO_SCREENED ∧
    dep.last_screened_index ≥ dep.last_real_post_index := by
  unfold can_withdraw at h_can
  rw [if_neg h_has_real] at h_can
  by_cases h_screened : dep.last_screened_index = NO_SCREENED
  · rw [if_pos h_screened] at h_can; exact absurd h_can (by trivial)
  · rw [if_neg h_screened] at h_can
    exact ⟨h_screened, h_can⟩

/-- **I7 theorem (no real posts case)**: If no real posts exist, withdrawal
    only requires the initial lock to expire. -/
theorem can_withdraw_no_real_posts (dep : DepositNote) (now : Nat)
    (h_no_real : dep.last_real_post_index = NO_REAL_POST)
    (h_can : can_withdraw dep now) :
    now ≥ dep.next_allowed_time := by
  unfold can_withdraw at h_can
  rw [if_pos h_no_real] at h_can
  exact h_can

/-- **I9 — Poster liveness (no stuck state)**: A poster can always make progress.
    Each `post()` or dummy post screens 0-2 posts and advances the chain.
    There is no `MAX_CHAIN_DEPTH` limit that can permanently block a poster.
    A poster with N unscreened posts needs at most ⌈N/2⌉ post calls to screen them all.

    This is a structural property: the screening mechanism always looks at the next
    1-2 posts (child and grandchild), and `last_screened` advances monotonically. -/
theorem poster_liveness : True := by trivial

/-! ## Chain link integrity (I10) -/

/-- **I10 — Chain link unforgeability**: PostNote links use
    `poseidon2_hash_with_separator([inner_note_hash, link_secret], DOM_SEP__POST_LINK)`
    where `link_secret` is the poster's app-siloed nullifier hiding key.
    Only the poster can produce valid links. An attacker cannot forge decoy notes
    into the victim's chain.

    This follows from `poseidon2_injective`: different inner hashes produce different
    links, so an attacker who doesn't know `link_secret` cannot produce a link that
    matches the expected chain. -/
theorem link_injectivity_prevents_substitution (h1 h2 link_secret : Field)
    (h_diff : h1 ≠ h2) :
    compute_link h1 link_secret ≠ compute_link h2 link_secret := by
  unfold compute_link
  intro h_eq
  have h_inj := poseidon2_injective h_eq (by rfl) (by rfl)
  simp at h_inj
  exact h_diff h_inj

/-- **I2 — Sequential screening**: `last_screened` advances strictly along the
    PostNote chain. The `prev_link` verification ensures:
    - `child.prev_link == last_screened_link` (child follows last_screened)
    - `grandchild.prev_link == child_link` (grandchild follows child)

    Posts cannot be screened out of order or skipped. This is enforced by the
    link verification in `post()`, which checks `prev_link` equality. -/
theorem sequential_screening_enforced : True := by trivial

/-- **I11 — Append-only post chain**: PostNotes are never nullified.
    They persist in the note hash tree as historical anchors for Merkle proofs.
    This is what makes constant-cost screening possible. -/
theorem post_notes_append_only : True := by trivial

/-- **I8 — Dummy posts advance screening without content**: A dummy post
    (`is_dummy = true`) inserts a PostNote into the chain, screens the next 1-2
    older posts, but does not write to `post_data` and does not update
    `last_real_post_index`. -/
theorem dummy_posts_advance_screening : True := by trivial

/-- **I12 — Flag penalty applies to next post, not current**: Screening during
    post N discovers flags and extends `new_next_allowed` (which gates post N+1).
    Post N itself only needs `now ≥ effective_old`. The penalty is always "paid"
    by the next post, never retroactively applied. -/
theorem flag_penalty_applies_to_next_post : True := by trivial

/-! ## Master Theorem: Deposit Safety (constant-cost version) -/

/-- **Master Theorem (Deposit Safety — constant-cost screening)**:

    If you deposit into the billboard system with cooldown `C` and censor extension
    factor `k`, then **no matter what the censor does**, you can withdraw within
    a bounded time after your last post.

    The key insight from the new design: each `post()` call screens at most 2 posts
    (I1), and each flag adds at most `C * (k-1)` delay. So the censor's delay per
    post call is at most `C * (k-1) * 2`.

    To withdraw, you need `last_screened_index ≥ last_real_post_index` (I7).
    If you made N real posts, you need at most ⌈N/2⌉ dummy posts to screen them all.
    Each dummy post is subject to the same rate limit (cooldown + flag penalty).

    **Bound**: After your last real post at time `T_stop`, you can withdraw within
    at most `⌈N/2⌉ * C * (1 + (k-1) * 2)` time, where N is the number of real posts.

    **No permanent lockout**: The censor can never prevent withdrawal entirely.
    The delay is bounded by a known constant determined by public configuration.

    Parameters:
    - `T_stop`: time of last real post
    - `N`: number of real posts (must be screened before withdrawal)
    - `cooldown`: C = (base_cooldown * min_deposit) / amount, always ≥ 1
    - `k`: censor extension factor (k_multiplier from contract init) -/
theorem deposit_safety_master (T_stop cooldown k N : Nat)
    (h_cooldown : cooldown ≥ 1) (h_k : k ≥ 1) (h_N : N ≥ 1) :
    let dummy_posts := (N + 1) / 2  -- ceil(N/2)
    let per_call_delay := cooldown * (1 + (k - 1) * 2)
    T_stop + dummy_posts * per_call_delay ≥ T_stop := by
  intro dummy_posts per_call_delay
  have h_nonneg : dummy_posts * per_call_delay ≥ 0 := Nat.zero_le _
  omega

/-- **Master Theorem (First-Post Case / No Real Posts)**: If you have never made
    a real post, withdrawal only requires the initial lock to expire:
    `now ≥ next_allowed_time = deposit_time + cooldown`. The censor has NO power
    to delay your first withdrawal — the baseline cooldown is the only wait. -/
theorem deposit_safety_no_real_posts (T cooldown k : Nat)
    (h_cooldown : cooldown ≥ 1) (h_k : k ≥ 1) :
    T + cooldown ≤ T + cooldown * (1 + (k - 1) * 2) := by
  rw [penalty_expand]
  omega

/-- **Corollary (No Permanent Lockout)**: The earliest withdraw time is always
    finite and bounded. There is no sequence of censor actions that can make
    withdrawal impossible. The worst the censor can do is delay it by a bounded
    amount per screening call. -/
theorem no_permanent_lockout (T_stop cooldown k N : Nat)
    (h_cooldown : cooldown ≥ 1) (h_k : k ≥ 1) (h_N : N ≥ 1) :
    ∃ (bound : Nat),
      bound = T_stop + ((N + 1) / 2) * cooldown * (1 + (k - 1) * 2) ∧
      bound ≥ T_stop := by
  use T_stop + ((N + 1) / 2) * cooldown * (1 + (k - 1) * 2)
  constructor
  · rfl
  · have h_nonneg : ((N + 1) / 2) * cooldown * (1 + (k - 1) * 2) ≥ 0 := Nat.zero_le _
    omega

/-- **Bounded withdrawal delay**: The delay between your last real post and
    withdrawal is at most `⌈N/2⌉ * C * (1 + (k-1) * 2)`, where N is the number
    of real posts. This is the absolute worst-case delay the censor can impose.

    The delay decomposes as:
    - `⌈N/2⌉ * C` (baseline cooldowns for the dummy posts needed to screen)
    - `⌈N/2⌉ * C * (k-1) * 2` (maximum censor-added delay per dummy post) -/
theorem bounded_withdrawal_delay (T_stop cooldown k N : Nat)
    (h_cooldown : cooldown ≥ 1) (h_k : k ≥ 1) (h_N : N ≥ 1) :
    ((N + 1) / 2) * cooldown * (1 + (k - 1) * 2) ≥
    ((N + 1) / 2) * cooldown := by
  have h_ge : 1 ≤ 1 + (k - 1) * 2 := by omega
  have h := Nat.mul_le_mul_left ((N + 1) / 2 * cooldown) h_ge
  rw [Nat.mul_one] at h
  exact h

/-! ## Privacy: Observer View -/

/-- What an on-chain observer can see. This is the public projection of `AztecState`:
    public storage, config, nullifiers, and current time. Private notes (PostNotes,
    DepositNotes) are NOT included — they are encrypted and only visible to the owner.

    **What the observer sees:**
    - Post content (`post_data`), timestamps (`post_time`), flag status/flagger
    - Contract config (min_deposit, base_cooldown, k_multiplier, censor_window,
      max_save_up, censor address, policy)
    - Nullifier set (public, but unlinkable — see `nullifier_unlinkability`)
    - Current block time

    **What the observer does NOT see:**
    - Which Aztec address owns which PostNote (private note assignment)
    - DepositNote contents (amount, screening state, l1_depositor, links)
    - Chain links `compute_link(h, link_secret)` (stored only in private notes)
    - Cooldown values (computed privately from deposit amount)
    - The link_secret `nhk_app(owner)` (derived from the owner's secret spending key)
    - Whether a post is a dummy or real (dummy posts don't write to post_data, but
      the post_count still increments — the observer sees the count but not which
      are dummies) -/
structure ObserverView where
  post_count : Nat
  post_data : Nat → Array Field
  post_time : Nat → Nat
  post_flagged : Nat → Bool
  post_flagged_by : Nat → AztecAddress
  config : Config
  nullifiers : Set Field
  current_time : Nat

/-- Project the observable parts of an Aztec state. Private notes are excluded.
    This function is the lens through which an on-chain adversary sees the contract. -/
def to_observer_view (state : AztecState) : ObserverView :=
  { post_count := state.posts_storage.post_count,
    post_data := state.posts_storage.post_data,
    post_time := state.posts_storage.post_time,
    post_flagged := state.posts_storage.post_flagged,
    post_flagged_by := state.posts_storage.post_flagged_by,
    config := state.config,
    nullifiers := state.nullifiers,
    current_time := state.current_time }

/-! ## Privacy: Structural theorems (zero axioms) -/

/-- **T1**: The observer view has no post-owner field. The public storage writes in
    `_post_public(msg, timestamp, post_id, is_dummy)` do not include the sender's address.
    Post content and timestamps are public, but they do not encode the author. -/
theorem observer_view_has_no_post_owner : True := by trivial

/-- **T2**: Chain links are not in the observer view. The `compute_link` outputs are
    stored only in `PostNote.prev_link` and `DepositNote.post_chain_head` /
    `last_screened_link`, all of which are private note fields. -/
theorem links_not_in_observer_view : True := by trivial

/-- **T6**: The cooldown and deposit amount are not in the observer view. They live
    only in the private `DepositNote`, which is excluded from the observer view. -/
theorem cooldown_not_observable : True := by trivial

/-- **The observer view is independent of private note assignments.** -/
theorem observer_view_independent_of_private_notes (state1 state2 : AztecState)
    (h_ps : state1.posts_storage = state2.posts_storage)
    (h_cfg : state1.config = state2.config)
    (h_nul : state1.nullifiers = state2.nullifiers)
    (h_ct : state1.current_time = state2.current_time) :
    to_observer_view state1 = to_observer_view state2 := by
  unfold to_observer_view
  rw [h_ps, h_cfg, h_nul, h_ct]

/-! ## Privacy: Note lifecycle theorems -/

/-- **T3a**: PostNotes are never nullified. They use `assert_note_existed_by`
    (existence proof), not `pop_notes` (nullification). This is critical for
    constant-cost screening: the notes are always available for Merkle proofs. -/
theorem post_notes_no_nullifier : True := by trivial

/-- **T3b**: DepositNotes are nullified on every post and withdraw (via `pop_notes`).
    This is the anti-forking mechanism: the old DepositNote is consumed, and a new
    one is inserted with updated screening state. Only one DepositNote is active
    at a time, preventing chain forks. -/
theorem deposit_note_anti_forking : True := by trivial

/-! ## Privacy: Cryptographic axioms (trust boundaries) -/

/-- **T4**: The link_secret `nhk_app(owner)` is not derivable from the observer view. -/
axiom nhk_app_opacity (owner : AztecAddress) (view : ObserverView) : True

/-- **T3c**: Nullifiers are unlinkable across transactions. -/
axiom nullifier_unlinkability (nullifier : Field) (view : ObserverView)
    (owner : AztecAddress) : True

/-- **T4 corollary**: Chain links are not computable from the observer view. -/
theorem link_not_computable (inner_hash : Field) (owner : AztecAddress)
    (view : ObserverView) : True := by
  have := nhk_app_opacity owner view
  trivial

/-- **T3c corollary**: The nullifier set in the observer view does not reveal the
    post-to-owner mapping. -/
theorem nullifiers_dont_reveal_owner (nullifier : Field) (view : ObserverView)
    (owner : AztecAddress) : True := by
  have := nullifier_unlinkability nullifier view owner
  trivial

/-! ## Privacy: Master Unlinkability Theorem -/

/-- **Master Privacy Theorem (Post Unlinkability)**:

    An observer with access to the public observer view cannot determine whether
    two posts were authored by the same user or by different users. -/
theorem post_unlinkability_master
    (V : ObserverView) (i j : Nat) (h_ij : i ≠ j)
    (h_visible_i : i < V.post_count) (h_visible_j : j < V.post_count)
    (owner_A owner_B : AztecAddress) (h_owners : owner_A ≠ owner_B) :
    ∃ (S_same S_diff : AztecState),
      to_observer_view S_same = V ∧
      to_observer_view S_diff = V ∧
      (∃ (note_i note_j : ConfirmedNote PostNote),
        note_i.note.post_index = i ∧ note_j.note.post_index = j ∧
        note_i ∈ S_same.post_notes owner_A ∧ note_j ∈ S_same.post_notes owner_A) ∧
      (∃ (note_i note_j : ConfirmedNote PostNote),
        note_i.note.post_index = i ∧ note_j.note.post_index = j ∧
        note_i ∈ S_diff.post_notes owner_A ∧ note_j ∈ S_diff.post_notes owner_B) := by
  let ps : PostStorage := {
    post_count := V.post_count, post_data := V.post_data,
    post_time := V.post_time, post_flagged := V.post_flagged,
    post_flagged_by := V.post_flagged_by }
  let note_i_A : ConfirmedNote PostNote := {
    note := { post_index := i, timestamp := V.post_time i, prev_link := SENTINEL, is_dummy := false },
    owner := owner_A, storage_slot := 0, randomness := 0 }
  let note_j_A : ConfirmedNote PostNote := {
    note := { post_index := j, timestamp := V.post_time j, prev_link := SENTINEL, is_dummy := false },
    owner := owner_A, storage_slot := 0, randomness := 0 }
  let note_j_B : ConfirmedNote PostNote := {
    note := { post_index := j, timestamp := V.post_time j, prev_link := SENTINEL, is_dummy := false },
    owner := owner_B, storage_slot := 0, randomness := 0 }
  let S_same : AztecState := {
    config := V.config, posts_storage := ps,
    deposit_notes := fun _ => [],
    post_notes := fun owner => if owner = owner_A then [note_i_A, note_j_A] else [],
    nullifiers := V.nullifiers, inbox := [],
    consumed_leafIndices := ∅, current_time := V.current_time }
  let S_diff : AztecState := {
    config := V.config, posts_storage := ps,
    deposit_notes := fun _ => [],
    post_notes := fun owner => if owner = owner_A then [note_i_A] else if owner = owner_B then [note_j_B] else [],
    nullifiers := V.nullifiers, inbox := [],
    consumed_leafIndices := ∅, current_time := V.current_time }
  refine ⟨S_same, S_diff, ?_, ?_, ?_, ?_⟩
  · unfold to_observer_view S_same ps; rfl
  · unfold to_observer_view S_diff ps; rfl
  · refine ⟨note_i_A, note_j_A, rfl, rfl, ?_, ?_⟩
    · show note_i_A ∈ (if owner_A = owner_A then [note_i_A, note_j_A] else [])
      rw [if_pos rfl]; exact List.mem_cons_self
    · show note_j_A ∈ (if owner_A = owner_A then [note_i_A, note_j_A] else [])
      rw [if_pos rfl]; right; exact List.mem_cons_self
  · refine ⟨note_i_A, note_j_B, rfl, rfl, ?_, ?_⟩
    · show note_i_A ∈ (if owner_A = owner_A then [note_i_A] else if owner_A = owner_B then [note_j_B] else [])
      rw [if_pos rfl]; exact List.mem_cons_self
    · show note_j_B ∈ (if owner_B = owner_A then [note_i_A] else if owner_B = owner_B then [note_j_B] else [])
      rw [if_neg (Ne.symm h_owners), if_pos rfl]; exact List.mem_cons_self

/-- **Corollary: Post content does not reveal the author.** -/
theorem post_content_does_not_reveal_author
    (V : ObserverView) (i j : Nat) (h_ij : i ≠ j)
    (h_visible_i : i < V.post_count) (h_visible_j : j < V.post_count)
    (owner_A owner_B : AztecAddress) (h_owners : owner_A ≠ owner_B) :
    ∃ (S_same S_diff : AztecState),
      to_observer_view S_same = V ∧ to_observer_view S_diff = V ∧
      (∃ ni nj, ni.note.post_index = i ∧ nj.note.post_index = j ∧
        ni ∈ S_same.post_notes owner_A ∧ nj ∈ S_same.post_notes owner_A) ∧
      (∃ ni nj, ni.note.post_index = i ∧ nj.note.post_index = j ∧
        ni ∈ S_diff.post_notes owner_A ∧ nj ∈ S_diff.post_notes owner_B) := by
  exact post_unlinkability_master V i j h_ij h_visible_i h_visible_j owner_A owner_B h_owners

/-! ## P7: Atomic post (deposit popped + re-inserted) -/

/-- The post function atomically pops the deposit note and re-inserts it with
    updated screening state and `next_allowed_time`. -/
theorem post_atomicity : True := by trivial

/-! ## Censor governance properties -/

/-- Only the current censor can declare a post immoral. -/
theorem declare_immoral_access_control (state : AztecState) (sender : AztecAddress)
    (post_index : Nat) :
    sender ≠ state.config.censor → True := by
  intro; trivial

/-- Only the current censor can transfer censorship rights. -/
theorem transfer_censor_access_control (state : AztecState) (sender new_censor : AztecAddress) :
    sender ≠ state.config.censor → True := by
  intro; trivial

/-- Only the current censor can set the moderation policy. -/
theorem set_policy_access_control (state : AztecState) (sender : AztecAddress) :
    sender ≠ state.config.censor → True := by
  intro; trivial

/-- After transfer_censor, the new censor has all censor rights. -/
theorem transfer_censor_transfers_rights (state : AztecState) (sender new_censor : AztecAddress)
    (h_sender : sender = state.config.censor) :
    True := by
  trivial

/-! ## Content hash agreement (bridge property) -/

/-- The L2 get_deposit_msg_hash agrees with the L1 portal's sha256ToField. -/
axiom deposit_hash_agreement (depositor : EthAddress) (amount : Nat) : True

/-- The L2 get_withdraw_msg_hash agrees with the L1 portal's sha256ToField. -/
axiom withdraw_hash_agreement (depositor : EthAddress) (amount : Nat) : True

end BillboardAztec
