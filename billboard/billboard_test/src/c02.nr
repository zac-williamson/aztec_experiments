// C02 draft: actual TXE note-tree inclusion, never a mocked membership boolean.
use aztec::history::note::assert_note_existed_by;
use aztec::note::{HintedNote, lifecycle::create_note, note_getter_options::NoteStatus};
use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::{FromField, ToField};
use aztec::test::helpers::test_environment::{TestEnvironment, PrivateContextOptions};
use billboard_contract::Billboard;
use billboard_contract::Billboard::PostNote;
use billboard_contract::lib::{get_deposit_msg_hash, deposit_chain_id};
use crate::{setup_with_deposit, test_chain};

global AMOUNT: u128 = 1_000_000_000_000_000;

fn content() -> [Field; 32] { crate::msg_with(65) }

unconstrained fn included(env: TestEnvironment, board: AztecAddress, hint: HintedNote<PostNote>) {
    env.private_context_opts(PrivateContextOptions::new().at_contract_address(board), |context| {
        let confirmed = assert_note_existed_by(context.get_anchor_block_header(), hint);
        assert_eq(confirmed.note, hint.note);
        assert_eq(confirmed.owner, hint.owner);
        assert_eq(confirmed.contract_address, hint.contract_address);
        assert_eq(confirmed.storage_slot, hint.storage_slot);
    });
}

// Creates real note-tree effects in a TEST context, then discovers the actual
// settled metadata. This is artificial issuance, not a production mint path.
// Lookup by fresh randomness avoids accidentally selecting the legitimate note
// when the injected note has identical content and shares its owner/slot.
unconstrained fn insert_fixture(
    env: TestEnvironment, note_contract: AztecAddress, owner: AztecAddress,
    slot: Field, note: PostNote,
) -> HintedNote<PostNote> {
    let message = env.private_context_opts(
        PrivateContextOptions::new().at_contract_address(note_contract),
        |context| create_note(context, owner, slot, note),
    );
    let randomness = message.get_new_note().randomness;
    env.discover_note_at(note_contract, message);
    let candidates = env.utility_context_at(note_contract, |_| {
        aztec::oracle::notes::get_notes::<PostNote, 0, 10>(
            Option::some(owner), slot, 0, [], [], [], [], [], [], [], [], [], 10, 0, NoteStatus.ACTIVE,
        )
    });
    let mut result = Option::none();
    let mut matches: u32 = 0;
    for candidate in candidates {
        if candidate.is_some() {
            let value = candidate.unwrap_unchecked();
            if value.randomness == randomness {
                matches += 1;
                result = Option::some(value);
            }
        }
    }
    assert_eq(matches, 1, "Fixture must select exactly its inserted note");
    let hint = result.unwrap_unchecked();
    assert_eq(hint.note, note);
    assert_eq(hint.owner, owner);
    assert_eq(hint.contract_address, note_contract);
    assert_eq(hint.storage_slot, slot);
    hint
}

unconstrained fn one_post() -> (TestEnvironment, AztecAddress, AztecAddress, Field, u64, HintedNote<PostNote>) {
    let (mut env, board, owner, _censor, deposit_time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    env.mine_block_at(deposit_time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::none(), Option::none()));
    let (child, grandchild) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child.is_some());
    assert(grandchild.is_none());
    let hint = child.unwrap_unchecked();
    assert_eq(hint.note.sequence, 1);
    assert_eq(hint.note.deposit_chain_id, chain);
    (env, board, owner, chain, deposit_time, hint)
}

// kind 0/1/2 changes only inclusion origin; 3/4/5 changes one typed field;
// kind 6 creates identical content with new randomness, hence a different head.
unconstrained fn substituted_child(kind: u8) {
    let (mut env, board, owner, chain, deposit_time, original) = one_post();
    let other_owner = env.create_light_account();
    let note_contract = if kind == 0 {
        env.deploy("@billboard_contract/Billboard").without_initializer()
    } else { board };
    let note_owner = if kind == 1 { other_owner } else { owner };
    let slot = if kind == 2 { original.storage_slot + 1000 } else { original.storage_slot };
    let mut note = original.note;
    if kind == 3 { note.schema_version = 2; }
    if kind == 4 { note.deposit_chain_id = chain + 1; }
    if kind == 5 { note.sequence = 2; }
    let replacement = insert_fixture(env, note_contract, note_owner, slot, note);
    // This must succeed before the expected application authorization failure.
    included(env, board, replacement);
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(replacement), Option::none()));
}

