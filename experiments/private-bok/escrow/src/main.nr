use aztec::{macros::aztec, protocol::{address::{AztecAddress, EthAddress}, hash::poseidon2_hash_with_separator, traits::ToField}};

pub fn words<let N: u32, let D: u32>(domain: str<D>, fields: [Field; N]) -> [u8; 32 + N * 32] {
    let mut out = [0; 32 + N * 32];
    for i in 0..D { out[i] = domain.as_bytes()[i]; }
    for i in 0..N {
        let bytes: [u8; 32] = fields[i].to_be_bytes();
        for j in 0..32 { out[32 + i * 32 + j] = bytes[j]; }
    }
    out
}

// The legacy portal's bytes32 "account" position now carries a fresh commitment,
// never the private owner's address. Its PLUGIN_CREDIT_V1 byte layout is unchanged.
pub fn recipient_commitment(chain: Field, portal: EthAddress, escrow: AztecAddress,
    version: Field, owner: AztecAddress, salt: Field) -> Field {
    poseidon2_hash_with_separator([chain, portal.to_field(), escrow.to_field(), version, owner.to_field(), salt], 0x424b4301)
}

#[aztec]
pub contract PrivateBok {
    use aztec::{
        macros::{events::event, functions::{external, initializer, internal, only_self, view}, notes::note, storage::storage},
        messages::delivery::MessageDelivery,
        note::{note_getter_options::NoteGetterOptions, note_viewer_options::NoteViewerOptions, note_interface::NoteProperties},
        protocol::{address::{AztecAddress, EthAddress}, hash::{sha256_to_field, poseidon2_hash_with_separator},
            traits::{Deserialize, FromField, Packable, Serialize, ToField}},
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable, StateVariable},
        utils::comparison::Comparator,
    };
    use balance_set::BalanceSet;
    use uint_note::{UintNote, PartialUintNote};
    use crate::{words, recipient_commitment};

    global WAITING: u8 = 1;
    global ACTIVE: u8 = 2;
    global FENCED: u8 = 3;
    global CLOSED: u8 = 4;
    global REQUEST_LIFETIME: u64 = 86400;
    global CALL_START_MARGIN: u64 = 7200;

    #[derive(Deserialize, Eq, Serialize, Packable)]
    #[note]
    pub struct RequestControlNote { pub schema: Field, pub request_id: Field }

    #[derive(Deserialize, Eq, Serialize, Packable)]
    pub struct Request {
        pub state: u8,
        pub invocation_hash: Field,
        pub sequence: u32,
        pub deadline: u64,
        pub budget: u128,
        pub available: u128,
        pub reserved: u128,
        pub charged: u128,
        pub refunded: u128,
        pub primary_refund: Field,
        pub secondary_refund: Field,
        pub primary_done: bool,
        pub secondary_done: bool,
        pub receipt: Field,
    }

    #[event]
    struct AccountingChanged {
        request_id: Field, state: u8, sequence: u32, budget: u128,
        available: u128, reserved: u128, charged: u128, refunded: u128, trailer: Field,
    }

    #[storage]
    struct Storage<Context> {
        board: PublicImmutable<AztecAddress, Context>,
        operator: PublicImmutable<AztecAddress, Context>,
        owner: PublicImmutable<AztecAddress, Context>,
        portal: PublicImmutable<EthAddress, Context>,
        l1_chain: PublicImmutable<Field, Context>,
        version: PublicImmutable<Field, Context>,
        balances: Owned<BalanceSet<Context>, Context>,
        controls: Owned<PrivateSet<RequestControlNote, Context>, Context>,
        requests: Map<Field, PublicMutable<Request, Context>, Context>,
        earnings: PublicMutable<u128, Context>,
    }

    #[external("public")]
    #[initializer]
    fn init(board: AztecAddress, operator: AztecAddress, l1_chain: Field, version: Field) {
        assert((board != AztecAddress::zero()) & (operator != AztecAddress::zero()), "Invalid public identity");
        assert((l1_chain != 0) & (version != 0), "Invalid network");
        self.storage.board.initialize(board); self.storage.operator.initialize(operator);
        self.storage.owner.initialize(self.msg_sender());
        self.storage.l1_chain.initialize(l1_chain); self.storage.version.initialize(version);
    }

    #[external("public")]
    fn set_portal(portal: EthAddress) {
        assert(self.msg_sender() == self.storage.owner.read(), "Only deployment owner");
        portal.validate(); assert(portal.to_field() != 0, "Invalid portal");
        assert(!self.storage.portal.is_initialized(), "Portal immutable");
        self.storage.portal.initialize(portal);
        let content = sha256_to_field(words("PLUGIN_READY_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read()]));
        self.context.message_portal(portal, content);
    }

    #[external("private")]
    fn claim(amount: u128, recipient_salt: Field, bridge_secret: Field, leaf_index: Field) {
        assert(amount > 0, "Empty deposit"); assert(recipient_salt != 0, "Empty recipient salt");
        let sender = self.msg_sender(); let portal = self.storage.portal.read();
        let commitment = recipient_commitment(self.storage.l1_chain.read(), portal, self.address,
            self.storage.version.read(), sender, recipient_salt);
        assert(commitment != 0, "Empty recipient commitment");
        let content = sha256_to_field(words("PLUGIN_CREDIT_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read(), commitment, amount as Field]));
        self.context.consume_l1_to_l2_message(content, [bridge_secret], portal, leaf_index);
        self.storage.balances.at(sender).add(amount).deliver(MessageDelivery::onchain_constrained());
    }

    #[internal("private")]
    fn subtract(account: AztecAddress, amount: u128, max_notes: u32) -> u128 {
        let removed = self.storage.balances.at(account).try_sub(amount, max_notes);
        if removed >= amount { removed - amount }
        else {
            assert(removed > 0, "Insufficient private credit");
            self.call_self.subtract_more(account, amount - removed)
        }
    }

    #[external("private")]
    #[only_self]
    fn subtract_more(account: AztecAddress, amount: u128) -> u128 {
        self.internal.subtract(account, amount, 8)
    }

    #[external("private")]
    fn authorize_request(request_id: Field, invocation_hash: Field, budget: u128) {
        assert((request_id != 0) & (invocation_hash != 0) & (budget > 0), "Invalid request");
        let sender = self.msg_sender();
        let change = self.internal.subtract(sender, budget, 2);
        self.storage.balances.at(sender).add(change).deliver(MessageDelivery::onchain_constrained());
        self.storage.controls.at(sender).insert(RequestControlNote { schema: 1, request_id }).deliver(MessageDelivery::onchain_constrained());
        let primary = UintNote::partial(sender, self.context, sender, self.address);
        let secondary = UintNote::partial(sender, self.context, sender, self.address);
        self.enqueue_self._open_escrow(request_id, invocation_hash, budget, primary, secondary);
    }

    #[external("public")]
    #[only_self]
    fn _open_escrow(request_id: Field, invocation_hash: Field, budget: u128, primary: PartialUintNote, secondary: PartialUintNote) {
        assert(self.storage.requests.at(request_id).read().state == 0, "Duplicate request");
        assert((primary.to_field() != 0) & (secondary.to_field() != 0) & (primary != secondary), "Invalid refund channels");
        let request = Request { state: WAITING, invocation_hash, sequence: 0, deadline: self.context.timestamp() + REQUEST_LIFETIME,
            budget, available: budget, reserved: 0, charged: 0, refunded: 0,
            primary_refund: primary.to_field(), secondary_refund: secondary.to_field(),
            primary_done: false, secondary_done: false, receipt: 0 };
        Accounting::save(self.context, self.storage, request_id, request);
    }

    #[external("public")]
    fn on_invocation(request_id: Field, derived_invocation_hash: Field) {
        assert(self.msg_sender() == self.storage.board.read(), "Only configured board");
        let mut request = self.storage.requests.at(request_id).read();
        assert(request.state == WAITING, "Request not waiting");
        assert(request.invocation_hash == derived_invocation_hash, "Invocation target mismatch");
        assert(self.context.timestamp() < request.deadline, "Request expired");
        request.state = ACTIVE;
        Accounting::save(self.context, self.storage, request_id, request);
    }

    #[external("public")]
    fn reserve(request_id: Field, call_id: u32, maximum: u128) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let mut request = self.storage.requests.at(request_id).read();
        assert(request.state == ACTIVE, "Request not active");
        assert(self.context.timestamp() + CALL_START_MARGIN < request.deadline, "Call start deadline");
        assert(request.sequence == call_id, "Wrong call sequence");
        assert(request.reserved == 0, "Reservation unresolved");
        assert((maximum > 0) & (maximum <= request.available), "Invalid reservation");
        request.available -= maximum; request.reserved = maximum;
        Accounting::save(self.context, self.storage, request_id, request);
    }

    #[external("public")]
    fn settle(request_id: Field, call_id: u32, actual: u128, receipt: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let request = self.storage.requests.at(request_id).read();
        assert(request.state == ACTIVE, "Request not active");
        assert(self.context.timestamp() < request.deadline, "Expire then reconcile");
        let updated = Accounting::charge(self.context, self.storage, request, call_id, actual, receipt);
        Accounting::save(self.context, self.storage, request_id, updated);
    }

    /// Publishing is separate from settlement and finish. A failed publication
    /// cannot authorize another model call or erase uncertain reserved liability.
    #[external("public")]
    fn publish_reply(request_id: Field, plugin_id: Field, message: [Field; 32], length: u16,
        expected_main_version: u32, expected_local_version: u32) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let request = self.storage.requests.at(request_id).read();
        assert(request.state == ACTIVE, "Request not active");
        assert(self.context.timestamp() < request.deadline, "Request expired");
        assert(request.reserved == 0, "Reservation unresolved");
        let selector = comptime { aztec::protocol::abis::function_selector::FunctionSelector::from_signature("publish_plugin_reply(Field,Field,[Field;32],u16,u32,u32)") };
        let args = [request_id, plugin_id].concat(message).concat([length as Field, expected_main_version as Field, expected_local_version as Field]);
        let _ = self.context.call_public_function(self.storage.board.read(), selector, args, aztec::context::gas::GasOpts::default());
    }

    #[external("public")]
    fn finish(request_id: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let request = self.storage.requests.at(request_id).read();
        assert(request.state == ACTIVE, "Request not active");
        assert(request.reserved == 0, "Reservation unresolved");
        Accounting::finish(self.context, self.storage, request_id, request);
    }

    // Stop an uncertain call immediately, without refunding its potentially spent liability.
    #[external("public")]
    fn close_uncertain(request_id: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let request = self.storage.requests.at(request_id).read();
        assert((request.state == ACTIVE) & (request.reserved > 0), "No active uncertain reservation");
        Accounting::fence(self.context, self.storage, request_id, request);
    }

    // Anyone may trigger expiry without exposing their account as a public caller.
    #[external("private")]
    fn expire(request_id: Field) {
        self.enqueue_self._expire(request_id);
    }

    #[external("public")]
    #[only_self]
    fn _expire(request_id: Field) {
        let request = self.storage.requests.at(request_id).read();
        assert((request.state == WAITING) | (request.state == ACTIVE), "Request not expirable");
        assert(self.context.timestamp() >= request.deadline, "Request not expired");
        if request.reserved == 0 { Accounting::finish(self.context, self.storage, request_id, request); }
        else { Accounting::fence(self.context, self.storage, request_id, request); }
    }

    #[external("public")]
    fn reconcile(request_id: Field, call_id: u32, actual: u128, receipt: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let request = self.storage.requests.at(request_id).read();
        assert(request.state == FENCED, "Request not fenced");
        assert(request.primary_done, "Unused credit not released");
        let mut updated = Accounting::charge(self.context, self.storage, request, call_id, actual, receipt);
        let refund = updated.available; updated.available = 0; updated.state = CLOSED;
        updated = Accounting::refund(self.context, self.storage, updated, true, refund);
        Accounting::save(self.context, self.storage, request_id, updated);
    }

    #[external("private")]
    fn cancel(request_id: Field) {
        let options = NoteGetterOptions::<RequestControlNote, 2, Field, Field>::new()
            .select(RequestControlNote::properties().request_id, Comparator.EQ, request_id).set_limit(1);
        let notes = self.storage.controls.at(self.msg_sender()).pop_notes(options);
        assert(notes.len() == 1, "No owned request control");
        let note = notes.get_unchecked(0);
        assert((note.schema == 1) & (note.request_id == request_id), "Invalid control note");
        // Keep wallet-local history recoverable after cancellation. The public
        // state transition still rejects a second cancellation atomically.
        self.storage.controls.at(self.msg_sender()).insert(note).deliver(MessageDelivery::onchain_constrained());
        self.enqueue_self._cancel(request_id);
    }

    #[external("public")]
    #[only_self]
    fn _cancel(request_id: Field) {
        let request = self.storage.requests.at(request_id).read();
        assert((request.state == WAITING) | (request.state == ACTIVE), "Request not cancellable");
        assert(request.reserved == 0, "Reservation unresolved");
        Accounting::finish(self.context, self.storage, request_id, request);
    }

    #[external("private")]
    fn withdraw(amount: u128, recipient: EthAddress, nonce: Field) {
        recipient.validate(); assert((recipient.to_field() != 0) & (amount > 0) & (nonce != 0), "Invalid withdrawal");
        let sender = self.msg_sender(); let change = self.internal.subtract(sender, amount, 2);
        self.storage.balances.at(sender).add(change).deliver(MessageDelivery::onchain_constrained());
        self.context.push_nullifier_unsafe(poseidon2_hash_with_separator([nonce], 0x424b5701));
        let portal = self.storage.portal.read();
        self.context.message_portal(portal, sha256_to_field(words("PLUGIN_EXIT_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read(), recipient.to_field(), amount as Field, nonce])));
    }

    #[external("public")]
    fn withdraw_earnings(amount: u128, recipient: EthAddress, nonce: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        recipient.validate(); assert((recipient.to_field() != 0) & (amount > 0) & (nonce != 0), "Invalid withdrawal");
        let earnings = self.storage.earnings.read(); assert(amount <= earnings, "Insufficient operator earnings");
        self.storage.earnings.write(earnings - amount);
        self.context.push_nullifier_unsafe(poseidon2_hash_with_separator([nonce], 0x424b5701));
        let portal = self.storage.portal.read();
        self.context.message_portal(portal, sha256_to_field(words("PLUGIN_EXIT_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read(), recipient.to_field(), amount as Field, nonce])));
    }

    #[external("utility")]
    unconstrained fn balance_of(account: AztecAddress) -> u128 { self.storage.balances.at(account).balance_of() }
    /// Wallet-local ownership discovery only, never a public account-group API.
    /// A full page does not establish exhaustion; callers must bind pagination
    /// to one synced canonical anchor and request the following page.
    #[external("utility")]
    unconstrained fn owned_requests(owner: AztecAddress, page_offset: u32) -> pub [Field; 8] {
        let options = NoteViewerOptions::<RequestControlNote, 2>::new().set_limit(8).set_offset(page_offset);
        let notes = self.storage.controls.at(owner).view_notes(options);
        let mut result = [0; 8];
        for i in 0..8 {
            if i < notes.len() {
                let note = notes.get_unchecked(i);
                assert((note.schema == 1) & (note.request_id != 0), "Invalid control note");
                result[i] = note.request_id;
            }
        }
        result
    }
    #[external("public")] #[view]
    fn request(request_id: Field) -> pub Request { self.storage.requests.at(request_id).read() }
    #[external("public")] #[view]
    fn earned() -> pub u128 { self.storage.earnings.read() }

    struct Accounting {}
    impl Accounting {
        unconstrained fn save(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, id: Field, request: Request) {
            assert(request.available + request.reserved + request.charged + request.refunded == request.budget, "Request conservation failure");
            storage.requests.at(id).write(request);
            aztec::event::event_emission::emit_event_in_public(context, AccountingChanged { request_id: id,
                state: request.state, sequence: request.sequence, budget: request.budget, available: request.available,
                reserved: request.reserved, charged: request.charged, refunded: request.refunded, trailer: 1 });
        }

        unconstrained fn refund(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, request: Request, secondary: bool, amount: u128) -> Request {
            let mut updated = request;
            let commitment = if secondary {
                assert(!request.secondary_done, "Secondary refund already completed");
                updated.secondary_done = true; request.secondary_refund
            } else {
                assert(!request.primary_done, "Primary refund already completed");
                updated.primary_done = true; request.primary_refund
            };
            updated.refunded += amount;
            if amount > 0 {
                PartialUintNote::from_field(commitment).complete(context, context.this_address(), storage.balances.get_storage_slot(), amount);
            }
            updated
        }

        unconstrained fn finish(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, id: Field, request: Request) {
            assert(request.reserved == 0, "Reservation unresolved");
            let mut updated = request; let amount = request.available;
            updated.available = 0; updated.state = CLOSED;
            assert(!updated.secondary_done, "Secondary refund already completed");
            updated.secondary_done = true;
            updated = Self::refund(context, storage, updated, false, amount);
            Self::save(context, storage, id, updated);
        }

        unconstrained fn fence(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, id: Field, request: Request) {
            let mut updated = request; let amount = request.available;
            updated.available = 0; updated.state = FENCED;
            updated = Self::refund(context, storage, updated, false, amount);
            Self::save(context, storage, id, updated);
        }

        unconstrained fn charge(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, request: Request, call_id: u32, actual: u128, receipt: Field) -> Request {
            assert(request.sequence == call_id, "Wrong call sequence");
            assert((request.reserved > 0) & (actual <= request.reserved), "Invalid actual charge");
            assert(receipt != 0, "Receipt required");
            context.push_nullifier_unsafe(poseidon2_hash_with_separator([receipt], 0x424b5201));
            let mut updated = request;
            updated.available += request.reserved - actual; updated.reserved = 0;
            updated.charged += actual; updated.sequence += 1; updated.receipt = receipt;
            storage.earnings.write(storage.earnings.read() + actual);
            updated
        }
    }
}
