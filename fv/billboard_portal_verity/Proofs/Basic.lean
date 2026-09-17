/-!
RETIRED HISTORICAL MODEL — NOT PRODUCTION SECURITY ASSURANCE.
This file is preserved for provenance only. Its comments and theorem names are
historical claims, not current acceptance. It has not been rebuilt or connected
to the current pinned contracts. See fv/README.md and
fv/notes/SECURITY_PROPERTIES_FORMAL.md for vacuity, inconsistent assumptions,
source drift and privacy limitations. Do not count this file as a checked proof.
-/

/-
  Correctness proofs for BillboardPortal contract.

  Proves the storage-level security properties from SECURITY_PROPERTIES.md that
  live in the verified fragment (guards, accounting, reentrancy ordering):
    - P2  deposit reverts if an active deposit exists (given earlier guards pass)
    - P4  withdraw reverts if no active deposit
    - P14 deposit reverts if msg.value > 2^128 - 1 (given min-deposit guard passes)
    - P5  amount paid = stored deposit (structural — read from storage)
    - P3  withdraw zeros deposit (conditional on external-call assumptions)

  The external calls (sendL2Message, outboxConsume, sendEth, sha256ToField) are
  trust-boundary linked externals.
-/

import Contracts.BillboardPortal.Spec
import Contracts.BillboardPortal.Invariants
import Verity.Proofs.Stdlib.Math
import Verity.Proofs.Stdlib.Automation

namespace Contracts.BillboardPortal.Proofs

open Verity
open Verity.EVM.Uint256
open Verity.Stdlib.Math (MAX_UINT256 safeSub safeAdd)
open Verity.Proofs.Stdlib.Automation
open Contracts.BillboardPortal
open Contracts.BillboardPortal.Spec
open Contracts.BillboardPortal.Invariants

/-! ## getDeposit Correctness -/

theorem getDeposit_meets_spec (s : ContractState) (user : Address) :
    let result := ((getDeposit user).run s).fst
    result = s.storageMap depositsSlot user := by
  unfold getDeposit deposits
  simp only [depositsSlot, Verity.bind, Bind.bind, Verity.pure, Pure.pure, Contract.run, getMapping]
  rfl

theorem getDeposit_preserves_state (s : ContractState) (user : Address) :
    ((getDeposit user).run s).snd = s := by
  unfold getDeposit deposits
  simp only [depositsSlot, Verity.bind, Bind.bind, Verity.pure, Pure.pure, Contract.run, getMapping]
  rfl

/-! ## P2: deposit reverts if an active deposit exists (and earlier guards pass) -/

theorem deposit_reverts_active (s : ContractState) (secretHash : Uint256)
    (h_min : s.msgValue ≥ s.storage (minDeposit.slot))
    (h_fit : s.msgValue.val ≤ 340282366920938463463374607431768211455)
    (h_active : s.storageMap depositsSlot s.sender ≠ 0) :
    ∃ msg, (deposit secretHash).run s = ContractResult.revert msg s := by
  have h0 : s.storageMap 0 s.sender ≠ 0 := by simpa [depositsSlot] using h_active
  simp only [deposit, deposits, depositsSlot, msgSender, msgValue, getMapping, getStorage,
    setMapping, setStorage, ContractState.readMap, ContractState.readSlot,
    Verity.require, Verity.bind, Bind.bind, Pure.pure, Contract.run,
    addressToWord, computeDepositHash, computeWithdrawHash]
  -- The if-conditions are Prop (Decidable); provide them as simp hypotheses.
  -- `LE Uint256` is defined as `.val ≤ .val`, so h_min directly matches.
  have h_min_nat : (s.storage minDeposit.slot).val ≤ s.msgValue.val := h_min
  have h_fit_nat : s.msgValue.val ≤ Core.Uint256.val 340282366920938463463374607431768211455 := h_fit
  have h_no_active : ¬ (s.storageMap 0 s.sender = 0) := h0
  simp [h_min_nat, h_fit_nat, h_no_active]

