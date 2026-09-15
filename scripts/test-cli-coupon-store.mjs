// Actual SQLite/AES-GCM persistence and competing connections/processes. No issuer or network.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createSqliteSponsorCouponStore } from '../sponsor-service/coupon-store.mjs';
const roots=[];after(()=>{for(const d of roots)fs.rmSync(d,{recursive:true,force:true});});
const partition='ab'.repeat(32),id='cd'.repeat(32),nowSeconds='120';
const record=(changes={})=>({schemaVersion:1,id,partition,expiresAt:'179',owner:'private-owner',blind:'private-blind',reservation:{token:'private-retrieval-token'},...changes});
const fails=e=>e.code==='SPONSOR_COUPON_STORE_UNAVAILABLE'&&e.message===e.code;
async function fixture(options={}){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cli-coupon-'));roots.push(dir);const encryptionKey=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const config={dbPath:path.join(dir,'coupons.sqlite'),encryptionKey,...options};return {dir,config,open:()=>createSqliteSponsorCouponStore(config)};}

test('encrypted real SQLite persistence survives reopen and stores no owner/blind/token plaintext',async()=>{
  const f=await fixture();let s=await f.open();assert.equal(await s.put(record(),{nowSeconds}),true);s.close();
  const bytes=fs.readFileSync(f.config.dbPath);for(const secret of ['private-owner','private-blind','private-retrieval-token'])assert(!bytes.includes(Buffer.from(secret)));
  assert.equal(fs.statSync(f.dir).mode&0o777,0o700);assert.equal(fs.statSync(f.config.dbPath).mode&0o777,0o600);
  s=await f.open();assert.deepEqual(await s.pending({partition,nowSeconds}),[record()]);assert.equal(await s.markAttempted(id),true);s.close();
  s=await f.open();assert.deepEqual(await s.pending({partition,nowSeconds}),[]);assert.equal(await s.markAttempted(id),false);s.close();
});

test('wrong key fails closed on both empty and populated restart',async()=>{
  for(const populated of [false,true]){const f=await fixture();const s=await f.open();if(populated)await s.put(record(),{nowSeconds});s.close();
    const encryptionKey=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await assert.rejects(createSqliteSponsorCouponStore({...f.config,encryptionKey}),fails);
  }
});

test('rejects fake/wrong algorithm key and policy drift',async()=>{
  const f=await fixture();await assert.rejects(createSqliteSponsorCouponStore({...f.config,encryptionKey:{algorithm:{name:'AES-GCM'},usages:['encrypt','decrypt']}}),fails);
  const key=await webcrypto.subtle.generateKey({name:'AES-CBC',length:256},false,['encrypt','decrypt']);await assert.rejects(createSqliteSponsorCouponStore({...f.config,encryptionKey:key}),fails);
  const s=await f.open();s.close();await assert.rejects(createSqliteSponsorCouponStore({...f.config,maxRecords:2}),fails);
});

for(const [name,sql] of [['id',"UPDATE records SET id='"+'ef'.repeat(32)+"'"],['partition',"UPDATE records SET partition='"+'ef'.repeat(32)+"'"],['expiry',"UPDATE records SET expires_at='0'"],['attempted','UPDATE records SET attempted=1'],['ciphertext',"UPDATE records SET ciphertext=zeroblob(length(ciphertext))"],['iv','UPDATE records SET iv=zeroblob(12)']])test('AAD/ciphertext rejects tampered '+name+' rather than pruning/hiding it',async()=>{
  const f=await fixture();const s=await f.open();await s.put(record(),{nowSeconds});const db=new DatabaseSync(f.config.dbPath);db.exec(sql);db.close();
  await assert.rejects(s.pending({partition,nowSeconds}),fails);s.close();await assert.rejects(f.open(),fails);
});

test('atomic duplicate admission across real separate SQLite connections',async()=>{
  const f=await fixture(),a=await f.open(),b=await f.open();const result=await Promise.allSettled([a.put(record(),{nowSeconds}),b.put(record(),{nowSeconds})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal((await a.pending({partition,nowSeconds})).length,1);a.close();b.close();
});

test('transactional compare/update permits exactly one concurrent attempted mark',async()=>{
  const f=await fixture(),a=await f.open(),b=await f.open();await a.put(record(),{nowSeconds});assert.deepEqual((await Promise.all([a.markAttempted(id),b.markAttempted(id)])).sort(),[false,true]);assert.deepEqual(await b.pending({partition,nowSeconds}),[]);a.close();b.close();
});

test('real competing processes cannot both mark the same coupon attempted',async()=>{
  const fixtureKey=new Uint8Array(32).fill(7),encryptionKey=await webcrypto.subtle.importKey('raw',fixtureKey,{name:'AES-GCM'},false,['encrypt','decrypt']);
  const f=await fixture({encryptionKey}),s=await f.open();await s.put(record(),{nowSeconds});s.close();
  const source=`import {webcrypto} from 'node:crypto';import {createSqliteSponsorCouponStore} from './sponsor-service/coupon-store.mjs';let input='';for await(const chunk of process.stdin)input+=chunk;const {dbPath,id}=JSON.parse(input);const encryptionKey=await webcrypto.subtle.importKey('raw',new Uint8Array(32).fill(7),{name:'AES-GCM'},false,['encrypt','decrypt']);const s=await createSqliteSponsorCouponStore({dbPath,encryptionKey});process.send('ready');await new Promise(resolve=>process.once('message',resolve));const r=await s.markAttempted(id);s.close();process.stdout.write(r?'1':'0');process.disconnect();`;
  const children=[];let ready=0;
  const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe','ipc'],timeout:10000,killSignal:'SIGKILL'});children.push(p);let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();p.on('error',reject);p.on('message',message=>{assert.equal(message,'ready');if(++ready===2)for(const child of children)child.send('go');});p.on('close',(code,signal)=>code===0&&!signal?resolve(Number(out)):reject(Error('Fixture child failed')));p.stdin.end(JSON.stringify({dbPath:f.config.dbPath,id}));});
  assert.equal((await Promise.all([run(),run()])).reduce((a,b)=>a+b),1);
});

test('full capacity prevents fresh reservations, expiry pruning is inclusive and durable',async()=>{
  const f=await fixture({maxRecords:1}),s=await f.open();await s.put(record(),{nowSeconds});await assert.rejects(s.put(record({id:'ef'.repeat(32)}),{nowSeconds}),fails);
  assert.equal((await s.pending({partition,nowSeconds:'179'})).length,1);await s.markAttempted(id);await assert.rejects(s.pending({partition,nowSeconds:'179'}),fails);
  assert.deepEqual(await s.pending({partition,nowSeconds:'180'}),[]);assert.equal(await s.put(record({id:'ef'.repeat(32),expiresAt:'240'}),{nowSeconds:'180'}),true);s.close();
  const again=await f.open();assert.equal((await again.pending({partition,nowSeconds:'180'}))[0].id,'ef'.repeat(32));again.close();
});

test('bad field/size/expiry, missing attempted ID and closed operations fail safely',async()=>{
  const f=await fixture(),s=await f.open();for(const change of [{id:'bad'},{partition:'bad'},{expiresAt:'01'},{expiresAt:'18446744073709551616'},{padding:'x'.repeat(8192)},{expiresAt:'119'}])await assert.rejects(s.put(record(change),{nowSeconds}),fails);
  assert.equal(await s.markAttempted(id),false);await assert.rejects(s.pending({partition,nowSeconds:'-1'}),fails);await assert.rejects(s.pending({partition,nowSeconds:Number.MAX_SAFE_INTEGER+1}),fails);s.close();await assert.rejects(s.pending({partition,nowSeconds}),fails);
});

test('rejects nonprivate directory/file and symlink/hardlink database paths',async()=>{
  const f=await fixture();fs.chmodSync(f.dir,0o755);await assert.rejects(f.open(),fails);fs.chmodSync(f.dir,0o700);let s=await f.open();s.close();
  fs.chmodSync(f.config.dbPath,0o644);await assert.rejects(f.open(),fails);fs.chmodSync(f.config.dbPath,0o600);
  const hard=path.join(f.dir,'hard.sqlite');fs.linkSync(f.config.dbPath,hard);await assert.rejects(f.open(),fails);fs.unlinkSync(hard);
  const link=path.join(f.dir,'link.sqlite');fs.symlinkSync(f.config.dbPath,link);await assert.rejects(createSqliteSponsorCouponStore({...f.config,dbPath:link}),fails);
});

test('rejects oversized stored ciphertext before returning any records',async()=>{
  const f=await fixture(),s=await f.open();await s.put(record(),{nowSeconds});const db=new DatabaseSync(f.config.dbPath);db.exec('UPDATE records SET ciphertext=zeroblob(8209)');db.close();await assert.rejects(s.pending({partition,nowSeconds}),fails);s.close();await assert.rejects(f.open(),fails);
});
