use aztec::macros::aztec;

// Adversarial test-only caller. It must never be an allowed route to sponsored payment.
#[aztec]
pub contract NestedCaller {
    use aztec::{macros::functions::{allow_phase_change, external}, protocol::address::AztecAddress};
    use fee_sponsor::RestrictedSponsor;

    #[external("private")]
    #[allow_phase_change]
    fn attempt(sponsor: AztecAddress, owner: AztecAddress, sibling: Field) {
        self.call(RestrictedSponsor::at(sponsor).sponsor(owner,0,13,sibling,3,1));
    }
    #[external("private")]
    fn forward(target: AztecAddress, owner: AztecAddress, value: u32, nonce: Field) {
        self.call(fee_target::FeeTarget::at(target).delegated(owner,value,nonce));
    }
}
