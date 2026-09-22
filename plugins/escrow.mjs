import {Contract} from '@aztec/aztec.js/contracts';
import {NO_FROM} from '@aztec/aztec.js/account';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Fr} from '@aztec/foundation/curves/bn254';
import {TxStatus} from '@aztec/stdlib/tx';
import {packText} from './protocol.mjs';
/** On-chain financial port. No financial database or service-to-service authority. */
export async function aztecEscrowPort({wallet,node,address,artifact,operator,development=false}){
 const instance=await node.getContract(AztecAddress.fromStringUnsafe(address),'latest');if(!instance)throw Error('Escrow not deployed');await wallet.registerContract(instance,artifact);
 const c=await Contract.at(AztecAddress.fromStringUnsafe(address),artifact,wallet);
 const read=async(name,...args)=>(await c.methods[name](...args).simulate({from:NO_FROM})).result;
 const send=async(name,...args)=>c.methods[name](...args).send({from:operator,wait:{timeout:development?180:7200,waitForStatus:development?TxStatus.CHECKPOINTED:TxStatus.FINALIZED}});
 const invocation=async post=>{const [account,state,call,reserved,charged,deadline]=await read('invocation',Fr.fromString(post));return {account,state:Number(state),call:Number(call),reserved:BigInt(reserved),charged:BigInt(charged),deadline:Number(deadline)};};
 return {
  count:async()=>Number(await read('request_count')),
  at:async i=>String(await read('request_at',i)),invocation,
  start:post=>send('start',Fr.fromString(post)),
  available:async post=>BigInt(await read('balance',(await invocation(post)).account)),
  reserve:async(post,amount)=>{const r=await invocation(post);await send('reserve',Fr.fromString(post),r.call,amount);const confirmed=await invocation(post);if(confirmed.state!==2||confirmed.call!==r.call||confirmed.reserved!==amount)throw Error('Reservation not confirmed');const block=await node.getBlock(await node.getBlockNumber());const timestamp=Number(block?.header?.globalVariables?.timestamp);if(!Number.isSafeInteger(timestamp)||timestamp+180>=confirmed.deadline)throw Error('Reservation too close to expiry to call provider');return {call:r.call,maximum:amount};},
  settle:(post,r)=>send('settle',Fr.fromString(post),r.call,r.actual,Fr.fromString(r.receipt)),
  complete:async(post,r,text)=>{const p=packText(text);return send('complete',Fr.fromString(post),r?.call??0,r?.actual??0n,r?Fr.fromString(r.receipt):Fr.ZERO,p.fields.map(value=>Fr.fromString(value)),p.length);},
  close:post=>send('close',Fr.fromString(post)),
 };
}
