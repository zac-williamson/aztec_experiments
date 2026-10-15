// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {RollingFundingRouter,FundingSwapRouter} from "../src/RollingFundingRouter.sol";
import {BillboardPortal} from "../src/BillboardPortal.sol";
import {PluginPortal} from "../src/PluginPortal.sol";
import {AccountingRollup} from "./PortalArtifactRegression.t.sol";
import {ERC20} from "@oz/token/ERC20/ERC20.sol";
import {FeeJuicePortal} from "@aztec/core/messagebridge/FeeJuicePortal.sol";
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
interface FundingVm {function deal(address,uint256) external;function addr(uint256) external returns(address);function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);function prank(address) external;function expectRevert() external;function warp(uint256) external;function chainId(uint256) external;}
// Labelled reserve/accounting doubles. Mint provisions only test DEX reserves;
// production has no mint path. No live liquidity or rollup proof qualification.
contract FundingToken is ERC20 {constructor() ERC20("Fixture","FIX"){} function seed(address a,uint256 n) external {_mint(a,n);} }
contract FundingWrapped is ERC20 {
 constructor() ERC20("Fixture Wrapped","WETH"){} function deposit() external payable {_mint(msg.sender,msg.value);}
 function withdraw(uint256 n) external {_burn(msg.sender,n);(bool ok,)=msg.sender.call{value:n}("");require(ok);}
}
contract FundingDex {
 bool public fail; bool public lie; function configure(bool f,bool l) external {fail=f;lie=l;}
 function exactOutputSingle(FundingSwapRouter.ExactOutputSingleParams calldata p) external payable returns(uint256 n){
 require(!fail,"No liquidity"); n=p.amountOut*10; require(n<=p.amountInMaximum,"Slippage");
 IERC20(p.tokenIn).transferFrom(msg.sender,address(this),n);IERC20(p.tokenOut).transfer(p.recipient,p.amountOut-(lie?1:0)); }
}
contract FundingFeeBridge {
 IERC20 public immutable UNDERLYING; address public immutable ROLLUP; uint256 public constant VERSION=1;
 function INBOX() external view returns(address){return address(AccountingRollup(ROLLUP).getInbox());}
 bool public fail; bytes32 public recipient; uint256 public amount;
 constructor(address t,address r){UNDERLYING=IERC20(t);ROLLUP=r;} function setFail(bool f) external {fail=f;}
 function depositToAztecPublic(bytes32 to,uint256 n,bytes32) external returns(bytes32,uint256){require(!fail,"Fee bridge failed");UNDERLYING.transferFrom(msg.sender,address(this),n);recipient=to;amount+=n;return(bytes32(n),1);}
}
contract FundingConsentAccount {
 bytes32 public allowed;bool public rejectRefund;
 function configure(bytes32 digest,bool reject) external {allowed=digest;rejectRefund=reject;}
 function isValidSignature(bytes32 digest,bytes calldata) external view returns(bytes4){return digest==allowed?bytes4(0x1626ba7e):bytes4(0xffffffff);}
 function fund(RollingFundingRouter r,RollingFundingRouter.Plan calldata p) external payable {r.fund{value:msg.value}(p,hex"01");}
 receive() external payable {require(!rejectRefund);}
}
contract FundingForce {constructor(address payable a) payable {selfdestruct(a);}}
contract RollingFundingRouterTest {
 FundingVm constant vm=FundingVm(address(uint160(uint256(keccak256("hevm cheat code")))));
 AccountingRollup rollup; BillboardPortal portal;PluginPortal bok;FundingFeeBridge fee;FundingWrapped weth;FundingDex dex;
 FundingToken feeToken;FundingToken usdc;RollingFundingRouter router;address alice;uint256 constant KEY=123;
 function setUp() public {
 alice=vm.addr(KEY);rollup=new AccountingRollup();portal=new BillboardPortal(address(rollup),bytes32(uint256(1)),1,1 ether,2 ether,bytes32(uint256(2)));
 portal.activate(0,0,0,new bytes32[](0));feeToken=new FundingToken();usdc=new FundingToken();weth=new FundingWrapped();dex=new FundingDex();
 fee=new FundingFeeBridge(address(feeToken),address(rollup));bok=new PluginPortal(address(rollup),bytes32(uint256(4)),1,address(usdc));bok.activate(0,0,0,new bytes32[](0));
 router=new RollingFundingRouter(address(portal),address(fee),address(bok),address(weth),address(dex),bytes32(uint256(3)));
 feeToken.seed(address(dex),10000);usdc.seed(address(dex),10000);vm.deal(alice,10 ether);vm.deal(address(this),10 ether);
 }
 function plan(address who) private view returns(RollingFundingRouter.Plan memory p){p=RollingFundingRouter.Plan(who,1 ether,bytes32(uint256(11)),RollingFundingRouter.Swap(100,5000,3000),bytes32(uint256(12)),RollingFundingRouter.Swap(200,5000,500),bytes32(uint256(13)),bytes32(uint256(14)),0,block.timestamp+60);}
 function sign(RollingFundingRouter.Plan memory p) private returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(KEY,portal.depositForDigest(p.beneficiary,address(router),p.collateral,p.collateralSecretHash,p.nonce,p.deadline));return abi.encodePacked(r,s,v);}
 function submit(RollingFundingRouter.Plan memory p) private {bytes memory signature=sign(p);vm.prank(alice);router.fund{value:1 ether+10000}(p,signature);}
 function reject(RollingFundingRouter.Plan memory p) private {bytes memory signature=sign(p);vm.expectRevert();vm.prank(alice);router.fund{value:1 ether+10000}(p,signature);}
 function empty() private view {require(portal.getDeposit(alice)==0 && portal.depositNonces(alice)==0,"Collateral not reverted");require(fee.amount()==0 && usdc.balanceOf(address(bok))==0,"Token legs not reverted");require(address(router).balance==0 && weth.balanceOf(address(router))==0,"Principal retained");require(feeToken.balanceOf(address(dex))==10000 && usdc.balanceOf(address(dex))==10000,"Swap not reverted");}
 function testExactThreeDepositsRefundAndZeroApprovals() public {
 submit(plan(alice));require(portal.getDeposit(alice)==1 ether && portal.getDeposit(address(router))==0,"Wrong owner");require(alice.balance==9 ether-3000,"Wrong exact cost/refund");require(fee.amount()==100 && fee.recipient()==bytes32(uint256(3)),"Wrong private FPC");require(usdc.balanceOf(address(bok))==200,"Wrong Bok allocation");
 require(address(router).balance==0 && weth.balanceOf(address(router))==0 && feeToken.balanceOf(address(router))==0 && usdc.balanceOf(address(router))==0,"Retained principal");require(weth.allowance(address(router),address(dex))==0 && feeToken.allowance(address(router),address(fee))==0 && usdc.allowance(address(router),address(bok))==0,"Retained approval"); }
 function testInstalledFeeJuicePortalReceivesExactPaidTokens() public {
 FeeJuicePortal actual=new FeeJuicePortal(IRollup(address(rollup)),IERC20(address(feeToken)),rollup.getInbox(),1);
 router=new RollingFundingRouter(address(portal),address(actual),address(bok),address(weth),address(dex),bytes32(uint256(3)));
 submit(plan(alice));require(feeToken.balanceOf(address(actual))==100 && usdc.balanceOf(address(bok))==200 && portal.getDeposit(alice)==1 ether);
 require(alice.balance==9 ether-3000 && address(router).balance==0 && feeToken.allowance(address(router),address(actual))==0);
 }
 function testLastLegFailureRevertsAllSwapsDepositNonceAndFee() public {RollingFundingRouter.Plan memory p=plan(alice);p.bokCommitment=bytes32(0);reject(p);empty();}
 function testFeeLegFailureRollsBackCollateralAndSwaps() public {fee.setFail(true);reject(plan(alice));empty();}
 function testUnavailableLiquidityRejectsWithoutPrincipal() public {dex.configure(true,false);reject(plan(alice));empty();}
 function testMisreportedSwapOutputCannotSpendDonatedTokens() public {feeToken.seed(address(router),20);dex.configure(false,true);reject(plan(alice));empty();require(feeToken.balanceOf(address(router))==20);}
 function testSlippageCapRollsBack() public {RollingFundingRouter.Plan memory p=plan(alice);p.fee.maxEth=999;p.bok.maxEth=9001;reject(p);empty();}
 function testCannotStealBeneficiaryOrReplayConsent() public {RollingFundingRouter.Plan memory p=plan(alice);bytes memory signature=sign(p);vm.expectRevert();router.fund{value:1 ether+10000}(p,signature);submit(p);vm.expectRevert();vm.prank(alice);router.fund{value:1 ether+10000}(p,signature);require(portal.depositNonces(alice)==1);}
 function testExpiredConsentAndChangedChainFail() public {RollingFundingRouter.Plan memory p=plan(alice);bytes memory signature=sign(p);vm.warp(p.deadline+1);vm.expectRevert();vm.prank(alice);router.fund{value:1 ether+10000}(p,signature);empty();p=plan(alice);signature=sign(p);vm.chainId(block.chainid+1);vm.expectRevert();vm.prank(alice);router.fund{value:1 ether+10000}(p,signature);empty();}
 function testDonationRemainsSurplusAndCannotBeRefundedToUser() public {new FundingForce{value:123}(payable(address(router)));submit(plan(alice));require(address(router).balance==123 && alice.balance==9 ether-3000);}
 function testContractBeneficiaryConsentAndRejectedRefundAtomicity() public {FundingConsentAccount account=new FundingConsentAccount();RollingFundingRouter.Plan memory p=plan(address(account));account.configure(portal.depositForDigest(address(account),address(router),p.collateral,p.collateralSecretHash,0,p.deadline),true);vm.expectRevert();account.fund{value:1 ether+10000}(router,p);require(portal.getDeposit(address(account))==0 && portal.depositNonces(address(account))==0);empty();account.configure(portal.depositForDigest(address(account),address(router),p.collateral,p.collateralSecretHash,0,p.deadline),false);account.fund{value:1 ether+10000}(router,p);require(portal.getDeposit(address(account))==1 ether && address(account).balance==7000);}
}

