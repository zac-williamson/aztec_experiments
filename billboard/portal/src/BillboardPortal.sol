// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

/// @title BillboardPortal
/// @notice L1 portal for the anonymous billboard. Accepts ETH deposits,
///         sends L1->L2 messages, and processes L2->L1 withdrawal messages.
///
/// Deposit flow:
///   1. User calls deposit(secretHash) with ETH (any amount >= 0.001 ETH)
///   2. Portal records the deposit and sends an L1->L2 message
///   3. On L2, the user calls Billboard.claim_deposit() to consume the
///      message and create a private DepositNote
///
/// Withdrawal flow:
///   1. On L2, user calls Billboard.withdraw() which consumes the note
///      and sends an L2->L1 message with content = hash(depositor, amount)
///   2. After the epoch proof is submitted, the user calls withdraw()
///      on this portal to consume the Outbox message and claim ETH
///   3. The portal reads the amount from deposits[msg.sender] -- the user
///      does NOT supply the amount. The L2->L1 message content includes
///      the amount, so the portal cryptographically verifies the amount
///      matches.
///
/// Security:
///   - One active deposit per L1 address (can't deposit if already have one)
///   - Withdraw amount is NOT user-supplied -- comes from deposits[msg.sender]
///   - L2->L1 message includes amount in content hash, preventing amount forgery
///   - After withdrawal, deposits[msg.sender] is set to 0, allowing re-deposit
contract BillboardPortal {
    using Hash for bytes;

    /// @notice Minimum deposit (0.001 ETH)
    uint256 public constant MIN_DEPOSIT = 0.001 ether;

    /// @notice The L2 billboard contract address
    bytes32 public immutable L2_CONTRACT;

    /// @notice The Aztec rollup contract
    IRollup public immutable ROLLUP;

    /// @notice The inbox for sending L1->L2 messages
    IInbox public immutable INBOX;

    /// @notice The Aztec version
    uint256 public immutable VERSION;

    /// @notice Deposits per user: depositor => amount
    /// @dev A non-zero value means the user has an active deposit.
    ///      Set to 0 on withdrawal, allowing re-deposit.
    mapping(address => uint256) public deposits;

    /// @notice Total ETH deposited (for accounting)
    uint256 public totalDeposited;

    event Deposited(address indexed depositor, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index);
    event Withdrawn(address indexed depositor, uint256 amount);

    constructor(address _rollup, bytes32 _l2Contract, uint256 _version) {
        ROLLUP = IRollup(_rollup);
        INBOX = IRollup(_rollup).getInbox();
        L2_CONTRACT = _l2Contract;
        VERSION = _version;
    }

    /// @notice Deposit ETH and send an L1->L2 message
    /// @param _secretHash Hash of the claim secret (computed as poseidon2(secret) with domain separator)
    /// @return key The message key in the Inbox
    /// @return index The leaf index in the Inbox tree
    /// @dev Reverts if the user already has an active deposit (deposits[msg.sender] > 0)
    function deposit(bytes32 _secretHash) external payable returns (bytes32 key, uint256 index) {
        require(msg.value >= MIN_DEPOSIT, "Below min deposit");
        require(msg.value <= type(uint128).max, "Amount too large");
        // Enforce one active deposit per address
        require(deposits[msg.sender] == 0, "Already have an active deposit");

        // Record the deposit
        deposits[msg.sender] = msg.value;
        totalDeposited += msg.value;

        // Send L1->L2 message
        DataStructures.L2Actor memory actor = DataStructures.L2Actor(L2_CONTRACT, VERSION);

        // Content hash matches what the L2 contract computes in get_deposit_msg_hash():
        //   sha256ToField(abi.encodeWithSignature("claim_deposit(bytes32,uint256)", depositor, amount))
        bytes32 contentHash = Hash.sha256ToField(
            abi.encodeWithSignature("claim_deposit(bytes32,uint256)", bytes32(uint256(uint160(msg.sender))), msg.value)
        );

        (key, index) = INBOX.sendL2Message(actor, contentHash, _secretHash);

        emit Deposited(msg.sender, msg.value, _secretHash, key, index);
    }

    /// @notice Withdraw ETH by consuming an L2->L1 message
    /// @dev The amount is NOT a parameter -- it comes from deposits[msg.sender].
    ///      The L2->L1 message content includes the amount (as a hash), so the
    ///      portal cryptographically verifies the amount matches.
    /// @param _epoch The epoch containing the L2->L1 message
    /// @param _numCheckpointsInEpoch Number of checkpoints in the epoch
    /// @param _leafIndex The leaf index in the Outbox tree
    /// @param _path The sibling path for the Merkle proof
    function withdraw(uint256 _epoch, uint256 _numCheckpointsInEpoch, uint256 _leafIndex, bytes32[] calldata _path) external {
        uint256 amount = deposits[msg.sender];
        require(amount > 0, "No active deposit");

        // Construct the L2->L1 message with amount in content hash
        // Content = sha256ToField(abi.encodePacked(depositor_as_bytes32, amount))
        // This matches L2's get_withdraw_msg_hash(depositor, amount)
        DataStructures.L2ToL1Msg memory message = DataStructures.L2ToL1Msg({
            sender: DataStructures.L2Actor(L2_CONTRACT, VERSION),
            recipient: DataStructures.L1Actor(address(this), block.chainid),
            content: Hash.sha256ToField(abi.encodePacked(bytes32(uint256(uint160(msg.sender))), amount))
        });

        // Consume the Outbox message (reverts if not found or already consumed)
        IOutbox outbox = ROLLUP.getOutbox();
        outbox.consume(message, Epoch.wrap(_epoch), _numCheckpointsInEpoch, _leafIndex, _path);

        // Update deposit record and send ETH
        deposits[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Get the deposit amount for a user
    function getDeposit(address user) external view returns (uint256) {
        return deposits[user];
    }

    /// @notice Fallback to receive ETH (not used, but good practice)
    receive() external payable {}
}
