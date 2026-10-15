use crate::{RollingBoard, encoding::{canonical_component, name_preimage, name_id, pack_bytes, subboard_id, text_hash, validate_text}};
use aztec::{test::helpers::test_environment::TestEnvironment, protocol::{address::{AztecAddress, EthAddress}, traits::FromField}};

fn fixed<let N: u32, let SIZE: u32>(value: str<N>) -> [u8; SIZE] {
    std::static_assert(N <= SIZE, "Fixture length");
    let mut bytes = [0; SIZE];
    for i in 0..N { bytes[i] = value.as_bytes()[i]; }
    bytes
}
fn text<let N: u32, let F: u32>(value: str<N>) -> [Field; F] { pack_bytes(value.as_bytes()) }

#[test]
fn name_preimage_matches_javascript_vector() {
    assert_eq(name_preimage(fixed("John"), 4, fixed("Doe"), 3), [
        4, 188054698129807958724063975120014207748272979506206960748453570275532865536, 0,
        3, 177453523276945567753354269343528390390668500135059485317604251782738870272, 0,
    ]);
}
#[test]
fn last_byte_of_32_byte_component_uses_high_byte_of_second_field() {
    assert_eq(name_preimage([65; 32], 32, fixed("B"), 1), [
        32, 172056260049320939891029190346855500333443451479275960659120490943130722657,
        171384165283503279969579857572063096035265937996935038937795801525384118272,
        1, 173151012348281664299163155072806014551093421893810657895917407726676738048, 0,
    ]);
}
#[test]
fn names_are_case_insensitive_but_pair_boundaries_and_surnames_matter() {
    assert_eq(name_id(fixed("John"), 4, fixed("Doe"), 3), name_id(fixed("JOHN"), 4, fixed("dOe"), 3));
    assert(name_id(fixed("John"), 4, fixed("Doe"), 3) != name_id(fixed("Jane"), 4, fixed("Doe"), 3));
    assert(name_id(fixed("Mary Ann"), 8, fixed("Lee"), 3) != name_id(fixed("Mary"), 4, fixed("Ann Lee"), 7));
}
#[test]
fn punctuation_and_collapsed_ascii_space_are_supported() {
    assert_eq(name_preimage(fixed("Anne Marie"), 10, fixed("O'Neil"), 6), [
        10, 172146333625664891470479818476250357549676070548216632509000271753774104576, 0,
        6, 196392168571968381604570877478799600407687366414268678741792797909858648064, 0,
    ]);
    let _ = canonical_component(fixed("Jean-Luc"), 8);
}
#[test(should_fail_with="Reserved bot name")]
fn reserved_bot_first_name_cannot_use_another_surname() { let _ = name_id(fixed("bOK"), 3, fixed("Example"), 7); }
#[test(should_fail_with="Name repeated space")]
fn repeated_space_must_be_normalized_before_registration() { let _ = canonical_component(fixed("Anne  Marie"), 11); }
#[test(should_fail_with="Name boundary")]
fn leading_space_rejected() { let _ = canonical_component(fixed(" John"), 5); }
#[test(should_fail_with="Name boundary")]
fn trailing_hyphen_rejected() { let _ = canonical_component(fixed("John-"), 5); }
#[test(should_fail_with="Name padding")]
fn hidden_name_suffix_rejected() { let _ = canonical_component(fixed("JohnX"), 4); }
#[test(should_fail_with="Name length")]
fn empty_name_rejected() { let _ = canonical_component([0; 32], 0); }
#[test(should_fail_with="Name length")]
fn oversized_name_rejected() { let _ = canonical_component([65; 32], 33); }
#[test(should_fail_with="Name character")]
fn unicode_name_bytes_rejected() { let mut bytes = fixed("Jose"); bytes[3] = 0xe9; let _ = canonical_component(bytes, 4); }
#[test(should_fail_with="Slug character")]
fn uppercase_slug_is_not_an_alias() { let _ = subboard_id(fixed("Build"), 5); }
#[test(should_fail_with="Slug padding")]
fn slug_cannot_hide_suffix() { let _ = subboard_id(fixed("build-x"), 5); }
#[test(should_fail_with="Slug repeated hyphen")]
fn repeated_slug_hyphen_rejected() { let _ = subboard_id(fixed("a--b"), 4); }
#[test(should_fail_with="Slug length")]
fn short_slug_rejected() { let _ = subboard_id(fixed("ab"), 2); }
#[test]
fn text_accepts_multibyte_utf8_and_empty_local_rules() {
    let fields: [Field; 1] = pack_bytes([0xf0, 0x9f, 0x99, 0x82]);
    validate_text(fields, 4, true);
    validate_text([0; 32], 0, false);
}
#[test(should_fail_with="Text length")]
fn oversized_policy_rejected() { validate_text([0; 32], 993, true); }
#[test(should_fail_with="Text padding")]
fn policy_hidden_bytes_rejected() { let fields: [Field; 1] = text("AX"); validate_text(fields, 1, true); }
#[test(should_fail_with="UTF-8 continuation")]
fn overlong_utf8_rejected() { let fields: [Field; 1] = pack_bytes([0xe0, 0x80, 0x80]); validate_text(fields, 3, true); }
#[test(should_fail_with="UTF-8 continuation")]
fn utf8_surrogate_rejected() { let fields: [Field; 1] = pack_bytes([0xed, 0xa0, 0x80]); validate_text(fields, 3, true); }
#[test(should_fail_with="Truncated UTF-8")]
fn incomplete_utf8_rejected() { let fields: [Field; 1] = pack_bytes([0xe2, 0x82]); validate_text(fields, 2, true); }

