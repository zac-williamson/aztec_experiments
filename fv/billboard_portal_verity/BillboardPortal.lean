/-!
RETIRED HISTORICAL MODEL — NOT PRODUCTION SECURITY ASSURANCE.
This file is preserved for provenance only. Its comments and theorem names are
historical claims, not current acceptance. It has not been rebuilt or connected
to the current pinned contracts. See fv/README.md and
fv/notes/SECURITY_PROPERTIES_FORMAL.md for vacuity, inconsistent assumptions,
source drift and privacy limitations. Do not count this file as a checked proof.
-/

import Contracts.Common

namespace Contracts

open Verity hiding pure bind
open Verity.EVM.Uint256
open Verity.Stdlib.Math

/-!
# BillboardPortal — Verity port of the L1 portal

This is a `verity_contract` port of `billboard/portal/src/BillboardPortal.sol`.

The Aztec message-bridge calls (`INBOX.sendL2Message`, `IOutbox.consume`) and
the ETH transfer (`msg.sender.call{value: amount}("")`) are modeled as
`linked_externals` (trust boundary in Verity today). The content-hash
computation is modeled as a deterministic linked external `sha256ToField` whose
*agreement* with the L2 Lean model's hash is proved in
`bridge_model/Bridge.lean`.

What is provable inside the verified fragment here:
  - P2  deposit reverts if `deposits[msg.sender] != 0`
  - P3  withdraw sets `deposits[msg.sender] = 0` and decrements `totalDeposited`
  - P4  withdraw reverts if `deposits[msg.sender] == 0`
  - P5  amount paid equals the stored deposit (not user-supplied)
  - P10 reentrancy safety: deposit zeroed before the external ETH send
  - P14 deposit reverts if `msg.value > type(uint128).max`
  - Conservation of `totalDeposited` across deposit/withdraw
-/

verity_contract BillboardPortal where
  storage
    -- deposits per user: depositor => amount. Non-zero means active deposit.
    deposits : Address → Uint256 := slot 0
    -- total ETH deposited (accounting only; not security-relevant)
    totalDeposited : Uint256 := slot 1
    -- constructor-set config (kept in storage to stay in the verified fragment;
    -- Solidity uses immutables, which are a trust boundary for external-call
    -- arg elaboration in the current Verity macro)
    minDeposit : Uint256 := slot 2
    l2Contract : Uint256 := slot 3
    rollup     : Address := slot 4
    inbox      : Address := slot 5
    version    : Uint256 := slot 6

  event_defs
    event Deposited(@indexed depositor : Address, amount : Uint256, secretHash : Bytes32, key : Bytes32, index : Uint256)
    event Withdrawn(@indexed depositor : Address, amount : Uint256)

  linked_externals
    -- Aztec Inbox: send an L1->L2 message. Returns the message key.
    external sendL2Message(Address, Uint256, Uint256, Uint256, Uint256) -> (Uint256)
    -- Aztec Outbox: consume an L2->L1 message. Returns a success flag
    -- (reverts on the EVM side if missing/already consumed; we model the
    -- revert as success=false here so the Verity proof can branch on it).
    external outboxConsume(Address, Bytes32, Uint256, Uint256, Uint256, Uint256, Uint256, Array Bytes32) -> (Bool)
    -- sha256ToField: deterministic hash of the canonical word list to a single
    -- EVM word. Axiomatized primitive; agreement with L2's hash is a bridge
    -- theorem (`bridge_model/Bridge.lean`).
    external sha256ToField(Uint256, Uint256) -> (Uint256)
    -- ETH send via low-level call. Returns ok flag. Trust boundary.
    external sendEth(Address, Uint256) -> (Bool)

  -- The constructor takes the rollup, l2 contract, version, min deposit, inbox.
  -- (In Solidity, INBOX is read from IRollup(_rollup).getInbox(); we accept it
  -- as an explicit constructor arg here to keep the call graph visible.)
  constructor (rollupArg : Address, l2ContractArg : Bytes32, versionArg : Uint256, minDepositArg : Uint256, inboxArg : Address) := do
    setStorageAddr rollup rollupArg
    setStorage l2Contract l2ContractArg
    setStorage version versionArg
    setStorage minDeposit minDepositArg
    setStorageAddr inbox inboxArg

  -- Internal helpers: force the externalCall return type to Uint256 by
  -- returning from a typed function. This avoids the polymorphic-type metavariable
  -- issue when chaining externalCall results as externalCall arguments.
  function internal computeDepositHash (depositorWord : Uint256, amount : Uint256) : Uint256 := do
    return externalCall "sha256ToField" [depositorWord, amount]

  function internal computeWithdrawHash (depositorWord : Uint256, amount : Uint256) : Uint256 := do
    return externalCall "sha256ToField" [depositorWord, amount]

  -- deposit: payable, records the deposit and sends the L1->L2 message.
  function payable deposit (secretHash : Uint256) : Uint256 := do
    let sender ← msgSender
    let value ← msgValue
    let minDep ← getStorage minDeposit
    require (value >= minDep) "Below min deposit"
    require (value <= 340282366920938463463374607431768211455) "Amount too large"
    let current ← getMapping deposits sender
    require (current == 0) "Already have an active deposit"
    let prevTotal ← getStorage totalDeposited
    let newTotal ← requireSomeUint (safeAdd prevTotal value) "Total overflow"
    setMapping deposits sender value
    setStorage totalDeposited newTotal
    -- contentHash = sha256ToField(abi.encodeWithSignature("claim_deposit(bytes32,uint256)", depositor, amount))
    let depositorWord := addressToWord sender
    let contentHash ← computeDepositHash depositorWord value
    let inb ← getStorageAddr inbox
    let l2c ← getStorage l2Contract
    let ver ← getStorage version
    let key := externalCall "sendL2Message" [inb, l2c, ver, contentHash, secretHash]
    return key

  -- withdraw: reads amount from storage, consumes the Outbox leaf, pays ETH.
  -- `_path` is the Merkle sibling path (trust-boundary input to outbox.consume).
  function allow_post_interaction_writes reentrancy_trusted withdraw
      (epoch : Uint256, numCheckpointsInEpoch : Uint256, leafIndex : Uint256, path : Array Uint256) : Unit := do
    let sender ← msgSender
    let amount ← getMapping deposits sender
    require (amount > 0) "No active deposit"
    -- content = sha256ToField(abi.encodePacked(bytes32(uint256(uint160(msg.sender))), amount))
    let depositorWord := addressToWord sender
    let contentHash ← computeWithdrawHash depositorWord amount
    let rol ← getStorageAddr rollup
    let l2c ← getStorage l2Contract
    let ver ← getStorage version
    let ok := externalCall "outboxConsume" [rol, l2c, ver, epoch, numCheckpointsInEpoch, leafIndex, contentHash, path]
    require ok "Outbox consume failed"
    -- effects (checks-effects-interactions: zero the deposit BEFORE the ETH send)
    setMapping deposits sender 0
    let prevTotal ← getStorage totalDeposited
    let newTotal ← requireSomeUint (safeSub prevTotal amount) "Total underflow"
    setStorage totalDeposited newTotal
    -- interaction
    let sentOk := externalCall "sendEth" [sender, amount]
    require sentOk "ETH transfer failed"

  function view getDeposit (user : Address) : Uint256 := do
    let amt ← getMapping deposits user
    return amt

end Contracts
