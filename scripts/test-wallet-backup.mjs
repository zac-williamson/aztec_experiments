// Historical CI entrypoint, now testing the supported Ethereum-derived custody.
// Password identity files/passkeys were explicitly retired (0726aad9, 209ed2ee,
// cc12e2c1). Journal ciphertext transport has its own W03 suite. Do not recreate
// account-file migration or export APIs to satisfy obsolete test fixtures.
import '../shared/ethereum-account-session.test.mjs';
import '../shared/ethereum-account-integration.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const source=fs.readFileSync(new URL('../shared/claim-secret-store.js',import.meta.url),'utf8');
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const wallet={secretKey:field(123),salt:field((1n<<180n)+123n)};
const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'6',boardAddress:field(2),portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
// Custody validates canonical fields, not the chain commitment. Commitment and
// deposit authentication remain the responsibility of the actual funding path.
const claim={schemaVersion:1,secretHash:field(9),secret:field(10)};
const plain=value=>JSON.parse(JSON.stringify(value));
const ownerId=account=>createHash('sha256').update('AZTEC_BB_CLAIM_BACKUP_OWNER_V2\0'+account.secretKey+account.salt).digest('hex');
const key=(account=wallet,s=scope,hash=claim.secretHash)=>ownerId(account)+':'+JSON.stringify(['AZTEC_BB_CLAIM_STORE_V2',s.l1ChainId,s.rollupAddress,s.rollupVersion,s.boardAddress,s.portalAddress,s.depositor,hash]);
function runtime(indexedDB=new IDBFactory(),crypto=webcrypto){
 const context=vm.createContext({crypto,indexedDB,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(source,context);
 return {indexedDB,store:account=>context.makeClaimSecretStore(account.secretKey,account.salt)};
}
async function raw(indexedDB,operation){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('aztec-billboard-claim-secrets-v2',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');const request=operation(tx.objectStore('records'));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
test('current claim custody reloads full-salt encrypted records with no bulk identity export',async()=>{
 const f=runtime(),store=f.store(wallet);await store.save(scope,claim);
 assert.deepEqual(plain(await runtime(f.indexedDB).store(wallet).load(scope,claim.secretHash)),claim);
 const encoded=await raw(f.indexedDB,s=>s.get(key()));const serialized=JSON.stringify(encoded);
 for(const value of [wallet.secretKey,wallet.salt,claim.secret])assert(!serialized.includes(value));
 assert.deepEqual(Object.keys(store).sort(),['load','save']);
 await store.save(scope,claim);assert.deepEqual(await raw(f.indexedDB,s=>s.get(key())),encoded,'Exact duplicate must not rewrite ciphertext');
 await assert.rejects(store.save(scope,{...claim,secret:field(11)}),/different claim secret/);
 assert.deepEqual(plain(await store.load(scope,claim.secretHash)),claim);
});
for(const changed of [{...wallet,salt:field(124)},{...wallet,secretKey:field(456)}])test('same claim scope remains isolated by account key and full salt '+changed.secretKey+changed.salt,async()=>{
 const f=runtime(),first=f.store(wallet),other=f.store(changed);await first.save(scope,claim);assert.equal(await other.load(scope,claim.secretHash),null);
 await other.save(scope,{...claim,secret:field(12)});assert.deepEqual(plain(await first.load(scope,claim.secretHash)),claim);assert.equal((await other.load(scope,claim.secretHash)).secret,field(12));
 const encrypted=await raw(f.indexedDB,s=>s.get(key()));await raw(f.indexedDB,s=>s.put(encrypted,key(changed)));
 await assert.rejects(other.load(scope,claim.secretHash),/another wallet/);
});
for(const name of Object.keys(scope))test('moving a claim record cannot change authenticated '+name,async()=>{
 const f=runtime(),store=f.store(wallet),changed={...scope,[name]:name==='l1ChainId'||name==='rollupVersion'?'7':name==='boardAddress'?field(3):'0x'+'44'.repeat(20)};
 await store.save(scope,claim);assert.equal(await store.load(changed,claim.secretHash),null);
 const encrypted=await raw(f.indexedDB,s=>s.get(key()));await raw(f.indexedDB,s=>s.put(encrypted,key(wallet,changed)));
 await assert.rejects(store.load(changed,claim.secretHash),/authenticate/);assert.deepEqual(plain(await store.load(scope,claim.secretHash)),claim);
});
test('ciphertext corruption and malformed claim fields fail without replacing saved custody',async()=>{
 const f=runtime(),store=f.store(wallet);await store.save(scope,claim);
 for(const invalid of [{...claim,secret:field(0)},{...claim,secret:field(1n<<255n)},{...claim,secret:'0x1'},{...claim,extra:true}])await assert.rejects(store.save(scope,invalid),/Invalid saved/);
 const encoded=await raw(f.indexedDB,s=>s.get(key()));encoded.ciphertext=(encoded.ciphertext[0]==='0'?'1':'0')+encoded.ciphertext.slice(1);await raw(f.indexedDB,s=>s.put(encoded,key()));
 await assert.rejects(store.load(scope,claim.secretHash),/authenticate/);
 await assert.rejects(store.save(scope,claim),/authenticate/);
 assert.deepEqual(await raw(f.indexedDB,s=>s.get(key())),encoded);
});
test('concurrent insertion is detected and cannot overwrite the first durable claim',async()=>{
 const indexedDB=new IDBFactory();let onEncrypt;
 const subtle=new Proxy(webcrypto.subtle,{get(target,name){if(name==='encrypt')return async(...args)=>{const result=await target.encrypt(...args);const run=onEncrypt;onEncrypt=null;await run?.();return result;};const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 const first=runtime(indexedDB,{subtle,getRandomValues:webcrypto.getRandomValues.bind(webcrypto)}).store(wallet),other=runtime(indexedDB).store(wallet);
 const winner={...claim,secret:field(12)};onEncrypt=()=>other.save(scope,winner);
 await assert.rejects(first.save(scope,claim),/did not commit/);assert.deepEqual(plain(await other.load(scope,claim.secretHash)),winner);
});
