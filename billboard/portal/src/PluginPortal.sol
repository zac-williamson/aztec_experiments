// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@oz/utils/ReentrancyGuard.sol";
/// Funds cannot leave without a withdrawal authenticated by this plugin's Aztec escrow.
contract PluginPortal is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    IInbox public immutable inbox;
    IOutbox public immutable outbox;
    bytes32 public immutable escrow;
    uint256 public immutable version;
    uint256 public immutable chainId;
    bool public active;
    event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index);
    event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce);
    constructor(address rollup,bytes32 escrow_,uint256 version_,address token_) {
        require(rollup.code.length>0 && token_.code.length>0 && uint256(escrow_)>0 && uint256(escrow_)<Constants.P && version_>0,"Invalid configuration");
        token=IERC20(token_);escrow=escrow_;version=version_;chainId=block.chainid;
        inbox=IRollup(rollup).getInbox();outbox=IRollup(rollup).getOutbox();
    }
    function activate(uint256 epoch,uint256 checkpoints,uint256 index,bytes32[] calldata path) external nonReentrant {
        require(!active,"Already active");
        consume(Hash.sha256ToField(abi.encode(bytes32("PLUGIN_READY_V1"),chainId,address(this),escrow,version)),epoch,checkpoints,index,path);
        active=true;
    }
    function deposit(bytes32 account,uint128 amount,bytes32 secretHash) external nonReentrant returns(bytes32 key,uint256 index) {
        require(active && block.chainid==chainId,"Not active");
        require(amount>0 && uint256(account)>0 && uint256(account)<Constants.P && uint256(secretHash)>0 && uint256(secretHash)<Constants.P,"Invalid deposit");
        uint256 beforeBalance=token.balanceOf(address(this));token.safeTransferFrom(msg.sender,address(this),amount);
        require(token.balanceOf(address(this))-beforeBalance==amount,"Unsupported token transfer");
        bytes32 content=Hash.sha256ToField(abi.encode(bytes32("PLUGIN_CREDIT_V1"),chainId,address(this),escrow,version,account,amount));
        (key,index)=inbox.sendL2Message(DataStructures.L2Actor(escrow,version),content,secretHash);
        emit Deposited(account,amount,key,index);
    }
    function withdraw(address recipient,uint128 amount,bytes32 nonce,uint256 epoch,uint256 checkpoints,uint256 index,bytes32[] calldata path) external nonReentrant {
        require(recipient!=address(0) && amount>0,"Invalid withdrawal");
        consume(Hash.sha256ToField(abi.encode(bytes32("PLUGIN_EXIT_V1"),chainId,address(this),escrow,version,recipient,amount,nonce)),epoch,checkpoints,index,path);
        token.safeTransfer(recipient,amount);emit Withdrawn(recipient,amount,nonce);
    }
    function consume(bytes32 content,uint256 epoch,uint256 checkpoints,uint256 index,bytes32[] calldata path) private {
        require(block.chainid==chainId,"Wrong chain");
        outbox.consume(DataStructures.L2ToL1Msg({sender:DataStructures.L2Actor(escrow,version),recipient:DataStructures.L1Actor(address(this),chainId),content:content}),Epoch.wrap(epoch),checkpoints,index,path);
    }
}
