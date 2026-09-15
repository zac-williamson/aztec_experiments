// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;

import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PortalFixtures} from "./PortalArtifactRegression.t.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

/// Deliberately adversarial dependency. No message or proof authentication is
/// claimed: canonical Outbox verification is tested separately in PortalV1.
contract CallbackBridge {
    BillboardPortal public portal;
    bool public attack;
    bool public reject;
    address public watchedOwner;
    uint256 public expectedTotal;
    uint128 public expectedAmount;
    uint64 public expectedNonce;
    uint256 public calls;
    uint256 public guardedCallbacks;

    function configure(BillboardPortal target, bool callbacks, bool fail,
        address owner, uint64 nonce, uint128 amount, uint256 total) external {
        portal = target; attack = callbacks; reject = fail;
        watchedOwner = owner; expectedNonce = nonce; expectedAmount = amount; expectedTotal = total;
    }

    function callback() private {
        calls++;
        (uint64 nonce, uint128 amount) = portal.getDeposit(watchedOwner);
        require(nonce == expectedNonce && amount == expectedAmount, "Wrong receipt at dependency boundary");
        require(portal.totalDeposited() == expectedTotal, "Wrong liability at dependency boundary");
        if (attack) {
            checkGuard(abi.encodeCall(portal.activate, (1, 1, 0, new bytes32[](0))), 0);
            checkGuard(abi.encodeCall(portal.deposit, (bytes32(uint256(123)))), 1 ether);
            checkGuard(abi.encodeCall(portal.withdraw, (1, 1, 0, new bytes32[](0))), 0);
        }
        require(!reject, "Dependency rejected after callbacks");
    }

    function checkGuard(bytes memory payload, uint256 value) private {
        (bool ok, bytes memory reason) = address(portal).call{value:value}(payload);
        require(!ok, "Reentrant call unexpectedly succeeded");
        require(keccak256(reason) == keccak256(abi.encodeWithSignature("ReentrancyGuardReentrantCall()")),
            "Failure was not the reentrancy guard");
        guardedCallbacks++;
    }

    function sendL2Message(DataStructures.L2Actor calldata, bytes32, bytes32)
        external returns (bytes32, uint256) {
        callback(); return (bytes32(uint256(123)), calls);
    }
    function consume(DataStructures.L2ToL1Msg calldata, Epoch, uint256, uint256, bytes32[] calldata) external {
        callback();
    }
}

contract CallbackRollup {
    CallbackBridge public immutable inbox = new CallbackBridge();
    CallbackBridge public immutable outbox = new CallbackBridge();
    function getInbox() external view returns (IInbox) { return IInbox(address(inbox)); }
    function getOutbox() external view returns (IOutbox) { return IOutbox(address(outbox)); }
}