#[test]
unconstrained fn c02_matching_included_child_advances_exactly_one() {
    let (mut env, board, owner, chain, deposit_time, original) = one_post();
    included(env, board, original);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(before[5], 1);
    assert_eq(before[7], 0);
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(original), Option::none()));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[1], chain);
    assert_eq(after[5], 2);
    assert_eq(after[7], 1);
    assert_eq(after[6], before[4]);
}

#[test(should_fail_with = "C02 wrong contract")]
unconstrained fn c02_included_foreign_contract_rejected() { substituted_child(0); }
#[test(should_fail_with = "C02 wrong owner")]
unconstrained fn c02_included_wrong_owner_rejected() { substituted_child(1); }
#[test(should_fail_with = "C02 wrong slot")]
unconstrained fn c02_included_wrong_slot_rejected() { substituted_child(2); }
#[test(should_fail_with = "C02 wrong schema")]
unconstrained fn c02_included_wrong_schema_rejected() { substituted_child(3); }
#[test(should_fail_with = "C02 wrong chain")]
unconstrained fn c02_included_other_chain_rejected() { substituted_child(4); }
#[test(should_fail_with = "C02 child sequence")]
unconstrained fn c02_included_sequence_gap_rejected() { substituted_child(5); }
#[test(should_fail_with = "C02 child head")]
unconstrained fn c02_included_same_content_different_head_rejected() { substituted_child(6); }

#[test(should_fail_with = "C02 unexpected grandchild")]
unconstrained fn c02_head_cannot_have_duplicate_grandchild() {
    let (mut env, board, owner, chain, deposit_time, original) = one_post();
    included(env, board, original);
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(original), Option::some(original)));
}

#[test(should_fail_with = "C02 unexpected hints")]
unconstrained fn c02_no_history_rejects_included_unused_hint() {
    let (mut env, board, owner, _censor, deposit_time) = setup_with_deposit(AMOUNT);
    let chain = test_chain(env, board, owner, AMOUNT);
    let hint = insert_fixture(env, board, owner, 1000, PostNote {
        schema_version: 1, deposit_chain_id: chain, sequence: 1, post_id: 0,
        anchor_timestamp: deposit_time, previous_link: 0, is_dummy: true,
    });
    included(env, board, hint);
    env.mine_block_at(deposit_time + 3601);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(hint), Option::none()));
}

// A 2x deposit gives 1800s cooldown against the configured 3600s censor
// window. Real child1 remains young by one second at the third eligibility
// boundary; optional dummy head2 is already mature through actual inclusion.
unconstrained fn young_pair(wrong_owner: bool, dummy_grandchild: bool) {
    let amount = AMOUNT * 2;
    let (mut env, board, owner, _censor, deposit_time) = setup_with_deposit(amount);
    let chain = test_chain(env, board, owner, amount);
    env.mine_block_at(deposit_time + 1801);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::none(), Option::none()));
    let (first, none) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(first.is_some()); assert(none.is_none());
    env.mine_block_at(deposit_time + 3600);
    let second_content = if dummy_grandchild { [0; 32] } else { content() };
    env.call_private(owner, Billboard::at(board).post(chain, if dummy_grandchild { 0 } else { crate::fresh_post_nonce() }, second_content, if dummy_grandchild { 0 } else { 4 }, dummy_grandchild, first, Option::none()));
    let (child_opt, second_opt) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child_opt.is_some()); assert(second_opt.is_some());
    let child = child_opt.unwrap_unchecked();
    let original_second = second_opt.unwrap_unchecked();
    assert_eq(child.note.sequence, 1); assert_eq(original_second.note.sequence, 2);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(before[5], 2); assert_eq(before[7], 0);
    let second = if wrong_owner {
        let other_owner = env.create_light_account();
        insert_fixture(env, board, other_owner, original_second.storage_slot, original_second.note)
    } else { original_second };
    included(env, board, child);
    included(env, board, second);
    env.mine_block_at(deposit_time + 5400);
    let now = env.last_block_timestamp();
    assert(!child.note.is_dummy);
    assert_eq(child.note.anchor_timestamp + 3600, now + 1, "Real child must remain young by one second");
    assert_eq(second.note.is_dummy, dummy_grandchild);
    assert(second.note.anchor_timestamp <= now, "Grandchild must already be included by this anchor");
    assert(second.note.anchor_timestamp + 3600 > now, "Real grandchild maturity must not explain this control");
    if dummy_grandchild {
        assert(second.note.is_dummy, "Dummy grandchild is mature despite its recent timestamp");
        assert_eq(before[8], 1, "Only the first post is real before this transition");
    }
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(child), Option::some(second)));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[5], 3);
    assert_eq(after[7], 0, "A young child must not advance either candidate");
    assert_eq(after[6], before[6]);
}

