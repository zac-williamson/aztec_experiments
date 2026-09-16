import { transactionError, boundedTransactionRead, classifyDroppedTransaction, submitOnceWithReconciliation, waitForCanonicalReceipt } from './transaction-outcomes.mjs';
import {createEncryptedJournalSlot} from './journal-record.mjs';
const fail=()=>transactionError('BB_RECOVERY_REQUIRED','Recover the saved transaction before starting another operation.');
const invalid=()=>transactionError('BB_JOURNAL_INVALID','Transaction recovery storage could not be authenticated. Preserve it before continuing.');
const scopeNames=['account','chainId','rollup','version','board','portal'];
export function l2JournalScopeText(scope) {
  if(!scope || Object.keys(scope).sort().join()!==[...scopeNames].sort().join())throw invalid();
  for(const name of ['account','board'])if(!/^0x[0-9a-f]{64}$/.test(scope[name]))throw invalid();
  for(const name of ['rollup','portal'])if(!/^0x[0-9a-f]{40}$/.test(scope[name]))throw invalid();
  for(const name of ['chainId','version'])if(!/^[1-9][0-9]{0,19}$/.test(scope[name]))throw invalid();
  return JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',...scopeNames.map(name=>scope[name])]);
}
/** Storage implements read(key) and atomic compareAndSwap(key, prior, next).
 * Values are authenticated ciphertext; the public key is a domain/scope digest.
 * The latest transaction is retained after success. A subsequent request must
 * acknowledge its exact hash, after a fresh canonical receipt check.
 */
