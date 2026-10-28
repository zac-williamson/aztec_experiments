// TXE unit evidence only: Inbox leaves are inserted by the official TestEnvironment.
// These tests are not token deposits, L1 settlement, genuine proofs or privacy qualification.
use private_bok::{PrivateBok, words, recipient_commitment};
use invocation_probe_board::InvocationProbeBoard;
use uint_note::PartialUintNote;
use aztec::{test::helpers::test_environment::TestEnvironment,
    protocol::{address::{AztecAddress, EthAddress}, hash::sha256_to_field, traits::{FromField, ToField}}};

unconstrained fn empty() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let user = env.create_light_account(); let operator = env.create_light_account(); let board = env.create_light_account();
    let address = env.deploy("@private_bok/PrivateBok").with_public_initializer(user, PrivateBok::interface().init(board, operator, 1, 1));
    env.call_public(user, PrivateBok::at(address).set_portal(EthAddress::from_field(123)));
    (env, address, user, operator, board)
}

unconstrained fn message(env: TestEnvironment, a: AztecAddress, user: AztecAddress, amount: u128, salt: Field, secret: Field) -> Field {
    let portal = EthAddress::from_field(123);
    let recipient = recipient_commitment(1, portal, a, 1, user, salt);
    assert(recipient != user.to_field());
    let content = sha256_to_field(words("PLUGIN_CREDIT_V1", [1, 123, a.to_field(), 1, recipient, amount as Field]));
    env.send_l1_to_l2_message(content, secret, portal, a)
}

unconstrained fn fund(env: TestEnvironment, a: AztecAddress, user: AztecAddress, amount: u128, salt: Field, secret: Field) {
    let leaf = message(env, a, user, amount, salt, secret);
    env.call_private(user, PrivateBok::at(a).claim(amount, salt, secret, leaf));
}

unconstrained fn funded() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let (env, a, user, op, board) = empty(); fund(env, a, user, 1000, 101, 201);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    (env, a, user, op, board)
}

unconstrained fn active() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let (env, a, user, op, board) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    env.call_public(board, PrivateBok::at(a).on_invocation(10, 42));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    (env, a, user, op, board)
}

unconstrained fn expired_reserved() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let (env, a, user, op, _) = active();
    let before = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(before.deadline); env.call_private(user, PrivateBok::at(a).expire(10));
    let after = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(after.state, 3); assert_eq(after.reserved, 600); assert_eq(after.refunded, 0);
    assert_eq(after.available, 0); assert(after.primary_done); assert(!after.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    (env, a, user, op)
}

#[test]
unconstrained fn full_private_credit_request_charge_refund_and_withdrawal() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 120, 301));
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.available, 480); assert_eq(r.reserved, 0); assert_eq(r.charged, 120); assert_eq(r.sequence, 1);
    env.call_public(op, PrivateBok::at(a).finish(10));
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 4); assert_eq(r.refunded, 480); assert(r.primary_done & r.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 880);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 120);
    env.call_private(user, PrivateBok::at(a).withdraw(880, EthAddress::from_field(456), 401));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 0);
    env.call_public(op, PrivateBok::at(a).withdraw_earnings(120, EthAddress::from_field(457), 402));
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 0);
}

#[test]
unconstrained fn waiting_request_is_cancellable() {
    let (env, a, user, _, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    env.call_private(user, PrivateBok::at(a).cancel(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 4); assert(r.primary_done & r.secondary_done);
}

#[test(should_fail_with = "Reservation unresolved")]
unconstrained fn activated_budget_cannot_be_cancelled_during_paid_work() {
    let (env, a, user, _, _) = active(); env.call_private(user, PrivateBok::at(a).cancel(10));
}

#[test]
unconstrained fn expiry_releases_only_unused_credit_then_reconciles_reserved_charge() {
    let (env, a, user, op) = expired_reserved();
    env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 120, 302));
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 4); assert_eq(r.reserved, 0); assert_eq(r.charged, 120); assert_eq(r.refunded, 480);
    assert(r.primary_done & r.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 880);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 120);
}

#[test]
unconstrained fn uncertain_call_fences_early_and_reconciles_without_another_call() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).close_uncertain(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 0, 303));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
}

#[test]
unconstrained fn zero_refunds_mark_both_channels_without_completing_zero_notes() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).close_uncertain(10));
    env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 600, 304));
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.refunded, 0); assert(r.primary_done & r.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 600);
}

