use crate::{RollingBoard, encoding::{name_id, pack_bytes}, profiles::{OwnedNameRecord, ProfileRecord, unpack_component, next_version, bio_digest, avatar_digest}};
use aztec::{test::helpers::test_environment::TestEnvironment,
    protocol::{address::{AztecAddress, EthAddress}, traits::{FromField, Packable}}};

fn fixed<let N: u32>(value: str<N>) -> [u8; 32] {
    std::static_assert(N <= 32, "Fixture length");
    let mut bytes = [0; 32];
    for i in 0..N { bytes[i] = value.as_bytes()[i]; }
    bytes
}
fn text<let N: u32>(value: str<N>) -> [Field; 32] { pack_bytes(value.as_bytes()) }
fn avatar() -> [Field; 265] { pack_bytes([0x89, 0x50, 0x4e, 0x47]) }

// These bytes are codec-boundary fixtures, not valid images or image-quality
// evidence. Actual raster decoding/moderation and log retrieval require the SDK
// journey. TXE exercises the real ownership and public state transitions.
#[test]
fn private_name_record_retains_case_and_has_expected_packed_layout() {
    let record = OwnedNameRecord::new(fixed("JoHN"), 4, fixed("O'Neil"), 6);
    record.validate();
    assert_eq(record.name_id, name_id(fixed("john"), 4, fixed("o'neil"), 6));
    assert_eq(unpack_component(record.first), fixed("JoHN"));
    assert_eq(unpack_component(record.last), fixed("O'Neil"));
    std::static_assert(<OwnedNameRecord as Packable>::N == 8, "Name record packed layout");
    std::static_assert(<RollingBoard::UsernameNote as Packable>::N == 8, "Name note packed layout");
    std::static_assert(<ProfileRecord as Packable>::N == 8, "Profile storage packed layout");
    std::static_assert(<crate::profiles::AvatarModerationRecord as Packable>::N == 4, "Avatar moderation packed layout");
}
#[test]
fn private_name_record_exact_32_byte_components_roundtrip() {
    let record = OwnedNameRecord::new([65; 32], 32, [66; 32], 32);
    record.validate(); assert_eq(unpack_component(record.first), [65; 32]);
    assert_eq(unpack_component(record.last), [66; 32]);
}
#[test(should_fail_with="Ownership metadata mismatch")]
fn name_record_cannot_change_readable_metadata_while_retaining_id() {
    let mut record = OwnedNameRecord::new(fixed("John"), 4, fixed("Doe"), 3);
    record.first = pack_bytes(fixed("Jane")); record.validate();
}
#[test(should_fail_with="Invalid ownership schema")]
fn name_record_schema_checked() {
    let mut record = OwnedNameRecord::new(fixed("John"), 4, fixed("Doe"), 3);
    record.schema = 0; record.validate();
}
#[test(should_fail_with="Name length")]
fn name_record_oversize_length_checked() {
    let _ = OwnedNameRecord::new([65; 32], 33, fixed("Doe"), 3);
}
#[test(should_fail_with="Name field padding")]
fn name_record_cannot_hide_bytes_past_32() { let _ = unpack_component([0, 1]); }
#[test(should_fail_with="Name field exceeds 31 bytes")]
fn name_record_field_overflow_checked() {
    let _ = unpack_component([0x100000000000000000000000000000000000000000000000000000000000000, 0]);
}
#[test]
fn profile_hashes_bind_name_version_metadata_and_bytes() {
    let bio = bio_digest(1, 1, text("hello"), 5);
    assert(bio != bio_digest(2, 1, text("hello"), 5));
    assert(bio != bio_digest(1, 2, text("hello"), 5));
    assert(bio != bio_digest(1, 1, text("Hello"), 5));
    let image = avatar_digest(1, 1, 100, 100, 4, avatar());
    assert(image != avatar_digest(2, 1, 100, 100, 4, avatar()));
    assert(image != avatar_digest(1, 2, 100, 100, 4, avatar()));
    // A trailing zero belongs to the content when included in the length.
    assert(image != avatar_digest(1, 1, 100, 100, 5, avatar()));
    assert(avatar_digest(1, 2, 0, 0, 0, [0; 265]) != image);
    assert(bio_digest(1, 2, [0; 32], 0) != bio);
}
#[test]
fn exact_bio_and_avatar_capacity_accepted() {
    let bio: [Field; 32] = pack_bytes([65; 992]);
    let image: [Field; 265] = pack_bytes([255; 8192]);
    assert(bio_digest(1, 1, bio, 992) != 0);
    assert(avatar_digest(1, 1, 100, 100, 8192, image) != 0);
}
#[test(should_fail_with="Text length")]
fn bio_993_bytes_rejected() { let _ = bio_digest(1, 1, [0; 32], 993); }
#[test(should_fail_with="Text padding")]
fn bio_hidden_suffix_rejected() { let _ = bio_digest(1, 1, text("AB"), 1); }
#[test(should_fail_with="UTF-8 continuation")]
fn bio_overlong_utf8_rejected() {
    let value: [Field; 32] = pack_bytes([0xe0, 0x80, 0x80]);
    let _ = bio_digest(1, 1, value, 3);
}
#[test(should_fail_with="Text padding")]
fn bio_clear_requires_zero_padding() { let _ = bio_digest(1, 1, text("A"), 0); }
#[test(should_fail_with="Avatar byte limit")]
fn avatar_8193_bytes_rejected() {
    let _ = avatar_digest(1, 1, 100, 100, 8193, pack_bytes([255; 8193]));
}
#[test(should_fail_with="Avatar padding")]
fn avatar_hidden_suffix_rejected() { let _ = avatar_digest(1, 1, 100, 100, 3, avatar()); }
#[test(should_fail_with="Avatar padding")]
fn avatar_clear_requires_all_zero_bytes() { let _ = avatar_digest(1, 1, 0, 0, 0, avatar()); }
#[test(should_fail_with="Avatar field exceeds 31 bytes")]
fn avatar_field_overflow_rejected() {
    let mut data = [0; 265]; data[0] = 0x100000000000000000000000000000000000000000000000000000000000000;
    let _ = avatar_digest(1, 1, 100, 100, 1, data);
}
#[test(should_fail_with="Expected 100x100 raster")]
fn avatar_wrong_dimensions_rejected() { let _ = avatar_digest(1, 1, 99, 100, 4, avatar()); }
#[test(should_fail_with="Cleared avatar dimensions")]
fn empty_avatar_cannot_claim_dimensions() { let _ = avatar_digest(1, 1, 100, 100, 0, [0; 265]); }
#[test(should_fail_with="Profile identity required")]
fn profile_hash_cannot_target_bot_sentinel() { let _ = bio_digest(0, 1, text("A"), 1); }
#[test(should_fail_with="Profile identity required")]
fn avatar_hash_cannot_use_uninitialized_version() { let _ = avatar_digest(1, 0, 100, 100, 4, avatar()); }
#[test(should_fail_with="Profile version exhausted")]
fn profile_version_overflow_rejected() { let _ = next_version(0xffffffff, 0xffffffff); }
#[test(should_fail_with="Stale profile version")]
fn profile_expected_version_cannot_skip() { let _ = next_version(0, 2); }

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let moderator = env.create_light_account(); let alice = env.create_light_account(); let bob = env.create_light_account();
    let board = env.deploy("@rolling_contract/RollingBoard").with_public_initializer(moderator,
        RollingBoard::interface().init(text("No threats"), 10, 1, EthAddress::from_field(0x1111), 1, 10, 1000, 10, 3, 100, 10, moderator));
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("JoHN"), 4, fixed("Doe"), 3));
    (env, board, alice, bob)
}
fn john() -> Field { name_id(fixed("JoHN"), 4, fixed("Doe"), 3) }

