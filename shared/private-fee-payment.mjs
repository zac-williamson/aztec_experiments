// Ownerless private Fee Juice payment, using the pinned V5 wallet payment interface.
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
import { FunctionCall, FunctionSelector, FunctionType } from '@aztec/stdlib/abi';
import { ExecutionPayload } from '@aztec/stdlib/tx';
import { Fr } from '@aztec/foundation/curves/bn254';

async function call(name, to, signature, args) {
  return FunctionCall.from({name,to,selector:await FunctionSelector.fromSignature(signature),
    type:FunctionType.PRIVATE,hideMsgSender:false,isStatic:false,args,returnTypes:[]});
}
export class PrivateFeePaymentMethod {
  #address;
  constructor(address) { this.#address=address; }
  get address() { return this.#address; }
  async getAsset() { return ProtocolContractAddress.FeeJuice; }
  async getFeePayer() { return this.address; }
  getGasSettings() { return undefined; }
  async getExecutionPayload() {
    return new ExecutionPayload([await call('pay_fee',this.address,'pay_fee()',[])],[],[],[],this.address);
  }
}
export class PrivateMintAndPayFeePaymentMethod extends PrivateFeePaymentMethod {
  #claim;
  constructor(address,{amount,secret,salt,leafIndex}) {
    super(address);
    // Detach fields so a caller cannot change the claim after preparation.
    this.#claim={amount:BigInt(amount),secret:new Fr(secret.toBigInt()),salt:new Fr(salt.toBigInt()),leafIndex:new Fr(leafIndex.toBigInt())};
  }
  async getExecutionPayload() {
    const {amount,secret,salt,leafIndex}=this.#claim;
    return new ExecutionPayload([
      await call('claim',ProtocolContractAddress.FeeJuice,'claim((Field),u128,Field,Field)',[this.address.toField(),new Fr(amount),new Fr(secret.toBigInt()),new Fr(leafIndex.toBigInt())]),
      await call('mint_and_pay_fee',this.address,'mint_and_pay_fee(u128,Field,Field)',[new Fr(amount),new Fr(salt.toBigInt()),new Fr(leafIndex.toBigInt())]),
    ],[],[],[],this.address);
  }
}
