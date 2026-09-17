/-!
RETIRED HISTORICAL MODEL — NOT PRODUCTION SECURITY ASSURANCE.
This file is preserved for provenance only. Its comments and theorem names are
historical claims, not current acceptance. It has not been rebuilt or connected
to the current pinned contracts. See fv/README.md and
fv/notes/SECURITY_PROPERTIES_FORMAL.md for vacuity, inconsistent assumptions,
source drift and privacy limitations. Do not count this file as a checked proof.
-/

/-
  Formal specifications for BillboardPortal operations.

  These are the `Prop`-valued specs the proofs run against. The portal's
  external calls (sendL2Message, outboxConsume, sendEth, sha256ToField) are
  trust-boundary linked externals; the specs here characterize the *storage*
  effects and guard behavior, which is the provable fragment.
-/

import Verity.Specs.Common
import Verity.Macro
import Verity.EVM.Uint256
import Contracts.BillboardPortal.BillboardPortal

namespace Contracts.BillboardPortal.Spec

open Verity
open Verity.Specs
open Contracts.BillboardPortal
open Verity.EVM.Uint256

/-! ## Slot aliases -/

-- Matches the `verity_contract` storage block:
--   deposits : Address → Uint256 := slot 0
--   totalDeposited : Uint256 := slot 1
def depositsSlot : Nat := 0
def totalDepositedSlot : Nat := 1

/-! ## Guard predicates -/

/-- P2: deposit requires no active deposit for the sender. -/
def deposit_guard_no_active (s : ContractState) : Prop :=
  s.storageMap depositsSlot s.sender = 0

/-- P14: deposit requires msg.value <= 2^128 - 1. -/
def deposit_guard_amount_fits_u128 (s : ContractState) : Prop :=
  s.msgValue <= 340282366920938463463374607431768211455

/-- P4: withdraw requires an active deposit for the sender. -/
def withdraw_guard_active_deposit (s : ContractState) : Prop :=
  s.storageMap depositsSlot s.sender > 0

/-! ## deposit spec -/

/-- deposit (when guards hold): sets deposits[sender] = msg.value, bumps
totalDeposited by msg.value, leaves the rest of the mapping/storage/context
unchanged. The external calls (sha256ToField, sendL2Message) are trust
boundaries and do not affect storage. -/
def deposit_spec (secretHash : Bytes32) (s s' : ContractState) : Prop :=
  storageMapAndStorageUpdateSpec
    depositsSlot s.sender
    (fun _ => s.msgValue)
    totalDepositedSlot
    (fun st => add (st.storage totalDepositedSlot) s.msgValue)
    sameAddrMapContext
    s s'

/-! ## withdraw spec -/

/-- withdraw (when guards and the outbox consume hold): sets deposits[sender] = 0,
decrements totalDeposited by amount, where amount = deposits[sender] (read from
storage, not user-supplied — P5). -/
def withdraw_spec (epoch numCheckpointsInEpoch leafIndex : Uint256) (path : Array Bytes32)
    (s s' : ContractState) : Prop :=
  let amount := s.storageMap depositsSlot s.sender
  s'.storageMap depositsSlot s.sender = 0 ∧
  s'.storage totalDepositedSlot = sub (s.storage totalDepositedSlot) amount ∧
  storageMapUnchangedExceptKeyAtSlot depositsSlot s.sender s s' ∧
  storageUnchangedExcept totalDepositedSlot s s' ∧
  sameAddrMapContext s s'

end Contracts.BillboardPortal.Spec
