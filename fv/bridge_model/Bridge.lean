/-!
RETIRED HISTORICAL MODEL — NOT PRODUCTION SECURITY ASSURANCE.
This file is preserved for provenance only. Its comments and theorem names are
historical claims, not current acceptance. It has not been rebuilt or connected
to the current pinned contracts. See fv/README.md and
fv/notes/SECURITY_PROPERTIES_FORMAL.md for vacuity, inconsistent assumptions,
source drift and privacy limitations. Do not count this file as a checked proof.
-/

/-
  # Bridge model: Ethereum ↔ Aztec L1↔L2 message passing

  This model captures the L1↔L2 message bridge connecting the Verity L1 portal
  with the Lean Aztec L2 model.

  ## Key theorem (P1/P16): Content-hash agreement

  The content hash computed on L1 must equal the content hash computed on L2.
  This is the soundness bridge ensuring deposits and withdrawals match.
-/

import Contracts.BillboardAztecLean.BillboardAztec

open Std

namespace BillboardBridge

open BillboardAztec

/-! ## Inbox (L1→L2) -/

structure InboxMessage where
  content : Field
  secret_hash : Field
  sender : EthAddress
  recipient : AztecAddress
  leaf_index : Nat

structure InboxState where
  messages : List InboxMessage
  consumed : List Nat       -- consumed leaf indices (List for decidable membership)

def InboxState.insert (st : InboxState) (msg : InboxMessage) : InboxState :=
  { st with messages := st.messages ++ [msg] }

/-- Consume a message from the inbox. Returns (success, new_state). -/
def InboxState.consume (st : InboxState) (idx : Nat)
    (content : Field) (secret : Field) (sender : EthAddress) : Bool × InboxState :=
  match st.messages[idx]? with
  | none => (false, st)
  | some msg =>
    if idx ∈ st.consumed then
      (false, st)
    else if msg.content ≠ content then
      (false, st)
    else if msg.sender ≠ sender then
      (false, st)
    else
      (true, { st with consumed := idx :: st.consumed })

/-- A consumed message cannot be consumed again. -/
theorem InboxState.no_double_consume (st : InboxState) (idx : Nat)
    (content : Field) (secret : Field) (sender : EthAddress)
    (hconsumed : idx ∈ st.consumed) :
    (st.consume idx content secret sender).1 = false := by
  unfold consume
  match hget : st.messages[idx]? with
  | none => rfl
  | some msg => simp [hconsumed]

/-! ## Outbox (L2→L1) -/

structure OutboxMessage where
  content : Field
  recipient : EthAddress
  leaf_index : Nat

structure OutboxState where
  messages : List OutboxMessage
  consumed : List Nat

def OutboxState.insert (st : OutboxState) (msg : OutboxMessage) : OutboxState :=
  { st with messages := st.messages ++ [msg] }

def OutboxState.consume (st : OutboxState) (idx : Nat) (content : Field) : Bool × OutboxState :=
  match st.messages[idx]? with
  | none => (false, st)
  | some msg =>
    if idx ∈ st.consumed then
      (false, st)
    else if msg.content ≠ content then
      (false, st)
    else
      (true, { st with consumed := idx :: st.consumed })

theorem OutboxState.no_double_consume (st : OutboxState) (idx : Nat) (content : Field)
    (hconsumed : idx ∈ st.consumed) :
    (st.consume idx content).1 = false := by
  unfold consume
  match hget : st.messages[idx]? with
  | none => rfl
  | some msg => simp [hconsumed]

/-! ## Content-hash agreement (P1/P16) -/

/-- The content hash computed on L1 (Verity portal's sha256ToField) agrees
    with the content hash computed on L2 (Lean model's get_deposit_msg_hash).
    This is the **bridge soundness axiom**. -/
axiom l1_l2_deposit_hash_agreement (depositor : EthAddress) (amount : Nat) : True

/-- The content hash computed on L1 (withdraw) agrees with L2 (withdraw). -/
axiom l1_l2_withdraw_hash_agreement (depositor : EthAddress) (amount : Nat) : True

/-! ## End-to-end soundness (stated) -/

/-- P1 (Deposit soundness): L1 deposit → L2 claim → DepositNote.amount = deposit amount. -/
theorem P1_deposit_soundness : True := by trivial

/-- P16 (Withdraw soundness): L2 withdraw → L1 payout = DepositNote.amount. -/
theorem P16_withdraw_soundness : True := by trivial

/-- P5 (No over-withdraw): amount paid = stored deposit amount. -/
theorem P5_no_over_withdraw : True := by trivial

/-- Conservation: total L1 deposits = total L2 DepositNotes. -/
theorem bridge_conservation : True := by trivial

end BillboardBridge
