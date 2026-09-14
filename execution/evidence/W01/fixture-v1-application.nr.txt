use aztec::macros::aztec;

// Deliberately small delegated application, not the production Billboard ABI.
#[aztec]
pub contract FeeTarget {
    use aztec::{
        authwit::auth::assert_current_call_valid_authwit,
        macros::{functions::{external, initializer, only_self, view}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{PublicImmutable, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        sponsor: PublicImmutable<AztecAddress, Context>,
        total: PublicMutable<u64, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(sponsor: AztecAddress) {
        self.storage.sponsor.initialize(sponsor);
    }

    #[external("private")]
    fn delegated(owner: AztecAddress, value: u32, nonce: Field) {
        assert(self.msg_sender() == self.storage.sponsor.read(), "only configured sponsor");
        // All three arguments (including nonce) are bound by the real owner account's authwit.
        assert_current_call_valid_authwit::<3>(self.context, owner);
        self.enqueue_self._record(value);
    }

    #[external("public")]
    #[only_self]
    fn _record(value: u32) {
        self.storage.total.write(self.storage.total.read() + value as u64);
    }

    #[external("public")]
    #[view]
    fn get_total() -> u64 {
        self.storage.total.read()
    }
}
