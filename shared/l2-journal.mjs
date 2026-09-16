import { transactionError, submitOnceWithReconciliation, waitForCanonicalReceipt } from './transaction-outcomes.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const hex=data=>Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
const bytes=value=>Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16));
const fail=()=>transactionError('BB_RECOVERY_REQUIRED','Recover the saved transaction before starting another operation.');
const invalid=()=>transactionError('BB_JOURNAL_INVALID','Transaction recovery storage could not be authenticated. Preserve it before continuing.');
const scopeNames=['account','chainId','rollup','version','board','portal'];
const MAX_BYTES=16*1024*1024;
function scopeText(scope) {
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
  const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  if(typeof walletSecret!=='string'||!/^0x[0-9a-f]{64}$/.test(walletSecret)||BigInt(walletSecret)<=0n||BigInt(walletSecret)>=field)throw invalid();
  if(!['string','number','bigint'].includes(typeof walletSalt)||(typeof walletSalt==='number'&&!Number.isSafeInteger(walletSalt)))throw invalid();
  let salt;try {salt=BigInt(walletSalt);}catch {throw invalid();}if(salt<0n||salt>=field)throw invalid();
  const aad=encoder.encode(scopeText(scope));
  const keyMaterial=encoder.encode('AZTEC_BB_L2_JOURNAL_KEY_V1\0'+walletSecret+':'+salt.toString(16).padStart(64,'0'));
  const digest=await crypto.subtle.digest('SHA-256',keyMaterial);keyMaterial.fill(0);
  const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
  const storageKey=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',aad)));
  let acknowledged=acknowledgeTx,lastHash=null;
  async function read() {
    let encoded;try {encoded=await storage.read(storageKey);}catch {throw invalid();}
    if(encoded===null)return {encoded:null,tx:null};
    let plain;
    try {
      if(typeof encoded!=='string'||encoded.length>MAX_BYTES*2+1024)throw invalid();
      const envelope=JSON.parse(encoded);
      if(envelope.version!==1||typeof envelope.iv!=='string'||!/^[0-9a-f]{24}$/.test(envelope.iv)||typeof envelope.data!=='string'||envelope.data.length>MAX_BYTES*2||!/^(?:[0-9a-f]{2})+$/.test(envelope.data))throw invalid();
      plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:aad},key,bytes(envelope.data)));
      const record=JSON.parse(decoder.decode(plain));
      if(record.version!==1||typeof record.txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(record.txHash)||typeof record.tx!=='string'||!/^(?:[0-9a-f]{2})+$/.test(record.tx))throw invalid();
      const tx=Tx.fromBuffer(Buffer.from(record.tx,'hex'));
      if(tx.getTxHash().toString()!==record.txHash||Buffer.from(tx.toBuffer()).toString('hex')!==record.tx)throw invalid();
      return {encoded,tx};
    }catch {throw invalid();}finally {plain?.fill(0);}
  }
  async function assertCanStart() {
    const previous=await read();
    if(previous.tx) {
      if(acknowledged!==previous.tx.getTxHash().toString())throw fail();
      // A previous display or cached receipt cannot authorize a replacement
      // after a reorg. This check intentionally does not regenerate stale proofs.
      await waitForCanonicalReceipt(node,previous.tx,waitOptions);
    }
    return previous;
  }
  async function prepare(tx,previous) {
    const txHash=tx.getTxHash().toString(),iv=crypto.getRandomValues(new Uint8Array(12));
    const plain=encoder.encode(JSON.stringify({version:1,txHash,tx:Buffer.from(tx.toBuffer()).toString('hex')}));
    if(plain.length>MAX_BYTES-16)throw invalid();
    let encoded;
    try {encoded=JSON.stringify({version:1,iv:hex(iv),data:hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain)))});}finally {plain.fill(0);}
    try {await storage.compareAndSwap(storageKey,previous.encoded,encoded);}catch {throw invalid();}
    const saved=await read();if(saved.encoded!==encoded||saved.tx.getTxHash().toString()!==txHash)throw invalid();
  }
  function confirmed(receipt) {acknowledged=receipt.txHash.toString();lastHash=acknowledged;}
  return {
    assertCanStart,prepare,confirmed,
    get lastTxHash(){return lastHash;},
    async recover() {
      const saved=await read();if(!saved.tx)throw transactionError('BB_NO_SAVED_TRANSACTION','No saved Aztec transaction exists for this wallet and board.');
      let receipt;try {receipt=await node.getTxReceipt(saved.tx.getTxHash());}catch {throw fail();}
      if(receipt?.txHash?.toString()!==saved.tx.getTxHash().toString())throw fail();
      if(receipt.status==='dropped') {
        let validation;try {validation=await node.isValidTx(saved.tx);}catch {throw fail();}
        if(validation?.result!=='valid')throw fail();
        // A crash before broadcast is safe to recover: identical bytes, hash and
        // nullifiers, never a newly generated proof or a new logical operation.
        if(contextGuard)await contextGuard();
        await submitOnceWithReconciliation(node,saved.tx);
      }
      const result=await waitForCanonicalReceipt(node,saved.tx,waitOptions);confirmed(result);return result;
    },
  };
}