#[test]
unconstrained fn fragmented_private_credit_uses_more_than_initial_two_notes() {
    let (env, a, user, _, _) = empty();
    fund(env, a, user, 100, 11, 21); fund(env, a, user, 100, 12, 22); fund(env, a, user, 100, 13, 23);
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 250));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 50);
    env.call_private(user, PrivateBok::at(a).cancel(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 300);
}

#[test(should_fail_with = "No non-nullified L1 to L2 message found for message hash")]
unconstrained fn claim_replay_rejected() {
    let (env, a, user, _, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(user, PrivateBok::at(a).claim(1000, 101, 201, leaf));
    env.call_private(user, PrivateBok::at(a).claim(1000, 101, 201, leaf));
}
#[test(should_fail)]
unconstrained fn known_salt_and_secret_do_not_authorize_another_owner() {
    let (env, a, user, other, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(other, PrivateBok::at(a).claim(1000, 101, 201, leaf));
}
#[test(should_fail)]
unconstrained fn wrong_claim_amount_rejected() {
    let (env, a, user, _, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(user, PrivateBok::at(a).claim(1001, 101, 201, leaf));
}
#[test(should_fail_with = "Insufficient private credit")]
unconstrained fn escrow_and_private_balance_cannot_double_spend() {
    let (env, a, user, _, _) = active(); env.call_private(user, PrivateBok::at(a).authorize_request(11, 42, 401));
}
#[test(should_fail_with = "Duplicate request")]
unconstrained fn request_cannot_be_opened_twice() {
    let (env, a, user, _, _) = active(); env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 1));
}
#[test(should_fail_with = "Only configured board")]
unconstrained fn user_cannot_impersonate_board() {
    let (env, a, user, _, _) = funded(); env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 1));
    env.call_public(user, PrivateBok::at(a).on_invocation(10, 42));
}
#[test(should_fail_with = "Request not waiting")]
unconstrained fn activation_replay_rejected() { let (env, a, _, _, board) = active(); env.call_public(board, PrivateBok::at(a).on_invocation(10, 42)); }
#[test(should_fail_with = "Only operator")]
unconstrained fn user_cannot_reserve() { let (env, a, user, _, _) = active(); env.call_public(user, PrivateBok::at(a).reserve(10, 0, 1)); }
#[test(should_fail_with = "Reservation unresolved")]
unconstrained fn second_reservation_cannot_replace_unresolved_liability() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).reserve(10, 0, 1));
}
#[test(should_fail_with = "Invalid actual charge")]
unconstrained fn overcharge_rejected() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 601, 99));
}
#[test(should_fail_with = "Wrong call sequence")]
unconstrained fn settlement_replay_rejected() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99)); env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99));
}
#[test(should_fail_with = "No owned request control")]
unconstrained fn wrong_owner_cannot_cancel() { let (env, a, _, other, _) = active(); env.call_private(other, PrivateBok::at(a).cancel(10)); }
#[test(should_fail_with = "Reservation unresolved")]
unconstrained fn owner_cannot_cancel_unknown_spending() {
    let (env, a, user, op, _) = active(); env.call_private(user, PrivateBok::at(a).cancel(10));
}
#[test(should_fail_with = "Request not active")]
unconstrained fn finish_replay_rejected() { let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 111)); env.call_public(op, PrivateBok::at(a).finish(10)); env.call_public(op, PrivateBok::at(a).finish(10)); }
#[test(should_fail_with = "Request not expirable")]
unconstrained fn expiry_replay_cannot_complete_primary_again() { let (env, a, user, _) = expired_reserved(); env.call_private(user, PrivateBok::at(a).expire(10)); }
#[test(should_fail_with = "Request not fenced")]
unconstrained fn late_reconciliation_replay_cannot_complete_secondary_again() {
    let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 1, 98)); env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 1, 99));
}
#[test(should_fail_with = "Only operator")]
unconstrained fn other_user_cannot_invent_late_receipt() { let (env, a, user, _) = expired_reserved(); env.call_public(user, PrivateBok::at(a).reconcile(10, 0, 1, 98)); }
#[test(should_fail_with = "Request not active")]
unconstrained fn fenced_request_cannot_start_new_paid_call() { let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).reserve(10, 0, 1)); }
#[test(should_fail_with = "Call start deadline")]
unconstrained fn active_request_cannot_start_paid_call_after_deadline() {
    let (env, a, _, op, _) = active(); let r = env.view_public(PrivateBok::at(a).request(10)); env.mine_block_at(r.deadline);
    env.call_public(op, PrivateBok::at(a).reserve(10, 0, 1));
}
#[test(should_fail_with = "Insufficient private credit")]
unconstrained fn owner_cannot_withdraw_reserved_credit() { let (env, a, user, _, _) = active(); env.call_private(user, PrivateBok::at(a).withdraw(401, EthAddress::from_field(456), 400)); }
#[test(should_fail_with = "Insufficient operator earnings")]
unconstrained fn deposit_credit_is_not_operator_earnings() { let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).withdraw_earnings(1, EthAddress::from_field(456), 400)); }
#[test(should_fail_with = "failed with duplicate nullifiers")]
unconstrained fn withdrawal_nonce_replay_rejected() {
    let (env, a, user, _, _) = funded(); env.call_private(user, PrivateBok::at(a).withdraw(1, EthAddress::from_field(456), 400)); env.call_private(user, PrivateBok::at(a).withdraw(1, EthAddress::from_field(456), 400));
}

