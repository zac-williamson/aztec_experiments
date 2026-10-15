use aztec::protocol::{hash::poseidon2_hash_with_separator, traits::{Deserialize, Serialize, Packable}};
use crate::encoding::{name_id, pack_bytes, validate_text};

/// Private wallet metadata. Never emit or store a list of these publicly.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct OwnedNameRecord {
    pub name_id: Field,
    pub schema: u32,
    pub first_length: u8,
    pub first: [Field; 2],
    pub last_length: u8,
    pub last: [Field; 2],
}

impl OwnedNameRecord {
    pub fn new(first: [u8; 32], first_length: u8, last: [u8; 32], last_length: u8) -> Self {
        // The existing name hash constrains supported characters, normalization,
        // reserved bot names, lengths and padding, while preserving display case.
        Self { name_id: name_id(first, first_length, last, last_length), schema: 1,
            first_length, first: pack_bytes(first), last_length, last: pack_bytes(last) }
    }
    pub fn empty() -> Self {
        Self { name_id: 0, schema: 0, first_length: 0, first: [0; 2], last_length: 0, last: [0; 2] }
    }
    pub fn validate(self) {
        assert(self.schema == 1, "Invalid ownership schema");
        let id = name_id(unpack_component(self.first), self.first_length,
            unpack_component(self.last), self.last_length);
        assert(self.name_id == id, "Ownership metadata mismatch");
    }
}

pub fn unpack_component(fields: [Field; 2]) -> [u8; 32] {
    let first: [u8; 32] = fields[0].to_be_bytes();
    let second: [u8; 32] = fields[1].to_be_bytes();
    assert((first[0] == 0) & (second[0] == 0), "Name field exceeds 31 bytes");
    for i in 2..32 { assert(second[i] == 0, "Name field padding"); }
    let mut result = [0; 32];
    for i in 0..31 { result[i] = first[i + 1]; }
    result[31] = second[1];
    result
}

/// Public state is keyed by one selected immutable name, never by its owner.
/// Bytes reside in authenticated logs; versions identify their current content.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct ProfileRecord {
    pub bio_version: u32,
    pub bio_digest: Field,
    pub bio_length: u16,
    pub avatar_version: u32,
    pub avatar_digest: Field,
    pub avatar_width: u16,
    pub avatar_height: u16,
    pub avatar_length: u16,
}

pub fn next_version(current: u32, expected: u32) -> u32 {
    assert(current == expected, "Stale profile version");
    assert(current < 0xffffffff, "Profile version exhausted");
    current + 1
}

/// Reversible initial default: 992 UTF-8 bytes; zero length clears the bio.
/// Changing this capacity/domain requires a new versioned ABI, not truncation.
pub fn bio_digest(name: Field, version: u32, content: [Field; 32], length: u16) -> Field {
    assert((name != 0) & (version > 0), "Profile identity required");
    validate_text(content, length, false);
    poseidon2_hash_with_separator([1, name, version as Field, length as Field].concat(content), 0x52434231)
}

/// Actual raster decoding, metadata stripping, moderation and archival retention
/// are application/acceptance obligations. This validates canonical onchain bytes
/// and declared presentation dimensions, not the contents of an image codec.
pub fn avatar_digest(name: Field, version: u32, width: u16, height: u16,
    length: u16, data: [Field; 265]) -> Field {
    assert((name != 0) & (version > 0), "Profile identity required");
    assert(length <= 8192, "Avatar byte limit");
    if length == 0 {
        // Reversible initial clear representation. The UI displays its default.
        assert((width == 0) & (height == 0), "Cleared avatar dimensions");
    } else { assert((width == 100) & (height == 100), "Expected 100x100 raster"); }
    for i in 0..265 {
        let bytes: [u8; 32] = data[i].to_be_bytes();
        assert(bytes[0] == 0, "Avatar field exceeds 31 bytes");
        for j in 0..31 {
            if i * 31 + j >= length as u32 { assert(bytes[j + 1] == 0, "Avatar padding"); }
        }
    }
    poseidon2_hash_with_separator(
        [1, name, version as Field, width as Field, height as Field, length as Field].concat(data), 0x52434131,
    )
}

/// Last authenticated removal for one selected avatar version. A later upload
/// retains this history but makes it inapplicable by advancing avatar_version.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct AvatarModerationRecord {
    pub avatar_version: u32,
    pub avatar_digest: Field,
    pub main_policy_version: u32,
    pub reason_digest: Field,
}
