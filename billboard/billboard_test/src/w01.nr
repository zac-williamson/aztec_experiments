// W01 delegated-board authorization only: actual TXE/Schnorr authwit calls.
// These calls do not elect a fee payer or qualify a production sponsor.
use aztec::{authwit::auth::{compute_inner_authwit_hash, compute_authwit_nullifier}, hash::hash_args, context::PrivateCall, protocol::{address::{AztecAddress, EthAddress}, traits::{FromField, ToField}},
    test::helpers::{test_environment::{TestEnvironment, CallPrivateOptions}, authwit::add_private_authwit_from_call, txe_oracles}};
use billboard_contract::Billboard;
use billboard_contract::lib::{deposit_chain_id, get_deposit_msg_hash, get_withdraw_msg_hash, post_id};
use crate::{setup, msg_with, fresh_post_nonce};

global AMOUNT: u128 = 1_000_000_000_000_000;
global PORTAL: Field = 0xaabbccdd;
global DEPOSITOR: Field = 0x574f01;
global SECRET: Field = 0x574f02;

unconstrained fn scoped_call<let M: u32, let N: u32>(env: TestEnvironment, caller: AztecAddress, owner: AztecAddress, call: PrivateCall<M, N, ()>) {
    env.call_private_opts(caller, CallPrivateOptions::new().with_additional_scopes([owner]), call);
}
unconstrained fn bound() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let (mut env, board, deployer, _censor) = setup();
    let owner = env.create_contract_account(); // actual Schnorr verification, not a light account
    let caller = env.create_light_account();
    env.call_private(deployer, Billboard::at(board).update_portal(EthAddress::from_field(PORTAL)));
    (env, board, owner, caller)
}
unconstrained fn pending_claim(env: TestEnvironment, board: AztecAddress, owner: AztecAddress) -> (Field, Field) {
    let content = get_deposit_msg_hash(1, EthAddress::from_field(PORTAL), board, 1, EthAddress::from_field(DEPOSITOR), 1, AMOUNT);
    let leaf = env.send_l1_to_l2_message(content, SECRET, EthAddress::from_field(PORTAL), board);
    (leaf, deposit_chain_id(board, owner, content, SECRET))
}
unconstrained fn claimed() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, Field) {
    let (mut env, board, owner, caller) = bound();
    let (leaf, chain) = pending_claim(env, board, owner);
    env.call_private(owner, Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR), AMOUNT, 1, SECRET, leaf));
    let info = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    env.mine_block_at((info[10] as u64) + 1);
    (env, board, owner, caller, chain)
}

#[test]
unconstrained fn w01_delegated_post_updates_owner_only() {
    let (env, board, owner, caller, chain) = claimed();
    let nonce = fresh_post_nonce();
    let call = Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(1), 4, false, Option::none(), Option::none(), 101);
    add_private_authwit_from_call(env, owner, caller, call);
    scoped_call(env, caller, owner, call);
    let info = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(info[1], chain); assert_eq(info[6], 1); assert_eq(info[8], 0); assert_eq(info[9], 1);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(caller, chain)), [0;11]);
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 1);
    assert_eq(env.view_public(Billboard::at(board).get_post_id(0)), post_id(board, nonce));
    assert_eq(env.view_public(Billboard::at(board).get_post(post_id(board, nonce))), msg_with(1));
}

#[test]
unconstrained fn w01_second_explicitly_authorized_caller_succeeds_with_real_hints() {
    let (mut env, board, owner, first, chain) = claimed();
    let second = env.create_light_account(); assert(first != second);
    // A dummy gives the next delegated call nonempty, genuinely included hint metadata.
    let dummy = Billboard::at(board).delegated_post(owner, chain, 0, [0;32], 0, true, Option::none(), Option::none(), 102);
    add_private_authwit_from_call(env, owner, first, dummy); scoped_call(env, first, owner, dummy);
    let info = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    env.mine_block_at((info[10] as u64) + 1);
    let (child, grandchild) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child.is_some()); assert(grandchild.is_none());
    let nonce = fresh_post_nonce();
    let real = Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(2), 4, false, child, grandchild, 103);
    add_private_authwit_from_call(env, owner, second, real); scoped_call(env, second, owner, real);
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[6], 2); assert_eq(after[8], 1); assert_eq(after[9], 2);
    assert_eq(env.view_public(Billboard::at(board).get_post_id(0)), post_id(board, nonce));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(second, chain)), [0;11]);
}

