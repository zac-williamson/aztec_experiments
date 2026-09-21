import {createEncryptedJournalSlot,journalRecoveryIdentity,decryptJournalDescriptor} from './journal-record.mjs';
import {transactionError} from './transaction-outcomes.mjs';
const fail=()=>transactionError('BB_JOURNAL_INVALID','Recovery records could not be authenticated or conflict with newer local records. Preserve both copies.');
const domains=new Map([
 ['AZTEC_BB_L2_JOURNAL_KEY_V1','AZTEC_BB_L2_JOURNAL_V1'],
 ['AZTEC_BB_ETH_JOURNAL_KEY_V1','AZTEC_BB_ETH_JOURNAL_V1'],
]);
const LIMIT=16*1024*1024;
export async function createJournalBackup({storage,walletSecret,walletSalt}) {
 const identity=await journalRecoveryIdentity({walletSecret,walletSalt});
 async function authenticate(record) {
  try {
   if(!record||typeof record.key!=='string'||!/^[0-9a-f]{64}$/.test(record.key)||typeof record.encoded!=='string'||record.encoded.length>LIMIT)throw fail();
   const envelope=JSON.parse(record.encoded),descriptor=await decryptJournalDescriptor(envelope.recovery,identity);
   if(Object.keys(descriptor).sort().join()!=='keyDomain,scopeText'||!domains.has(descriptor.keyDomain)||typeof descriptor.scopeText!=='string'||JSON.parse(descriptor.scopeText)[0]!==domains.get(descriptor.keyDomain))throw fail();
   const slot=await createEncryptedJournalSlot({walletSecret,walletSalt,...descriptor,storage:{read:async key=>{if(key!==record.key)throw fail();return record.encoded;}}});
   if(slot.storageKey!==record.key)throw fail();await slot.read();
   return record;
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
    records.push(await authenticate({key,encoded}));
   }
   const finalKeys=await storage.keys();
   if(JSON.stringify([...keys].sort())!==JSON.stringify([...finalKeys].sort()))throw fail();
   for(const record of records)if(await storage.read(record.key)!==record.encoded)throw fail();
   return records;
  },
  async restoreRecords(records) {
   if(!Array.isArray(records)||records.length>10000)throw fail();
   const seen=new Set();let total=0;
   for(const record of records) {
    await authenticate(record);total+=record.encoded.length;
    if(total>LIMIT||seen.has(record.key))throw fail();seen.add(record.key);
    const current=await storage.read(record.key);if(current!==null&&current!==record.encoded)throw fail();
   }
   // Each atomic write is idempotent; partial restoration can be resumed. Never
   // replace an existing intent, even when an older backup decrypts correctly.
   for(const record of records) {
    const current=await storage.read(record.key);
    if(current===record.encoded)continue;if(current!==null)throw fail();
    try{await storage.compareAndSwap(record.key,null,record.encoded);}catch{throw fail();}
    if(await storage.read(record.key)!==record.encoded)throw fail();
   }
  },
 };
}