#[test]
unconstrained fn two_owners_multiple_names_profile_updates_and_private_metadata_retention() {
    let (env, board, alice, bob) = setup();
    let mary = name_id(fixed("Mary"), 4, fixed("Lee"), 3);
    let jane = name_id(fixed("Jane"), 4, fixed("Doe"), 3);
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("Mary"), 4, fixed("Lee"), 3));
    env.call_private(bob, RollingBoard::at(board).register_name(fixed("Jane"), 4, fixed("Doe"), 3));
    env.call_private(alice, RollingBoard::at(board).set_bio(john(), 0, text("hello"), 5));
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 100, 100, 4, avatar()));
    env.call_private(alice, RollingBoard::at(board).set_bio(mary, 0, text("Mary's bio"), 10));
    env.call_private(bob, RollingBoard::at(board).set_bio(jane, 0, text("Jane's bio"), 10));
    env.call_private(bob, RollingBoard::at(board).set_avatar(jane, 0, 100, 100, 4, avatar()));
    env.call_private(alice, RollingBoard::at(board).authenticate_name(john()));
    env.call_private(alice, RollingBoard::at(board).authenticate_name(john()));
    let j = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(j.bio_version, 1); assert_eq(j.avatar_version, 1); assert_eq(j.bio_length, 5);
    assert_eq(j.bio_digest, bio_digest(john(), 1, text("hello"), 5));
    assert_eq(j.avatar_digest, avatar_digest(john(), 1, 100, 100, 4, avatar()));
    assert_eq(j.avatar_width, 100); assert_eq(j.avatar_height, 100); assert_eq(j.avatar_length, 4);
    let m = env.view_public(RollingBoard::at(board).profile_state(mary));
    assert_eq(m.bio_version, 1); assert_eq(m.avatar_version, 0); assert_eq(m.avatar_digest, 0);
    let b = env.view_public(RollingBoard::at(board).profile_state(jane));
    assert_eq(b.bio_digest, bio_digest(jane, 1, text("Jane's bio"), 10));
    assert(j.avatar_digest != b.avatar_digest);
    let owned = env.execute_utility(RollingBoard::at(board).owned_name_records(alice, 0));
    let original_john = OwnedNameRecord::new(fixed("JoHN"), 4, fixed("Doe"), 3);
    let original_mary = OwnedNameRecord::new(fixed("Mary"), 4, fixed("Lee"), 3);
    assert((owned[0] == original_john) | (owned[1] == original_john));
    assert((owned[0] == original_mary) | (owned[1] == original_mary));
    assert_eq(owned[2], OwnedNameRecord::empty());
    let offset_one = env.execute_utility(RollingBoard::at(board).owned_name_records(alice, 1));
    assert((offset_one[0] == original_john) | (offset_one[0] == original_mary));
    assert_eq(offset_one[1], OwnedNameRecord::empty());
    let b_owned = env.execute_utility(RollingBoard::at(board).owned_name_records(bob, 0));
    assert_eq(b_owned[0], OwnedNameRecord::new(fixed("Jane"), 4, fixed("Doe"), 3));
    assert_eq(b_owned[1], OwnedNameRecord::empty());
}

