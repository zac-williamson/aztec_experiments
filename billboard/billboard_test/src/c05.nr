// C05: actual TXE application calls plus independent integer boundary models.
// TXE executes actual queued public calls. Its separate next-block timestamp
// control tests delayed inclusion without claiming network proof validation.
use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::FromField;
use aztec::test::helpers::test_environment::TestEnvironment;
use billboard_contract::Billboard;
use billboard_contract::lib::{compute_cooldown, compute_next_allowed, checked_time_add,
    policy_version, get_deposit_msg_hash, deposit_chain_id};
use crate::{setup_with_deposit, test_chain, fresh_post_nonce, msg_with, reason_with};

global AMOUNT: u128 = 1_000_000_000_000_000;

unconstrained fn published() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, Field, Field) {
    let (mut env, board, owner, censor, time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    env.mine_block_at(time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none()));
    let id = env.view_public(Billboard::at(board).get_post_id(0));
    (env, board, owner, censor, chain, id)
}

#[test]
unconstrained fn c05_policy_snapshot_survives_policy_change() {
    let (env, board, _owner, censor, _chain, id) = published();
    let original = env.view_public(Billboard::at(board).get_post_policy_version(id));
    assert_eq(original, env.view_public(Billboard::at(board).get_policy_version()));
    let (initial_policy, initial_length, initial_version) = env.view_public(Billboard::at(board).get_moderation_policy_snapshot());
    assert_eq(initial_policy, crate::policy_with_byte(65).0);
    assert_eq(initial_length, 1);
    assert_eq(initial_version, original);
    assert_eq(initial_version, policy_version(board, initial_policy, initial_length));
    let mut policy = [0; 48]; policy[0] = crate::policy_with_byte(66).0[0];
    env.call_public(censor, Billboard::at(board).set_moderation_policy(policy, 1));
    assert(original != env.view_public(Billboard::at(board).get_policy_version()));
    let (updated_policy, updated_length, updated_version) = env.view_public(Billboard::at(board).get_moderation_policy_snapshot());
    assert_eq(updated_policy, policy); assert_eq(updated_length, 1);
    assert_eq(updated_version, policy_version(board, updated_policy, updated_length));
    assert(updated_version != initial_version);
    assert_eq(env.view_public(Billboard::at(board).get_post_policy_version(id)), original);
    env.call_public(censor, Billboard::at(board).declare_immoral(id, updated_version, reason_with(2), 4));
    assert(env.view_public(Billboard::at(board).is_post_flagged(id)));
    assert_eq(env.view_public(Billboard::at(board).get_censor_response(id)), reason_with(2));
    assert_eq(env.view_public(Billboard::at(board).get_censor_response_length(id)), 4);
}

#[test(should_fail_with = "Policy version mismatch")]
unconstrained fn c05_flag_rejects_stale_reviewed_policy() {
    let (env, board, _owner, censor, _chain, id) = published();
    let original = env.view_public(Billboard::at(board).get_policy_version());
    let (policy, length) = crate::policy_with_byte(66);
    env.call_public(censor, Billboard::at(board).set_moderation_policy(policy, length));
    env.call_public(censor, Billboard::at(board).declare_immoral(id, original, reason_with(2), 4));
}

#[test]
unconstrained fn c05_flag_exact_deadline_hides_without_penalty() {
    let (mut env, board, owner, censor, chain, id) = published();
    let version = env.view_public(Billboard::at(board).get_post_policy_version(id));
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    env.mine_block_at(deadline);
    env.call_public(censor, Billboard::at(board).declare_immoral(id, version, reason_with(2), 4));
    assert(env.view_public(Billboard::at(board).is_post_flagged(id)));
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[7], 1); assert_eq(after[8], 1);
    assert_eq(after[9], before[9] + 3600, "Late removal must not add a collateral penalty");
}

#[test]
unconstrained fn c05_flag_before_deadline_screens_at_deadline_once() {
    let (mut env, board, owner, censor, chain, id) = published();
    let version = env.view_public(Billboard::at(board).get_post_policy_version(id));
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    env.mine_block_at(deadline - 1);
    env.call_public(censor, Billboard::at(board).declare_immoral(id, version, reason_with(2), 4));
    env.mine_block_at(deadline);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[7], 1); assert_eq(after[8], 1);
    assert_eq(after[9], before[9] + 4 * 3600);
    env.mine_block_at(after[9] as u64);
    let (dummy, none) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, dummy, none));
    let final_note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(final_note[9], after[9] + 3600, "Already-screened flag must not be charged twice");
}

unconstrained fn screened_flag() -> (TestEnvironment, AztecAddress, AztecAddress, Field, u64) {
    let (mut env, board, owner, censor, chain, id) = published();
    let version = env.view_public(Billboard::at(board).get_post_policy_version(id));
    env.call_public(censor, Billboard::at(board).declare_immoral(id, version, reason_with(2), 4));
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    env.mine_block_at(deadline);
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(note[7], 1); assert_eq(note[8], 1);
    assert((note[9] as u64) > env.last_block_timestamp());
    (env, board, owner, chain, note[9] as u64)
}