#[test(should_fail_with="Unknown auth witness for message hash")]
unconstrained fn w01_post_rejects_wrong_caller() {
    let (mut env, board, owner, caller, chain) = claimed();
    let other = env.create_light_account();
    let call = Billboard::at(board).delegated_post(owner, chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none(), 104);
    add_private_authwit_from_call(env, owner, caller, call);
    scoped_call(env, other, owner, call);
}
#[test(should_fail_with="Unknown auth witness for message hash")]
unconstrained fn w01_post_rejects_changed_message() {
    let (env, board, owner, caller, chain) = claimed(); let nonce = fresh_post_nonce();
    add_private_authwit_from_call(env, owner, caller, Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(1), 4, false, Option::none(), Option::none(), 105));
    scoped_call(env, caller, owner, Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(2), 4, false, Option::none(), Option::none(), 105));
}
#[test(should_fail_with="Unknown auth witness for message hash")]
unconstrained fn w01_post_rejects_changed_authorization_nonce() {
    let (env, board, owner, caller, chain) = claimed(); let nonce = fresh_post_nonce();
    add_private_authwit_from_call(env, owner, caller, Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(1), 4, false, Option::none(), Option::none(), 106));
    scoped_call(env, caller, owner, Billboard::at(board).delegated_post(owner, chain, nonce, msg_with(1), 4, false, Option::none(), Option::none(), 107));
}
#[test(should_fail_with="Unknown auth witness for message hash")]
unconstrained fn w01_post_rejects_missing_authorization() {
    let (env, board, owner, caller, chain) = claimed();
    scoped_call(env, caller, owner, Billboard::at(board).delegated_post(owner, chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none(), 108));
}
#[test(should_fail_with="NullifierLeafValue is not updateable and")]
unconstrained fn w01_actual_delegated_authwit_nullifier_cannot_be_reinserted() {
    let (env, board, owner, caller, chain) = claimed();
    let call = Billboard::at(board).delegated_post(owner, chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none(), 109);
    let inner_hash = compute_inner_authwit_hash([caller.to_field(), call.selector.to_field(), hash_args(call.args)]);
    let raw_nullifier = compute_authwit_nullifier(owner, inner_hash);
    let expected = aztec::protocol::hash::compute_siloed_nullifier(board, raw_nullifier);
    add_private_authwit_from_call(env, owner, caller, call); scoped_call(env, caller, owner, call);
    let effects = txe_oracles::get_last_tx_effects();
    let mut found = false;
    for i in 0..effects.nullifiers.len() { if effects.nullifiers.get(i) == expected { found = true; } }
    assert(found, "Actual board call omitted exact authwit nullifier");
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 1);
    // Deliberate low-level duplicate-insertion control using the exact authwit nullifier
    // emitted by the actual board call. This is not a second whole-board transaction:
    // stale hints/cooldown would otherwise mask its replay-nullifier rejection.
    env.private_context_at(board, |context| { context.push_nullifier_unsafe(raw_nullifier); });
}
#[test(should_fail_with="Delegated owner must differ from caller")]
unconstrained fn w01_self_caller_zero_nonce_cannot_use_macro_shortcut() {
    let (env, board, owner, _caller, chain) = claimed();
    scoped_call(env, owner, owner, Billboard::at(board).delegated_post(owner, chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none(), 0));
}
#[test(should_fail_with="Delegated auth nonce must not be zero")]
unconstrained fn w01_authorized_delegator_still_rejects_zero_nonce() {
    let (env, board, owner, caller, chain) = claimed();
    let call = Billboard::at(board).delegated_post(owner, chain, fresh_post_nonce(), msg_with(1), 4, false, Option::none(), Option::none(), 0);
    add_private_authwit_from_call(env, owner, caller, call); scoped_call(env, caller, owner, call);
}

#[test]
unconstrained fn w01_delegated_claim_and_no_post_exit_preserve_owner_and_receipt() {
    let (mut env, board, owner, caller) = bound(); let (leaf, chain) = pending_claim(env, board, owner);
    let claim = Billboard::at(board).delegated_claim_deposit(owner, EthAddress::from_field(DEPOSITOR), AMOUNT, 1, SECRET, leaf, 110);
    add_private_authwit_from_call(env, owner, caller, claim); scoped_call(env, caller, owner, claim);
    let info = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(info[0], 1); assert_eq(info[1], chain); assert_eq(info[2], 1); assert_eq(info[3], AMOUNT as Field); assert_eq(info[4], DEPOSITOR);
    assert_eq(info[6], 0); assert_eq(info[8], 0); assert_eq(info[9], 0);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(caller, chain)), [0;11]);
    let expected_exit = get_withdraw_msg_hash(1, EthAddress::from_field(PORTAL), board, 1, EthAddress::from_field(DEPOSITOR), 1, AMOUNT);
    assert_eq(get_withdraw_msg_hash(1, EthAddress::from_field(PORTAL), board, 1, EthAddress::from_field(info[4]), info[2] as u64, info[3] as u128), expected_exit);
    env.mine_block_at((info[10] as u64) + 1);
    let exit = Billboard::at(board).delegated_withdraw(owner, chain, 111);
    add_private_authwit_from_call(env, owner, caller, exit); scoped_call(env, caller, owner, exit);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain)), [0;11]);
    // TXE TxEffects does not expose L2-to-L1 leaves: actual exit leaf/refund must be checked in the genuine application harness.
}
#[test(should_fail_with="Unknown auth witness for message hash")]
unconstrained fn w01_claim_rejects_changed_owner() {
    let (mut env, board, owner, caller) = bound(); let other = env.create_contract_account();
    let (leaf, _chain) = pending_claim(env, board, owner);
    add_private_authwit_from_call(env, owner, caller, Billboard::at(board).delegated_claim_deposit(owner, EthAddress::from_field(DEPOSITOR), AMOUNT, 1, SECRET, leaf, 112));
    scoped_call(env, caller, other, Billboard::at(board).delegated_claim_deposit(other, EthAddress::from_field(DEPOSITOR), AMOUNT, 1, SECRET, leaf, 112));
}
#[test(should_fail_with="No deposit note found")]
unconstrained fn w01_authorized_withdraw_cannot_select_another_owner_note() {
    let (mut env, board, owner, caller, chain) = claimed();
    let other = env.create_contract_account();
    let info = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain)); assert_eq(info[1], chain);
    let exit = Billboard::at(board).delegated_withdraw(other, chain, 113);
    add_private_authwit_from_call(env, other, caller, exit);
    // Give both scopes: failure must be ownership, not hiding the existing note from the oracle.
    env.call_private_opts(caller, CallPrivateOptions::new().with_additional_scopes([owner, other]), exit);
}