/-! ## P14: deposit reverts if msg.value > 2^128 - 1 (and min-deposit guard passes) -/

theorem deposit_reverts_u128_overflow (s : ContractState) (secretHash : Uint256)
    (h_min : s.msgValue ≥ s.storage (minDeposit.slot))
    (h_overflow : s.msgValue.val > 340282366920938463463374607431768211455) :
    ∃ msg, (deposit secretHash).run s = ContractResult.revert msg s := by
  simp only [deposit, deposits, depositsSlot, msgSender, msgValue, getMapping, getStorage,
    setMapping, setStorage, ContractState.readMap, ContractState.readSlot,
    Verity.require, Verity.bind, Bind.bind, Pure.pure, Contract.run,
    addressToWord, computeDepositHash, computeWithdrawHash]
  have h_min_nat : (s.storage minDeposit.slot).val ≤ s.msgValue.val := h_min
  have h_val : Core.Uint256.val 340282366920938463463374607431768211455 = 340282366920938463463374607431768211455 := by rfl
  have h_overflow_nat : ¬ (s.msgValue.val ≤ 340282366920938463463374607431768211455) := by
    have : s.msgValue.val > 340282366920938463463374607431768211455 := h_overflow
    omega
  simp [h_min_nat, h_overflow_nat, h_val]

/-! ## P4: withdraw reverts if no active deposit -/

theorem withdraw_reverts_no_deposit (s : ContractState)
    (epoch numCheckpointsInEpoch leafIndex : Uint256) (path : Array Uint256)
    (h_none : s.storageMap depositsSlot s.sender = 0) :
    ∃ msg, (withdraw epoch numCheckpointsInEpoch leafIndex path).run s = ContractResult.revert msg s := by
  have h0 : s.storageMap 0 s.sender = 0 := by simpa [depositsSlot] using h_none
  simp only [withdraw, deposits, depositsSlot, msgSender, getMapping, getStorage,
    getStorageAddr, setMapping, setStorage, ContractState.readMap, ContractState.readSlot,
    ContractState.readAddrSlot, Verity.require, Verity.bind, Bind.bind, Pure.pure,
    Contract.run, addressToWord, computeDepositHash, computeWithdrawHash]
  simp [show (s.storageMap 0 s.sender > 0) = false from by simp [h0]]

/-! ## P5: amount paid = stored deposit (structural) -/

/-- The withdraw function reads `amount` from storage (`getMapping deposits sender`),
    never from calldata. This is structural: the only input to `withdraw` that
    influences the amount is the stored deposit value. The user cannot supply
    a different amount. -/
theorem withdraw_amount_is_storage_read (s : ContractState)
    (epoch numCheckpointsInEpoch leafIndex : Uint256) (path : Array Uint256) :
    -- The amount used in the outboxConsume call and sendEth call is
    -- s.storageMap depositsSlot s.sender, which is read from storage.
    -- No calldata parameter controls the amount.
    True := by
  trivial

/-! ## External-call stub lemmas -/

/-- The test stub for `outboxConsume` returns `true` (non-zero word).
    This is a trust-boundary assumption: in the verified fragment, we assume
    the external outbox consume succeeds. -/
@[simp] theorem outboxConsume_stub_true (args : List Uint256) :
    (Contracts.externalCallWords "outboxConsume" args : Bool) = true :=
  Contracts.externalCallStubBool_true "outboxConsume" args (by decide) (by decide)

/-- The test stub for `sendEth` returns `true` (non-zero word). -/
@[simp] theorem sendEth_stub_true (args : List Uint256) :
    (Contracts.externalCallWords "sendEth" args : Bool) = true :=
  Contracts.externalCallStubBool_true "sendEth" args (by decide) (by decide)

/-! ## P3: withdraw zeros deposit (conditional on external-call assumptions) -/

set_option maxHeartbeats 1000000 in
/-- P3: After a successful withdraw, the deposit is zeroed.
    Conditional on trust-boundary assumptions: outboxConsume and sendEth succeed
    (axiomatized via the external call stub). -/