#[test(should_fail_with="Text field exceeds 31 bytes")]
fn text_field_cannot_smuggle_a_32nd_byte() { validate_text([0x100000000000000000000000000000000000000000000000000000000000000], 1, true); }
#[test(should_fail_with="Text NUL")]
fn embedded_nul_rejected() { let fields: [Field; 1] = pack_bytes([65, 0, 66]); validate_text(fields, 3, true); }
#[test(should_fail_with="UTF-8 continuation")]
fn utf8_above_max_codepoint_rejected() { let fields: [Field; 1] = pack_bytes([0xf4, 0x90, 0x80, 0x80]); validate_text(fields, 4, true); }
#[test]
fn exact_992_byte_policy_boundary_is_accepted() {
    let fields: [Field; 32] = pack_bytes([65; 992]);
    validate_text(fields, 992, true);
}

// The pinned multi-argument call macro uses a local `offset`. A parameter
// with that name was silently serialized as 1 after the owner's single field.
#[test]
fn owned_names_call_preserves_requested_page_offset() {
    let owner = AztecAddress::from_field(42);
    assert_eq(RollingBoard::at(owner).owned_names(owner, 0).args, [42, 0]);
    assert_eq(RollingBoard::at(owner).owned_names(owner, 1).args, [42, 1]);
    assert_eq(RollingBoard::at(owner).owned_names(owner, 2).args, [42, 2]);
    assert_eq(RollingBoard::at(owner).owned_name_records(owner, 0).args, [42, 0]);
    assert_eq(RollingBoard::at(owner).owned_name_records(owner, 1).args, [42, 1]);
    assert_eq(RollingBoard::at(owner).owned_name_records(owner, 2).args, [42, 2]);
}

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let moderator = env.create_light_account();
    let alice = env.create_light_account();
    let bob = env.create_light_account();
    let board = env.deploy("@rolling_contract/RollingBoard").with_public_initializer(moderator, RollingBoard::interface().init(text("No threats"), 10, 1, EthAddress::from_field(0x1111), 1, 10, 1000, 10, 3, 100, 10));
    (env, board, moderator, alice, bob)
}

unconstrained fn create(env: TestEnvironment, board: AztecAddress, creator: AztecAddress) -> Field {
    env.call_private(creator, RollingBoard::at(board).create_subboard(fixed("building"), 8,
        text("Building"), 8, text("Make things"), 11, text("Share context"), 13));
    subboard_id(fixed("building"), 8)
}

