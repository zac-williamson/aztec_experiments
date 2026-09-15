use aztec::macros::aztec;

#[aztec]
pub contract BillboardSponsor {
    use aztec::{macros::{functions::{allow_phase_change, external, initializer, internal, view}, storage::storage},
        note::HintedNote, protocol::{address::{AztecAddress, EthAddress}, traits::ToField},
        state_vars::{Map, Owned, PublicImmutable, PublicMutable, SingleUseClaim}};
    use billboard_contract::{Billboard, Billboard::PostNote};
    use sponsor_common::{SponsorConfig, Batch, TREE_DEPTH, validate_config, reserve_batch,
        validate_coupon, validate_gas, window_bounds};

    #[storage]
    struct Storage<Context> {
        config: PublicImmutable<SponsorConfig, Context>,
        admin: PublicMutable<AztecAddress, Context>,
        batches: Map<u64, PublicImmutable<Batch, Context>, Context>,
        reserved_by_window: Map<u64, PublicMutable<u128, Context>, Context>,
        claims: Map<u64, Map<u32, Owned<SingleUseClaim<Context>, Context>, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, config: SponsorConfig) {
        assert(admin.to_field() != 0, "Sponsor zero admin");
        validate_config(config);
        self.storage.config.initialize(config);
        self.storage.admin.write(admin);
    }

    #[external("public")]
    fn rotate_admin(next_admin: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "Sponsor only admin");
        assert(next_admin.to_field() != 0, "Sponsor zero admin");
        self.storage.admin.write(next_admin);
        // Existing batches and reservations stay immutable; this cannot revoke a coupon.
    }

    #[external("public")]
    fn register_batch(batch_id: u64, root: Field, window: u64, ticket_count: u32) {
        assert(self.msg_sender() == self.storage.admin.read(), "Sponsor only admin");
        assert(!self.storage.batches.at(batch_id).is_initialized(), "Sponsor batch id already registered");
        let config = self.storage.config.read();
        let batch = Batch { root, window, ticket_count };
        let reserved = self.storage.reserved_by_window.at(window).read();
        let next_reserved = reserve_batch(config, batch_id, batch, reserved, self.context.timestamp());
        // Both writes execute in one public call. No private mutable budget read,
        // reclaim operation, reserve reset, or batch replacement exists.
        self.storage.batches.at(batch_id).initialize(batch);
        self.storage.reserved_by_window.at(window).write(next_reserved);
    }

    #[internal("private")]
    fn _consume_coupon(owner: AztecAddress, batch_id: u64, index: u32, blind: Field, siblings: [Field; TREE_DEPTH]) -> SponsorConfig {
        assert(self.context.maybe_msg_sender().is_none(), "Sponsor must be transaction root");
        let config = self.storage.config.read();
        let batch = self.storage.batches.at(batch_id).read();
        validate_coupon(batch, self.context.chain_id(), self.context.version(), self.address, batch_id, index, owner, blind, siblings);
        let (start, end) = window_bounds(config.window_duration, batch.window);
        let anchor_time = self.context.get_anchor_block_header().timestamp();
        assert(anchor_time >= start, "Sponsor coupon not active");
        assert(anchor_time <= end, "Sponsor coupon expired at anchor");
        validate_gas(config, self.context.gas_settings());
        // The protocol also enforces the minimum of this deadline and its transaction lifetime.
        self.context.set_expiration_timestamp(end);
        // Global immutable batch ID + fixed index + committed owner. The claim
        // uses the owner's NHK; membership inputs remain private.
        self.storage.claims.at(batch_id).at(index).at(owner).claim();
        config
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor_claim(owner: AztecAddress, batch_id: u64, index: u32, blind: Field, siblings: [Field; TREE_DEPTH],
        depositor: EthAddress, amount: u128, deposit_nonce: u64, secret: Field, message_leaf_index: Field, auth_nonce: Field) {
        let config = self.internal._consume_coupon(owner, batch_id, index, blind, siblings);
        self.context.set_as_fee_payer();
        self.context.end_setup();
        self.call(Billboard::at(config.board).delegated_claim_deposit(owner, depositor, amount, deposit_nonce, secret, message_leaf_index, auth_nonce));
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor_post(owner: AztecAddress, batch_id: u64, index: u32, blind: Field, siblings: [Field; TREE_DEPTH],
        deposit_chain_id: Field, post_nonce: Field, msg: [Field;32], message_length: u16, is_dummy: bool,
        child: Option<HintedNote<PostNote>>, grandchild: Option<HintedNote<PostNote>>, auth_nonce: Field) {
        // Pending metadata changes meaning across end_setup. The board only accepts
        // historical membership anyway: explicitly require settled hints here.
        if child.is_some() { assert(child.unwrap_unchecked().metadata.is_settled(), "Sponsor child must be settled"); }
        if grandchild.is_some() { assert(grandchild.unwrap_unchecked().metadata.is_settled(), "Sponsor grandchild must be settled"); }
        let config = self.internal._consume_coupon(owner, batch_id, index, blind, siblings);
        self.context.set_as_fee_payer();
        self.context.end_setup();
        self.call(Billboard::at(config.board).delegated_post(owner, deposit_chain_id, post_nonce, msg, message_length, is_dummy, child, grandchild, auth_nonce));
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor_withdraw(owner: AztecAddress, batch_id: u64, index: u32, blind: Field, siblings: [Field; TREE_DEPTH],
        deposit_chain_id: Field, auth_nonce: Field) {
        let config = self.internal._consume_coupon(owner, batch_id, index, blind, siblings);
        self.context.set_as_fee_payer();
        self.context.end_setup();
        self.call(Billboard::at(config.board).delegated_withdraw(owner, deposit_chain_id, auth_nonce));
    }

    #[external("public")]
    #[view]
    fn get_config() -> SponsorConfig { self.storage.config.read() }
    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress { self.storage.admin.read() }
    #[external("public")]
    #[view]
    fn get_batch(batch_id: u64) -> Batch {
        // Public discovery must distinguish absent batches from failed RPC reads.
        // Spending still uses the checked immutable read in _consume_coupon.
        let batch = self.storage.batches.at(batch_id);
        if batch.is_initialized() { batch.read() }
        else { Batch { root: 0, window: 0, ticket_count: 0 } }
    }
    #[external("public")]
    #[view]
    fn get_reserved(window: u64) -> u128 { self.storage.reserved_by_window.at(window).read() }
}