#[test(should_fail_with = "Too early to withdraw -- time lock not expired")]
unconstrained fn c05_newly_screened_flag_debt_blocks_withdraw_reset() {
    let (env, board, owner, chain, _eligible) = screened_flag();
    env.call_private(owner, Billboard::at(board).withdraw(chain));
}

#[test]
unconstrained fn c05_penalty_expiry_allows_exit_and_distinct_redeposit() {
    let (mut env, board, owner, old_chain, eligible) = screened_flag();
    env.mine_block_at(eligible);
    env.call_private(owner, Billboard::at(board).withdraw(old_chain));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, old_chain)), [0; 10]);
    let portal = EthAddress::from_field(0xaabbccdd);
    let depositor = EthAddress::from_field(0x12345678);
    let secret: Field = 0xc05002;
    let content = get_deposit_msg_hash(1, portal, board, 1, depositor, AMOUNT);
    let leaf = env.send_l1_to_l2_message(content, secret, portal, board);
    let new_chain = deposit_chain_id(board, owner, content, secret, leaf);
    assert(new_chain != old_chain);

    let claim_time = env.last_block_timestamp();
    env.call_private(owner, Billboard::at(board).claim_deposit(depositor, AMOUNT, secret, leaf));
    let note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, new_chain));
    assert_eq(note[5], 0); assert_eq(note[7], 0); assert_eq(note[8], 0);
    assert_eq(note[9], (claim_time + 3600) as Field);
}

#[test(should_fail_with = "Too early to withdraw -- time lock not expired")]
unconstrained fn c05_no_real_posts_still_owe_initial_cooldown() {
    let (env, board, owner, _censor, _time) = setup_with_deposit(AMOUNT);
    env.call_private(owner, Billboard::at(board).withdraw(test_chain(env, board, owner, AMOUNT)));
}

#[test]
fn c05_generated_economic_boundaries_match_independent_integer_model() {
    for cooldown in [1, 2, 3600, 0xffffffff] {
        for cap in [1, 2, 16, 0xffff] {
            for multiplier in [1, 4, 0xffff] {
                for flags in 0..3 {
                    let now: u64 = 1_000_000_000_000_000;
                    let debt: u64 = now - 3;
                    let saved = cooldown * (cap - 1);
                    let floor = now - saved;
                    let start = if debt > floor { debt } else { floor };
                    let expected = start as u128 + cooldown as u128 + (cooldown as u128) * ((multiplier - 1) as u128) * flags as u128;
                    assert_eq(compute_next_allowed(now, debt, cooldown, multiplier, cap, flags as u64), expected as u64);
                }
            }
        }
    }
    for amount in [1, 2, 3, 17, 0xffffffffffffffffffffffff] {
        let result = compute_cooldown(amount, 0xffffffff, 1);
        let numerator: u128 = 0xffffffff;
        assert((result as u128) * amount >= numerator);
        assert(((result - 1) as u128) * amount < numerator);
    }
}

#[test]
fn c05_saved_cap_allows_exactly_m_immediate_posts() {
    for cap in [1, 2, 16] {
        let now: u64 = 1_000_000;
        let mut debt: u64 = 0;
        for _i in 0..cap {
            assert(debt <= now);
            debt = compute_next_allowed(now, debt, 3600, 4, cap, 0);
        }
        assert_eq(debt, now + 3600);
    }
}

#[test(should_fail_with = "Eligibility timestamp overflow")]
fn c05_new_penalty_cannot_cross_executable_horizon() { let _ = compute_next_allowed(0x7fffffffffffffff, 0x7fffffffffffffff, 1, 1, 1, 0); }
#[test(should_fail_with = "Invalid flag count")]
fn c05_more_than_two_screened_flags_rejected() { let _ = compute_next_allowed(100, 1, 1, 1, 1, 3); }
#[test(should_fail_with = "Invalid save-up cap")]
fn c05_zero_save_cap_rejected() { let _ = compute_next_allowed(100, 1, 1, 1, 0, 0); }
#[test]
fn c05_exact_executable_horizon_is_finite() { assert_eq(checked_time_add(0x7ffffffffffffffe, 1), 0x7fffffffffffffff); }
#[test]
fn c05_policy_hash_matches_independent_python_vector() {
    let (policy, length) = crate::policy_with_byte(65);
    assert_eq(policy_version(AztecAddress::from_field(123), policy, length), 0x4698a04227687d6b34d294ac58b98eccac61d2c237e1300c72bd6edf045deb);
}