export async function createL2Journal({storage,walletSecret,walletSalt,scope,Tx,node,acknowledgeTx,crypto=globalThis.crypto,waitOptions={},contextGuard} ) {
  const slot=await createEncryptedJournalSlot({storage,walletSecret,walletSalt,scopeText:l2JournalScopeText(scope),keyDomain:'AZTEC_BB_L2_JOURNAL_KEY_V1',crypto});
  let acknowledged=acknowledgeTx,lastHash=null,operation=null,replacement=null;
  function containsApplicationNullifier(tx,value) {
    return typeof value==='string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value) &&
      tx.data?.getNonEmptyNullifiers?.().some(item=>item.toString()===value);
  }
  async function read() {
    const saved=await slot.read();if(saved.value===null)return {...saved,tx:null};
    try {
      const record=saved.value;
      if(record.version!==1||typeof record.txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(record.txHash)||typeof record.tx!=='string'||!/^(?:[0-9a-f]{2})+$/.test(record.tx))throw invalid();
      if(record.operation!==undefined&&record.operation!==null&&(typeof record.operation!=='string'||!record.operation.length||record.operation.length>16384))throw invalid();
      if(record.replacements!==undefined) {
        if(!Array.isArray(record.replacements)||record.replacements.length>8)throw invalid();
        const seen=new Set([record.txHash]);
        for(const prior of record.replacements) {
          if(!prior||Object.keys(prior).sort().join()!=='tx,txHash'||typeof prior.tx!=='string'||!/^(?:[0-9a-f]{2})+$/.test(prior.tx)||typeof prior.txHash!=='string'||seen.has(prior.txHash))throw invalid();
          const old=Tx.fromBuffer(Buffer.from(prior.tx,'hex'));
          if(record.applicationNullifier!==undefined&&!containsApplicationNullifier(old,record.applicationNullifier))throw invalid();
          if(old.getTxHash().toString()!==prior.txHash||Buffer.from(old.toBuffer()).toString('hex')!==prior.tx)throw invalid();
          seen.add(prior.txHash);
        }
      }
      const tx=Tx.fromBuffer(Buffer.from(record.tx,'hex'));
      if(record.applicationNullifier!==undefined&&!containsApplicationNullifier(tx,record.applicationNullifier))throw invalid();
      if(tx.getTxHash().toString()!==record.txHash||Buffer.from(tx.toBuffer()).toString('hex')!==record.tx)throw invalid();
      return {...saved,tx};
    }catch{throw invalid();}
  }
  async function assertCanStart() {
    const previous=await read();
    if(previous.tx) {
      if(replacement?.encoded===previous.encoded) {await rejectedAttempts(previous);return previous;}
      if(acknowledged!==previous.tx.getTxHash().toString())throw fail();
      // A previous display or cached receipt cannot authorize a replacement
      // after a reorg. This check intentionally does not regenerate stale proofs.
      await waitForCanonicalReceipt(node,previous.tx,waitOptions);
    }
    return previous;
  }
  async function rejectedAttempts(saved) {
    return boundedTransactionRead(async()=>{
      let reasons=[];
      for(const attempt of [...(saved.value.replacements||[]),{tx:saved.value.tx,txHash:saved.value.txHash}]) {
        const tx=Tx.fromBuffer(Buffer.from(attempt.tx,'hex'));
        let receipt;try{receipt=await node.getTxReceipt(tx.getTxHash());}catch{throw fail();}
        try {await classifyDroppedTransaction(node,tx,receipt);throw fail();}
        catch(error){if(error?.code!=='BB_STATE_CONFLICT')throw fail();reasons=error.stateReasons;}
      }
      return reasons;
    },waitOptions.readTimeoutMs??20000);
  }
  async function prepare(tx,previous,{applicationNullifier}={}) {
    if(applicationNullifier!==undefined&&!containsApplicationNullifier(tx,applicationNullifier))throw invalid();
    let replacements=[];
    if(replacement) {
      if(replacement.encoded!==previous.encoded||operation!==previous.value.operation||!operation)throw fail();
      if(previous.value.applicationNullifier!==undefined && applicationNullifier!==previous.value.applicationNullifier)throw fail();
      await rejectedAttempts(previous);
      replacements=[...(previous.value.replacements||[]),{txHash:previous.value.txHash,tx:previous.value.tx}];
      if(replacements.length>8||replacements.some(prior=>prior.txHash===tx.getTxHash().toString()))throw fail();
    }
    await slot.write(previous,{version:1,txHash:tx.getTxHash().toString(),tx:Buffer.from(tx.toBuffer()).toString('hex'),operation,...(applicationNullifier!==undefined?{applicationNullifier}:{}),...(replacements.length?{replacements}:{})});
    replacement=null;
  }

  function confirmed(receipt) {acknowledged=receipt.txHash.toString();lastHash=acknowledged;}
  async function recoverSaved(saved) {
      if(!saved.tx)throw transactionError('BB_NO_SAVED_TRANSACTION','No saved Aztec transaction exists for this wallet and board.');
      let receipt;try {receipt=await boundedTransactionRead(()=>node.getTxReceipt(saved.tx.getTxHash()));}catch {throw fail();}
      if(receipt?.txHash?.toString()!==saved.tx.getTxHash().toString())throw fail();
      if(receipt.status==='dropped') {
        let validation;try {validation=await boundedTransactionRead(()=>node.isValidTx(saved.tx));}catch {throw fail();}
        if(validation?.result!=='valid')throw fail();
        // A crash before broadcast is safe to recover: identical bytes, hash and
        // nullifiers, never a newly generated proof or a new logical operation.
        if(contextGuard)await contextGuard();
        await submitOnceWithReconciliation(node,saved.tx);
      }
      const result=await waitForCanonicalReceipt(node,saved.tx,waitOptions);confirmed(result);return result;
  }
  return {
    assertCanStart,prepare,confirmed,
    async inspect(){const saved=await read();return saved.value?{operation:saved.value.operation??null,txHash:saved.value.txHash,...(saved.value.applicationNullifier?{applicationNullifier:saved.value.applicationNullifier}:{})}:null;},
    async allowReplacement(expectedOperation){
      const saved=await read();
      if(!saved.tx||!expectedOperation||saved.value.operation!==expectedOperation||(saved.value.replacements?.length??0)>=8)throw fail();
      const reasons=await rejectedAttempts(saved);
      if((await read()).encoded!==saved.encoded)throw fail();
      replacement={encoded:saved.encoded};operation=expectedOperation;return reasons;
    },
    setOperation(value){if(typeof value!=='string'||!value.length||value.length>16384)throw invalid();operation=value;},
    get lastTxHash(){return lastHash;},
    async recover(){return recoverSaved(await read());},
    async reconcilePrevious(){
      const saved=await read();if(!saved.tx)return null;
      const receipt=await recoverSaved(saved);
      if((await read()).encoded!==saved.encoded)throw fail();
      return {receipt,operation:saved.value.operation??null};
    },
  };
}
