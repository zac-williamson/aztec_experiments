// Actual SQLite issuer + loopback HTTP + SDK hashes + encrypted fake IndexedDB.
// Chain registration alone is an explicit double. Real browser persistence is checked separately.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {IDBFactory} from 'fake-indexeddb';
import {BarretenbergSync} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {openIssuer} from '../sponsor-service/issuer.mjs';
import {createIssuerHttpServer} from '../sponsor-service/http.mjs';
import {createSponsorTransport} from '../shared/sponsor-transport.mjs';
import {createSponsorCouponProvider} from '../shared/sponsor-coupon-provider.mjs';
import {createIndexedDBSponsorCouponStore} from '../shared/sponsor-coupon-store.mjs';
after(()=>BarretenbergSync.destroySingleton());
const scope={l1ChainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:new Fr(33).toString(),portalAddress:'0x'+'22'.repeat(20)};
test('two local authors receive distinct verified coupons from one real HTTP issuer batch',{timeout:10000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coupon-delivery-'));
  let issuer,boundary;const stores=[];let sealed;const observed=[];
  try {
    const sponsorAddress=new Fr(44).toString();
    issuer=await openIssuer({dbPath:path.join(dir,'issuer.sqlite'),chainId:'31337',version:'1',sponsorAddress,windowDuration:'60',windowBudget:'100',maxFeePerTicket:'10'},{nowSeconds:()=>120n});
    const service={reserve:input=>{observed.push(['reserve',Object.keys(input)]);return issuer.reserve(input);},submit:async input=>{
      observed.push(['submit',Object.keys(input)]);const receipt=issuer.submit(input);
      // Test operator seals a common batch after both opaque leaves arrive.
      if(issuer.counters().submitted===2)sealed=await issuer.seal({batchId:receipt.batchId});
      return receipt;
    },retrieve:input=>{observed.push(['retrieve',Object.keys(input)]);return issuer.retrieve(input);}};
    boundary=createIssuerHttpServer({issuer:service});boundary.server.listen(0,'127.0.0.1');await once(boundary.server,'listening');
    const transport=createSponsorTransport({url:'http://127.0.0.1:'+boundary.server.address().port,allowLoopbackHttp:true});
    const providers=await Promise.all([1,2].map(async n=>{
      const encryptionKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      const store=await createIndexedDBSponsorCouponStore({indexedDB:new IDBFactory(),encryptionKey,databaseName:'author-'+n});stores.push(store);
      return createSponsorCouponProvider({transport,sponsorAddress,windowDuration:'60',store,nowSeconds:()=>120n,pollIntervalMs:10,maxPolls:30});
    }));
    const coupons=await Promise.all(providers.map((provider,n)=>provider.acquire({scope,owner:new Fr(100+n),actionKind:'post',readRegisteredBatch:async({batchId})=>{
      assert(sealed);assert.equal(batchId,sealed.batchId);
      return {root:sealed.root,window:sealed.window,ticket_count:String(sealed.ticketCount),timestamp:'120'};
    }})));
    assert.equal(coupons[0].batchId,coupons[1].batchId);assert.notEqual(coupons[0].index,coupons[1].index);assert.notEqual(coupons[0].blind,coupons[1].blind);
    assert.equal(sealed.ticketCount,2);assert.equal(issuer.counters().currentWindowReserved,'20');
    for(const [route,keys] of observed)assert.deepEqual(keys.sort(),route==='reserve'?['window']:route==='submit'?['leaf','token']:['token']);
    assert.equal(boundary.counters().active,0);
  } finally {
    for(const store of stores)store.close();
    if(boundary){const closed=new Promise(resolve=>boundary.server.close(resolve));boundary.server.closeAllConnections();await closed;}
    issuer?.close();fs.rmSync(dir,{recursive:true,force:true});
  }
});
