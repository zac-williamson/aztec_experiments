// Actual pinned TXE contract calls. Ten-author order test is sequential,
// not same-anchor proof preparation; the separate PXE lane must qualify C03-A01.
use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::FromField;
use billboard_contract::Billboard;
use billboard_contract::lib::{get_deposit_msg_hash, deposit_chain_id, post_id};
use crate::{setup, setup_with_deposit, test_chain, msg_with, fresh_post_nonce};

global MINIMUM: u128 = 1_000_000_000_000_000;
global PORTAL: Field = 0xaabbccdd;

#[test]
unconstrained fn c03_ten_distinct_claimed_authors_get_unique_ids_and_live_order_sequentially() {
    let (mut env, board, deployer, censor) = setup();
    let portal = EthAddress::from_field(PORTAL);
    env.call_private(deployer, Billboard::at(board).update_portal(portal));
    let mut authors = [AztecAddress::zero(); 10];
    let mut chains: [Field; 10] = [0; 10];
    let mut ids: [Field; 10] = [0; 10];
    let mut eligible: u64 = 0;
    for i in 0..10 {
        let owner = env.create_light_account();
        let depositor = EthAddress::from_field(0xc03000 + i as Field);
        let secret = fresh_post_nonce();
        let content = get_deposit_msg_hash(1, portal, board, 1, depositor, 1, MINIMUM);
        let chain = deposit_chain_id(board, owner, content, secret);
        let leaf = env.send_l1_to_l2_message(content, secret, portal, board);
        env.call_private(owner, Billboard::at(board).claim_deposit(depositor, MINIMUM, 1, secret, leaf));
        let note = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
        assert_eq(note[1], chain); assert_eq(note[3], MINIMUM as Field);
        if (note[10] as u64) > eligible { eligible = note[10] as u64; }
        authors[i] = owner; chains[i] = chain;
    }
    env.mine_block_at(eligible + 1);
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 0);
    for i in 0..10 {
        let nonce = fresh_post_nonce();
        let id = post_id(board, nonce); assert(id != 0);
        for j in 0..10 { if j < i { assert(ids[j] != id); assert(authors[j] != authors[i]); } }
        ids[i] = id;
        let text = msg_with((i + 1) as Field);
        env.call_private(authors[i], Billboard::at(board).post(chains[i], nonce, text, 4, false, Option::none(), Option::none()));
        assert_eq(env.view_public(Billboard::at(board).get_post_count()), (i + 1) as u64);
        assert_eq(env.view_public(Billboard::at(board).get_post_id(i as u64)), id);
        assert(env.view_public(Billboard::at(board).get_post_exists(id)));
        assert_eq(env.view_public(Billboard::at(board).get_post(id)), text);
        assert_eq(env.view_public(Billboard::at(board).get_post_length(id)), 4);
        assert_eq(env.view_public(Billboard::at(board).get_post_time(id)), env.last_block_timestamp());
        let info = env.execute_utility(Billboard::at(board).get_deposit_info(authors[i], chains[i]));
        assert_eq(info[6], 1); assert_eq(info[8], 0);
    }
    env.call_public(censor, Billboard::at(board).declare_immoral(ids[6], msg_with(0xc03)));
    for i in 0..10 {
        assert_eq(env.view_public(Billboard::at(board).is_post_flagged(ids[i])), i == 6);
        assert_eq(env.view_public(Billboard::at(board).get_post_id(i as u64)), ids[i]);
    }
    assert_eq(env.view_public(Billboard::at(board).get_post_flagged_by(ids[6])), censor);
    assert_eq(env.view_public(Billboard::at(board).get_censor_response(ids[6])), msg_with(0xc03));
}

#[test]
unconstrained fn c03_dummy_is_private_and_first_real_post_still_gets_order_zero() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(MINIMUM);
    let chain = test_chain(board, owner, MINIMUM);
    env.mine_block_at(time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, Option::none(), Option::none()));
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 0);
    assert(!env.view_public(Billboard::at(board).get_post_exists(0)));
    let (child, grandchild) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child.is_some()); assert(grandchild.is_none());
    assert(child.unwrap_unchecked().note.is_dummy);
    assert_eq(child.unwrap_unchecked().note.post_id, 0);
    let state = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(state[6], 1); assert_eq(state[9], 0);
    env.mine_block_at((state[10] as u64) + 1);
    let nonce = fresh_post_nonce();
    env.call_private(owner, Billboard::at(board).post(chain, nonce, msg_with(2), 4, false, child, grandchild));
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 1);
    assert_eq(env.view_public(Billboard::at(board).get_post_id(0)), post_id(board, nonce));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[6], 2); assert_eq(after[8], 1); assert_eq(after[9], 2);
}

#[test(should_fail_with = "Post nonce must not be zero")]
unconstrained fn c03_real_post_rejects_zero_nonce() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(MINIMUM);
    let chain = test_chain(board, owner, MINIMUM); env.mine_block_at(time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, 0, msg_with(1), 4, false, Option::none(), Option::none()));
}

#[test(should_fail_with = "Post id already exists")]
unconstrained fn c03_reused_nonce_rejects_duplicate_public_id() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(MINIMUM);
    let chain = test_chain(board, owner, MINIMUM); env.mine_block_at(time + 3601);
    let nonce = fresh_post_nonce();
    env.call_private(owner, Billboard::at(board).post(chain, nonce, msg_with(1), 4, false, Option::none(), Option::none()));
    assert_eq(env.view_public(Billboard::at(board).get_post_id(0)), post_id(board, nonce));
    let (child, grandchild) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    env.mine_block_at(time + 7202);
    // A fresh private request spends the current replacement right. Failure must
    // come from duplicate publication identity, not replaying the old note.
    env.call_private(owner, Billboard::at(board).post(chain, nonce, msg_with(2), 4, false, child, grandchild));
}

#[test(should_fail_with = "Function _publish_post can only be called by the same contract")]
unconstrained fn c03_public_publication_rejects_nonself_caller() {
    let (env, board, deployer, _censor) = setup(); assert(deployer != board);
    env.call_public(deployer, Billboard::at(board)._publish_post(post_id(board, fresh_post_nonce()), msg_with(1), 4));
}

#[test(should_fail_with = "Post id must not be zero")]
unconstrained fn c03_public_publication_rejects_zero_id() {
    let (env, board, _deployer, _censor) = setup();
    // Controlled TXE caller only to isolate the actual public boundary guard.
    env.call_public(board, Billboard::at(board)._publish_post(0, msg_with(1), 4));
}

#[test(should_fail_with = "Nonzero message padding")]
unconstrained fn c03_real_post_rejects_hidden_message_suffix() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(MINIMUM);
    let chain = test_chain(board, owner, MINIMUM); env.mine_block_at(time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(1), 3, false, Option::none(), Option::none()));
}

#[test(should_fail_with = "Dummy message must be empty")]
unconstrained fn c03_dummy_rejects_hidden_content() {
    let (mut env, board, owner, _censor, time) = setup_with_deposit(MINIMUM);
    let chain = test_chain(board, owner, MINIMUM); env.mine_block_at(time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, 0, msg_with(1), 0, true, Option::none(), Option::none()));
}