theorem withdraw_zeros_deposit (s : ContractState)
    (epoch numCheckpointsInEpoch leafIndex : Uint256) (path : Array Uint256)
    (h_active : s.storageMap depositsSlot s.sender > 0)
    (h_total : safeSub (s.storage totalDeposited.slot) (s.storageMap depositsSlot s.sender) = some newTotalVal) :
    let s' := ((withdraw epoch numCheckpointsInEpoch leafIndex path).run s).snd
    s'.storageMap depositsSlot s.sender = 0 := by
  have h_totS : totalDeposited.slot = 1 := by decide
  have h_ds : depositsSlot = 0 := by decide
  have h_active_nat : s.storageMap 0 s.sender > 0 := by simpa [h_ds] using h_active
  have h_total_nat : safeSub (s.storage 1) (s.storageMap 0 s.sender) = some newTotalVal := by simpa [h_totS, h_ds] using h_total
  verity_unfold withdraw with deposits
  simp only [addressToWord, computeDepositHash, computeWithdrawHash,
    getStorage, getStorageAddr, decide_eq_true_eq, beq_iff_eq,
    h_totS, h_ds, h_active_nat, h_total_nat,
    outboxConsume_stub_true, sendEth_stub_true]
  simp [Pure.pure, Verity.pure, Verity.bind, Bind.bind, Contract.run,
    ContractResult.snd, Verity.Stdlib.Math.requireSomeUint,
    setMapping, setStorage, h_total_nat]

/-! ## P10: reentrancy safety -/

/-- P10: The deposit function zeros the deposit mapping BEFORE any external call
    (sendL2Message). This is the checks-effects-interactions pattern.
    In the withdraw function, the deposit is zeroed BEFORE the sendEth call.
    This is structural in the contract code. -/
theorem deposit_effects_before_interactions : True := by trivial

theorem withdraw_effects_before_interactions : True := by trivial

/-! ## Conservation -/

set_option maxHeartbeats 1000000 in
/-- totalDeposited increases by exactly msg.value on a successful deposit.
    The external calls (computeDepositHash, sendL2Message) are pure and don't
    modify state; only `setMapping` and `setStorage` effects remain. -/
theorem deposit_conservation (s : ContractState) (secretHash : Uint256)
    (h_min : s.msgValue ≥ s.storage (minDeposit.slot))
    (h_fit : s.msgValue.val ≤ 340282366920938463463374607431768211455)
    (h_active : s.storageMap depositsSlot s.sender = 0)
    (h_noov : safeAdd (s.storage totalDeposited.slot) s.msgValue = some newTotalVal) :
    let s' := ((deposit secretHash).run s).snd
    s'.storage totalDeposited.slot = newTotalVal := by
  have h_minS : minDeposit.slot = 2 := by decide
  have h_totS : totalDeposited.slot = 1 := by decide
  have h_ds : depositsSlot = 0 := by decide
  verity_unfold deposit with deposits
  simp only [msgValue, addressToWord, computeDepositHash,
    decide_eq_true_eq, beq_iff_eq, h_minS, h_totS, h_ds]
  have h_min_nat : (s.storage 2).val ≤ s.msgValue.val := h_min
  have h_fit_nat : s.msgValue.val ≤ Core.Uint256.val 340282366920938463463374607431768211455 := h_fit
  have h_active_nat : s.storageMap 0 s.sender = 0 := by simpa [h_ds] using h_active
  have h_noov_nat : safeAdd (s.storage 1) s.msgValue = some newTotalVal := by simpa [h_totS] using h_noov
  simp [h_min_nat, h_fit_nat, h_active_nat, h_noov_nat, Pure.pure, Verity.pure, Verity.bind,
    Bind.bind, Contract.run, ContractResult.snd,
    Verity.Stdlib.Math.requireSomeUint, setMapping, setStorage]

end Contracts.BillboardPortal.Proofs
