// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PortalMessages} from "../src/PortalMessages.sol";
import {PortalFixtures, VmPortalRegression} from "./PortalArtifactRegression.t.sol";
import {Inbox, INBOX_BUCKET_RING_SIZE} from "@aztec/core/messagebridge/Inbox.sol";
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
        inbox = new Inbox(address(this), IERC20(address(0x1234)), version, INBOX_BUCKET_RING_SIZE);
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
    function withdraw(uint256 epoch) external { portal.withdraw(bytes32(uint256(123)),epoch,1,0,new bytes32[](0)); }
    receive() external payable {
        require(!reject,"Fixture refund rejected");
        uint128 amount = portal.getDeposit(address(this));
        sawClearedReceipt = amount == 0;
        if (reenter) {
            try portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0)) {} catch { blockedWithdraw = true; }
            try portal.deposit{value:msg.value}(bytes32(uint256(123))) {} catch { blockedDeposit = true; }
        }
    }
}
contract ForceSurplus { constructor(address payable destination) payable { selfdestruct(destination); } }

contract PortalActivationFactory {
    function deploy(address rollup,bytes32 board,uint256 version,bytes32 config,address operator) external returns(BillboardPortal) {
        return new BillboardPortal{salt:bytes32(uint256(1))}(rollup,board,version,1 ether,3 ether,config,operator);
    }
    function activate(BillboardPortal portal) external {portal.activate();}
}