#[test]
unconstrained fn c05_delayed_public_inclusion_gets_full_moderation_window() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    let anchor = time + 3601;
    env.mine_block_at(anchor);
    // Official TXE control leaves the existing private anchor unchanged while
    // advancing the timestamp used by the transaction's queued public call.
    let included = anchor + 7200;
    env.set_next_block_timestamp(included);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none()));
    let id = env.view_public(Billboard::at(board).get_post_id(0));
    assert_eq(env.view_public(Billboard::at(board).get_post_time(id)), included);
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    assert_eq(deadline, included + 3600);
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert_eq(child.unwrap_unchecked().note.anchor_timestamp, anchor);
    assert(child.unwrap_unchecked().note.anchor_timestamp + 3600 < included);
    env.mine_block_at(included + 1);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(2), 4, false, child, gc));
    let young = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(young[7], 0, "Private anchor age must not shorten the public flag window");
    env.mine_block_at(deadline);
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let screened = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(screened[7], 1, "Only first public inclusion deadline has elapsed");
}

#[test(should_fail_with = "Recovery horizon exceeded")]
unconstrained fn c05_real_post_near_horizon_rejects_new_recovery_obligation() {
    let (mut env, board, owner, _censor, _time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    // Enough time remains for the ordinary cooldown and public deadline, but
    // not the pinned protocol transaction-lifetime + worst-case recovery debt.
    env.mine_block_at(0x7fffffffffffffff - 100_000);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none()));
}

#[test]
unconstrained fn c05_near_horizon_does_not_block_existing_eligible_exit() {
    let (mut env, board, owner, _censor, _time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    env.mine_block_at(0x7fffffffffffffff - 100_000);
    // No new real publication obligation: dummy progression remains available.
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, Option::none(), Option::none()));
    let note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(note[8], 0);
    assert((note[9] as u64) <= env.last_block_timestamp());
    env.call_private(owner, Billboard::at(board).withdraw(chain));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain)), [0; 10]);
}

#[test]
fn c05_save_floor_saturates_without_erasing_existing_debt() {
    // Saved allowance is 300 seconds, exceeding timestamp 7. The floor must
    // saturate to zero, not wrap, while a live debt of 5 remains effective.
    assert_eq(compute_next_allowed(7, 0, 100, 4, 4, 0), 100);
    assert_eq(compute_next_allowed(7, 5, 100, 4, 4, 0), 105);
    assert_eq(compute_next_allowed(7, 5, 100, 4, 4, 2), 705);
    // At the exact transition and one second after it, preserve continuity.
    assert_eq(compute_next_allowed(300, 0, 100, 4, 4, 0), 100);
    assert_eq(compute_next_allowed(301, 0, 100, 4, 4, 0), 101);
}

// Canonical ASCII builder; production validation is the subject of the tests.
fn reason_ascii(length: u32) -> [Field; 7] {
    let mut result = [0; 7];
    for field in 0..7 {
        let mut packed: Field = 0;
        for byte in 0..31 {
            packed *= 256;
            if field * 31 + byte < length { packed += 65; }
        }
        result[field] = packed;
    }
    result
}

#[test]
fn c05_reason_accepts_exact_200_canonical_bytes_and_empty() {
    billboard_contract::lib::validate_reason(reason_ascii(200), 200);
    billboard_contract::lib::validate_reason([0; 7], 0);
}

#[test(should_fail_with = "Reason too long")]
fn c05_reason_rejects_201_canonical_bytes() {
    billboard_contract::lib::validate_reason(reason_ascii(201), 201);
}

#[test(should_fail_with = "Nonzero message padding")]
fn c05_reason_cannot_hide_201st_byte_by_declaring_200() {
    billboard_contract::lib::validate_reason(reason_ascii(201), 200);
}

#[test]
unconstrained fn c05_new_policy_removal_before_deadline_has_no_penalty() {
    let (mut env, board, owner, censor, chain, id) = published();
    let (policy, length) = crate::policy_with_byte(66);
    env.call_public(censor, Billboard::at(board).set_moderation_policy(policy, length));
    let current = env.view_public(Billboard::at(board).get_policy_version());
    env.call_public(censor, Billboard::at(board).declare_immoral(id, current, reason_with(2), 4));
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    env.mine_block_at(deadline);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[9], before[9] + 3600);
    assert(env.view_public(Billboard::at(board).is_post_flagged(id)));
}

#[test]
unconstrained fn c05_removal_after_withdrawal_does_not_recreate_deposit() {
    let (mut env, board, owner, censor, chain, id) = published();
    let deadline = env.view_public(Billboard::at(board).get_post_flag_deadline(id));
    env.mine_block_at(deadline);
    let (child, gc) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, child, gc));
    let note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    env.mine_block_at(note[9] as u64);
    env.call_private(owner, Billboard::at(board).withdraw(chain));
    let (policy, length) = crate::policy_with_byte(66);
    env.call_public(censor, Billboard::at(board).set_moderation_policy(policy, length));
    let current = env.view_public(Billboard::at(board).get_policy_version());
    env.call_public(censor, Billboard::at(board).declare_immoral(id, current, reason_with(2), 4));
    assert(env.view_public(Billboard::at(board).is_post_flagged(id)));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain)), [0; 10]);
}
