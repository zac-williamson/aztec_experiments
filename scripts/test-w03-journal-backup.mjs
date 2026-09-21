import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {Tx} from '@aztec/stdlib/tx';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createJournalBackup} from '../shared/journal-backup.mjs';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
import '../shared/wallet-backup.js';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
async function fixture(fn){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-portable-'));
 try {
  const browser=createBrowserJournalStorage(new IDBFactory()),file=createFileJournalStorage(directory);
  const options={walletSecret:field(),walletSalt:field(),scope:{account:field(),board:field(),portal:'0x'+'11'.repeat(20),rollup:'0x'+'22'.repeat(20),chainId:'31337',version:'5'}};
  const tx=Tx.random({randomProof:true}),node={getTxReceipt:async()=>({txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:2,blockHash:'canonical'}),getBlock:async()=>({hash:'canonical'})};
  const journal=await createL2Journal({...options,storage:browser,Tx,node});await journal.prepare(tx,await journal.assertCanStart());
  await fn({browser,file,options,tx,node,backup:storage=>createJournalBackup({...options,storage})});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('password recovery file transfers actual SDK transaction browser to CLI and back without changing identity',()=>fixture(async f=>{
 const exported=await (await f.backup(f.browser)).exportRecords();assert.equal(exported.length,1);
 const password=randomBytes(24).toString('hex');
 const encrypted=await BillboardWalletBackup.encrypt({schemaVersion:2,wallet:{secretKey:f.options.walletSecret,salt:f.options.walletSalt},claims:[],journals:exported},password);
 const decoded=await BillboardWalletBackup.decrypt(encrypted,password);
 await (await f.backup(f.file)).restoreRecords(decoded.journals);
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
 const damaged=JSON.parse(records[0].encoded);damaged.recovery.data='00'+damaged.recovery.data.slice(2);
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

import {createClaimSecretStore} from '../apps/src/billboard/user/claim-secret-store.mjs';
import {createRecoveryFile} from '../apps/src/billboard/user/recovery-file.mjs';
import {Fr} from '@aztec/foundation/curves/bn254';
import {computeSecretHash} from '@aztec/stdlib/hash';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('actual offline CLI restores fresh wallet plus claims/journals, exports portable file, rejects overwrite and wrong password',()=>fixture(async f=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bb-recovery-cli-'));
 try {
  const sourceClaims=createClaimSecretStore(path.join(directory,'source-claims'),f.options.walletSecret,f.options.walletSalt);
  const secret=Fr.random(),secretHash=(await computeSecretHash(secret)).toString();
  const scope={l1ChainId:'31337',rollupAddress:f.options.scope.rollup,rollupVersion:'5',boardAddress:f.options.scope.board,portalAddress:f.options.scope.portal,depositor:'0x'+'33'.repeat(20)};
  await sourceClaims.save(scope,{schemaVersion:1,secret:secret.toString(),secretHash});
  const wallet={secretKey:f.options.walletSecret,salt:f.options.walletSalt},password=randomBytes(24).toString('hex');
  const envelope=await createRecoveryFile({wallet,storage:f.browser,claimStore:sourceClaims,password});
  const backup=path.join(directory,'backup.json'),target=path.join(directory,'fresh','wallet.json'),output=path.join(directory,'export.json');
  fs.writeFileSync(backup,JSON.stringify(envelope),{mode:0o600});
  const cli=fileURLToPath(new URL('../apps/src/billboard/user/recovery-cli.mjs',import.meta.url));
  function run(action,file,pass=password){const result=spawnSync(process.execPath,[cli,action,'--wallet',target,'--file',file],{input:pass+'\n',encoding:'utf8',timeout:10000,env:{...process.env,NODE_BACKEND:'js'}});assert(!((result.stdout||'')+(result.stderr||'')).includes(wallet.secretKey));return result;}
  assert.equal(run('restore',backup,'wrong-password-value').status,1);assert.equal(fs.existsSync(target),false);
  assert.equal(run('restore',backup).status,0);assert.equal(fs.statSync(target).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),wallet);
  const restoredClaims=createClaimSecretStore(path.join(directory,'fresh','claim-secrets-v2'),wallet.secretKey,wallet.salt);
  assert.equal((await restoredClaims.load(scope,secretHash)).secret,secret.toString());
  assert.equal(run('export',output).status,0);assert.equal(run('export',output).status,1);
  const portable=await BillboardWalletBackup.decrypt(JSON.parse(fs.readFileSync(output,'utf8')),password);
  assert.equal(portable.claims.length,1);assert.equal(portable.journals.length,1);
  assert.deepEqual(portable.journals,await (await f.backup(f.browser)).exportRecords());
  assert.equal(run('restore',backup).status,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}));
