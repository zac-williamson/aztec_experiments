use aztec::{macros::aztec, protocol::{address::AztecAddress, hash::poseidon2_hash_with_separator, traits::ToField}};

// Lead-owned invocation-target v1: 5 domain/context + 8 relationship/content + 32 message fields.
// This fixture enforces encoding, but deliberately does not implement name ownership,
// admission, actual parent/root existence, moderation, or a complete product board.
pub fn invocation_target(chain: Field, rollup: Field, board: AztecAddress, adapter: AztecAddress,
    target: [Field; 8], message: [Field; 32]) -> Field {
    assert((chain != 0) & (rollup != 0) & (board != AztecAddress::zero()) & (adapter != AztecAddress::zero()), "Invalid invocation context");
    assert((target[3] == 1) | (target[3] == 2) | (target[3] == 3), "Invalid invocation kind");
    assert((target[1] == 0) == (target[2] == 0), "Invalid root relationship");
    assert((target[3] == 1) == (target[5] == 0), "Invalid referenced post");
    assert(target[6] != 0, "Invocation nonce required");
    assert(target[7] as u32 as Field == target[7], "Invalid message length");
    let length = target[7] as u32; assert(length <= 992, "Message too long");
    assert((target[3] == 3) | (length > 0), "Empty invocation message");
    for i in 0..32 {
        let bytes: [u8; 32] = message[i].to_be_bytes();
        assert(bytes[0] == 0, "Message field exceeds 31 bytes");
        for j in 0..31 {
            if i * 31 + j >= length { assert(bytes[j + 1] == 0, "Noncanonical message padding"); }
            else { assert(bytes[j + 1] != 0, "Message contains NUL"); }
        }
    }
    poseidon2_hash_with_separator([1, chain, rollup, board.to_field(), adapter.to_field()].concat(target).concat(message), 0x52434931)
}

#[aztec]
pub contract InvocationProbeBoard {
    use aztec::{macros::functions::{external, initializer, view}, protocol::{address::AztecAddress, abis::function_selector::FunctionSelector}, context::gas::GasOpts};
    use crate::invocation_target;

    #[external("public")]
    #[initializer]
    fn init() {}

    #[external("public")]
    #[view]
    fn target_hash(adapter: AztecAddress, target: [Field; 8], message: [Field; 32]) -> pub Field {
        invocation_target(self.context.chain_id(), self.context.version(), self.address, adapter, target, message)
    }

    #[external("public")]
    fn invoke(adapter: AztecAddress, request_id: Field, target: [Field; 8], message: [Field; 32]) {
        let derived = invocation_target(self.context.chain_id(), self.context.version(), self.address, adapter, target, message);
        let selector = FunctionSelector::from_signature("on_invocation(Field,Field)");
        let _ = self.context.call_public_function(adapter, selector, [request_id, derived], GasOpts::default());
    }
}
