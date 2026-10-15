// Port of reviewed Billboard V1 admission mathematics and bridge framing.
// See ADMISSION_PROVENANCE.md; no legacy deployed state is reused.
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

/// Independent public identity. Rolling publication reveals the fresh random
/// per-post nonce to derive the invocation target; it must never be reused.
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

use aztec::protocol::constants::MAX_TX_LIFETIME;
    #[derive(Eq, Packable)]
    pub struct Config {
        pub l1_chain_id: u64,
        pub rollup_address: EthAddress,
        pub rollup_version: u32,
        pub min_deposit: u128,
        pub max_deposit: u128,
        pub base_cooldown: u32,
        pub k_multiplier: u16,
        pub censor_window: u32,
        pub max_save_up: u16,
        pub deployer: AztecAddress,
    }

    impl Config {
        pub fn hash(self, board: AztecAddress) -> Field {
            crate::admission::get_config_hash(self.l1_chain_id, self.rollup_address, board, self.rollup_version,
                self.min_deposit, self.max_deposit, self.base_cooldown, self.k_multiplier,
                self.censor_window, self.max_save_up)
        }
        /// Admission preserves a possible timely recovery schedule. It cannot
        /// guarantee recovery after arbitrary user inactivity or protocol outage.
        /// No private history count or derived deadline is published.
        pub fn assert_recovery_horizon(self, now: u64, next_allowed: u64,
            cooldown: u64, remaining: u64, head_sequence: u64) {
            // Every existing public post is included by this anchor. The new
            // real post must be included within the protocol transaction lifetime.
            let latest_deadline = now as u128 + MAX_TX_LIFETIME as u128 + self.censor_window as u128;
            let start = if next_allowed as u128 > latest_deadline { next_allowed as u128 } else { latest_deadline };
            // Once every real post is mature, each dummy advances two entries,
            // except the final entry when the remaining count is odd. New trailing
            // dummies do not prevent exit after the final real entry is screened.
            let steps = (remaining as u128 + 1) / 2;
            assert(head_sequence as u128 + steps <= 0xffffffffffffffff, "Recovery sequence horizon exceeded");
            let max_step_debt = cooldown as u128 * (1 + 2 * (self.k_multiplier as u128 - 1));
            // Allow one full inclusion lifetime for each screening transaction,
            // and another for the final withdrawal. Products are below 2^113
            // under Config bounds and the u64 sequence domain, hence fit u128.
            let recovery_end = start + steps * (MAX_TX_LIFETIME as u128 + max_step_debt)
                + MAX_TX_LIFETIME as u128;
            assert(recovery_end <= 0x7fffffffffffffff, "Recovery horizon exceeded");
        }

        pub fn validate(self, chain: Field, version: Field) {
            self.rollup_address.validate();
            assert(self.rollup_address.to_field() != 0, "Zero rollup");
            assert(self.deployer.to_field() != 0, "Zero deployer");
            assert(self.l1_chain_id > 0, "Zero chain");
            assert(self.rollup_version > 0, "Zero rollup version");
            assert(chain == self.l1_chain_id as Field, "Wrong chain");
            assert(version == self.rollup_version as Field, "Wrong rollup version");
            assert(self.min_deposit > 0, "Min deposit must be > 0");
            assert((self.max_deposit >= self.min_deposit) & (self.max_deposit <= 0xffffffffffffffffffffffff), "Invalid maximum deposit");
            assert(self.base_cooldown > 0, "Base cooldown must be > 0");
            assert(self.k_multiplier > 0, "K must be > 0");
            assert(self.censor_window > 0, "Censor window must be > 0");
            assert(self.max_save_up > 0, "Max save up must be > 0");
        }
    }

