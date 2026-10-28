// Ownerless private Fee Juice payment, using the pinned V6 wallet payment interface.
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
import { FunctionCall, FunctionSelector, FunctionType } from '@aztec-labs/stdlib/abi';
import { ExecutionPayload } from '@aztec-labs/stdlib/tx';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import {creditInputCapsule,selectCreditInputs,PAID_LIKE_VALUE} from './private-credit.mjs';

async function call(name, to, signature, args) {
  return FunctionCall.from({name,to,selector:await FunctionSelector.fromSignature(signature),
    type:FunctionType.PRIVATE,hideMsgSender:false,isStatic:false,args});
}
export class PrivateFeePaymentMethod {
  #address; #reservation; #credit;
  constructor(address,reservation,credit) { this.#credit=credit;this.#address=address;this.#reservation=BigInt(reservation);if(this.#reservation<=0n||this.#reservation>=1n<<128n)throw Error("Invalid fee reservation"); }
  get reservation(){return this.#reservation;}
  withReservation(reservation){return new PrivateFeePaymentMethod(this.address,reservation,this.#credit);}
  get credit() { return this.#credit; }
  inputCapsules(extra=0n){
    if(!this.#credit)throw Error("Private credit selection required");
    return [creditInputCapsule(this.address,this.#credit.owner,selectCreditInputs(this.#credit.notes,this.reservation+extra))];
  }
  get address() { return this.#address; }
  async getAsset() { return ProtocolContractAddress.FeeJuice; }
  async getFeePayer() { return this.address; }
  getGasSettings() { return undefined; }
  async getExecutionPayload() {
    return new ExecutionPayload([await call('pay_fee',this.address,'pay_fee(u128)',[new Fr(this.reservation)])],[],this.inputCapsules(),[],this.address);
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

// A funded account can claim a small top-up without making that top-up pay its
// entire transaction fee. Mint exactly once, then reserve existing private credit.
export class PrivateClaimAndPayFeePaymentMethod extends PrivateFeePaymentMethod {
  #claim;
  constructor(address,{amount,secret,salt,leafIndex},reservation,credit) {
    super(address,reservation,credit);
    this.#claim={amount:BigInt(amount),secret:new Fr(secret.toBigInt()),salt:new Fr(salt.toBigInt()),leafIndex:new Fr(leafIndex.toBigInt())};
  }
  withReservation(reservation){return new PrivateClaimAndPayFeePaymentMethod(this.address,this.#claim,reservation,this.credit);}
  async getExecutionPayload() {
    const {amount,secret,salt,leafIndex}=this.#claim;
    return new ExecutionPayload([
      await call('claim',ProtocolContractAddress.FeeJuice,'claim((Field),u128,Field,Field)',[this.address.toField(),new Fr(amount),secret,leafIndex]),
      await call('mint',this.address,'mint(u128,Field,Field)',[new Fr(amount),salt,leafIndex]),
      await call('pay_fee',this.address,'pay_fee(u128)',[new Fr(this.reservation)]),
    ],[],this.inputCapsules(),[],this.address);
  }
}

// One transaction spans setup (fee/principal reservation), app (tip + like),
// and teardown (unused gas and, after an app revert, principal refund). The
// external application batch is empty; no free board call bypasses the debit.
export class PrivatePaidLikePaymentMethod extends PrivateFeePaymentMethod {
  #like;
  constructor(address,like,reservation,credit){super(address,reservation,credit);this.#like=like;}
  withReservation(reservation){return new PrivatePaidLikePaymentMethod(this.address,this.#like,reservation,this.credit);}
  async getExecutionPayload(){
    const {board,post,key,ephemeral}=this.#like;
    return new ExecutionPayload([await call('pay_like_and_fee',this.address,
      'pay_like_and_fee((Field),Field,(Field,Field),Field,u128)',
      [board.toField(),post,key.x,key.y,ephemeral,new Fr(this.reservation)])],[],this.inputCapsules(PAID_LIKE_VALUE),[],this.address);
  }
}