#[test]
fn recipient_commitment_is_salted_and_domain_bound() {
    let owner = AztecAddress::from_field(5); let escrow = AztecAddress::from_field(6); let portal = EthAddress::from_field(7);
    let c = recipient_commitment(1, portal, escrow, 1, owner, 8);
    assert(c != recipient_commitment(1, portal, escrow, 1, owner, 9));
    assert(c != recipient_commitment(2, portal, escrow, 1, owner, 8));
    assert(c != recipient_commitment(1, portal, AztecAddress::from_field(9), 1, owner, 8));
    assert(c != recipient_commitment(1, portal, escrow, 2, owner, 8));
    assert(c != recipient_commitment(1, portal, escrow, 1, AztecAddress::from_field(9), 8));
    assert(c != recipient_commitment(1, EthAddress::from_field(9), escrow, 1, owner, 8));
}

#[test]
unconstrained fn successive_settled_calls_conserve_credit() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 150, 301));
    env.call_public(op, PrivateBok::at(a).reserve(10, 1, 450));
    env.call_public(op, PrivateBok::at(a).settle(10, 1, 70, 302));
    env.call_public(op, PrivateBok::at(a).finish(10));
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.sequence, 2); assert_eq(r.charged, 220); assert_eq(r.refunded, 380);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 780);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 220);
}

