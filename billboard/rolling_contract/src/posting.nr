use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash_with_separator, traits::{Deserialize, Serialize, Packable, ToField}};
use crate::encoding::validate_text;
use aztec::state_vars::StateVariable;

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

/// Full post presentation is emitted in authenticated logs, never stored in public
/// state. Neither this event record nor the compact context identifies a human account.
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

/// Bounded thread shape. A single owned name and board are shared by every row;
/// the first row may reply/quote/repost, and each later row replies to its predecessor.
/// Each post writes at most four slots: metadata, tip key, optional subboard/root.
/// The existing bounded thread/Bok product limits remain; no storage index or
/// message digest is duplicated outside the complete PostPublished event.
pub fn validate_thread(board: AztecAddress, nonces: [Field; 4], drafts: [PostDraft; 4],
    count: u32, plugin_ids: [Field; 4], request_ids: [Field; 4]) -> [Field; 4] {
    assert((count >= 2) & (count <= 4), "Thread must contain 2 to 4 posts");
    let mut ids = [0; 4];
    let mut invocations: u32 = 0;
    let root = if drafts[0].parent == 0 { crate::admission::post_id(board, nonces[0]) } else { drafts[0].root_reference };
    for i in 0..4 {
        if i < count {
            let d = drafts[i];
            validate_draft(d, nonces[i]);
            assert((plugin_ids[i] == 0) == (request_ids[i] == 0), "Invalid invocation identity");
            if plugin_ids[i] != 0 { invocations += 1; }
            ids[i] = crate::admission::post_id(board, nonces[i]);
            assert(ids[i] != 0, "Zero post identity");
            assert((d.subboard == drafts[0].subboard) & (d.name_id == drafts[0].name_id), "Thread identity changed");
            assert((d.expected_main_policy_version == drafts[0].expected_main_policy_version)
                & (d.expected_local_policy_version == drafts[0].expected_local_policy_version), "Thread policy changed");
            if i > 0 {
                assert((d.parent == ids[i - 1]) & (d.root_reference == root), "Invalid thread link");
                assert((d.kind == 1) & (d.reference == 0), "Invalid thread continuation");
            }
            for j in 0..4 { if j < i { assert(ids[i] != ids[j], "Duplicate thread post"); } }
        } else {
            assert((nonces[i] == 0) & (plugin_ids[i] == 0) & (request_ids[i] == 0), "Unexpected thread suffix");
        }
    }
    assert((invocations <= 1) & ((invocations == 0) | (count <= 3)), "Thread Bok capacity exceeded");
    ids
}

/// The only context future authorization needs. A zero stored root denotes this
/// post itself. Subboard and non-self root are written only when nonzero.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct PostContext { pub subboard: Field, pub root: Field }
impl PostContext {
    pub fn canonical(self, id: Field) -> Self {
        Self { subboard: self.subboard, root: if self.root == 0 { id } else { self.root } }
    }
}

/// Immutable publication timestamp and policy occupy one field. Main policy starts
/// at one and checked u32 increments never wrap: zero remains absent at timestamp 0.
pub struct PostMetadata { pub timestamp: u64, pub policy: u64 }
impl PostMetadata {
    pub fn encode(timestamp: u64, main: u32, local: u32) -> Field {
        assert(main != 0, "Invalid publication policy");
        let policy = (main as u64) | ((local as u64) << 32);
        (((policy as u128) << 64) | timestamp as u128) as Field
    }
    pub fn decode(value: Field) -> Self {
        let packed = value as u128;
        assert(packed as Field == value, "Invalid post metadata");
        let policy = (packed >> 64) as u64;
        assert(policy as u32 != 0, "Invalid publication policy");
        Self { timestamp: packed as u64, policy }
    }
}

/// Only for fresh zero-metadata post IDs; neither publication path overwrites or
/// clears contexts. Native zero defaults preserve both omitted optional values.
pub fn initialize_post_context(context: aztec::context::PublicContext,
    entry: aztec::state_vars::PublicMutable<PostContext, aztec::context::PublicContext>, record: PostContext) {
    let fields = record.pack();
    let slot = entry.get_storage_slot();
    for i in 0..fields.len() {
        if fields[i] != 0 { context.raw_storage_write(slot + i as Field, [fields[i]]); }
    }
}