#[test]
unconstrained fn independent_versions_and_explicit_clears_preserve_other_profile_part() {
    let (env, board, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).set_bio(john(), 0, text("hello"), 5));
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 100, 100, 4, avatar()));
    env.call_private(alice, RollingBoard::at(board).set_bio(john(), 1, [0; 32], 0));
    let cleared = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(cleared.bio_version, 2); assert_eq(cleared.bio_length, 0);
    assert_eq(cleared.bio_digest, bio_digest(john(), 2, [0; 32], 0));
    assert_eq(cleared.avatar_version, 1); assert_eq(cleared.avatar_length, 4);
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 1, 0, 0, 0, [0; 265]));
    let all_clear = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(all_clear.bio_digest, cleared.bio_digest); assert_eq(all_clear.bio_version, 2);
    assert_eq(all_clear.avatar_version, 2); assert_eq(all_clear.avatar_width, 0);
    assert_eq(all_clear.avatar_height, 0); assert_eq(all_clear.avatar_length, 0);
    assert_eq(all_clear.avatar_digest, avatar_digest(john(), 2, 0, 0, 0, [0; 265]));
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 2, 100, 100, 4, avatar()));
    let restored = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(restored.avatar_version, 3); assert_eq(restored.bio_version, 2);
}
#[test]
unconstrained fn full_8192_bytes_profile_update_uses_actual_callback() {
    let (env, board, alice, _) = setup();
    let data: [Field; 265] = pack_bytes([255; 8192]);
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 100, 100, 8192, data));
    let current = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(current.avatar_version, 1); assert_eq(current.avatar_length, 8192);
    assert_eq(current.avatar_digest, avatar_digest(john(), 1, 100, 100, 8192, data));
}
#[test(should_fail_with="No owned name")]
unconstrained fn different_owner_cannot_update_bio() {
    let (env, board, _, bob) = setup(); env.call_private(bob, RollingBoard::at(board).set_bio(john(), 0, text("fake"), 4));
}
#[test(should_fail_with="No owned name")]
unconstrained fn different_owner_cannot_update_avatar() {
    let (env, board, _, bob) = setup(); env.call_private(bob, RollingBoard::at(board).set_avatar(john(), 0, 100, 100, 4, avatar()));
}
#[test(should_fail_with="Name required")]
unconstrained fn human_cannot_update_authenticated_bot_sentinel() {
    let (env, board, alice, _) = setup(); env.call_private(alice, RollingBoard::at(board).set_bio(0, 0, text("fake"), 4));
}
#[test(should_fail_with="Function _set_bio can only be called by the same contract")]
unconstrained fn public_bio_callback_cannot_bypass_private_ownership() {
    let (env, board, alice, _) = setup(); env.call_public(alice, RollingBoard::at(board)._set_bio(john(), 0, text("fake"), 4));
}
#[test(should_fail_with="Function _set_avatar can only be called by the same contract")]
unconstrained fn public_avatar_callback_cannot_bypass_private_ownership() {
    let (env, board, alice, _) = setup(); env.call_public(alice, RollingBoard::at(board)._set_avatar(john(), 0, 100, 100, 4, avatar()));
}
#[test(should_fail_with="Stale profile version")]
unconstrained fn bio_previous_version_cannot_be_replayed() {
    let (env, board, alice, _) = setup(); env.call_private(alice, RollingBoard::at(board).set_bio(john(), 0, text("hello"), 5));
    env.call_private(alice, RollingBoard::at(board).set_bio(john(), 0, text("hello"), 5));
}
#[test(should_fail_with="Stale profile version")]
unconstrained fn avatar_previous_version_cannot_be_replayed() {
    let (env, board, alice, _) = setup(); env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 0, 0, 0, [0; 265]));
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 0, 0, 0, [0; 265]));
}
#[test(should_fail_with="Unknown profile name")]
unconstrained fn unknown_profile_read_is_distinct_from_empty_registered_profile() {
    let (env, board, _, _) = setup(); let _ = env.view_public(RollingBoard::at(board).profile_state(0));
}