#[test]
unconstrained fn unreserved_waiting_expiry_returns_all_credit() {
    let (env, a, user, _, _) = funded(); env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    let r = env.view_public(PrivateBok::at(a).request(10)); env.mine_block_at(r.deadline);
    env.call_private(user, PrivateBok::at(a).expire(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 4); assert(r.primary_done & r.secondary_done);
}

#[test(should_fail)]
unconstrained fn wrong_recipient_salt_rejected() {
    let (env, a, user, _, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(user, PrivateBok::at(a).claim(1000, 102, 201, leaf));
}
#[test(should_fail)]
unconstrained fn wrong_bridge_secret_rejected() {
    let (env, a, user, _, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(user, PrivateBok::at(a).claim(1000, 101, 202, leaf));
}
#[test(should_fail)]
unconstrained fn direct_public_cancellation_cannot_bypass_control_note() {
    let (env, a, user, _, _) = active(); env.call_public(user, PrivateBok::at(a)._cancel(10));
}
#[test(should_fail_with = "EMITNULLIFIER: Attempted to emit duplicate nullifier")]
unconstrained fn receipt_cannot_charge_two_calls() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99));
    env.call_public(op, PrivateBok::at(a).reserve(10, 1, 10)); env.call_public(op, PrivateBok::at(a).settle(10, 1, 1, 99));
}
#[test(should_fail_with = "Request not cancellable")]
unconstrained fn private_cancel_after_terminal_completion_rejected() {
    let (env, a, user, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 111)); env.call_public(op, PrivateBok::at(a).finish(10));
    env.call_private(user, PrivateBok::at(a).cancel(10));
}
#[test(should_fail_with = "Request not active")]
unconstrained fn finish_after_private_cancel_rejected() {
    let (env, a, user, op, _) = funded(); env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600)); env.call_private(user, PrivateBok::at(a).cancel(10));
    env.call_public(op, PrivateBok::at(a).finish(10));
}
#[test(should_fail_with = "Request not expirable")]
unconstrained fn expiry_after_finish_rejected() {
    let (env, a, user, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 111)); env.call_public(op, PrivateBok::at(a).finish(10));
    env.call_private(user, PrivateBok::at(a).expire(10));
}
#[test(should_fail_with = "Request not fenced")]
unconstrained fn ordinary_completion_cannot_use_secondary_channel() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 111)); env.call_public(op, PrivateBok::at(a).finish(10));
    env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 0, 99));
}
#[test(should_fail_with = "No active uncertain reservation")]
unconstrained fn fencing_replay_rejected() {
    let (env, a, _, op, _) = active(); env.call_public(op, PrivateBok::at(a).close_uncertain(10)); env.call_public(op, PrivateBok::at(a).close_uncertain(10));
}
#[test(should_fail_with = "Request not active")]
unconstrained fn ordinary_settle_after_fencing_rejected() {
    let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99));
}
#[test(should_fail_with = "Expire then reconcile")]
unconstrained fn late_ordinary_settle_requires_expiry_transition() {
    let (env, a, _, op, _) = active(); let r = env.view_public(PrivateBok::at(a).request(10)); env.mine_block_at(r.deadline);
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99));
}
#[test(should_fail_with = "Invalid actual charge")]
unconstrained fn late_reconciliation_cannot_overcharge() {
    let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 601, 99));
}
#[test(should_fail_with = "Wrong call sequence")]
unconstrained fn late_reconciliation_requires_original_call_sequence() {
    let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).reconcile(10, 1, 1, 99));
}
#[test(should_fail_with = "Receipt required")]
unconstrained fn zero_cost_still_requires_a_receipt() {
    let (env, a, _, op) = expired_reserved(); env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 0, 0));
}

unconstrained fn bound_waiting_request() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new(); let alice = env.create_light_account(); let bob = env.create_light_account();
    let board = env.deploy("@invocation_probe_board/InvocationProbeBoard").with_public_initializer(alice, InvocationProbeBoard::interface().init());
    let a = env.deploy("@private_bok/PrivateBok").with_public_initializer(alice, PrivateBok::interface().init(board, bob, 1, 1));
    env.call_public(alice, PrivateBok::at(a).set_portal(EthAddress::from_field(123)));
    fund(env, a, alice, 1000, 101, 201);
    let hash = env.view_public(InvocationProbeBoard::at(board).target_hash(a, [0, 0, 0, 3, 0, 99, 42, 0], [0; 32]));
    env.call_private(alice, PrivateBok::at(a).authorize_request(10, hash, 600));
    (env, a, alice, bob, board)
}

#[test(should_fail_with = "Invocation target mismatch")]
unconstrained fn other_user_cannot_hijack_waiting_budget_for_a_different_target() {
    let (env, a, _, bob, board) = bound_waiting_request();
    // A valid board caller changes the content nonce. The actual board derives the
    // resulting target; Bob cannot provide Alice's target hash alongside his content.
    env.call_public(bob, InvocationProbeBoard::at(board).invoke(a, 10, [0, 0, 0, 3, 0, 99, 43, 0], [0; 32]));
}

#[test]
unconstrained fn board_recomputes_the_authorized_target() {
    let (env, a, alice, _, board) = bound_waiting_request();
    env.call_public(alice, InvocationProbeBoard::at(board).invoke(a, 10, [0, 0, 0, 3, 0, 99, 42, 0], [0; 32]));
    assert_eq(env.view_public(PrivateBok::at(a).request(10)).state, 2);
}

#[test(should_fail_with = "Only operator")]
unconstrained fn forged_operator_settle_rejected() {
    let (env, a, user, op, _) = active(); env.call_public(user, PrivateBok::at(a).settle(10, 0, 1, 99));
}
#[test(should_fail_with = "Only operator")]
unconstrained fn forged_operator_finish_rejected() { let (env, a, user, _, _) = active(); env.call_public(user, PrivateBok::at(a).finish(10)); }
#[test(should_fail_with = "EMITNULLIFIER: Attempted to emit duplicate nullifier")]
unconstrained fn receipt_cannot_charge_two_requests() {
    let (env, a, user, op, board) = active();
    env.call_private(user, PrivateBok::at(a).authorize_request(11, 43, 400));
    env.call_public(board, PrivateBok::at(a).on_invocation(11, 43));
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 1, 99));
    env.call_public(op, PrivateBok::at(a).settle(11, 0, 1, 99));
}
#[test]
unconstrained fn zero_normal_refund_closes_both_channels() {
    let (env, a, user, op, _) = active(); env.call_public(op, PrivateBok::at(a).settle(10, 0, 600, 99)); env.call_public(op, PrivateBok::at(a).finish(10));
    let r = env.view_public(PrivateBok::at(a).request(10)); assert(r.primary_done & r.secondary_done); assert_eq(r.refunded, 0);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
}

