use aztec::macros::aztec;

// Reference implementation of the receiver interface. The board imports none of this code.
#[aztec]
pub contract PluginAdapter {
    use aztec::{
        macros::{functions::{external, initializer, view}, storage::storage},
        protocol::{address::AztecAddress, abis::function_selector::FunctionSelector, traits::ToField},
        state_vars::{PublicImmutable, PublicMutable},
        context::gas::GasOpts,
    };
    #[storage]
    struct Storage<Context> {
        board: PublicImmutable<AztecAddress, Context>,
        owner: PublicImmutable<AztecAddress, Context>,
        operator: PublicMutable<AztecAddress, Context>,
    }
    #[external("public")]
    #[initializer]
    fn init(board: AztecAddress, operator: AztecAddress) {
        assert(board != AztecAddress::zero(), "Board required");
        assert(operator != AztecAddress::zero(), "Operator required");
        self.storage.board.initialize(board);
        self.storage.owner.initialize(self.msg_sender());
        self.storage.operator.write(operator);
    }
    #[external("public")]
    fn set_operator(operator: AztecAddress) {
        assert(self.msg_sender() == self.storage.owner.read(), "Only owner");
        assert(operator != AztecAddress::zero(), "Operator required");
        self.storage.operator.write(operator);
    }
    #[external("public")]
    fn reply(parent: Field, message: [Field; 32], length: u16) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        let selector = comptime { FunctionSelector::from_signature("publish_plugin_reply(Field,[Field;32],u16)") };
        let args = [parent].concat(message).concat([length as Field]);
        let _ = self.context.call_public_function(self.storage.board.read(), selector, args, GasOpts::default());
    }
    #[external("public")]
    #[view]
    fn get_operator() -> pub AztecAddress { self.storage.operator.read() }
}
