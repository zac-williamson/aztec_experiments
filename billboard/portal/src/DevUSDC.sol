// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {ERC20} from "@oz/token/ERC20/ERC20.sol";
/// Disposable local-chain fixture; cannot deploy on a public chain.
contract DevUSDC is ERC20 {
    constructor(address recipient) ERC20("Local USDC","USDC") {require(block.chainid==31337,"Local only");_mint(recipient,1000000000);}
    function decimals() public pure override returns(uint8) {return 6;}
}
