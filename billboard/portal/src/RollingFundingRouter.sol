// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {BillboardPortal} from "./BillboardPortal.sol";
import {PluginPortal} from "./PluginPortal.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@oz/utils/ReentrancyGuard.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
interface FundingWETH is IERC20 { function deposit() external payable; function withdraw(uint256) external; }
interface FundingUsdc is IERC20 {
    function receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes calldata) external;
    function authorizationState(address,bytes32) external view returns(bool);
}
interface FundingFeePortal {
    function UNDERLYING() external view returns (IERC20);
    function ROLLUP() external view returns (address);
    function INBOX() external view returns (address);
    function VERSION() external view returns (uint256);
    function depositToAztecPublic(bytes32,uint256,bytes32) external returns (bytes32,uint256);
}
// Uniswap SwapRouter02 IV3SwapRouter, deliberately NOT legacy ISwapRouter's deadline tuple.
interface FundingSwapRouter {
    struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }
    function exactOutputSingle(ExactOutputSingleParams calldata) external payable returns (uint256);
}
/// @notice One router for signup, posting credit, and exact-output Bok credit purchases. Cross-chain claims remain asynchronous.
/// @dev Fresh fixed-scope deployments only. No custody/sweep/admin, arbitrary calls, token mint or gas subsidy.
contract RollingFundingRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    BillboardPortal public immutable collateralPortal;
    PluginPortal public immutable bokPortal;
    FundingFeePortal public immutable feePortal;
    FundingWETH public immutable weth;
    FundingSwapRouter public immutable swapRouter;
    IERC20 public immutable feeToken;
    IERC20 public immutable bokToken;
    bytes32 public immutable privateFpc;
    uint256 public immutable chainId;
    struct Purchase { bytes32 commitment; uint128 amount; bytes32 secretHash; uint24 poolFee; uint256 deadline; }
    struct Swap { uint256 amount; uint256 maxEth; uint24 poolFee; }
    struct Plan {
        address beneficiary; uint256 collateral; bytes32 collateralSecretHash;
        Swap fee; bytes32 feeSecretHash;
        Swap bok; bytes32 bokCommitment; bytes32 bokSecretHash;
        uint256 nonce; uint256 deadline;
    }
    struct UsdcSwap { uint256 amount; uint256 maxUsdc; uint24 poolFee; }
    struct UsdcAccounting { uint256 usdcBefore; uint256 ethBefore; uint256 wethBefore; uint256 feeBefore; uint256 collateralSpent; uint256 feeSpent; uint256 refund; }
    struct UsdcPlan {
        address beneficiary; address relayer;
        UsdcSwap collateral; bytes32 collateralSecretHash;
        UsdcSwap fee; bytes32 feeSecretHash;
        uint256 bokAmount; bytes32 bokCommitment; bytes32 bokSecretHash;
        uint256 nonce; uint256 validAfter; uint256 deadline; uint256 relayFeeUsdc; bytes32 authorizationSalt;
    }
    event CreditPurchased(address indexed payer, bytes32 indexed commitment, uint128 amount, bytes32 secretHash,
        bytes32 key, uint256 index, uint256 spentWei, uint256 refundWei);
    event UsdcFunded(address indexed beneficiary, bytes32 indexed planHash, address indexed relayer,
        uint256 collateral, uint256 feeAmount, uint256 bokAmount, uint256 collateralUsdc, uint256 feeUsdc, uint256 relayFeeUsdc, uint256 refund);
    event Funded(address indexed beneficiary, bytes32 indexed planHash, uint256 collateral, uint256 feeAmount, uint256 bokAmount,
        uint256 feeEth, uint256 bokEth, uint256 refund);
    constructor(address collateral_, address fee_, address bok_, address weth_, address swap_, bytes32 fpc_) {
        require(collateral_.code.length>0 && fee_.code.length>0 && bok_.code.length>0 && weth_.code.length>0 && swap_.code.length>0,"Invalid scope");
        collateralPortal=BillboardPortal(payable(collateral_)); feePortal=FundingFeePortal(fee_); bokPortal=PluginPortal(bok_);
        weth=FundingWETH(weth_); swapRouter=FundingSwapRouter(swap_); privateFpc=fpc_; chainId=block.chainid;
        feeToken=feePortal.UNDERLYING(); bokToken=bokPortal.token();
        require(uint256(fpc_)>0 && uint256(fpc_)<Constants.P,"Invalid FPC");
        require(address(feeToken).code.length>0 && address(bokToken).code.length>0 && address(feeToken)!=address(bokToken)
            && address(feeToken)!=weth_ && address(bokToken)!=weth_,"Invalid tokens");
        require(collateralPortal.L1_CHAIN_ID()==block.chainid && bokPortal.chainId()==block.chainid
            && feePortal.ROLLUP()==address(collateralPortal.ROLLUP()) && feePortal.INBOX()==address(collateralPortal.INBOX()) && feePortal.VERSION()==collateralPortal.VERSION()
            && bokPortal.version()==collateralPortal.VERSION() && address(bokPortal.inbox())==address(collateralPortal.INBOX())
            && address(bokPortal.outbox())==address(collateralPortal.OUTBOX()),"Mismatched scope");
    }
    function fund(Plan calldata p, bytes calldata consent) external payable nonReentrant {
        require(block.chainid==chainId && p.beneficiary==msg.sender && block.timestamp<=p.deadline,"Invalid funding owner/deadline");
        require(p.fee.amount>0 && p.fee.amount<=type(uint128).max && p.bok.amount<=type(uint128).max,"Invalid allocation");
        if(p.bok.amount==0)require(p.bok.maxEth==0 && p.bok.poolFee==0 && p.bokCommitment==bytes32(0) && p.bokSecretHash==bytes32(0),"Nonempty disabled Bok leg");
        require(msg.value==p.collateral+p.fee.maxEth+p.bok.maxEth,"Invalid funding value");
        uint256 baseline=address(this).balance-msg.value;
        uint256 wrappedBefore=weth.balanceOf(address(this));
        weth.deposit{value:p.fee.maxEth+p.bok.maxEth}();
        uint256 feeEth=_buy(feeToken,p.fee);
        uint256 bokEth=p.bok.amount==0 ? 0 : _buy(bokToken,p.bok);
        if(p.collateral>0)collateralPortal.depositFor{value:p.collateral}(p.beneficiary,p.collateralSecretHash,p.nonce,p.deadline,consent);
        else require(p.collateralSecretHash==bytes32(0) && p.nonce==0 && consent.length==0 && p.bok.amount==0,"Invalid fee-only funding");
        uint256 beforeFee=feeToken.balanceOf(address(this));
        uint256 portalFeeBefore=feeToken.balanceOf(address(feePortal));
        feeToken.forceApprove(address(feePortal),p.fee.amount);
        feePortal.depositToAztecPublic(privateFpc,p.fee.amount,p.feeSecretHash);
        feeToken.forceApprove(address(feePortal),0);
        require(feeToken.balanceOf(address(this))==beforeFee-p.fee.amount && feeToken.balanceOf(address(feePortal))==portalFeeBefore+p.fee.amount,"Fee debit mismatch");
        if(p.bok.amount>0)_depositBok(p.bokCommitment,uint128(p.bok.amount),p.bokSecretHash);
        uint256 refund=p.fee.maxEth+p.bok.maxEth-feeEth-bokEth;
        _refundEth(refund,baseline,wrappedBefore);
        emit Funded(msg.sender,keccak256(abi.encode(p)),p.collateral,p.fee.amount,p.bok.amount,feeEth,bokEth,refund);
    }
    /// @notice One ETH payment swaps only the requested Bok amount and bridges it.
    /// Signup and top-ups use the same immutable portal/token/router scope.
    function buyCredit(Purchase calldata p) external payable nonReentrant returns(bytes32 key,uint256 index) {
        require(block.chainid==chainId && block.timestamp<=p.deadline,"Invalid purchase chain/deadline");
        require(msg.value>0 && p.amount>0,"Invalid purchase value");
        uint256 baseline=address(this).balance-msg.value;
        uint256 wrappedBefore=weth.balanceOf(address(this));
        weth.deposit{value:msg.value}();
        uint256 spent=_swap(IERC20(address(weth)),bokToken,p.amount,msg.value,p.poolFee);
        (key,index)=_depositBok(p.commitment,p.amount,p.secretHash);
        uint256 refund=msg.value-spent;
        _refundEth(refund,baseline,wrappedBefore);
        emit CreditPurchased(msg.sender,p.commitment,p.amount,p.secretHash,key,index,spent,refund);
    }
    /// @notice The EIP3009 nonce commits every allocation, bound, beneficiary, executor,
    /// reimbursement and fresh salt to this chain/router. Token debit alone is insufficient.
    function usdcAuthorizationNonce(UsdcPlan calldata p) public view returns(bytes32) {
        return keccak256(abi.encode(bytes32("ROLLING_USDC_FUNDING_V1"),chainId,address(this),keccak256(abi.encode(p))));
    }
    /// @notice Relayer gas is reimbursed only on SUCCESS, from this user's exact signed USDC.
    /// A reverted transaction cannot reimburse gas; the relayer must preflight and bears that risk.
    function fundUsdc(UsdcPlan calldata p, bytes calldata collateralConsent, bytes calldata authorization) external nonReentrant {
        require(block.chainid==chainId && msg.sender==p.relayer && p.beneficiary!=address(0)
            && p.beneficiary!=address(this) && p.relayer!=address(this),"Invalid USDC owner/executor");
        require(block.timestamp>p.validAfter && block.timestamp<p.deadline && p.authorizationSalt!=bytes32(0),"Invalid USDC validity");
        require(p.fee.amount>0 && p.fee.amount<=type(uint128).max && p.bokAmount<=type(uint128).max
            && p.relayFeeUsdc>0,"Invalid USDC allocation");
        if(p.bokAmount==0)require(p.bokCommitment==bytes32(0) && p.bokSecretHash==bytes32(0),"Nonempty disabled Bok leg");
        UsdcAccounting memory state;
        state.usdcBefore=bokToken.balanceOf(address(this)); state.ethBefore=address(this).balance;
        state.wethBefore=weth.balanceOf(address(this)); state.feeBefore=feeToken.balanceOf(address(this));
        _receiveUsdc(p,authorization,state.usdcBefore);
        if(p.collateral.amount>0)state.collateralSpent=_swap(bokToken,IERC20(address(weth)),p.collateral.amount,p.collateral.maxUsdc,p.collateral.poolFee);
        else require(p.collateral.maxUsdc==0 && p.collateral.poolFee==0 && p.collateralSecretHash==bytes32(0)
            && p.nonce==0 && collateralConsent.length==0 && p.bokAmount==0,"Invalid fee-only USDC funding");
        state.feeSpent=_swap(bokToken,feeToken,p.fee.amount,p.fee.maxUsdc,p.fee.poolFee);
        if(p.collateral.amount>0){
            weth.withdraw(p.collateral.amount);
            collateralPortal.depositFor{value:p.collateral.amount}(p.beneficiary,p.collateralSecretHash,p.nonce,p.deadline,collateralConsent);
        }
        uint256 portalFeeBefore=feeToken.balanceOf(address(feePortal));
        feeToken.forceApprove(address(feePortal),p.fee.amount);
        feePortal.depositToAztecPublic(privateFpc,p.fee.amount,p.feeSecretHash);
        feeToken.forceApprove(address(feePortal),0);
        require(feeToken.balanceOf(address(this))==state.feeBefore && feeToken.balanceOf(address(feePortal))==portalFeeBefore+p.fee.amount,"Fee debit mismatch");
        if(p.bokAmount>0)_depositBok(p.bokCommitment,uint128(p.bokAmount),p.bokSecretHash);
        state.refund=p.collateral.maxUsdc+p.fee.maxUsdc-state.collateralSpent-state.feeSpent;
        _payUsdc(p.relayer,p.relayFeeUsdc);
        if(state.refund>0)_payUsdc(p.beneficiary,state.refund);
        require(bokToken.balanceOf(address(this))==state.usdcBefore && weth.balanceOf(address(this))==state.wethBefore && address(this).balance==state.ethBefore,"Retained USDC principal");
        emit UsdcFunded(p.beneficiary,keccak256(abi.encode(p)),p.relayer,p.collateral.amount,p.fee.amount,p.bokAmount,state.collateralSpent,state.feeSpent,p.relayFeeUsdc,state.refund);
    }
    function _receiveUsdc(UsdcPlan calldata p,bytes calldata authorization,uint256 beforeBalance) private {
        uint256 total=p.collateral.maxUsdc+p.fee.maxUsdc+p.bokAmount+p.relayFeeUsdc;
        bytes32 authorizationNonce=usdcAuthorizationNonce(p);
        FundingUsdc usdc=FundingUsdc(address(bokToken));
        require(!usdc.authorizationState(p.beneficiary,authorizationNonce),"Authorization spent");
        usdc.receiveWithAuthorization(p.beneficiary,address(this),total,p.validAfter,p.deadline,authorizationNonce,authorization);
        require(usdc.authorizationState(p.beneficiary,authorizationNonce) && bokToken.balanceOf(address(this))==beforeBalance+total,"USDC receipt mismatch");
    }
    function _payUsdc(address recipient,uint256 amount) private {
        uint256 beforeBalance=bokToken.balanceOf(recipient);bokToken.safeTransfer(recipient,amount);
        require(bokToken.balanceOf(recipient)==beforeBalance+amount,"USDC payment mismatch");
    }
    function _depositBok(bytes32 commitment,uint128 amount,bytes32 secretHash) private returns(bytes32 key,uint256 index) {
        uint256 beforeBok=bokToken.balanceOf(address(this));
        bokToken.forceApprove(address(bokPortal),amount);
        (key,index)=bokPortal.deposit(commitment,amount,secretHash);
        bokToken.forceApprove(address(bokPortal),0);
        require(bokToken.balanceOf(address(this))==beforeBok-amount,"Bok debit mismatch");
    }
    function _refundEth(uint256 refund,uint256 baseline,uint256 wrappedBefore) private {
        require(weth.balanceOf(address(this))==wrappedBefore+refund,"Wrapped balance mismatch");
        if(refund>0) { weth.withdraw(refund); (bool ok,)=msg.sender.call{value:refund}(""); require(ok,"Refund rejected"); }
        require(address(this).balance==baseline && weth.balanceOf(address(this))==wrappedBefore,"Retained ETH");
    }
    function _buy(IERC20 token, Swap calldata leg) private returns(uint256) {
        return _swap(IERC20(address(weth)),token,leg.amount,leg.maxEth,leg.poolFee);
    }
    function _swap(IERC20 input,IERC20 output,uint256 amount,uint256 maximum,uint24 poolFee) private returns(uint256 spent) {
        require(maximum>0 && (poolFee==100 || poolFee==500 || poolFee==3000 || poolFee==10000),"Invalid swap bound");
        uint256 beforeOutput=output.balanceOf(address(this)); uint256 beforeInput=input.balanceOf(address(this));
        input.forceApprove(address(swapRouter),maximum);
        spent=swapRouter.exactOutputSingle(FundingSwapRouter.ExactOutputSingleParams(address(input),address(output),poolFee,address(this),amount,maximum,0));
        input.forceApprove(address(swapRouter),0);
        require(spent>0 && spent<=maximum && input.balanceOf(address(this))==beforeInput-spent && output.balanceOf(address(this))==beforeOutput+amount,"Swap balance mismatch");
    }
    receive() external payable { require(msg.sender==address(weth),"Unsolicited ETH"); }
}
