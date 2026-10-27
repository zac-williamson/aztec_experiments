// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PortalMessages} from "../src/PortalMessages.sol";
import {PortalFixtures} from "./PortalArtifactRegression.t.sol";
import {RootPublisher} from "./PortalV1.t.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
interface VmV2Refund { function expectRevert() external; }
/// Canonical Inbox/Outbox with TEST-ONLY root publication; L2 decision-nullifier
/// races must additionally be covered by native Aztec tests.
contract PortalV2RefundTest is PortalFixtures {
    VmV2Refund constant control=VmV2Refund(address(uint160(uint256(keccak256("hevm cheat code")))));
    BillboardPortal portal; RootPublisher rollup;
    bytes32 constant OLD=bytes32(uint256(123)); bytes32 constant FRESH=bytes32(uint256(124));
    function setUp() public {
        rollup=new RootPublisher(VERSION);
        portal=new BillboardPortal(address(rollup),L2,VERSION,1 ether,3 ether,bytes32(uint256(7)), address(this));
        portal.activate(); vm.deal(ALICE,20 ether); vm.deal(BOB,20 ether);
    }
    function envelope(bytes32 content) private view returns(bytes32) {
        return Hash.sha256ToField(DataStructures.L2ToL1Msg(DataStructures.L2Actor(L2,VERSION),DataStructures.L1Actor(address(portal),block.chainid),content));
    }
    function content(bytes32 domain,address owner,uint128 amount,bytes32 id) private view returns(bytes32) {
        return PortalMessages.depositExit(domain,block.chainid,address(portal),L2,VERSION,owner,amount,id);
    }
    function put(address owner,bytes32 id) private {vm.prank(owner);portal.deposit{value:2 ether}(id);}
    function request(address owner,bytes32 id) private {vm.prank(owner);portal.requestRefund(id);}
    function acknowledge(uint256 epoch,bytes32 domain,address owner,uint128 amount,bytes32 id) private {
        rollup.publish(epoch,1,envelope(content(domain,owner,amount,id)));
    }
    function finish(address owner,bytes32 id,uint256 epoch) private {portal.refund(owner,id,epoch,1,0,new bytes32[](0));}
    function testDeploymentOperatorCannotRefundWithoutCanonicalAcknowledgement() public {
        put(ALICE,OLD);request(ALICE,OLD);
        control.expectRevert();finish(ALICE,OLD,2);
        require(portal.getDeposit(ALICE,OLD).amount==2 ether && portal.totalDeposited()==2 ether,"Operator bypassed refund proof");
        require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Failed refund consumed proof");
    }
    function testFreshSignupWhileOldRefundPendingAndRefundPaysSameOwner() public {
        put(ALICE,OLD);request(ALICE,OLD);
        BillboardPortal.Deposit memory old=portal.getDeposit(ALICE,OLD);
        require(old.refundRequested && old.refundBlock==block.number,"Refund request metadata missing");
        put(ALICE,FRESH);
        require(portal.getDeposit(ALICE,OLD).amount==2 ether && portal.getDeposit(ALICE,FRESH).amount==2 ether,"Fresh signup replaced old deposit");
        require(portal.totalDeposited()==4 ether && portal.latestDeposit(ALICE)==FRESH,"Liabilities lost");
        uint256 beforeOwner=ALICE.balance;uint256 beforeCaller=BOB.balance;
        acknowledge(2,"AZTEC_BB_REFUND_V2",ALICE,2 ether,OLD);
        vm.prank(BOB);portal.refund(ALICE,OLD,2,1,0,new bytes32[](0));
        require(ALICE.balance==beforeOwner+2 ether && BOB.balance==beforeCaller,"Refund recipient changed");
        require(portal.getDeposit(ALICE,OLD).amount==0 && portal.getDeposit(ALICE,OLD).secretHash==OLD,"Spent tombstone lost");
        require(portal.getDeposit(ALICE,FRESH).amount==2 ether && portal.totalDeposited()==2 ether,"Refund touched fresh signup");
        control.expectRevert();finish(ALICE,OLD,2);
        control.expectRevert();put(ALICE,OLD);
        require(rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Refund acknowledgement not consumed");
    }
    function testRefundRequestCanonicalInboxAndOwnerOnlyNoTimeShortcut() public {
        put(ALICE,OLD);
        control.expectRevert();vm.prank(BOB);portal.requestRefund(OLD);
        vm.prank(ALICE);(bytes32 key,uint256 index)=portal.requestRefund(OLD);
        DataStructures.L1ToL2Msg memory m=DataStructures.L1ToL2Msg({sender:DataStructures.L1Actor(address(portal),block.chainid),recipient:DataStructures.L2Actor(L2,VERSION),content:content("AZTEC_BB_CANCEL_V2",ALICE,2 ether,OLD),secretHash:portal.REFUND_MESSAGE_SECRET_HASH(),index:index});
        require(key==Hash.sha256ToField(m),"Cancellation message scope differs");
        control.expectRevert();request(ALICE,OLD);
        control.expectRevert();finish(ALICE,OLD,2);
        require(portal.getDeposit(ALICE,OLD).amount==2 ether && portal.totalDeposited()==2 ether,"Unacknowledged refund escaped");
    }
    function testRefundExactIdAmountOwnerAndDomainCannotReplayAcrossDeposits() public {
        put(ALICE,OLD);put(ALICE,FRESH);put(BOB,OLD);request(ALICE,OLD);request(ALICE,FRESH);request(BOB,OLD);
        bytes32[4] memory bad=[content("AZTEC_BB_REFUND_V2",ALICE,2 ether,FRESH),content("AZTEC_BB_REFUND_V2",ALICE,1 ether,OLD),content("AZTEC_BB_REFUND_V2",BOB,2 ether,OLD),content("AZTEC_BB_EXIT_V2",ALICE,2 ether,OLD)];
        for(uint256 i;i<bad.length;i++) {
            rollup.publish(2,1,envelope(bad[i]));control.expectRevert();finish(ALICE,OLD,2);
            require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Rejected proof consumed");
            require(portal.totalDeposited()==6 ether && portal.getDeposit(ALICE,OLD).amount==2 ether,"Rejected proof changed liabilities");
        }
        acknowledge(2,"AZTEC_BB_REFUND_V2",ALICE,2 ether,OLD);finish(ALICE,OLD,2);
        control.expectRevert();finish(ALICE,FRESH,2);control.expectRevert();finish(BOB,OLD,2);
        require(portal.totalDeposited()==4 ether,"Acknowledgement replay changed liability");
    }
    function testNormalWithdrawalAfterRefundRequestWinsWithoutDoublePayment() public {
        put(ALICE,OLD);request(ALICE,OLD);acknowledge(2,"AZTEC_BB_EXIT_V2",ALICE,2 ether,OLD);
        uint256 beforeOwner=ALICE.balance;vm.prank(ALICE);portal.withdraw(OLD,2,1,0,new bytes32[](0));
        require(ALICE.balance==beforeOwner+2 ether && portal.totalDeposited()==0,"Exit after cancellation request failed");
        acknowledge(3,"AZTEC_BB_REFUND_V2",ALICE,2 ether,OLD);control.expectRevert();finish(ALICE,OLD,3);
        require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(3),1),"Spent deposit consumed refund proof");
    }
    function testDepositHistoryPaginationRetainsOldIdAfterFreshSignupAndRefund() public {
        put(ALICE,OLD);request(ALICE,OLD);put(ALICE,FRESH);put(BOB,OLD);
        acknowledge(2,"AZTEC_BB_REFUND_V2",ALICE,2 ether,OLD);finish(ALICE,OLD,2);
        bytes32[] memory first=portal.getDepositIds(ALICE,0,1);bytes32[] memory second=portal.getDepositIds(ALICE,1,100);
        require(first.length==1 && first[0]==OLD && second.length==1 && second[0]==FRESH,"History pagination lost deposits");
        require(portal.getDepositIds(ALICE,2,100).length==0 && portal.getDepositIds(ALICE,type(uint256).max,1).length==0,"Past-end page invalid");
        require(portal.getDepositIds(BOB,0,100).length==1 && portal.getDepositIds(address(9),0,1).length==0,"Owner history mixed");
        control.expectRevert();portal.getDepositIds(ALICE,0,0);control.expectRevert();portal.getDepositIds(ALICE,0,101);
    }
}