unconstrained fn moderation_setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let moderator = env.create_light_account(); let alice = env.create_light_account(); let bob = env.create_light_account();
    let board = env.deploy("@rolling_contract/RollingBoard").with_public_initializer(moderator,
        RollingBoard::interface().init(text("No threats"), 10, 1, EthAddress::from_field(0x1111), 1, 10, 1000, 10, 3, 100, 10, moderator));
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("JoHN"), 4, fixed("Doe"), 3));
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 0, 100, 100, 4, avatar()));
    (env, board, moderator, alice, bob)
}
fn removal_reason() -> [Field; 7] { pack_bytes("Threat".as_bytes()) }
#[test]
unconstrained fn moderator_removes_only_selected_current_avatar_without_mutating_profile_or_private_ownership() {
    let (env, board, moderator, alice, bob) = moderation_setup();
    let jane = name_id(fixed("Jane"), 4, fixed("Doe"), 3);
    env.call_private(bob, RollingBoard::at(board).register_name(fixed("Jane"), 4, fixed("Doe"), 3));
    env.call_private(bob, RollingBoard::at(board).set_avatar(jane, 0, 100, 100, 4, avatar()));
    env.call_private(alice, RollingBoard::at(board).set_bio(john(), 0, text("Bio"), 3));
    let profile = env.view_public(RollingBoard::at(board).profile_state(john()));
    let unrelated = env.view_public(RollingBoard::at(board).profile_state(jane));
    let owned = env.execute_utility(RollingBoard::at(board).owned_name_records(alice, 0));
    assert_eq(env.execute_utility(RollingBoard::at(board).avatar_moderation(john())).avatar_version, 0);
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
    let removal = env.execute_utility(RollingBoard::at(board).avatar_moderation(john()));
    assert_eq(removal.avatar_version, 1); assert_eq(removal.avatar_digest, profile.avatar_digest);
    assert_eq(removal.main_policy_version, 1); assert_eq(removal.reason_digest, crate::encoding::text_hash(removal_reason(), 6));
    assert_eq(env.view_public(RollingBoard::at(board).profile_state(john())), profile);
    assert_eq(env.view_public(RollingBoard::at(board).profile_state(jane)), unrelated);
    assert_eq(env.execute_utility(RollingBoard::at(board).owned_name_records(alice, 0)), owned);
    assert_eq(env.execute_utility(RollingBoard::at(board).avatar_moderation(jane)).avatar_version, 0);
    // An authenticated replacement makes the old version's removal inapplicable.
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 1, 100, 100, 4, avatar()));
    let replaced = env.view_public(RollingBoard::at(board).profile_state(john()));
    assert_eq(replaced.avatar_version, 2); assert_eq(replaced.bio_digest, profile.bio_digest);
    assert_eq(env.execute_utility(RollingBoard::at(board).avatar_moderation(john())), removal);
    env.call_public(moderator, RollingBoard::at(board).set_main_policy(text("New rules"), 9));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 2, 2, removal_reason(), 6));
    let next = env.execute_utility(RollingBoard::at(board).avatar_moderation(john()));
    assert_eq(next.avatar_version, 2); assert_eq(next.avatar_digest, replaced.avatar_digest); assert_eq(next.main_policy_version, 2);
}
#[test(should_fail_with="Only moderator")]
unconstrained fn avatar_owner_cannot_impersonate_moderator() {
    let (env, board, _, alice, _) = moderation_setup();
    env.call_public(alice, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
}
#[test(should_fail_with="Unknown profile name")]
unconstrained fn moderator_cannot_remove_unknown_avatar() {
    let (env, board, moderator, _, _) = moderation_setup();
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(99, 1, 1, removal_reason(), 6));
}
#[test(should_fail_with="No current avatar")]
unconstrained fn moderator_cannot_remove_unset_avatar() {
    let (env, board, moderator, alice, _) = moderation_setup();
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("Mary"), 4, fixed("Lee"), 3));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(name_id(fixed("Mary"), 4, fixed("Lee"), 3), 0, 1, removal_reason(), 6));
}
#[test(should_fail_with="No current avatar")]
unconstrained fn moderator_cannot_remove_cleared_avatar() {
    let (env, board, moderator, alice, _) = moderation_setup();
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 1, 0, 0, 0, [0; 265]));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 2, 1, removal_reason(), 6));
}
#[test(should_fail_with="Text required")]
unconstrained fn avatar_removal_requires_nonempty_reason() {
    let (env, board, moderator, _, _) = moderation_setup();
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, [0; 7], 0));
}
#[test(should_fail_with="Text padding")]
unconstrained fn avatar_removal_requires_canonical_reason_padding() {
    let (env, board, moderator, _, _) = moderation_setup();
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 1));
}
#[test(should_fail_with="Avatar already removed")]
unconstrained fn same_avatar_removal_cannot_replay() {
    let (env, board, moderator, _, _) = moderation_setup();
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
}
#[test(should_fail_with="Avatar changed")]
unconstrained fn stale_moderation_cannot_remove_owner_replacement() {
    let (env, board, moderator, alice, _) = moderation_setup();
    env.call_private(alice, RollingBoard::at(board).set_avatar(john(), 1, 100, 100, 4, avatar()));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
}
#[test(should_fail_with="Policy changed")]
unconstrained fn avatar_removal_requires_current_main_policy() {
    let (env, board, moderator, _, _) = moderation_setup();
    env.call_public(moderator, RollingBoard::at(board).set_main_policy(text("New rules"), 9));
    env.call_public(moderator, RollingBoard::at(board).remove_avatar(john(), 1, 1, removal_reason(), 6));
}
#[test(should_fail_with="Unknown profile name")]
unconstrained fn unknown_avatar_moderation_is_not_empty_known_history() {
    let (env, board, _, _, _) = moderation_setup();
    let _ = env.execute_utility(RollingBoard::at(board).avatar_moderation(0));
}
