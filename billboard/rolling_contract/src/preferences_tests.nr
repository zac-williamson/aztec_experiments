use crate::{RollingBoard, encoding::pack_bytes, preferences::{PreferenceHeadState, validate_toggle,
    preference_digest, next_revision, BOOKMARK, FOLLOW_BOARD, FOLLOW_NAME, THREAD_SUBSCRIPTION,
    REPLY_NOTIFICATIONS, THREAD_READ}};
use aztec::{test::helpers::test_environment::TestEnvironment,
    messages::logs::event::MAX_EVENT_SERIALIZED_LEN,
    protocol::{address::{AztecAddress, EthAddress}, traits::{FromField, Hash, Packable, Serialize}}};

fn event() -> RollingBoard::PreferenceChanged {
    RollingBoard::PreferenceChanged { schema: 1, revision: 1, kind: BOOKMARK, target: 42,
        value: true, read_block: 0, read_hash: 0, previous_digest: 0 }
}
fn transition(old: Option<RollingBoard::PreferenceHeadNote>, expected: u64) -> RollingBoard::PreferenceHeadNote {
    RollingBoard::PreferenceHeadNote::advance(old, expected, 1, 2, AztecAddress::from_field(3),
        BOOKMARK, 42, true, 0, 0)
}
#[test]
fn preference_encoding_fits_standard_note_and_encrypted_event() {
    // The pinned derived Packable uses one field per value, with no custom
    // packing or property-selector layout. Both representations have four fields.
    std::static_assert(<RollingBoard::PreferenceHeadNote as Serialize>::N == 4, "Head schema size");
    std::static_assert(<RollingBoard::PreferenceHeadNote as Packable>::N == 4, "Head packed bound");
    std::static_assert(<RollingBoard::PreferenceChanged as Serialize>::N == 8, "Event schema size");
    std::static_assert(<RollingBoard::PreferenceChanged as Serialize>::N <= MAX_EVENT_SERIALIZED_LEN, "Encrypted event bound");
    assert_eq(event().serialize(), [1, 1, 1, 42, 1, 0, 0, 0]);
    assert_eq(PreferenceHeadState::empty(), PreferenceHeadState { initialized: false, schema: 1, revision: 0, digest: 0 });
}
#[test]
fn digest_binds_every_event_field_and_network_contract_scope() {
    let fields = event().serialize();
    let board = AztecAddress::from_field(3);
    let digest = preference_digest(1, 2, board, fields);
    for i in 0..8 {
        let mut changed = fields; changed[i] = changed[i] + 1;
        assert(digest != preference_digest(1, 2, board, changed));
    }
    assert(digest != preference_digest(2, 2, board, fields));
    assert(digest != preference_digest(1, 3, board, fields));
    assert(digest != preference_digest(1, 2, AztecAddress::from_field(4), fields));
}
#[test]
fn replacement_binds_exact_predecessor_and_increment() {
    let first = transition(Option::none(), 0);
    assert_eq(first.schema, 1); assert_eq(first.revision, 1); assert_eq(first.previous_digest, 0);
    assert_eq(first.digest, preference_digest(1, 2, AztecAddress::from_field(3), event().serialize()));
    let second = transition(Option::some(first), 1);
    assert_eq(second.previous_digest, first.digest); assert_eq(second.revision, 2);
    let mut updated = event(); updated.revision = 2; updated.previous_digest = first.digest;
    assert_eq(second.digest, preference_digest(1, 2, AztecAddress::from_field(3), updated.serialize()));
    assert(second.digest != first.digest);
}
#[test]
fn toggle_enum_accepts_main_board_and_global_only_with_correct_targets() {
    validate_toggle(BOOKMARK, 1); validate_toggle(FOLLOW_BOARD, 0); validate_toggle(FOLLOW_BOARD, 1);
    validate_toggle(FOLLOW_NAME, 1); validate_toggle(THREAD_SUBSCRIPTION, 1); validate_toggle(REPLY_NOTIFICATIONS, 0);
}
#[test(should_fail_with="Unknown preference kind")]
fn zero_kind_rejected() { validate_toggle(0, 1); }
#[test(should_fail_with="Unknown preference kind")]
fn unsupported_kind_rejected() { validate_toggle(255, 1); }
#[test(should_fail_with="Unknown preference kind")]
fn marker_cannot_be_written_through_toggle() { validate_toggle(THREAD_READ, 1); }
#[test(should_fail_with="Preference target required")]
fn zero_bookmark_rejected() { validate_toggle(BOOKMARK, 0); }
#[test(should_fail_with="Preference target required")]
fn anonymous_name_follow_rejected() { validate_toggle(FOLLOW_NAME, 0); }
#[test(should_fail_with="Preference target required")]
fn zero_subscription_rejected() { validate_toggle(THREAD_SUBSCRIPTION, 0); }
#[test(should_fail_with="Global preference target")]
fn global_toggle_cannot_encode_arbitrary_target() { validate_toggle(REPLY_NOTIFICATIONS, 1); }
#[test(should_fail_with="Stale preference revision")]
fn nonexistent_head_cannot_skip_initial_revision() { let _ = transition(Option::none(), 1); }
#[test(should_fail_with="Stale preference revision")]
fn stale_update_cannot_replace_head() {
    let first = transition(Option::none(), 0); let _ = transition(Option::some(first), 0);
}
#[test(should_fail_with="Stale preference revision")]
fn future_expected_revision_rejected() { let _ = next_revision(1, 1, 2, 2); }
#[test(should_fail_with="Invalid preference schema")]
fn unknown_head_schema_rejected() { let _ = next_revision(2, 1, 2, 1); }
#[test(should_fail_with="Invalid preference head")]
fn zero_initialized_revision_rejected() { let _ = next_revision(1, 0, 2, 0); }
#[test(should_fail_with="Invalid preference head")]
fn zero_initialized_digest_rejected() { let _ = next_revision(1, 1, 0, 1); }
#[test(should_fail_with="Preference revision overflow")]
fn revision_cannot_wrap() { let _ = next_revision(1, 18446744073709551615, 1, 18446744073709551615); }

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let moderator = env.create_light_account(); let alice = env.create_light_account(); let bob = env.create_light_account();
    let rules: [Field; 32] = pack_bytes("No threats".as_bytes());
    let board = env.deploy("@rolling_contract/RollingBoard").with_public_initializer(moderator,
        RollingBoard::interface().init(rules, 10, 1, EthAddress::from_field(0x1111), 1, 10, 1000, 10, 3, 100, 10));
    (env, board, alice, bob)
}