#[test]
fn invocation_target_matches_shared_javascript_vector() {
    let mut packed = [0; 32];
    packed[0] = 117422252807265179391402504499916356085208843223731522392806657831697645568;
    let actual = invocation_probe_board::invocation_target(11155111, 2914217885,
        AztecAddress::from_field(10), AztecAddress::from_field(20), [30, 40, 50, 2, 60, 70, 80, 15], packed);
    assert_eq(actual, 0x27c89f3dda5aee1d8928d5186add9cc35c4134934c16023801e4371b43763d6d);
}

#[test(should_fail)]
unconstrained fn wrong_bridge_domain_rejected() {
    let (env, a, user, _, _) = empty(); let portal = EthAddress::from_field(123);
    let recipient = recipient_commitment(1, portal, a, 1, user, 101);
    let wrong = sha256_to_field(words("PLUGIN_CREDIT_V1", [2, 123, a.to_field(), 1, recipient, 1000]));
    let leaf = env.send_l1_to_l2_message(wrong, 201, portal, a);
    env.call_private(user, PrivateBok::at(a).claim(1000, 101, 201, leaf));
}
#[test(should_fail)]
unconstrained fn wrong_bridge_leaf_rejected() {
    let (env, a, user, _, _) = empty(); let leaf = message(env, a, user, 1000, 101, 201);
    env.call_private(user, PrivateBok::at(a).claim(1000, 101, 201, leaf + 1));
}
#[test(should_fail)]
unconstrained fn forged_public_open_cannot_create_unfunded_escrow() {
    let (env, a, user, _, _) = empty();
    env.call_public(user, PrivateBok::at(a)._open_escrow(10, 42, 600, PartialUintNote::from_field(123), PartialUintNote::from_field(456)));
}


#[test]
unconstrained fn unrelated_unfunded_user_can_expire_active_request() {
    let (mut env, a, user, op, board) = active();
    let other = env.create_light_account();
    assert((other != user) & (other != op) & (other != board));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(other)), 0);
    let before = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(before.deadline + 1);
    env.call_private(other, PrivateBok::at(a).expire(10));
    let after = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(after.state, 3); assert_eq(after.available, 0); assert_eq(after.reserved, 600);
    assert_eq(after.charged, 0); assert_eq(after.refunded, 0);
    assert(after.primary_done & !after.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(other)), 0);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 0);
}

#[test]
unconstrained fn unrelated_unfunded_user_can_expire_reserved_request_at_deadline() {
    let (mut env, a, user, op, board) = active();
    let other = env.create_light_account();
    assert((other != user) & (other != op) & (other != board));
    let before = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(before.deadline);
    env.call_private(other, PrivateBok::at(a).expire(10));
    let after = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(after.state, 3); assert_eq(after.available, 0); assert_eq(after.reserved, 600);
    assert_eq(after.charged, 0); assert_eq(after.refunded, 0);
    assert(after.primary_done); assert(!after.secondary_done);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(other)), 0);
    env.call_public(op, PrivateBok::at(a).reconcile(10, 0, 120, 305));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 880);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(other)), 0);
    assert_eq(env.view_public(PrivateBok::at(a).earned()), 120);
}

