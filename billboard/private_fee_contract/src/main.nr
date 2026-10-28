use aztec::macros::aztec;
mod gas;

/// Backed private FEE credits. Every live note is directly spendable in setup.
/// Delivery consists only of public completion metadata; no encrypted payloads.
#[aztec]
pub contract PrivateFPC {
    use aztec::{
        context::PrivateContext,
        hash::{compute_l1_to_l2_message_hash, compute_l1_to_l2_message_nullifier, compute_secret_hash},
        keys::getters::{get_public_keys, get_nhk_app},
        macros::functions::{allow_phase_change, external, internal, only_self},
        nullifier::utils::compute_nullifier_existence_request,
        protocol::{address::{AztecAddress, EthAddress}, constants::FEE_JUICE_ADDRESS,
            hash::{poseidon2_hash_with_separator, sha256_to_field}, point::EmbeddedCurvePoint,
            traits::ToField},
    };
    use private_credit::{CreditInputs, INPUT_CAPSULE_SLOT, OUTPUT_TAG, TIP_TAG, PAID_LIKE_VALUE,
        consume, self_secret, self_blinding, spending_key, commitment, note_hash, create_tip};
    use crate::gas::get_max_gas_cost;
    global DOM_SEP__FPC_BRIDGE_SECRET: u32 = 3952304070;

    struct Credit {}
    impl Credit {
    fn root(context: &mut PrivateContext) -> Field {
        context.request_nhk_app(get_public_keys(context.maybe_msg_sender().unwrap()).npk_m_hash)
    }
    fn inputs(context: &mut PrivateContext) -> CreditInputs {
        // Safety: Capsules are witnesses, never authority: consume constrains every
        // preimage, membership read and nullifier, and all sums are checked u128.
        unsafe { aztec::oracle::capsules::load::<CreditInputs>(context.this_address(),
            INPUT_CAPSULE_SLOT, context.maybe_msg_sender().unwrap()).expect(f"Fee inputs required") }
    }
    fn reserve(context: &mut PrivateContext, reservation: u128) {
        assert(reservation > 0, "Fee reservation must be positive");
        assert(reservation >= get_max_gas_cost(context), "Fee reservation below transaction maximum");
    }
    fn output_commitment(context: &mut PrivateContext, role: u8) -> (Field, u32) {
        let index = context.get_side_effect_counter();
        // protocol_nullifier is a native transaction input, unique even across
        // abandoned simulations. The role/index separate all outputs in a tx.
        let reference = context.finish().protocol_nullifier;
        let secret = self_secret(Credit::root(context), context.chain_id(), context.version(),
            context.this_address(), reference, role, index);
        (commitment(spending_key(secret), self_blinding(secret)), index)
    }
    fn output(context: &mut PrivateContext, value: u128, role: u8, completion: u128) {
        if value > 0 {
            let (partial, index) = Credit::output_commitment(context, role);
            context.push_note_hash(note_hash(partial, value));
            // Shared constant tag; no owner, source post, input commitment or
            // encrypted note delivery. Change exposes only the debit, never
            // its value; the wallet reconstructs value from its spent inputs.
            context.emit_private_log_unsafe(OUTPUT_TAG,
                BoundedVec::from_array([1, role as Field, index as Field, partial, completion as Field, 1]));
        }
    }
    fn refund(context: &mut PrivateContext) -> (Field, u32) {
        let (partial, index) = Credit::output_commitment(context, 2);
        context.push_nullifier_unsafe(poseidon2_hash_with_separator([partial], 0x52435256));
        (partial, index)
    }

    }

    #[external("private")]
    #[allow_phase_change]
    fn pay_fee(reservation: u128) {
        Credit::reserve(self.context, reservation);
        let selected = Credit::inputs(self.context);
        let total = consume(self.context, selected);
        assert(total >= reservation, "Balance too low");
        Credit::output(self.context, total - reservation, 1, reservation);
        let (partial, index) = Credit::refund(self.context);
        self.set_as_teardown(PrivateFPC::at(self.address)._complete_refund(partial, index, reservation, 0));
        self.context.set_as_fee_payer();
        self.context.end_setup();
    }

    /// One transaction: 20 FEE debit, author note, paid-like record and actual gas.
    /// This is the payment payload of an otherwise empty application batch.
    #[external("private")]
    #[allow_phase_change]
    fn pay_like_and_fee(board: AztecAddress, post: Field, key: EmbeddedCurvePoint,
        ephemeral: Field, reservation: u128) {
        Credit::reserve(self.context, reservation);
        assert((board.to_field() != 0) & (post != 0), "Tip destination required");
        let selected = Credit::inputs(self.context);
        let total = consume(self.context, selected);
        let debit = reservation + PAID_LIKE_VALUE;
        assert(total >= debit, "Balance too low");
        Credit::output(self.context, total - debit, 1, debit);
        let (refund_partial, index) = Credit::refund(self.context);
        self.set_as_teardown(PrivateFPC::at(self.address)._complete_refund(refund_partial, index, reservation, PAID_LIKE_VALUE));
        self.context.set_as_fee_payer();
        self.context.end_setup();
        // Tip principal and Board accounting are revertible together. Teardown
        // returns the principal if this phase fails; setup still pays actual gas.
        let (public_ephemeral, partial) = create_tip(key, ephemeral, self.address);
        self.context.push_note_hash(note_hash(partial, PAID_LIKE_VALUE));
        let tag = poseidon2_hash_with_separator([Credit::root(self.context), self.context.chain_id(),
            self.context.version(), board.to_field(), post], 0x52434c31);
        self.enqueue_self._record_paid_like(board, post, key, public_ephemeral, partial, tag, refund_partial);
    }

    #[external("public")]
    #[only_self]
    fn _record_paid_like(board: AztecAddress, post: Field, key: EmbeddedCurvePoint,
        ephemeral: EmbeddedCurvePoint, partial: Field, tag: Field, refund_partial: Field) {
        let selector = comptime { aztec::protocol::abis::function_selector::FunctionSelector::from_signature(
            "record_paid_like(Field,(Field,Field),Field)") };
        let _ = self.context.call_public_function(board, selector, [post, key.x, key.y, tag],
            aztec::context::gas::GasOpts::default());
        self.context.push_nullifier_unsafe(poseidon2_hash_with_separator([refund_partial], 0x5243544f));
        self.context.emit_public_log_unsafe(TIP_TAG,
            [1, board.to_field(), post, key.x, key.y, ephemeral.x, ephemeral.y, partial, PAID_LIKE_VALUE as Field, 1]);
    }

    #[external("public")]
    #[only_self]
    fn _complete_refund(partial: Field, index: u32, max_fee: u128, principal: u128) {
        assert(self.context.nullifier_exists_unsafe(
            poseidon2_hash_with_separator([partial], 0x52435256), self.address), "Invalid refund commitment");
        let fee_field = self.context.transaction_fee();
        let actual = fee_field as u128;
        assert(actual as Field == fee_field, "Fee exceeds u128");
        assert(actual <= max_fee, "Fee exceeds reservation");
        assert((principal == 0) | (principal == PAID_LIKE_VALUE), "Invalid tip principal");
        let paid = self.context.nullifier_exists_unsafe(
            poseidon2_hash_with_separator([partial], 0x5243544f), self.address);
        let value = max_fee - actual + if paid { 0 } else { principal };
        if value > 0 { self.context.push_note_hash(note_hash(partial, value)); }
        // Every consuming transaction has the shared completion tag, even when
        // change/refund are both zero. Discovery observes spent native nullifiers
        // from its transaction effect without creating a zero-value credit note.
        self.context.emit_public_log_unsafe(OUTPUT_TAG, [1, 2, index as Field, partial, value as Field, 1]);
    }

    #[internal("private")]
    fn _claim(amount: u128, salt: Field, leaf_index: Field) {
        let nullifier = compute_feejuice_claim_nullifier(self.address, amount, salt,
            self.msg_sender(), leaf_index, self.context.chain_id(), self.context.version());
        self.context.assert_nullifier_exists(compute_nullifier_existence_request(nullifier, FEE_JUICE_ADDRESS));
        self.context.push_nullifier_unsafe(nullifier);
    }
    #[external("private")]
    fn mint(amount: u128, salt: Field, leaf_index: Field) {
        assert(amount > 0, "Zero bridge credit");
        self.internal._claim(amount, salt, leaf_index);
        Credit::output(self.context, amount, 3, amount);
    }
    #[external("private")]
    #[allow_phase_change]
    fn mint_and_pay_fee(amount: u128, salt: Field, leaf_index: Field, reservation: u128) {
        Credit::reserve(self.context, reservation);
        self.internal._claim(amount, salt, leaf_index);
        assert(amount >= reservation, "Amount too low to cover gas cost");
        Credit::output(self.context, amount - reservation, 3, amount - reservation);
        let (partial, index) = Credit::refund(self.context);
        self.set_as_teardown(PrivateFPC::at(self.address)._complete_refund(partial, index, reservation, 0));
        self.context.set_as_fee_payer();
        self.context.end_setup();
    }

    /// Local wallet-only key derivation. No transaction, log or public lookup.
    #[external("utility")]
    unconstrained fn credit_root(owner: AztecAddress) -> pub Field {
        get_nhk_app(get_public_keys(owner).npk_m_hash)
    }

    // --- Bridge mint helpers ---

    /// @notice Derives the bridge secret from (salt, claimer).
    ///
    /// The secret binds the claimed credit to msg_sender; its salt must remain private.
    /// The corresponding L1 secretHash must be:
    ///   compute_secret_hash([derive_bridge_secret(salt, claimer_aztec_address)])
    ///
    /// @param salt    A random value chosen by the claimer at deposit time.
    /// @param claimer The Aztec address of the claimer.
    /// @return The bridge secret.
    #[contract_library_method]
    pub fn derive_bridge_secret(salt: Field, claimer: AztecAddress) -> Field {
        poseidon2_hash_with_separator([salt, claimer.to_field()], DOM_SEP__FPC_BRIDGE_SECRET)
    }

    /// @notice Computes the FeeJuice L1->L2 message content hash for bridging `amount` to `fpc_address`.
    ///
    /// Mirrors FeeJuicePortal.depositToAztecPublic on L1:
    ///   sha256(abi.encodeWithSignature("claim(bytes32,uint256)", fpc_address, amount))
    ///
    /// The 4-byte selector keccak256("claim(bytes32,uint256)")[0:4] is computed at compile-time only -
    /// zero runtime cost.
    ///
    /// @param fpc_address The FPC contract address (recipient of the bridge).
    /// @param amount      The amount of FeeJuice bridged.
    /// @return The content hash field element.
    #[contract_library_method]
    pub fn get_bridge_gas_msg_hash(fpc_address: AztecAddress, amount: u128) -> Field {
        let mut hash_bytes = [0 as u8; 68];
        let recipient_bytes: [u8; 32] = fpc_address.to_field().to_be_bytes();
        let amount_bytes: [u8; 32] = (amount as Field).to_be_bytes();

        // EVM ABI function selector: keccak256("claim(bytes32,uint256)")[0:4]
        // Must match exactly what FeeJuicePortal.depositToAztecPublic encodes on L1.
        // Evaluated at compile-time only - zero runtime cost.
        let selector: [u8; 32] =
            comptime { keccak256::keccak256("claim(bytes32,uint256)".as_bytes(), 22) };

        for i in 0..4 {
            hash_bytes[i] = selector[i];
        }
        for i in 0..32 {
            hash_bytes[i + 4] = recipient_bytes[i];
            hash_bytes[i + 36] = amount_bytes[i];
        }

        sha256_to_field(hash_bytes)
    }

    /// @notice Reconstructs the nullifier that FeeJuice.claim emits when consuming the bridge message.
    ///
    /// FeeJuice.claim calls consume_l1_to_l2_message which:
    ///   1. Derives secret_hash = compute_secret_hash([secret])
    ///   2. Computes message_hash = sha256(portal | chain_id | fee_juice_l2 | version | content | secret_hash | leaf_index)
    ///   3. Emits nullifier = poseidon2([message_hash, secret], DOM_SEP__MESSAGE_NULLIFIER)
    ///
    /// By reconstructing this, the FPC can verify FeeJuice.claim was already executed.
    ///
    /// Protocol invariant: FeeJuice portal Eth address == FEE_JUICE_ADDRESS as a Field.
    /// See FeeJuice.claim_helper: EthAddress::from_field(FEE_JUICE_ADDRESS.to_field())
    ///
    /// @param fpc_address The FPC contract address (recipient of the bridge).
    /// @param amount      The exact amount bridged.
    /// @param salt        A random value chosen by the claimer at deposit time.
    /// @param claimer     The Aztec address of the claimer.
    /// @param leaf_index  The L1 message leaf index.
    /// @param chain_id    The L1 chain ID.
    /// @param version     The Aztec protocol version.
    /// @return The FeeJuice claim nullifier.
    #[contract_library_method]
    pub fn compute_feejuice_claim_nullifier(
        fpc_address: AztecAddress,
        amount: u128,
        salt: Field,
        claimer: AztecAddress,
        leaf_index: Field,
        chain_id: Field,
        version: Field,
    ) -> Field {
        let secret = derive_bridge_secret(salt, claimer);
        let content_hash = get_bridge_gas_msg_hash(fpc_address, amount);
        // 5.0.0: secrets are [Field; N]; N=1 hashes are unchanged, so wrapping preserves
        // every hash derived pre-migration.
        let secret_hash = compute_secret_hash([secret]);

        let fee_juice_portal = EthAddress::from_field(FEE_JUICE_ADDRESS.to_field());

        let message_hash = compute_l1_to_l2_message_hash(
            fee_juice_portal,
            chain_id,
            FEE_JUICE_ADDRESS,
            version,
            content_hash,
            secret_hash,
            leaf_index,
        );

        compute_l1_to_l2_message_nullifier(message_hash, [secret])
    }

}