contract PortalV1Test is PortalFixtures {
    using Hash for DataStructures.L2ToL1Msg;
    VmV1 private constant control = VmV1(address(uint160(uint256(keccak256("hevm cheat code")))));
    RootPublisher private rollup;
    BillboardPortal private portal;
    bytes32 private constant CONFIG = bytes32(uint256(123));
    function setUp() public {
        rollup = new RootPublisher(VERSION);
        portal = new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG, address(this));
    }
    function message(BillboardPortal p,bytes32 content) private view returns(DataStructures.L2ToL1Msg memory) {
        return DataStructures.L2ToL1Msg(DataStructures.L2Actor(p.L2_CONTRACT(),p.VERSION()),
            DataStructures.L1Actor(address(p),block.chainid),content);
    }
    function activate(BillboardPortal p,RootPublisher) private {
        p.activate();
    }
    function exitRoot(BillboardPortal p,address owner,uint128 amount) private view returns(bytes32) {
        return message(p,PortalMessages.depositExit("AZTEC_BB_EXIT_V2",block.chainid,address(p),p.L2_CONTRACT(),p.VERSION(),owner,amount,p.latestDeposit(owner))).sha256ToField();
    }
    function expectReceipt(address owner,uint128 expectedAmount) private view {
        uint128 amount = portal.getDeposit(owner);
        require(amount==expectedAmount,"Wrong active receipt");
    }
    function testDisabledUntilOperatorAttestationAndActivationCannotRepeat() public {
        vm.deal(ALICE,2 ether);
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Deposits disabled"));
        vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Not deployment operator"));
        vm.prank(BOB); portal.activate();
        require(!portal.depositsEnabled(),"Unauthorized activation changed state");
        activate(portal,rollup);
        require(portal.depositsEnabled(),"Operator attestation failed");
        require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(1),1),"Activation consumed Outbox message");
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Already activated"));
        portal.activate();
        depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,2 ether);
    }
    function testSepoliaOperatorActivationDoesNotRequirePublishedRoot() public {
        control.chainId(11155111);
        BillboardPortal p=new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG,ALICE);
        require(p.DEPLOYMENT_OPERATOR()==ALICE,"Explicit operator lost");
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Not deployment operator"));
        p.activate();
        vm.prank(ALICE); p.activate();
        require(p.depositsEnabled(),"Sepolia activation failed");
    }
    function testActivationRejectsMainnetAndOtherNetworksEvenForOperator() public {
        uint256[3] memory chains=[uint256(1),uint256(17000),uint256(10)];
        for(uint256 i;i<chains.length;++i){
            control.chainId(chains[i]);
            BillboardPortal p=new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG,address(this));
            vm.expectRevert(abi.encodeWithSignature("Error(string)","Test network only"));
            p.activate();
            require(!p.depositsEnabled(),"Other network activated");
        }
    }
    function testActivationRejectsChangedChainEvenWhenBothChainsAreAllowed() public {
        control.chainId(11155111);
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Test network only"));
        portal.activate();
    }
    function testCreate2FactoryIsNotDeploymentOperator() public {
        PortalActivationFactory factory=new PortalActivationFactory();
        BillboardPortal p=factory.deploy(address(rollup),L2,VERSION,CONFIG,ALICE);
        require(p.DEPLOYMENT_OPERATOR()==ALICE,"Factory replaced explicit operator");
        vm.expectRevert(abi.encodeWithSignature("Error(string)","Not deployment operator"));
        factory.activate(p);
        vm.prank(ALICE);p.activate();
        require(p.depositsEnabled(),"Bound operator failed");
    }
    function testDeploymentOperatorCannotBypassWithdrawalProofOrOwner() public {
        activate(portal,rollup);depositAs(portal,ALICE,2 ether);
        control.expectRevert();portal.withdraw(bytes32(uint256(123)),0,0,0,new bytes32[](0));
        control.expectRevert();vm.prank(ALICE);portal.withdraw(bytes32(uint256(123)),0,0,0,new bytes32[](0));
        require(portal.getDeposit(ALICE)==2 ether && portal.totalDeposited()==2 ether,"Failed exit changed funds");
    }
    function testCanonicalInboxMessageMatchesScopedReceiptAndEnvelope() public {
        activate(portal,rollup);
        vm.deal(ALICE,2 ether); vm.prank(ALICE);
        (bytes32 key,uint256 index)=portal.deposit{value:2 ether}(bytes32(uint256(123)));
        DataStructures.L1ToL2Msg memory m=DataStructures.L1ToL2Msg({
            sender:DataStructures.L1Actor(address(portal),block.chainid),recipient:DataStructures.L2Actor(L2,VERSION),
            content:PortalMessages.receipt(false,block.chainid,address(portal),L2,VERSION,ALICE,2 ether),
            secretHash:bytes32(uint256(123)),index:index});
        require(key==Hash.sha256ToField(m),"Canonical Inbox key differs from scoped receipt");
        require(portal.INBOX().getTotalMessagesInserted()==1,"Inbox did not insert once");
        BillboardPortal.Deposit memory saved=portal.getActiveDeposit(ALICE);
        require(saved.amount==2 ether && saved.secretHash==bytes32(uint256(123)) && saved.key==key && saved.index==index,"Claim metadata mismatch");
        expectReceipt(ALICE,2 ether);
        require(portal.totalDeposited()==2 ether,"Wrong receipt accounting");
    }
    function testMinMaxSecretAndActiveReceiptBounds() public {
        activate(portal,rollup); vm.deal(ALICE,10 ether);
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether-1}(bytes32(uint256(1)));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:3 ether+1}(bytes32(uint256(1)));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(0));
        control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(Constants.P));
        expectReceipt(ALICE,0);
        depositAs(portal,ALICE,2 ether); depositAs(portal,BOB,3 ether);
        vm.deal(ALICE,2 ether); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(1)));
        require(portal.getDeposit(ALICE,bytes32(uint256(123))).amount==2 ether,"Earlier deposit overwritten");
        require(portal.totalDeposited()==7 ether,"Fresh commitment accounting wrong");
    }
    function testInboxFailureRollsBackReceiptValueAndTotal() public {
        FailingInbox failing=new FailingInbox(); rollup.setInbox(IInbox(address(failing)));
        portal=new BillboardPortal(address(rollup),L2,VERSION,2 ether,3 ether,CONFIG, address(this)); activate(portal,rollup);
        vm.deal(ALICE,2 ether); control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
        expectReceipt(ALICE,0);
        require(portal.totalDeposited()==0 && address(portal).balance==0,"Inbox failure retained effects");
        require(ALICE.balance==2 ether,"Inbox failure retained payment");
        failing.setFail(false); depositAs(portal,ALICE,2 ether); expectReceipt(ALICE,2 ether);
    }
    function testCanonicalExitRefundAndRedepositRejectOldProof() public {
        activate(portal,rollup); depositAs(portal,ALICE,2 ether); depositAs(portal,BOB,3 ether);
        bytes32 oldExit=exitRoot(portal,ALICE,2 ether); rollup.publish(2,1,oldExit);
        vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
        expectReceipt(ALICE,0); expectReceipt(BOB,3 ether);
        BillboardPortal.Deposit memory cleared=portal.getActiveDeposit(ALICE);
        require(cleared.amount==0 && cleared.secretHash==bytes32(uint256(123)),"Spent commitment tombstone lost");
        require(portal.totalDeposited()==3 ether && ALICE.balance==2 ether,"Refund accounting failed");
        control.expectRevert(); vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
        vm.deal(ALICE,2 ether); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(124))); expectReceipt(ALICE,2 ether);
        // Redepositing the same amount must not make the consumed exit usable again.
        control.expectRevert(); vm.prank(ALICE); portal.withdraw(bytes32(uint256(124)),2,1,0,new bytes32[](0));
        expectReceipt(ALICE,2 ether); require(portal.totalDeposited()==5 ether,"Old proof changed new liability");
        require(rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Old exit lost its consumed marker");
        // A new authenticated exit is a distinct Outbox message, even at the same amount.
        rollup.publish(3,1,exitRoot(portal,ALICE,2 ether));
        vm.prank(ALICE); portal.withdraw(bytes32(uint256(124)),3,1,0,new bytes32[](0));
    }
    function testEachExitReceiptWordIsAuthenticatedAndFailureRollsBack() public {
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        bytes32[9] memory words=[bytes32("AZTEC_BB_EXIT_V2"),bytes32(uint256(2)),bytes32(block.chainid),
            bytes32(uint256(uint160(address(portal)))),L2,bytes32(VERSION),bytes32(uint256(uint160(ALICE))),bytes32(uint256(2 ether)),bytes32(uint256(123))];
        for(uint256 i; i<words.length; ++i) {
            bytes32 old=words[i]; words[i]=bytes32(uint256(old)^1);
            rollup.publish(2,1,message(portal,Hash.sha256ToField(abi.encode(words))).sha256ToField());
            control.expectRevert(); vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
            expectReceipt(ALICE,2 ether); require(portal.totalDeposited()==2 ether && address(portal).balance==2 ether,"Failed exit changed liabilities");
            require(!rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Failed exit consumed message");
            words[i]=old;
        }
        rollup.publish(2,1,exitRoot(portal,ALICE,2 ether)); vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
    }
    function testRejectedRefundRollsBackCanonicalConsumptionThenRetrySucceeds() public {
        activate(portal,rollup); RefundReceiver receiver=new RefundReceiver(portal);
        vm.deal(address(this),2 ether); receiver.deposit{value:2 ether}();
        rollup.publish(2,1,exitRoot(portal,address(receiver),2 ether)); receiver.configure(true,false);
        control.expectRevert(); receiver.withdraw(2);
        expectReceipt(address(receiver),2 ether);
        require(portal.totalDeposited()==2 ether && !rollup.outbox().hasMessageBeenConsumedAtEpoch(Epoch.wrap(2),1),"Failed transfer did not roll back");
        receiver.configure(false,false); receiver.withdraw(2);
        require(address(receiver).balance==2 ether && portal.totalDeposited()==0,"Retry refund failed");
    }
    function testRefundReentrancyBlockedAndEffectsPrecedeCallback() public {
        activate(portal,rollup); RefundReceiver receiver=new RefundReceiver(portal);
        vm.deal(address(this),2 ether); receiver.deposit{value:2 ether}(); receiver.configure(false,true);
        rollup.publish(2,1,exitRoot(portal,address(receiver),2 ether)); receiver.withdraw(2);
        require(receiver.blockedWithdraw() && receiver.blockedDeposit() && receiver.sawClearedReceipt(),"Refund callback bypassed guard/effects");
        require(portal.totalDeposited()==0,"Reentry changed escrow");
    }
    function testRejectUnsolicitedEtherAndKeepForcedSurplusSeparate() public {
        vm.deal(address(this),1 ether);
        (bool ok,)=address(portal).call{value:1}(""); require(!ok,"Unsolicited ETH accepted");
        new ForceSurplus{value:1 ether}(payable(address(portal)));
        require(address(portal).balance==1 ether && portal.totalDeposited()==0,"Forced value credited as collateral");
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        rollup.publish(2,1,exitRoot(portal,ALICE,2 ether)); vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
        require(address(portal).balance==1 ether && portal.totalDeposited()==0,"Refund spent forced surplus");
    }
    function testConstructorRejectsInvalidScopeAndEconomicBounds() public {
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG,address(0));
        control.expectRevert(); new BillboardPortal(ALICE,L2,VERSION,1,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),bytes32(0),VERSION,1,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),bytes32(Constants.P),VERSION,1,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,0,1,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,uint256(type(uint32).max)+1,1,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,0,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,3,2,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,uint256(type(uint96).max)+1,CONFIG, address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,bytes32(0), address(this));
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,bytes32(Constants.P), address(this));
        // Pinned Forge refuses vm.chainId >= 2^64; that unavailable boundary is recorded in evidence.
        control.chainId(0);
        control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG, address(this));
    }
    function testConstructorAcceptsMaximumSupportedScalarBounds() public {
        control.chainId(type(uint64).max);
        BillboardPortal p=new BillboardPortal(address(rollup),bytes32(Constants.P-1),type(uint32).max,1,type(uint96).max,bytes32(Constants.P-1), address(this));
        require(p.L1_CHAIN_ID()==type(uint64).max && p.MAX_DEPOSIT()==type(uint96).max && !p.depositsEnabled(),"Valid upper bounds rejected");
        // This is a constructor range control; deployment readiness is the test operator assertion.
    }
    function testBridgeActorsArePinnedDespiteRollupGetterChanges() public {
        Outbox original=rollup.outbox(); IInbox originalInbox=rollup.inbox();
        activate(portal,rollup); depositAs(portal,ALICE,2 ether);
        rollup.publish(2,1,exitRoot(portal,ALICE,2 ether));
        rollup.setInbox(IInbox(ALICE)); rollup.setOutbox(Outbox(BOB));
        vm.prank(ALICE); portal.withdraw(bytes32(uint256(123)),2,1,0,new bytes32[](0));
        require(address(portal.INBOX())==address(originalInbox) && address(portal.OUTBOX())==address(original),"Bridge identity changed");
        vm.deal(ALICE,2 ether); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(124))); expectReceipt(ALICE,2 ether);
    }
    function testInvalidBridgeAndChangedChainReject() public {
        IInbox originalInbox=rollup.inbox();
        rollup.setInbox(IInbox(ALICE)); control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG, address(this));
        rollup.setInbox(originalInbox); Outbox original=rollup.outbox();
        rollup.setOutbox(Outbox(BOB)); control.expectRevert(); new BillboardPortal(address(rollup),L2,VERSION,1,2,CONFIG, address(this));
        rollup.setOutbox(original); activate(portal,rollup); control.chainId(block.chainid+1);
        vm.deal(ALICE,2 ether); control.expectRevert(); vm.prank(ALICE); portal.deposit{value:2 ether}(bytes32(uint256(123)));
    }
}

