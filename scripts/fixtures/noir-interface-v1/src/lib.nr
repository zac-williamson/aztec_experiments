mod commitment_vectors;

// Proposed V1 interface fixture, not deployed application state. This uses the
// actual Aztec derive/note/property macros; no copied serializer or oracle.
use aztec::{
    macros::notes::note,
    note::{note_getter_options::PropertySelector, note_interface::NoteProperties, note_viewer_options::NoteViewerOptions},
    protocol::{address::EthAddress, traits::{Deserialize, Packable, Serialize}},
    utils::comparison::Comparator,
};

#[derive(Deserialize, Eq, Serialize, Packable)]
#[note]
pub struct DepositNoteV1 {
    pub schema_version: u32,
    pub deposit_chain_id: Field,
    pub amount: u128,
    pub l1_depositor: EthAddress,
    pub head_link: Field,
    pub head_sequence: u64,
    pub screened_link: Field,
    pub screened_sequence: u64,
    pub last_real_sequence: u64,
    pub next_allowed_time: u64,
}

#[derive(Deserialize, Eq, Serialize, Packable)]
#[note]
pub struct PostNoteV1 {
    pub schema_version: u32,
    pub deposit_chain_id: Field,
    pub sequence: u64,
    pub post_id: Field,
    pub anchor_timestamp: u64,
    pub previous_link: Field,
    pub is_dummy: bool,
}

fn deposit() -> DepositNoteV1 {
    DepositNoteV1 {
        schema_version: 1, deposit_chain_id: 2, amount: 4,
        l1_depositor: EthAddress::from_field(5), head_link: 6, head_sequence: 7,
        screened_link: 8, screened_sequence: 9, last_real_sequence: 10, next_allowed_time: 11,
    }
}

fn post() -> PostNoteV1 {
    PostNoteV1 { schema_version: 1, deposit_chain_id: 2, sequence: 3, post_id: 4,
        anchor_timestamp: 5, previous_link: 6, is_dummy: true }
}

fn assert_selector<T>(selector: PropertySelector<T>, index: u8) {
    assert_eq(selector.index, index);
    // These are BYTE offset/length within a canonical 32-byte Field encoding.
    assert_eq(selector.offset, 0);
    assert_eq(selector.length, 32);
}

