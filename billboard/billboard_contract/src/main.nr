pub mod lib;

use aztec::macros::aztec;

#[aztec]
pub contract Billboard {
    use crate::lib::{ReceiptMetadata, SequenceState, compute_cooldown, checked_time_add, deposit_chain_id, post_id, post_link, get_ready_msg_hash, get_deposit_msg_hash, get_withdraw_msg_hash};

    use aztec::{
        history::{note::assert_note_existed_by, storage::public_storage_historical_read},
        keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},
        macros::{
            functions::{external, initializer, only_self, view},
            notes::note,
            storage::storage,
        },
        messages::delivery::MessageDelivery,
        note::{
            note_getter_options::{NoteGetterOptions, NoteStatus},
            note_viewer_options::NoteViewerOptions,
            note_interface::{NoteHash, NoteProperties},
            HintedNote,
            ConfirmedNote,
            NoteMessage,
        },
        protocol::{
            address::{AztecAddress, EthAddress},
            abis::block_header::BlockHeader,
                        traits::{Deserialize, FromField, Packable, Serialize, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable, StateVariable},
    };

    use aztec::utils::comparison::Comparator;

    // ============================================================
    // Constants
    // ============================================================
    global MSG_FIELDS: u32 = 32;
    global SENTINEL: Field = 0;

    /// Maximum moderation policy size in bytes.
    /// Limited by the per-transaction public data write cap (64 writes):
    /// init() uses 10 writes for config + POLICY_FIELDS for policy, plus
    /// deployment overhead, so we keep well under the limit.
    global MAX_POLICY_BYTES: u32 = 1488;
    /// Number of Field elements needed to store MAX_POLICY_BYTES.
    /// ceil(1488 / 31) = 48 (48 * 31 = 1488).
    global POLICY_FIELDS: u32 = 48;

    /// Maximum number of PostNotes to fetch in utility functions.
    /// Used by get_screen_hints to search for child/grandchild.
    global MAX_HINT_NOTES: u32 = 16;

    // ============================================================
    // Note type: PostNote — append-only chain anchor
    // ============================================================
    // PostNotes are NEVER nullified. They persist in the note hash tree as
    // historical anchors that can be proven to exist via assert_note_existed_by.
    // Each PostNote links to the previous one via prev_link, forming a chain.
    //
    // link = H(inner_note_hash, link_secret)
    //   inner_note_hash = note.compute_note_hash(owner, storage_slot, randomness)
    //   link_secret = request_nhk_app(owner_npk_m_hash)  (app-siloed nullifier hiding key)
    // Only the owner can produce valid links (they know link_secret).
    // An attacker who inserts a decoy PostNote into the victim's PrivateSet
    // cannot forge the link because they don't know link_secret, and the
    // link binds to the specific note's hash (which includes random randomness).
    //
    // is_dummy: dummy posts advance the chain and screen normally, but don't
    // store message content and don't update last_real_sequence. Used for
    // withdrawal (make dummy posts until screening catches up).
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
        pub receipt: ReceiptMetadata,
        pub deposit_chain_id: Field,
        pub amount: u128,
        pub l1_depositor: EthAddress,
        pub head_link: Field,
        pub screened_link: Field,
        pub sequences: SequenceState,
        pub next_allowed_time: u64,
    }

    impl DepositNote {
        fn logical_fields(self) -> [Field; 11] {
            [self.receipt.schema_version as Field, self.deposit_chain_id, self.receipt.deposit_nonce as Field,
                self.amount as Field, self.l1_depositor.to_field(), self.head_link,
                self.sequences.head_sequence as Field, self.screened_link, self.sequences.screened_sequence as Field,
                self.sequences.last_real_sequence as Field, self.next_allowed_time as Field]
        }
    }

    #[derive(Eq, Packable)]
    pub struct Config {
        pub l1_chain_id: u64,
        pub rollup_address: EthAddress,
        pub rollup_version: u32,
        pub min_deposit: u128,
        pub max_deposit: u128,
        pub base_cooldown: u32,
        pub k_multiplier: u16,
        pub censor_window: u32,
        pub max_save_up: u16,
        pub deployer: AztecAddress,
    }

    impl Config {
        fn hash(self, board: AztecAddress) -> Field {
            crate::lib::get_config_hash(self.l1_chain_id, self.rollup_address, board, self.rollup_version,
                self.min_deposit, self.max_deposit, self.base_cooldown, self.k_multiplier,
                self.censor_window, self.max_save_up)
        }
        fn validate(self, chain: Field, version: Field) {
            self.rollup_address.validate();
            assert(self.rollup_address.to_field() != 0, "Zero rollup");
            assert(self.deployer.to_field() != 0, "Zero deployer");
            assert(self.l1_chain_id > 0, "Zero chain");
            assert(self.rollup_version > 0, "Zero rollup version");
            assert(chain == self.l1_chain_id as Field, "Wrong chain");
            assert(version == self.rollup_version as Field, "Wrong rollup version");
            assert(self.min_deposit > 0, "Min deposit must be > 0");
            assert((self.max_deposit >= self.min_deposit) & (self.max_deposit <= 0xffffffffffffffffffffffff), "Invalid maximum deposit");
            assert(self.base_cooldown > 0, "Base cooldown must be > 0");
            assert(self.k_multiplier > 0, "K must be > 0");
            assert(self.censor_window > 0, "Censor window must be > 0");
            assert(self.max_save_up > 0, "Max save up must be > 0");
        }
    }

    // ============================================================
    // Storage
    // ============================================================

    #[storage]
    struct Storage<Context> {
        portal_address: PublicImmutable<EthAddress, Context>,
        config: PublicImmutable<Config, Context>,
        deposits: Owned<PrivateSet<DepositNote, Context>, Context>,
        /// Append-only post chain — one PrivateSet per account.
        /// PostNotes are never nullified; they serve as historical anchors.
        posts: Owned<PrivateSet<PostNote, Context>, Context>,
        /// Only real publication allocates a live display-order index.
        post_count: PublicMutable<u64, Context>,
        post_id_by_order: Map<u64, PublicMutable<Field, Context>, Context>,
        post_exists: Map<Field, PublicMutable<bool, Context>, Context>,
        post_length: Map<Field, PublicMutable<u16, Context>, Context>,
        post_data: Map<Field, Map<u32, PublicMutable<Field, Context>, Context>, Context>,
        censor: PublicMutable<AztecAddress, Context>,
        // Post metadata (public)
        post_time: Map<Field, PublicMutable<u64, Context>, Context>,
        post_flagged: Map<Field, PublicMutable<bool, Context>, Context>,
        /// The address of the censor who flagged each post (zero = never flagged).
        /// Public record of accountability.
        post_flagged_by: Map<Field, PublicMutable<AztecAddress, Context>, Context>,
        censor_response: Map<Field, Map<u32, PublicMutable<Field, Context>, Context>, Context>,
        /// Moderation policy: packed as [Field; POLICY_FIELDS] (31 bytes each).
        /// Set at init time, only the censor can update via set_moderation_policy.
        policy_data: Map<u32, PublicMutable<Field, Context>, Context>,
        policy_len: PublicMutable<u32, Context>,
    }

    // ============================================================
    // Initializer
    // ============================================================

    #[external("public")]
    #[initializer]
    fn init(
        l1_chain_id: u64, rollup_address: EthAddress, rollup_version: u32,
        min_deposit: u128, max_deposit: u128, base_cooldown: u32,
        censor: AztecAddress, k: u16, censor_window: u32, max_save_up: u16,
        policy: [Field; POLICY_FIELDS], policy_len: u32,
    ) {
        let config = Config { l1_chain_id, rollup_address, rollup_version, min_deposit,
            max_deposit, base_cooldown, k_multiplier: k, censor_window, max_save_up,
            deployer: self.msg_sender() };
        config.validate(self.context.chain_id(), self.context.version());
        assert(censor.to_field() != 0, "Zero censor");
        crate::lib::validate_policy(policy, policy_len);
        self.storage.config.initialize(config);
        self.storage.censor.write(censor);
        self.storage.policy_len.write(policy_len);
        for i in 0..POLICY_FIELDS { self.storage.policy_data.at(i).write(policy[i]); }
    }

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

    // ============================================================
    // transfer_censor -- censor can transfer censorship rights
    // ============================================================

    #[external("public")]
    fn transfer_censor(new_censor: AztecAddress) {
        let censor = self.storage.censor.read();
        let sender = self.msg_sender();
        assert(sender.to_field() != AztecAddress::zero().to_field(), "No censor configured");
        assert(sender.to_field() == censor.to_field(), "Only censor can transfer rights");
        assert(new_censor.to_field() != AztecAddress::zero().to_field(), "Cannot transfer to zero address");
        self.storage.censor.write(new_censor);
    }

    // ============================================================
    // set_moderation_policy -- censor only (public function)
    // ============================================================

    #[external("public")]
    fn set_moderation_policy(policy: [Field; POLICY_FIELDS], policy_len: u32) {
        let censor = self.storage.censor.read();
        let sender = self.msg_sender();
        assert(sender.to_field() != AztecAddress::zero().to_field(), "No censor configured");
        assert(sender.to_field() == censor.to_field(), "Only censor can set policy");
        crate::lib::validate_policy(policy, policy_len);
        self.storage.policy_len.write(policy_len);
        for i in 0..POLICY_FIELDS {
            self.storage.policy_data.at(i).write(policy[i]);
        }
    }

    // ============================================================
    // declare_immoral -- censor only (public function)
    // ============================================================
    // Each post is screened at most once (when last_screened advances past it).
    // C03 addresses stable identity only. Inclusion-time policy/deadline binding
    // and full moderation-window semantics remain explicit C05 integration work.

    #[external("public")]
    fn declare_immoral(post_id: Field, response: [Field; MSG_FIELDS]) {
        let censor = self.storage.censor.read();
        let sender = self.msg_sender();
        assert(sender.to_field() != AztecAddress::zero().to_field(), "No censor configured");
        assert(sender.to_field() == censor.to_field(), "Only censor can declare immoral");
        assert(self.storage.post_exists.at(post_id).read(), "Invalid post id");
        assert(!self.storage.post_flagged.at(post_id).read(), "Already flagged");

        self.storage.post_flagged.at(post_id).write(true);
        self.storage.post_flagged_by.at(post_id).write(sender);

        for i in 0..MSG_FIELDS {
            self.storage.censor_response.at(post_id).at(i).write(response[i]);
        }
    }

    // ============================================================
    // claim_deposit
    // ============================================================

    #[external("private")]
    fn claim_deposit(depositor: EthAddress, amount: u128, deposit_nonce: u64, secret: Field, message_leaf_index: Field) {
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
        assert(deposit_nonce > 0, "Zero deposit nonce");
        assert(secret != 0, "Zero claim secret");
        assert(amount >= config.min_deposit, "Deposit below minimum");
        assert(amount <= config.max_deposit, "Deposit above maximum");
        let content = get_deposit_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, depositor, deposit_nonce, amount);
        self.context.consume_l1_to_l2_message(content, [secret], portal, message_leaf_index);
        let chain = deposit_chain_id(self.address, sender, content, secret);
        assert(chain != 0, "Zero deposit identity");
        let cooldown = compute_cooldown(amount, config.base_cooldown as u64, config.min_deposit);
        let note = DepositNote { receipt: ReceiptMetadata { schema_version: 1, deposit_nonce }, deposit_chain_id: chain,
            amount, l1_depositor: depositor, head_link: 0, screened_link: 0,
            sequences: SequenceState { head_sequence: 0, screened_sequence: 0, last_real_sequence: 0 },
            next_allowed_time: checked_time_add(now, cooldown) };
        self.storage.deposits.at(sender).insert(note).deliver(MessageDelivery::onchain_constrained());
    }

    // ============================================================
    // post — constant-cost screening via child/grandchild proofs
    // ============================================================
    //
    // Instead of walking the entire chain (limited by MAX_CHAIN_DEPTH),
    // we screen 0-2 posts per call using Merkle proofs:
    //
    //   child = the post immediately after last_screened in the chain
    //   grandchild = the post immediately after child (if it exists)
    //
    // A post can only be screened if it's older than censor_window.
    // This guarantees the censor has at least censor_window to flag it.
    //
    // The new last_screened is the most recent post among (old, child, grandchild)
    // whose timestamp <= now - censor_window.
    //
    // Timing: check now >= effective_old, where
    //   effective_old = max(old_next_allowed, now - cooldown*max_save_up)
    // Then set new_next_allowed = effective_old + cooldown * (1 + (k-1) * flag_count)
    //
    // The flag penalty: each flagged post found during screening adds (k-1) extra
    // cooldowns, equivalent to making (k-1) dummy posts at the same time.
    // So screening 1 flagged post → total advance = cooldown * (1 + (k-1)) = k*cooldown,
    // i.e. equivalent to 1 real post + (k-1) dummies = k posts.
    // The save-up rule prevents bursting after dormancy.

    #[external("private")]
    fn post(
        deposit_chain_id: Field,
        post_nonce: Field,
        msg: [Field; MSG_FIELDS],
        message_length: u16,
        is_dummy: bool,
        child: Option<HintedNote<PostNote>>,
        grandchild: Option<HintedNote<PostNote>>,
    ) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();
        let header = self.context.get_anchor_block_header();
        let addr = self.context.this_address();
        let public_post_id = if is_dummy {
            assert(post_nonce == 0, "Dummy nonce must be zero");
            assert(message_length == 0, "Dummy message length must be zero");
            for field in msg { assert(field == 0, "Dummy message must be empty"); }
            0
        } else {
            assert(post_nonce != 0, "Post nonce must not be zero");
            crate::lib::validate_message(msg, message_length);
            let id = post_id(addr, post_nonce);
            assert(id != 0, "Post id must not be zero");
            id
        };

        // --- Pop the deposit note ---
        let options = NoteGetterOptions::<DepositNote, 8, Field, Field>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found -- claim a deposit first");
        let dep_note = notes.get_unchecked(0);
        assert((dep_note.receipt.schema_version == 1) & (dep_note.deposit_chain_id == deposit_chain_id) & (deposit_chain_id != 0), "Invalid deposit identity");

        let config = self.storage.config.read();
        config.validate(self.context.chain_id(), self.context.version());
        let cooldown = compute_cooldown(dep_note.amount, config.base_cooldown as u64, config.min_deposit);
        let k = config.k_multiplier as u64;
        let censor_window = config.censor_window as u64;
        let max_save_up = config.max_save_up as u64;

        // --- Get link_secret (app-siloed nullifier hiding key) ---
        let owner_npk_m_hash = get_public_keys(sender).npk_m_hash;
        let link_secret = self.context.request_nhk_app(owner_npk_m_hash);

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
        let need_screening = screened_sequence < head_sequence;
        let scope = ScreeningScope { board: addr, owner: sender,
            slot: self.storage.posts.at(sender).storage_slot, chain: deposit_chain_id };

        // Real-post public inclusion/deadline records are introduced by C03/C05.
        // This inherited real-post maturity rule is not the final public deadline guarantee.
        let screen_threshold: u64 = if now >= censor_window { now - censor_window } else { 0 };
        if need_screening {
            assert(child.is_some(), "Child note required for screening");
            let child_confirmed = scope.authenticate(header, child.unwrap_unchecked());
            let cn = child_confirmed.note;
            assert((cn.sequence == screened_sequence + 1) & (cn.sequence <= head_sequence), "C02 child sequence");
            assert(cn.previous_link == dep_note.screened_link, "C02 child previous link");
            let child_inner_hash = cn.compute_note_hash(child_confirmed.owner,
                child_confirmed.storage_slot, child_confirmed.randomness);
            let child_link = post_link(addr, sender, deposit_chain_id, cn.sequence, child_inner_hash, link_secret);
            let child_is_head = cn.sequence == head_sequence;
            assert((child_link == dep_note.head_link) == child_is_head, "C02 child head");
            let child_mature = cn.is_dummy | ((now >= censor_window) & (cn.anchor_timestamp <= screen_threshold));

            if child_is_head {
                assert(grandchild.is_none(), "C02 unexpected grandchild");
            } else if child_mature {
                assert(grandchild.is_some(), "Grandchild note required for screening");
            }
            if child_mature {
                if !cn.is_dummy {
                    let flag_slot = self.storage.post_flagged.at(cn.post_id).get_storage_slot();
                    if public_storage_historical_read(header, flag_slot, addr) == 1 { flag_count += 1; }
                }
                new_screened_link = child_link;
                new_screened_sequence = cn.sequence;
            }
            // Even a currently unusable supplied successor must be authentic and consecutive.
            if grandchild.is_some() {
                let gc_confirmed = scope.authenticate(header, grandchild.unwrap_unchecked());
                let gn = gc_confirmed.note;
                assert((gn.sequence == cn.sequence + 1) & (gn.sequence <= head_sequence), "C02 grandchild sequence");
                assert(gn.previous_link == child_link, "C02 grandchild previous link");
                assert(gn.anchor_timestamp >= cn.anchor_timestamp, "C02 reversed timestamps");
                let gc_inner_hash = gn.compute_note_hash(gc_confirmed.owner,
                    gc_confirmed.storage_slot, gc_confirmed.randomness);
                let gc_link = post_link(addr, sender, deposit_chain_id, gn.sequence, gc_inner_hash, link_secret);
                assert((gc_link == dep_note.head_link) == (gn.sequence == head_sequence), "C02 grandchild head");
                let gc_mature = gn.is_dummy | ((now >= censor_window) & (gn.anchor_timestamp <= screen_threshold));
                if child_mature & gc_mature {
                    if !gn.is_dummy {
                        let flag_slot = self.storage.post_flagged.at(gn.post_id).get_storage_slot();
                        if public_storage_historical_read(header, flag_slot, addr) == 1 { flag_count += 1; }
                    }
                    new_screened_link = gc_link;
                    new_screened_sequence = gn.sequence;
                }
            }
        } else {
            assert(child.is_none() & grandchild.is_none(), "C02 unexpected hints");
        }

        // --- Compute earliest usable time (save-up rule) ---
        // The current post is allowed if now >= old_next_allowed_time.
        // The save-up floor prevents bursting: even after long dormancy,
        // the effective "start" for the next timer is at most
        // (now - cooldown * max_save_up) in the past.
        let save_up_product = (cooldown as u128) * (max_save_up as u128);
        let save_up_floor: u64 = if (now as u128) >= save_up_product {
            now - (save_up_product as u64)
        } else {
            0
        };

        // effective_old = max(old_next_allowed, save_up_floor)
        // Since save_up_floor <= now always, the check now >= effective_old
        // is equivalent to now >= old_next_allowed.
        let effective_old = if dep_note.next_allowed_time > save_up_floor {
            dep_note.next_allowed_time
        } else {
            save_up_floor
        };

        assert(now >= effective_old, "Too early to post -- time lock not yet expired");

        // next_allowed_time for the NEXT post:
        //   effective_old + cooldown * (1 + (k-1) * flag_count)
        // Each flag adds (k-1) extra cooldowns (equivalent to k-1 dummy posts).
        let penalty_multiplier: u64 = 1 + (k - 1) * flag_count;
        let penalty = (cooldown as u128) * (penalty_multiplier as u128);
        let new_next_allowed: u64 = (effective_old as u128 + penalty) as u64;

        // No public count read or reservation: unrelated authors may publish
        // between this private anchor and the eventual public inclusion.

        // --- Create the new PostNote and compute its link ---
        assert(dep_note.sequences.head_sequence < 0xffffffffffffffff, "Post sequence overflow");
        let sequence = dep_note.sequences.head_sequence + 1;
        let post_note = PostNote { schema_version: 1, deposit_chain_id, sequence,
            post_id: public_post_id, anchor_timestamp: now,
            previous_link: dep_note.head_link, is_dummy };

        let post_msg = self.storage.posts.at(sender).insert(post_note);
        let new_note = post_msg.get_new_note();
        let inner_hash = post_note.compute_note_hash(
            new_note.owner,
            new_note.storage_slot,
            new_note.randomness,
        );
        let new_link = post_link(self.address, sender, deposit_chain_id, sequence, inner_hash, link_secret);
        assert(new_link != SENTINEL, "C02 invalid new head");

        NoteMessage::new(new_note, self.context).deliver(MessageDelivery::onchain_constrained());

        // Dummies advance only private history and never compete for public order.
        if !is_dummy { self.enqueue_self._publish_post(public_post_id, msg, message_length); }

        // --- Update last_real_sequence (only for non-dummy posts) ---
        let new_last_real = if is_dummy {
            dep_note.sequences.last_real_sequence
        } else {
            sequence
        };

        // --- Re-insert deposit note with updated state ---
        let new_deposit = DepositNote {
            receipt: dep_note.receipt, deposit_chain_id,
            sequences: SequenceState { head_sequence: sequence, screened_sequence: new_screened_sequence,
                last_real_sequence: new_last_real },
            amount: dep_note.amount,
            l1_depositor: dep_note.l1_depositor,
            head_link: new_link,
            screened_link: new_screened_link,
            next_allowed_time: new_next_allowed,
        };
        self.storage.deposits.at(sender).insert(new_deposit).deliver(MessageDelivery::onchain_constrained());
    }

    #[external("public")]
    #[only_self]
    fn _publish_post(post_id: Field, msg: [Field; MSG_FIELDS], message_length: u16) {
        assert(post_id != 0, "Post id must not be zero");
        assert(!self.storage.post_exists.at(post_id).read(), "Post id already exists");
        crate::lib::validate_message(msg, message_length);
        let order = self.storage.post_count.read();
        assert(order < 0xffffffffffffffff, "Post count overflow");
        let published_at = self.context.timestamp();
        assert(published_at <= 0x7fffffffffffffff, "Timestamp out of range");
        self.storage.post_exists.at(post_id).write(true);
        self.storage.post_id_by_order.at(order).write(post_id);
        self.storage.post_time.at(post_id).write(published_at);
        self.storage.post_length.at(post_id).write(message_length);
        for i in 0..MSG_FIELDS { self.storage.post_data.at(post_id).at(i).write(msg[i]); }
        self.storage.post_count.write(order + 1);
        // No invented policyVersion/event: full policy+deadline event payloads
        // are integrated with C05 against the actual public inclusion timestamp.
    }

    // ============================================================
    // withdraw — no chain walk needed
    // ============================================================
    //
    // Withdrawal is allowed when all real posts have been screened:
    //   screened_sequence >= last_real_sequence
    // If no real posts exist, just check the initial lock (next_allowed_time).
    // To withdraw after posting, make dummy posts until screening catches up.

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
        assert((deposit.receipt.schema_version == 1) & (deposit.deposit_chain_id == deposit_chain_id) & (deposit_chain_id != 0), "Invalid deposit identity");
        assert((deposit.receipt.deposit_nonce > 0) & (deposit.amount >= config.min_deposit) & (deposit.amount <= config.max_deposit), "Invalid deposit receipt");
        deposit.l1_depositor.validate();
        assert(deposit.l1_depositor.to_field() != 0, "Zero depositor");
        assert(deposit.sequences.screened_sequence >= deposit.sequences.last_real_sequence, "Too early to withdraw -- not all posts screened");
        assert(now >= deposit.next_allowed_time, "Too early to withdraw -- time lock not expired");
        let content = get_withdraw_msg_hash(config.l1_chain_id, portal, self.address,
            config.rollup_version, deposit.l1_depositor, deposit.receipt.deposit_nonce, deposit.amount);
        self.context.message_portal(portal, content);
    }

    // ============================================================
    // View functions
    // ============================================================

    #[external("public")]
    #[view]
    fn get_post_count() -> pub u64 {
        self.storage.post_count.read()
    }

    #[external("public")]
    #[view]
    fn get_post_id(order: u64) -> pub Field {
        assert(order < self.storage.post_count.read(), "Invalid post order");
        self.storage.post_id_by_order.at(order).read()
    }

    #[external("public")]
    #[view]
    fn get_post_exists(id: Field) -> pub bool { self.storage.post_exists.at(id).read() }

    #[external("public")]
    #[view]
    fn get_post_length(id: Field) -> pub u16 {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        self.storage.post_length.at(id).read()
    }

    #[external("public")]
    #[view]
    fn get_post(id: Field) -> pub [Field; MSG_FIELDS] {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        let mut msg: [Field; MSG_FIELDS] = [0; MSG_FIELDS];
        for i in 0..MSG_FIELDS {
            msg[i] = self.storage.post_data.at(id).at(i).read();
        }
        msg
    }

    #[external("public")]
    #[view]
    fn get_post_time(id: Field) -> pub u64 {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        self.storage.post_time.at(id).read()
    }

    #[external("public")]
    #[view]
    fn is_post_flagged(id: Field) -> pub bool {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        self.storage.post_flagged.at(id).read()
    }

    #[external("public")]
    #[view]
    fn get_post_flagged_by(id: Field) -> pub AztecAddress {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        self.storage.post_flagged_by.at(id).read()
    }

    #[external("public")]
    #[view]
    fn get_censor_response(id: Field) -> pub [Field; MSG_FIELDS] {
        assert(self.storage.post_exists.at(id).read(), "Invalid post id");
        let mut msg: [Field; MSG_FIELDS] = [0; MSG_FIELDS];
        for i in 0..MSG_FIELDS {
            msg[i] = self.storage.censor_response.at(id).at(i).read();
        }
        msg
    }

    #[external("public")]
    #[view]
    fn get_censor() -> pub AztecAddress {
        self.storage.censor.read()
    }

    #[external("public")]
    #[view]
    fn get_k_multiplier() -> pub u64 {
        self.storage.config.read().k_multiplier as u64
    }

    #[external("public")]
    #[view]
    fn get_censor_window() -> pub u64 {
        self.storage.config.read().censor_window as u64
    }

    #[external("public")]
    #[view]
    fn get_max_save_up() -> pub u64 {
        self.storage.config.read().max_save_up as u64
    }

    #[external("public")]
    #[view]
    fn get_deployer() -> pub AztecAddress {
        self.storage.config.read().deployer
    }

    #[external("public")]
    #[view]
    fn get_min_deposit() -> pub u128 {
        self.storage.config.read().min_deposit
    }

    #[external("public")]
    #[view]
    fn get_base_cooldown() -> pub u64 {
        self.storage.config.read().base_cooldown as u64
    }

    #[external("public")]
    #[view]
    fn get_portal() -> pub EthAddress {
        self.storage.portal_address.read()
    }

    #[external("public")]
    #[view]
    fn is_portal_set() -> pub bool {
        self.storage.portal_address.is_initialized()
    }

    /// Returns the moderation policy as packed Fields and its byte length.
    /// The caller (frontend/CLI) unpacks the Fields back to a UTF-8 string.
    #[external("public")]
    #[view]
    fn get_moderation_policy() -> pub ([Field; POLICY_FIELDS], u32) {
        let mut policy: [Field; POLICY_FIELDS] = [0; POLICY_FIELDS];
        for i in 0..POLICY_FIELDS {
            policy[i] = self.storage.policy_data.at(i).read();
        }
        (policy, self.storage.policy_len.read())
    }

    #[external("public")]
    #[view]
    fn get_config_hash() -> pub Field { self.storage.config.read().hash(self.address) }

    #[external("public")]
    #[view]
    fn get_max_deposit() -> pub u128 { self.storage.config.read().max_deposit }

    /// Local wallet discovery only. Pagination is explicit; private spends select an exact ID.
    #[external("utility")]
    unconstrained fn get_deposit_ids(owner: AztecAddress, page_offset: u32) -> pub [Field; 10] {
        let options = NoteViewerOptions::<DepositNote, 8>::new().set_limit(10).set_offset(page_offset);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        let mut ids = [0; 10];
        for i in 0..10 { if i < notes.len() { ids[i] = notes.get_unchecked(i).deposit_chain_id; } }
        ids
    }

    /// Exact V1 serialization, selected by private deposit identity.
    #[external("utility")]
    unconstrained fn get_deposit_info(owner: AztecAddress, deposit_chain_id: Field) -> pub [Field; 11] {
        let options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        if notes.len() == 0 { [0; 11] } else { notes.get_unchecked(0).logical_fields() }
    }

    /// Returns the child and grandchild HintedNotes for screening.
    /// The frontend calls this and passes the results to post().
    ///
    /// - child: the PostNote whose prev_link == screened_link
    /// - grandchild: the PostNote whose prev_link == child_link (or None
    ///   if child is the head or no grandchild exists)
    ///
    /// Returns (None, None) if no screening is needed (last_screened == head
    /// or no posts exist).
    #[external("utility")]
    unconstrained fn get_screen_hints(
        owner: AztecAddress, deposit_chain_id: Field,
    ) -> pub (Option<HintedNote<PostNote>>, Option<HintedNote<PostNote>>) {
        // 1. Get deposit note
        let dep_options = NoteViewerOptions::<DepositNote, 8>::new()
            .select(DepositNote::properties().deposit_chain_id, Comparator.EQ, deposit_chain_id).set_limit(1);
        let dep_notes = self.storage.deposits.at(owner).view_notes(dep_options);

        let mut child = Option::none();
        let mut grandchild = Option::none();
        let mut done = false;

        // No deposit note → nothing to screen
        if dep_notes.len() == 0 {
            done = true;
        }

        // 2. Get deposit note fields and check if screening is needed
        let mut dep_note_head: Field = SENTINEL;
        let mut dep_note_last_screened: Field = SENTINEL;
        if !done {
            let dep_note = dep_notes.get_unchecked(0);
            dep_note_head = dep_note.head_link;
            dep_note_last_screened = dep_note.screened_link;
            // Screening not needed if last_screened == head or no posts
            if (dep_note_last_screened == dep_note_head) | (dep_note_head == SENTINEL) {
                done = true;
            }
        }

        // 3. Get link_secret
        let mut link_secret: Field = 0;
        if !done {
            let maybe_pk = try_get_public_keys(owner);
            if maybe_pk.is_none() {
                done = true;
            } else {
                link_secret = get_nhk_app(maybe_pk.unwrap_unchecked().npk_m_hash);
            }
        }

        // 4. Fetch PostNotes
        if !done {
            let post_slot = self.storage.posts.at(owner).storage_slot;
            let opt_notes = aztec::oracle::notes::get_notes::<PostNote, 0, MAX_HINT_NOTES>(
                Option::some(owner),
                post_slot,
                0,
                [],
                [],
                [],
                [],
                [],
                [],
                [],
                [],
                [],
                MAX_HINT_NOTES,
                0,
                NoteStatus.ACTIVE,
            );

            // 5. Find child (whose prev_link == screened_link)
            let mut child_link: Field = 0;

            for i in 0..MAX_HINT_NOTES {
                if child.is_none() {
                    let maybe = opt_notes[i];
                    if maybe.is_some() {
                        let hinted = maybe.unwrap_unchecked();
                        if (hinted.note.deposit_chain_id == deposit_chain_id) & (hinted.note.previous_link == dep_note_last_screened) {
                            let inner_hash = hinted.note.compute_note_hash(
                                hinted.owner,
                                hinted.storage_slot,
                                hinted.randomness,
                            );
                            child_link = post_link(self.address, owner, deposit_chain_id, hinted.note.sequence, inner_hash, link_secret);
                            child = Option::some(hinted);
                        }
                    }
                }
            }

            // 6. If child not found or child is the head, no grandchild
            let child_is_head = child_link == dep_note_head;
            let no_child = child.is_none();
            let skip_grandchild = no_child | child_is_head;

            // 7. Find grandchild (whose prev_link == child_link)
            if !skip_grandchild {
                for i in 0..MAX_HINT_NOTES {
                    if grandchild.is_none() {
                        let maybe = opt_notes[i];
                        if maybe.is_some() {
                            let hinted = maybe.unwrap_unchecked();
                            if (hinted.note.deposit_chain_id == deposit_chain_id) & (hinted.note.previous_link == child_link) {
                                grandchild = Option::some(hinted);
                            }
                        }
                    }
                }
            }
        }

        (child, grandchild)
    }

    /// Returns all PostNotes for an account as HintedNotes (unordered).
    /// Useful for debugging or for frontends that want to inspect the chain.
    #[external("utility")]
    unconstrained fn get_post_notes(owner: AztecAddress) -> pub [Option<HintedNote<PostNote>>; MAX_HINT_NOTES] {
        let post_slot = self.storage.posts.at(owner).storage_slot;
        aztec::oracle::notes::get_notes::<PostNote, 0, MAX_HINT_NOTES>(
            Option::some(owner),
            post_slot,
            0,
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            MAX_HINT_NOTES,
            0,
            NoteStatus.ACTIVE,
        )
    }
}