interface VmDepositConsent {
    function addr(uint256) external returns(address);
    function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
    function expectRevert() external;
    function warp(uint256) external;
}
contract PortalDepositConsentTest is PortalFixtures {
    VmDepositConsent constant control=VmDepositConsent(address(uint160(uint256(keccak256("hevm cheat code")))));
    BillboardPortal portal; address owner; bytes32 constant SECRET=bytes32(uint256(44));
    function setUp() public {
        owner=control.addr(123);portal=new BillboardPortal(address(new RootPublisher(VERSION)),L2,VERSION,1 ether,2 ether,bytes32(uint256(123)), address(this));
        portal.activate();vm.deal(address(this),10 ether);vm.deal(BOB,10 ether);
    }
    function signature(address executor,uint256 amount,bytes32 secret,uint256 nonce,uint256 deadline) private returns(bytes memory) {
        (uint8 v,bytes32 r,bytes32 s)=control.sign(123,portal.depositForDigest(owner,executor,amount,secret,nonce,deadline));return abi.encodePacked(r,s,v);
    }
    function testConsentBindsExecutorAmountSecretNonceAndDeadline() public {
        uint256 deadline=block.timestamp+60;bytes memory sig=signature(address(this),1 ether,SECRET,0,deadline);
        control.expectRevert();vm.prank(BOB);portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
        control.expectRevert();portal.depositFor{value:2 ether}(owner,SECRET,0,deadline,sig);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,bytes32(uint256(45)),0,deadline,sig);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,1,deadline,sig);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,0,deadline+1,sig);
        require(portal.getDeposit(owner)==0 && portal.depositNonces(owner)==0,"Invalid consent preoccupied owner");
        portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
        require(portal.getDeposit(owner)==1 ether && portal.getDeposit(address(this))==0 && portal.depositNonces(owner)==1);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
    }
    function testRelayedCollateralCanOnlyWithdrawToBeneficiary() public {
        uint256 deadline=block.timestamp+60;bytes memory sig=signature(address(this),1 ether,SECRET,0,deadline);
        portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
        RootPublisher r=RootPublisher(address(portal.ROLLUP()));
        bytes32 content=PortalMessages.depositExit("AZTEC_BB_EXIT_V2",block.chainid,address(portal),L2,VERSION,owner,uint128(1 ether),SECRET);
        r.publish(2,1,Hash.sha256ToField(DataStructures.L2ToL1Msg(DataStructures.L2Actor(L2,VERSION),DataStructures.L1Actor(address(portal),block.chainid),content)));
        control.expectRevert();portal.withdraw(SECRET,2,1,0,new bytes32[](0));
        vm.prank(owner);portal.withdraw(SECRET,2,1,0,new bytes32[](0));require(owner.balance==1 ether && portal.getDeposit(owner)==0);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
        require(portal.depositNonces(owner)==1 && portal.getDeposit(owner)==0,"Old authorization replayed after withdrawal");
    }
    function testDirectDepositRejectsDuplicateCommitmentButAllowsFreshConsent() public {
        vm.deal(owner,2 ether);vm.prank(owner);portal.deposit{value:1 ether}(SECRET);
        bytes memory sig=signature(address(this),1 ether,SECRET,0,block.timestamp+60);
        control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,0,block.timestamp+60,sig);
        require(portal.depositNonces(owner)==0 && portal.getDeposit(owner)==1 ether);
        bytes32 fresh=bytes32(uint256(45));
        sig=signature(address(this),1 ether,fresh,0,block.timestamp+60);
        portal.depositFor{value:1 ether}(owner,fresh,0,block.timestamp+60,sig);
        require(portal.getDeposit(owner,SECRET).amount==1 ether && portal.getDeposit(owner,fresh).amount==1 ether && portal.totalDeposited()==2 ether,"Fresh owner deposit lost original");
    }
    function testExpiredOrOtherPortalSignatureRejected() public {
        uint256 deadline=block.timestamp+60;bytes memory sig=signature(address(this),1 ether,SECRET,0,deadline);
        control.warp(deadline+1);control.expectRevert();portal.depositFor{value:1 ether}(owner,SECRET,0,deadline,sig);
        require(portal.depositNonces(owner)==0);
        BillboardPortal other=new BillboardPortal(address(portal.ROLLUP()),L2,VERSION,1 ether,2 ether,bytes32(uint256(123)), address(this));
        require(other.depositForDigest(owner,address(this),1 ether,SECRET,0,deadline)!=portal.depositForDigest(owner,address(this),1 ether,SECRET,0,deadline),"Portal domain collision");
    }
}
