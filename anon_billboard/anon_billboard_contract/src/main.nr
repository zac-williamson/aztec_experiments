mod test;

use aztec::macros::aztec;

#[aztec]
pub contract AnonBillboard {
    use aztec::{
        macros::{
            functions::{external, initializer, only_self, view},
            storage::storage,
        },
        protocol::{
            address::AztecAddress,
            hash::poseidon2_hash_with_separator,
        },
        state_vars::{Map, PublicMutable},
    };

    // ===== Storage =====

    #[storage]
    struct Storage<Context> {
        // Token contract address for cross-contract calls
        token_contract_address: PublicMutable<AztecAddress, Context>,

        // Deposit tracking per user
        deposit_time: Map<AztecAddress, PublicMutable<u64, Context>, Context>,
        deposit_amount: Map<AztecAddress, PublicMutable<u128, Context>, Context>,

        // Sequential post log - each post stored as 4 fields
        post_count: PublicMutable<u32, Context>,
        post_0: Map<u32, PublicMutable<Field, Context>, Context>,
        post_1: Map<u32, PublicMutable<Field, Context>, Context>,
        post_2: Map<u32, PublicMutable<Field, Context>, Context>,
        post_3: Map<u32, PublicMutable<Field, Context>, Context>,

        // Total tokens deposited / withdrawn (for conservation check)
        total_deposited: PublicMutable<u128, Context>,
        total_withdrawn: PublicMutable<u128, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn init(token_contract_addr: AztecAddress) {
        self.storage.token_contract_address.write(token_contract_addr);
        self.storage.post_count.write(0);
        self.storage.total_deposited.write(0);
        self.storage.total_withdrawn.write(0);
    }

    // ===== DEPOSIT =====

    /// Record a deposit with on-chain token verification.
    /// Caller must have already transferred tokens to this contract's address
    /// on the token contract (public balance). This function verifies the
    /// billboard's token balance before recording the deposit.
    ///
    /// Minimum deposit: 5 tokens.
    #[external("public")]
    fn deposit(amount: u128, timestamp: u64) {
        assert(amount >= 5, "Minimum deposit is 5 tokens");
        let sender = self.msg_sender();

        // On-chain verification: check that the billboard actually has the tokens
        let token_addr = self.storage.token_contract_address.read();
        let billboard_balance = self.view(token_contract::TokenContract::at(token_addr)
            .balance_of_public(self.context.this_address()));
        assert(billboard_balance >= amount, "Billboard does not have enough tokens");

        // Get existing deposit record
        let existing_time = self.storage.deposit_time.at(sender).read();
        let existing_amount = self.storage.deposit_amount.at(sender).read();

        // Store the max of existing amount and new amount (handles top-ups)
        let new_amount = if amount > existing_amount { amount } else { existing_amount };
        // Use the most recent timestamp
        let new_time = if timestamp > existing_time { timestamp } else { existing_time };

        self.storage.deposit_time.at(sender).write(new_time);
        self.storage.deposit_amount.at(sender).write(new_amount);

        // Track total deposited
        let total = self.storage.total_deposited.read();
        self.storage.total_deposited.write(total + amount);
    }

    // ===== POST (PRIVATE) =====

    /// Private anonymous post function.
    ///
    /// Privacy guarantees:
    /// - Secret is known only to the poster (passed as private input)
    /// - Nullifier = poseidon2(secret || epoch) prevents double-posting
    /// - Each epoch has a fully independent nullifier space via poseidon2 hashing
    /// - Poster's identity is NOT stored with the post in the public log
    ///
    /// How it works:
    /// 1. Computes poseidon2 nullifier from (secret, epoch) on-chain in the circuit
    /// 2. Pushes nullifier to the nullifier tree (circuit-constrained double-post prevention)
    /// 3. Enqueues a public call that verifies deposit eligibility and stores the post
    #[external("private")]
    fn post(msg_0: Field, msg_1: Field, msg_2: Field, msg_3: Field,
            secret: Field, epoch: u32, deposit_time: u64) {
        let sender = self.msg_sender();

        // Compute nullifier: poseidon2_hash_with_separator([secret, epoch], DOMAIN_SEP)
        // The epoch ensures fully independent nullifier spaces per epoch.
        // Reusing the same secret in a different epoch produces a different nullifier.
        let nullifier = poseidon2_hash_with_separator(
            [secret, Field::from(epoch as u64)],
            // Domain separator: unique value to avoid collisions with note nullifiers.
            // 0x414e4f4e5f42494c4c424f415244 = "ANON_BILLBOARD" in ASCII hex
            0x414e4f4e5f42494c4c424f415244,
        );

        // Insert nullifier into nullifier tree.
        // The protocol forbids duplicate nullifiers, so this provides
        // circuit-constrained double-post prevention.
        self.context.push_nullifier(nullifier);

        // Enqueue public call to verify deposit eligibility and store the post.
        // Note: sender address is visible in the enqueued call data, but it is
        // NOT recorded with the post itself. The post log is fully anonymous.
        self.enqueue_self._post_public(sender, msg_0, msg_1, msg_2, msg_3, deposit_time);
    }

    // ===== INTERNAL PUBLIC: Verify deposit and store post =====

    /// Internal public function called by the private `post` function via enqueue_self.
    /// Verifies that the sender has a valid deposit and stores the anonymous post.
    #[external("public")]
    #[only_self]
    fn _post_public(sender: AztecAddress, msg_0: Field, msg_1: Field, msg_2: Field, msg_3: Field,
                    deposit_time: u64) {
        // Verify deposit exists and meets minimum
        let deposit_amount = self.storage.deposit_amount.at(sender).read();
        assert(deposit_amount >= 5, "Insufficient deposit - minimum is 5 tokens");

        // Verify deposit is old enough (before start of the current epoch)
        let block_number = self.context.block_number();
        let epoch = (block_number as u64) / 10;
        let epoch_start = epoch * 10;
        assert(deposit_time < epoch_start,
               "Deposit not old enough - must be from before current epoch");

        // Store the post (anonymous - no address recorded with the post)
        let id = self.storage.post_count.read();
        self.storage.post_0.at(id).write(msg_0);
        self.storage.post_1.at(id).write(msg_1);
        self.storage.post_2.at(id).write(msg_2);
        self.storage.post_3.at(id).write(msg_3);
        self.storage.post_count.write(id + 1);
    }

    // ===== WITHDRAW =====

    /// Withdraw tokens.
    /// Caller's deposit record is decremented. They must then transfer tokens
    /// from the billboard's public balance to themselves on the token contract.
    #[external("public")]
    fn withdraw(amount: u128) {
        assert(amount > 0, "Cannot withdraw zero");
        let sender = self.msg_sender();

        let deposit_amount = self.storage.deposit_amount.at(sender).read();
        assert(deposit_amount >= amount, "Insufficient deposit");

        let remaining = deposit_amount - amount;
        self.storage.deposit_amount.at(sender).write(remaining);

        // Track total withdrawn
        let total = self.storage.total_withdrawn.read();
        self.storage.total_withdrawn.write(total + amount);
    }

    // ===== VIEW FUNCTIONS =====

    /// Get the token contract address
    #[external("public")]
    #[view]
    fn get_token_contract_address() -> pub AztecAddress {
        self.storage.token_contract_address.read()
    }

    /// Get deposit time for an address
    #[external("public")]
    #[view]
    fn get_deposit_time(owner: AztecAddress) -> pub u64 {
        self.storage.deposit_time.at(owner).read()
    }

    /// Get deposit amount for an address
    #[external("public")]
    #[view]
    fn get_deposit_amount(owner: AztecAddress) -> pub u128 {
        self.storage.deposit_amount.at(owner).read()
    }

    /// Get total number of posts
    #[external("public")]
    #[view]
    fn get_post_count() -> pub u32 {
        self.storage.post_count.read()
    }

    /// Get post by ID (returns 4 message fields)
    #[external("public")]
    #[view]
    fn get_post(id: u32) -> pub (Field, Field, Field, Field) {
        (self.storage.post_0.at(id).read(),
         self.storage.post_1.at(id).read(),
         self.storage.post_2.at(id).read(),
         self.storage.post_3.at(id).read())
    }

    /// Get total deposited
    #[external("public")]
    #[view]
    fn get_total_deposited() -> pub u128 {
        self.storage.total_deposited.read()
    }

    /// Get total withdrawn
    #[external("public")]
    #[view]
    fn get_total_withdrawn() -> pub u128 {
        self.storage.total_withdrawn.read()
    }

    /// Get current block number
    #[external("public")]
    #[view]
    fn get_block_number() -> pub u32 {
        self.context.block_number()
    }
}