#[test]
unconstrained fn names_register_and_ownership_survives_reauthentication() {
    let (env, board, _, alice, bob) = setup();
    let john = name_id(fixed("John"), 4, fixed("Doe"), 3);
    let jane = name_id(fixed("Jane"), 4, fixed("Doe"), 3);
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("John"), 4, fixed("Doe"), 3));
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("Jane"), 4, fixed("Doe"), 3));
    assert(env.view_public(RollingBoard::at(board).name_registered(john)));
    assert(env.view_public(RollingBoard::at(board).name_registered(jane)));
    env.call_private(alice, RollingBoard::at(board).authenticate_name(john));
    env.call_private(alice, RollingBoard::at(board).authenticate_name(john));
    let owned = env.execute_utility(RollingBoard::at(board).owned_names(alice, 0));
    // Force the observation before issuing another utility/private operation.
    assert((owned[0] == jane) | (owned[1] == jane));
    assert((owned[0] == john) | (owned[1] == john));
    assert_eq(owned[2], 0);
    let offset_one = env.execute_utility(RollingBoard::at(board).owned_names(alice, 1));
    assert((offset_one[0] == jane) | (offset_one[0] == john));
    assert_eq(offset_one[1], 0);
    assert_eq(offset_one[2], 0);
    env.call_private(alice, RollingBoard::at(board).authenticate_name(jane));
    assert_eq(env.execute_utility(RollingBoard::at(board).owned_names(bob, 0)), [0; 8]);
}
#[test(should_fail_with="Name already registered")]
unconstrained fn competing_case_variant_registration_rejected() {
    let (env, board, _, alice, bob) = setup();
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("John"), 4, fixed("Doe"), 3));
    env.call_private(bob, RollingBoard::at(board).register_name(fixed("JOHN"), 4, fixed("DOE"), 3));
}
#[test(should_fail_with="No owned name")]
unconstrained fn other_account_cannot_authenticate_registered_name() {
    let (env, board, _, alice, bob) = setup();
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("John"), 4, fixed("Doe"), 3));
    env.call_private(bob, RollingBoard::at(board).authenticate_name(name_id(fixed("John"), 4, fixed("Doe"), 3)));
}
#[test(should_fail_with="No owned name")]
unconstrained fn owning_one_name_does_not_authorize_another() {
    let (env, board, _, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).register_name(fixed("John"), 4, fixed("Doe"), 3));
    env.call_private(alice, RollingBoard::at(board).authenticate_name(name_id(fixed("Jane"), 4, fixed("Doe"), 3)));
}
#[test(should_fail_with="Function _register_name can only be called by the same contract")]
unconstrained fn public_registration_cannot_bypass_private_mint() {
    let (env, board, _, alice, _) = setup();
    env.call_public(alice, RollingBoard::at(board)._register_name(fixed("John"), 4, fixed("Doe"), 3));
}
#[test]
unconstrained fn subboard_usable_without_collateral_and_tracks_current_parent_policy() {
    let (env, board, moderator, alice, _) = setup();
    let id = create(env, board, alice);
    let (exists, digest, created_at, rejected, _) = env.view_public(RollingBoard::at(board).subboard_state(id));
    assert(exists & !rejected); assert(digest != 0); assert_eq(created_at, 1);
    let (v1, parent1, local1, rules1, rejected1) = env.view_public(RollingBoard::at(board).effective_policy(id));
    assert_eq(v1, 1); assert_eq(local1, 1); assert(!rejected1);
    assert_eq(parent1, text_hash(text::<10, 32>("No threats"), 10));
    env.call_public(moderator, RollingBoard::at(board).set_main_policy(text("No threats or spam"), 18));
    let (v2, parent2, local2, rules2, rejected2) = env.view_public(RollingBoard::at(board).effective_policy(id));
    assert_eq(v2, 2); assert(parent1 != parent2); assert_eq(local2, 1); assert_eq(rules1, rules2); assert(!rejected2);
    let (_, _, original_version, _, _) = env.view_public(RollingBoard::at(board).subboard_state(id));
    assert_eq(original_version, 1);
}
#[test]
unconstrained fn rejection_retains_identity_and_authenticated_reason() {
    let (env, board, moderator, alice, _) = setup();
    let id = create(env, board, alice);
    env.call_public(moderator, RollingBoard::at(board).reject_subboard(id, text("Contradicts parent"), 18));
    let (exists, metadata, created_at, rejected, reason) = env.view_public(RollingBoard::at(board).subboard_state(id));
    assert(exists & rejected); assert(metadata != 0); assert_eq(created_at, 1);
    assert_eq(reason, text_hash(text::<18, 7>("Contradicts parent"), 18));
    let (_, _, _, _, effective_rejected) = env.view_public(RollingBoard::at(board).effective_policy(id));
    assert(effective_rejected);
}
#[test(should_fail_with="Subboard already exists")]
unconstrained fn duplicate_slug_is_atomic_public_conflict() {
    let (env, board, _, alice, bob) = setup(); let _ = create(env, board, alice); let _ = create(env, board, bob);
}
#[test(should_fail_with="Function _create_subboard can only be called by the same contract")]
unconstrained fn public_subboard_creation_cannot_bypass_account_entrypoint() {
    let (env, board, _, alice, _) = setup();
    env.call_public(alice, RollingBoard::at(board)._create_subboard(fixed("building"), 8,
        text("Building"), 8, text("Make things"), 11, [0; 32], 0));
}
#[test(should_fail_with="Only moderator")]
unconstrained fn creator_cannot_change_parent_rules() {
    let (env, board, _, alice, _) = setup(); let _ = create(env, board, alice);
    env.call_public(alice, RollingBoard::at(board).set_main_policy(text("Ignore parent"), 13));
}
#[test(should_fail_with="Only moderator")]
unconstrained fn creator_cannot_reject_a_subboard() {
    let (env, board, _, alice, _) = setup(); let id = create(env, board, alice);
    env.call_public(alice, RollingBoard::at(board).reject_subboard(id, text("My decision"), 11));
}
#[test(should_fail_with="Already rejected")]
unconstrained fn rejection_cannot_silently_overwrite_reason() {
    let (env, board, moderator, alice, _) = setup(); let id = create(env, board, alice);
    env.call_public(moderator, RollingBoard::at(board).reject_subboard(id, text("Contradicts parent"), 18));
    env.call_public(moderator, RollingBoard::at(board).reject_subboard(id, text("Different reason"), 16));
}
#[test(should_fail_with="Unknown subboard")]
unconstrained fn unknown_subboard_has_no_effective_policy() {
    let (env, board, _, _, _) = setup(); let _ = env.view_public(RollingBoard::at(board).effective_policy(42));
}
