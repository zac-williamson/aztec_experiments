// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PortalMessages} from "../src/PortalMessages.sol";
import {PortalFixtures, VmPortalRegression} from "./PortalArtifactRegression.t.sol";
import {Inbox} from "@aztec/core/messagebridge/Inbox.sol";
import {Outbox} from "@aztec/core/messagebridge/Outbox.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

interface VmV1 {
    function expectRevert() external;
    function chainId(uint256 chain) external;
}

/// Controlled root publisher ONLY. Canonical bridge code verifies the roots/proofs,
/// but this harness does not verify a rollup proof or execute an L2 contract.
contract RootPublisher {
    IInbox public inbox;
    Outbox public outbox;
    constructor(uint256 version) {
        inbox = new Inbox(address(this), IERC20(address(0x1234)), version, 10, 1);
        outbox = new Outbox(address(this), version);
    }
    function getInbox() external view returns (IInbox) { return inbox; }
    function getOutbox() external view returns (IOutbox) { return outbox; }
    function publish(uint256 epoch, uint256 checkpoints, bytes32 root) external {
        outbox.insert(Epoch.wrap(epoch), checkpoints, root);
    }
    function setInbox(IInbox replacement) external { inbox = replacement; }
    function setOutbox(Outbox replacement) external { outbox = replacement; }
}
contract FailingInbox {
    bool public fail = true;
    function setFail(bool value) external { fail = value; }
    function sendL2Message(DataStructures.L2Actor calldata, bytes32, bytes32) external view returns(bytes32,uint256) {
        require(!fail, "Fixture Inbox rejected");
        return (bytes32(uint256(1)), 1);
    }
}
contract RefundReceiver {
    BillboardPortal public immutable portal;
    bool public reject;
    bool public reenter;
    bool public blockedWithdraw;
    bool public blockedDeposit;
    bool public sawClearedReceipt;
    constructor(BillboardPortal p) { portal = p; }
    function configure(bool r, bool re) external { reject = r; reenter = re; }
    function deposit() external payable { portal.deposit{value:msg.value}(bytes32(uint256(123))); }
    function withdraw(uint256 epoch) external { portal.withdraw(epoch,1,0,new bytes32[](0)); }
    receive() external payable {
        require(!reject,"Fixture refund rejected");
        (uint64 nonce,uint128 amount) = portal.getDeposit(address(this));
        sawClearedReceipt = nonce == 0 && amount == 0;
        if (reenter) {
            try portal.withdraw(2,1,0,new bytes32[](0)) {} catch { blockedWithdraw = true; }
            try portal.deposit{value:msg.value}(bytes32(uint256(123))) {} catch { blockedDeposit = true; }
        }
    }
}
contract NonceBoundaryPortal is BillboardPortal {
    constructor(address r) BillboardPortal(r,bytes32(uint256(1)),4248422647,1,100,bytes32(uint256(123))) {}
    function seedLastNonce(address depositor,uint64 nonce) external { lastDepositNonce[depositor] = nonce; }
}
contract ForceSurplus { constructor(address payable destination) payable { selfdestruct(destination); } }