// Circle EIP3009's verified payee/time/nonce/signature ordering, with test-only
// initial reserves. This double is NOT a live Circle proxy or named-wallet test.
import {EIP712} from "@oz/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@oz/utils/cryptography/SignatureChecker.sol";
contract FundingAuthorizedUsdc is FundingToken,EIP712 {
 mapping(address=>mapping(bytes32=>bool)) public authorizationState;
 constructor() EIP712("USDC","2") {}
 function digest(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce) public view returns(bytes32){
 return _hashTypedDataV4(keccak256(abi.encode(keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),from,to,value,validAfter,validBefore,nonce))); }
 function receiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes calldata signature) external {
 require(to==msg.sender && block.timestamp>validAfter && block.timestamp<validBefore && !authorizationState[from][nonce],"Invalid authorization");
 require(SignatureChecker.isValidSignatureNow(from,digest(from,to,value,validAfter,validBefore,nonce),signature),"Invalid signature");
 authorizationState[from][nonce]=true;_transfer(from,to,value);
 }
}
contract RollingUsdcFundingRouterTest {
 FundingVm constant vm=FundingVm(address(uint160(uint256(keccak256("hevm cheat code")))));
 BillboardPortal portal;PluginPortal bok;FundingFeeBridge fee;FundingWrapped weth;FundingDex dex;
 FundingToken feeToken;FundingAuthorizedUsdc usdc;RollingFundingRouter router;address alice;address relayer=address(0x222);uint256 constant KEY=123;
 function setUp() public {
 vm.warp(100);alice=vm.addr(KEY);AccountingRollup rollup=new AccountingRollup();portal=new BillboardPortal(address(rollup),bytes32(uint256(1)),1,1 ether,2 ether,bytes32(uint256(2)));portal.activate(0,0,0,new bytes32[](0));
 feeToken=new FundingToken();usdc=new FundingAuthorizedUsdc();weth=new FundingWrapped();dex=new FundingDex();fee=new FundingFeeBridge(address(feeToken),address(rollup));
 bok=new PluginPortal(address(rollup),bytes32(uint256(4)),1,address(usdc));bok.activate(0,0,0,new bytes32[](0));router=new RollingFundingRouter(address(portal),address(fee),address(bok),address(weth),address(dex),bytes32(uint256(3)));
 feeToken.seed(address(dex),10000);usdc.seed(alice,100 ether);vm.deal(address(this),10 ether);weth.deposit{value:5 ether}();weth.transfer(address(dex),5 ether);vm.deal(relayer,1 ether);require(alice.balance==0);
 }
 function plan() private view returns(RollingFundingRouter.UsdcPlan memory p){
 p=RollingFundingRouter.UsdcPlan(alice,relayer,RollingFundingRouter.UsdcSwap(1 ether,20 ether,500),bytes32(uint256(11)),RollingFundingRouter.UsdcSwap(100,5000,3000),bytes32(uint256(12)),200,bytes32(uint256(13)),bytes32(uint256(14)),0,0,block.timestamp+60,50,bytes32(uint256(77))); }
 function signature(bytes32 digest) private returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(KEY,digest);return abi.encodePacked(r,s,v);}
 function signatures(RollingFundingRouter.UsdcPlan memory p) private returns(bytes memory consent,bytes memory auth){
 consent=signature(portal.depositForDigest(alice,address(router),p.collateral.amount,p.collateralSecretHash,p.nonce,p.deadline));
 auth=signature(usdc.digest(alice,address(router),p.collateral.maxUsdc+p.fee.maxUsdc+p.bokAmount+p.relayFeeUsdc,p.validAfter,p.deadline,router.usdcAuthorizationNonce(p))); }
 function submit(RollingFundingRouter.UsdcPlan memory p) private { (bytes memory consent,bytes memory auth)=signatures(p);vm.prank(relayer);router.fundUsdc(p,consent,auth); }
 function unchanged(RollingFundingRouter.UsdcPlan memory p) private view {
 require(usdc.balanceOf(alice)==100 ether && usdc.balanceOf(relayer)==0 && !usdc.authorizationState(alice,router.usdcAuthorizationNonce(p)),"Auth/payment not atomic");
 require(portal.getDeposit(alice)==0 && portal.depositNonces(alice)==0 && fee.amount()==0 && usdc.balanceOf(address(bok))==0,"Deposits not atomic");
 require(address(router).balance==0 && weth.balanceOf(address(router))==0 && feeToken.balanceOf(address(router))==0 && usdc.balanceOf(address(router))==0,"Retained principal"); }
 function testZeroEthBeneficiaryPaysExactUsdcIncludingRelayerAndRefund() public {
 RollingFundingRouter.UsdcPlan memory p=plan();submit(p);require(alice.balance==0 && portal.getDeposit(alice)==1 ether && portal.getDeposit(relayer)==0);
 require(usdc.balanceOf(alice)==90 ether-1250 && usdc.balanceOf(relayer)==50 && usdc.balanceOf(address(bok))==200 && fee.amount()==100,"Exact allocation/refund mismatch");
 require(usdc.authorizationState(alice,router.usdcAuthorizationNonce(p)) && usdc.allowance(alice,address(router))==0 && usdc.allowance(address(router),address(dex))==0 && usdc.allowance(address(router),address(bok))==0 && feeToken.allowance(address(router),address(fee))==0,"Nonce/allowance mismatch");
 require(address(router).balance==0 && usdc.balanceOf(address(router))==0 && weth.balanceOf(address(router))==0 && feeToken.balanceOf(address(router))==0);
 }
 function testWrongExecutorCannotTakeSignedRelayFee() public {RollingFundingRouter.UsdcPlan memory p=plan();(bytes memory c,bytes memory a)=signatures(p);vm.expectRevert();router.fundUsdc(p,c,a);unchanged(p);}
 function testAuthorizationNonceBindsMutatedAllocationAndRelayer() public {
 RollingFundingRouter.UsdcPlan memory p=plan();bytes32 n=router.usdcAuthorizationNonce(p);(bytes memory c,bytes memory a)=signatures(p);
 p.relayFeeUsdc++;require(router.usdcAuthorizationNonce(p)!=n);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);p=plan();p.bokCommitment=bytes32(uint256(99));vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);
 p=plan();p.relayer=address(0x333);vm.expectRevert();vm.prank(p.relayer);router.fundUsdc(p,c,a);unchanged(plan());
 }
 function testAuthorizationCannotCrossRouterOrChain() public {
 RollingFundingRouter.UsdcPlan memory p=plan();bytes32 original=router.usdcAuthorizationNonce(p);(bytes memory c,bytes memory a)=signatures(p);
 RollingFundingRouter other=new RollingFundingRouter(address(portal),address(fee),address(bok),address(weth),address(dex),bytes32(uint256(3)));
 require(other.usdcAuthorizationNonce(p)!=original,"Router domain omitted");vm.expectRevert();vm.prank(relayer);other.fundUsdc(p,c,a);unchanged(p);
 vm.chainId(block.chainid+1);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);
 }
 function testDirectAuthorizationFrontRunCannotConsumeRouterPayeeNonce() public {
 RollingFundingRouter.UsdcPlan memory p=plan();(,bytes memory a)=signatures(p);bytes32 n=router.usdcAuthorizationNonce(p);
 vm.expectRevert();vm.prank(relayer);usdc.receiveWithAuthorization(alice,address(router),p.collateral.maxUsdc+p.fee.maxUsdc+p.bokAmount+p.relayFeeUsdc,p.validAfter,p.deadline,n,a);
 unchanged(p);submit(p);require(usdc.authorizationState(alice,n) && usdc.balanceOf(relayer)==50);
 }
 function testLastLegRevertRestoresAuthorizationSwapCollateralAndFee() public {RollingFundingRouter.UsdcPlan memory p=plan();p.bokCommitment=bytes32(0);(bytes memory c,bytes memory a)=signatures(p);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);}
 function testFeeFailureRevertsAuthorizationAndNoRelayReimbursement() public {RollingFundingRouter.UsdcPlan memory p=plan();fee.setFail(true);(bytes memory c,bytes memory a)=signatures(p);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);}
 function testNoLiquidityOrSlippageDoesNotConsumeAuthorization() public {RollingFundingRouter.UsdcPlan memory p=plan();dex.configure(true,false);(bytes memory c,bytes memory a)=signatures(p);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);dex.configure(false,false);p.collateral.maxUsdc=1;(c,a)=signatures(p);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);}
 function testReplayAndExpiredAuthorizationRejected() public {RollingFundingRouter.UsdcPlan memory p=plan();(bytes memory c,bytes memory a)=signatures(p);vm.warp(p.deadline);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);unchanged(p);p=plan();(c,a)=signatures(p);vm.prank(relayer);router.fundUsdc(p,c,a);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,c,a);require(usdc.balanceOf(relayer)==50);}
 function testDonationsAreNeverUserRefundOrFee() public {usdc.seed(address(router),999);new FundingForce{value:123}(payable(address(router)));submit(plan());require(usdc.balanceOf(address(router))==999 && address(router).balance==123 && usdc.balanceOf(relayer)==50 && usdc.balanceOf(alice)==90 ether-1250);}
 function testWrongCollateralConsentRollsBackAuthorizedDebit() public {RollingFundingRouter.UsdcPlan memory p=plan();(,bytes memory a)=signatures(p);vm.expectRevert();vm.prank(relayer);router.fundUsdc(p,hex"01",a);unchanged(p);}
}
