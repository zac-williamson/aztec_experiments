use aztec::macros::aztec;

#[aztec]
pub contract RestrictedSponsor {
    use aztec::{
        macros::{functions::{allow_phase_change, external, initializer, view}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Map, Owned, PublicImmutable, SingleUseClaim},
    };
    use fee_common::{Policy, validate_policy, validate_coupon, validate_gas_and_time};
    use fee_target::FeeTarget;

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        policy: PublicImmutable<Policy, Context>,
        claims: Map<u32, Owned<SingleUseClaim<Context>, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    // Separate one-time configuration avoids a sponsor-address / coupon-root deployment cycle.
    #[external("public")]
    fn configure(policy: Policy) {
        assert(self.msg_sender() == self.storage.admin.read(), "only policy admin");
        validate_policy(policy);
        self.storage.policy.initialize(policy);
    }

    #[external("public")]
    #[view]
    fn get_policy() -> Policy {
        self.storage.policy.read()
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsor(owner: AztecAddress, index: u32, blind: Field, sibling: Field, value: u32, nonce: Field) {
        assert(self.context.maybe_msg_sender().is_none(), "sponsor must be transaction root");
        let policy = self.storage.policy.read();
        validate_coupon(policy, self.context.chain_id(), self.context.version(), self.address, index, owner, blind, sibling);
        validate_gas_and_time(policy, self.context.gas_settings(), self.context.get_anchor_block_header().timestamp());
        // Bind actual inclusion expiration, not just the anchor timestamp used above.
        self.context.set_expiration_timestamp(policy.valid_until);
        // One owner is committed at each of the two fixed indices. The nullifier uses the owner's private NHK.
        // Before end_setup: a subsequent public application revert must still consume the paid ticket.
        self.storage.claims.at(index).at(owner).claim();
        self.context.set_as_fee_payer();
        self.context.end_setup();
        self.call(FeeTarget::at(policy.target).delegated(owner, value, nonce));
    }
}
