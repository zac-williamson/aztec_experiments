use aztec::macros::aztec;
mod tests;
fn words<let N: u32, let D: u32>(domain: str<D>, fields: [Field; N]) -> [u8; 32 + N * 32] {
    let mut out = [0; 32 + N * 32];
    for i in 0..D { out[i] = domain.as_bytes()[i]; }
    for i in 0..N { let bytes: [u8; 32] = fields[i].to_be_bytes(); for j in 0..32 { out[32+i*32+j] = bytes[j]; } }
    out
}
#[aztec]
pub contract PluginAdapter {
    use aztec::{macros::{functions::{external,initializer,only_self,view},storage::storage},
        protocol::{address::{AztecAddress,EthAddress},abis::function_selector::FunctionSelector,traits::ToField,hash::sha256_to_field},
        context::gas::GasOpts,state_vars::{Map,PublicImmutable,PublicMutable}};
    use crate::words;
    #[storage]
    struct Storage<Context> {
        board: PublicImmutable<AztecAddress, Context>, owner: PublicImmutable<AztecAddress, Context>,
        operator: PublicMutable<AztecAddress, Context>, portal: PublicImmutable<EthAddress, Context>,
        l1_chain: PublicImmutable<Field, Context>, version: PublicImmutable<Field, Context>,
        balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        accounts: Map<Field, PublicMutable<AztecAddress, Context>, Context>,
        states: Map<Field, PublicMutable<u8, Context>, Context>,
        sequence: Map<Field, PublicMutable<u32, Context>, Context>,
        reserves: Map<Field, PublicMutable<u128, Context>, Context>,
        deadlines: Map<Field, PublicMutable<u64, Context>, Context>,
        charges: Map<Field, PublicMutable<u128, Context>, Context>,
        receipts: Map<Field, PublicMutable<Field, Context>, Context>,
        requests: Map<u32, PublicMutable<Field, Context>, Context>, count: PublicMutable<u32, Context>,
        earnings: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        reservers: Map<Field, PublicMutable<AztecAddress, Context>, Context>, exits: Map<Field, PublicMutable<bool, Context>, Context>,
    }
    #[external("public")] #[initializer]
    fn init(board: AztecAddress, operator: AztecAddress, l1_chain: Field, version: Field) {
        assert((board != AztecAddress::zero()) & (operator != AztecAddress::zero()), "Invalid identity");
        self.storage.board.initialize(board); self.storage.owner.initialize(self.msg_sender());
        self.storage.operator.write(operator); self.storage.l1_chain.initialize(l1_chain); self.storage.version.initialize(version);
    }
    #[external("public")]
    fn set_operator(operator: AztecAddress) {
        assert(self.msg_sender() == self.storage.owner.read(), "Only owner");
        assert(operator != AztecAddress::zero(), "Invalid operator"); self.storage.operator.write(operator);
    }
    #[external("public")]
    fn set_portal(portal: EthAddress) {
        assert(self.msg_sender() == self.storage.owner.read(), "Only owner");
        portal.validate(); assert(portal.to_field() != 0, "Invalid portal");
        assert(!self.storage.portal.is_initialized(), "Portal immutable"); self.storage.portal.initialize(portal);
        let content = sha256_to_field(words("PLUGIN_READY_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read()]));
        self.context.message_portal(portal, content);
    }
    #[external("private")]
    fn claim(amount: u128, secret: Field, leaf_index: Field) {
        let account = self.msg_sender(); let portal = self.storage.portal.read(); assert(amount > 0, "Empty deposit");
        let content = sha256_to_field(words("PLUGIN_CREDIT_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read(), account.to_field(), amount as Field]));
        self.context.consume_l1_to_l2_message(content, [secret], portal, leaf_index); self.enqueue_self._credit(account, amount);
    }
    #[external("public")] #[only_self]
    fn _credit(account: AztecAddress, amount: u128) {
        self.storage.balances.at(account).write(self.storage.balances.at(account).read() + amount);
    }
    #[external("public")]
    fn on_invocation(account: AztecAddress, post: Field) {
        assert(self.msg_sender() == self.storage.board.read(), "Only board");
        assert((post != 0) & (account != AztecAddress::zero()), "Invalid invocation");
        assert(self.storage.states.at(post).read() == 0, "Duplicate invocation");
        assert(self.storage.balances.at(account).read() > 0, "Fund plugin account first");
        self.storage.accounts.at(post).write(account); self.storage.states.at(post).write(1);
        let count = self.storage.count.read(); self.storage.requests.at(count).write(post); self.storage.count.write(count+1);
    }
    #[external("public")]
    fn start(post: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        assert(self.storage.states.at(post).read() == 1, "Already started");
        self.storage.states.at(post).write(2); self.storage.deadlines.at(post).write(self.context.timestamp() + 86400);
    }
    #[external("public")]
    fn reserve(post: Field, call: u32, maximum: u128) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        assert(self.storage.states.at(post).read() == 2, "Invocation not active");
        assert(self.context.timestamp() + 7200 < self.storage.deadlines.at(post).read(), "Too late to start call");
        assert(self.storage.sequence.at(post).read() == call, "Wrong call number");
        assert((self.storage.reserves.at(post).read() == 0) & (maximum > 0), "Invalid reservation");
        let account = self.storage.accounts.at(post).read(); let balance = self.storage.balances.at(account).read();
        assert(maximum <= balance, "Insufficient balance");
        self.storage.balances.at(account).write(balance-maximum); self.storage.reserves.at(post).write(maximum);
        self.storage.reservers.at(post).write(self.msg_sender());
    }
    struct Accounting {}
    impl Accounting {
        unconstrained fn settle(context: aztec::context::PublicContext, storage: Storage<aztec::context::PublicContext>, post: Field, call: u32, actual: u128, receipt: Field) {
            assert(context.maybe_msg_sender().unwrap() == storage.reservers.at(post).read(), "Only reserving operator");
            assert(storage.states.at(post).read() == 2, "Invocation not active");
            assert(context.timestamp() < storage.deadlines.at(post).read(), "Expired invocation");
            assert(storage.sequence.at(post).read() == call, "Wrong call number");
            let maximum = storage.reserves.at(post).read(); assert((maximum > 0) & (actual <= maximum), "Invalid settlement");
            let account = storage.accounts.at(post).read(); let operator = storage.reservers.at(post).read();
            storage.balances.at(account).write(storage.balances.at(account).read()+maximum-actual);
            storage.earnings.at(operator).write(storage.earnings.at(operator).read()+actual);
            storage.reserves.at(post).write(0); storage.sequence.at(post).write(call+1);
            storage.charges.at(post).write(storage.charges.at(post).read()+actual); storage.receipts.at(post).write(receipt);
        }
    }
    #[external("public")]
    fn settle(post: Field, call: u32, actual: u128, receipt: Field) { Accounting::settle(self.context, self.storage, post, call, actual, receipt); }
    #[external("public")]
    fn complete(post: Field, call: u32, actual: u128, receipt: Field, message: [Field; 32], length: u16) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        if self.storage.reserves.at(post).read() > 0 { Accounting::settle(self.context, self.storage, post, call, actual, receipt); }
        else { assert(actual == 0, "No reservation"); }
        assert(self.storage.states.at(post).read() == 2, "Invocation not active"); self.storage.states.at(post).write(3);
        let selector = comptime { FunctionSelector::from_signature("publish_plugin_reply(Field,[Field;32],u16)") };
        let _ = self.context.call_public_function(self.storage.board.read(), selector, [post].concat(message).concat([length as Field]), GasOpts::default());
    }
    #[external("public")]
    fn cancel(post: Field) {
        assert(self.msg_sender() == self.storage.accounts.at(post).read(), "Only account");
        assert(self.storage.reserves.at(post).read() == 0, "Call still reserved");
        assert((self.storage.states.at(post).read() == 1) | (self.storage.states.at(post).read() == 2), "Invocation closed"); self.storage.states.at(post).write(4);
    }
    #[external("public")]
    fn release_expired(post: Field) {
        assert((self.storage.states.at(post).read() == 2) | (self.storage.states.at(post).read() == 7), "Invocation not active");
        assert(self.context.timestamp() >= self.storage.deadlines.at(post).read(), "Not expired");
        let account = self.storage.accounts.at(post).read(); let maximum = self.storage.reserves.at(post).read();
        self.storage.balances.at(account).write(self.storage.balances.at(account).read()+maximum);
        self.storage.reserves.at(post).write(0); self.storage.states.at(post).write(5);
    }
    #[external("public")]
    fn close(post: Field) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only operator");
        assert(self.storage.states.at(post).read() == 2, "Cannot close");
        self.storage.states.at(post).write(if self.storage.reserves.at(post).read() == 0 { 6 } else { 7 });
    }
    #[external("public")]
    fn withdraw(amount: u128, recipient: EthAddress, earnings: bool, nonce: Field) {
        recipient.validate(); assert((recipient.to_field() != 0) & (amount > 0), "Invalid withdrawal"); let account = self.msg_sender();
        if earnings { let value = self.storage.earnings.at(account).read(); assert(amount <= value, "Insufficient earnings"); self.storage.earnings.at(account).write(value-amount); }
        else { let value = self.storage.balances.at(account).read(); assert(amount <= value, "Insufficient balance"); self.storage.balances.at(account).write(value-amount); }
        assert((nonce != 0) & !self.storage.exits.at(nonce).read(), "Duplicate withdrawal"); self.storage.exits.at(nonce).write(true); let portal = self.storage.portal.read();
        let content = sha256_to_field(words("PLUGIN_EXIT_V1", [self.storage.l1_chain.read(), portal.to_field(), self.address.to_field(), self.storage.version.read(), recipient.to_field(), amount as Field, nonce])); self.context.message_portal(portal, content);
    }
    #[external("public")] #[view]
    fn balance(account: AztecAddress) -> pub u128 { self.storage.balances.at(account).read() }
    #[external("public")] #[view]
    fn earned(account: AztecAddress) -> pub u128 { self.storage.earnings.at(account).read() }
    #[external("public")] #[view]
    fn request_count() -> pub u32 { self.storage.count.read() }
    #[external("public")] #[view]
    fn request_at(index: u32) -> pub Field { self.storage.requests.at(index).read() }
    #[external("public")] #[view]
    fn invocation(post: Field) -> pub (AztecAddress,u8,u32,u128,u128,u64) {
        (self.storage.accounts.at(post).read(),self.storage.states.at(post).read(),self.storage.sequence.at(post).read(),self.storage.reserves.at(post).read(),self.storage.charges.at(post).read(),self.storage.deadlines.at(post).read())
    }
    #[external("public")] #[view]
    fn get_operator() -> pub AztecAddress { self.storage.operator.read() }
    #[external("public")] #[view]
    fn get_portal() -> pub EthAddress { self.storage.portal.read() }
}