// TXE is a protocol development check, not real proof/recovery/privacy evidence.
// Its execute_utility currently supplies all local key-store accounts, so these
// checks do not claim to exercise the production scoped-key rejection boundary.
#[test]
unconstrained fn private_heads_initialize_and_update_independently_without_collateral_or_names() {
    let (env, board, alice, bob) = setup();
    assert_eq(env.execute_utility(RollingBoard::at(board).preference_head(alice)), PreferenceHeadState::empty());
    assert_eq(env.execute_utility(RollingBoard::at(board).preference_head(bob)), PreferenceHeadState::empty());
    env.call_private(alice, RollingBoard::at(board).set_preference(0, BOOKMARK, 42, true));
    let a1 = env.execute_utility(RollingBoard::at(board).preference_head(alice));
    assert(a1.initialized); assert_eq(a1.schema, 1); assert_eq(a1.revision, 1); assert(a1.digest != 0);
    assert_eq(env.execute_utility(RollingBoard::at(board).preference_head(bob)), PreferenceHeadState::empty());
    env.call_private(bob, RollingBoard::at(board).set_preference(0, FOLLOW_BOARD, 0, true));
    let b1 = env.execute_utility(RollingBoard::at(board).preference_head(bob));
    assert(b1.initialized); assert_eq(b1.revision, 1); assert(b1.digest != a1.digest);
    env.call_private(alice, RollingBoard::at(board).set_preference(1, BOOKMARK, 42, false));
    let a2 = env.execute_utility(RollingBoard::at(board).preference_head(alice));
    assert_eq(a2.revision, 2); assert(a2.digest != a1.digest);
    assert_eq(env.execute_utility(RollingBoard::at(board).preference_head(bob)), b1);
}
#[test]
unconstrained fn read_marker_commits_actual_canonical_header() {
    let (env, board, alice, _) = setup();
    let through = env.last_block_number();
    let (chain, version, header_hash) = env.private_context(|context| {
        (context.chain_id(), context.version(), context.get_block_header_at(through).hash())
    });
    env.call_private(alice, RollingBoard::at(board).mark_thread_read(0, 99, through));
    let head = env.execute_utility(RollingBoard::at(board).preference_head(alice));
    let expected = RollingBoard::PreferenceChanged { schema: 1, revision: 1, kind: THREAD_READ,
        target: 99, value: true, read_block: through, read_hash: header_hash, previous_digest: 0 };
    assert_eq(head.digest, preference_digest(chain, version, board, expected.serialize()));
}
#[test(should_fail_with="Stale preference revision")]
unconstrained fn actual_stale_update_is_rejected() {
    let (env, board, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).set_preference(0, BOOKMARK, 42, true));
    env.call_private(alice, RollingBoard::at(board).set_preference(0, BOOKMARK, 42, false));
}
#[test(should_fail_with="Unknown preference kind")]
unconstrained fn actual_unknown_kind_is_rejected() {
    let (env, board, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).set_preference(0, 7, 42, true));
}
#[test(should_fail_with="Future read marker")]
unconstrained fn future_read_marker_is_rejected() {
    let (env, board, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).mark_thread_read(0, 99, 0xffffffff));
}
#[test(should_fail_with="Preference target required")]
unconstrained fn zero_thread_marker_is_rejected() {
    let (env, board, alice, _) = setup();
    env.call_private(alice, RollingBoard::at(board).mark_thread_read(0, 0, 0));
}
