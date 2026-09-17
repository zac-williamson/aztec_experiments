/-!
RETIRED HISTORICAL MODEL — NOT PRODUCTION SECURITY ASSURANCE.
This file is preserved for provenance only. Its comments and theorem names are
historical claims, not current acceptance. It has not been rebuilt or connected
to the current pinned contracts. See fv/README.md and
fv/notes/SECURITY_PROPERTIES_FORMAL.md for vacuity, inconsistent assumptions,
source drift and privacy limitations. Do not count this file as a checked proof.
-/

/-
  State invariants for BillboardPortal.
-/

import Verity.Specs.Common
import Verity.Specs.Common.Sum
import Contracts.BillboardPortal.BillboardPortal

namespace Contracts.BillboardPortal.Invariants

open Verity
open Verity.EVM.Uint256
open Verity.Specs.Common (sumBalances)
open Contracts.BillboardPortal

/-! ## Well-formedness -/

/-- Well-formed state: non-zero sender and contract address. -/
structure WellFormedState (s : ContractState) : Prop where
  sender_nonzero : s.sender ≠ 0
  contract_nonzero : s.thisAddress ≠ 0

/-! ## Conservation invariant -/

/-- The total deposited equals the sum of all deposit entries. This is the
conservation invariant behind P5/P3. Uses the `sumBalances` helper from
`Verity.Specs.Common.Sum`, which sums over the `knownAddresses` set tracked
automatically by the EVM model. -/
def total_matches_deposits (s : ContractState) : Prop :=
  s.storage 1 = sumBalances 0 (s.knownAddresses 0) s.storageMap

/-- A state is conserved if `total_matches_deposits` holds. -/
structure ConservedState (s : ContractState) : Prop where
  conserved : total_matches_deposits s

/-! ## Frame predicates -/

abbrev non_mapping_storage_unchanged (s s' : ContractState) :=
  Specs.sameStorage s s' ∧ Specs.sameStorageAddr s s' ∧ Specs.sameStorageArray s s'

abbrev context_preserved := Specs.sameContext

end Contracts.BillboardPortal.Invariants
