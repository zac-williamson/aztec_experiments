use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash_with_separator, traits::{Deserialize, Serialize, Packable, ToField}};
use crate::encoding::validate_text;

#[derive(Deserialize, Serialize, Eq)]
pub struct PostDraft {
    pub subboard: Field,
    pub parent: Field,
    pub root_reference: Field,
    pub kind: u8,
    pub name_id: Field,
    pub reference: Field,
    pub message: [Field; 32],
    pub length: u16,
    pub expected_main_policy_version: u32,
    pub expected_local_policy_version: u32,
}

/// Content lives in authenticated logs; fixed metadata keeps combined invocation
/// transactions below the public write limit. No human account is stored here.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct PostRecord {
    pub subboard: Field,
    pub parent: Field,
    pub root: Field,
    pub kind: u8,
    pub name_id: Field,
    pub reference: Field,
    pub content_digest: Field,
}
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct PluginRecord { pub adapter: AztecAddress, pub enabled: bool }

pub fn validate_draft(draft: PostDraft, nonce: Field) {
    assert(nonce != 0, "Zero post nonce");
    assert((draft.kind >= 1) & (draft.kind <= 3), "Invalid post kind");
    assert((draft.kind == 1) == (draft.reference == 0), "Invalid post reference");
    assert((draft.parent == 0) == (draft.root_reference == 0), "Invalid root reference");
    validate_text(draft.message, draft.length, draft.kind != 3);
}

/// Exact frozen shared/rolling/invocation.mjs 45-field preimage, with no account,
/// deposit identity, note link, caller-selected hash or unrelated name list.
pub fn invocation_preimage(chain: Field, version: Field, board: AztecAddress,
    adapter: AztecAddress, nonce: Field, draft: PostDraft) -> [Field; 45] {
    validate_draft(draft, nonce);
    assert((chain != 0) & (version != 0) & (board.to_field() != 0) & (adapter.to_field() != 0), "Invocation scope required");
    [1, chain, version, board.to_field(), adapter.to_field(), draft.subboard,
        draft.parent, draft.root_reference, draft.kind as Field, draft.name_id,
        draft.reference, nonce, draft.length as Field].concat(draft.message)
}
pub fn invocation_target(chain: Field, version: Field, board: AztecAddress,
    adapter: AztecAddress, nonce: Field, draft: PostDraft) -> Field {
    poseidon2_hash_with_separator(invocation_preimage(chain, version, board, adapter, nonce, draft), 0x52434931)
}
pub fn policy_identity(main_version: u32, local_version: u32) -> Field {
    main_version as Field + local_version as Field * 0x100000000
}

/// Only a proven app NHK enters this preimage. One account has one tag per post,
/// independently of which owned name is selected elsewhere in the application.
pub fn like_tag(chain: Field, version: Field, board: AztecAddress, post: Field, nhk: Field) -> Field {
    assert((chain != 0) & (version != 0) & (board.to_field() != 0) & (post != 0), "Like scope required");
    poseidon2_hash_with_separator([1, chain, version, board.to_field(), post, nhk], 0x52434c31)
}

/// Storage namespace is separate from the private tag domain. A macro-assigned
/// root then goes through standard Map slot derivation, separating other state.
pub fn like_storage_key(kind: u8, post: Field, tag: Field) -> Field {
    assert((kind == 1) | (kind == 2), "Invalid like namespace");
    assert((post != 0) & ((kind == 1) == (tag == 0)), "Invalid like storage key");
    poseidon2_hash_with_separator([kind as Field, post, tag], 0x52434c53)
}

/// Public adapter identity is allowed; never a human account or note identifier.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct InvocationRecord {
    pub plugin_id: Field, pub adapter: AztecAddress, pub parent: Field,
    pub target: Field, pub replied: bool,
}
pub fn invocation_key(adapter: AztecAddress, request: Field) -> Field {
    assert((adapter.to_field() != 0) & (request != 0), "Invocation identity required");
    poseidon2_hash_with_separator([adapter.to_field(), request], 0x52434249)
}
pub fn bot_reply_id(board: AztecAddress, adapter: AztecAddress, request: Field) -> Field {
    assert(board.to_field() != 0, "Board identity required");
    poseidon2_hash_with_separator([board.to_field(), invocation_key(adapter, request)], 0x52434252)
}
