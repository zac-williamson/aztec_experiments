//! Experimental bounded ingestion, not a completeness or preference-read API.
//! The scoped PXE entry authenticates the complete effect under a canonical
//! header before/after this utility. Standard Aztec note/event validators remain
//! the only writers. No tagging frontier, sync-complete flag or cursor is set.
use aztec::{
    messages::{
        discovery::{ComputeNoteHash, ComputeNoteNullifier, process_message::process_message_ciphertext},
        encoding::{decode_message, MAX_MESSAGE_CONTENT_LEN, MESSAGE_CIPHERTEXT_LEN},
        encryption::{aes128::AES128, message_encryption::MessageEncryption},
        msg_type::{PRIVATE_NOTE_MSG_TYPE_ID, PRIVATE_EVENT_MSG_TYPE_ID},
        processing::{ResolvedTx, validate_and_store_enqueued_notes_and_events},
    },
    oracle::message_processing::get_tx_effect,
    protocol::{address::AztecAddress, traits::{ToField, FromField}},
};

// Metadata/length checks happen before the standard dispatcher, so arbitrary
// partial-note/custom messages cannot create unrelated pending work or capsules.
pub unconstrained fn admits(kind: u64, metadata: u64,
    content: BoundedVec<Field, MAX_MESSAGE_CONTENT_LEN>, owner: AztecAddress,
    slot: Field, note_type: Field, event_type: Field) -> bool {
    if kind == PRIVATE_NOTE_MSG_TYPE_ID {
        if (metadata as Field == note_type) & (content.len() == 7) {
            (content.get(0) == owner.to_field()) & (content.get(1) == slot) & (content.get(3) == 1)
        } else { false }
    } else if kind == PRIVATE_EVENT_MSG_TYPE_ID {
        if (metadata as Field == event_type) & (content.len() == 9) {
            content.get(1) == 1
        } else { false }
    } else { false }
}

pub fn assert_page(first: u8, count: u8) {
    assert((count > 0) & (count <= 8), "Preference page count");
    assert((first as u32 + count as u32) <= 64, "Preference page range");
}

pub unconstrained fn recover(contract_address: AztecAddress, owner: AztecAddress,
    slot: Field, note_type: Field, event_type: Field,
    compute_note_hash: ComputeNoteHash, compute_note_nullifier: ComputeNoteNullifier,
    tx_hash: Field, block_number: u32, block_hash: Field, first: u8, count: u8) -> u8 {
    assert_page(first, count);
    assert((tx_hash != 0) & (block_hash != 0) & (block_number > 0), "Preference page context");
    let effect = get_tx_effect(tx_hash).expect(f"Preference page transaction unavailable");
    assert(effect.tx_hash == tx_hash, "Preference page transaction mismatch");
    let mut hashes = BoundedVec::new();
    let mut ended = false;
    for hash in effect.note_hashes {
        if hash == 0 { ended = true; }
        else { assert(!ended, "Preference page note padding"); hashes.push(hash); }
    }
    let resolved = ResolvedTx { tx_hash, unique_note_hashes_in_tx: hashes,
        first_nullifier_in_tx: effect.nullifiers[0], block_number, block_hash };
    let mut admitted: u8 = 0;
    for offset in 0..count as u32 {
        let log = effect.private_logs[first as u32 + offset];
        assert((log.length > 0) & (log.length <= 16), "Preference page emitted log");
        let mut ciphertext: BoundedVec<Field, MESSAGE_CIPHERTEXT_LEN> = BoundedVec::new();
        for i in 1..log.length { ciphertext.push(log.fields[i]); }
        let plaintext = AES128::decrypt(ciphertext, owner, contract_address);
        if plaintext.is_some() {
            let decoded = decode_message(plaintext.unwrap());
            if decoded.is_some() {
                let (kind, metadata, content) = decoded.unwrap();
                if admits(kind, metadata, content, owner, slot, note_type, event_type) {
                    // Deliberate second bounded decrypt: the standard plaintext
                    // dispatcher is crate-private. Do not fork its validators.
                    process_message_ciphertext(contract_address, compute_note_hash,
                        compute_note_nullifier, Option::none(), ciphertext, resolved, owner);
                    admitted += 1;
                }
            }
        }
    }
    validate_and_store_enqueued_notes_and_events(owner);
    admitted
}

#[test]
fn page_accepts_edges() { assert_page(0, 1); assert_page(56, 8); assert_page(63, 1); }
#[test(should_fail_with = "Preference page count")]
fn page_rejects_zero() { assert_page(0, 0); }
#[test(should_fail_with = "Preference page count")]
fn page_rejects_nine() { assert_page(0, 9); }
#[test(should_fail_with = "Preference page range")]
fn page_rejects_end() { assert_page(63, 2); }

#[test]
unconstrained fn envelope_rejects_foreign_owner_slot_type_length_and_schema() {
    let owner = AztecAddress::from_field(7);
    let content: BoundedVec<Field, 7> = BoundedVec::from_array([7, 9, 10, 1, 2, 3, 4]);
    let mut note: BoundedVec<Field, MAX_MESSAGE_CONTENT_LEN> = BoundedVec::new();
    for i in 0..content.len() { note.push(content.get(i)); }
    assert(admits(PRIVATE_NOTE_MSG_TYPE_ID, 11, note, owner, 9, 11, 12));
    assert(!admits(PRIVATE_NOTE_MSG_TYPE_ID, 11, note, AztecAddress::from_field(8), 9, 11, 12));
    assert(!admits(PRIVATE_NOTE_MSG_TYPE_ID, 11, note, owner, 8, 11, 12));
    assert(!admits(PRIVATE_NOTE_MSG_TYPE_ID, 12, note, owner, 9, 11, 12));
    assert(!admits(PRIVATE_EVENT_MSG_TYPE_ID, 12, note, owner, 9, 11, 12));
    assert(!admits(99, 11, note, owner, 9, 11, 12));
    note.push(0);
    assert(!admits(PRIVATE_NOTE_MSG_TYPE_ID, 11, note, owner, 9, 11, 12));
}

#[test]
unconstrained fn event_envelope_requires_exact_selector_size_and_schema() {
    let owner = AztecAddress::from_field(7);
    let mut event: BoundedVec<Field, MAX_MESSAGE_CONTENT_LEN> = BoundedVec::new();
    for field in [5, 1, 1, 1, 2, 1, 0, 0, 0] { event.push(field); }
    assert(admits(PRIVATE_EVENT_MSG_TYPE_ID, 12, event, owner, 9, 11, 12));
    assert(!admits(PRIVATE_EVENT_MSG_TYPE_ID, 13, event, owner, 9, 11, 12));
    event.push(0);
    assert(!admits(PRIVATE_EVENT_MSG_TYPE_ID, 12, event, owner, 9, 11, 12));
}
