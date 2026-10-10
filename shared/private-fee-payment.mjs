// Ownerless private Fee Juice payment, using the pinned V6 wallet payment interface.
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
import { FunctionCall, FunctionSelector, FunctionType } from '@aztec-labs/stdlib/abi';
import { ExecutionPayload } from '@aztec-labs/stdlib/tx';
import { Fr } from '@aztec-labs/foundation/curves/bn254';

async function call(name, to, signature, args) {
  return FunctionCall.from({name,to,selector:await FunctionSelector.fromSignature(signature),
    type:FunctionType.PRIVATE,hideMsgSender:false,isStatic:false,args});
}
export class PrivateFeePaymentMethod {
  #address; #reservation;
  constructor(address,reservation) { this.#address=address;this.#reservation=BigInt(reservation);if(this.#reservation<=0n||this.#reservation>=1n<<128n)throw Error("Invalid fee reservation"); }
  get reservation(){return this.#reservation;}
  withReservation(reservation){return new PrivateFeePaymentMethod(this.address,reservation);}
  get address() { return this.#address; }
  async getAsset() { return ProtocolContractAddress.FeeJuice; }
  async getFeePayer() { return this.address; }
  getGasSettings() { return undefined; }
  async getExecutionPayload() {
    return new ExecutionPayload([await call('pay_fee',this.address,'pay_fee(u128)',[new Fr(this.reservation)])],[],[],[],this.address);
  }
}
export class PrivateMintAndPayFeePaymentMethod extends PrivateFeePaymentMethod {
  #claim;
  constructor(address,{amount,secret,salt,leafIndex},reservation) {
    super(address,reservation);
    // Detach fields so a caller cannot change the claim after preparation.
    this.#claim={amount:BigInt(amount),secret:new Fr(secret.toBigInt()),salt:new Fr(salt.toBigInt()),leafIndex:new Fr(leafIndex.toBigInt())};
  }
  withReservation(reservation){return new PrivateMintAndPayFeePaymentMethod(this.address,this.#claim,reservation);}
  async getExecutionPayload() {
    const {amount,secret,salt,leafIndex}=this.#claim;
    return new ExecutionPayload([
      await call('claim',ProtocolContractAddress.FeeJuice,'claim((Field),u128,Field,Field)',[this.address.toField(),new Fr(amount),new Fr(secret.toBigInt()),new Fr(leafIndex.toBigInt())]),
      await call('mint_and_pay_fee',this.address,'mint_and_pay_fee(u128,Field,Field,u128)',[new Fr(amount),new Fr(salt.toBigInt()),new Fr(leafIndex.toBigInt()),new Fr(this.reservation)]),
    ],[],[],[],this.address);
  }
}
