import {Contract,NO_WAIT} from '@aztec/aztec.js/contracts';
import {waitForTx} from '@aztec/aztec.js/node';
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
 // Serialize proof generation/submission, but never hold this queue for finality.
 let submissions=Promise.resolve();
 const send=async(name,...args)=>{
  const submitted=submissions.then(()=>c.methods[name](...args).send({from:operator,wait:NO_WAIT}));
  submissions=submitted.then(()=>{},()=>{});
  const {txHash}=await submitted;
  return waitForTx(node,txHash,{timeout:development?180:7200,waitForStatus:!development&&name==='reserve'?TxStatus.FINALIZED:TxStatus.CHECKPOINTED});
 };
 const invocation=async post=>{const [account,state,call,reserved,charged,deadline]=await read('invocation',Fr.fromString(post));return {account,state:Number(state),call:Number(call),reserved:BigInt(reserved),charged:BigInt(charged),deadline:Number(deadline)};};
 const assertUsable=async(post,reservation)=>{
  const confirmed=await invocation(post);
  if(confirmed.state!==2||confirmed.call!==reservation.call||confirmed.reserved!==reservation.maximum)throw Error('Reservation not confirmed');
  const block=await node.getBlock(await node.getBlockNumber()),timestamp=Number(block?.header?.globalVariables?.timestamp);
  if(!Number.isSafeInteger(timestamp)||Math.max(timestamp,Math.floor(Date.now()/1000))+180>=confirmed.deadline)throw Error('Reservation too close to expiry to call provider');
 };
 return {
  count:async()=>Number(await read('request_count')),
  at:async i=>String(await read('request_at',i)),invocation,
  start:post=>send('start',Fr.fromString(post)),
  available:async post=>BigInt(await read('balance',(await invocation(post)).account)),
  reserve:async(post,amount)=>{const r=await invocation(post);await send('reserve',Fr.fromString(post),r.call,amount);const reservation={call:r.call,maximum:amount};await assertUsable(post,reservation);return reservation;},
  assertUsable,
  settle:(post,r)=>send('settle',Fr.fromString(post),r.call,r.actual,Fr.fromString(r.receipt)),
  complete:async(post,r,text)=>{const p=packText(text);return send('complete',Fr.fromString(post),r?.call??0,r?.actual??0n,r?Fr.fromString(r.receipt):Fr.ZERO,p.fields.map(value=>Fr.fromString(value)),p.length);},
  close:post=>send('close',Fr.fromString(post)),
 };
}
