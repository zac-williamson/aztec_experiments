mod test;

use aztec::macros::aztec;

#[aztec]
pub contract TokenContract {
    use aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        protocol::address::AztecAddress,
        state_vars::{Map, Owned, PublicMutable},
    };
    use balance_set::BalanceSet;

    // Events
    #[event]
    struct Transfer {
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
    }

    // Storage
    #[storage]
    struct Storage<Context> {
        total_supply: PublicMutable<u128, Context>,
        private_balances: Owned<BalanceSet<Context>, Context>,
        public_balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
    }

    // Constructor - deploys the token with initial supply minted publicly to `to`.
    #[external("public")]
    #[initializer]
    fn constructor(initial_supply: u128, to: AztecAddress) {
        self.internal._mint_to_public(to, initial_supply);
    }

    // ===== PRIVATE FUNCTIONS =====

    /// Transfer tokens from private balance to another private balance.
    #[external("private")]
    fn transfer_private_to_private(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
    ) {
        assert(amount > 0, "Cannot transfer zero");
        self.internal._decrease_private_balance(from, amount);
        self.internal._increase_private_balance(to, amount);
    }

    /// Transfer tokens from private balance to a public balance.
    #[external("private")]
    fn transfer_private_to_public(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
    ) {
        assert(amount > 0, "Cannot transfer zero");
        self.internal._decrease_private_balance(from, amount);
        self.enqueue_self.increase_public_balance_internal(to, amount);
    }

    /// Transfer tokens from a public balance into the caller's private balance.
    #[external("private")]
    fn transfer_public_to_private(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
    ) {
        assert(amount > 0, "Cannot transfer zero");
        self.enqueue_self.decrease_public_balance_internal(from, amount);
        self.internal._increase_private_balance(to, amount);
    }

    // ===== PUBLIC FUNCTIONS =====

    /// Transfer tokens between public balances.
    #[external("public")]
    fn transfer_public_to_public(
        from: AztecAddress,
        to: AztecAddress,
        amount: u128,
    ) {
        assert(amount > 0, "Cannot transfer zero");
        self.internal._decrease_public_balance(from, amount);
        self.internal._increase_public_balance(to, amount);
        self.emit(Transfer { from, to, amount });
    }

    /// Increase a public balance (only-self, called after private to public transfers).
    #[external("public")]
    #[only_self]
    fn increase_public_balance_internal(to: AztecAddress, amount: u128) {
        self.internal._increase_public_balance(to, amount);
    }

    /// Decrease a public balance (only-self, called after public to private transfers).
    #[external("public")]
    #[only_self]
    fn decrease_public_balance_internal(from: AztecAddress, amount: u128) {
        self.internal._decrease_public_balance(from, amount);
    }

    // ===== MINTING =====

    /// Mint tokens to a private balance.
    #[external("private")]
    fn mint_to_private(to: AztecAddress, amount: u128) {
        self.internal._increase_private_balance(to, amount);
        self.enqueue_self.increase_total_supply_internal(amount);
    }

    /// Mint tokens to a public balance.
    #[external("public")]
    fn mint_to_public(to: AztecAddress, amount: u128) {
        self.internal._mint_to_public(to, amount);
    }

    /// Increase total supply (only-self, called after private mints).
    #[external("public")]
    #[only_self]
    fn increase_total_supply_internal(amount: u128) {
        self.internal._increase_total_supply(amount);
    }

    // ===== VIEW / UTILITY FUNCTIONS =====

    /// Returns the public balance of `owner`.
    #[external("public")]
    #[view]
    fn balance_of_public(owner: AztecAddress) -> pub u128 {
        self.storage.public_balances.at(owner).read()
    }

    /// Returns the total supply of the token.
    #[external("public")]
    #[view]
    fn total_supply() -> pub u128 {
        self.storage.total_supply.read()
    }

    /// Returns the private balance of an account (runs off-chain via the PXE).
    #[external("utility")]
    unconstrained fn balance_of_private(owner: AztecAddress) -> pub u128 {
        self.storage.private_balances.at(owner).balance_of()
    }

    // ===== INTERNAL HELPERS =====

    #[internal("private")]
    fn _decrease_private_balance(account: AztecAddress, amount: u128) {
        self.storage.private_balances.at(account).sub(amount).deliver(
            MessageDelivery.ONCHAIN_CONSTRAINED,
        );
    }

    #[internal("private")]
    fn _increase_private_balance(to: AztecAddress, amount: u128) {
        self.storage.private_balances.at(to).add(amount).deliver(
            MessageDelivery.ONCHAIN_CONSTRAINED,
        );
    }

    #[internal("public")]
    fn _increase_public_balance(to: AztecAddress, amount: u128) {
        let current = self.storage.public_balances.at(to).read();
        self.storage.public_balances.at(to).write(current + amount);
    }

    #[internal("public")]
    fn _decrease_public_balance(from: AztecAddress, amount: u128) {
        let current = self.storage.public_balances.at(from).read();
        self.storage.public_balances.at(from).write(current - amount);
    }

    #[internal("public")]
    fn _mint_to_public(to: AztecAddress, amount: u128) {
        self.internal._increase_public_balance(to, amount);
        self.internal._increase_total_supply(amount);
        self.emit(Transfer { from: AztecAddress::zero(), to, amount });
    }

    #[internal("public")]
    fn _increase_total_supply(amount: u128) {
        let current = self.storage.total_supply.read();
        self.storage.total_supply.write(current + amount);
    }
}
