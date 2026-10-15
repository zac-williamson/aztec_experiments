import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {preferenceBrowserBudget,writePreferenceKeyBackup,finishPreferenceBrowserEvidence} from './rolling-preference-browser-fixture.mjs';
test('browser admission reserves 120s browser plus30s accounting/cleanup without extending parent',()=>{
 assert.equal(preferenceBrowserBudget(151000,1000),120000);for(const d of [150999,1000,NaN,Infinity])assert.throws(()=>preferenceBrowserBudget(d,1000));
});
test('actual encrypted backup contains only account keys and empty claims, never preference/journal cache',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-preference-key-'));
 try{
  const file=path.join(directory,'keys.json'),secret='0x'+(123n).toString(16).padStart(64,'0'),account={secret,salt:'0',privatePreferences:'PRIVATE_SENTINEL',journal:'PRIVATE_SENTINEL'};
  await writePreferenceKeyBackup({account,password:'password-for-disposable-test',file});
  assert.equal((await fs.stat(file)).mode&0o777,0o600);const text=await fs.readFile(file,'utf8');assert(!text.includes('PRIVATE_SENTINEL'));assert(!text.includes(secret));
  const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(new URL('../../shared/wallet-backup.js',import.meta.url),'utf8'),context);
  const restored=await context.BillboardWalletBackup.decrypt(JSON.parse(text),'password-for-disposable-test');
  // The production backup parser normalizes field values to canonical 32-byte hex.
  assert.deepEqual(JSON.parse(JSON.stringify(restored)),{schemaVersion:1,wallet:{secretKey:secret,salt:'0x'+'0'.repeat(64)},claims:[]});
  await assert.rejects(writePreferenceKeyBackup({account,password:'password-for-disposable-test',file}),{code:'EEXIST'});
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
function accounting(){const events=[],observation={passed:true},r={newProofJobs:0,newNodeSubmissions:0,l1:{forwarded:2,rejected:0,errors:0,pending:0}};return {events,observation,r,options:{observation,verifyFees:async()=>{events.push('fees');},receiver:()=>r,persist:async()=>{events.push('persist');},ack:async()=>{events.push('ack');}}};}
test('receiver and fee evidence precede browser acknowledgement',async()=>{const f=accounting();await finishPreferenceBrowserEvidence(f.options);assert.deepEqual(f.events,['fees','persist','ack']);assert(f.observation.accountingVerified);});
for(const fault of ['fees','proof','send','l1-error','l1-pending','l1-empty'])test('retains failure and acknowledges only after persistence: '+fault,async()=>{
 const f=accounting();if(fault==='fees')f.options.verifyFees=async()=>{throw Error('labelled failure');};if(fault==='proof')f.r.newProofJobs=1;if(fault==='send')f.r.newNodeSubmissions=1;if(fault==='l1-error')f.r.l1.errors=1;if(fault==='l1-pending')f.r.l1.pending=1;if(fault==='l1-empty')f.r.l1.forwarded=0;
 await assert.rejects(finishPreferenceBrowserEvidence(f.options));assert.equal(f.observation.passed,false);assert.deepEqual(f.events.slice(-2),['persist','ack']);
});
test('failed evidence persistence never acknowledges worker',async()=>{const f=accounting();f.options.persist=async()=>{throw Error('disk unavailable');};await assert.rejects(finishPreferenceBrowserEvidence(f.options));assert(!f.events.includes('ack'));});
