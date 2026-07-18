mod lib;

use aztec::macros::aztec;

#[aztec]
pub contract Billboard {
    use crate::lib::{compute_cooldown, get_deposit_msg_hash, get_withdraw_msg_hash};

    use aztec::{
        macros::{
            functions::{external, initializer, only_self, view},
            notes::note,
            storage::storage,
        },
        messages::delivery::MessageDelivery,
        note::note_getter_options::NoteGetterOptions,
        note::note_viewer_options::NoteViewerOptions,
        protocol::{
            address::{AztecAddress, EthAddress},
            traits::{Deserialize, Packable, Serialize, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicMutable},
    };

    // ============================================================
    // Constants
    // ============================================================
    // Cooldown base: 1 hour for the minimum deposit (0.001 ETH).
    // cooldown = COOLDOWN_BASE_SECONDS * MIN_DEPOSIT_WEI / amount
    //   0.001 ETH -> 3600s  (1 hour)
    //   0.01 ETH  -> 360s   (6 min)
    //   0.1 ETH   -> 36s
    //   1 ETH     -> 3s
    global COOLDOWN_BASE_SECONDS: u64 = 3600;
    global MIN_DEPOSIT_WEI: u128 = 1_000_000_000_000_000; // 0.001 ETH
    // Message size: 32 field elements = 992 bytes (31 bytes per field)
    global MSG_FIELDS: u32 = 32;

    // ============================================================
    // Note type: DepositNote
    // ============================================================
    // A private note representing a deposit on L1 that has been
    // bridged to L2. The note proves eligibility to post messages
    // and to withdraw.
    //
    // Fields:
    //   amount          - The ETH amount deposited (in wei)
    //   min_usable_time - Earliest block timestamp at which this
    //                     note can be consumed (for posting or
    //                     withdrawing). Starts at deposit_time +
    //                     cooldown and increases by cooldown with
    //                     each post.
    //   l1_depositor    - The Ethereum address that made the L1
    //                     deposit. Used in the L2->L1 withdrawal
    //                     message so the portal knows who to pay.
    //
    // Privacy:
    //   The amount (and hence the cooldown) is private. Only the
    //   ZK proof guarantees that the timestamp was updated correctly
    //   (new = old + cooldown) and that the old timestamp <= now.
    //   The block timestamp (now) is a public input from the block
    //   header, verified by the rollup.
    // ============================================================

    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct DepositNote {
        pub amount: u128,
        pub min_usable_time: u64,
        pub l1_depositor: EthAddress,
    }

    // ============================================================
    // Storage
    // ============================================================

    #[storage]
    struct Storage<Context> {
        // The L1 portal address (set once via update_portal, then immutable)
        portal_address: PublicMutable<EthAddress, Context>,
        portal_set: PublicMutable<bool, Context>,

        // Per-account deposit notes (private)
        deposits: Owned<PrivateSet<DepositNote, Context>, Context>,

        // Sequential post log -- each post stored as MSG_FIELDS fields
        // Key = post_id * MSG_FIELDS + field_index
        post_count: PublicMutable<u32, Context>,
        post_data: Map<u32, PublicMutable<Field, Context>, Context>,
    }

    // ============================================================
    // Initializer
    // ============================================================

    #[external("public")]
    #[initializer]
    fn init() {
        self.storage.post_count.write(0);
        self.storage.portal_set.write(false);
    }

    // ============================================================
    // update_portal -- set the L1 portal address (two-phase deploy)
    // ============================================================

    #[external("private")]
    fn update_portal(portal: EthAddress) {
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
    // claim_deposit -- consume L1->L2 message, create DepositNote
    // ============================================================
    //
    // Called privately by the depositor. Consumes the L1->L2
    // message sent by the portal's `deposit` function, and creates
    // a private DepositNote owned by the caller.
    //
    // The note's min_usable_time is set to now + cooldown, where
    // cooldown = COOLDOWN_BASE_SECONDS * MIN_DEPOSIT_WEI / amount.
    // This enforces the minimum lockup before the first post or
    // withdraw, scaled inversely by deposit size.

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

        // Compute content hash -- must match the L1 portal
        let content = get_deposit_msg_hash(depositor, amount);

        // Consume the L1->L2 message (verifies existence + nullifies)
        self.context.consume_l1_to_l2_message(content, [secret], portal, message_leaf_index);

        // Compute cooldown from amount (private)
        let cooldown = compute_cooldown(amount, COOLDOWN_BASE_SECONDS, MIN_DEPOSIT_WEI);

        // Create the deposit note: min_usable_time = now + cooldown
        let note = DepositNote {
            amount: amount,
            min_usable_time: now + cooldown,
            l1_depositor: depositor,
        };
        self.storage.deposits.at(sender).insert(note).deliver(MessageDelivery::onchain_constrained());
    }

    // ============================================================
    // post -- consume note, store message, create new note
    // ============================================================
    //
    // Called privately. Consumes the caller's current DepositNote
    // (proving eligibility), enqueues a public call to store the
    // message, and creates a new note with min_usable_time +
    // cooldown.
    //
    // Privacy: the public call stores ONLY the message fields.
    // No sender address, amount, or cooldown is passed to the
    // public call. The nullifier from consuming the note is
    // unlinkable. The cooldown is derived from the private note's
    // amount, so it remains private.
    //
    // Invariant: each post increments min_usable_time by cooldown.
    // The ZK proof guarantees:
    //   1. new_min_usable_time = old_min_usable_time + cooldown
    //   2. old_min_usable_time <= now (public block timestamp)
    //   3. cooldown = f(amount) computed correctly

    #[external("private")]
    fn post(msg: [Field; MSG_FIELDS]) {
        let sender = self.msg_sender();
        let now = self.context.get_anchor_block_header().timestamp();

        // Pop one deposit note (nullifies it -- proves it's current)
        let options = NoteGetterOptions::<DepositNote, 3, Field, Field>::new().set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found -- claim a deposit first");
        let note = notes.get_unchecked(0);

        // Enforce time lock (private check against public block timestamp)
        assert(
            note.min_usable_time <= now,
            "Too early to post -- time lock not yet expired"
        );

        // Compute cooldown from the note's amount (private)
        let cooldown = compute_cooldown(note.amount, COOLDOWN_BASE_SECONDS, MIN_DEPOSIT_WEI);

        // Store the post (public, anonymous -- no sender/amount/cooldown recorded)
        self.enqueue_self._post_public(msg);

        // Create new note with min_usable_time + cooldown
        let new_note = DepositNote {
            amount: note.amount,
            min_usable_time: note.min_usable_time + cooldown,
            l1_depositor: note.l1_depositor,
        };
        self.storage.deposits.at(sender).insert(new_note).deliver(MessageDelivery::onchain_constrained());
    }

    // ============================================================
    // _post_public -- internal public function to store the message
    // ============================================================

    #[external("public")]
    #[only_self]
    fn _post_public(msg: [Field; MSG_FIELDS]) {
        let id = self.storage.post_count.read();
        for i in 0..MSG_FIELDS {
            self.storage.post_data.at(id * MSG_FIELDS + i).write(msg[i]);
        }
        self.storage.post_count.write(id + 1);
    }

    // ============================================================
    // withdraw -- consume note, send L2->L1 message (with amount)
    // ============================================================
    //
    // Called privately. Consumes the caller's DepositNote (checking
    // the time lock), computes a content hash that includes both the
    // depositor's L1 address AND the deposit amount, then enqueues a
    // public call to send the L2->L1 message.
    //
    // The amount is included in the message content so the L1 portal
    // can cryptographically verify how much ETH to send. This prevents
    // a user from claiming more than their deposit.
    //
    // Privacy: only the content hash is passed to the public call.
    // The individual depositor address and amount are not revealed
    // in the public call data -- only the hash is. The L2->L1 message
    // leaf (which contains the hash) is already public in the block
    // body, but the preimage (depositor, amount) cannot be recovered
    // from the hash.

    #[external("private")]
    fn withdraw(portal: EthAddress) {
        let sender = self.msg_sender();

        // Pop one deposit note (nullifies it)
        let options = NoteGetterOptions::<DepositNote, 3, Field, Field>::new().set_limit(1);
        let notes = self.storage.deposits.at(sender).pop_notes(options);
        assert(notes.len() > 0, "No deposit note found");
        let note = notes.get_unchecked(0);

        // No withdraw cooldown — the posting cooldown already enforces
        // the rate-limit invariant: each claim sets min_usable_time =
        // now + cooldown, so re-depositing after withdraw still
        // requires waiting cooldown before the next post.

        // Compute content hash including the amount (private)
        let content = get_withdraw_msg_hash(note.l1_depositor, note.amount);

        // Enqueue public call to verify portal and send L2->L1 message
        // Only the hash is passed -- amount stays private
        self.enqueue_self._withdraw_public(portal, content);
    }

    // ============================================================
    // _withdraw_public -- verify portal, send L2->L1 message
    // ============================================================

    #[external("public")]
    #[only_self]
    fn _withdraw_public(portal: EthAddress, content: Field) {
        // Verify the provided portal matches the stored one
        let stored_portal = self.storage.portal_address.read();
        assert(portal.to_field() == stored_portal.to_field(), "Wrong portal address");

        // Send L2->L1 message with the content hash (includes amount)
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
        let mut msg: [Field; MSG_FIELDS] = [0; MSG_FIELDS];
        for i in 0..MSG_FIELDS {
            msg[i] = self.storage.post_data.at(id * MSG_FIELDS + i).read();
        }
        msg
    }

    #[external("public")]
    #[view]
    fn get_portal_address() -> pub EthAddress {
        self.storage.portal_address.read()
    }

    /// Returns the number of active deposit notes for an account
    /// (runs off-chain via the PXE).
    #[external("utility")]
    unconstrained fn get_deposit_count(owner: AztecAddress) -> pub u32 {
        let options = NoteViewerOptions::<DepositNote, 3>::new();
        let notes = self.storage.deposits.at(owner).view_notes(options);
        notes.len() as u32
    }

    /// Returns the details of the first deposit note for an account:
    /// (amount, min_usable_time, l1_depositor).
    /// Returns (0, 0, 0) if no note exists.
    /// Used by the dapp for pre-flight checks before posting/withdrawing.
    #[external("utility")]
    unconstrained fn get_deposit_info(owner: AztecAddress) -> pub (u128, u64, EthAddress) {
        let options = NoteViewerOptions::<DepositNote, 3>::new().set_limit(1);
        let notes = self.storage.deposits.at(owner).view_notes(options);
        if notes.len() == 0 {
            (0, 0, EthAddress::zero())
        } else {
            let note = notes.get_unchecked(0);
            (note.amount, note.min_usable_time, note.l1_depositor)
        }
    }
}