#[test(should_fail_with = "Request not expired")]
unconstrained fn waiting_expiry_before_deadline_rejected() {
    let (env, a, user, _, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    let r = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(r.deadline - 1);
    env.call_private(user, PrivateBok::at(a).expire(10));
}

#[test(should_fail_with = "Request not expired")]
unconstrained fn active_expiry_before_deadline_rejected() {
    let (env, a, user, _, _) = active();
    let r = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(r.deadline - 1);
    env.call_private(user, PrivateBok::at(a).expire(10));
}

#[test(should_fail_with = "Request not expired")]
unconstrained fn reserved_expiry_before_deadline_rejected() {
    let (env, a, user, op, _) = active();
    let r = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(r.deadline - 1);
    env.call_private(user, PrivateBok::at(a).expire(10));
}

#[test(should_fail_with = "Function _expire can only be called by the same contract")]
unconstrained fn direct_public_expiry_cannot_bypass_private_entry() {
    let (env, a, user, _, _) = active();
    let r = env.view_public(PrivateBok::at(a).request(10));
    env.mine_block_at(r.deadline);
    env.call_public(user, PrivateBok::at(a)._expire(10));
}

#[test(should_fail_with="Only operator")]
unconstrained fn reply_only_operator() {
    let (env, a, user, op, _) = active();
    env.call_private(user, PrivateBok::at(a).publish_reply(10, 77, [0; 32], 0, 1, 0));
}

// These fixtures use a light-account Board stub. Test the live public guards
// directly; RollingBoard posting_tests covers the complete private reply path.
#[test(should_fail_with="Function _publish_reply can only be called by the same contract")]
unconstrained fn reply_public_continuation_requires_private_entry() {
    let (env, a, user, _, _) = active();
    env.call_public(user, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Request not active")]
unconstrained fn reply_unknown_request() {
    let (env, a, user, op, _) = active();
    env.call_public(a, PrivateBok::at(a)._publish_reply(11, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Reservation unresolved")]
unconstrained fn reply_reservation_fenced() {
    let (env, a, user, op, _) = active();
    env.call_public(a, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Request expired")]
unconstrained fn reply_at_deadline_rejected() {
    let (env, a, user, op, _) = active();
    let r = env.view_public(PrivateBok::at(a).request(10)); env.mine_block_at(r.deadline);
    env.call_public(a, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Request not active")]
unconstrained fn reply_after_finish_rejected() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 111)); env.call_public(op, PrivateBok::at(a).finish(10));
    env.call_public(a, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Request not active")]
unconstrained fn reply_uncertain_request_rejected() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).close_uncertain(10));
    env.call_public(a, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}

#[test(should_fail_with="Request not active")]
unconstrained fn waiting_authorization_cannot_publish_reply() {
    let (env, a, user, op, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    env.call_public(a, PrivateBok::at(a)._publish_reply(10, 77, [0; 32], 0, 1, 0, 0, 0));
}


#[test]
unconstrained fn owned_requests_empty_and_owner_scoped() {
    let (mut env, a, user, _, _) = funded(); let other = env.create_light_account();
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [0; 8]);
    fund(env, a, other, 100, 102, 202);
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 100));
    env.call_private(other, PrivateBok::at(a).authorize_request(20, 43, 100));
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(other, 0)), [20, 0, 0, 0, 0, 0, 0, 0]);
}

#[test]
unconstrained fn owned_requests_pages_cover_eight_nine_and_seventeen_without_duplicates() {
    let (env, a, user, _, _) = funded();
    for i in 0..17 {
        env.call_private(user, PrivateBok::at(a).authorize_request((i + 1) as Field, (i + 100) as Field, 1));
        if i == 7 { assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 8)), [0; 8]); }
        if i == 8 {
            let ninth = env.execute_utility(PrivateBok::at(a).owned_requests(user, 8));
            assert(ninth[0] != 0); for j in 1..8 { assert_eq(ninth[j], 0); }
        }
    }
    let first = env.execute_utility(PrivateBok::at(a).owned_requests(user, 0));
    let second = env.execute_utility(PrivateBok::at(a).owned_requests(user, 8));
    let third = env.execute_utility(PrivateBok::at(a).owned_requests(user, 16));
    let mut seen = [false; 17];
    for i in 0..8 {
        let id = first[i]; assert((id as u32 > 0) & (id as u32 <= 17));
        let index = id as u32 - 1; assert(!seen[index]); seen[index] = true;
        let id = second[i]; assert((id as u32 > 0) & (id as u32 <= 17));
        let index = id as u32 - 1; assert(!seen[index]); seen[index] = true;
    }
    assert((third[0] as u32 > 0) & (third[0] as u32 <= 17));
    let index = third[0] as u32 - 1; assert(!seen[index]); seen[index] = true;
    for i in 1..8 { assert_eq(third[i], 0); }
    for i in 0..17 { assert(seen[i]); }
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 17)), [0; 8]);
}