#[test]
unconstrained fn c02_valid_young_pair_remains_unscreened() { young_pair(false, false); }
#[test(should_fail_with = "C02 wrong owner")]
unconstrained fn c02_young_child_does_not_hide_wrong_owner_second_hint() { young_pair(true, false); }

#[test]
unconstrained fn c02_young_real_child_blocks_mature_dummy_grandchild() { young_pair(false, true); }

// A dummy has no public identity/order slot. It still advances through actual
// private inclusion without a real-post censor delay or flag penalty.
#[test]
unconstrained fn c02_included_young_dummy_advances_without_publication_or_penalty() {
    let amount = AMOUNT * 2;
    let (mut env, board, owner, censor, deposit_time) = setup_with_deposit(amount);
    let chain = test_chain(env, board, owner, amount);
    env.mine_block_at(deposit_time + 1801);
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, Option::none(), Option::none()));
    let (child_opt, second) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child_opt.is_some()); assert(second.is_none());
    let child = child_opt.unwrap_unchecked();
    assert(child.note.is_dummy);
    assert_eq(child.note.post_id, 0);
    included(env, board, child);
    assert(!env.view_public(Billboard::at(board).get_post_exists(0)));
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 0);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(before[5], 1); assert_eq(before[7], 0); assert_eq(before[8], 0);
    assert_eq(before[9], (deposit_time + 3600) as Field);
    env.mine_block_at(deposit_time + 3600);
    assert(child.note.anchor_timestamp + 3600 > env.last_block_timestamp());
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(child), Option::none()));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[5], 2);
    assert_eq(after[7], 1, "Included dummy must advance without a censor wait");
    assert_eq(after[6], before[4]);
    assert_eq(after[8], 2);
    assert_eq(after[9], (deposit_time + 5400) as Field, "Dummy flag must not add a penalty");
}

// Second tranche: TXE-authenticated receipts/consumption, never direct deposit
// state insertion. No L1 refund is simulated by this helper.
unconstrained fn claim_receipt(
    env: TestEnvironment, board: AztecAddress, owner: AztecAddress,
    depositor: EthAddress, secret: Field,
) -> Field {
    let portal = EthAddress::from_field(0xaabbccdd);
    let claim_content = get_deposit_msg_hash(1, portal, board, 1, depositor, AMOUNT);
    let leaf = env.send_l1_to_l2_message(claim_content, secret, portal, board);
    let chain = deposit_chain_id(board, owner, claim_content, secret, leaf);
    env.call_private(owner, Billboard::at(board).claim_deposit(depositor, AMOUNT, secret, leaf));
    let actual = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(actual[1], chain);
    assert_eq(actual[2], AMOUNT as Field); assert_eq(actual[3], depositor.to_field());
    assert_eq(actual[5], 0); assert_eq(actual[7], 0);
    chain
}

