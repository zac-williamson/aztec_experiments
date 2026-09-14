use aztec::protocol::{address::{AztecAddress, EthAddress}, hash::{sha256_to_field, poseidon2_hash_with_separator}, traits::ToField};

/// Fixed-width, right-zero-padded ASCII domain followed by canonical 32-byte words.
pub fn encode_words<let N: u32, let D: u32>(domain: str<D>, words: [Field; N]) -> [u8; 32 + N * 32] {
    std::static_assert(D <= 32, "Domain must fit one word");
    let mut output = [0; 32 + N * 32];
    let ascii = domain.as_bytes();
    for i in 0..D { output[i] = ascii[i]; }
    for i in 0..N {
        let bytes: [u8; 32] = words[i].to_be_bytes();
        for j in 0..32 { output[32 + i * 32 + j] = bytes[j]; }
    }
    output
}

pub fn get_config_hash(chain: u64, rollup: EthAddress, board: AztecAddress, version: u32,
    minimum: u128, maximum: u128, base: u32, k: u16, window: u32, saved: u16) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_CONFIG_V1", [1, chain as Field, rollup.to_field(), board.to_field(),
        version as Field, minimum as Field, maximum as Field, base as Field, k as Field, window as Field, saved as Field]))
}

pub fn get_ready_msg_hash(chain: u64, portal: EthAddress, board: AztecAddress, version: u32, config: Field) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_READY_V1", [1, chain as Field, portal.to_field(), board.to_field(), version as Field, config]))
}

pub fn get_deposit_msg_hash(chain: u64, portal: EthAddress, board: AztecAddress, version: u32,
    depositor: EthAddress, nonce: u64, amount: u128) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_CLAIM_V1", [1, chain as Field, portal.to_field(), board.to_field(),
        version as Field, depositor.to_field(), nonce as Field, amount as Field]))
}

pub fn get_withdraw_msg_hash(chain: u64, portal: EthAddress, board: AztecAddress, version: u32,
    depositor: EthAddress, nonce: u64, amount: u128) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_EXIT_V1", [1, chain as Field, portal.to_field(), board.to_field(),
        version as Field, depositor.to_field(), nonce as Field, amount as Field]))
}

pub fn deposit_chain_id(board: AztecAddress, owner: AztecAddress, content: Field, secret: Field) -> Field {
    poseidon2_hash_with_separator([1, board.to_field(), owner.to_field(), content, secret], 0x42420101)
}

pub fn post_link(board: AztecAddress, owner: AztecAddress, chain: Field, sequence: u64, inner_hash: Field, secret: Field) -> Field {
    poseidon2_hash_with_separator([1, board.to_field(), owner.to_field(), chain, sequence as Field, inner_hash, secret], 0x42420103)
}

/// Ceiling division without numerator + amount overflow. Inputs obey V1 bounds.
pub fn compute_cooldown(amount: u128, cooldown_base_seconds: u64, min_deposit_wei: u128) -> u64 {
    assert((min_deposit_wei > 0) & (min_deposit_wei <= 0xffffffffffffffffffffffff), "Invalid minimum deposit");
    assert((amount >= min_deposit_wei) & (amount <= 0xffffffffffffffffffffffff), "Invalid deposit amount");
    assert((cooldown_base_seconds > 0) & (cooldown_base_seconds <= 0xffffffff), "Invalid base cooldown");
    let numerator = (cooldown_base_seconds as u128) * min_deposit_wei;
    let quotient = numerator / amount;
    let result = quotient + if numerator % amount == 0 { 0 } else { 1 };
    result as u64
}

pub fn checked_time_add(time: u64, interval: u64) -> u64 {
    assert(time <= 0x7fffffffffffffff, "Timestamp out of range");
    assert(interval <= 0x7fffffffffffffff - time, "Eligibility timestamp overflow");
    time + interval
}

/// Canonical 31-byte big-endian fields, nonempty UTF-8, no NUL or hidden padding.
pub fn validate_policy(policy: [Field; 48], length: u32) {
    assert(length > 0, "Policy must not be empty");
    assert(length <= 1488, "Policy too long");
    let mut remaining: u8 = 0;
    let mut lower: u8 = 0x80;
    let mut upper: u8 = 0xbf;
    for i in 0..48 {
        let bytes: [u8; 32] = policy[i].to_be_bytes();
        assert(bytes[0] == 0, "Policy field exceeds 31 bytes");
        for j in 0..31 {
            let byte = bytes[j + 1];
            if i * 31 + j >= length {
                assert(byte == 0, "Nonzero policy padding");
            } else if remaining > 0 {
                assert((byte >= lower) & (byte <= upper), "Invalid policy UTF-8 continuation");
                remaining -= 1;
                lower = 0x80;
                upper = 0xbf;
            } else {
                assert(byte > 0, "Policy contains NUL");
                if byte < 0x80 {
                } else if (byte >= 0xc2) & (byte <= 0xdf) {
                    remaining = 1;
                } else if (byte >= 0xe0) & (byte <= 0xef) {
                    remaining = 2;
                    lower = if byte == 0xe0 { 0xa0 } else { 0x80 };
                    upper = if byte == 0xed { 0x9f } else { 0xbf };
                } else {
                    assert((byte >= 0xf0) & (byte <= 0xf4), "Invalid policy UTF-8 lead");
                    remaining = 3;
                    lower = if byte == 0xf0 { 0x90 } else { 0x80 };
                    upper = if byte == 0xf4 { 0x8f } else { 0xbf };
                }
            }
        }
    }
    assert(remaining == 0, "Truncated policy UTF-8");
}

use aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Deserialize, Eq, Serialize)]
pub struct ReceiptMetadata {
    pub schema_version: u32,
    pub deposit_nonce: u64,
}
impl Packable for ReceiptMetadata {
    let N: u32 = 1;
    fn pack(self) -> [Field; 1] {
        [self.schema_version as Field + (self.deposit_nonce as Field) * 0x100000000]
    }
    fn unpack(fields: [Field; 1]) -> Self {
        let value = fields[0] as u128;
        let result = Self { schema_version: value as u32, deposit_nonce: (value >> 32) as u64 };
        assert_eq(result.pack(), fields, "Noncanonical receipt metadata");
        result
    }
}

#[derive(Deserialize, Eq, Serialize)]
pub struct SequenceState {
    pub head_sequence: u64,
    pub screened_sequence: u64,
    pub last_real_sequence: u64,
}
impl Packable for SequenceState {
    let N: u32 = 1;
    fn pack(self) -> [Field; 1] {
        [self.head_sequence as Field + (self.screened_sequence as Field) * 0x10000000000000000
            + (self.last_real_sequence as Field) * 0x100000000000000000000000000000000]
    }
    fn unpack(fields: [Field; 1]) -> Self {
        let bytes: [u8; 32] = fields[0].to_le_bytes();
        let mut parts: [u64; 3] = [0; 3];
        for i in 0..3 {
            for j in 0..8 { parts[i] = (parts[i] << 8) | bytes[i * 8 + 7 - j] as u64; }
        }
        let result = Self { head_sequence: parts[0], screened_sequence: parts[1], last_real_sequence: parts[2] };
        assert_eq(result.pack(), fields, "Noncanonical sequence state");
        result
    }
}
