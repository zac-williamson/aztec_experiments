use aztec::protocol::{address::EthAddress, traits::{Packable, FromField, ToField}};
use aztec::note::note_interface::{NoteProperties, NoteType};
use billboard_contract::Billboard::{DepositNote, PostNote};
use billboard_contract::lib::{ReceiptMetadata, SequenceState, get_deposit_msg_hash, deposit_chain_id};
use billboard_contract::Billboard;
use crate::{setup_with_deposit, test_chain};

#[test]
fn c01_compact_exact_maximum_fields_and_generated_selectors() {
    let metadata = ReceiptMetadata { schema_version: 0xffffffff, deposit_nonce: 0xffffffffffffffff };
    let sequences = SequenceState { head_sequence: 0xffffffffffffffff, screened_sequence: 0xffffffffffffffff, last_real_sequence: 0xffffffffffffffff };
    assert_eq(metadata.pack(), [0xffffffffffffffffffffffff]);
    assert_eq(ReceiptMetadata::unpack(metadata.pack()), metadata);
    assert_eq(sequences.pack(), [0xffffffffffffffffffffffffffffffffffffffffffffffff]);
    assert_eq(SequenceState::unpack(sequences.pack()), sequences);
    let note = DepositNote { receipt: metadata, deposit_chain_id: 2, amount: 3,
        l1_depositor: EthAddress::from_field(4), head_link: 5, screened_link: 6,
        sequences, next_allowed_time: 7 };
    std::static_assert(<DepositNote as Packable>::N == 8, "Deposit note must fit V5");
    std::static_assert(<PostNote as Packable>::N == 7, "Post note unchanged");
    // Instantiates the actual macro limit, unlike the earlier pure packing fixture.
    let _ = DepositNote::get_id();
    let _ = PostNote::get_id();
    assert_eq(note.pack(), [0xffffffffffffffffffffffff, 2, 3, 4, 5, 6, 0xffffffffffffffffffffffffffffffffffffffffffffffff, 7]);
    assert_eq(DepositNote::unpack(note.pack()), note);
    let selector = DepositNote::properties().deposit_chain_id;
    assert_eq(selector.index, 1); assert_eq(selector.offset, 0); assert_eq(selector.length, 32);
    assert_eq(DepositNote::properties().next_allowed_time.index, 7);
    let chain = PostNote::properties().deposit_chain_id;
    assert_eq(chain.index, 1); assert_eq(chain.offset, 0); assert_eq(chain.length, 32);
    let previous = PostNote::properties().previous_link;
    assert_eq(previous.index, 5); assert_eq(previous.offset, 0); assert_eq(previous.length, 32);
}

#[test(should_fail_with="Noncanonical receipt metadata")]
fn c01_compact_metadata_rejects_unused_bit96() { let _ = ReceiptMetadata::unpack([0x1000000000000000000000000]); }
#[test(should_fail_with="Noncanonical receipt metadata")]
fn c01_compact_metadata_rejects_truncation_above128() { let _ = ReceiptMetadata::unpack([0x100000000000000000000000000000001]); }
#[test(should_fail_with="Noncanonical sequence state")]
fn c01_compact_sequences_reject_unused_bit192() { let _ = SequenceState::unpack([0x1000000000000000000000000000000000000000000000000]); }
#[test]
fn c01_compact_asymmetric_sequences_do_not_swap() {
    let state = SequenceState { head_sequence: 3, screened_sequence: 2, last_real_sequence: 1 };
    assert_eq(state.pack(), [0x100000000000000020000000000000003]);
    assert_eq(SequenceState::unpack(state.pack()), state);
}
#[test]
unconstrained fn c01_compact_note_lifecycle_claim_deliver_select_burn() {
    let (mut env, board, owner, _censor, now) = setup_with_deposit(1_000_000_000_000_000);
    let chain = test_chain(board, owner, 1_000_000_000_000_000);
    let ids = env.execute_utility(Billboard::at(board).get_deposit_ids(owner,0));
    assert_eq(ids[0],chain);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_ids(owner,1)),[0;10]);
    for i in 1..10 { assert_eq(ids[i],0); }
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_ids(owner,10)),[0;10]);
    let before = env.execute_utility(Billboard::at(board).get_deposit_info(owner,chain));
    assert_eq(before[0],1); assert_eq(before[1],chain); assert_eq(before[3],1_000_000_000_000_000);
    env.mine_block_at(now+3601);
    env.call_private(owner,Billboard::at(board).withdraw(chain));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner,chain)),[0;11]);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_ids(owner,0)),[0;10]);
}
#[test(should_fail_with="No deposit note found")]
unconstrained fn c01_compact_second_burn_rejected() {
    let (mut env, board, owner, _censor, now) = setup_with_deposit(1_000_000_000_000_000);
    let chain = test_chain(board, owner, 1_000_000_000_000_000);
    env.mine_block_at(now+3601);
    env.call_private(owner,Billboard::at(board).withdraw(chain));
    env.call_private(owner,Billboard::at(board).withdraw(chain));
}

#[test]
fn c01_discovery_call_preserves_page_offsets() {
    let board = aztec::protocol::address::AztecAddress::from_field(123);
    let owner = aztec::protocol::address::AztecAddress::from_field(456);
    for page_offset in [0,1,10,0xffffffff] {
        assert_eq(Billboard::at(board).get_deposit_ids(owner,page_offset).args,
            [owner.to_field(), page_offset as Field]);
    }
}

#[test]
unconstrained fn c01_compact_two_receipts_exact_selection_and_independent_burn() {
    let amount: u128 = 1_000_000_000_000_000;
    let (mut env, board, owner, _censor, now) = setup_with_deposit(amount);
    let first = test_chain(board,owner,amount);
    let portal = EthAddress::from_field(0xaabbccdd);
    let depositor = EthAddress::from_field(0x87654321);
    let secret: Field = 0x1234abcd;
    let content = get_deposit_msg_hash(1,portal,board,1,depositor,1,amount);
    let second = deposit_chain_id(board,owner,content,secret);
    assert(first != second);
    let leaf = env.send_l1_to_l2_message(content,secret,portal,board);
    env.call_private(owner,Billboard::at(board).claim_deposit(depositor,amount,1,secret,leaf));
    let ids = env.execute_utility(Billboard::at(board).get_deposit_ids(owner,0));
    assert((ids[0] == first) | (ids[1] == first));
    assert((ids[0] == second) | (ids[1] == second));
    assert(ids[0] != ids[1]);
    for i in 2..10 { assert_eq(ids[i],0); }
    let page = env.execute_utility(Billboard::at(board).get_deposit_ids(owner,1));
    assert_eq(page[0],ids[1]);
    for i in 1..10 { assert_eq(page[i],0); }
    let second_before = env.execute_utility(Billboard::at(board).get_deposit_info(owner,second));
    assert_eq(second_before[1],second); assert_eq(second_before[4],depositor.to_field());
    env.mine_block_at(now+3601);
    env.call_private(owner,Billboard::at(board).withdraw(first));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner,first)),[0;11]);
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_info(owner,second)),second_before);
    let remaining = env.execute_utility(Billboard::at(board).get_deposit_ids(owner,0));
    assert_eq(remaining[0],second);
    for i in 1..10 { assert_eq(remaining[i],0); }
    env.call_private(owner,Billboard::at(board).withdraw(second));
    assert_eq(env.execute_utility(Billboard::at(board).get_deposit_ids(owner,0)),[0;10]);
}
