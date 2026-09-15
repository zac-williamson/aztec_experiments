// TEST ONLY: real opaque HTTP delivery, durable encrypted local coupons, genuine batch registration.
// The test seals after two requests; production operator scheduling/recovery remains a separate gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {openIssuer} from '../sponsor-service/issuer.mjs';
import {createIssuerHttpServer} from '../sponsor-service/http.mjs';
import {createSqliteSponsorCouponStore} from '../sponsor-service/coupon-store.mjs';
import {createSponsorTransport} from '../shared/sponsor-transport.mjs';
import {createSponsorCouponProvider} from '../shared/sponsor-coupon-provider.mjs';
import {readRegisteredSponsorBatch} from '../shared/sponsor-state.mjs';

// Own every callback even when its caller stops waiting on a timeout race.
// SDK reads cannot be cancelled here: drain them before their wallet is stopped.
export function createOwnedCouponReader({waitForRegistration,readBatch}) {
  const owned=[];let draining=false;
  const live=signal=>{if(signal?.aborted)throw new Error('W01_COUPON_READ_ABORTED');};
  return Object.freeze({
    read:({batchId,signal})=>{
      if(draining)throw new Error('W01_COUPON_READER_CLOSED');
      const operation=(async()=>{
        live(signal);
        await waitForRegistration();
        live(signal); // Do not start a read after a slow registration outlives acquisition.
        const result=await readBatch({batchId});
        live(signal); // A completed read after abort is never returned as usable.
        return result;
      })();
      owned.push(operation);
      operation.catch(()=>{}); // Preserve original rejection; drain owns its disposition.
      return operation;
    },
    drain:()=>{draining=true;return Promise.allSettled(owned);},
  });
}

export async function deliverW01Coupons({directory,node,wallet,sponsor,sponsorRaw,scope,owner,config,send,posting}) {
  const requestedRoot=path.join(directory,'w01-coupon-delivery');await fs.mkdir(requestedRoot,{mode:0o700});
  const root=await fs.realpath(requestedRoot);
  let issuer,boundary,registration;const stores=[];const requests=[];
  const reader=createOwnedCouponReader({waitForRegistration:()=>registration,
    readBatch:({batchId})=>readRegisteredSponsorBatch({wallet,node,sponsorAddress:sponsor.address,sponsorArtifact:sponsorRaw,
      boardAddress:scope.boardAddress,expectedChainId:scope.l1ChainId,expectedVersion:scope.rollupVersion,batchId})});
  const now=async()=>BigInt((await node.getBlock('latest')).header.globalVariables.timestamp.toString());
  let timestamp=await now();
  try {
    issuer=await openIssuer({dbPath:path.join(root,'issuer.sqlite'),chainId:scope.l1ChainId,version:scope.rollupVersion,
      sponsorAddress:sponsor.address.toString(),windowDuration:String(config.window_duration),windowBudget:String(config.window_budget),maxFeePerTicket:String(config.max_fee_per_ticket)},
      {nowSeconds:()=>timestamp});
    const service={reserve:async input=>{timestamp=await now();requests.push({route:'reserve',fields:Object.keys(input)});return issuer.reserve(input);},
      submit:async input=>{
        timestamp=await now();requests.push({route:'submit',fields:Object.keys(input)});const receipt=issuer.submit(input);
        if(issuer.counters().submitted===2&&!registration){
          registration=(async()=>{
            const batch=await issuer.seal({batchId:receipt.batchId});
            await send(sponsor.methods.register_batch(BigInt(batch.batchId),batch.root,BigInt(batch.window),batch.ticketCount),'register-shared-delivery');
            return batch;
          })();
          registration.catch(()=>{}); // Awaited below; suppress only an early unhandled notification.
        }
        // HTTP submission acknowledges durable commitment, not chain registration.
        return receipt;
      },retrieve:async input=>{timestamp=await now();requests.push({route:'retrieve',fields:Object.keys(input)});return issuer.retrieve(input);}};
    boundary=createIssuerHttpServer({issuer:service});boundary.server.listen(0,'127.0.0.1');await once(boundary.server,'listening');
    const transport=createSponsorTransport({url:'http://127.0.0.1:'+boundary.server.address().port,allowLoopbackHttp:true});
    const kinds=['claim',posting?'post':'withdraw'];
    const providers=[];
    for(const kind of kinds){
      const encryptionKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      const store=await createSqliteSponsorCouponStore({dbPath:path.join(root,kind+'.sqlite'),encryptionKey});stores.push(store);
      providers.push(createSponsorCouponProvider({transport,sponsorAddress:sponsor.address.toString(),windowDuration:String(config.window_duration),store,
        nowSeconds:()=>timestamp,maxPolls:30,pollIntervalMs:1000,deadlineMs:60000}));
    }
    const outcomes=await Promise.allSettled(providers.map((provider,i)=>provider.acquire({scope,owner,
      actionKind:kinds[i],readRegisteredBatch:reader.read})));
    for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
    const results=outcomes.map(outcome=>outcome.value);
    const batch=await registration;assert(batch);assert.equal(batch.ticketCount,2);
    assert.equal(results[0].batchId,results[1].batchId);assert.notEqual(results[0].index,results[1].index);
    assert.notEqual(results[0].blind,results[1].blind);
    for(const request of requests)assert.deepEqual(request.fields.sort(),request.route==='reserve'?['window']:request.route==='submit'?['leaf','token']:['token']);
    const observation={passed:true,realHttp:true,realSqlite:true,encryptedLocalStorage:true,genuineRegisteredBatch:true,
      sameAuthorSeparateTestStores:true,productionOperatorRecoveryQualified:false,batchId:batch.batchId,root:batch.root,ticketCount:batch.ticketCount,
      requestFields:requests,issuerCounters:issuer.counters()};
    return {coupons:new Map(kinds.map((kind,i)=>[kind,results[i]])),observation};
  } finally {
    // Registration is an owned operation, never leave a detached admin proof behind.
    if(registration)await registration.catch(()=>{});
    await reader.drain(); // Includes reads whose acquisition already timed out.
    for(const store of stores)store.close();
    if(boundary){const closed=new Promise(resolve=>boundary.server.close(resolve));boundary.server.closeAllConnections();await closed;}
    issuer?.close();
  }
}
