// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {PluginPayments} from "../src/PluginPayments.sol";
interface PluginVm { function deal(address,uint256) external; function prank(address) external; function expectRevert(bytes4) external; }
contract PluginPaymentsTest {
    PluginVm constant vm=PluginVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PluginPayments pay;
    bytes32 constant POST=bytes32(uint256(10));
    bytes32 constant HASH=bytes32(uint256(20));
    function setUp() public { vm.deal(address(this),10 ether); pay=new PluginPayments(address(this),bytes32(uint256(1)),1 ether); }
    function testWrongHashCannotPoisonLegitimatePayment() public {
        pay.pay{value:1 ether}(POST,bytes32(uint256(99)));
        pay.pay{value:1 ether}(POST,HASH);
        (address payer,uint256 amount,bytes32 hash)=pay.payments(POST,HASH);
        require(payer==address(this)&&amount==1 ether&&hash==HASH);
    }
    function testDustCannotConsumeInvocation() public {
        vm.expectRevert(PluginPayments.InvalidPayment.selector);
        pay.pay{value:1}(POST,HASH);
        pay.pay{value:1 ether}(POST,HASH);
    }
    function testDuplicateRejected() public {
        pay.pay{value:1 ether}(POST,HASH);
        vm.expectRevert(PluginPayments.AlreadyPaid.selector);
        pay.pay{value:1 ether}(POST,HASH);
    }
    function testOnlyOwnerWithdraws() public {
        pay.pay{value:1 ether}(POST,HASH);
        vm.prank(address(123)); vm.expectRevert(PluginPayments.Unauthorized.selector);
        pay.withdraw(payable(address(123)),1 ether);
        pay.withdraw(payable(address(123)),1 ether);
        require(address(123).balance==1 ether);
        (,uint256 amount,)=pay.payments(POST,HASH);require(amount==1 ether);
    }
}
