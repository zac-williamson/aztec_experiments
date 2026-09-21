// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {ReentrancyGuard} from "@oz/utils/ReentrancyGuard.sol";
import {PortalMessages} from "./PortalMessages.sol";

/// @notice Fresh V1 ETH escrow. Deposits require an authenticated Ready message.
/// @dev No administrator refund/sweep or legacy receipt path. Forced ETH is surplus.
contract BillboardPortal is ReentrancyGuard {
    uint256 public immutable MIN_DEPOSIT;
    uint256 public immutable MAX_DEPOSIT;
    bytes32 public immutable L2_CONTRACT;
    IRollup public immutable ROLLUP;
    IInbox public immutable INBOX;
    IOutbox public immutable OUTBOX;
    uint256 public immutable VERSION;
    uint256 public immutable L1_CHAIN_ID;
    bytes32 public immutable CONFIG_HASH;

    mapping(address => uint128) public activeDeposit;
    uint256 public totalDeposited;
    bool public depositsEnabled;

    event Activated(bytes32 indexed configHash);
    event Deposited(address indexed depositor, uint128 amount, bytes32 secretHash, bytes32 key, uint256 index);
    event Withdrawn(address indexed depositor, uint128 amount);

    constructor(address rollup, bytes32 board, uint256 version, uint256 minDeposit, uint256 maxDeposit, bytes32 configHash) {
        require(rollup.code.length > 0, "Invalid rollup");
        require(uint256(board) > 0 && uint256(board) < Constants.P, "Invalid board");
        require(version > 0 && version <= type(uint32).max, "Invalid version");
        require(block.chainid > 0 && block.chainid <= type(uint64).max, "Invalid chain");
        require(minDeposit > 0 && minDeposit <= maxDeposit && maxDeposit <= type(uint96).max, "Invalid deposit bounds");
        require(uint256(configHash) > 0 && uint256(configHash) < Constants.P, "Invalid config hash");
        IInbox inbox = IRollup(rollup).getInbox();
        IOutbox outbox = IRollup(rollup).getOutbox();
        require(address(inbox).code.length > 0 && address(outbox).code.length > 0, "Invalid bridge");
        ROLLUP = IRollup(rollup);
        INBOX = inbox;
        OUTBOX = outbox;
        L2_CONTRACT = board;
        VERSION = version;
        L1_CHAIN_ID = block.chainid;
        MIN_DEPOSIT = minDeposit;
        MAX_DEPOSIT = maxDeposit;
        CONFIG_HASH = configHash;
    }

    /// @notice Any relayer may present Ready; no permission can bypass Outbox verification.
    function activate(uint256 epoch, uint256 checkpointCount, uint256 leafIndex, bytes32[] calldata path) external nonReentrant {
        require(!depositsEnabled, "Already activated");
        _consume(PortalMessages.ready(L1_CHAIN_ID, address(this), L2_CONTRACT, VERSION, CONFIG_HASH),
            epoch, checkpointCount, leafIndex, path);
        depositsEnabled = true;
        emit Activated(CONFIG_HASH);
    }

    function deposit(bytes32 secretHash) external payable nonReentrant returns (bytes32 key, uint256 index) {
        require(block.chainid == L1_CHAIN_ID, "Chain changed");
        require(depositsEnabled, "Deposits disabled");
        require(msg.value >= MIN_DEPOSIT, "Below min deposit");
        require(msg.value <= MAX_DEPOSIT, "Above max deposit");
        require(uint256(secretHash) > 0 && uint256(secretHash) < Constants.P, "Invalid secret hash");
        require(activeDeposit[msg.sender] == 0, "Already have an active deposit");
        uint128 amount = uint128(msg.value); // Constructor caps MAX_DEPOSIT at u96.
        activeDeposit[msg.sender] = amount;
        totalDeposited += amount;
        (key, index) = INBOX.sendL2Message(DataStructures.L2Actor(L2_CONTRACT, VERSION),
            PortalMessages.receipt(false, L1_CHAIN_ID, address(this), L2_CONTRACT, VERSION, msg.sender, amount), secretHash);
        emit Deposited(msg.sender, amount, secretHash, key, index);
    }

    /// @dev All effects and Outbox consumption revert if bridge verification or payment fails.
    function withdraw(uint256 epoch, uint256 checkpointCount, uint256 leafIndex, bytes32[] calldata path) external nonReentrant {
        uint128 amount = activeDeposit[msg.sender];
        require(amount != 0, "No active deposit");
        delete activeDeposit[msg.sender];
        totalDeposited -= amount;
        _consume(PortalMessages.receipt(true, L1_CHAIN_ID, address(this), L2_CONTRACT, VERSION,
            msg.sender, amount), epoch, checkpointCount, leafIndex, path);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function _consume(bytes32 content, uint256 epoch, uint256 checkpointCount, uint256 leafIndex, bytes32[] calldata path) private {
        require(block.chainid == L1_CHAIN_ID, "Chain changed");
        DataStructures.L2ToL1Msg memory message = DataStructures.L2ToL1Msg({
            sender: DataStructures.L2Actor(L2_CONTRACT, VERSION),
            recipient: DataStructures.L1Actor(address(this), L1_CHAIN_ID), content: content
        });
        OUTBOX.consume(message, Epoch.wrap(epoch), checkpointCount, leafIndex, path);
    }

    function getDeposit(address depositor) external view returns (uint128 amount) {
        return activeDeposit[depositor];
    }

    receive() external payable { revert("Unsolicited ETH"); }
}
