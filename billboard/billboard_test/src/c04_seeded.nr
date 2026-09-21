// Seeded long-history boundary test, NOT 1,000 executed/proved publications.
// One real post establishes actual storage identity. Official TestEnvironment
// contexts then create/discover 1,001 linked dummy PostNotes in <=16-note batches.
// Test-only replacement of the live deposit establishes historical progress.
// Subsequent real contract calls still authenticate both tail notes and exit.
use aztec::keys::getters::{get_nhk_app, get_public_keys};
use aztec::note::{NoteMessage, lifecycle::create_note, note_getter_options::NoteGetterOptions,
    note_interface::NoteHash};
use aztec::state_vars::{PrivateSet, OwnedStateVariable};
use aztec::protocol::constants::MAX_NOTE_HASHES_PER_CALL;
use billboard_contract::Billboard;
use billboard_contract::Billboard::{DepositNote, PostNote};
use billboard_contract::lib::{post_link, SequenceState};
use crate::{setup_regular_history, test_chain, fresh_post_nonce, msg_with};

#[test]
unconstrained fn test_history_seeded_1002_tail_authentication_and_exit() {
    let amount: u128 = 1_000_000_000_000_000;
    let (mut env, board, owner, _time) = setup_regular_history(1);
    let chain = test_chain(env, board, owner, amount);
    let (first, _) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    let first = first.unwrap_unchecked();
    let post_slot = first.storage_slot;
    // These are the actual generated layout slots; the first authentic note
    // checks the post slot and popping the authentic deposit checks its slot.
    assert_eq(post_slot, 15);
    let deposit_slot: Field = 14;
    let initial = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    let link_secret = env.utility_context_at(board, |_| get_nhk_app(get_public_keys(owner).npk_m_hash));
    let mut previous_link = initial[4];
    let mut screened_link: Field = 0;
    let timestamp = first.note.anchor_timestamp;
    std::static_assert(MAX_NOTE_HASHES_PER_CALL >= 16, "Fixture batch exceeds protocol limit");
    for batch in 0..63 {
        let (messages, last, screened) = env.private_context_at(board, |context| {
            let mut messages: BoundedVec<NoteMessage<PostNote>, 16> = BoundedVec::new();
            let mut previous = previous_link;
            let mut screened = screened_link;
            for i in 0..16 {
                let sequence = 2 + batch as u64 * 16 + i as u64;
                if sequence <= 1002 {
                    let note = PostNote { schema_version: 1, deposit_chain_id: chain,
                        sequence, post_id: 0, anchor_timestamp: timestamp,
                        previous_link: previous, is_dummy: true };
                    let message = create_note(context, owner, post_slot, note);
                    let new_note = message.get_new_note();
                    let hash = note.compute_note_hash(owner, post_slot, new_note.randomness);
                    previous = post_link(board, owner, chain, sequence, hash, link_secret);
                    if sequence == 1000 { screened = previous; }
                    messages.push(message);
                }
            }
            (messages, previous, screened)
        });
        previous_link = last;
        screened_link = screened;
        for i in 0..messages.len() {
            env.discover_note_at(board, messages.get_unchecked(i));
        }
    }
    assert(screened_link != 0); assert(previous_link != screened_link);
    let replacement = env.private_context_at(board, |context| {
        let deposits: PrivateSet<DepositNote, _> = PrivateSet::new(context, deposit_slot, owner);
        let notes = deposits.pop_notes(NoteGetterOptions::<DepositNote, 8, Field, Field>::new().set_limit(1));
        assert_eq(notes.len(), 1);
        let mut deposit = notes.get_unchecked(0);
        assert_eq(deposit.deposit_chain_id, chain);
        assert_eq(deposit.head_link, initial[4]);
        deposit.head_link = previous_link;
        deposit.screened_link = screened_link;
        deposit.sequences = SequenceState { head_sequence: 1002, screened_sequence: 1000, last_real_sequence: 1 };
        deposits.insert(deposit)
    });
    env.discover_note_at(board, replacement);
    let (child, grandchild) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert(child.is_some()); assert(grandchild.is_some());
    assert_eq(child.unwrap_unchecked().note.sequence, 1001);
    assert_eq(grandchild.unwrap_unchecked().note.sequence, 1002);
    assert_eq(child.unwrap_unchecked().note.previous_link, screened_link);
    env.mine_block_at(env.last_block_timestamp() + 7201);
    env.call_private(owner, Billboard::at(board).post(chain, fresh_post_nonce(), msg_with(1003), 4, false, child, grandchild));
    let after = env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain));
    assert_eq(after[5], 1003); assert_eq(after[7], 1002); assert_eq(after[8], 1003);
    assert_eq(env.view_public(Billboard::at(board).get_post_count()), 2);
    env.mine_block_at(env.last_block_timestamp() + 7201);
    let (last, none) = env.execute_utility(Billboard::at(board).get_screen_hints(owner, chain));
    assert_eq(last.unwrap_unchecked().note.sequence, 1003); assert(none.is_none());
    env.call_private(owner, Billboard::at(board).post(chain, 0, [0; 32], 0, true, last, none));
    env.mine_block_at(env.last_block_timestamp() + 7201);
    env.call_private(owner, Billboard::at(board).withdraw(chain));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner, chain)), [0; 10]);
}
