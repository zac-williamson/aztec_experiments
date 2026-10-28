use aztec::macros::{aztec, AztecConfig};
use owner_delivery::delivery::sync_owner_state;
pub mod encoding;
pub mod admission;
pub mod posting;
pub mod profiles;
mod profiles_tests;
mod posting_tests;
mod tests;

/// Private names, authentic policy and collateral-backed canonical publication.
/// Real-proof, bridge, wallet and privacy qualification remain release gates.
#[aztec(AztecConfig::new().custom_sync_state(sync_owner_state))]
pub contract RollingBoard {
    use aztec::{
        hash::compute_secret_hash,
        history::{note::assert_note_existed_by, storage::public_storage_historical_read},
        keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},
        macros::{events::event, functions::{external, initializer, internal, only_self, view}, notes::note, storage::storage},
        note::{note_getter_options::{NoteGetterOptions, NoteStatus}, note_viewer_options::NoteViewerOptions, note_interface::{NoteProperties, NoteHash, NoteType}, HintedNote, ConfirmedNote},
        protocol::{address::{AztecAddress, EthAddress}, abis::block_header::BlockHeader, hash::poseidon2_hash_with_separator, traits::{Deserialize, Hash, Packable, Serialize, ToField}},
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable, StateVariable},
        utils::comparison::Comparator,
    };
    use owner_delivery::delivery::deliver_note;
    use crate::admission::{Config, SequenceState, compute_cooldown, checked_time_add, deposit_chain_id, deposit_decision_nullifier, post_id, post_link, get_ready_msg_hash, get_deposit_msg_hash, get_withdraw_msg_hash, get_cancel_msg_hash, get_refund_msg_hash};
    use crate::posting::{PostDraft, PostRecord, PluginRecord, validate_draft, invocation_target, InvocationRecord, invocation_key, bot_reply_id};
    use crate::profiles::{OwnedNameRecord, ProfileRecord, AvatarModerationRecord, next_version, bio_digest, avatar_digest};
    global SENTINEL: Field = 0;
    use crate::encoding::{name_id, pack_bytes, subboard_id, text_hash, validate_text};

    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct UsernameNote {
        pub name_id: Field,
        pub schema: u32,
        pub first_length: u8,
        pub first: [Field; 2],
        pub last_length: u8,
        pub last: [Field; 2],
    }
    impl UsernameNote {
        fn record(self) -> OwnedNameRecord {
            OwnedNameRecord { name_id: self.name_id, schema: self.schema,
                first_length: self.first_length, first: self.first,
                last_length: self.last_length, last: self.last }
        }
    }

    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct PostNote {
        pub schema_version: u32,
        pub deposit_chain_id: Field,
        pub sequence: u64,
        pub post_id: Field,
        pub anchor_timestamp: u64,
        pub previous_link: Field,
        pub is_dummy: bool,
    }

    // Constructed only from the executing board, caller and selected live deposit.
    // Merkle inclusion alone authorizes neither a foreign contract nor another owner.
    pub struct ScreeningScope {
        pub board: AztecAddress,
        pub owner: AztecAddress,
        pub slot: Field,
        pub chain: Field,
    }

    impl ScreeningScope {
        fn assert_identity(self, board: AztecAddress, owner: AztecAddress, slot: Field, note: PostNote) {
            assert(board == self.board, "C02 wrong contract");
            assert(owner == self.owner, "C02 wrong owner");
            assert(slot == self.slot, "C02 wrong slot");
            assert(note.schema_version == 1, "C02 wrong schema");
            assert((note.deposit_chain_id == self.chain) & (self.chain != 0), "C02 wrong chain");
        }

        /// Fetch one exact successor, with one additional result to detect ambiguity.
        /// PXE applies selectors before the limit, so history length cannot hide a successor.
        unconstrained fn get_screen_successor(
            self, previous_link: Field, is_child: bool,
        ) -> HintedNote<PostNote> {
            let scope = self;
            let chain = PostNote::properties().deposit_chain_id;
            let previous = PostNote::properties().previous_link;
            let notes = aztec::oracle::notes::get_notes::<PostNote, 2, 2>(
                Option::some(scope.owner), scope.slot, 2,
                [chain.index, previous.index], [chain.offset, previous.offset],
                [chain.length, previous.length], [scope.chain, previous_link],
                [Comparator.EQ, Comparator.EQ], [0; 2], [0; 2], [0; 2], [0; 2],
                2, 0, NoteStatus.ACTIVE,
            );
            if is_child {
                assert(notes[0].is_some(), "BB_HISTORY_CHILD_MISSING");
                assert(notes[1].is_none(), "BB_HISTORY_CHILD_AMBIGUOUS");
            } else {
                assert(notes[0].is_some(), "BB_HISTORY_GRANDCHILD_MISSING");
                assert(notes[1].is_none(), "BB_HISTORY_GRANDCHILD_AMBIGUOUS");
            }
            let hinted = notes[0].unwrap_unchecked();
            scope.assert_identity(hinted.contract_address, hinted.owner, hinted.storage_slot, hinted.note);
            assert(hinted.note.previous_link == previous_link, "BB_HISTORY_STALE");
            hinted
        }

        unconstrained fn thread_history(self, deposit: DepositNote, count: u32) -> [Option<HintedNote<PostNote>>; 8] {
            assert((count >= 2) & (count <= 4), "Thread must contain 2 to 4 posts");
            let head = deposit.sequences.head_sequence;
            let screened = deposit.sequences.screened_sequence;
            assert((deposit.deposit_chain_id == self.chain) & (self.chain != 0), "BB_HISTORY_DEPOSIT_INVALID");
            assert(screened <= head, "BB_HISTORY_STALE");
            assert(deposit.sequences.last_real_sequence <= head, "BB_HISTORY_STALE");
            assert((head == 0) == (deposit.head_link == SENTINEL), "BB_HISTORY_STALE");
            assert((screened == 0) == (deposit.screened_link == SENTINEL), "BB_HISTORY_STALE");
            assert((screened == head) == (deposit.screened_link == deposit.head_link), "BB_HISTORY_STALE");
            let mut result = [Option::none(); 8];
            if screened < head {
                let maybe_pk = try_get_public_keys(self.owner);
                assert(maybe_pk.is_some(), "BB_HISTORY_KEYS_MISSING");
                let secret = get_nhk_app(maybe_pk.unwrap_unchecked().npk_m_hash);
                let mut previous = deposit.screened_link;
                let mut previous_timestamp: u64 = 0;
                for i in 0..8 {
                    if (i < 2 * count) & (i as u64 < head - screened) {
                        let hint = self.get_screen_successor(previous, i == 0);
                        let note = hint.note;
                        assert(note.sequence == screened + 1 + i as u64, "BB_HISTORY_STALE");
                        assert(note.anchor_timestamp >= previous_timestamp, "BB_HISTORY_STALE");
                        let hash = note.compute_note_hash(hint.owner, hint.storage_slot, hint.randomness);
                        previous = post_link(self.board, self.owner, self.chain, note.sequence, hash, secret);
                        assert((previous == deposit.head_link) == (note.sequence == head), "BB_HISTORY_STALE");
                        previous_timestamp = note.anchor_timestamp;
                        result[i] = Option::some(hint);
                    }
                }
            }
            result
        }

        fn authenticate(self, header: BlockHeader, hinted: HintedNote<PostNote>) -> ConfirmedNote<PostNote> {
            self.assert_identity(hinted.contract_address, hinted.owner, hinted.storage_slot, hinted.note);
            let confirmed = assert_note_existed_by(header, hinted);
            self.assert_identity(confirmed.contract_address, confirmed.owner, confirmed.storage_slot, confirmed.note);
            assert(confirmed.note.anchor_timestamp <= header.timestamp(), "C02 future timestamp");
            confirmed
        }
    }

    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct DepositNote {
        pub deposit_chain_id: Field,
        pub amount: u128,
        pub l1_depositor: EthAddress,
        pub deposit_id: Field,
        pub head_link: Field,
        pub screened_link: Field,
        pub sequences: SequenceState,
        pub next_allowed_time: u64,
    }

    impl DepositNote {
        fn logical_fields(self) -> [Field; 11] {
            [1, self.deposit_chain_id,
                self.amount as Field, self.l1_depositor.to_field(), self.head_link,
                self.sequences.head_sequence as Field, self.screened_link, self.sequences.screened_sequence as Field,
                self.sequences.last_real_sequence as Field, self.next_allowed_time as Field, self.deposit_id]
        }
    }


    /// Grouped only to keep the pinned macro's repeated PrivateContext type below
    /// its complexity cap. This is a fresh deployment, not a state migration.
    #[derive(Deserialize, Serialize, Eq, Packable)]
    pub struct SubboardRecord {
        pub exists: bool,
        pub local_rules: Field,
        pub metadata: Field,
        pub creation_version: u32,
        pub rejected: bool,
        pub rejection_reason: Field,
    }

    #[storage]
    struct Storage<Context> {
        portal_address: PublicImmutable<EthAddress, Context>,
        config: PublicImmutable<Config, Context>,
        deposits: Owned<PrivateSet<DepositNote, Context>, Context>,
        posts: Owned<PrivateSet<PostNote, Context>, Context>,
        post_count: PublicMutable<u64, Context>,
        post_id_by_order: Map<u64, PublicMutable<Field, Context>, Context>,
        post_exists: Map<Field, PublicMutable<bool, Context>, Context>,
        post_time: Map<Field, PublicMutable<u64, Context>, Context>,
        post_flag_deadline: Map<Field, PublicMutable<u64, Context>, Context>,
        post_flagged: Map<Field, PublicMutable<u8, Context>, Context>,
        post_policy_version: Map<Field, PublicMutable<Field, Context>, Context>,
        post_records: Map<Field, PublicMutable<PostRecord, Context>, Context>,
        post_reason: Map<Field, PublicMutable<Field, Context>, Context>,
        plugins: Map<Field, PublicMutable<PluginRecord, Context>, Context>,
        moderator: PublicMutable<AztecAddress, Context>,
        main_version: PublicMutable<u32, Context>,
        main_rules: PublicMutable<Field, Context>,
        registered_names: Map<Field, PublicMutable<bool, Context>, Context>,
        names: Owned<PrivateSet<UsernameNote, Context>, Context>,
        subboards: Map<Field, PublicMutable<SubboardRecord, Context>, Context>,
        like_state: LikeStorageRoot,
        private_fee: PublicImmutable<AztecAddress, Context>,
        // Only post creation writes this slot, guarded by !post_exists. Full P is in its paired event.
        tip_key_hashes: Map<Field, PublicMutable<Field, Context>, Context>,
        invocation_state: InvocationStorageRoot,
        profile_state: ProfileStorageRoot,
        avatar_moderation_state: AvatarModerationStorageRoot,
        // Append only: all existing storage slots retain their positions.
    }

    #[event]
    struct NameRegistered {
        schema: u32,
        name_id: Field,
        first_length: u8,
        first: [Field; 2],
        last_length: u8,
        last: [Field; 2],
    }

    #[event]
    struct MainPolicyPublished {
        schema: u32,
        version: u32,
        digest: Field,
        length: u16,
        rules: [Field; 32],
    }

    #[event]
    struct SubboardCreated {
        schema: u32,
        subboard_id: Field,
        slug_length: u8,
        slug: [Field; 2],
        name_length: u16,
        name: [Field; 3],
        description_length: u16,
        description: [Field; 16],
        local_policy_version: u32,
        rules_length: u16,
        rules: [Field; 32],
        rules_digest: Field,
        main_policy_version: u32,
        metadata_digest: Field,
    }

    #[event]
    struct SubboardRejected {
        schema: u32,
        subboard_id: Field,
        main_policy_version: u32,
        local_policy_version: u32,
        reason_length: u16,
        reason: [Field; 7],
        reason_digest: Field,
    }

    #[external("public")]
    #[initializer]
    fn init(rules: [Field; 32], length: u16, l1_chain_id: u64, rollup_address: EthAddress,
        rollup_version: u32, min_deposit: u128, max_deposit: u128, base_cooldown: u32,
        k: u16, censor_window: u32, max_save_up: u16, private_fee: AztecAddress) {
        let config = Config { l1_chain_id, rollup_address, rollup_version, min_deposit, max_deposit,
            base_cooldown, k_multiplier: k, censor_window, max_save_up, deployer: self.msg_sender() };
        config.validate(self.context.chain_id(), self.context.version());
        self.storage.config.initialize(config);
        assert(private_fee.to_field() != 0, "Private fee contract required");
        self.storage.private_fee.initialize(private_fee);
        validate_text(rules, length, true);
        let moderator = self.msg_sender();
        assert(moderator.to_field() != 0, "Moderator required");
        self.storage.moderator.write(moderator);
        self.storage.main_version.write(1);
        let digest = text_hash(rules, length);
        self.storage.main_rules.write(digest);
        self.emit(MainPolicyPublished { schema: 1, version: 1, digest, length, rules });
    }

    #[external("private")]
    fn register_name(first: [u8; 32], first_length: u8, last: [u8; 32], last_length: u8) {
        let record = OwnedNameRecord::new(first, first_length, last, last_length);
        let owner = self.msg_sender();
        let created = self.storage.names.at(owner).insert(UsernameNote {
            name_id: record.name_id, schema: record.schema, first_length: record.first_length,
            first: record.first, last_length: record.last_length, last: record.last,
        }).get_new_note();
        deliver_note(self.context, created);
        // Kernel links private mint to this public uniqueness gate. Rejection rolls
        // back the entire transaction, including its ownership note.
        self.enqueue_self._register_name(first, first_length, last, last_length);
    }

    #[external("public")]
    #[only_self]
    fn _register_name(first: [u8; 32], first_length: u8, last: [u8; 32], last_length: u8) {
        let id = name_id(first, first_length, last, last_length);
        assert(!self.storage.registered_names.at(id).read(), "Name already registered");
        self.storage.registered_names.at(id).write(true);
        self.emit(NameRegistered { schema: 1, name_id: id, first_length, first: pack_bytes(first), last_length, last: pack_bytes(last) });
    }

    /// Shared in-contract ownership gate for future named posts/profile updates.
    /// No owner or list of names is passed to a public call. Consuming and replacing
    /// authenticates the owner with its nullifier key and prevents forged note reuse.
    #[internal("private")]
    fn _assert_name_owner(id: Field) {
        assert(id != 0, "Name required");
        let owner = self.msg_sender();
        let options = NoteGetterOptions::<UsernameNote, 8, Field, Field>::new()
            .select(UsernameNote::properties().name_id, Comparator.EQ, id).set_limit(1);
        let notes = self.storage.names.at(owner).pop_notes(options);
        assert(notes.len() == 1, "No owned name");
        let note = notes.get_unchecked(0);
        assert((note.schema == 1) & (note.name_id == id), "Invalid ownership note");
        note.record().validate();
        let created = self.storage.names.at(owner).insert(note).get_new_note();
        deliver_note(self.context, created);
    }

    /// A private ownership exercise, not a posting or profile-update bypass.
    #[external("private")]
    fn authenticate_name(id: Field) { self.internal._assert_name_owner(id); }

    /// Wallet-local utility only. Never expose this request through the index API.
    /// Avoid `offset`: the pinned generated call serializer uses that local name.
    #[external("utility")]
    unconstrained fn owned_names(owner: AztecAddress, page_offset: u32) -> pub [Field; 8] {
        let options = NoteViewerOptions::<UsernameNote, 8>::new().set_limit(8).set_offset(page_offset);
        let notes = self.storage.names.at(owner).view_notes(options);
        let mut result = [0; 8];
        for i in 0..8 { if i < notes.len() { result[i] = notes.get_unchecked(i).name_id; } }
        result
    }

    /// Private wallet-local metadata; trusted PXE only, never a public index API.
    #[external("utility")]
    unconstrained fn owned_name_records(owner: AztecAddress, page_offset: u32) -> pub [OwnedNameRecord; 8] {
        let options = NoteViewerOptions::<UsernameNote, 8>::new().set_limit(8).set_offset(page_offset);
        let notes = self.storage.names.at(owner).view_notes(options);
        let mut result = [OwnedNameRecord::empty(); 8];
        for i in 0..8 { if i < notes.len() { result[i] = notes.get_unchecked(i).record(); } }
        result
    }

    // Appended single slot keeps every pre-existing slot stable and avoids a
    // further Map<PrivateContext> expansion in the pinned macro.
    struct ProfileStorageRoot { slot: Field }
    impl<Context> StateVariable<1, Context> for ProfileStorageRoot {
        fn new(_context: Context, storage_slot: Field) -> Self {
            assert(storage_slot != 0, "Zero profile storage root");
            Self { slot: storage_slot }
        }
        fn get_storage_slot(self) -> Field { self.slot }
    }
    struct ProfileState {}
    impl ProfileState {
        unconstrained fn entry(context: aztec::context::PublicContext, slot: Field, name: Field)
            -> PublicMutable<ProfileRecord, aztec::context::PublicContext> {
            Map::<Field, PublicMutable<ProfileRecord, aztec::context::PublicContext>, aztec::context::PublicContext>::new(context, slot).at(name)
        }
    }

    #[event]
    struct BioPublished {
        schema: u32, name_id: Field, version: u32, length: u16,
        digest: Field, content: [Field; 32], trailer: Field,
    }
    #[event]
    struct AvatarPublished {
        schema: u32, name_id: Field, version: u32, width: u16, height: u16,
        length: u16, digest: Field, data: [Field; 265], trailer: Field,
    }

    #[external("private")]
    fn set_bio(name_id: Field, expected_version: u32, content: [Field; 32], length: u16) {
        self.internal._assert_name_owner(name_id);
        self.enqueue_self._set_bio(name_id, expected_version, content, length);
    }
    #[external("public")]
    #[only_self]
    fn _set_bio(name_id: Field, expected_version: u32, content: [Field; 32], length: u16) {
        assert(self.storage.registered_names.at(name_id).read(), "Unknown profile name");
        let entry = ProfileState::entry(self.context, self.storage.profile_state.slot, name_id);
        let mut current = entry.read();
        let version = next_version(current.bio_version, expected_version);
        let digest = bio_digest(name_id, version, content, length);
        current.bio_version = version; current.bio_digest = digest; current.bio_length = length;
        entry.write(current);
        self.emit(BioPublished { schema: 1, name_id, version, length, digest, content, trailer: 1 });
    }

    #[external("private")]
    fn set_avatar(name_id: Field, expected_version: u32, width: u16, height: u16,
        length: u16, data: [Field; 265]) {
        self.internal._assert_name_owner(name_id);
        self.enqueue_self._set_avatar(name_id, expected_version, width, height, length, data);
    }
    #[external("public")]
    #[only_self]
    fn _set_avatar(name_id: Field, expected_version: u32, width: u16, height: u16,
        length: u16, data: [Field; 265]) {
        assert(self.storage.registered_names.at(name_id).read(), "Unknown profile name");
        let entry = ProfileState::entry(self.context, self.storage.profile_state.slot, name_id);
        let mut current = entry.read();
        let version = next_version(current.avatar_version, expected_version);
        let digest = avatar_digest(name_id, version, width, height, length, data);
        current.avatar_version = version; current.avatar_digest = digest;
        current.avatar_width = width; current.avatar_height = height; current.avatar_length = length;
        entry.write(current);
        self.emit(AvatarPublished { schema: 1, name_id, version, width, height, length, digest, data, trailer: 1 });
    }

    // Separate appended root leaves every existing profile/portal slot and
    // ProfileRecord ABI unchanged. No private ownership is inspected here.
    struct AvatarModerationStorageRoot { slot: Field }
    impl<Context> StateVariable<1, Context> for AvatarModerationStorageRoot {
        fn new(_context: Context, storage_slot: Field) -> Self {
            assert(storage_slot != 0, "Zero avatar moderation root");
            Self { slot: storage_slot }
        }
        fn get_storage_slot(self) -> Field { self.slot }
    }
    struct AvatarModerationState {}
    impl AvatarModerationState {
        unconstrained fn entry(context: aztec::context::PublicContext, slot: Field, name: Field)
            -> PublicMutable<AvatarModerationRecord, aztec::context::PublicContext> {
            Map::<Field, PublicMutable<AvatarModerationRecord, aztec::context::PublicContext>, aztec::context::PublicContext>::new(context, slot).at(name)
        }
        unconstrained fn view(context: aztec::context::UtilityContext, slot: Field, name: Field)
            -> AvatarModerationRecord {
            Map::<Field, PublicMutable<AvatarModerationRecord, aztec::context::UtilityContext>, aztec::context::UtilityContext>::new(context, slot).at(name).read()
        }
    }
    #[event]
    struct AvatarRemoved {
        schema: u32, name_id: Field, avatar_version: u32, avatar_digest: Field,
        main_policy_version: u32, reason_digest: Field, length: u16, reason: [Field; 7],
    }
    #[external("public")]
    fn remove_avatar(name_id: Field, expected_avatar_version: u32, expected_main_version: u32,
        reason: [Field; 7], length: u16) {
        assert(self.msg_sender() == self.storage.moderator.read(), "Only moderator");
        assert(self.storage.registered_names.at(name_id).read(), "Unknown profile name");
        let current = ProfileState::entry(self.context, self.storage.profile_state.slot, name_id).read();
        assert(current.avatar_length > 0, "No current avatar");
        assert(current.avatar_version == expected_avatar_version, "Avatar changed");
        let main_version = self.storage.main_version.read();
        assert(main_version == expected_main_version, "Policy changed");
        validate_text(reason, length, true);
        let entry = AvatarModerationState::entry(self.context, self.storage.avatar_moderation_state.slot, name_id);
        assert(entry.read().avatar_version != current.avatar_version, "Avatar already removed");
        let reason_digest = text_hash(reason, length);
        entry.write(AvatarModerationRecord { avatar_version: current.avatar_version,
            avatar_digest: current.avatar_digest, main_policy_version: main_version, reason_digest });
        self.emit(AvatarRemoved { schema: 1, name_id, avatar_version: current.avatar_version,
            avatar_digest: current.avatar_digest, main_policy_version: main_version, reason_digest, length, reason });
    }
    /// Public metadata queried locally. Compare the returned version to current
    /// profile_state: old removal history does not remove a later owner upload.
    #[external("utility")]
    unconstrained fn avatar_moderation(name_id: Field) -> pub AvatarModerationRecord {
        assert(self.storage.registered_names.at(name_id).read(), "Unknown profile name");
        AvatarModerationState::view(self.context, self.storage.avatar_moderation_state.slot, name_id)
    }

    #[external("public")]
    #[view]
    fn profile_state(name_id: Field) -> pub ProfileRecord {
        assert(self.storage.registered_names.at(name_id).read(), "Unknown profile name");
        ProfileState::entry(self.context, self.storage.profile_state.slot, name_id).read()
    }

    #[external("public")]
    #[view]
    fn name_registered(id: Field) -> pub bool { self.storage.registered_names.at(id).read() }

    /// No collateral test or creator permission is introduced. Normal transaction
    /// fees still apply. Only public board data crosses the private/public boundary.
    #[external("private")]
    fn create_subboard(slug: [u8; 40], slug_length: u8, name: [Field; 3], name_length: u16,
        description: [Field; 16], description_length: u16, rules: [Field; 32], rules_length: u16) {
        assert(self.msg_sender().to_field() != 0, "Account required");
        self.enqueue_self._create_subboard(slug, slug_length, name, name_length, description, description_length, rules, rules_length);
    }

    #[external("public")]
    #[only_self]
    fn _create_subboard(slug: [u8; 40], slug_length: u8, name: [Field; 3], name_length: u16,
        description: [Field; 16], description_length: u16, rules: [Field; 32], rules_length: u16) {
        let id = subboard_id(slug, slug_length);
        validate_text(name, name_length, true);
        validate_text(description, description_length, true);
        validate_text(rules, rules_length, false);
        assert(!self.storage.subboards.at(id).read().exists, "Subboard already exists");
        let rules_digest = text_hash(rules, rules_length);
        let metadata_digest = poseidon2_hash_with_separator([id, text_hash(name, name_length), text_hash(description, description_length)], 0x52434d31);
        let main_policy_version = self.storage.main_version.read();
        self.storage.subboards.at(id).write(SubboardRecord { exists: true,
            local_rules: rules_digest, metadata: metadata_digest, creation_version: main_policy_version,
            rejected: false, rejection_reason: 0 });
        self.emit(SubboardCreated { schema: 1, subboard_id: id, slug_length, slug: pack_bytes(slug),
            name_length, name, description_length, description, local_policy_version: 1,
            rules_length, rules, rules_digest, main_policy_version, metadata_digest });
    }

    #[event]
    struct ModeratorTransferred {
        schema: u32,
        previous: AztecAddress,
        successor: AztecAddress,
    }

    #[external("public")]
    fn transfer_moderator(successor: AztecAddress) {
        let previous = self.storage.moderator.read();
        assert(self.msg_sender() == previous, "Only moderator");
        assert(successor.to_field() != 0, "Moderator required");
        assert(successor != previous, "Moderator unchanged");
        self.storage.moderator.write(successor);
        self.emit(ModeratorTransferred { schema: 1, previous, successor });
    }

    #[external("public")]
    #[view]
    fn current_moderator() -> pub AztecAddress { self.storage.moderator.read() }

    #[external("public")]
    fn set_main_policy(rules: [Field; 32], length: u16) {
        assert(self.msg_sender() == self.storage.moderator.read(), "Only moderator");
        validate_text(rules, length, true);
        let version = self.storage.main_version.read() + 1;
        let digest = text_hash(rules, length);
        self.storage.main_version.write(version);
        self.storage.main_rules.write(digest);
        self.emit(MainPolicyPublished { schema: 1, version, digest, length, rules });
    }

    #[external("public")]
    fn reject_subboard(id: Field, reason: [Field; 7], length: u16) {
        assert(self.msg_sender() == self.storage.moderator.read(), "Only moderator");
        assert(self.storage.subboards.at(id).read().exists, "Unknown subboard");
        let mut record = self.storage.subboards.at(id).read();
        assert(!record.rejected, "Already rejected");
        validate_text(reason, length, true);
        let reason_digest = text_hash(reason, length);
        record.rejected = true;
        record.rejection_reason = reason_digest;
        // Preserve immutable metadata, rules and creation version on update.
        self.storage.subboards.at(id).write(record);
        self.emit(SubboardRejected { schema: 1, subboard_id: id, main_policy_version: self.storage.main_version.read(),
            local_policy_version: 1, reason_length: length, reason, reason_digest });
    }

    /// Local policy never replaces the parent: consumers must apply BOTH returned
    /// rule sets. Parent updates are observed dynamically with no per-subboard copy.
    #[external("public")]
    #[view]
    fn effective_policy(id: Field) -> pub (u32, Field, u32, Field, bool) {
        assert(self.storage.subboards.at(id).read().exists, "Unknown subboard");
        (self.storage.main_version.read(), self.storage.main_rules.read(), 1,
            self.storage.subboards.at(id).read().local_rules, self.storage.subboards.at(id).read().rejected)
    }

    #[external("public")]
    #[view]
    fn subboard_state(id: Field) -> pub (bool, Field, u32, bool, Field) {
        let record = self.storage.subboards.at(id).read();
        (record.exists, record.metadata, record.creation_version, record.rejected, record.rejection_reason)
    }

    #[external("public")]
    #[view]
    fn main_policy() -> pub (u32, Field) { (self.storage.main_version.read(), self.storage.main_rules.read()) }

    #[external("private")]
    fn update_portal(portal: EthAddress) {
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        assert(self.msg_sender() == config.deployer, "Only deployer can set portal");
        portal.validate();
        assert(portal.to_field() != 0, "Zero portal");
        self.enqueue_self._set_portal_public(portal);
    }

    #[external("public")]
    #[only_self]
    fn _set_portal_public(portal: EthAddress) {
        portal.validate();
        assert(portal.to_field() != 0, "Zero portal");
        assert(!self.storage.portal_address.is_initialized(), "Portal address already set -- immutable");
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        self.storage.portal_address.initialize(portal);
        let content = get_ready_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, config.hash(self.address));
        self.context.message_portal(portal, content);
    }

    #[external("private")]
    fn claim_deposit(depositor: EthAddress, amount: u128, secret: Field, message_leaf_index: Field) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let portal = self.storage.portal_address.read();
        portal.validate();
        depositor.validate();
        assert(portal.to_field() != 0, "Zero portal");
        assert(sender.to_field() != 0, "Zero owner");
        assert(depositor.to_field() != 0, "Zero depositor");
        assert(secret != 0, "Zero claim secret");
        assert(amount >= config.min_deposit, "Deposit below minimum");
        assert(amount <= config.max_deposit, "Deposit above maximum");
        let content = get_deposit_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, depositor, amount);
        self.context.consume_l1_to_l2_message(content, [secret], portal, message_leaf_index);
        let deposit_id = compute_secret_hash([secret]);
        self.context.push_nullifier_unsafe(deposit_decision_nullifier(portal, depositor, deposit_id));
        let chain = deposit_chain_id(self.address, sender, content, secret, message_leaf_index);
        assert(chain != 0, "Zero deposit identity");
        let cooldown = compute_cooldown(amount, config.base_cooldown as u64, config.min_deposit);
        let note = DepositNote { deposit_chain_id: chain,
            amount, l1_depositor: depositor, deposit_id, head_link: 0, screened_link: 0,
            sequences: SequenceState { head_sequence: 0, screened_sequence: 0, last_real_sequence: 0 },
            next_allowed_time: checked_time_add(now, cooldown) };
        let created = self.storage.deposits.at(sender).insert(note).get_new_note();
        deliver_note(self.context, created);
    }

    /// Anyone can finish the Ethereum owner's authenticated cancellation request.
    /// No private account restoration or original claim secret is needed.
    #[external("private")]
    fn cancel_deposit(depositor: EthAddress, amount: u128, deposit_id: Field, message_leaf_index: Field) {
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let portal = self.storage.portal_address.read();
        portal.validate();
        depositor.validate();
        assert(portal.to_field() != 0, "Zero portal");
        assert(depositor.to_field() != 0, "Zero depositor");
        assert(deposit_id != 0, "Zero deposit");
        assert(amount >= config.min_deposit, "Deposit below minimum");
        assert(amount <= config.max_deposit, "Deposit above maximum");
        let content = get_cancel_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, depositor, amount, deposit_id);
        self.context.consume_l1_to_l2_message(content, [1], portal, message_leaf_index);
        self.context.push_nullifier_unsafe(deposit_decision_nullifier(portal, depositor, deposit_id));
        self.context.message_portal(portal, get_refund_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, depositor, amount, deposit_id));
    }

    // Ported admission transition: caller validates canonical post data before this
    // internal helper. There is no public caller-selected eligibility certificate.
    struct Admission {}
    impl Admission {
        fn pop(context: &mut aztec::context::PrivateContext, storage: Storage<&mut aztec::context::PrivateContext>,
            deposit_chain_id: Field) -> DepositNote {
            let sender = context.maybe_msg_sender().unwrap();
            let options = NoteGetterOptions::<DepositNote, 8, Field, Field>::new()
                .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
            let notes = storage.deposits.at(sender).pop_notes(options);
            assert(notes.len() > 0, "No deposit note found -- claim a deposit first");
            let deposit = notes.get_unchecked(0);
            assert((deposit.deposit_chain_id == deposit_chain_id) & (deposit_chain_id != 0), "Invalid deposit identity");
            deposit
        }

        fn save(context: &mut aztec::context::PrivateContext, storage: Storage<&mut aztec::context::PrivateContext>,
            deposit: DepositNote) {
            let sender = context.maybe_msg_sender().unwrap();
            let created = storage.deposits.at(sender).insert(deposit).get_new_note();
            deliver_note(context, created);
        }

        fn consume(context: &mut aztec::context::PrivateContext, storage: Storage<&mut aztec::context::PrivateContext>,
            deposit_chain_id: Field, public_post_id: Field, is_dummy: bool,
            child: Option<HintedNote<PostNote>>, grandchild: Option<HintedNote<PostNote>>) {
            let deposit = Self::pop(context, storage, deposit_chain_id);
            let next = Self::advance(context, storage, deposit, deposit.sequences.head_sequence,
                deposit.head_link, public_post_id, is_dummy, child, grandchild);
            Self::save(context, storage, next);
        }

        // The historical boundary comes only from the deposit popped in this
        // entrypoint. Appended notes are constructed here, never caller-supplied
        // replacements for historical membership proofs. Each post still screens
        // up to two historical entries and pays its own cooldown/flag penalty.
        fn advance(context: &mut aztec::context::PrivateContext, storage: Storage<&mut aztec::context::PrivateContext>,
            dep_note: DepositNote, historical_head_sequence: u64, historical_head_link: Field,
            public_post_id: Field, is_dummy: bool,
            child: Option<HintedNote<PostNote>>, grandchild: Option<HintedNote<PostNote>>) -> DepositNote {
        let sender = context.maybe_msg_sender().unwrap();
        let now = context.get_anchor_block_header().timestamp();
        let header = context.get_anchor_block_header();
        let addr = context.this_address();
        let deposit_chain_id = dep_note.deposit_chain_id;
        assert((public_post_id == 0) == is_dummy, "Invalid admission post identity");
        let config = storage.config.read();
        config.validate(context.chain_id(), context.version());
        let cooldown = compute_cooldown(dep_note.amount, config.base_cooldown as u64, config.min_deposit);
        let k = config.k_multiplier as u64;
        let censor_window = config.censor_window as u64;
        let max_save_up = config.max_save_up as u64;

        // --- Get link_secret (app-siloed nullifier hiding key) ---
        let owner_npk_m_hash = get_public_keys(sender).npk_m_hash;
        let link_secret = context.request_nhk_app(owner_npk_m_hash);

        // --- Screen posts (child and grandchild) ---
        let mut flag_count: u64 = 0;
        let mut new_screened_link = dep_note.screened_link;
        let mut new_screened_sequence = dep_note.sequences.screened_sequence;

        let head_sequence = dep_note.sequences.head_sequence;
        let screened_sequence = dep_note.sequences.screened_sequence;
        assert(screened_sequence <= head_sequence, "C02 deposit sequence");
        assert(dep_note.sequences.last_real_sequence <= head_sequence, "C02 deposit real sequence");
        assert((head_sequence == 0) == (dep_note.head_link == SENTINEL), "C02 deposit head");
        assert((screened_sequence == 0) == (dep_note.screened_link == SENTINEL), "C02 deposit screened link");
        assert((screened_sequence == head_sequence) == (dep_note.screened_link == dep_note.head_link), "C02 deposit progress");
        assert(historical_head_sequence <= head_sequence, "C02 historical head");
        assert(screened_sequence <= historical_head_sequence, "C02 historical progress");
        let need_screening = screened_sequence < historical_head_sequence;
        let scope = ScreeningScope { board: addr, owner: sender,
            slot: storage.posts.at(sender).storage_slot, chain: deposit_chain_id };

        if need_screening {
            assert(child.is_some(), "Child note required for screening");
            let child_confirmed = scope.authenticate(header, child.unwrap_unchecked());
            let cn = child_confirmed.note;
            assert((cn.sequence == screened_sequence + 1) & (cn.sequence <= historical_head_sequence), "C02 child sequence");
            assert(cn.previous_link == dep_note.screened_link, "C02 child previous link");
            let child_inner_hash = cn.compute_note_hash(child_confirmed.owner,
                child_confirmed.storage_slot, child_confirmed.randomness);
            let child_link = post_link(addr, sender, deposit_chain_id, cn.sequence, child_inner_hash, link_secret);
            let child_is_head = cn.sequence == historical_head_sequence;
            assert((child_link == historical_head_link) == child_is_head, "C02 child head");
            let child_mature = if cn.is_dummy { true } else {
                let exists_slot = storage.post_exists.at(cn.post_id).get_storage_slot();
                assert(public_storage_historical_read(header, exists_slot, addr) == 1, "Post not publicly included");
                let time_slot = storage.post_time.at(cn.post_id).get_storage_slot();
                let deadline_slot = storage.post_flag_deadline.at(cn.post_id).get_storage_slot();
                let published_field = public_storage_historical_read(header, time_slot, addr);
                let deadline_field = public_storage_historical_read(header, deadline_slot, addr);
                let published = published_field as u64;
                let deadline = deadline_field as u64;
                assert((published as Field == published_field) & (deadline as Field == deadline_field), "Invalid post deadline");
                assert((published >= cn.anchor_timestamp) & (published <= now), "Invalid publication timestamp");
                assert(deadline == checked_time_add(published, censor_window), "Invalid post deadline");
                now >= deadline
            };

            if child_is_head {
                assert(grandchild.is_none(), "C02 unexpected grandchild");
            } else if child_mature {
                assert(grandchild.is_some(), "Grandchild note required for screening");
            }
            if child_mature {
                if !cn.is_dummy {
                    let flag_slot = storage.post_flagged.at(cn.post_id).get_storage_slot();
                    if public_storage_historical_read(header, flag_slot, addr) == 3 { flag_count += 1; }
                }
                new_screened_link = child_link;
                new_screened_sequence = cn.sequence;
            }
            // Even a currently unusable supplied successor must be authentic and consecutive.
            if grandchild.is_some() {
                let gc_confirmed = scope.authenticate(header, grandchild.unwrap_unchecked());
                let gn = gc_confirmed.note;
                assert((gn.sequence == cn.sequence + 1) & (gn.sequence <= historical_head_sequence), "C02 grandchild sequence");
                assert(gn.previous_link == child_link, "C02 grandchild previous link");
                assert(gn.anchor_timestamp >= cn.anchor_timestamp, "C02 reversed timestamps");
                let gc_inner_hash = gn.compute_note_hash(gc_confirmed.owner,
                    gc_confirmed.storage_slot, gc_confirmed.randomness);
                let gc_link = post_link(addr, sender, deposit_chain_id, gn.sequence, gc_inner_hash, link_secret);
                assert((gc_link == historical_head_link) == (gn.sequence == historical_head_sequence), "C02 grandchild head");
                let gc_mature = if gn.is_dummy { true } else {
                    let exists_slot = storage.post_exists.at(gn.post_id).get_storage_slot();
                    assert(public_storage_historical_read(header, exists_slot, addr) == 1, "Post not publicly included");
                    let time_slot = storage.post_time.at(gn.post_id).get_storage_slot();
                    let deadline_slot = storage.post_flag_deadline.at(gn.post_id).get_storage_slot();
                    let published_field = public_storage_historical_read(header, time_slot, addr);
                    let deadline_field = public_storage_historical_read(header, deadline_slot, addr);
                    let published = published_field as u64;
                    let deadline = deadline_field as u64;
                    assert((published as Field == published_field) & (deadline as Field == deadline_field), "Invalid post deadline");
                    assert((published >= gn.anchor_timestamp) & (published <= now), "Invalid publication timestamp");
                    assert(deadline == checked_time_add(published, censor_window), "Invalid post deadline");
                    now >= deadline
                };
                if child_mature & gc_mature {
                    if !gn.is_dummy {
                        let flag_slot = storage.post_flagged.at(gn.post_id).get_storage_slot();
                        if public_storage_historical_read(header, flag_slot, addr) == 3 { flag_count += 1; }
                    }
                    new_screened_link = gc_link;
                    new_screened_sequence = gn.sequence;
                }
            }
        } else {
            assert(child.is_none() & grandchild.is_none(), "C02 unexpected hints");
        }

        let new_next_allowed = crate::admission::compute_next_allowed(now, dep_note.next_allowed_time,
            cooldown, k, max_save_up, flag_count);

        // No public count read or reservation: unrelated authors may publish
        // between this private anchor and the eventual public inclusion.

        // --- Create the new PostNote and compute its link ---
        assert(dep_note.sequences.head_sequence < 0xffffffffffffffff, "Post sequence overflow");
        let sequence = dep_note.sequences.head_sequence + 1;
        if !is_dummy {
            config.assert_recovery_horizon(now, new_next_allowed, cooldown, sequence - new_screened_sequence, sequence);
        }
        let post_note = PostNote { schema_version: 1, deposit_chain_id, sequence,
            post_id: public_post_id, anchor_timestamp: now,
            previous_link: dep_note.head_link, is_dummy };

        let post_msg = storage.posts.at(sender).insert(post_note);
        let new_note = post_msg.get_new_note();
        let inner_hash = post_note.compute_note_hash(
            new_note.owner,
            new_note.storage_slot,
            new_note.randomness,
        );
        let new_link = post_link(context.this_address(), sender, deposit_chain_id, sequence, inner_hash, link_secret);
        assert(new_link != SENTINEL, "C02 invalid new head");

        deliver_note(context, new_note);

        // --- Update last_real_sequence (only for non-dummy posts) ---
        let new_last_real = if is_dummy {
            dep_note.sequences.last_real_sequence
        } else {
            sequence
        };

        // --- Re-insert deposit note with updated state ---
        let new_deposit = DepositNote {
            deposit_chain_id,
            sequences: SequenceState { head_sequence: sequence, screened_sequence: new_screened_sequence,
                last_real_sequence: new_last_real },
            amount: dep_note.amount,
            l1_depositor: dep_note.l1_depositor,
            deposit_id: dep_note.deposit_id,
            head_link: new_link,
            screened_link: new_screened_link,
            next_allowed_time: new_next_allowed,
        };
        new_deposit
        }
    }
    #[external("private")]
    fn withdraw(deposit_chain_id: Field) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let portal = self.storage.portal_address.read();
        portal.validate();
        assert(portal.to_field() != 0, "Zero portal");
        let options = NoteGetterOptions::<DepositNote, 8, Field, Field>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found");
        let deposit = notes.get_unchecked(0);
        assert((deposit.deposit_chain_id == deposit_chain_id) & (deposit_chain_id != 0), "Invalid deposit identity");
        assert((deposit.amount >= config.min_deposit) & (deposit.amount <= config.max_deposit), "Invalid deposit receipt");
        deposit.l1_depositor.validate();
        assert(deposit.l1_depositor.to_field() != 0, "Zero depositor");
        assert(deposit.sequences.screened_sequence >= deposit.sequences.last_real_sequence, "Too early to withdraw -- not all posts screened");
        assert(now >= deposit.next_allowed_time, "Too early to withdraw -- time lock not expired");
        let content = get_withdraw_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, deposit.l1_depositor, deposit.amount, deposit.deposit_id);
        self.context.message_portal(portal, content);
    }

    /// Local wallet discovery only. Pagination is explicit; private spends select an exact ID.
    #[external("utility")]
    unconstrained fn get_deposit_ids(owner: AztecAddress, page_offset: u32) -> pub [Field; 10] {
        let options = NoteViewerOptions::<DepositNote, 8>::new().set_limit(10).set_offset(page_offset);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        let mut ids = [0; 10];
        for i in 0..10 { if i < notes.len() { ids[i] = notes.get_unchecked(i).deposit_chain_id; } }
        ids
    }

    /// Deposit fields followed by the exact Ethereum deposit commitment.
    #[external("utility")]
    unconstrained fn get_deposit_info(owner: AztecAddress, deposit_chain_id: Field) -> pub [Field; 11] {
        let options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        if notes.len() == 0 { [0; 11] } else { notes.get_unchecked(0).logical_fields() }
    }

    /// Private-wallet discovery for a bounded thread. No public query receives
    /// the owner/deposit. All returned hints remain untrusted proof inputs.
    #[external("utility")]
    unconstrained fn get_thread_screen_hints(owner: AztecAddress, deposit_chain_id: Field,
        count: u32) -> pub [Option<HintedNote<PostNote>>; 8] {
        let options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(2);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        assert(notes.len() > 0, "BB_HISTORY_DEPOSIT_MISSING");
        assert(notes.len() == 1, "BB_HISTORY_DEPOSIT_AMBIGUOUS");
        let scope = ScreeningScope { board: self.address, owner,
            slot: self.storage.posts.at(owner).storage_slot, chain: deposit_chain_id };
        scope.thread_history(notes.get_unchecked(0), count)
    }

    /// timestamp is the caller's authenticated native anchor, not browser time.
    /// This predicts readiness only; the private entrypoint authenticates history
    /// and applies the original cooldown, penalties and recovery bounds again.
    #[external("utility")]
    unconstrained fn get_thread_ready_time(owner: AztecAddress, deposit_chain_id: Field,
        count: u32, timestamp: u64) -> pub u64 {
        let options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(2);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        assert(notes.len() > 0, "BB_HISTORY_DEPOSIT_MISSING");
        assert(notes.len() == 1, "BB_HISTORY_DEPOSIT_AMBIGUOUS");
        let deposit = notes.get_unchecked(0);
        let scope = ScreeningScope { board: self.address, owner,
            slot: self.storage.posts.at(owner).storage_slot, chain: deposit_chain_id };
        let history = scope.thread_history(deposit, count);
        let config = self.storage.config.read();
        let cooldown = compute_cooldown(deposit.amount, config.base_cooldown as u64, config.min_deposit);
        let mut deadlines: [u64; 8] = [0; 8];
        let mut penalized = [false; 8];
        let mut length: u32 = 0;
        for i in 0..8 {
            if history[i].is_some() {
                let note = history[i].unwrap_unchecked().note;
                if !note.is_dummy {
                    assert(self.storage.post_exists.at(note.post_id).read(), "Post not publicly included");
                    let published = self.storage.post_time.at(note.post_id).read();
                    deadlines[i] = self.storage.post_flag_deadline.at(note.post_id).read();
                    assert(deadlines[i] == checked_time_add(published, config.censor_window as u64), "Invalid post deadline");
                    penalized[i] = self.storage.post_flagged.at(note.post_id).read() == 3;
                }
                length += 1;
            }
        }
        crate::admission::thread_ready_time(timestamp, deposit.next_allowed_time, cooldown,
            config.k_multiplier as u64, config.max_save_up as u64, count, length, deadlines, penalized)
    }

    /// Returns exact child/grandchild hints for the selected live deposit.
    /// These utility results remain untrusted: post() authenticates inclusion,
    /// ownership, deposit identity, sequence and links in its private proof.
    /// Missing or ambiguous wallet history is explicit instead of silently returning no hints.
    #[external("utility")]
    unconstrained fn get_screen_hints(
        owner: AztecAddress, deposit_chain_id: Field,
    ) -> pub (Option<HintedNote<PostNote>>, Option<HintedNote<PostNote>>) {
        let dep_options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(2);
        let dep_notes = self.storage.deposits.at(owner).view_notes(dep_options);
        assert(dep_notes.len() > 0, "BB_HISTORY_DEPOSIT_MISSING");
        assert(dep_notes.len() == 1, "BB_HISTORY_DEPOSIT_AMBIGUOUS");
        let deposit = dep_notes.get_unchecked(0);
        let head_sequence = deposit.sequences.head_sequence;
        let screened_sequence = deposit.sequences.screened_sequence;
        assert(deposit_chain_id != 0, "BB_HISTORY_DEPOSIT_INVALID");
        assert(screened_sequence <= head_sequence, "BB_HISTORY_STALE");
        assert(deposit.sequences.last_real_sequence <= head_sequence, "BB_HISTORY_STALE");
        assert((head_sequence == 0) == (deposit.head_link == SENTINEL), "BB_HISTORY_STALE");
        assert((screened_sequence == 0) == (deposit.screened_link == SENTINEL), "BB_HISTORY_STALE");
        assert((screened_sequence == head_sequence) == (deposit.screened_link == deposit.head_link),
            "BB_HISTORY_STALE");

        let mut child = Option::none();
        let mut grandchild = Option::none();
        if screened_sequence < head_sequence {
            let maybe_pk = try_get_public_keys(owner);
            assert(maybe_pk.is_some(), "BB_HISTORY_KEYS_MISSING");
            let link_secret = get_nhk_app(maybe_pk.unwrap_unchecked().npk_m_hash);
            let scope = ScreeningScope { board: self.address, owner,
                slot: self.storage.posts.at(owner).storage_slot, chain: deposit_chain_id };
            let cn = scope.get_screen_successor(deposit.screened_link, true);
            assert(cn.note.sequence == screened_sequence + 1, "BB_HISTORY_STALE");
            let child_hash = cn.note.compute_note_hash(cn.owner, cn.storage_slot, cn.randomness);
            let child_link = post_link(self.address, owner, deposit_chain_id, cn.note.sequence, child_hash, link_secret);
            let child_is_head = cn.note.sequence == head_sequence;
            assert((child_link == deposit.head_link) == child_is_head, "BB_HISTORY_STALE");
            child = Option::some(cn);
            if !child_is_head {
                let gn = scope.get_screen_successor(child_link, false);
                assert(gn.note.sequence == cn.note.sequence + 1, "BB_HISTORY_STALE");
                assert(gn.note.anchor_timestamp >= cn.note.anchor_timestamp, "BB_HISTORY_STALE");
                let grandchild_hash = gn.note.compute_note_hash(gn.owner, gn.storage_slot, gn.randomness);
                let grandchild_link = post_link(self.address, owner, deposit_chain_id, gn.note.sequence, grandchild_hash, link_secret);
                assert((grandchild_link == deposit.head_link) == (gn.note.sequence == head_sequence),
                    "BB_HISTORY_STALE");
                grandchild = Option::some(gn);
            }
        }
        (child, grandchild)
    }


    #[derive(Deserialize, Serialize, Eq, Packable)]
    pub struct TipKey { pub x: Field, pub y: Field }
    #[event]
    struct PostTipKey { schema: u32, post: Field, key: TipKey }

    #[internal("private")]
    fn _post_tip_key(id: Field) -> TipKey {
        let root = self.context.request_nhk_app(get_public_keys(self.msg_sender()).npk_m_hash);
        let secret = private_credit::post_secret(root, self.context.chain_id(), self.context.version(), self.address, id);
        let key = private_credit::spending_key(secret);
        TipKey { x: key.x, y: key.y }
    }
    /// The plugin's authenticated private entrypoint calls this in the same
    /// transaction. Kernel key validation proves the operator's Board-scoped
    /// NHK; no public operator key or spending secret is returned.
    #[external("private")]
    fn derive_plugin_tip_key(operator: AztecAddress, request: Field) -> [Field; 2] {
        let id = bot_reply_id(self.address, self.msg_sender(), request);
        let root = self.context.request_nhk_app(get_public_keys(operator).npk_m_hash);
        let secret = private_credit::post_secret(root, self.context.chain_id(), self.context.version(), self.address, id);
        let key = private_credit::spending_key(secret);
        [key.x, key.y]
    }
    #[external("utility")]
    unconstrained fn tip_root(owner: AztecAddress) -> pub Field {
        get_nhk_app(get_public_keys(owner).npk_m_hash)
    }
    #[external("public")]
    #[view]
    fn get_tip_key_hash(post: Field) -> pub Field { self.storage.tip_key_hashes.at(post).read() }

    #[event]
    struct PostPublished {
        schema: u32, id: Field, record: PostRecord, timestamp: u64,
        main_policy_version: u32, local_policy_version: u32,
        length: u16, message: [Field; 32],
    }
    #[event]
    struct PostRemoved {
        schema: u32, id: Field, policy_version: Field, penalized: bool,
        reason_length: u16, reason: [Field; 7],
    }
    #[event]
    struct PluginConfigured { schema: u32, plugin_id: Field, adapter: AztecAddress, enabled: bool }
    #[event]
    struct PluginInvoked { schema: u32, plugin_id: Field, post_id: Field, request_id: Field, target: Field }

    #[external("private")]
    fn post(deposit_chain_id: Field, nonce: Field, draft: PostDraft,
        child: Option<HintedNote<PostNote>>, grandchild: Option<HintedNote<PostNote>>) {
        validate_draft(draft, nonce);
        if draft.name_id != 0 { self.internal._assert_name_owner(draft.name_id); }
        let id = post_id(self.address, nonce);
        Admission::consume(self.context, self.storage, deposit_chain_id, id, false, child, grandchild);
        let key = self.internal._post_tip_key(id);
        self.enqueue_self._publish(nonce, draft, 0, 0, key);
    }

    /// One fee, one deposit spend, and one atomic ordered publication. The
    /// prefix contains only pre-transaction history; private proofs authenticate
    /// every consumed hint exactly as ordinary posting does.
    #[external("private")]
    fn post_thread(deposit_chain_id: Field, nonces: [Field; 4], drafts: [PostDraft; 4],
        count: u32, history: [Option<HintedNote<PostNote>>; 8],
        plugin_ids: [Field; 4], request_ids: [Field; 4]) {
        let ids = crate::posting::validate_thread(self.address, nonces, drafts, count, plugin_ids, request_ids);
        if drafts[0].name_id != 0 { self.internal._assert_name_owner(drafts[0].name_id); }
        let original = Admission::pop(self.context, self.storage, deposit_chain_id);
        let mut deposit = original;
        for i in 0..4 {
            if i < count {
                let mut child = Option::none();
                let mut grandchild = Option::none();
                if deposit.sequences.screened_sequence < original.sequences.head_sequence {
                    let cursor = (deposit.sequences.screened_sequence - original.sequences.screened_sequence) as u32;
                    assert(cursor < 8, "Thread history exhausted");
                    child = history[cursor];
                    if deposit.sequences.screened_sequence + 1 < original.sequences.head_sequence {
                        assert(cursor + 1 < 8, "Thread history exhausted");
                        grandchild = history[cursor + 1];
                    }
                }
                deposit = Admission::advance(self.context, self.storage, deposit,
                    original.sequences.head_sequence, original.head_link, ids[i], false, child, grandchild);
                let key = self.internal._post_tip_key(ids[i]);
                self.enqueue_self._publish(nonces[i], drafts[i], plugin_ids[i], request_ids[i], key);
            }
        }
        Admission::save(self.context, self.storage, deposit);
    }

    #[external("private")]
    fn post_with_bok(deposit_chain_id: Field, nonce: Field, draft: PostDraft,
        child: Option<HintedNote<PostNote>>, grandchild: Option<HintedNote<PostNote>>,
        plugin_id: Field, request_id: Field) {
        assert((plugin_id != 0) & (request_id != 0), "Invocation identity required");
        validate_draft(draft, nonce);
        if draft.name_id != 0 { self.internal._assert_name_owner(draft.name_id); }
        let id = post_id(self.address, nonce);
        Admission::consume(self.context, self.storage, deposit_chain_id, id, false, child, grandchild);
        let key = self.internal._post_tip_key(id);
        self.enqueue_self._publish(nonce, draft, plugin_id, request_id, key);
    }

    /// Recovery advances the same authenticated history without public content.
    #[external("private")]
    fn screen(deposit_chain_id: Field, child: Option<HintedNote<PostNote>>,
        grandchild: Option<HintedNote<PostNote>>) {
        Admission::consume(self.context, self.storage, deposit_chain_id, 0, true, child, grandchild);
    }

    #[external("public")]
    #[only_self]
    fn _publish(nonce: Field, draft: PostDraft, plugin_id: Field, request_id: Field, key: TipKey) {
        validate_draft(draft, nonce);
        assert((plugin_id == 0) == (request_id == 0), "Invalid invocation identity");
        let id = post_id(self.address, nonce);
        assert(id != 0, "Zero post identity");
        assert(!self.storage.post_exists.at(id).read(), "Post already exists");
        let local_version: u32 = if draft.subboard == 0 { 0 } else { 1 };
        if draft.subboard != 0 {
            assert(self.storage.subboards.at(draft.subboard).read().exists, "Unknown subboard");
            assert(!self.storage.subboards.at(draft.subboard).read().rejected, "Subboard rejected");
        }
        let main_version = self.storage.main_version.read();
        assert(main_version == draft.expected_main_policy_version, "Main policy changed");
        assert(local_version == draft.expected_local_policy_version, "Local policy changed");
        if draft.name_id != 0 { assert(self.storage.registered_names.at(draft.name_id).read(), "Unknown name"); }
        let mut root = id;
        if draft.parent != 0 {
            assert(self.storage.post_exists.at(draft.parent).read(), "Unknown parent");
            assert(self.storage.post_flagged.at(draft.parent).read() == 0, "Parent removed");
            let parent = self.storage.post_records.at(draft.parent).read();
            assert(parent.subboard == draft.subboard, "Cross-board reply");
            assert(parent.root == draft.root_reference, "Wrong canonical root");
            root = parent.root;
        }
        if draft.reference != 0 {
            assert(self.storage.post_exists.at(draft.reference).read(), "Unknown referenced post");
            assert(self.storage.post_flagged.at(draft.reference).read() == 0, "Referenced post removed");
        }
        let record = PostRecord { subboard: draft.subboard, parent: draft.parent, root,
            kind: draft.kind, name_id: draft.name_id, reference: draft.reference,
            content_digest: text_hash(draft.message, draft.length) };
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let now = self.context.timestamp();
        let count = self.storage.post_count.read();
        self.storage.post_count.write(count + 1);
        self.storage.post_id_by_order.at(count).write(id);
        self.storage.post_records.at(id).write(record);
        self.storage.post_exists.at(id).write(true);
        self.storage.tip_key_hashes.at(id).write(private_credit::tip_key_hash(
            aztec::protocol::point::EmbeddedCurvePoint { x: key.x, y: key.y }));
        self.emit(PostTipKey { schema: 1, post: id, key });
        self.storage.post_time.at(id).write(now);
        self.storage.post_flag_deadline.at(id).write(checked_time_add(now, config.censor_window as u64));
        self.storage.post_policy_version.at(id).write(crate::posting::policy_identity(main_version, local_version));
        self.emit(PostPublished { schema: 1, id, record, timestamp: now,
            main_policy_version: main_version, local_policy_version: local_version,
            length: draft.length, message: draft.message });
        if plugin_id != 0 {
            let plugin = self.storage.plugins.at(plugin_id).read();
            assert(plugin.enabled & (plugin.adapter.to_field() != 0), "Plugin disabled");
            let target = invocation_target(self.context.chain_id(), self.context.version(), self.address, plugin.adapter, nonce, draft);
            let saved = InvocationState::entry(self.context, self.storage.invocation_state.slot, plugin.adapter, request_id);
            assert(saved.read().parent == 0, "Invocation already activated");
            let selector = comptime { aztec::protocol::abis::function_selector::FunctionSelector::from_signature("on_invocation(Field,Field)") };
            let _ = self.context.call_public_function(plugin.adapter, selector, [request_id, target], aztec::context::gas::GasOpts::default());
            saved.write(InvocationRecord { plugin_id, adapter: plugin.adapter, parent: id, target, replied: false });
            self.emit(PluginInvoked { schema: 1, plugin_id, post_id: id, request_id, target });
        }
    }

    // One slot in Storage, with public-only map construction: no additional
    // Map<PrivateContext> type expansion in private admission/name circuits.
    struct InvocationStorageRoot { slot: Field }
    impl<Context> StateVariable<1, Context> for InvocationStorageRoot {
        fn new(_context: Context, storage_slot: Field) -> Self {
            assert(storage_slot != 0, "Zero invocation storage root");
            Self { slot: storage_slot }
        }
        fn get_storage_slot(self) -> Field { self.slot }
    }
    struct InvocationState {}
    impl InvocationState {
        unconstrained fn entry(context: aztec::context::PublicContext, slot: Field, adapter: AztecAddress, request: Field)
            -> PublicMutable<InvocationRecord, aztec::context::PublicContext> {
            Map::<Field, PublicMutable<InvocationRecord, aztec::context::PublicContext>, aztec::context::PublicContext>::new(context, slot)
                .at(invocation_key(adapter, request))
        }
    }
    #[event]
    struct PluginReplyPublished {
        schema: u32, plugin_id: Field, request_id: Field, post_id: Field, parent_id: Field, target: Field,
    }

    /// Only the activated adapter may publish. Its operator identity is public;
    /// no human name ownership or collateral history is exposed by this path.
    #[external("public")]
    fn publish_plugin_reply(request_id: Field, plugin_id: Field, message: [Field; 32], length: u16,
        expected_main_version: u32, expected_local_version: u32, tip_x: Field, tip_y: Field) {
        private_credit::validate_key(aztec::protocol::point::EmbeddedCurvePoint { x: tip_x, y: tip_y });
        let key = TipKey { x: tip_x, y: tip_y };
        let adapter = self.msg_sender();
        let plugin = self.storage.plugins.at(plugin_id).read();
        assert(plugin.enabled & (plugin.adapter == adapter), "Only enabled plugin adapter");
        let slot = InvocationState::entry(self.context, self.storage.invocation_state.slot, adapter, request_id);
        let mut invocation = slot.read();
        assert((invocation.parent != 0) & (invocation.adapter == adapter) & (invocation.plugin_id == plugin_id), "Unknown activated invocation");
        assert(!invocation.replied, "Already replied");
        validate_text(message, length, true);
        let parent_id = invocation.parent;
        assert(self.storage.post_exists.at(parent_id).read(), "Unknown parent");
        assert(self.storage.post_flagged.at(parent_id).read() == 0, "Parent removed");
        let parent = self.storage.post_records.at(parent_id).read();
        if parent.subboard != 0 {
            let subboard = self.storage.subboards.at(parent.subboard).read();
            assert(subboard.exists & !subboard.rejected, "Subboard rejected");
        }
        let main_version = self.storage.main_version.read();
        let local_version: u32 = if parent.subboard == 0 { 0 } else { 1 };
        assert((main_version == expected_main_version) & (local_version == expected_local_version), "Policy changed");
        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let id = bot_reply_id(self.address, adapter, request_id);
        assert(id != 0, "Zero post identity");
        assert(!self.storage.post_exists.at(id).read(), "Post already exists");
        let record = PostRecord { subboard: parent.subboard, parent: parent_id, root: parent.root,
            kind: 4, name_id: 0, reference: 0, content_digest: text_hash(message, length) };
        let now = self.context.timestamp();
        let count = self.storage.post_count.read();
        invocation.replied = true; slot.write(invocation);
        self.storage.post_count.write(count + 1);
        self.storage.post_id_by_order.at(count).write(id);
        self.storage.post_records.at(id).write(record);
        self.storage.post_exists.at(id).write(true);
        self.storage.tip_key_hashes.at(id).write(private_credit::tip_key_hash(
            aztec::protocol::point::EmbeddedCurvePoint { x: key.x, y: key.y }));
        self.emit(PostTipKey { schema: 1, post: id, key });
        self.storage.post_time.at(id).write(now);
        self.storage.post_flag_deadline.at(id).write(checked_time_add(now, config.censor_window as u64));
        self.storage.post_policy_version.at(id).write(crate::posting::policy_identity(main_version, local_version));
        self.emit(PostPublished { schema: 1, id, record, timestamp: now, main_policy_version: main_version,
            local_policy_version: local_version, length, message });
        self.emit(PluginReplyPublished { schema: 1, plugin_id, request_id, post_id: id, parent_id, target: invocation.target });
    }

    #[external("public")]
    fn configure_plugin(plugin_id: Field, adapter: AztecAddress, enabled: bool) {
        assert(self.msg_sender() == self.storage.moderator.read(), "Only moderator");
        assert((plugin_id != 0) & (adapter.to_field() != 0), "Plugin identity required");
        let previous = self.storage.plugins.at(plugin_id).read();
        assert((previous.adapter.to_field() == 0) | (previous.adapter == adapter), "Plugin adapter immutable");
        self.storage.plugins.at(plugin_id).write(PluginRecord { adapter, enabled });
        self.emit(PluginConfigured { schema: 1, plugin_id, adapter, enabled });
    }

    #[external("public")]
    fn remove_post(id: Field, expected_main_version: u32, expected_local_version: u32,
        reason: [Field; 7], length: u16) {
        assert(self.msg_sender() == self.storage.moderator.read(), "Only moderator");
        assert(self.storage.post_exists.at(id).read(), "Unknown post");
        assert(self.storage.post_flagged.at(id).read() == 0, "Already removed");
        validate_text(reason, length, true);
        let post = self.storage.post_records.at(id).read();
        let local_version: u32 = if post.subboard == 0 { 0 } else { 1 };
        let main_version = self.storage.main_version.read();
        assert((main_version == expected_main_version) & (local_version == expected_local_version), "Policy changed");
        let version = crate::posting::policy_identity(main_version, local_version);
        let penalized = (self.context.timestamp() < self.storage.post_flag_deadline.at(id).read())
            & (version == self.storage.post_policy_version.at(id).read());
        self.storage.post_flagged.at(id).write(if penalized { 3 } else { 1 });
        self.storage.post_reason.at(id).write(text_hash(reason, length));
        self.emit(PostRemoved { schema: 1, id, policy_version: version, penalized, reason_length: length, reason });
    }

    #[external("public")]
    #[view]
    fn get_post(id: Field) -> pub (bool, PostRecord, u8, u64, Field) {
        (self.storage.post_exists.at(id).read(), self.storage.post_records.at(id).read(),
            self.storage.post_flagged.at(id).read(), self.storage.post_time.at(id).read(), self.storage.post_reason.at(id).read())
    }
    #[external("public")]
    #[view]
    fn get_post_count() -> pub u64 { self.storage.post_count.read() }
    #[external("public")]
    #[view]
    fn get_post_id(order: u64) -> pub Field { self.storage.post_id_by_order.at(order).read() }
    #[external("public")]
    #[view]
    fn get_plugin(plugin_id: Field) -> pub PluginRecord { self.storage.plugins.at(plugin_id).read() }
    #[external("public")]
    #[view]
    fn get_config_hash() -> pub Field { self.storage.config.read().hash(self.address) }


    // Same public-only slot-root pattern as Billboard PluginStorageRoot. A root
    // occupies one macro-assigned slot without copying a private Context type.
    struct LikeStorageRoot { slot: Field }
    impl<Context> StateVariable<1, Context> for LikeStorageRoot {
        fn new(_context: Context, storage_slot: Field) -> Self {
            assert(storage_slot != 0, "Zero like storage root");
            Self { slot: storage_slot }
        }
        fn get_storage_slot(self) -> Field { self.slot }
    }
    struct LikeState {}
    impl LikeState {
        unconstrained fn count(context: aztec::context::PublicContext, slot: Field, post: Field) -> PublicMutable<u64, aztec::context::PublicContext> {
            Map::<Field, PublicMutable<u64, aztec::context::PublicContext>, aztec::context::PublicContext>::new(context, slot)
                .at(crate::posting::like_storage_key(1, post, 0))
        }
        unconstrained fn active(context: aztec::context::PublicContext, slot: Field, post: Field, tag: Field) -> PublicMutable<bool, aztec::context::PublicContext> {
            Map::<Field, PublicMutable<bool, aztec::context::PublicContext>, aztec::context::PublicContext>::new(context, slot)
                .at(crate::posting::like_storage_key(2, post, tag))
        }
    }

    #[event]
    struct LikeChanged { schema: u32, post: Field, tag: Field, active: bool, count: u64 }

    /// Only the configured backed FPC can record the transfer. The callback
    /// checks the key committed by the author's private post creation.
    #[external("public")]
    fn record_paid_like(post: Field, key: TipKey, tag: Field) {
        assert(self.msg_sender() == self.storage.private_fee.read(), "Only private fee contract");
        assert(self.storage.post_exists.at(post).read(), "Unknown post");
        assert(self.storage.post_flagged.at(post).read() == 0, "Post removed");
        assert(self.storage.tip_key_hashes.at(post).read() == private_credit::tip_key_hash(
            aztec::protocol::point::EmbeddedCurvePoint { x: key.x, y: key.y }), "Wrong post tip key");
        assert(tag != 0, "Zero like tag");
        let old_count = LikeState::count(self.context, self.storage.like_state.slot, post).read();
        assert(old_count < 0xffffffffffffffff, "Like count overflow");
        let count = old_count + 1;
        LikeState::active(self.context, self.storage.like_state.slot, post, tag).write(true);
        LikeState::count(self.context, self.storage.like_state.slot, post).write(count);
        self.emit(LikeChanged { schema: 1, post, tag, active: true, count });
    }
    #[external("public")]
    #[view]
    fn get_like_count(post: Field) -> pub u64 { LikeState::count(self.context, self.storage.like_state.slot, post).read() }
}
