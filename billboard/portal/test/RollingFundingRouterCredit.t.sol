// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {RollingFundingRouter} from "../src/RollingFundingRouter.sol";
import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PluginPortal} from "../src/PluginPortal.sol";
import {AccountingRollup,AccountingOutbox} from "./PortalArtifactRegression.t.sol";
import {FundingToken,FundingWrapped,FundingDex,FundingVm,FundingForce,FundingFeeBridge} from "./RollingFundingRouter.t.sol";
import {Inbox} from "@aztec/core/messagebridge/Inbox.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
// Actual protocol Inbox; only activation's Outbox consumption is a fixture.
contract BokIntegrationRollup {
    Inbox private immutable inbox;
    AccountingOutbox private immutable outbox=new AccountingOutbox();
    constructor(address token){inbox=new Inbox(address(this),IERC20(token),1,512);}
    function getInbox() external view returns(IInbox){return IInbox(address(inbox));}
    function getOutbox() external view returns(IOutbox){return IOutbox(address(outbox));}
}
interface BokLogVm {
    struct Log {bytes32[] topics;bytes data;address emitter;}
    function recordLogs() external;
    function getRecordedLogs() external returns(Log[] memory);
}
contract BokCreditBuyer {
    bool public rejectRefund; bool public reenter; bool public blocked; RollingFundingRouter private router;
    function buy(RollingFundingRouter r,RollingFundingRouter.Purchase calldata p,bool reject,bool attack) external payable {
        router=r;rejectRefund=reject;reenter=attack;r.buyCredit{value:msg.value}(p);
    }
    receive() external payable {
        require(!rejectRefund,"Rejected");
        if(reenter) { RollingFundingRouter.Purchase memory p=RollingFundingRouter.Purchase(bytes32(uint256(11)),1,bytes32(uint256(12)),3000,block.timestamp);
            try router.buyCredit{value:10}(p) {revert("Reentered");} catch {blocked=true;}
        }
    }
}
contract RollingFundingRouterCreditTest {
    FundingVm constant vm=FundingVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FundingToken token; FundingWrapped weth; FundingDex dex; PluginPortal portal; RollingFundingRouter router; address alice;
    function setUp() public {
        token=new FundingToken();weth=new FundingWrapped();dex=new FundingDex();AccountingRollup rollup=new AccountingRollup();
        portal=new PluginPortal(address(rollup),bytes32(uint256(4)),1,address(token));portal.activate(0,0,0,new bytes32[](0));
        router=creditRouter(rollup);token.seed(address(dex),10000);
        alice=vm.addr(123);vm.deal(alice,1 ether);vm.deal(address(this),1 ether);
    }
    function creditRouter(AccountingRollup rollup) private returns(RollingFundingRouter) {
        BillboardPortal collateral=new BillboardPortal(address(rollup),bytes32(uint256(4)),1,1 ether,2 ether,bytes32(uint256(2)), address(this));
        FundingToken fee=new FundingToken();FundingFeeBridge feeBridge=new FundingFeeBridge(address(fee),address(rollup));
        return new RollingFundingRouter(address(collateral),address(feeBridge),address(portal),address(weth),address(dex),bytes32(uint256(3)));
    }
    function purchase() private view returns(RollingFundingRouter.Purchase memory) {return RollingFundingRouter.Purchase(bytes32(uint256(11)),200,bytes32(uint256(12)),3000,block.timestamp+900);}
    function buy(RollingFundingRouter.Purchase memory p,uint256 value) private {vm.prank(alice);router.buyCredit{value:value}(p);}
    function empty() private view {require(token.balanceOf(address(portal))==0 && token.balanceOf(address(dex))==10000 && weth.balanceOf(address(dex))==0,"Payment not atomic");require(address(router).balance==0 && weth.balanceOf(address(router))==0 && token.balanceOf(address(router))==0,"Retained payment");}
    function testOnePaymentBuysExactCreditRefundsAndClearsAllowances() public {
        buy(purchase(),3000);require(alice.balance==1 ether-2000 && token.balanceOf(address(portal))==200,"Wrong debit/credit");
        require(address(router).balance==0 && weth.balanceOf(address(router))==0 && token.balanceOf(address(router))==0,"Retained payment");
        require(weth.allowance(address(router),address(dex))==0 && token.allowance(address(router),address(portal))==0,"Retained allowance");
    }
    function testPurchaseAndPortalEventsBindCommitmentSecretAndSameMessage() public {
        BokLogVm logsVm=BokLogVm(address(vm));logsVm.recordLogs();buy(purchase(),3000);
        BokLogVm.Log[] memory logs=logsVm.getRecordedLogs();bytes32 portalKey;uint256 portalIndex;uint256 portalEvents;uint256 purchaseEvents;
        for(uint256 i=0;i<logs.length;i++)if(logs[i].emitter==address(portal)&&logs[i].topics[0]==keccak256("Deposited(bytes32,uint128,bytes32,uint256)")){
            require(logs[i].topics[1]==bytes32(uint256(11)));uint128 amount;(amount,portalKey,portalIndex)=abi.decode(logs[i].data,(uint128,bytes32,uint256));require(amount==200);portalEvents++;
        }
        for(uint256 i=0;i<logs.length;i++)if(logs[i].emitter==address(router)){
            require(logs[i].topics[0]==keccak256("CreditPurchased(address,bytes32,uint128,bytes32,bytes32,uint256,uint256,uint256)"));
            require(logs[i].topics[1]==bytes32(uint256(uint160(alice)))&&logs[i].topics[2]==bytes32(uint256(11)));
            (uint128 amount,bytes32 secret,bytes32 key,uint256 index,uint256 spent,uint256 refund)=abi.decode(logs[i].data,(uint128,bytes32,bytes32,uint256,uint256,uint256));
            require(amount==200&&secret==bytes32(uint256(12))&&key==portalKey&&index==portalIndex&&spent==2000&&refund==1000);purchaseEvents++;
        }
        require(portalEvents==1&&purchaseEvents==1);
    }
    function testInvalidSecretAndInactivePortalRollback() public {
        RollingFundingRouter.Purchase memory p=purchase();p.secretHash=bytes32(0);vm.expectRevert();buy(p,3000);empty();
        AccountingRollup rollup=new AccountingRollup();portal=new PluginPortal(address(rollup),bytes32(uint256(4)),1,address(token));
        router=creditRouter(rollup);vm.expectRevert();buy(purchase(),3000);empty();
    }
    function testExactBudgetNeedsNoRefund() public {buy(purchase(),2000);require(alice.balance==1 ether-2000 && token.balanceOf(address(portal))==200);}
    function testSlippageFailureRollsBackEntirePurchase() public {vm.expectRevert();buy(purchase(),1999);empty();}
    function testPortalRejectionRollsBackSwap() public {RollingFundingRouter.Purchase memory p=purchase();p.commitment=bytes32(0);vm.expectRevert();buy(p,3000);empty();}
    function testNoLiquidityCannotLeavePartialExchange() public {dex.configure(true,false);vm.expectRevert();buy(purchase(),3000);empty();}
    function testIncorrectExchangeOutputCannotSpendDonations() public {
        token.seed(address(router),17);dex.configure(false,true);vm.expectRevert();buy(purchase(),3000);
        require(token.balanceOf(address(router))==17 && token.balanceOf(address(portal))==0 && token.balanceOf(address(dex))==10000);
    }
    function testExistingDonationsAreNotRefundedOrSpent() public {
        token.seed(address(router),17);weth.deposit{value:23}();weth.transfer(address(router),23);new FundingForce{value:31}(payable(address(router)));
        buy(purchase(),3000);require(alice.balance==1 ether-2000 && token.balanceOf(address(router))==17 && weth.balanceOf(address(router))==23 && address(router).balance==31);
    }
    function testExpiredQuoteAndChangedChainReject() public {
        RollingFundingRouter.Purchase memory p=purchase();vm.warp(p.deadline+1);vm.expectRevert();buy(p,3000);empty();
        p=purchase();vm.chainId(block.chainid+1);vm.expectRevert();buy(p,3000);empty();
    }
    function testRefundRejectionRollsBackPurchase() public {BokCreditBuyer buyer=new BokCreditBuyer();vm.expectRevert();buyer.buy{value:3000}(router,purchase(),true,false);empty();}
    function testRefundCannotReenter() public {BokCreditBuyer buyer=new BokCreditBuyer();buyer.buy{value:3000}(router,purchase(),false,true);require(buyer.blocked() && token.balanceOf(address(portal))==200);}
}