unconstrained fn two_receipts(substitution: u8) {
    let (mut env, board, owner, first_chain, _deposit_time, first_hint) = one_post();
    let first_before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, first_chain));
    // Different L1 depositor: both receipts may legitimately be active, while
    // the same private author owns their independently claimed rights.
    let second_chain = claim_receipt(env, board, owner, EthAddress::from_field(0x87654321), 0xc021);
    assert(first_chain != second_chain);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, first_chain)), first_before);
    let second_initial = env.execute_utility(Billboard::at(board).get_deposit_info(owner, second_chain));
    env.mine_block_at((second_initial[9] as u64) + 1);
    env.call_private(owner, Billboard::at(board).post(second_chain, crate::fresh_post_nonce(), content(), 4, false, Option::none(), Option::none()));
    let (second_opt, absent) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, second_chain));
    assert(second_opt.is_some()); assert(absent.is_none());
    let second_hint = second_opt.unwrap_unchecked();
    included(env, board, first_hint); included(env, board, second_hint);
    assert_eq(first_hint.owner, second_hint.owner);
    assert(first_hint.note.deposit_chain_id != second_hint.note.deposit_chain_id);
    if substitution == 1 {
        env.call_private(owner, Billboard::at(board).post(first_chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(second_hint), Option::none()));
    } else if substitution == 2 {
        let ready = env.execute_utility(Billboard::at(board).get_deposit_info(owner, second_chain));
        env.mine_block_at((ready[9] as u64) + 2);
        env.call_private(owner, Billboard::at(board).post(second_chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(first_hint), Option::none()));
    } else {
        let second_before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, second_chain));
        env.call_private(owner, Billboard::at(board).post(first_chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(first_hint), Option::none()));
        let first_after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, first_chain));
        assert_eq(first_after[5], 2); assert_eq(first_after[7], 1);
        assert_eq(first_after[6], first_before[4]);
        assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, second_chain)), second_before);
        env.mine_block_at((second_before[9] as u64) + 2);
        env.call_private(owner, Billboard::at(board).post(second_chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(second_hint), Option::none()));
        let second_after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, second_chain));
        assert_eq(second_after[5], 2); assert_eq(second_after[7], 1);
        assert_eq(second_after[6], second_before[4]);
        assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, first_chain)), first_after);
    }
}

#[test]
unconstrained fn c02_two_authentic_receipts_screen_only_their_own_history() { two_receipts(0); }
#[test(should_fail_with = "C02 wrong chain")]
unconstrained fn c02_first_receipt_rejects_second_receipt_history() { two_receipts(1); }
#[test(should_fail_with = "C02 wrong chain")]
unconstrained fn c02_second_receipt_rejects_first_receipt_history() { two_receipts(2); }

unconstrained fn old_cycle(use_old_hint: bool) {
    let (mut env, board, owner, old_chain, deposit_time, old_hint) = one_post();
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(old_chain, 0, [0; 32], 0, true, Option::some(old_hint), Option::none()));
    let screened = env.execute_utility(Billboard::at(board).get_deposit_info(owner, old_chain));
    assert_eq(screened[5], 2); assert_eq(screened[7], 1); assert_eq(screened[8], 1);
    env.mine_block_at((screened[9] as u64) + 1);
    env.call_private(owner, Billboard::at(board).withdraw(old_chain));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, old_chain)), [0; 10]);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_ids(owner, 0)), [0;10]);
    // Historical PostNotes remain included after the actual right is burned.
    included(env, board, old_hint);
    // TXE's authentic new message represents a new deposit; the real L1 refund/redeposit
    // that authorizes that receipt is outside this bounded Noir fixture.
    let new_chain = claim_receipt(env, board, owner, EthAddress::from_field(0x12345678), 0xc022);
    assert(new_chain != old_chain);
    let initial = env.execute_utility(Billboard::at(board).get_deposit_info(owner, new_chain));
    env.mine_block_at((initial[9] as u64) + 1);
    env.call_private(owner, Billboard::at(board).post(new_chain, crate::fresh_post_nonce(), content(), 4, false, Option::none(), Option::none()));
    let (new_opt, absent) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, new_chain));
    assert(new_opt.is_some()); assert(absent.is_none());
    let new_hint = new_opt.unwrap_unchecked();
    included(env, board, new_hint); included(env, board, old_hint);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner, new_chain));
    env.mine_block_at((before[9] as u64) + 2);
    let candidate = if use_old_hint { old_hint } else { new_hint };
    env.call_private(owner, Billboard::at(board).post(new_chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(candidate), Option::none()));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, new_chain));
    assert_eq(after[5], 2); assert_eq(after[7], 1);
    assert_eq(after[6], before[4]);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, old_chain)), [0; 10]);
}