contract PortalReentrancyTest is PortalFixtures {
    BillboardPortal private portal;
    CallbackBridge private inbox;
    CallbackBridge private outbox;

    function setUp() public {
        CallbackRollup rollup = new CallbackRollup();
        inbox = rollup.inbox(); outbox = rollup.outbox();
        portal = new BillboardPortal(address(rollup), L2, VERSION, 1 ether, 3 ether, bytes32(uint256(123)));
        vm.deal(address(inbox), 10 ether); vm.deal(address(outbox), 10 ether);
        configure(outbox, false, false, 0, 0, 0);
    }
    function configure(CallbackBridge bridge, bool attack, bool reject, uint64 nonce, uint128 amount, uint256 total) private {
        bridge.configure(portal, attack, reject, ALICE, nonce, amount, total);
    }
    function activate() private { portal.activate(1, 1, 0, new bytes32[](0)); }
    function prepareDeposit() private {
        activate(); configure(inbox, false, false, 1, 2 ether, 2 ether);
        depositAs(portal, ALICE, 2 ether);
    }
    function assertAccounting(uint64 nonce, uint128 amount, uint256 total, uint256 balance) private view {
        (uint64 actualNonce, uint128 actualAmount) = portal.getDeposit(ALICE);
        require(actualNonce == nonce && actualAmount == amount, "Wrong final receipt");
        require(portal.totalDeposited() == total && address(portal).balance == balance, "Wrong final accounting");
    }
    function expectDependencyFailure() private {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Dependency rejected after callbacks"));
    }

    function testOutboxActivationRejectsAllReentrantEntrypoints() public {
        configure(outbox, true, false, 0, 0, 0); activate();
        require(portal.depositsEnabled(), "Activation failed");
        require(outbox.calls() == 1 && outbox.guardedCallbacks() == 3, "Missing activation callbacks");
        assertAccounting(0, 0, 0, 0);
        require(address(outbox).balance == 10 ether, "Callback payment retained");
    }
    function testInboxDepositRejectsAllReentrantEntrypointsAfterEffects() public {
        activate(); configure(inbox, true, false, 1, 2 ether, 2 ether);
        depositAs(portal, ALICE, 2 ether);
        require(inbox.calls() == 1 && inbox.guardedCallbacks() == 3, "Missing deposit callbacks");
        assertAccounting(1, 2 ether, 2 ether, 2 ether);
        require(portal.lastDepositNonce(ALICE) == 1, "Extra deposit nonce");
        require(address(inbox).balance == 10 ether, "Callback payment retained");
    }
    function testOutboxWithdrawalRejectsAllReentrantEntrypointsAfterReceiptCleared() public {
        prepareDeposit(); configure(outbox, true, false, 0, 0, 0);
        withdrawAs(portal, ALICE);
        require(outbox.calls() == 2 && outbox.guardedCallbacks() == 3, "Missing withdrawal callbacks");
        assertAccounting(0, 0, 0, 0);
        require(ALICE.balance == 2 ether && portal.lastDepositNonce(ALICE) == 1, "Refund or nonce incorrect");
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "No active deposit"));
        withdrawAs(portal, ALICE);
        require(outbox.calls() == 2, "Repeated withdrawal reached dependency");
    }
    function testRejectingOutboxRollsBackActivationAndCanRetry() public {
        configure(outbox, true, true, 0, 0, 0);
        expectDependencyFailure(); activate();
        require(!portal.depositsEnabled() && outbox.calls() == 0 && outbox.guardedCallbacks() == 0, "Activation effects retained");
        assertAccounting(0, 0, 0, 0);
        configure(outbox, true, false, 0, 0, 0); activate();
        require(portal.depositsEnabled() && outbox.calls() == 1, "Activation retry failed");
    }
    function testRejectingInboxRollsBackReceiptNonceValueAndCanRetry() public {
        activate(); configure(inbox, true, true, 1, 2 ether, 2 ether);
        vm.deal(ALICE, 2 ether);
        expectDependencyFailure(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
        assertAccounting(0, 0, 0, 0);
        require(portal.lastDepositNonce(ALICE) == 0 && ALICE.balance == 2 ether, "Rejected deposit retained nonce/value");
        require(inbox.calls() == 0 && inbox.guardedCallbacks() == 0, "Rejected Inbox effects retained");
        configure(inbox, true, false, 1, 2 ether, 2 ether); depositAs(portal, ALICE, 2 ether);
        assertAccounting(1, 2 ether, 2 ether, 2 ether);
    }
    function testRejectingOutboxRollsBackWithdrawalAndCanRetry() public {
        prepareDeposit(); configure(outbox, true, true, 0, 0, 0);
        expectDependencyFailure(); withdrawAs(portal, ALICE);
        assertAccounting(1, 2 ether, 2 ether, 2 ether);
        require(ALICE.balance == 0 && portal.lastDepositNonce(ALICE) == 1, "Rejected withdrawal changed balance/nonce");
        require(outbox.calls() == 1 && outbox.guardedCallbacks() == 0, "Rejected consume retained effects");
        configure(outbox, true, false, 0, 0, 0); withdrawAs(portal, ALICE);
        assertAccounting(0, 0, 0, 0);
        require(ALICE.balance == 2 ether && outbox.calls() == 2, "Withdrawal retry failed");
    }
}
