import test from 'node:test';
import assert from 'node:assert/strict';
import {startRollingPublicServer} from './rolling-public-server.mjs';
test('global admission bounds slow active readers without network identity buckets',async t=>{
 let release,entered=0,allEntered;const held=new Promise(r=>release=r),ready=new Promise(r=>allEntered=r);
 const server=await startRollingPublicServer({index:{sync:async()=>{},status:()=>({state:'ready'})},pollMs:30000,staticHandler:async(req,res)=>{entered++;if(entered===128)allEntered();await held;res.end('ready');}});
 t.after(async()=>{release();await server.close();});
 const requests=Array.from({length:128},()=>fetch(server.url+'/asset').then(async r=>{await r.text();return r.status;}));await ready;
 const blocked=await fetch(server.url+'/asset');assert.equal(blocked.status,503);assert.equal(blocked.headers.get('retry-after'),'2');assert.equal((await blocked.json()).error,'capacity');assert.equal(entered,128);
 release();assert((await Promise.all(requests)).every(status=>status===200));
 const resumed=await fetch(server.url+'/asset');assert.equal(resumed.status,200);await resumed.text();
});