contract PortalV1Test is PortalFixtures {
    using Hash for DataStructures.L2ToL1Msg;
    VmV1 private constant control = VmV1(address(uint160(uint256(keccak256("hevm cheat code")))));
    RootPublisher private rollup;
    BillboardPortal private portal;
    bytes32 private constant CONFIG = bytes32(uint256(123));
    function setUp() public {
        rollup = new RootPublisher(VERSION);
        portal = new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG);
    }
    function message(BillboardPortal p,bytes32 content) private view returns(DataStructures.L2ToL1Msg memory) {
        return DataStructures.L2ToL1Msg(DataStructures.L2Actor(p.L2_CONTRACT(),p.VERSION()),
            DataStructures.L1Actor(address(p),block.chainid),content);
    }
    function ready(BillboardPortal p) private view returns(bytes32) {
        return PortalMessages.ready(block.chainid,address(p),p.L2_CONTRACT(),p.VERSION(),p.CONFIG_HASH());
    }
    function activate(BillboardPortal p,RootPublisher r) private {
        r.publish(1,1,message(p,ready(p)).sha256ToField());
        p.activate(1,1,0,new bytes32[](0));
    }
    function exitRoot(BillboardPortal p,address owner,uint64 nonce,uint128 amount) private view returns(bytes32) {
        return message(p,PortalMessages.receipt(true,block.chainid,address(p),p.L2_CONTRACT(),p.VERSION(),owner,nonce,amount)).sha256ToField();
    }
    function expectReceipt(address owner,uint64 expectedNonce,uint128 expectedAmount) private view {
        (uint64 nonce,uint128 amount) = portal.getDeposit(owner);
        require(nonce==expectedNonce && amount==expectedAmount,"Wrong active receipt");
    }
    function testDisabledUntilCanonicalReadyAndActivationCannotRepeat() public {
        vm.deal(ALICE,2 ether);
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Deposits disabled"));
        vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
        control.expectRevert(); portal.activate(1,1,0,new bytes32[](0));
        require(!portal.depositsEnabled(),"Failed proof activated deposits");
        activate(portal,rollup);
        require(portal.depositsEnabled(),"Valid Ready failed");
        require(rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(1),1),"Ready not nullified");
        control.expectRevert(); portal.activate(1,1,0,new bytes32[](0));
        depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,1,2 ether);
    }
    function testEveryReadyWordIsAuthenticatedByCanonicalOutbox() public {
        bytes32[7] memory words = [bytes32("AZTEC_BB_READY_V1"),bytes32(uint256(1)),bytes32(block.chainid),
            bytes32(uint256(uint160(address(portal)))),L2,bytes32(VERSION),CONFIG];
        for(uint256 i; i<words.length; ++i) {
            bytes32 previous=words[i]; words[i]=bytes32(uint256(previous)^1);
            rollup.publish(1,1,message(portal,Hash.sha256ToField(abi.encode(words))).sha256ToField());
            control.expectRevert(); portal.activate(1,1,0,new bytes32[](0));
            require(!portal.depositsEnabled(),"Mutated Ready activated");
            require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(1),1),"Failed Ready consumed");
            words[i]=previous;
        }
        activate(portal,rollup);
    }
    function testWrongReadyEnvelopeAndMerkleProofReject() public {
        for(uint256 i; i<4; ++i) {
            DataStructures.L2ToL1Msg memory m=message(portal,ready(portal));
            if(i==0) m.sender.actor=bytes32(uint256(2));
            if(i==1) m.sender.version=VERSION+1;
            if(i==2) m.recipient.actor=ALICE;
            if(i==3) m.recipient.chainId=block.chainid+1;
            rollup.publish(1,1,m.sha256ToField());
            control.expectRevert(); portal.activate(1,1,0,new bytes32[](0));
        }
        rollup.publish(1,1,message(portal,ready(portal)).sha256ToField());
        control.expectRevert(); portal.activate(1,1,1,new bytes32[](0));
        control.expectRevert(); portal.activate(1,2,0,new bytes32[](0));
        bytes32[] memory wrongPath=new bytes32[](1);
        control.expectRevert(); portal.activate(1,1,0,wrongPath);
        portal.activate(1,1,0,new bytes32[](0));
    }
    function testCanonicalInboxMessageMatchesScopedReceiptAndEnvelope() public {
        activate(portal,rollup);
        vm.deal(ALICE,2 ether); vm.prank(ALICE);
        (bytes32 key,uint256 index)=portal.deposit{value:2 ether}(bytes32(uint256(123)));
        DataStructures.L1ToL2Msg memory m=DataStructures.L1ToL2Msg({
            sender:DataStructures.L1Actor(address(portal),block.chainid),recipient:DataStructures.L2Actor(L2,VERSION),
            content:PortalMessages.receipt(false,block.chainid,address(portal),L2,VERSION,ALICE,1,2 ether),
            secretHash:bytes32(uint256(123)),index:index});
        require(key==Hash.sha256ToField(m),"Canonical Inbox key differs from scoped receipt");
        require(portal.INBOX().getTotalMessagesInserted()==1,"Inbox did not insert once");
        expectReceipt(ALICE,1,2 ether);
        require(portal.lastDepositNonce(ALICE)==1 && portal.totalDeposited()==2 ether,"Wrong receipt accounting");
    }
    function testMinMaxSecretAndActiveReceiptBounds() public {
        activate(portal,rollup); vm.deal(ALICE,10 ether);
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether-1}(bytes32(uint256(1)));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:3 ether+1}(bytes32(uint256(1)));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(0));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(Constants.P));
        expectReceipt(ALICE,0,0); require(portal.lastDepositNonce(ALICE)==0,"Failed deposit advanced nonce");
        depositAs(portal,ALICE,2 ether); depositAs(portal,BOB,3 ether);
        vm.deal(ALICE,2 ether); control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(1)));
        require(portal.totalDeposited()==5 ether,"Deposit bounds corrupted accounting");
    }
    function testInboxFailureRollsBackNonceReceiptValueAndTotal() public {
        FailingInbox failing=new FailingInbox(); rollup.setInbox(IInbox(address(failing)));
        portal=new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG); activate(portal,rollup);
        vm.deal(ALICE,2 ether); control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
        expectReceipt(ALICE,0,0);
        require(portal.lastDepositNonce(ALICE)==0 && portal.totalDeposited()==0 && address(portal).balance==0,"Inbox failure retained effects");
        require(ALICE.balance==2 ether,"Inbox failure retained payment");
        failing.setFail(false); depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,1,2 ether);
    }
    function testCanonicalExitRefundAndRedepositRejectOldProof() public {
        activate(portal,rollup); depositAs(portal,ALICE,2 ether); depositAs(portal,BOB,3 ether);
        bytes32 oldExit=exitRoot(portal,ALICE,1,2 ether); rollup.publish(2,1,oldExit);
        vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
        expectReceipt(ALICE,0,0); expectReceipt(BOB,1,3 ether);
        require(portal.totalDeposited()==3 ether && ALICE.balance==2 ether,"Refund accounting failed");
        control.expectRevert(); vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
        depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,2,2 ether);
        // A fresh unconsumed root with the OLD content still cannot spend the new receipt.
        rollup.publish(3,1,oldExit);
        control.expectRevert(); vm.prank(ALICE); portal.withdraw(3,1,0,new bytes32[](0));
        expectReceipt(ALICE,2,2 ether); require(portal.totalDeposited()==5 ether,"Old proof changed new liability");
        require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(3),1),"Wrong receipt proof consumed");
        rollup.publish(3,1,exitRoot(portal,ALICE,2,2 ether));
        vm.prank(ALICE); portal.withdraw(3,1,0,new bytes32[](0));
        require(portal.lastDepositNonce(ALICE)==2,"Refund erased receipt counter");
    }
    function testEachExitReceiptWordIsAuthenticatedAndFailureRollsBack() public {
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        bytes32[9] memory words=[bytes32("AZTEC_BB_EXIT_V1"),bytes32(uint256(1)),bytes32(block.chainid),
            bytes32(uint256(uint160(address(portal)))),L2,bytes32(VERSION),bytes32(uint256(uint160(ALICE))),bytes32(uint256(1)),bytes32(uint256(2 ether))];
        for(uint256 i; i<words.length; ++i) {
            bytes32 old=words[i]; words[i]=bytes32(uint256(old)^1);
            rollup.publish(2,1,message(portal,Hash.sha256ToField(abi.encode(words))).sha256ToField());
            control.expectRevert(); vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
            expectReceipt(ALICE,1,2 ether); require(portal.totalDeposited()==2 ether && address(portal).balance==2 ether,"Failed exit changed liabilities");
            require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Failed exit consumed message");
            words[i]=old;
        }
        rollup.publish(2,1,exitRoot(portal,ALICE,1,2 ether)); vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
    }
    function testRejectedRefundRollsBackCanonicalConsumptionThenRetrySucceeds() public {
        activate(portal,rollup); RefundReceiver receiver=new RefundReceiver(portal);
        vm.deal(address(this),2 ether); receiver.deposit{value:2 ether}();
        rollup.publish(2,1,exitRoot(portal,address(receiver),1,2 ether)); receiver.configure(true,false);
        control.expectRevert(); receiver.withdraw(2);
        expectReceipt(address(receiver),1,2 ether);
        require(portal.totalDeposited()==2 ether && !rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Failed transfer did not roll back");
        receiver.configure(false,false); receiver.withdraw(2);
        require(address(receiver).balance==2 ether && portal.totalDeposited()==0,"Retry refund failed");
    }
    function testRefundReentrancyBlockedAndEffectsPrecedeCallback() public {
        activate(portal,rollup); RefundReceiver receiver=new RefundReceiver(portal);
        vm.deal(address(this),2 ether); receiver.deposit{value:2 ether}(); receiver.configure(false,true);
        rollup.publish(2,1,exitRoot(portal,address(receiver),1,2 ether)); receiver.withdraw(2);
        require(receiver.blockedWithdraw() && receiver.blockedDeposit() && receiver.sawClearedReceipt(),"Refund callback bypassed guard/effects");
        require(portal.totalDeposited()==0 && portal.lastDepositNonce(address(receiver))==1,"Reentry changed escrow");
    }
    function testRejectUnsolicitedEtherAndKeepForcedSurplusSeparate() public {
        vm.deal(address(this),1 ether);
        (bool ok,)=address(portal).call{value:1}(""); require(!ok,"Unsolicited ETH accepted");
        new ForceSurplus{value:1 ether}(payable(address(portal)));
        require(address(portal).balance==1 ether && portal.totalDeposited()==0,"Forced value credited as collateral");
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        rollup.publish(2,1,exitRoot(portal,ALICE,1,2 ether)); vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
        require(address(portal).balance==1 ether && portal.totalDeposited()==0,"Refund spent forced surplus");
    }
    function testNonceOverflowFailsClosed() public {
        NonceBoundaryPortal p=new NonceBoundaryPortal(address(rollup)); activate(p,rollup);
        p.seedLastNonce(ALICE,type(uint64).max); vm.deal(ALICE,1);
        control.expectRevert(); vm.prank(ALICE); p.deposit{value:1}(bytes32(uint256(123)));
        (uint64 nonce,uint128 amount)=p.getDeposit(ALICE);
        require(nonce==0 && amount==0 && p.totalDeposited()==0 && p.lastDepositNonce(ALICE)==type(uint64).max,"Nonce overflow created rights");
    }
    function testConstructorRejectsInvalidScopeAndEconomicBounds() public {
        control.expectRevert(); new BillboardPortal(ALICE,L2,VERSION,1,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),bytes32(0),VERSION,1,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),bytes32(Constants.P),VERSION,1,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,0,1,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,uint256(type(uint32).max)+1,1,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,0,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,3,2,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,uint256(type(uint96).max)+1,CONFIG);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,bytes32(0));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,bytes32(Constants.P));
        // Pinned Forge refuses vm.chainId >= 2^64; that unavailable boundary is recorded in evidence.
        control.chainId(0);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG);
    }
    function testConstructorAcceptsMaximumSupportedScalarBounds() public {
        control.chainId(type(uint64).max);
        BillboardPortal p=new BillboardPortal(address(rollup),bytes32(Constants.P-1),type(uint32).max,1,type(uint96).max,bytes32(Constants.P-1));
        require(p.L1_CHAIN_ID()==type(uint64).max && p.MAX_DEPOSIT()==type(uint96).max && !p.depositsEnabled(),"Valid upper bounds rejected");
        // This is a constructor range control; mismatched protocol versions cannot activate.
    }
    function testBridgeActorsArePinnedDespiteRollupGetterChanges() public {
        Outbox original=rollup.outbox(); IInbox originalInbox=rollup.inbox();
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        rollup.publish(2,1,exitRoot(portal,ALICE,1,2 ether));
        rollup.setInbox(IInbox(ALICE)); rollup.setOutbox(Outbox(BOB));
        vm.prank(ALICE); portal.withdraw(2,1,0,new bytes32[](0));
        require(address(portal.INBOX())==address(originalInbox) && address(portal.OUTBOX())==address(original),"Bridge identity changed");
        depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,2,2 ether);
    }
    function testInvalidBridgeAndChangedChainReject() public {
        IInbox originalInbox=rollup.inbox();
        rollup.setInbox(IInbox(ALICE)); control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG);
        rollup.setInbox(originalInbox); Outbox original=rollup.outbox();
        rollup.setOutbox(Outbox(BOB)); control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG);
        rollup.setOutbox(original); activate(portal,rollup); control.chainId(block.chainid+1);
        vm.deal(ALICE,2 ether); control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
    }
}
