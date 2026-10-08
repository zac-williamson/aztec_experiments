// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// Ethereum payment protocol v1. Aztec and execution services consume this API,
/// not this implementation. No bridge, escrow, callback or inference dependency.
contract PluginPayments {
    struct Payment { address payer; uint256 amount; bytes32 messageHash; }
    address public immutable owner;
    bytes32 public immutable scope;
    uint256 public immutable minimumAmount;
    mapping(bytes32 => mapping(bytes32 => Payment)) public payments;
    uint256 private entered;

    event PluginPaid(bytes32 indexed postId, address indexed payer, uint256 amount, bytes32 messageHash);
    event Withdrawn(address indexed recipient, uint256 amount);
    error InvalidPayment();
    error AlreadyPaid();
    error Unauthorized();
    error TransferFailed();

    constructor(address owner_, bytes32 scope_, uint256 minimumAmount_) {
        if (owner_ == address(0) || scope_ == bytes32(0) || minimumAmount_ == 0) revert InvalidPayment();
        owner = owner_;
        scope = scope_;
        minimumAmount = minimumAmount_;
    }

    function protocolVersion() external pure returns (uint256) { return 1; }

    function pay(bytes32 postId, bytes32 messageHash) external payable {
        if (postId == bytes32(0) || messageHash == bytes32(0) || msg.value < minimumAmount) revert InvalidPayment();
        if (payments[postId][messageHash].amount != 0) revert AlreadyPaid();
        payments[postId][messageHash] = Payment(msg.sender, msg.value, messageHash);
        emit PluginPaid(postId, msg.sender, msg.value, messageHash);
    }

    function withdraw(address payable recipient, uint256 amount) external {
        if (msg.sender != owner || entered != 0) revert Unauthorized();
        if (recipient == address(0)) revert InvalidPayment();
        entered = 1;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        entered = 0;
        emit Withdrawn(recipient, amount);
    }
}
