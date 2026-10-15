import {createEncryptedJournalSlot,journalRecoveryIdentity,decryptJournalDescriptor} from './journal-record.mjs';
import {l2JournalScopeText} from './l2-journal.mjs';
import {FIELD_MODULUS} from './rolling/invocation.mjs';
import {transactionError} from './transaction-outcomes.mjs';
const fail=()=>transactionError('BB_JOURNAL_INVALID','Recovery records could not be authenticated or conflict with newer local records. Preserve both copies.');
const domains=new Map([
 ['ROLLING_TOPUP_FUNDING_V1','ROLLING_TOPUP_FUNDING_V1'],
 ['ROLLING_AGGREGATE_FUNDING_V1','ROLLING_AGGREGATE_FUNDING_V1'],
 ['AZTEC_BB_L2_JOURNAL_KEY_V1','AZTEC_BB_L2_JOURNAL_V1'],
 ['AZTEC_BB_ETH_JOURNAL_KEY_V1','AZTEC_BB_ETH_JOURNAL_V1'],
 ['ROLLING_WORKFLOW_V1','ROLLING_WORKFLOW_V1'],
 ['ROLLING_PREFERENCES_V1','ROLLING_PREFERENCES_V1'],
 ['ROLLING_COLD_PREFERENCES_V1','ROLLING_COLD_PREFERENCES_V1'],
]);
const LIMIT=16*1024*1024;
function validDescriptor(descriptor) {
 if(!descriptor||Object.keys(descriptor).sort().join()!=='keyDomain,scopeText'||!domains.has(descriptor.keyDomain)||typeof descriptor.scopeText!=='string')throw fail();
 const frame=JSON.parse(descriptor.scopeText);
 if(frame[0]!==domains.get(descriptor.keyDomain))throw fail();
 if(descriptor.keyDomain==='ROLLING_TOPUP_FUNDING_V1') {
  if(!Array.isArray(frame)||![11,12].includes(frame.length)||frame.at(-1)!==1||descriptor.scopeText!==JSON.stringify(frame)||!['private-fee','bok'].includes(frame[6]))throw fail();
  for(const index of [1,2])if(typeof frame[index]!=='string'||!/^[1-9][0-9]{0,19}$/.test(frame[index])||BigInt(frame[index])>=FIELD_MODULUS)throw fail();
  for(const index of [3,4,5,7,8,9]){const width=[3,7,8].includes(index)?40:64,value=frame[index];if(typeof value!=='string'||!new RegExp(`^0x[0-9a-f]{${width}}$`).test(value)||BigInt(value)===0n||(width===64&&BigInt(value)>=FIELD_MODULUS))throw fail();}
  if(frame.length===12&&(typeof frame[10]!=='string'||!/^0x[0-9a-f]{64}$/.test(frame[10])))throw fail();
 }
 if(descriptor.keyDomain==='ROLLING_AGGREGATE_FUNDING_V1') {
  if(!Array.isArray(frame)||![8,9].includes(frame.length)||frame.at(-1)!==1||descriptor.scopeText!==JSON.stringify(frame))throw fail();
  if(frame.length===9&&(typeof frame[7]!=='string'||!/^0x[0-9a-f]{64}$/.test(frame[7])))throw fail();
  for(const index of [1,2])if(typeof frame[index]!=='string'||!/^[1-9][0-9]{0,19}$/.test(frame[index])||BigInt(frame[index])>=FIELD_MODULUS)throw fail();
  for(const index of [3,4,5,6]){
   const width=index===3||index===5?40:64,value=frame[index];
   if(typeof value!=='string'||!new RegExp(`^0x[0-9a-f]{${width}}$`).test(value)||BigInt(value)===0n||(width===64&&BigInt(value)>=FIELD_MODULUS))throw fail();
  }
 }
 if(descriptor.keyDomain==='ROLLING_PREFERENCES_V1') {
  // Match preference-reader's complete canonical scope, not the decrypted cache
  // contents. The reader separately validates and reauthenticates that cache.
  if(!Array.isArray(frame)||frame.length!==8||frame[7]!==1||descriptor.scopeText!==JSON.stringify(frame))throw fail();
  for(const index of [1,2]) {
   const value=frame[index];
   if(typeof value!=='string'||value.length>78||!/^[1-9][0-9]*$/.test(value)||BigInt(value)>=FIELD_MODULUS)throw fail();
  }
  for(const index of [3,4,5,6]) {
   const value=frame[index],width=index===3?40:64;
   if(typeof value!=='string'||!new RegExp(`^0x[0-9a-f]{${width}}$`).test(value)||BigInt(value)===0n||(index!==3&&BigInt(value)>=FIELD_MODULUS))throw fail();
  }
 }
 if(descriptor.keyDomain==='ROLLING_COLD_PREFERENCES_V1') {
  // Exact cold-reader AEAD scope, including artifact, proof policy and tier.
  // This authenticates portable ciphertext, never prefix completeness: the
  // reader must recheck its database/epoch/canonical anchor after restoration.
  if(!Array.isArray(frame)||frame.length!==11||frame[10]!==1||descriptor.scopeText!==JSON.stringify(frame))throw fail();
  if(!Number.isSafeInteger(frame[1])||frame[1]<1||!Number.isSafeInteger(frame[2])||frame[2]<1||frame[2]>0xffffffff)throw fail();
  for(const index of [3,4,5,6,7]) {
   const value=frame[index],width=index===3?40:64;
   if(typeof value!=='string'||!new RegExp(`^0x[0-9a-f]{${width}}$`).test(value)||BigInt(value)===0n||(index!==3&&BigInt(value)>=FIELD_MODULUS))throw fail();
  }
  if(typeof frame[8]!=='boolean'||!['proposed','checkpointed','proven','finalized'].includes(frame[9]))throw fail();
 }
 if(descriptor.keyDomain==='ROLLING_WORKFLOW_V1') {
  // Match createRollingApplication's two-level scope exactly. The nested scope
  // remains the complete canonical L2 identity; a domain label alone is not enough.
  if(!Array.isArray(frame)||frame.length!==2||typeof frame[1]!=='string')throw fail();
  const nested=JSON.parse(frame[1]),names=['account','chainId','rollup','version','board','portal'];
  if(!Array.isArray(nested)||nested.length!==7||nested[0]!=='AZTEC_BB_L2_JOURNAL_V1'||nested.some(value=>typeof value!=='string'))throw fail();
  const canonical=l2JournalScopeText(Object.fromEntries(names.map((name,index)=>[name,nested[index+1]])));
  if(frame[1]!==canonical||descriptor.scopeText!==JSON.stringify(['ROLLING_WORKFLOW_V1',canonical]))throw fail();
 }
}
export async function createJournalBackup({storage,walletSecret,walletSalt}) {
 const identity=await journalRecoveryIdentity({walletSecret,walletSalt});
 async function authenticate(record) {
  try {
   if(!record||typeof record.key!=='string'||!/^[0-9a-f]{64}$/.test(record.key)||typeof record.encoded!=='string'||record.encoded.length>LIMIT)throw fail();
   const envelope=JSON.parse(record.encoded),descriptor=await decryptJournalDescriptor(envelope.recovery,identity);
   validDescriptor(descriptor);
   const slot=await createEncryptedJournalSlot({walletSecret,walletSalt,...descriptor,storage:{read:async key=>{if(key!==record.key)throw fail();return record.encoded;}}});
   if(slot.storageKey!==record.key)throw fail();const {value}=await slot.read();
   return {record,descriptor,value};
  }catch{throw fail();}
 }
 return {
  async exportRecords() {
   if(typeof storage.keys!=='function')throw fail();
   const keys=await storage.keys(),records=[];let total=0;
   for(const key of keys) {
    const encoded=await storage.read(key);if(encoded===null)continue;
    let envelope;try{envelope=JSON.parse(encoded);}catch{throw fail();}
    // Legacy records have no authenticated ownership descriptor. Do not silently
    // omit them and present an incomplete recovery file as a complete export.
    if(!envelope.recovery)throw fail();
    if(envelope.recovery.owner!==identity.owner)continue;
    total+=encoded.length;if(total>LIMIT)throw fail();
    records.push((await authenticate({key,encoded})).record);
   }
   const finalKeys=await storage.keys();
   if(JSON.stringify([...keys].sort())!==JSON.stringify([...finalKeys].sort()))throw fail();
   for(const record of records)if(await storage.read(record.key)!==record.encoded)throw fail();
   return records;
  },
  async restoreRecords(records) {
   if(!Array.isArray(records)||records.length>10000)throw fail();
   const seen=new Set(),retained=new Map();let total=0;
   for(const record of records) {
    const incoming=await authenticate(record);total+=record.encoded.length;
    if(incoming.descriptor.keyDomain==='ROLLING_WORKFLOW_V1'&&(incoming.value?.preproof||incoming.value?.preproofReview)&&typeof storage.rotateRecoveryEpoch!=='function')throw fail();
    if(total>LIMIT||seen.has(record.key))throw fail();seen.add(record.key);
    const current=await storage.read(record.key);
    if(current!==null&&current!==record.encoded){
     const local=await authenticate({key:record.key,encoded:current});
     if(local.descriptor.keyDomain!==incoming.descriptor.keyDomain||local.descriptor.scopeText!==incoming.descriptor.scopeText)throw fail();
     // Fresh AEAD IVs do not imply a different financial intent. Keep local
     // bytes only when the entire authenticated JSON payload is identical.
     // Preference snapshots are derived caches, not transaction authorities;
     // their readers revalidate canonical completeness before publishing them.
     const cache=['ROLLING_PREFERENCES_V1','ROLLING_COLD_PREFERENCES_V1'].includes(incoming.descriptor.keyDomain);
     if(!cache&&JSON.stringify(local.value)!==JSON.stringify(incoming.value))throw fail();
     retained.set(record.key,current);
    }
   }
   // A restored pre-proof record is portable ciphertext, never local evidence
   // of a not-yet-broadcast attempt. Invalidate before the FIRST restored write,
   // including idempotent/partial restoration. Normal import holds the same
   // account Web Lock as the complete proof/send lifecycle.
   if(records.length&&typeof storage.rotateRecoveryEpoch==='function')await storage.rotateRecoveryEpoch();
   // Each atomic write is idempotent; partial restoration can be resumed. Never
   // replace an existing intent, even when an older backup decrypts correctly.
   for(const record of records) {
    const current=await storage.read(record.key);
    if(retained.has(record.key)){if(current!==retained.get(record.key))throw fail();continue;}
    if(current===record.encoded)continue;if(current!==null)throw fail();
    try{await storage.compareAndSwap(record.key,null,record.encoded);}catch{throw fail();}
    if(await storage.read(record.key)!==record.encoded)throw fail();
   }
  },
 };
}
