pub mod lib;

use aztec::macros::aztec;

#[aztec]
pub contract Billboard {
    use crate::lib::{compute_cooldown, get_deposit_msg_hash, get_withdraw_msg_hash};

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
            note_interface::NoteHash,
            HintedNote,
            NoteMessage,
        },
        protocol::{
            address::{AztecAddress, EthAddress},
            hash::poseidon2_hash_with_separator,
            traits::{Deserialize, FromField, Packable, Serialize, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicMutable, StateVariable},
    };

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

    /// Custom domain separator for post-chain links.
    /// link = poseidon2_hash_with_separator([inner_note_hash, link_secret], DOM_SEP__POST_LINK)
    global DOM_SEP__POST_LINK: u32 = 3141592653;

    /// Sentinel value for "no real post yet" in last_real_post_index.
    global NO_REAL_POST: u32 = 0xFFFFFFFF;

    /// Sentinel value for "nothing screened yet" in last_screened_index.
    global NO_SCREENED: u32 = 0xFFFFFFFF;

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
    // store message content and don't update last_real_post_index. Used for
    // withdrawal (make dummy posts until screening catches up).
    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct PostNote {
        pub post_index: u32,
        pub timestamp: u64,
        pub prev_link: Field,
        pub is_dummy: bool,
    }

    // ============================================================
    // Note type: DepositNote
    // ============================================================
    // The deposit note tracks the user's posting state:
    //   post_chain_head: link to the most recent PostNote (or SENTINEL)
    //   last_screened_link: link to the last screened PostNote (or SENTINEL)
    //   last_screened_index: post_index of last screened post (NO_SCREENED if none)
    //   last_real_post_index: post_index of last non-dummy post (NO_REAL_POST if none)
    //   next_allowed_time: earliest time the next post is allowed (save-up + cooldown)
    //
    // The screening mechanism: each post() call screens 0-2 older posts
    // (child and grandchild of last_screened). Posts are only screened once
    // — once last_screened advances past them, their flag status is final.
    // The censor has a guaranteed censor_window to flag each post before it
    // gets screened.
    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct DepositNote {
        pub amount: u128,
        pub l1_depositor: EthAddress,
        pub post_chain_head: Field,
        pub last_screened_link: Field,
        pub last_screened_index: u32,
        pub last_real_post_index: u32,
        pub next_allowed_time: u64,
    }

    // ============================================================
    // Storage
    // ============================================================

    #[storage]
    struct Storage<Context> {
        portal_address: PublicMutable<EthAddress, Context>,
        portal_set: PublicMutable<bool, Context>,
        deposits: Owned<PrivateSet<DepositNote, Context>, Context>,
        /// Append-only post chain — one PrivateSet per account.
        /// PostNotes are never nullified; they serve as historical anchors.
        posts: Owned<PrivateSet<PostNote, Context>, Context>,
        post_count: PublicMutable<u32, Context>,
        post_data: Map<u32, PublicMutable<Field, Context>, Context>,
        // Deployer-configurable parameters (set in init)
        deployer: PublicMutable<AztecAddress, Context>,
        min_deposit: PublicMutable<u128, Context>,
        base_cooldown: PublicMutable<u64, Context>,
        // Censor & screening parameters
        censor: PublicMutable<AztecAddress, Context>,
        k_multiplier: PublicMutable<u64, Context>,
        /// Censor window in seconds: minimum time the censor has to flag a post
        /// before it gets screened. Posts younger than censor_window cannot be
        /// screened yet.
        censor_window: PublicMutable<u64, Context>,
        /// Maximum number of posts that can be "saved up" — limits how many
        /// posts can be made in quick succession after returning from dormancy.
        max_save_up: PublicMutable<u64, Context>,
        // Post metadata (public)
        post_time: Map<u32, PublicMutable<u64, Context>, Context>,
        post_flagged: Map<u32, PublicMutable<bool, Context>, Context>,
        /// The address of the censor who flagged each post (zero = never flagged).
        /// Public record of accountability.
        post_flagged_by: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        censor_response: Map<u32, PublicMutable<Field, Context>, Context>,
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
        min_deposit: u128,
        base_cooldown: u64,
        censor: AztecAddress,
        k: u64,
        censor_window: u64,
        max_save_up: u64,
        policy: [Field; POLICY_FIELDS],
        policy_len: u32,
    ) {
        assert(min_deposit > 0, "Min deposit must be > 0");
        assert(base_cooldown > 0, "Base cooldown must be > 0");
        assert(k > 0, "K must be > 0");
        assert(censor_window > 0, "Censor window must be > 0");
        assert(max_save_up > 0, "Max save up must be > 0");
        assert(policy_len <= MAX_POLICY_BYTES, "Policy too long");
        self.storage.post_count.write(0);
        self.storage.portal_set.write(false);
        self.storage.deployer.write(self.msg_sender());
        self.storage.min_deposit.write(min_deposit);
        self.storage.base_cooldown.write(base_cooldown);
        self.storage.censor.write(censor);
        self.storage.k_multiplier.write(k);
        self.storage.censor_window.write(censor_window);
        self.storage.max_save_up.write(max_save_up);
        self.storage.policy_len.write(policy_len);
        for i in 0..POLICY_FIELDS {
            self.storage.policy_data.at(i).write(policy[i]);
        }
    }

    // ============================================================
    // update_portal -- deployer only (griefing fix)
    // ============================================================

    #[external("private")]
    fn update_portal(portal: EthAddress) {
        let header = self.context.get_anchor_block_header();
        let address = self.context.this_address();
        let deployer_slot = self.storage.deployer.get_storage_slot();
        let deployer_field = public_storage_historical_read(header, deployer_slot, address);
        let deployer = AztecAddress::from_field(deployer_field);
        assert(self.msg_sender().to_field() == deployer.to_field(), "Only deployer can set portal");
        self.enqueue_self._set_portal_public(portal);
    }

    #[external("public")]
    #[only_self]
    fn _set_portal_public(portal: EthAddress) {
        let already_set = self.storage.portal_set.read();
        assert(!already_set, "Portal address already set -- immutable");
        self.storage.portal_address.write(portal);
        self.storage.portal_set.write(true);
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
        assert(policy_len <= MAX_POLICY_BYTES, "Policy too long");
        self.storage.policy_len.write(policy_len);
        for i in 0..POLICY_FIELDS {
            self.storage.policy_data.at(i).write(policy[i]);
        }
    }

    // ============================================================
    // declare_immoral -- censor only (public function)
    // ============================================================
    // Each post is screened at most once (when last_screened advances past it).
    // The censor has a guaranteed censor_window to flag before screening happens.
    // No flag_time storage needed — we just check post_flagged at screening time.

    #[external("public")]
    fn declare_immoral(post_index: u32, response: [Field; MSG_FIELDS]) {
        let censor = self.storage.censor.read();
        let sender = self.msg_sender();
        assert(sender.to_field() != AztecAddress::zero().to_field(), "No censor configured");
        assert(sender.to_field() == censor.to_field(), "Only censor can declare immoral");
        assert(post_index < self.storage.post_count.read(), "Invalid post index");
        assert(!self.storage.post_flagged.at(post_index).read(), "Already flagged");

        self.storage.post_flagged.at(post_index).write(true);
        self.storage.post_flagged_by.at(post_index).write(sender);

        for i in 0..MSG_FIELDS {
            self.storage.censor_response.at(post_index * MSG_FIELDS + i).write(response[i]);
        }
    }

    // ============================================================
    // claim_deposit
    // ============================================================

    #[external("private")]
    fn claim_deposit(
        depositor: EthAddress,
        amount: u128,
        secret: Field,
        message_leaf_index: Field,
        portal: EthAddress,
    ) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();

        let content = get_deposit_msg_hash(depositor, amount);
        self.context.consume_l1_to_l2_message(content, [secret], portal, message_leaf_index);

        let header = self.context.get_anchor_block_header();
        let addr = self.context.this_address();
        let cd_slot = self.storage.base_cooldown.get_storage_slot();
        let md_slot = self.storage.min_deposit.get_storage_slot();
        let base_cooldown: u64 = (public_storage_historical_read(header, cd_slot, addr)) as u64;
        let min_deposit: u128 = (public_storage_historical_read(header, md_slot, addr)) as u128;

        assert(amount >= min_deposit, "Deposit below minimum");

        let cooldown = compute_cooldown(amount, base_cooldown, min_deposit);

        let note = DepositNote {
            amount: amount,
            l1_depositor: depositor,
            post_chain_head: SENTINEL,
            last_screened_link: SENTINEL,
            last_screened_index: NO_SCREENED,
            last_real_post_index: NO_REAL_POST,
            next_allowed_time: now + cooldown,
        };
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
        msg: [Field; MSG_FIELDS],
        is_dummy: bool,
        child: Option<HintedNote<PostNote>>,
        grandchild: Option<HintedNote<PostNote>>,
    ) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();
        let header = self.context.get_anchor_block_header();
        let addr = self.context.this_address();

        // --- Pop the deposit note ---
        let options = NoteGetterOptions::<DepositNote, 7, Field, Field>::new().set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found -- claim a deposit first");
        let dep_note = notes.get_unchecked(0);

        // --- Read config parameters ---
        let cd_slot = self.storage.base_cooldown.get_storage_slot();
        let md_slot = self.storage.min_deposit.get_storage_slot();
        let base_cooldown_val: u64 = (public_storage_historical_read(header, cd_slot, addr)) as u64;
        let min_deposit_val: u128 = (public_storage_historical_read(header, md_slot, addr)) as u128;
        let cooldown = compute_cooldown(dep_note.amount, base_cooldown_val, min_deposit_val);

        let k_slot = self.storage.k_multiplier.get_storage_slot();
        let k: u64 = (public_storage_historical_read(header, k_slot, addr)) as u64;

        let cw_slot = self.storage.censor_window.get_storage_slot();
        let censor_window: u64 = (public_storage_historical_read(header, cw_slot, addr)) as u64;

        let ms_slot = self.storage.max_save_up.get_storage_slot();
        let max_save_up: u64 = (public_storage_historical_read(header, ms_slot, addr)) as u64;

        // --- Get link_secret (app-siloed nullifier hiding key) ---
        let owner_npk_m_hash = get_public_keys(sender).npk_m_hash;
        let link_secret = self.context.request_nhk_app(owner_npk_m_hash);

        // --- Screen posts (child and grandchild) ---
        let mut flag_count: u64 = 0;
        let mut new_last_screened_link = dep_note.last_screened_link;
        let mut new_last_screened_index = dep_note.last_screened_index;

        // Screening is needed if there are unscreened posts:
        //   last_screened != head AND head != SENTINEL (posts exist)
        let need_screening = (dep_note.last_screened_link != dep_note.post_chain_head)
            & (dep_note.post_chain_head != SENTINEL);

        // Censor window threshold: posts older than this can be screened
        let screen_threshold: u64 = if now >= censor_window { now - censor_window } else { 0 };

        if need_screening {
            // --- Verify and screen child ---
            assert(child.is_some(), "Child note required for screening");
            let child_hinted = child.unwrap_unchecked();
            let child_confirmed = assert_note_existed_by(header, child_hinted);

            // Verify child is the next post after last_screened
            let child_inner_hash = child_confirmed.note.compute_note_hash(
                child_confirmed.owner,
                child_confirmed.storage_slot,
                child_confirmed.randomness,
            );
            let child_link = poseidon2_hash_with_separator(
                [child_inner_hash, link_secret],
                DOM_SEP__POST_LINK,
            );
            assert(
                child_confirmed.note.prev_link == dep_note.last_screened_link,
                "Child does not link to last_screened",
            );

            // Can only screen if child is older than censor_window
            if child_confirmed.note.timestamp <= screen_threshold {
                // Screen child — check flag status
                let child_flag_slot = self.storage.post_flagged.at(child_confirmed.note.post_index).get_storage_slot();
                let child_flagged = public_storage_historical_read(header, child_flag_slot, addr);
                if child_flagged == 1 {
                    flag_count += 1;
                }
                new_last_screened_link = child_link;
                new_last_screened_index = child_confirmed.note.post_index;

                // --- Check if grandchild is needed and available ---
                // Grandchild is exempt if:
                //   (i) child is the head (no grandchild exists), OR
                //   (ii) grandchild would be too young to screen (but we still provide it
                //        and the circuit checks its timestamp)
                let child_is_head = child_link == dep_note.post_chain_head;

                if !child_is_head {
                    // Verify and screen grandchild
                    assert(grandchild.is_some(), "Grandchild note required for screening");
                    let gc_hinted = grandchild.unwrap_unchecked();
                    let gc_confirmed = assert_note_existed_by(header, gc_hinted);

                    let gc_inner_hash = gc_confirmed.note.compute_note_hash(
                        gc_confirmed.owner,
                        gc_confirmed.storage_slot,
                        gc_confirmed.randomness,
                    );
                    let gc_link = poseidon2_hash_with_separator(
                        [gc_inner_hash, link_secret],
                        DOM_SEP__POST_LINK,
                    );
                    assert(
                        gc_confirmed.note.prev_link == child_link,
                        "Grandchild does not link to child",
                    );

                    // Can only screen grandchild if old enough
                    if gc_confirmed.note.timestamp <= screen_threshold {
                        let gc_flag_slot = self.storage.post_flagged.at(gc_confirmed.note.post_index).get_storage_slot();
                        let gc_flagged = public_storage_historical_read(header, gc_flag_slot, addr);
                        if gc_flagged == 1 {
                            flag_count += 1;
                        }
                        new_last_screened_link = gc_link;
                        new_last_screened_index = gc_confirmed.note.post_index;
                    }
                }
            }
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

        // --- Read post_count ---
        let post_count_slot = self.storage.post_count.get_storage_slot();
        let post_id_field = public_storage_historical_read(header, post_count_slot, addr);
        let post_id: u32 = post_id_field as u32;

        // --- Create the new PostNote and compute its link ---
        let post_note = PostNote {
            post_index: post_id,
            timestamp: now,
            prev_link: dep_note.post_chain_head,
            is_dummy: is_dummy,
        };

        let post_msg = self.storage.posts.at(sender).insert(post_note);
        let new_note = post_msg.get_new_note();
        let inner_hash = post_note.compute_note_hash(
            new_note.owner,
            new_note.storage_slot,
            new_note.randomness,
        );
        let new_link = poseidon2_hash_with_separator([inner_hash, link_secret], DOM_SEP__POST_LINK);

        NoteMessage::new(new_note, self.context).deliver(MessageDelivery::onchain_constrained());

        // --- Enqueue public call to store the post ---
        self.enqueue_self._post_public(msg, now, post_id, is_dummy);

        // --- Update last_real_post_index (only for non-dummy posts) ---
        let new_last_real = if is_dummy {
            dep_note.last_real_post_index
        } else {
            post_id
        };

        // --- Re-insert deposit note with updated state ---
        let new_deposit = DepositNote {
            amount: dep_note.amount,
            l1_depositor: dep_note.l1_depositor,
            post_chain_head: new_link,
            last_screened_link: new_last_screened_link,
            last_screened_index: new_last_screened_index,
            last_real_post_index: new_last_real,
            next_allowed_time: new_next_allowed,
        };
        self.storage.deposits.at(sender).insert(new_deposit).deliver(MessageDelivery::onchain_constrained());
    }

    #[external("public")]
    #[only_self]
    fn _post_public(msg: [Field; MSG_FIELDS], timestamp: u64, post_id: u32, is_dummy: bool) {
        let current_count = self.storage.post_count.read();
        assert(current_count == post_id, "Post count mismatch -- retry");

        self.storage.post_time.at(post_id).write(timestamp);
        if !is_dummy {
            for i in 0..MSG_FIELDS {
                self.storage.post_data.at(post_id * MSG_FIELDS + i).write(msg[i]);
            }
        }
        self.storage.post_count.write(post_id + 1);
    }

    // ============================================================
    // withdraw — no chain walk needed
    // ============================================================
    //
    // Withdrawal is allowed when all real posts have been screened:
    //   last_screened_index >= last_real_post_index
    // If no real posts exist, just check the initial lock (next_allowed_time).
    // To withdraw after posting, make dummy posts until screening catches up.

    #[external("private")]
    fn withdraw(portal: EthAddress) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();

        let options = NoteGetterOptions::<DepositNote, 7, Field, Field>::new().set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found");
        let dep_note = notes.get_unchecked(0);

        let no_real_posts = dep_note.last_real_post_index == NO_REAL_POST;
        let nothing_screened = dep_note.last_screened_index == NO_SCREENED;

        if no_real_posts {
            // No real posts — just check the initial lock
            assert(
                now >= dep_note.next_allowed_time,
                "Too early to withdraw -- initial lock not expired",
            );
        } else if nothing_screened {
            // Real posts exist but none screened yet
            assert(false, "Too early to withdraw -- not all posts screened");
        } else {
            assert(
                dep_note.last_screened_index >= dep_note.last_real_post_index,
                "Too early to withdraw -- not all posts screened",
            );
        }

        let content = get_withdraw_msg_hash(dep_note.l1_depositor, dep_note.amount);
        self.enqueue_self._withdraw_public(portal, content);
    }

    #[external("public")]
    #[only_self]
    fn _withdraw_public(portal: EthAddress, content: Field) {
        let stored_portal = self.storage.portal_address.read();
        assert(portal.to_field() == stored_portal.to_field(), "Wrong portal address");
        self.context.message_portal(portal, content);
    }

    // ============================================================
    // View functions
    // ============================================================

    #[external("public")]
    #[view]
    fn get_post_count() -> pub u32 {
        self.storage.post_count.read()
    }

    #[external("public")]
    #[view]
    fn get_post(id: u32) -> pub [Field; MSG_FIELDS] {
        assert(id < self.storage.post_count.read(), "Invalid post id");
        let mut msg: [Field; MSG_FIELDS] = [0; MSG_FIELDS];
        for i in 0..MSG_FIELDS {
            msg[i] = self.storage.post_data.at(id * MSG_FIELDS + i).read();
        }
        msg
    }

    #[external("public")]
    #[view]
    fn get_post_time(id: u32) -> pub u64 {
        self.storage.post_time.at(id).read()
    }

    #[external("public")]
    #[view]
    fn is_post_flagged(id: u32) -> pub bool {
        self.storage.post_flagged.at(id).read()
    }

    #[external("public")]
    #[view]
    fn get_post_flagged_by(id: u32) -> pub AztecAddress {
        self.storage.post_flagged_by.at(id).read()
    }

    #[external("public")]
    #[view]
    fn get_censor_response(id: u32) -> pub [Field; MSG_FIELDS] {
        let mut msg: [Field; MSG_FIELDS] = [0; MSG_FIELDS];
        for i in 0..MSG_FIELDS {
            msg[i] = self.storage.censor_response.at(id * MSG_FIELDS + i).read();
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
        self.storage.k_multiplier.read()
    }

    #[external("public")]
    #[view]
    fn get_censor_window() -> pub u64 {
        self.storage.censor_window.read()
    }

    #[external("public")]
    #[view]
    fn get_max_save_up() -> pub u64 {
        self.storage.max_save_up.read()
    }

    #[external("public")]
    #[view]
    fn get_deployer() -> pub AztecAddress {
        self.storage.deployer.read()
    }

    #[external("public")]
    #[view]
    fn get_min_deposit() -> pub u128 {
        self.storage.min_deposit.read()
    }

    #[external("public")]
    #[view]
    fn get_base_cooldown() -> pub u64 {
        self.storage.base_cooldown.read()
    }

    #[external("public")]
    #[view]
    fn get_portal() -> pub EthAddress {
        self.storage.portal_address.read()
    }

    #[external("public")]
    #[view]
    fn is_portal_set() -> pub bool {
        self.storage.portal_set.read()
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

    /// Returns details of the first deposit note for an account as a Field array:
    /// [0] = amount (u128 as Field)
    /// [1] = l1_depositor (EthAddress as Field)
    /// [2] = post_chain_head (Field link, or SENTINEL)
    /// [3] = last_screened_link (Field link, or SENTINEL)
    /// [4] = last_screened_index (u32 as Field, NO_SCREENED if nothing screened)
    /// [5] = last_real_post_index (u32 as Field, NO_REAL_POST if no real posts)
    /// [6] = next_allowed_time (u64 as Field)
    /// Returns all-zeros if no note exists.
    #[external("utility")]
    unconstrained fn get_deposit_info(owner: AztecAddress) -> pub [Field; 7] {
        let options = NoteViewerOptions::<DepositNote, 7>::new().set_limit(1);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        if notes.len() == 0 {
            [0, 0, SENTINEL, SENTINEL, NO_SCREENED as Field, NO_REAL_POST as Field, 0]
        } else {
            let note = notes.get_unchecked(0);
            [
                note.amount as Field,
                note.l1_depositor.to_field(),
                note.post_chain_head,
                note.last_screened_link,
                note.last_screened_index as Field,
                note.last_real_post_index as Field,
                note.next_allowed_time as Field,
            ]
        }
    }

    /// Returns the child and grandchild HintedNotes for screening.
    /// The frontend calls this and passes the results to post().
    ///
    /// - child: the PostNote whose prev_link == last_screened_link
    /// - grandchild: the PostNote whose prev_link == child_link (or None
    ///   if child is the head or no grandchild exists)
    ///
    /// Returns (None, None) if no screening is needed (last_screened == head
    /// or no posts exist).
    #[external("utility")]
    unconstrained fn get_screen_hints(
        owner: AztecAddress,
    ) -> pub (Option<HintedNote<PostNote>>, Option<HintedNote<PostNote>>) {
        // 1. Get deposit note
        let dep_options = NoteViewerOptions::<DepositNote, 7>::new().set_limit(1);
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
            dep_note_head = dep_note.post_chain_head;
            dep_note_last_screened = dep_note.last_screened_link;
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

            // 5. Find child (whose prev_link == last_screened_link)
            let mut child_link: Field = 0;

            for i in 0..MAX_HINT_NOTES {
                if child.is_none() {
                    let maybe = opt_notes[i];
                    if maybe.is_some() {
                        let hinted = maybe.unwrap_unchecked();
                        if hinted.note.prev_link == dep_note_last_screened {
                            let inner_hash = hinted.note.compute_note_hash(
                                hinted.owner,
                                hinted.storage_slot,
                                hinted.randomness,
                            );
                            child_link = poseidon2_hash_with_separator(
                                [inner_hash, link_secret],
                                DOM_SEP__POST_LINK,
                            );
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
                            if hinted.note.prev_link == child_link {
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
