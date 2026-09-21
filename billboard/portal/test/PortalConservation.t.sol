// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;

import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PortalMessages} from "../src/PortalMessages.sol";
import {PortalFixtures} from "./PortalArtifactRegression.t.sol";
import {RootPublisher, ForceSurplus} from "./PortalV1.t.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

interface VmConservation { function expectRevert() external; }

/// Canonical Inbox/Outbox verification, with TEST-ONLY authorized root publication.
/// This exercises EVM receipt conservation; it does not prove L2 burns or epochs.
contract PortalConservationTest is PortalFixtures {
    using Hash for DataStructures.L2ToL1Msg;
    VmConservation private constant control = VmConservation(address(uint160(uint256(keccak256("hevm cheat code")))));
    BillboardPortal private portal;
    RootPublisher private rollup;
    address[3] private owners;
    uint128[3] private credited;
    uint256 private surplus;
    uint256 private nextEpoch;

    function setUp() public {
        owners = [ALICE, BOB, address(0xCA401)];
        rollup = new RootPublisher(VERSION);
        portal = new BillboardPortal(address(rollup), L2, VERSION, 1 ether, 3 ether, bytes32(uint256(123)));
        bytes32 ready = PortalMessages.ready(block.chainid, address(portal), L2, VERSION, portal.CONFIG_HASH());
        rollup.publish(1, 1, envelope(ready));
        portal.activate(1, 1, 0, new bytes32[](0));
        nextEpoch = 2;
        for (uint256 i; i < 3; ++i) vm.deal(owners[i], 100 ether);
        vm.deal(address(this), 100 ether);
        conserved();
    }

    function envelope(bytes32 content) private view returns (bytes32) {
        return DataStructures.L2ToL1Msg(DataStructures.L2Actor(L2, VERSION),
            DataStructures.L1Actor(address(portal), block.chainid), content).sha256ToField();
    }

    function rootFor(uint256 who, uint128 amount) private view returns (bytes32) {
        return envelope(PortalMessages.receipt(true, block.chainid, address(portal), L2, VERSION,
            owners[who], amount));
    }

    function conserved() private view {
        uint256 liabilities;
        for (uint256 i; i < 3; ++i) {
            uint128 amount = portal.getDeposit(owners[i]);
            require(amount == credited[i], "Receipt amount differs from independent model");
            liabilities += credited[i];
        }
        require(portal.totalDeposited() == liabilities, "Stale aggregate liabilities");
        require(address(portal).balance >= liabilities, "Escrow insolvent");
        require(address(portal).balance == liabilities + surplus, "Forced surplus was credited or lost");
    }

    function credit(uint256 who, uint128 amount) private {
        vm.prank(owners[who]); portal.deposit{value: amount}(bytes32(uint256(123)));
        credited[who] = amount;
        conserved();
    }

    function refund(uint256 who) private {
        uint256 epoch = nextEpoch++;
        uint128 amount = credited[who];
        uint256 balanceBefore = owners[who].balance;
        rollup.publish(epoch, 1, rootFor(who, amount));
        vm.prank(owners[who]); portal.withdraw(epoch, 1, 0, new bytes32[](0));
        credited[who] = 0;
        require(owners[who].balance == balanceBefore + amount, "Refund amount differs");
        require(rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(epoch), 1), "Successful exit was not consumed");
        conserved();
        // An already-consumed exit cannot reduce liabilities twice.
        control.expectRevert(); vm.prank(owners[who]); portal.withdraw(epoch, 1, 0, new bytes32[](0));
        conserved();
    }

    function invalidReceipt(uint256 who) private {
        uint256 epoch = nextEpoch++;
        // A forged amount must not consume the message or change liabilities.
        bytes32 badRoot = rootFor(who, credited[who] + 1);
        rollup.publish(epoch, 1, badRoot);
        control.expectRevert(); vm.prank(owners[who]); portal.withdraw(epoch, 1, 0, new bytes32[](0));
        require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(epoch), 1), "Failed proof consumed root");
        conserved();
    }

    function force(uint256 amount) private {
        new ForceSurplus{value: amount}(payable(address(portal)));
        surplus += amount;
        conserved();
    }

    /// forge-config: default.fuzz.runs = 32
    /// forge-config: regression.fuzz.runs = 32
    function testFuzzBoundedMultiuserConservation(uint256 seed) public {
        // Fixed work per case: three actors, 24 operations, no unbounded history.
        // Every case begins with deposits and ends with all liabilities refunded.
        for (uint256 i; i < 3; ++i) credit(i, uint128((i + 1) * 1 ether));
        for (uint256 step; step < 24; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 who = seed % 3;
            uint256 action = (seed >> 8) % 6;
            if (action == 0) {
                if (credited[who] == 0) credit(who, uint128(1 ether + (seed % (2 ether + 1))));
                else {
                    control.expectRevert(); vm.prank(owners[who]); portal.deposit{value: 1 ether}(bytes32(uint256(123)));
                }
            } else if (action == 1) {
                if (credited[who] != 0) refund(who);
                else { control.expectRevert(); vm.prank(owners[who]); portal.withdraw(nextEpoch, 1, 0, new bytes32[](0)); }
            } else if (action == 2) {
                invalidReceipt(who);
            } else if (action == 3) {
                control.expectRevert(); vm.prank(owners[who]); portal.deposit{value: 1 ether - 1}(bytes32(uint256(123)));
            } else if (action == 4) {
                force(1 + seed % 1_000_000);
            } else {
                uint256 beforeBalance = address(portal).balance;
                vm.prank(owners[who]); (bool accepted,) = address(portal).call{value: 1}("");
                require(!accepted && address(portal).balance == beforeBalance, "Unsolicited ETH accepted");
            }
            conserved();
        }
        for (uint256 i; i < 3; ++i) if (credited[i] != 0) refund(i);
        require(portal.totalDeposited() == 0, "Fully refunded liabilities remain");
        require(address(portal).balance == surplus, "Final balance should contain only forced surplus");
    }

    function testOriginalStaleAggregateRegressionAcrossRedeposit() public {
        credit(0, 1 ether); credit(1, 2 ether); force(7);
        refund(0);
        require(portal.totalDeposited() == 2 ether, "Withdrawal did not subtract aggregate");
        credit(0, 3 ether);
        require(portal.totalDeposited() == 5 ether, "Redeposit accounting reset");
        invalidReceipt(0);
        refund(1); refund(0);
        require(portal.totalDeposited() == 0 && address(portal).balance == 7, "Old aggregate bug survived complete cycle");
    }
}
