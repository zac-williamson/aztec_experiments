import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {Tx,MinedTxReceipt} from '@aztec-labs/stdlib/tx';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createJournalBackup} from '../shared/journal-backup.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
async function fixture(fn){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-portable-'));
 try {
  const browser=createBrowserJournalStorage(new IDBFactory()),file=createFileJournalStorage(directory);
  const options={walletSecret:field(),walletSalt:field(),scope:{account:field(),board:field(),portal:'0x'+'11'.repeat(20),rollup:'0x'+'22'.repeat(20),chainId:'31337',version:'5'}};
  const tx=Tx.random({randomProof:true}),node={getTxReceipt:async()=>MinedTxReceipt.from({txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',transactionFee:0n,blockNumber:2,blockHash:BlockHash.ZERO,slotNumber:2,txIndexInBlock:0,epochNumber:0}),getBlock:async()=>({hash:BlockHash.ZERO})};
  const journal=await createL2Journal({...options,storage:browser,Tx,node});await journal.prepare(tx,await journal.assertCanStart());
  await fn({directory,browser,file,options,tx,node,backup:storage=>createJournalBackup({...options,storage})});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('authenticated journal transport transfers an actual SDK transaction across browser and file storage',()=>fixture(async f=>{
 const exported=await (await f.backup(f.browser)).exportRecords();assert.equal(exported.length,1);
 // The journal already authenticates/encrypts each record; no account key or
 // retired password/file identity envelope is part of the transport.
 const serialized=JSON.stringify(exported);
 for(const privateValue of [f.options.walletSecret,f.options.walletSalt,f.tx.toBuffer().toString('hex')])assert(!serialized.includes(privateValue));
 const decoded=JSON.parse(serialized);
 await (await f.backup(f.file)).restoreRecords(decoded);
 const restored=await createL2Journal({...f.options,storage:f.file,Tx,node:f.node});
 await assert.rejects(restored.assertCanStart(),{code:'BB_RECOVERY_REQUIRED'});
 assert.equal((await restored.recover()).txHash.toString(),f.tx.getTxHash().toString());
 assert.deepEqual(await (await f.backup(f.file)).exportRecords(),exported);
 await (await f.backup(f.browser)).restoreRecords(exported); // exact duplicate is idempotent
}));
test('older authenticated backup never replaces newer local transaction',()=>fixture(async f=>{
 const records=await (await f.backup(f.browser)).exportRecords();await (await f.backup(f.file)).restoreRecords(records);
 const newer=await createL2Journal({...f.options,storage:f.file,Tx,node:f.node,acknowledgeTx:f.tx.getTxHash().toString()});
 await newer.prepare(Tx.random({randomProof:true}),await newer.assertCanStart());
 const before=await (await f.backup(f.file)).exportRecords();
 await assert.rejects((await f.backup(f.file)).restoreRecords(records),{code:'BB_JOURNAL_INVALID'});
 assert.deepEqual(await (await f.backup(f.file)).exportRecords(),before);
}));
test('foreign wallet, moved key, descriptor damage and duplicated records fail before restore writes',()=>fixture(async f=>{
 const records=await (await f.backup(f.browser)).exportRecords();
 const wrong=await createJournalBackup({...f.options,walletSalt:field(),storage:f.file});await assert.rejects(wrong.restoreRecords(records),{code:'BB_JOURNAL_INVALID'});
 const damaged=JSON.parse(records[0].encoded),original=damaged.recovery.data;
 damaged.recovery.data=(parseInt(original.slice(0,2),16)^1).toString(16).padStart(2,'0')+original.slice(2);
 assert.notEqual(damaged.recovery.data,original);
 for(const value of [[{...records[0],key:'00'.repeat(32)}],[{...records[0],encoded:JSON.stringify(damaged)}],[...records,...records]]) {
  await assert.rejects((await f.backup(f.file)).restoreRecords(value),{code:'BB_JOURNAL_INVALID'});assert.deepEqual(await f.file.keys(),[]);
 }
}));
test('export filters other wallets but refuses legacy records lacking ownership metadata',()=>fixture(async f=>{
 const other=await createL2Journal({...f.options,scope:{...f.options.scope,account:field()},walletSecret:field(),storage:f.browser,Tx,node:f.node});await other.prepare(f.tx,await other.assertCanStart());
 assert.equal((await (await f.backup(f.browser)).exportRecords()).length,1);
 await f.browser.compareAndSwap('ff'.repeat(32),null,JSON.stringify({version:1,iv:'00'.repeat(12),data:'01'}));
 await assert.rejects((await f.backup(f.browser)).exportRecords(),{code:'BB_JOURNAL_INVALID'});
}));

test('restored file journal retains private file permissions and rejects exposed ciphertext custody',()=>fixture(async f=>{
 const records=await (await f.backup(f.browser)).exportRecords();await (await f.backup(f.file)).restoreRecords(records);
 const filename=path.join(f.directory,records[0].key+'.json');assert.equal(fs.statSync(filename).mode&0o777,0o600);
 const reopened=await createL2Journal({...f.options,storage:createFileJournalStorage(f.directory),Tx,node:f.node});
 const inspection=await reopened.inspectOutcome();assert.equal(inspection.receipt.status,'checkpointed');assert.equal(inspection.outcome,'success');
 assert.equal(inspection.txHash,f.tx.getTxHash().toString());
 fs.chmodSync(filename,0o644);await assert.rejects((await f.backup(f.file)).exportRecords(),/Invalid journal record/);
}));
