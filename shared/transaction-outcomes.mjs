// Explicit submission/receipt outcomes. Diagnostic bodies never escape this boundary.
export const transactionError=(code,message)=>Object.assign(new Error(message),{code});
const accepted=new Set(['checkpointed','proven','finalized']);
const pending=new Set(['pending','proposed']);
const hash=value=>value?.toString?.();
export function requireSuccessfulReceipt(receipt,txHash) {
  if(hash(receipt?.txHash)!==hash(txHash) || !accepted.has(receipt?.status) || receipt.executionResult!=='success' ||
    !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber<1 || !receipt.blockHash) {
    throw transactionError('BB_TRANSACTION_FAILED','Transaction does not have a successful confirmed receipt.');
  }
  return receipt;
}
export async function submitOnceWithReconciliation(node,tx) {
  try {await node.sendTx(tx);}
  catch {
    let receipt;try {receipt=await node.getTxReceipt(tx.getTxHash());}catch {}
    if(hash(receipt?.txHash)===hash(tx.getTxHash())) {
      if(pending.has(receipt?.status)||accepted.has(receipt?.status))return receipt;
      if(receipt?.status==='dropped')return classifyDroppedTransaction(node,tx,receipt);
    }
    throw transactionError('BB_SUBMISSION_UNKNOWN','Submission outcome is unknown. Reconcile this transaction before retrying.');
  }
}
export async function classifyDroppedTransaction(node,tx,receipt) {
  if(receipt?.status!=='dropped' || hash(receipt.txHash)!==hash(tx.getTxHash())) throw transactionError('BB_SUBMISSION_UNKNOWN','Transaction identity is unavailable.');
  let validation,refreshed;
  try {validation=await node.isValidTx(tx);refreshed=await node.getTxReceipt(tx.getTxHash());}
  catch {throw transactionError('BB_SUBMISSION_UNKNOWN','Dropped transaction could not be reconciled.');}
  if(hash(refreshed?.txHash)!==hash(tx.getTxHash())) throw transactionError('BB_SUBMISSION_UNKNOWN','Transaction identity changed.');
  if(pending.has(refreshed.status)||accepted.has(refreshed.status)) return refreshed;
  const reasons=['Existing nullifier','Block header not found'];
  if(refreshed.status==='dropped' && validation?.result==='invalid' && Array.isArray(validation.reason) && validation.reason.length && validation.reason.every(reason=>reasons.includes(reason))) {
    throw Object.assign(transactionError('BB_STATE_CONFLICT','Transaction state changed. Refresh and create a new proof.'),{stateReasons:[...validation.reason]});
  }
  throw transactionError('BB_SUBMISSION_UNKNOWN','Drop reason is unconfirmed. Reconcile before retrying.');
}
export async function waitForCanonicalReceipt(node,tx,{timeoutMs=540000,intervalMs=5000,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onPoll=()=>{}}={}) {
  const txHash=tx.getTxHash(),deadline=now()+timeoutMs;
  while(now()<deadline) {
    let receipt;
    try {receipt=await node.getTxReceipt(txHash);}catch {/* Transport/schema failure is unknown, never success. */}
    if(receipt) {
      if(hash(receipt.txHash)!==hash(txHash)) throw transactionError('BB_SUBMISSION_UNKNOWN','Receipt identity does not match.');
      if(receipt.status==='dropped')receipt=await classifyDroppedTransaction(node,tx,receipt);
      if(accepted.has(receipt.status)) {
        if(!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber<1 || !receipt.blockHash) throw transactionError('BB_SUBMISSION_UNKNOWN','Receipt block identity is unavailable.');
        let block;try {block=await node.getBlock(receipt.blockNumber);}catch {}
        if(!block || hash(block.hash)!==hash(receipt.blockHash)) throw transactionError('BB_SUBMISSION_UNKNOWN','Receipt block is not confirmed canonical.');
        if(!['success','reverted'].includes(receipt.executionResult))throw transactionError('BB_SUBMISSION_UNKNOWN','Receipt execution result is unavailable.');
        return receipt;
      }
      if(!pending.has(receipt.status))throw transactionError('BB_SUBMISSION_UNKNOWN','Receipt status is unrecognized.');
    }
    onPoll();await sleep(Math.min(intervalMs,Math.max(0,deadline-now())));
  }
  throw transactionError('BB_SUBMISSION_UNKNOWN','Confirmation timed out. Keep the transaction identifier and reconcile before retrying.');
}

export async function waitForSuccessfulReceipt(node,tx,options={}) {
  return requireSuccessfulReceipt(await waitForCanonicalReceipt(node,tx,options),tx.getTxHash());
}
