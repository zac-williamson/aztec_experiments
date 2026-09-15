// Real HKDF/AES-GCM/SQLite and ephemeral local issuer HTTP; no proofs or public deployment.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { BarretenbergSync } from '@aztec/bb.js';
import { createLocalSponsorCouponProvider } from '../shared/local-sponsor-provider.mjs';
import { createSqliteSponsorCouponStore } from '../sponsor-service/coupon-store.mjs';
import { createIssuerHttpServer } from '../sponsor-service/http.mjs';
import { openIssuer } from '../sponsor-service/issuer.mjs';
const roots=[];after(async()=>{await BarretenbergSync.destroySingleton();for(const d of roots)fs.rmSync(d,{recursive:true,force:true});});
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const secret=hex(20),sponsor=hex(11),partition='ab'.repeat(32),id='cd'.repeat(32);
const base=()=>({walletSecret:secret,sponsorAddress:sponsor,windowDuration:'60',issuerUrl:'https://issuer.example',maxPolls:1,pollIntervalMs:0,nowSeconds:()=>120n});
const fails=e=>e.code==='SPONSOR_LOCAL_PROVIDER_UNAVAILABLE'&&e.message===e.code;
function directory(){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'local-sponsor-'));roots.push(dir);return dir;}

test('stable derivation opens actual encrypted records after wallet/sponsor restart',async()=>{
  const dbPath=path.join(directory(),'coupon.sqlite');let store,key;
  const createStore=async input=>{assert.deepEqual(Object.keys(input),['encryptionKey']);key=input.encryptionKey;store=await createSqliteSponsorCouponStore({dbPath,...input});return store;};
  let provider=await createLocalSponsorCouponProvider({...base(),createStore});
  assert.equal(key.algorithm.name,'AES-GCM');assert.equal(key.algorithm.length,256);assert.equal(key.extractable,false);assert.deepEqual([...key.usages].sort(),['decrypt','encrypt']);await assert.rejects(crypto.subtle.exportKey('raw',key));
  const record={schemaVersion:1,id,partition,expiresAt:'179',blind:'local-private-blind'};await store.put(record,{nowSeconds:'120'});await provider.close();
  provider=await createLocalSponsorCouponProvider({...base(),createStore});assert.deepEqual(await store.pending({partition,nowSeconds:'120'}),[record]);await provider.close();
});

for(const [label,changes] of [['wallet',{walletSecret:hex(21)}],['sponsor',{sponsorAddress:hex(12)}]])test('different '+label+' cannot decrypt prior local store',async()=>{
  const dbPath=path.join(directory(),'coupon.sqlite');let store;const createStore=async input=>{store=await createSqliteSponsorCouponStore({dbPath,...input});return store;};
  const provider=await createLocalSponsorCouponProvider({...base(),createStore});await store.put({schemaVersion:1,id,partition,expiresAt:'179',blind:'actual-encrypted-payload'},{nowSeconds:'120'});await provider.close();
  await assert.rejects(createLocalSponsorCouponProvider({...base(),...changes,createStore}),fails);
});

test('invalid secrets/configuration fail before any store creation or network work',async()=>{
  let calls=0;const createStore=()=>{calls++;throw Error('Must not create');};
  for(const change of [{walletSecret:hex(0)},{walletSecret:'0x'+'f'.repeat(64)},{walletSecret:20n},{walletSecret:'0x01'},{walletSecret:secret.toUpperCase()},{sponsorAddress:hex(0)},{windowDuration:'0'},{windowDuration:'86401'},{windowDuration:'01'},{issuerUrl:'https://secret@issuer.example'},{issuerUrl:'http://issuer.example'},{maxPolls:31},{pollIntervalMs:5001},{deadlineMs:60001},{transportTimeoutMs:49},{allowLoopbackHttp:'yes'},{owner:hex(99)}])await assert.rejects(createLocalSponsorCouponProvider({...base(),...change,createStore}),fails);
  assert.equal(calls,0);
});

test('initialization errors are fixed and partially created adapters are closed',async()=>{
  let closed=0;
  await assert.rejects(createLocalSponsorCouponProvider({...base(),createStore:async()=>({get close(){throw Error('private-close-getter');}})}),fails);
  await assert.rejects(createLocalSponsorCouponProvider({...base(),createStore:async()=>({close:()=>{closed++;}})}),fails);assert.equal(closed,1);
  await assert.rejects(createLocalSponsorCouponProvider({...base(),createStore:async()=>{throw Error('private-wallet-secret '+secret);}}),e=>fails(e)&&!e.message.includes(secret));
});

test('close is idempotent, blocks future acquire and sanitizes adapter close failures',async()=>{
  let closed=0;const provider=await createLocalSponsorCouponProvider({...base(),createStore:()=>({pending:async()=>[],put:async()=>true,markAttempted:async()=>true,close:()=>{closed++;throw Error('private-close');}})});
  await assert.rejects(provider.close(),fails);await provider.close();await assert.rejects(provider.acquire({}),fails);assert.equal(closed,1);
});

test('actual local HTTP sees only window/token/opaque leaf, never wallet secret/owner/blind',async t=>{
  const dir=directory(),issuer=await openIssuer({dbPath:path.join(dir,'issuer.sqlite'),chainId:'1',version:'2',sponsorAddress:sponsor,windowDuration:'60',windowBudget:'100',maxFeePerTicket:'10'},{nowSeconds:()=>120n});
  const seen=[];const boundary=createIssuerHttpServer({issuer:Object.fromEntries(['reserve','submit','retrieve'].map(name=>[name,input=>{seen.push({name,input});return issuer[name](input);}]))});
  let provider,store,storedRecord;
  t.after(async()=>{await provider?.close();const closed=new Promise(resolve=>boundary.server.close(resolve));boundary.server.closeAllConnections();await closed;issuer.close();});
  boundary.server.listen(0,'127.0.0.1');await once(boundary.server,'listening');
  provider=await createLocalSponsorCouponProvider({...base(),issuerUrl:'http://127.0.0.1:'+boundary.server.address().port,allowLoopbackHttp:true,createStore:async input=>{store=await createSqliteSponsorCouponStore({dbPath:path.join(dir,'coupons.sqlite'),...input});return {...store,put:async(record,options)=>{storedRecord=structuredClone(record);return store.put(record,options);}};}});
  const owner=hex(22),scope={l1ChainId:'1',rollupVersion:'2',rollupAddress:'0x'+'01'.repeat(20),boardAddress:hex(33),portalAddress:'0x'+'02'.repeat(20)};
  await assert.rejects(provider.acquire({scope,owner,actionKind:'claim',readRegisteredBatch:async()=>{throw Error('No canonical registration in fixture');}}),e=>e.code==='SPONSOR_COUPON_NOT_REGISTERED'&&!e.message.includes(secret));
  assert.deepEqual(seen.map(x=>x.name),['reserve','submit','retrieve']);
  assert.deepEqual(Object.keys(seen[0].input),['window']);assert.deepEqual(Object.keys(seen[1].input).sort(),['leaf','token']);assert.deepEqual(Object.keys(seen[2].input),['token']);
  const wire=JSON.stringify(seen);for(const forbidden of ['walletSecret','owner','blind','encryptionKey',secret,owner,storedRecord.blind])assert(!wire.includes(forbidden));
  assert.equal(issuer.counters().allocated,1);assert.equal(issuer.counters().submitted,1);
});
