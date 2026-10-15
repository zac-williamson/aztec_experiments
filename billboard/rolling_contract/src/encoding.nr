use aztec::protocol::hash::poseidon2_hash_with_separator;

pub global NAME_DOMAIN: u32 = 0x52434e31;
pub global SUBBOARD_DOMAIN: u32 = 0x52435331;
pub global TEXT_DOMAIN: u32 = 0x52435431;

fn letter(byte: u8) -> bool {
    ((byte >= 65) & (byte <= 90)) | ((byte >= 97) & (byte <= 122))
}

/// The wallet trims/collapses ASCII spaces before encoding. The circuit requires
/// that exact normalized display representation and derives lowercase itself.
pub fn canonical_component(display: [u8; 32], length: u8) -> [u8; 32] {
    assert((length > 0) & (length <= 32), "Name length");
    let mut canonical = [0; 32];
    for i in 0..32 {
        let byte = display[i];
        if i < length as u32 {
            assert(letter(byte) | (byte == 32) | (byte == 39) | (byte == 45), "Name character");
            if (i == 0) | (i + 1 == length as u32) { assert(letter(byte), "Name boundary"); }
            if i > 0 { assert(!((byte == 32) & (display[i - 1] == 32)), "Name repeated space"); }
            canonical[i] = if (byte >= 65) & (byte <= 90) { byte + 32 } else { byte };
        } else { assert(byte == 0, "Name padding"); }
    }
    canonical
}

/// 31-byte big-endian fields, right padded. In particular byte 32 occupies
/// bit 240 of field two, exactly matching shared/rolling/name-policy.mjs.
pub fn pack_bytes<let N: u32, let F: u32>(bytes: [u8; N]) -> [Field; F] {
    std::static_assert(N <= F * 31, "Packing capacity");
    let mut packed = [0; F];
    for i in 0..F {
        let mut value: Field = 0;
        for j in 0..31 {
            let position = i * 31 + j;
            value *= 256;
            if position < N { value += bytes[position] as Field; }
        }
        packed[i] = value;
    }
    packed
}

pub fn name_preimage(first: [u8; 32], first_len: u8, last: [u8; 32], last_len: u8) -> [Field; 6] {
    let f = canonical_component(first, first_len);
    let l = canonical_component(last, last_len);
    assert(!((first_len == 3) & (f[0] == 98) & (f[1] == 111) & (f[2] == 107)), "Reserved bot name");
    let first_fields: [Field; 2] = pack_bytes(f);
    let last_fields: [Field; 2] = pack_bytes(l);
    [first_len as Field, first_fields[0], first_fields[1], last_len as Field, last_fields[0], last_fields[1]]
}

pub fn name_id(first: [u8; 32], first_len: u8, last: [u8; 32], last_len: u8) -> Field {
    let id = poseidon2_hash_with_separator(name_preimage(first, first_len, last, last_len), NAME_DOMAIN);
    assert(id != 0, "Zero name id");
    id
}

pub fn subboard_id(slug: [u8; 40], length: u8) -> Field {
    assert((length >= 3) & (length <= 40), "Slug length");
    for i in 0..40 {
        let byte = slug[i];
        if i < length as u32 {
            let alphanumeric = ((byte >= 97) & (byte <= 122)) | ((byte >= 48) & (byte <= 57));
            assert(alphanumeric | (byte == 45), "Slug character");
            if (i == 0) | (i + 1 == length as u32) { assert(alphanumeric, "Slug boundary"); }
            if i > 0 { assert(!((byte == 45) & (slug[i - 1] == 45)), "Slug repeated hyphen"); }
        } else { assert(byte == 0, "Slug padding"); }
    }
    let fields: [Field; 2] = pack_bytes(slug);
    let id = poseidon2_hash_with_separator([length as Field, fields[0], fields[1]], SUBBOARD_DOMAIN);
    assert(id != 0, "Zero subboard id");
    id
}

/// Same UTF-8 state machine as the existing board: no NUL, overlong encoding,
/// surrogates, code points beyond U+10FFFF, truncated sequences or hidden padding.
pub fn validate_text<let N: u32>(fields: [Field; N], length: u16, required: bool) {
    assert(length as u32 <= N * 31, "Text length");
    if required { assert(length > 0, "Text required"); }
    let mut remaining: u8 = 0;
    let mut lower: u8 = 0x80;
    let mut upper: u8 = 0xbf;
    for i in 0..N {
        let bytes: [u8; 32] = fields[i].to_be_bytes();
        assert(bytes[0] == 0, "Text field exceeds 31 bytes");
        for j in 0..31 {
            let byte = bytes[j + 1];
            if i * 31 + j >= length as u32 { assert(byte == 0, "Text padding"); }
            else if remaining > 0 {
                assert((byte >= lower) & (byte <= upper), "UTF-8 continuation");
                remaining -= 1;
                lower = 0x80;
                upper = 0xbf;
            } else {
                assert(byte > 0, "Text NUL");
                if byte < 0x80 {}
                else if (byte >= 0xc2) & (byte <= 0xdf) { remaining = 1; }
                else if (byte >= 0xe0) & (byte <= 0xef) {
                    remaining = 2;
                    lower = if byte == 0xe0 { 0xa0 } else { 0x80 };
                    upper = if byte == 0xed { 0x9f } else { 0xbf };
                } else {
                    assert((byte >= 0xf0) & (byte <= 0xf4), "UTF-8 lead");
                    remaining = 3;
                    lower = if byte == 0xf0 { 0x90 } else { 0x80 };
                    upper = if byte == 0xf4 { 0x8f } else { 0xbf };
                }
            }
        }
    }
    assert(remaining == 0, "Truncated UTF-8");
}

pub fn text_hash<let N: u32>(fields: [Field; N], length: u16) -> Field {
    poseidon2_hash_with_separator([length as Field].concat(fields), TEXT_DOMAIN)
}
