// Actual encrypted IndexedDB/CAS and pinned hashes; transport/chain readers are explicit doubles.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {DomainSeparator} from '@aztec/constants';
import {BarretenbergSync} from '@aztec/bb.js';
import {createIndexedDBSponsorCouponStore} from '../shared/sponsor-coupon-store.mjs';
import {createSponsorCouponProvider} from '../shared/sponsor-coupon-provider.mjs';
after(()=>BarretenbergSync.destroySingleton());
const scope={l1ChainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),boardAddress:new Fr(11).toString(),portalAddress:'0x'+'2'.repeat(40)};
const owner=new Fr(12).toString(),sponsor=new Fr(13).toString();
const unavailable=()=>Object.assign(new Error('private diagnostic must not escape'),{code:'SPONSOR_ISSUER_UNAVAILABLE'});
let empty;
async function emptyPath(){if(!empty){empty=[Fr.ZERO];for(let i=1;i<10;i++)empty.push(await poseidon2HashWithSeparator([empty[i-1],empty[i-1]],DomainSeparator.MERKLE_HASH));}return empty;}
async function fixture({maxRecords=64}={}) {
  const indexedDB=new IDBFactory(),key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const stores=[];const open=async()=>{const store=await createIndexedDBSponsorCouponStore({indexedDB,crypto:webcrypto,encryptionKey:key,maxRecords});stores.push(store);return store;};
  let current=120n,next=1,failSubmit=false,failRetrieve=false,registered=true,submitCount=0,reserveCount=0,mutate=x=>x;
  const batches=new Map(),transportCalls=[];
  const transport={
    reserve:async input=>{transportCalls.push(['reserve',input]);reserveCount++;const id=String(next++),token=Number(id).toString(16).padStart(64,'0');const b={chainId:'31337',version:'1',sponsorAddress:sponsor,window:input.window,batchId:id,ticketCount:1,expiresAt:String(BigInt(input.window)*60n+59n),status:'open',root:null,registration:'pending',usable:false,index:0,token};batches.set(token,b);return mutate({...b});},
    submit:async input=>{transportCalls.push(['submit',input]);submitCount++;const b=batches.get(input.token);assert(b);b.leaf=input.leaf;b.siblings=(await emptyPath()).map(x=>x.toString());let root=Fr.fromString(input.leaf);for(const sibling of b.siblings)root=await poseidon2HashWithSeparator([root,Fr.fromString(sibling)],DomainSeparator.MERKLE_HASH);b.root=root.toString();b.status='sealed';if(failSubmit){failSubmit=false;throw unavailable();}return {accepted:true,batchId:b.batchId,index:0};},
    retrieve:async input=>{transportCalls.push(['retrieve',input]);if(failRetrieve)throw unavailable();const b=batches.get(input.token);if(!b?.leaf)throw unavailable();const {token,...reply}=b;return mutate({...reply});},
  };
  const reader=async({batchId})=>{if(!registered)throw unavailable();const b=Array.from(batches.values()).find(x=>x.batchId===batchId);return {root:b.root,window:b.window,ticket_count:String(b.ticketCount),timestamp:String(current)};};
  const make=async(store=undefined,options={})=>createSponsorCouponProvider({transport,sponsorAddress:sponsor,windowDuration:'60',store:store??await open(),nowSeconds:()=>current,maxPolls:2,pollIntervalMs:0,deadlineMs:1000,...options});
  const acquire=p=>p.acquire({scope,owner,actionKind:'post',readRegisteredBatch:reader});
  const rows=async transform=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('aztec-bb-sponsor-coupons-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=reject;});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');const req=store.getAll();let result;req.onsuccess=()=>{result=req.result;transform?.(result,store);};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
  return {open,make,acquire,reader,transport,transportCalls,rows,stores,batches,key,indexedDB,setTime:t=>current=t,setSubmitFailure:()=>failSubmit=true,setRetrieveFailure:v=>failRetrieve=v,setRegistered:v=>registered=v,setMutate:fn=>mutate=fn,counts:()=>({submitCount,reserveCount}),close:()=>stores.forEach(s=>s.close())};
}
test('durable encrypted acquisition verifies actual chain state despite issuer usable:false, then never reuses after reopen',async()=>{
  const f=await fixture();try{
    const p=await f.make(),one=await f.acquire(p);const stored=await f.rows();assert.equal(stored.length,1);assert.equal(stored[0].attempted,true);
    assert(!JSON.stringify(stored).includes(one.blind));assert(!JSON.stringify(stored).includes(owner));
    f.close();const two=await f.acquire(await f.make());assert.notEqual(two.batchId,one.batchId);assert.notEqual(two.blind,one.blind);
    for(const [method,input] of f.transportCalls)assert.deepEqual(Object.keys(input).sort(),method==='reserve'?['window']:method==='submit'?['leaf','token']:['token']);
  }finally{f.close();}
});
test('lost submit response resumes persisted blind/reservation without another allocation or submit',async()=>{
  const f=await fixture();try{f.setSubmitFailure();await assert.rejects(f.acquire(await f.make()),e=>e.code==='SPONSOR_COUPON_UNAVAILABLE'&&!e.message.includes('private'));
    const before=await f.rows();assert.equal(before[0].attempted,false);f.close();const coupon=await f.acquire(await f.make());assert.equal(coupon.batchId,'1');assert.deepEqual(f.counts(),{submitCount:1,reserveCount:1});
  }finally{f.close();}
});
test('retrieve outage and pending onchain registration retain same reservation for restart',async()=>{
  for(const outage of ['retrieve','registration']){const f=await fixture();try{
    if(outage==='retrieve')f.setRetrieveFailure(true);else f.setRegistered(false);
    await assert.rejects(f.acquire(await f.make()));assert.equal((await f.rows())[0].attempted,false);
    f.close();f.setRetrieveFailure(false);f.setRegistered(true);const coupon=await f.acquire(await f.make());assert.equal(coupon.batchId,'1');assert.equal(f.counts().reserveCount,1);
  }finally{f.close();}}
});
test('concurrent acquisition of one persisted coupon hands it out at most once through encrypted CAS',async()=>{
  const f=await fixture();try{f.setSubmitFailure();await assert.rejects(f.acquire(await f.make()));f.close();
    const a=await f.make(),b=await f.make();const results=await Promise.allSettled([f.acquire(a),f.acquire(b)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
    assert.equal(f.counts().reserveCount,1);assert.equal((await f.rows())[0].attempted,true);
  }finally{f.close();}
});
test('storage commit failure precedes any opaque leaf submission',async()=>{
  const f=await fixture();try{const store=await f.open();const broken={...store,put:async()=>{throw new Error('private storage contents');}};
    await assert.rejects(f.acquire(await f.make(broken)),e=>e.code==='SPONSOR_COUPON_UNAVAILABLE'&&!e.message.includes('private'));assert.equal(f.counts().submitCount,0);
  }finally{f.close();}
});
test('malicious reservation scope or position rejects before local save/submission',async()=>{
  for(const change of [{chainId:'1'},{version:'2'},{sponsorAddress:new Fr(20).toString()},{window:'3'},{index:1024},{expiresAt:'999'}]) {
    const f=await fixture();try{f.setMutate(r=>({...r,...change}));await assert.rejects(f.acquire(await f.make()));assert.equal(f.counts().submitCount,0);assert.equal((await f.rows()).length,0);}finally{f.close();}
  }
});
test('wrong issuer root, sibling or chain registration rejects without marking attempted',async()=>{
  for(const mode of ['root','sibling','chain','count','timestamp']){const f=await fixture();try{
    const p=await f.make();if(mode==='root')f.setMutate(r=>r.status==='sealed'?{...r,root:new Fr(3).toString()}:r);
    if(mode==='sibling')f.setMutate(r=>r.status==='sealed'?{...r,siblings:r.siblings.map((x,i)=>i===5?new Fr(3).toString():x)}:r);
    await assert.rejects(p.acquire({scope,owner,actionKind:'claim',readRegisteredBatch:async input=>{const chain=await f.reader(input);return mode==='chain'?{...chain,root:new Fr(8).toString()}:mode==='count'?{...chain,ticket_count:'2'}:mode==='timestamp'?{...chain,timestamp:'180'}:chain;}}));
    assert.equal((await f.rows())[0].attempted,false);
  }finally{f.close();}}
});
test('attempted/expiry metadata tampering fails authentication on restart',async()=>{
  for(const mode of ['attempted','expiry','partition']) {const f=await fixture();try{
    await f.acquire(await f.make());await f.rows((rows,store)=>{const row=rows[0];row.attempted=false;if(mode==='expiry')row.expiresAt='999';if(mode==='partition')row.partition='0'.repeat(64);store.put(row);});f.close();
    const store=await f.open();const row=(await f.rows())[0];await assert.rejects(store.pending({partition:row.partition,nowSeconds:'120'}),e=>e.code==='SPONSOR_COUPON_STORE_UNAVAILABLE');
  }finally{f.close();}}
});
test('wrong encryption key and ciphertext damage reject without coupon reuse',async()=>{
  const f=await fixture();try{f.setSubmitFailure();await assert.rejects(f.acquire(await f.make()));const row=(await f.rows())[0];
    const wrong=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const store=await createIndexedDBSponsorCouponStore({indexedDB:f.indexedDB,crypto:webcrypto,encryptionKey:wrong});
    await assert.rejects(store.pending({partition:row.partition,nowSeconds:'120'}));store.close();
    await f.rows((rows,s)=>{rows[0].ciphertext[20]^=1;s.put(rows[0]);});await assert.rejects(f.acquire(await f.make()));assert.equal(f.counts().reserveCount,1);
  }finally{f.close();}
});
test('bounded storage cap stops admission and expired rows are purged',async()=>{
  const f=await fixture({maxRecords:1});try{await f.acquire(await f.make());await assert.rejects(f.acquire(await f.make()));assert.equal(f.counts().submitCount,1);assert.equal(f.counts().reserveCount,1);
    f.setTime(180n);await f.acquire(await f.make());assert.equal((await f.rows()).length,1);assert.equal((await f.rows())[0].expiresAt,'239');
  }finally{f.close();}
});
test('deadline bounds a stalled readonly registration call and leaves coupon pending',async()=>{
  const f=await fixture();try{const p=await f.make(undefined,{deadlineMs:50});const start=Date.now();await assert.rejects(p.acquire({scope,owner,actionKind:'withdraw',readRegisteredBatch:()=>new Promise(()=>{})}),e=>e.code==='SPONSOR_COUPON_TIMEOUT');assert(Date.now()-start<1000);assert.equal((await f.rows())[0].attempted,false);}finally{f.close();}
});
test('failure of attempted-state commit never hands out a verified coupon',async()=>{
  const f=await fixture();try{const store=await f.open();const p=await f.make({...store,markAttempted:async()=>{throw new Error('private owner/blind');}});
    await assert.rejects(f.acquire(p),e=>e.code==='SPONSOR_COUPON_UNAVAILABLE'&&!e.message.includes('private'));assert.equal((await f.rows())[0].attempted,false);
  }finally{f.close();}
});
test('transaction abort is not treated as durable reservation storage',async()=>{
  const f=await fixture();try{const store=await f.open();const db=await new Promise(resolve=>{const r=f.indexedDB.open('aztec-bb-sponsor-coupons-v1',1);r.onsuccess=()=>resolve(r.result);});
    const proto=Object.getPrototypeOf(db),original=proto.transaction;let abort=true;
    proto.transaction=function(...args){const tx=original.apply(this,args);if(args[1]==='readwrite'&&abort){const objectStore=tx.objectStore('records'),oldAdd=objectStore.add.bind(objectStore);objectStore.add=function(...items){const result=oldAdd(...items);abort=false;tx.abort();return result;};}return tx;};
    try{await assert.rejects(f.acquire(await f.make(store)));assert.equal(f.counts().submitCount,0);assert.equal((await f.rows()).length,0);}finally{proto.transaction=original;db.close();}
  }finally{f.close();}
});
