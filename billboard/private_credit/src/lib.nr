//! Public delivery, private spending. No owner identifiers or source-note lookup tags.
use std::embedded_curve_ops::{EmbeddedCurveScalar, fixed_base_scalar_mul, multi_scalar_mul};
use aztec::{context::{PrivateContext, NoteExistenceRequest}, note::utils::{compute_note_hash, compute_note_nullifier},
    protocol::{address::AztecAddress, point::EmbeddedCurvePoint,
        hash::{poseidon2_hash_with_separator, compute_siloed_note_hash, compute_unique_note_hash},
        traits::{Deserialize, Serialize, ToField}}};

// One displayed posting credit/FEE has18 decimals (wallet-panel.mjs).
pub global PAID_LIKE_VALUE: u128 = 20000000000000000000;
pub global CREDIT_SLOT: Field = 0x5243544950435245;
pub global INPUT_CAPSULE_SLOT: Field = 0x5243544950494e50;
pub global OUTPUT_TAG: Field = 0x52435449504f5554;
pub global TIP_TAG: Field = 0x5243544950544950;
pub global MAX_INPUTS: u32 = 8;

// Field inputs are canonical BN254 Fr. Fr is smaller than the Grumpkin scalar
// modulus, so from_field is injective: there are no alternate scalar encodings.
pub fn spending_scalar(secret: Field) -> EmbeddedCurveScalar {
    assert(secret != 0, "Zero spending secret");
    let hash = poseidon2_hash_with_separator([secret], 0x52435458);
    assert(hash != 0, "Zero spending scalar");
    EmbeddedCurveScalar::from_field(hash)
}
pub fn validate_key(key: EmbeddedCurvePoint) {
    assert(!key.is_infinite(), "Infinite tip key");
    assert(key.y * key.y == key.x * key.x * key.x - 17, "Invalid tip curve point");
}
/// One field binds the complete public point without a separate initialization slot.
pub fn tip_key_hash(key: EmbeddedCurvePoint) -> Field {
    poseidon2_hash_with_separator([key.x, key.y], 0x5243544b)
}
pub fn spending_key(secret: Field) -> EmbeddedCurvePoint {
    let key = fixed_base_scalar_mul(spending_scalar(secret));
    validate_key(key); key
}
pub fn post_secret(root: Field, chain: Field, version: Field, board: AztecAddress, post: Field) -> Field {
    assert((root != 0) & (post != 0), "Missing tip derivation scope");
    poseidon2_hash_with_separator([root, chain, version, board.to_field(), post], 0x52435453)
}
pub fn self_secret(root: Field, chain: Field, version: Field, fpc: AztecAddress,
    input_reference: Field, role: u8, index: u32) -> Field {
    assert((root != 0) & (input_reference != 0), "Missing output derivation scope");
    assert((role >= 1) & (role <= 3), "Invalid output role");
    poseidon2_hash_with_separator([root, chain, version, fpc.to_field(), input_reference,
        role as Field, index as Field], 0x52435353)
}
pub fn self_blinding(secret: Field) -> Field {
    poseidon2_hash_with_separator([secret], 0x52435342)
}
pub fn commitment(key: EmbeddedCurvePoint, blinding: Field) -> Field {
    poseidon2_hash_with_separator([key.x, key.y, blinding], 0x5243434d)
}
pub fn note_hash(partial: Field, value: u128) -> Field {
    compute_note_hash(CREDIT_SLOT, [partial, value as Field])
}
pub fn tip_blinding(shared: EmbeddedCurvePoint, fpc: AztecAddress) -> Field {
    validate_key(shared);
    poseidon2_hash_with_separator([shared.x, shared.y, fpc.to_field()], 0x52435442)
}
pub fn create_tip(key: EmbeddedCurvePoint, ephemeral: Field, fpc: AztecAddress) -> (EmbeddedCurvePoint, Field) {
    validate_key(key);
    assert(ephemeral != 0, "Zero ephemeral scalar");
    let scalar = EmbeddedCurveScalar::from_field(ephemeral);
    let public_ephemeral = fixed_base_scalar_mul(scalar);
    validate_key(public_ephemeral);
    let shared = multi_scalar_mul([key], [scalar]);
    (public_ephemeral, commitment(key, tip_blinding(shared, fpc)))
}

#[derive(Serialize, Deserialize)]
pub struct CreditInput {
    pub secret: Field,
    pub key: EmbeddedCurvePoint,
    pub blinding: Field,
    pub value: u128,
    pub nonce: Field,
}
#[derive(Serialize, Deserialize)]
pub struct CreditInputs { pub count: u32, pub notes: [CreditInput; MAX_INPUTS] }

/// Every selected input is constrained. Only settled/previous-transaction notes
/// are admitted here; no caller-selected pending-note metadata or nonce modes.
/// Native kernels prove each read and reject competing/duplicate nullifiers.
pub fn consume(context: &mut PrivateContext, inputs: CreditInputs) -> u128 {
    assert((inputs.count > 0) & (inputs.count <= MAX_INPUTS), "Invalid fee input count");
    let mut total: u128 = 0;
    for i in 0..MAX_INPUTS {
        if i < inputs.count {
            let input = inputs.notes[i];
            assert(input.value > 0, "Zero credit input");
            validate_key(input.key);
            assert(spending_key(input.secret) == input.key, "Credit spending secret mismatch");
            let inner = note_hash(commitment(input.key, input.blinding), input.value);
            let unique = compute_unique_note_hash(input.nonce, compute_siloed_note_hash(context.this_address(), inner));
            context.assert_note_exists(NoteExistenceRequest::for_settled(unique));
            // The blinding and scalar NEVER authorize a spend. The independent
            // preimage s and the exact unique note hash determine its nullifier.
            context.push_nullifier_for_note_hash(compute_note_nullifier(unique, [input.secret]), 0);
            total = total + input.value;
        }
    }
    total
}