#[test]
unconstrained fn owned_requests_preserve_cancelled_history_and_exact_refund() {
    let (env, a, user, _, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    env.call_private(user, PrivateBok::at(a).cancel(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.refunded, 600); assert_eq(r.state, 4); assert_eq(r.reserved, 0);
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 1)), [0; 8]);
}

#[test(should_fail_with="Request not cancellable")]
unconstrained fn owned_requests_retained_control_cannot_cancel_twice() {
    let (env, a, user, _, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    env.call_private(user, PrivateBok::at(a).cancel(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    env.call_private(user, PrivateBok::at(a).cancel(10));
}

#[test]
unconstrained fn owned_requests_track_reservation_charge_and_release_without_public_owner() {
    let (env, a, user, op, _) = active();
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 120, 301));
    env.call_public(op, PrivateBok::at(a).finish(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.charged, 120); assert_eq(r.refunded, 480); assert_eq(r.reserved, 0);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 880);
}

#[test]
unconstrained fn activation_locks_full_authorized_budget_without_operator_transaction() {
    let (env, a, user, op, _) = active();
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 2); assert_eq(r.sequence, 0); assert_eq(r.reserved, 600);
    assert_eq(r.available, 0); assert_eq(r.charged, 0); assert_eq(r.refunded, 0);
    assert_eq(r.available + r.reserved + r.charged + r.refunded, r.budget);
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 0, 901));
    env.call_public(op, PrivateBok::at(a).finish(10));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
}


// Cold native store means a second browser with the same registered owner keys:
// on-chain logs remain; note/fact/event data and discovery indexes are discarded.
#[oracle(rolling_test_forget_private_state)]
unconstrained fn forget_private_state() {}
#[oracle(rolling_test_assert_effects)]
unconstrained fn assert_effects(notes: u32, logs: u32) {}

#[test]
unconstrained fn owner_delivery_cold_claim_authorize_cancel_and_withdraw() {
    let (env, a, user, other, _) = funded();
    assert_effects(1, 1);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(other)), 0);
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 600));
    // Exactly change + control notes and their logs plus two partial messages.
    assert_effects(2, 4);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(other, 0)), [0; 8]);
    env.call_private(user, PrivateBok::at(a).cancel(10));
    // Retained control plus one completed public refund; no extra discovery note.
    assert_effects(2, 1);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
    assert_eq(env.execute_utility(PrivateBok::at(a).owned_requests(user, 0)), [10, 0, 0, 0, 0, 0, 0, 0]);
    env.call_private(user, PrivateBok::at(a).withdraw(200, EthAddress::from_field(456), 401));
    assert_effects(1, 1);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 800);
    env.call_private(user, PrivateBok::at(a).withdraw(800, EthAddress::from_field(456), 402));
    assert_effects(0, 0);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 0);
}

#[test]
unconstrained fn owner_delivery_cold_primary_then_late_secondary_refund() {
    let (env, a, user, op, _) = active();
    env.call_public(op, PrivateBok::at(a).settle(10, 0, 120, 301));
    env.call_public(op, PrivateBok::at(a).reserve(10, 1, 100));
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 400);
    env.call_public(op, PrivateBok::at(a).close_uncertain(10));
    assert_effects(1, 0);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 780);
    // Secondary channel completes after the first channel was already discovered.
    env.call_public(op, PrivateBok::at(a).reconcile(10, 1, 40, 302));
    assert_effects(1, 0);
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 840);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 840);
    let r = env.view_public(PrivateBok::at(a).request(10));
    assert_eq(r.state, 4); assert_eq(r.charged, 160); assert_eq(r.refunded, 440);
    assert(r.primary_done & r.secondary_done);
    env.call_private(user, PrivateBok::at(a).withdraw(840, EthAddress::from_field(456), 403));
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 0);
}

#[test]
unconstrained fn owner_delivery_exact_budget_emits_no_change_note() {
    let (env, a, user, _, _) = funded();
    env.call_private(user, PrivateBok::at(a).authorize_request(10, 42, 1000));
    assert_effects(1, 3);
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 0);
    env.call_private(user, PrivateBok::at(a).cancel(10));
    forget_private_state();
    assert_eq(env.execute_utility(PrivateBok::at(a).balance_of(user)), 1000);
}
