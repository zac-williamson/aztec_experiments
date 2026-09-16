import {validateFeedEvent} from '../shared/protocol-schema.mjs';
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
