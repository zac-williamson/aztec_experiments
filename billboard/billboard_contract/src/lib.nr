use aztec::protocol::address::EthAddress;
use aztec::protocol::hash::sha256_to_field;
use aztec::protocol::traits::ToField;

/// Computes the content hash for an L1-to-L2 "claim_deposit" message,
/// matching the hash produced on L1 by the portal's `deposit` function:
///   Hash.sha256ToField(
///     abi.encodeWithSignature("claim_deposit(bytes32,uint256)", depositor, amount)
///   )
///
/// The 68-byte buffer is:
///   [4-byte keccak selector][32-byte depositor][32-byte amount]
/// hashed with sha256_to_field to produce a single Field.
pub fn get_deposit_msg_hash(depositor: EthAddress, amount: u128) -> Field {
    let mut hash_bytes = [0; 68];
    let depositor_bytes: [u8; 32] = depositor.to_field().to_be_bytes();
    let amount_bytes: [u8; 32] = (amount as Field).to_be_bytes();

    let selector = comptime { keccak256::keccak256("claim_deposit(bytes32,uint256)".as_bytes(), 30) };

    for i in 0..4 {
        hash_bytes[i] = selector[i];
    }

    for i in 0..32 {
        hash_bytes[i + 4] = depositor_bytes[i];
        hash_bytes[i + 36] = amount_bytes[i];
    }

    sha256_to_field(hash_bytes)
}

/// Computes the content hash for an L2-to-L1 "withdraw" message.
/// The content is sha256ToField(abi.encodePacked(depositor_as_bytes32, amount_as_uint256)).
///
/// This matches the L1 portal's `withdraw` function:
///   Hash.sha256ToField(abi.encodePacked(bytes32(uint256(uint160(msg.sender))), amount))
///
/// The 64-byte buffer is:
///   [32-byte depositor (left-padded address)][32-byte amount]
pub fn get_withdraw_msg_hash(depositor: EthAddress, amount: u128) -> Field {
    let mut hash_bytes = [0; 64];
    let depositor_bytes: [u8; 32] = depositor.to_field().to_be_bytes();
    let amount_bytes: [u8; 32] = (amount as Field).to_be_bytes();

    for i in 0..32 {
        hash_bytes[i] = depositor_bytes[i];
        hash_bytes[i + 32] = amount_bytes[i];
    }

    sha256_to_field(hash_bytes)
}

/// Computes the cooldown interval for a given deposit amount.
/// cooldown = COOLDOWN_BASE_SECONDS * MIN_DEPOSIT_WEI / amount
///
/// For 0.001 ETH (min deposit):  3600s  (1 hour)
/// For 0.01 ETH:                  360s  (6 minutes)
/// For 0.1 ETH:                    36s
/// For 1 ETH:                       3s  (truncated from 3.6)
///
/// A larger deposit grants a shorter cooldown, allowing more frequent posts.
/// The amount is private (stored in a private note), so the cooldown is also
/// private. The ZK proof guarantees the cooldown was computed correctly.
pub fn compute_cooldown(amount: u128, cooldown_base_seconds: u64, min_deposit_wei: u128) -> u64 {
    // Use u128 arithmetic to avoid overflow:
    // 3600 * 1_000_000_000_000_000 = 3_600_000_000_000_000_000 (fits in u128)
    let numerator = (cooldown_base_seconds as u128) * min_deposit_wei;
    let cooldown = numerator / amount;
    // Ensure minimum 1 second to avoid zero-cooldown spam
    if cooldown == 0 { 1 } else { cooldown as u64 }
}
