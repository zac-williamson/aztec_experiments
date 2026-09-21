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
    depositor: EthAddress, amount: u128) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_CLAIM_V1", [1, chain as Field, portal.to_field(), board.to_field(),
        version as Field, depositor.to_field(), amount as Field]))
}

pub fn get_withdraw_msg_hash(chain: u64, portal: EthAddress, board: AztecAddress, version: u32,
    depositor: EthAddress, amount: u128) -> Field {
    sha256_to_field(encode_words("AZTEC_BB_EXIT_V1", [1, chain as Field, portal.to_field(), board.to_field(),
        version as Field, depositor.to_field(), amount as Field]))
}

pub fn deposit_chain_id(board: AztecAddress, owner: AztecAddress, content: Field, secret: Field, message_leaf_index: Field) -> Field {
    poseidon2_hash_with_separator([1, board.to_field(), owner.to_field(), content, secret, message_leaf_index], 0x42420101)
}

/// Independent public identity; the wallet keeps the fresh nonce private.
pub fn post_id(board: AztecAddress, nonce: Field) -> Field {
    poseidon2_hash_with_separator([1, board.to_field(), nonce], 0x42420102)
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
    assert((result > 0) & (result <= cooldown_base_seconds as u128), "Cooldown out of range");
    result as u64
}

pub fn checked_time_add(time: u64, interval: u64) -> u64 {
    assert(time <= 0x7fffffffffffffff, "Timestamp out of range");
    assert(interval <= 0x7fffffffffffffff - time, "Eligibility timestamp overflow");
    time + interval
}

/// All economics are validated before arithmetic or narrowing. The maximum
/// products are below 2^49, so each interval fits u64; time addition separately
/// enforces the executable timestamp horizon rather than merely the wire type.
pub fn compute_next_allowed(now: u64, previous: u64, cooldown: u64,
    k: u64, max_save_up: u64, flags: u64) -> u64 {
    assert((cooldown > 0) & (cooldown <= 0xffffffff), "Invalid cooldown");
    assert((k > 0) & (k <= 0xffff), "Invalid penalty multiplier");
    assert((max_save_up > 0) & (max_save_up <= 0xffff), "Invalid save-up cap");
    assert(flags <= 2, "Invalid flag count");
    assert((now <= 0x7fffffffffffffff) & (previous <= 0x7fffffffffffffff), "Timestamp out of range");
    let saved = cooldown * (max_save_up - 1);
    let floor = if now >= saved { now - saved } else { 0 };
    let effective = if previous > floor { previous } else { floor };
    assert(now >= effective, "Too early to post -- time lock not yet expired");
    let penalty = cooldown * (1 + (k - 1) * flags);
    checked_time_add(effective, penalty)
}

/// Hash exactly the declared UTF-8 bytes, without terminal/padding bytes.
/// Matches SHA_FIELD(domain || word(1) || word(board) || word(length) || bytes).
pub fn policy_version(board: AztecAddress, policy: [Field; 48], length: u32) -> Field {
    validate_policy(policy, length);
    let header = encode_words("AZTEC_BB_POLICY_V1", [1, board.to_field(), length as Field]);
    let mut message: [u8; 1616] = [0; 1616];
    for i in 0..128 { message[i] = header[i]; }
    for i in 0..48 {
        let bytes: [u8; 32] = policy[i].to_be_bytes();
        for j in 0..31 { message[128 + i * 31 + j] = bytes[j + 1]; }
    }
    let digest = sha256::sha256_var(message, 128 + length);
    // The first 31 digest bytes, not modulo Fr and not the last 31 bytes.
    let mut value: Field = 0;
    for i in 0..31 { value = value * 256 + digest[i] as Field; }
    value
}

/// Empty reasons are valid per V1; nonempty bytes obey the shared text codec.
pub fn validate_reason(reason: [Field; 7], length: u16) {
    assert(length <= 200, "Reason too long");
    validate_text(reason, length as u32, false);
}

/// Canonical 31-byte fields, nonempty UTF-8, no NUL or hidden padding.
/// Keep policy error strings stable while sharing the actual decoding rules.
pub fn validate_policy(policy: [Field; 48], length: u32) {
    assert(length > 0, "Policy must not be empty");
    assert(length <= 1488, "Policy too long");
    validate_text(policy, length, true);
}

pub fn validate_message(message: [Field; 32], length: u16) {
    assert(length > 0, "Message must not be empty");
    assert(length <= 992, "Message too long");
    validate_text(message, length as u32, false);
}

fn validate_text<let N: u32>(fields: [Field; N], length: u32, is_policy: bool) {
    let mut remaining: u8 = 0;
    let mut lower: u8 = 0x80;
    let mut upper: u8 = 0xbf;
    for i in 0..N {
        let bytes: [u8; 32] = fields[i].to_be_bytes();
        if is_policy { assert(bytes[0] == 0, "Policy field exceeds 31 bytes"); }
        else { assert(bytes[0] == 0, "Message field exceeds 31 bytes"); }
        for j in 0..31 {
            let byte = bytes[j + 1];
            if i * 31 + j >= length {
                if is_policy { assert(byte == 0, "Nonzero policy padding"); }
                else { assert(byte == 0, "Nonzero message padding"); }
            } else if remaining > 0 {
                if is_policy { assert((byte >= lower) & (byte <= upper), "Invalid policy UTF-8 continuation"); }
                else { assert((byte >= lower) & (byte <= upper), "Invalid message UTF-8 continuation"); }
                remaining -= 1;
                lower = 0x80;
                upper = 0xbf;
            } else {
                if is_policy { assert(byte > 0, "Policy contains NUL"); }
                else { assert(byte > 0, "Message contains NUL"); }
                if byte < 0x80 {
                } else if (byte >= 0xc2) & (byte <= 0xdf) {
                    remaining = 1;
                } else if (byte >= 0xe0) & (byte <= 0xef) {
                    remaining = 2;
                    lower = if byte == 0xe0 { 0xa0 } else { 0x80 };
                    upper = if byte == 0xed { 0x9f } else { 0xbf };
                } else {
                    if is_policy { assert((byte >= 0xf0) & (byte <= 0xf4), "Invalid policy UTF-8 lead"); }
                    else { assert((byte >= 0xf0) & (byte <= 0xf4), "Invalid message UTF-8 lead"); }
                    remaining = 3;
                    lower = if byte == 0xf0 { 0x90 } else { 0x80 };
                    upper = if byte == 0xf4 { 0x8f } else { 0xbf };
                }
            }
        }
    }
    if is_policy { assert(remaining == 0, "Truncated policy UTF-8"); }
    else { assert(remaining == 0, "Truncated message UTF-8"); }
}

use aztec::protocol::traits::{Deserialize, Packable, Serialize};

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
