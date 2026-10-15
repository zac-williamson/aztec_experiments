import { readCanonicalReceipt, transactionError, boundedTransactionRead, classifyDroppedTransaction, submitOnceWithReconciliation, waitForCanonicalReceipt } from './transaction-outcomes.mjs';
import {createEncryptedJournalSlot} from './journal-record.mjs';
const fail=()=>transactionError('BB_RECOVERY_REQUIRED','Recover the saved transaction before starting another operation.');
const invalid=()=>transactionError('BB_JOURNAL_INVALID','Transaction recovery storage could not be authenticated. Preserve it before continuing.');
// Options are trusted operation policy, never a loose UI object. Capture own
// data primitives before any await; an accessor cannot silently relax the mode.
function replacementOptions(options={}) {
 try {
  if(!options||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(key=>key!=='requireMissingAnchor'))throw invalid();
  const property=Object.getOwnPropertyDescriptor(options,'requireMissingAnchor');
  if(property&&(!Object.hasOwn(property,'value')||typeof property.value!=='boolean'))throw invalid();
  return property?.value??false;
 }catch{throw invalid();}
}
function expectedOperation(value) {if(typeof value!=='string'||!value.length||value.length>16384)throw invalid();return value;}
function recoveryOptions(options) {
 if(options===undefined)return null;
 try{
  if(!options||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw invalid();
  const keys=Reflect.ownKeys(options);if(keys.some(key=>!['expectedOperation','expectedTxHash','beforeSubmit'].includes(key))||!keys.includes('expectedOperation')||!keys.includes('expectedTxHash'))throw invalid();
  const out=Object.fromEntries(keys.map(key=>{const d=Object.getOwnPropertyDescriptor(options,key);if(!d||!Object.hasOwn(d,'value'))throw invalid();return [key,d.value];}));
  expectedOperation(out.expectedOperation);if(typeof out.expectedTxHash!=='string'||!/^0x[0-9a-f]{64}$/.test(out.expectedTxHash)||('beforeSubmit' in out&&typeof out.beforeSubmit!=='function'))throw invalid();
  return out;
 }catch{throw invalid();}
}
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
export async function createL2Journal({storage,walletSecret,walletSalt,scope,Tx,node,acknowledgeTx,crypto=globalThis.crypto,waitOptions={},contextGuard,reconcileOnly=false} ) {
  if(typeof reconcileOnly!=='boolean')throw invalid();
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
      if(record.replacementPolicy!==undefined&&(record.replacementPolicy!=='missing-anchor'||!Array.isArray(record.replacements)||!record.replacements.length))throw invalid();
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
      if(replacement?.encoded===previous.encoded) {await rejectedAttempts(previous,{requireMissingAnchor:replacement.requireMissingAnchor});return previous;}
      if(acknowledged!==previous.tx.getTxHash().toString())throw fail();
      // A previous display or cached receipt cannot authorize a replacement
      // after a reorg. This check intentionally does not regenerate stale proofs.
      const receipt=await waitForCanonicalReceipt(node,previous.tx,waitOptions);
      // The pinned PXE retains reverted sender-tagging ranges until finality.
      // Acknowledging the failure cannot make its missing predecessor safe to use.
      if(receipt.executionResult==='reverted' && receipt.status!=='finalized') {
        throw transactionError('BB_TRANSACTION_FINALITY_PENDING','The previous transaction reverted. Wait for network finality before starting another action; keep its saved record.');
      }
    }
    return previous;
  }
  const attemptsOf=(saved,priorOnly=false)=>[...(saved.value.replacements||[]),...(priorOnly?[]:[{tx:saved.value.tx,txHash:saved.value.txHash}])];
  const strictMode=(saved,requested)=>requested||saved.value.replacementPolicy==='missing-anchor';
  async function attemptState(attempt,active) {
    const reading=Object.fromEntries(['getTxReceipt','isValidTx','getBlock'].map(name=>[name,(...args)=>{if(!active())throw fail();return node[name](...args);} ]));
    const result={txHash:attempt.txHash,status:'unknown',stateReasons:[]};
    try {
      const tx=Tx.fromBuffer(Buffer.from(attempt.tx,'hex'));
      let receipt=await reading.getTxReceipt(tx.getTxHash());
      if(!active())return result;
      if(receipt?.txHash?.toString()!==attempt.txHash)return result;
      if(receipt.status==='dropped') {
        try {receipt=await classifyDroppedTransaction(reading,tx,receipt);}
        catch(error) {
          // Only fixed structured classifier results, never messages or causes.
          const code=Object.getOwnPropertyDescriptor(error??{},'code'),reasons=Object.getOwnPropertyDescriptor(error??{},'stateReasons');
          if(code?.value==='BB_STATE_CONFLICT'&&Array.isArray(reasons?.value)&&reasons.value.length&&reasons.value.length<=8&&reasons.value.every(reason=>['Existing nullifier','Block header not found'].includes(reason))) {
            return {...result,status:'invalid',stateReasons:[...reasons.value]};
          }
          return result;
        }
      }
      if(['pending','proposed'].includes(receipt?.status))return {...result,status:'pending'};
      if(['checkpointed','proven','finalized'].includes(receipt?.status)) {
        const canonical=await readCanonicalReceipt(reading,tx.getTxHash(),waitOptions);
        if(canonical)return {...result,status:'canonical'};
      }
    }catch{/* Unknown is not replacement authority. No diagnostic is retained. */}
    return result;
  }
  async function inspectAttempts(saved,priorOnly=false) {
    // A timed-out read cannot be cancelled by this SDK, but it must not start
    // later validation/receipt requests or advance through more predecessors.
    let active=true;
    try {return await boundedTransactionRead(async()=>{
      const result=[];
      for(const attempt of attemptsOf(saved,priorOnly)) {
        if(!active)break;
        result.push(await attemptState(attempt,()=>active));
      }
      return result;
    },waitOptions.readTimeoutMs??20000);}finally{active=false;}
  }
  function rejected(rows,requireMissingAnchor) {
    return rows.length>0&&rows.every(row=>row.status==='invalid'&&row.stateReasons.length&&
      (!requireMissingAnchor||row.stateReasons.every(reason=>reason==='Block header not found')));
  }
  async function rejectedAttempts(saved,{requireMissingAnchor=false,priorOnly=false}={}) {
    const rows=await inspectAttempts(saved,priorOnly);
    if(!rejected(rows,strictMode(saved,requireMissingAnchor)))throw fail();
    return [...rows.at(-1).stateReasons]; // Preserve legacy allowReplacement return.
  }
  async function prepare(tx,previous,{applicationNullifier}={}) {
    // The caller's previous.value is a convenient view, not authority over saved
    // signed bytes. Re-read authenticated state before retaining predecessors.
    const authenticated=await read();
    const encoded=Object.getOwnPropertyDescriptor(previous??{},'encoded');
    if(!encoded||!Object.hasOwn(encoded,'value')||authenticated.encoded!==encoded.value)throw invalid();
    previous=authenticated;
    if(applicationNullifier!==undefined&&!containsApplicationNullifier(tx,applicationNullifier))throw invalid();
    let replacements=[];
    const authorization=replacement,selectedOperation=operation;
    if(authorization) {
      if(authorization.encoded!==previous.encoded||selectedOperation!==previous.value.operation||!selectedOperation)throw fail();
      if(previous.value.applicationNullifier!==undefined && applicationNullifier!==previous.value.applicationNullifier)throw fail();
      await rejectedAttempts(previous,{requireMissingAnchor:authorization.requireMissingAnchor});
      replacements=[...(previous.value.replacements||[]),{txHash:previous.value.txHash,tx:previous.value.tx}];
      if(replacements.length>8||replacements.some(prior=>prior.txHash===tx.getTxHash().toString()))throw fail();
    }
    if(operation!==selectedOperation||replacement!==authorization)throw fail();
    await slot.write(previous,{version:1,txHash:tx.getTxHash().toString(),tx:Buffer.from(tx.toBuffer()).toString('hex'),operation:selectedOperation,...(authorization?.requireMissingAnchor?{replacementPolicy:'missing-anchor'}:{}),...(applicationNullifier!==undefined?{applicationNullifier}:{}),...(replacements.length?{replacements}:{})});
    replacement=null;
  }

  function confirmed(receipt) {acknowledged=receipt.txHash.toString();lastHash=acknowledged;}
  function bindRecovery(saved,binding){
    if(binding&&(!saved.tx||saved.value.operation!==binding.expectedOperation||saved.value.txHash!==binding.expectedTxHash))throw fail();
  }
  async function savedRecoveryStatus(saved){
    let active=true;
    const reading=Object.fromEntries(['getTxReceipt','isValidTx','getBlock'].map(name=>[name,(...args)=>{if(!active)throw fail();return node[name](...args);} ]));
    try{return await boundedTransactionRead(async()=>{
      let receipt=await reading.getTxReceipt(saved.tx.getTxHash());if(!active||receipt?.txHash?.toString()!==saved.value.txHash)return 'unknown';
      if(receipt.status==='dropped'){
        const validity=await reading.isValidTx(saved.tx);if(!active)return 'unknown';
        receipt=await reading.getTxReceipt(saved.tx.getTxHash());if(!active||receipt?.txHash?.toString()!==saved.value.txHash)return 'unknown';
        if(receipt.status==='dropped')return validity?.result==='valid'?'resumable':'unknown';
      }
      if(['pending','proposed'].includes(receipt.status))return 'pending';
      if(['checkpointed','proven','finalized'].includes(receipt.status))return await readCanonicalReceipt(reading,saved.tx.getTxHash(),waitOptions)?'canonical':'unknown';
      return 'unknown';
    },waitOptions.readTimeoutMs??20000);}catch{return 'unknown';}finally{active=false;}
  }
  async function recoverSaved(saved,binding=null) {
      if(!saved.tx)throw transactionError('BB_NO_SAVED_TRANSACTION','No saved Aztec transaction exists for this wallet and board.');
      bindRecovery(saved,binding);
      let receipt;try {receipt=await boundedTransactionRead(()=>node.getTxReceipt(saved.tx.getTxHash()));}catch {throw fail();}
      if(receipt?.txHash?.toString()!==saved.tx.getTxHash().toString())throw fail();
      if(receipt.status==='dropped') {
        // Operator restart observes the original intent; even identical bytes
        // are a retransmission and require a separate explicit recovery flow.
        if(reconcileOnly)throw fail();
        let validation;try {validation=await boundedTransactionRead(()=>node.isValidTx(saved.tx));}catch {throw fail();}
        // Re-inclusion or pending status during validation is reconciliation,
        // not permission to broadcast the same bytes again.
        try{receipt=await boundedTransactionRead(()=>node.getTxReceipt(saved.tx.getTxHash()),waitOptions.readTimeoutMs??20000);}catch{throw fail();}
        if(receipt?.txHash?.toString()!==saved.value.txHash)throw fail();
        if(receipt.status==='dropped'){
        if(validation?.result!=='valid')throw fail();
        // A crash before broadcast is safe to recover: identical bytes, hash and
        // nullifiers, never a newly generated proof or a new logical operation.
        if(contextGuard)await contextGuard();
        if(saved.value.replacementPolicy==='missing-anchor') {
          // Recovery is another send boundary, not a bypass around replacement
          // policy. Authenticate every predecessor from the retained exact bytes.
          await rejectedAttempts(saved,{requireMissingAnchor:true,priorOnly:true});
        }
        // App context must be fresh after all asynchronous predecessor checks.
        // Keep the later ciphertext reauthentication: the trusted callback may
        // await, and the caller retains its exclusive wallet lease until send.
        if(binding?.beforeSubmit)await binding.beforeSubmit(saved.value.txHash);
          if((await read()).encoded!==saved.encoded)throw fail();
          if(contextGuard)await contextGuard();
          // An account guard can await; a concurrent writer must not replace the
          // authenticated candidate while that check is in flight.
          if((await read()).encoded!==saved.encoded)throw fail();
          // The caller holds its exclusive wallet lease through this send. Finish
          // all storage/decryption awaits before the final account validation;
          // no further storage work may introduce a lock/logout gap here.
          if(contextGuard)await contextGuard();
        await submitOnceWithReconciliation(node,saved.tx);
        }else if(!['pending','proposed','checkpointed','proven','finalized'].includes(receipt.status))throw fail();
      }
      const result=await waitForCanonicalReceipt(node,saved.tx,waitOptions);confirmed(result);return result;
  }
  return {
    assertCanStart,prepare,confirmed,
    async inspect(){const saved=await read();return saved.value?{operation:saved.value.operation??null,txHash:saved.value.txHash,predecessorTxHashes:(saved.value.replacements??[]).map(item=>item.txHash),...(saved.value.applicationNullifier?{applicationNullifier:saved.value.applicationNullifier}:{})}:null;},
    async inspectOutcome(){
      const saved=await read();if(!saved.tx)return null;
      const receipt=await readCanonicalReceipt(node,saved.tx.getTxHash(),waitOptions);
      if((await read()).encoded!==saved.encoded)throw fail();
      return {operation:saved.value.operation??null,txHash:saved.value.txHash,applicationNullifier:saved.value.applicationNullifier??null,outcome:receipt?.executionResult??'pending',receipt};
    },
    /** Read-only status, not a permit. Each row is bound to exact authenticated Tx
     * bytes. A canonical predecessor does not mean the current candidate won.
     * No acknowledgement, authorization, journal write or broadcast occurs here. */
    async inspectReplacement(operationInput,options){
      const expected=expectedOperation(operationInput),requested=replacementOptions(options);
      const saved=await read();
      if(!saved.tx)return Object.freeze({status:'empty',operation:null,txHash:null,predecessorTxHashes:Object.freeze([]),requireMissingAnchor:requested,attempts:Object.freeze([])});
      if(saved.value.operation!==expected)throw fail();
      const requireMissingAnchor=strictMode(saved,requested);
      let rows;try{rows=await inspectAttempts(saved);}catch{rows=attemptsOf(saved).map(attempt=>({txHash:attempt.txHash,status:'unknown',stateReasons:[]}));}
      if((await read()).encoded!==saved.encoded)throw fail();
      const status=rows.some(row=>row.status==='canonical')?'canonical':rows.some(row=>row.status==='pending')?'pending':
        !rejected(rows,requireMissingAnchor)?'unknown':(saved.value.replacements?.length??0)>=8?'limit-reached':'available';
      return Object.freeze({status,operation:expected,txHash:saved.value.txHash,
        predecessorTxHashes:Object.freeze((saved.value.replacements??[]).map(item=>item.txHash)),requireMissingAnchor,
        attempts:Object.freeze(rows.map(row=>Object.freeze({...row,stateReasons:Object.freeze([...row.stateReasons])})))});
    },
    /** Exact-byte inspection is not a resend permit. The app must explicitly
     * confirm recover with the same operation/hash and hold its wallet lease. */
    async inspectSavedRecovery(operationInput,txHashInput){
      const binding=recoveryOptions({expectedOperation:operationInput,expectedTxHash:txHashInput});
      if(contextGuard)await contextGuard();const saved=await read();
      if(!saved.tx)return Object.freeze({status:'empty',operation:null,txHash:null});bindRecovery(saved,binding);
      let status=await savedRecoveryStatus(saved);
      if(status==='resumable'&&saved.value.replacementPolicy==='missing-anchor'){
        try{await rejectedAttempts(saved,{requireMissingAnchor:true,priorOnly:true});}catch{status='unknown';}
      }
      if((await read()).encoded!==saved.encoded)throw fail();if(contextGuard)await contextGuard();
      return Object.freeze({status,operation:saved.value.operation??null,txHash:saved.value.txHash});
    },
    async allowReplacement(operationInput,options){
      replacement=null; // A failed renewed authorization cannot retain an old permit.
      const expected=expectedOperation(operationInput),requested=replacementOptions(options);
      const saved=await read();
      if(!saved.tx||saved.value.operation!==expected||(saved.value.replacements?.length??0)>=8)throw fail();
      const requireMissingAnchor=strictMode(saved,requested);
      const reasons=await rejectedAttempts(saved,{requireMissingAnchor});
      if((await read()).encoded!==saved.encoded)throw fail();
      replacement={encoded:saved.encoded,requireMissingAnchor};operation=expected;return reasons;
    },
    /** Call from the existing wallet beforeSubmit hook, after prepare saved the
     * new candidate. Never classify that valid candidate as an old rejection.
     * Persisted strict policy cannot be downgraded after restart. */
    async assertReplacementPredecessors(operationInput,currentTxHash,options){
      const expected=expectedOperation(operationInput),requested=replacementOptions(options);
      if(typeof currentTxHash!=='string'||!/^0x[0-9a-f]{64}$/.test(currentTxHash))throw invalid();
      const saved=await read();
      if(!saved.tx||saved.value.operation!==expected||saved.value.txHash!==currentTxHash||!saved.value.replacements?.length)throw fail();
      await rejectedAttempts(saved,{requireMissingAnchor:requested,priorOnly:true});
      if((await read()).encoded!==saved.encoded)throw fail();
      return true;
    },
    setOperation(value){if(typeof value!=='string'||!value.length||value.length>16384)throw invalid();operation=value;},
    get lastTxHash(){return lastHash;},
    async recover(options){const binding=recoveryOptions(options);return recoverSaved(await read(),binding);},
    async reconcilePrevious(options){
      const binding=recoveryOptions(options);
      const saved=await read();if(!saved.tx)return null;
      const receipt=await recoverSaved(saved,binding);
      if((await read()).encoded!==saved.encoded)throw fail();
      return {receipt,operation:saved.value.operation??null};
    },
  };
}
