use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash_with_separator,
    traits::{Deserialize, Serialize, ToField}};

// Versioned engineering defaults: bookmark post, follow board, follow name,
// thread subscription, global reply notifications, thread read marker. There is
// no arbitrary key/value namespace. A future schema can replace this enum.
pub global BOOKMARK: u8 = 1;
pub global FOLLOW_BOARD: u8 = 2;
pub global FOLLOW_NAME: u8 = 3;
pub global THREAD_SUBSCRIPTION: u8 = 4;
pub global REPLY_NOTIFICATIONS: u8 = 5;
pub global THREAD_READ: u8 = 6;
pub global PREFERENCE_DOMAIN: u32 = 0x52435031;

/// Wallet-local output only; an absent head is distinct from an initialized head.
#[derive(Deserialize, Serialize, Eq)]
pub struct PreferenceHeadState {
    pub initialized: bool,
    pub schema: u32,
    pub revision: u64,
    pub digest: Field,
}
impl PreferenceHeadState {
    pub fn empty() -> Self { Self { initialized: false, schema: 1, revision: 0, digest: 0 } }
}

pub fn validate_toggle(kind: u8, target: Field) {
    assert((kind >= BOOKMARK) & (kind <= REPLY_NOTIFICATIONS), "Unknown preference kind");
    if kind == REPLY_NOTIFICATIONS {
        assert(target == 0, "Global preference target");
    } else if kind != FOLLOW_BOARD {
        assert(target != 0, "Preference target required");
    }
    // Board zero is the main board. References are opaque canonical IDs: no
    // personalized public-state lookup is introduced when following/bookmarking.
}

pub fn next_revision(schema: u32, revision: u64, digest: Field, expected_revision: u64) -> u64 {
    assert(schema == 1, "Invalid preference schema");
    assert((revision != 0) & (digest != 0), "Invalid preference head");
    assert(revision == expected_revision, "Stale preference revision");
    assert(revision < 18446744073709551615, "Preference revision overflow");
    revision + 1
}

/// Entire serialized event, including previous digest, is committed. Scope
/// separation here does not change the standard PrivateMutable initialization
/// nullifier's app-address scope; reuse of identical keys/address across networks
/// is not a cross-network unlinkability guarantee.
pub fn preference_digest(chain: Field, version: Field, board: AztecAddress, event: [Field; 8]) -> Field {
    let digest = poseidon2_hash_with_separator([
        chain, version, board.to_field(), event[0], event[1], event[2], event[3],
        event[4], event[5], event[6], event[7],
    ], PREFERENCE_DOMAIN);
    assert(digest != 0, "Zero preference digest");
    digest
}
