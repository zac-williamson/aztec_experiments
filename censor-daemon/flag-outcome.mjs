import {validateFeedEvent,scopeKey} from '../shared/protocol-schema.mjs';
// Read-only canonical outcome check. A successful child process is not evidence
// of finality; a current matching receipt AND emitted flag are required.
export async function reconcileFlag({node,scope,postId,policyVersion,transactionHash,flagEvent}){
 if(!/^0x[0-9a-f]{64}$/.test(transactionHash))return {state:'unknown'};
 try{
  const receipt=await node.getTxReceipt(transactionHash);
  if(receipt?.txHash!==transactionHash)return {state:'unknown'};
  if(['pending','proposed','dropped'].includes(receipt.status))return {state:receipt.status==='dropped'?'dropped':'pending'};
  if(!['checkpointed','proven','finalized'].includes(receipt.status)||!Number.isSafeInteger(receipt.blockNumber)||!/^0x[0-9a-f]{64}$/.test(receipt.blockHash))return {state:'unknown'};
  const block=await node.getBlockData(receipt.blockNumber);
  if(block?.blockHash!==receipt.blockHash||Number(block?.header?.globalVariables?.blockNumber)!==receipt.blockNumber)return {state:'unknown'};
  if(!['success','reverted'].includes(receipt.executionResult))return {state:'unknown'};
  if(receipt.executionResult==='reverted')return {state:receipt.status==='finalized'?'reverted':'awaiting-revert-finality',receipt};
  if(!flagEvent)return {state:'awaiting-event',receipt};
  const event=validateFeedEvent(flagEvent,scope);
  if(event.type!=='PostFlagged'||event.payload.postId!==postId||event.payload.policyVersion!==policyVersion||event.position.txHash!==transactionHash||event.position.blockHash!==receipt.blockHash||Number(event.position.blockNumber)!==receipt.blockNumber)return {state:'unknown'};
  return {state:receipt.status==='finalized'?'confirmed':'submitted',receipt,flagEvent:event};
 }catch{return {state:'unknown'};}
}

// Rolling completion is the authenticated public index's PostRemoved projection,
// never a synthetic legacy PostFlagged. The contract keeps collateral eligibility
// separate from removal; penalized=false is still a real removal.
export function validateRollingRemoval(event,scope,record){
 const hex=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
 const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=20;
 if(!event||event.type!=='PostRemoved'||event.schemaVersion!==1||scopeKey(event.scope)!==scopeKey(scope)||
  !event.position||!hex(event.position.txHash)||!hex(event.position.blockHash)||!decimal(event.position.blockNumber)||
  !event.payload||!hex(event.payload.postId)||!hex(event.payload.policyVersion)||typeof event.payload.penalized!=='boolean'||
  typeof event.payload.reason!=='string'||Buffer.byteLength(event.payload.reason)>217)throw Error('Invalid Rolling removal evidence');
 if(record&&(event.payload.postId!==record.job.postId||event.payload.policyVersion!==record.policy.context.policyIdentity||event.payload.reason!==record.intent?.reason))throw Error('Rolling removal does not match intent');
 return structuredClone(event);
}
export async function reconcileRollingRemoval({node,scope,record,event,development=false}){
 try{
  const hash=record.job.transactionHash;if(!hash)return {state:'unknown'};
  const receipt=await node.getTxReceipt(hash);
  if(receipt.txHash!==hash)return {state:'unknown'};
  if(!['checkpointed','proven','finalized'].includes(receipt.status))return {state:'unknown'};
  const block=await node.getBlockData(receipt.blockNumber);
  if(block?.blockHash!==receipt.blockHash||Number(block?.header?.globalVariables?.blockNumber)!==Number(receipt.blockNumber))return {state:'unknown'};
  // Do not automatically replay finalized failures either: exact original intent
  // and fee accounting remain available for the operator's recovery procedure.
  if(receipt.executionResult!=='success')return {state:'unknown',receipt};
  if(!event)return {state:'awaiting-event',receipt};
  const checked=validateRollingRemoval(event,scope,record);
  if(checked.position.txHash!==hash||checked.position.blockHash!==receipt.blockHash||Number(checked.position.blockNumber)!==Number(receipt.blockNumber))return {state:'unknown'};
  const again=await node.getBlockData(receipt.blockNumber);
  if(again?.blockHash!==receipt.blockHash)return {state:'unknown'};
  return {state:development||receipt.status==='finalized'?'confirmed':'submitted',receipt,flagEvent:checked};
 }catch{return {state:'unknown'};}
}