#[test]
unconstrained fn c02_new_cycle_screens_new_history_after_old_right_burn() { old_cycle(false); }
#[test(should_fail_with = "C02 wrong chain")]
unconstrained fn c02_withdrawn_cycle_included_history_cannot_screen_new_receipt() { old_cycle(true); }

#[test(should_fail_with = "C02 future timestamp")]
unconstrained fn c02_included_future_child_timestamp_rejected() {
    let (mut env, board, owner, chain, deposit_time, original) = one_post();
    let mut note = original.note;
    note.anchor_timestamp = env.last_block_timestamp() + 1_000_000;
    let future = insert_fixture(env, board, owner, original.storage_slot, note);
    included(env, board, future);
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(future), Option::none()));
}

unconstrained fn malformed_grandchild(reverse_time: bool) {
    let amount = AMOUNT * 2;
    let (mut env, board, owner, _censor, deposit_time) = setup_with_deposit(amount);
    let chain = test_chain(env, board, owner, amount);
    env.mine_block_at(deposit_time + 1801);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::none(), Option::none()));
    let (first, absent) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(first.is_some()); assert(absent.is_none());
    env.mine_block_at(deposit_time + 3600);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, first, Option::none()));
    let (child_opt, second_opt) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child_opt.is_some()); assert(second_opt.is_some());
    let child = child_opt.unwrap_unchecked();
    let original_second = second_opt.unwrap_unchecked();
    let mut note = original_second.note;
    if reverse_time { note.anchor_timestamp = child.note.anchor_timestamp - 1; }
    else { note.sequence = 3; }
    let replacement = insert_fixture(env, board, owner, original_second.storage_slot, note);
    included(env, board, child); included(env, board, replacement);
    env.mine_block_at(deposit_time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(child), Option::some(replacement)));
}

#[test(should_fail_with = "C02 reversed timestamps")]
unconstrained fn c02_included_grandchild_cannot_precede_child_time() { malformed_grandchild(true); }
#[test(should_fail_with = "C02 grandchild sequence")]
unconstrained fn c02_included_grandchild_sequence_gap_rejected() { malformed_grandchild(false); }

// C04 utility ambiguity is detected before a caller tries to prove a post.
// Both candidates have real TXE note-tree membership; their issuance here is
// artificial, exercising a corrupt/hostile wallet-history condition.
#[test(should_fail_with = "BB_HISTORY_CHILD_AMBIGUOUS")]
unconstrained fn c04_duplicate_successor_has_explicit_recoverable_error() {
    let (env, board, owner, chain, _time, original) = one_post();
    let duplicate = insert_fixture(env, board, owner, original.storage_slot, original.note);
    assert(duplicate.randomness != original.randomness);
    included(env, board, duplicate);
    let _ = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
}

#[test(should_fail_with = "BB_HISTORY_DEPOSIT_MISSING")]
unconstrained fn c04_unknown_deposit_has_explicit_recoverable_error() {
    let (env, board, owner, _censor, _time) = setup_with_deposit(AMOUNT);
    let _ = env.execute_utility(Billboard::at(board).get_screen_hints(owner, 0xc04bad));
}

// Even a once-valid utility result is untrusted after another post changes the
// live deposit: the private contract must reject the stale sequence.
#[test(should_fail_with = "C02 child sequence")]
unconstrained fn c04_stale_retrieved_hint_cannot_skip_authentication() {
    let (mut env, board, owner, chain, time, original) = one_post();
    env.mine_block_at(time + 7202);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(original), Option::none()));
    env.mine_block_at(time + 10803);
    env.call_private(owner, Billboard::at(board).post(chain, crate::fresh_post_nonce(), content(), 4, false, Option::some(original), Option::none()));
}