#[test]
fn deposit_ten_fields_exact_order_and_roundtrip() {
    std::static_assert(<DepositNoteV1 as Packable>::N == 10, "DepositNoteV1 must pack to ten Fields");
    let value = deposit();
    let packed = value.pack();
    assert_eq(packed, [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert_eq(DepositNoteV1::unpack(packed), value);
}

#[test]
fn post_seven_fields_exact_order_and_roundtrip() {
    std::static_assert(<PostNoteV1 as Packable>::N == 7, "PostNoteV1 must pack to seven Fields");
    let value = post();
    let packed = value.pack();
    assert_eq(packed, [1, 2, 3, 4, 5, 6, 1]);
    assert_eq(PostNoteV1::unpack(packed), value);
    let mut not_dummy = value;
    not_dummy.is_dummy = false;
    assert_eq(not_dummy.pack()[6], 0);
    assert_eq(PostNoteV1::unpack(not_dummy.pack()), not_dummy);
}

#[test]
fn deposit_generated_selectors_match_every_packed_field() {
    let p = DepositNoteV1::properties();
    assert_selector(p.schema_version, 0);
    assert_selector(p.deposit_chain_id, 1);
    assert_selector(p.amount, 2);
    assert_selector(p.l1_depositor, 3);
    assert_selector(p.head_link, 4);
    assert_selector(p.head_sequence, 5);
    assert_selector(p.screened_link, 6);
    assert_selector(p.screened_sequence, 7);
    assert_selector(p.last_real_sequence, 8);
    assert_selector(p.next_allowed_time, 9);
    let options = NoteViewerOptions::<DepositNoteV1, 10>::new()
        .select(p.deposit_chain_id, Comparator.EQ, 2 as Field)
        .select(p.amount, Comparator.EQ, 4 as u128)
        .select(p.l1_depositor, Comparator.EQ, EthAddress::from_field(5))
        .set_limit(1);
    assert_eq(options.selects.len(), 3);
    assert_eq(options.limit, 1);
}

#[test]
fn post_generated_selectors_match_every_packed_field() {
    let p = PostNoteV1::properties();
    assert_selector(p.schema_version, 0);
    assert_selector(p.deposit_chain_id, 1);
    assert_selector(p.sequence, 2);
    assert_selector(p.post_id, 3);
    assert_selector(p.anchor_timestamp, 4);
    assert_selector(p.previous_link, 5);
    assert_selector(p.is_dummy, 6);
    let options = NoteViewerOptions::<PostNoteV1, 7>::new()
        .select(p.deposit_chain_id, Comparator.EQ, 2 as Field)
        .select(p.sequence, Comparator.EQ, 3 as u64)
        .select(p.is_dummy, Comparator.EQ, true)
        .set_limit(2);
    assert_eq(options.selects.len(), 3);
    assert_eq(options.limit, 2);
}

#[test]
fn full_scalar_widths_roundtrip_without_sharing_fields() {
    let mut deposit_value = deposit();
    deposit_value.schema_version = 0xffffffff;
    deposit_value.deposit_chain_id = -1;
    deposit_value.amount = 0xffffffffffffffffffffffffffffffff;
    deposit_value.l1_depositor = EthAddress::from_field(0xffffffffffffffffffffffffffffffffffffffff);
    deposit_value.head_sequence = 0xffffffffffffffff;
    deposit_value.screened_sequence = 0xffffffffffffffff;
    deposit_value.last_real_sequence = 0xffffffffffffffff;
    deposit_value.next_allowed_time = 0xffffffffffffffff;
    let packed = deposit_value.pack();
    assert_eq(packed[0], 0xffffffff);
    assert_eq(packed[1], -1);
    assert_eq(packed[2], 0xffffffffffffffffffffffffffffffff);
    assert_eq(packed[3], 0xffffffffffffffffffffffffffffffffffffffff);
    assert_eq(DepositNoteV1::unpack(packed), deposit_value);
    let mut entry = post();
    entry.sequence = 0xffffffffffffffff;
    entry.anchor_timestamp = 0xffffffffffffffff;
    entry.post_id = -1;
    assert_eq(PostNoteV1::unpack(entry.pack()), entry);
}

#[test]
fn raw_unpack_truncates_u32_overflow() {
    let mut packed = deposit().pack();
    packed[0] = 0x100000000;
    let value = DepositNoteV1::unpack(packed);
    assert_eq(value.schema_version, 0);
}

#[test]
fn raw_unpack_truncates_u64_overflow() {
    let mut packed = post().pack();
    packed[2] = 0x10000000000000000;
    let value = PostNoteV1::unpack(packed);
    assert_eq(value.sequence, 0);
}

#[test]
fn raw_unpack_truncates_u128_overflow() {
    let mut packed = deposit().pack();
    packed[2] = 0x100000000000000000000000000000000;
    let value = DepositNoteV1::unpack(packed);
    assert_eq(value.amount, 0);
}

#[test(should_fail_with = "Packable::unpack: bool field must be 0 or 1")]
fn unpack_rejects_noncanonical_boolean() {
    let mut packed = post().pack();
    packed[6] = 2;
    let value = PostNoteV1::unpack(packed);
    assert_eq(value.pack()[6], packed[6]);
}

#[test]
fn raw_eth_address_unpack_does_not_validate_address_range() {
    let mut packed = deposit().pack();
    packed[3] = 0x10000000000000000000000000000000000000000;
    let value = DepositNoteV1::unpack(packed);
    // Actual upstream EthAddress derives Packable over a Field. Consumers must
    // explicitly call validate() after unpacking arbitrary-origin note Fields.
    assert_eq(value.pack()[3], packed[3]);
}

#[test(should_fail)]
fn explicit_eth_address_validation_rejects_overwidth_unpack() {
    let mut packed = deposit().pack();
    packed[3] = 0x10000000000000000000000000000000000000000;
    let value = DepositNoteV1::unpack(packed);
    value.l1_depositor.validate();
}

// Proposed boundary check: raw Fields must survive a canonical typed roundtrip.
// This uses actual derived pack/unpack, not a hand-written bit serializer.
fn checked_deposit(packed: [Field; 10]) -> DepositNoteV1 {
    let value = DepositNoteV1::unpack(packed);
    assert(value.pack() == packed, "Noncanonical packed integer");
    value.l1_depositor.validate();
    value
}

fn checked_post(packed: [Field; 7]) -> PostNoteV1 {
    let value = PostNoteV1::unpack(packed);
    assert(value.pack() == packed, "Noncanonical packed integer");
    value
}

#[test]
fn checked_unpack_accepts_canonical_note_controls() {
    assert_eq(checked_deposit(deposit().pack()), deposit());
    assert_eq(checked_post(post().pack()), post());
}

#[test(should_fail_with = "Noncanonical packed integer")]
fn canonical_roundtrip_rejects_u32_overflow() {
    let mut packed = deposit().pack();
    packed[0] = 0x100000000;
    let value = checked_deposit(packed);
    assert_eq(value.schema_version, 0);
}

#[test(should_fail_with = "Noncanonical packed integer")]
fn canonical_roundtrip_rejects_u64_overflow() {
    let mut packed = post().pack();
    packed[2] = 0x10000000000000000;
    let value = checked_post(packed);
    assert_eq(value.sequence, 0);
}

#[test(should_fail_with = "Noncanonical packed integer")]
fn canonical_roundtrip_rejects_u128_overflow() {
    let mut packed = deposit().pack();
    packed[2] = 0x100000000000000000000000000000000;
    let value = checked_deposit(packed);
    assert_eq(value.amount, 0);
}
