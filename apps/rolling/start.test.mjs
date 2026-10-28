// Real HTTP composition with explicitly synthetic public-index data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startRollingReader,createRollingReaderAssetHandler} from './start.mjs';
test('reader serves only browser assets and bounded public API from one origin',async t=>{
 let ready=true;
 const index={sync:async()=>{},status:()=>({schemaVersion:1,state:ready?'ready':'unavailable'}),
  query:()=>({schemaVersion:1,complete:true,posts:[],names:{},boards:{}})};
 const server=await startRollingReader({index});t.after(()=>server.close());
 const get=route=>fetch(server.url+route);
 const page=await get('/');assert.equal(page.status,200);assert.match(await page.text(),/reader\.mjs/);
 assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
 assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('access-control-allow-origin'),null);
 for(const asset of ['reader.mjs','analytics.mjs','analytics-schema.mjs','reader-client.mjs','profile-view.mjs','avatar-upload.mjs','model.mjs','navigation.mjs','style.css']){
  const response=await get('/'+asset);assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-type'),asset.endsWith('.css')?/text\/css/:/text\/javascript/);
 }
 for(const route of ['/config.json','/.env','/start.mjs','/fixtures.mjs','/app.mjs','/index.html','/reader.mjs?secret=x','/shared/sdk-entry.mjs','/%2e%2e%2f.env'])assert.equal((await get(route)).status,404,route);
 const head=await fetch(server.url+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await fetch(server.url+'/',{method:'POST',body:'private'})).status,405);
 assert.equal((await get('/api/feed')).status,200);assert.equal((await get('/api/wallet')).status,404);
 ready=false;assert.equal((await get('/api/feed')).status,503);assert.equal((await get('/')).status,200);
});

import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const readyIndex=()=>({sync:async()=>{},status:()=>({state:'ready'}),query:()=>({posts:[]})});
const wire=(url,{encoding,method='GET'}={})=>new Promise((resolve,reject)=>{
 const request=http.request(url,{method,headers:encoding===undefined?{}:{'Accept-Encoding':encoding}},response=>{
  const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);
 });request.on('error',reject);request.end();
});
test('wallet gzip preserves exact decoded bytes, SRI digest and isolation headers on GET and HEAD',async t=>{
 const body=Buffer.from('public SDK bytes\0'.repeat(8192));let reads=0;
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:['http://127.0.0.1:19081'],read:async p=>{reads++;return p==='/wallet/aztec_bundle.js'?{body,type:'text/javascript'}:null;}}});t.after(()=>server.close());
 const get=await wire(server.url+'/wallet/aztec_bundle.js',{encoding:'gzip, deflate, br'});
 assert.equal(get.status,200);assert.equal(get.headers['content-encoding'],'gzip');assert.equal(get.headers.vary,'Accept-Encoding');assert.equal(Number(get.headers['content-length']),get.body.length);assert(get.body.length<body.length);
 assert.deepEqual(gunzipSync(get.body),body);assert.equal(createHash('sha256').update(gunzipSync(get.body)).digest('base64'),createHash('sha256').update(body).digest('base64'));
 for(const [name,value]of Object.entries({'cache-control':'no-store','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}))assert.equal(get.headers[name],value);
 assert.match(get.headers['content-security-policy'],/script-src 'self' 'wasm-unsafe-eval'/);assert.match(get.headers['content-security-policy'],/http:\/\/127.0.0.1:19081/);
 const head=await wire(server.url+'/wallet/aztec_bundle.js',{encoding:'gzip',method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-encoding'],'gzip');assert.equal(head.headers['content-length'],get.headers['content-length']);assert.equal(reads,2,'cache never bypasses current decoded asset validation');
 const identity=await wire(server.url+'/wallet/aztec_bundle.js');assert.equal(identity.headers['content-encoding'],undefined);assert.deepEqual(identity.body,body);assert.equal(Number(identity.headers['content-length']),body.length);
});
test('wallet encoding negotiation honors quality, exclusions, wildcard and unsupported encodings',async t=>{
 let reads=0;const body=Buffer.from('public artifact');
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:[],read:async()=>{reads++;return {body,type:'application/json'};}}});t.after(()=>server.close());
 for(const [encoding,selected]of [['gzip;q=0','identity'],['gzip;q=0.5, identity;q=0.2','gzip'],['gzip;q=0.1','identity'],['br','identity'],['*;q=1','gzip'],['*;q=0, gzip;q=1','gzip'],['GZip;Q=1','gzip'],['gzip;q=0,gzip;q=1','identity']]){
  const response=await wire(server.url+'/wallet/board.json',{encoding});assert.equal(response.status,200,encoding);assert.equal(response.headers['content-encoding'],selected==='gzip'?'gzip':undefined,encoding);assert.deepEqual(selected==='gzip'?gunzipSync(response.body):response.body,body);
 }
 const before=reads;
 for(const encoding of ['identity;q=0','*;q=0','gzip;q=0,identity;q=0','br;q=1,identity;q=0','gzip;q=2','gzip;q=0.0001']){const response=await wire(server.url+'/wallet/board.json',{encoding});assert.equal(response.status,406,encoding);assert.equal(response.body.length,0);assert.equal(response.headers['cache-control'],'no-store');}
 assert.equal(reads,before,'unacceptable encodings do not read or compress assets');
});
test('wallet compressed representations revalidate changing source bytes and do not mask missing/error assets',async t=>{
 let body=Buffer.from('first version'.repeat(100));let failure=false;
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:[],read:async p=>{if(failure)throw Error('private filesystem detail');return p==='/wallet/runtime.mjs'?{body,type:'text/javascript'}:null;}}});t.after(()=>server.close());
 const url=server.url+'/wallet/runtime.mjs';const first=await wire(url,{encoding:'gzip'});assert.deepEqual(gunzipSync(first.body),body);
 body=Buffer.from('second version'.repeat(100));const second=await wire(url,{encoding:'gzip'});assert.deepEqual(gunzipSync(second.body),body);assert.notDeepEqual(first.body,second.body);
 assert.equal((await wire(server.url+'/wallet/missing.js',{encoding:'gzip'})).status,404);
 assert.equal((await wire(url+'?query=1',{encoding:'gzip'})).status,404);
 assert.equal((await wire(url,{encoding:'gzip',method:'POST'})).status,405);
 failure=true;const failed=await wire(url,{encoding:'gzip'});assert.equal(failed.status,503);assert.doesNotMatch(failed.body.toString(),/private filesystem detail/);assert.equal(failed.headers['content-encoding'],undefined);
 failure=false;assert.deepEqual(gunzipSync((await wire(url,{encoding:'gzip'})).body),body,'failed work releases admission');
});
test('wallet admission bounds concurrent reads and queued compression work, rejecting overload without reading',async t=>{
 let release;const barrier=new Promise(resolve=>release=resolve);let reads=0,active=0,peak=0;
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:[],read:async()=>{reads++;active++;peak=Math.max(peak,active);await barrier;active--;return {body:Buffer.alloc(1024*1024,65),type:'application/wasm'};}}});t.after(()=>server.close());
 const requests=Array.from({length:34},()=>wire(server.url+'/wallet/bb.wasm',{encoding:'gzip'}));
 const first=await Promise.race(requests);assert.equal(first.status,503);assert.equal(first.headers['retry-after'],'1');assert.equal(reads,1);assert.equal(peak,1);release();
 const results=await Promise.all(requests);assert.equal(results.filter(r=>r.status===503).length,1);assert.equal(results.filter(r=>r.status===200).length,33);assert.equal(reads,33);assert.equal(peak,1);
 for(const r of results.filter(r=>r.status===200))assert.equal(gunzipSync(r.body).length,1024*1024);
});

import {EventEmitter} from 'node:events';
class HeldAssetResponse extends EventEmitter {
 constructor(){super();this.headers={};this.destroyed=false;this.started=new Promise(resolve=>this.onStart=resolve);}
 setHeader(k,v){this.headers[k]=v;}
 writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);}
 end(body){this.bytes=body?.length??0;this.onStart();}
 destroy(){this.destroyed=true;this.emit('close');}
 finish(){this.emit('finish');}
}
test('wallet response byte ownership lasts through native completion or cancellation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const big=Buffer.alloc(64*1024*1024),small=Buffer.from('worker');let reads=0;
 const handler=createRollingReaderAssetHandler({connectOrigins:[],read:async p=>{reads++;return {body:p==='/wallet/large.wasm'?big:small,type:'application/wasm'};}});
 const request=url=>({url,method:'GET',headers:{'accept-encoding':'identity'}});
 const first=new HeldAssetResponse(),second=new HeldAssetResponse();const one=handler(request('/wallet/large.wasm'),first);await first.started;const two=handler(request('/wallet/large.wasm'),second);await second.started;
 const refused=new HeldAssetResponse();await handler(request('/wallet/worker.js'),refused);assert.equal(refused.status,503);assert.equal(reads,3);
 // Slow transfers retain their byte budget, but never the compressor slot.
 t.mock.timers.tick(120000);assert.equal(first.destroyed,false);assert.equal(second.destroyed,false);
 first.finish();second.destroy();await Promise.all([one,two]);
 const next=new HeldAssetResponse();const nextResult=handler(request('/wallet/worker.js'),next);await next.started;assert.equal(next.status,200);next.finish();await nextResult;
});
test('slow identity reader does not block unrelated worker delivery and 31-worker burst succeeds',async t=>{
 const large=Buffer.alloc(16*1024*1024),worker=Buffer.from('self.onmessage = () => {};');let reads=0;
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:[],read:async p=>{reads++;return {body:p==='/wallet/large.wasm'?large:worker,type:'text/javascript'};}}});t.after(()=>server.close());
 let slowResponse;const slow=http.get(server.url+'/wallet/large.wasm',response=>{slowResponse=response;response.pause();});slow.on('error',()=>{});t.after(()=>slow.destroy());
 await new Promise(resolve=>slow.once('response',resolve));
 const workers=await Promise.all(Array.from({length:31},()=>wire(server.url+'/wallet/bb-thread.worker.js',{encoding:'gzip'})));
 assert.equal(workers.length,31);assert.equal(reads,32);for(const r of workers){assert.equal(r.status,200);assert.deepEqual(gunzipSync(r.body),worker);}
 assert.equal(slowResponse.complete,false,'slow original remains unread while worker fanout completes');slow.destroy();
});

test('immutable wallet URLs bind exact decoded bytes and keep metadata and invalid queries fresh',async t=>{
 let body=Buffer.from('pinned asset'),reads=0;
 const server=await startRollingReader({index:readyIndex(),wallet:{connectOrigins:[],read:async()=>{reads++;return {body,type:'application/json'};}}});t.after(()=>server.close());
 const hash=createHash('sha256').update(body).digest('hex'),url=server.url+'/wallet/board.json?sha256='+hash;
 for(const encoding of ['identity','gzip']){const r=await wire(url,{encoding});assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'public, max-age=31536000, immutable');assert.deepEqual(encoding==='gzip'?gunzipSync(r.body):r.body,body);assert.equal(r.headers.vary,'Accept-Encoding');}
 for(const query of ['?sha256='+hash+'&x=1','?sha256='+hash+'&sha256='+hash,'?sha256='+hash.toUpperCase(),'?sha256=wrong']){const before=reads;const r=await wire(server.url+'/wallet/board.json'+query);assert.equal(r.status,404);assert.equal(r.headers['cache-control'],'no-store');assert.equal(reads,before);}
 const sdk=server.url+'/wallet/aztec_bundle.js?sha256='+hash;
 for(const encoding of ['identity','gzip']){const r=await wire(sdk,{encoding});assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'public, max-age=31536000, immutable');assert.deepEqual(encoding==='gzip'?gunzipSync(r.body):r.body,body);}
 assert.equal((await wire(server.url+'/wallet/aztec_bundle.js')).headers['cache-control'],'no-store');
 for(const query of ['?sha256='+hash+'&x=1','?sha256='+'0'.repeat(64)]){const r=await wire(server.url+'/wallet/aztec_bundle.js'+query);assert.equal(r.status,404);assert.equal(r.headers['cache-control'],'no-store');}
 for(const name of ['g1_verifier.dat','g2.dat','grumpkin_g1.dat']){
  const crs=server.url+'/crs/'+name;
  const pinned=await wire(crs+'?sha256='+hash);assert.equal(pinned.status,200);assert.equal(pinned.headers['cache-control'],'public, max-age=31536000, immutable');
  assert.equal((await wire(crs)).headers['cache-control'],'no-store');
  const wrong=await wire(crs+'?sha256='+'0'.repeat(64));assert.equal(wrong.status,404);assert.equal(wrong.headers['cache-control'],'no-store');
 }
 const metadata=await wire(server.url+'/wallet/runtime.json?sha256='+hash);assert.equal(metadata.status,404);assert.equal(metadata.headers['cache-control'],'no-store');
 assert.equal((await wire(server.url+'/wallet/runtime.json')).headers['cache-control'],'no-store');
 body=Buffer.from('changed asset');const changed=await wire(url);assert.equal(changed.status,404);assert.equal(changed.headers['cache-control'],'no-store');
});

test('earlier conversations remain available without an account or a running index',async t=>{
 const server=await startRollingReader({index:{sync:async()=>{},status:()=>({state:'unavailable'}),query:()=>{throw Error('Archive must not query the current board');}}});t.after(()=>server.close());
 const archive=await fetch(server.url+'/archive/');assert.equal(archive.status,200);const html=await archive.text();assert.doesNotMatch(html,/<script|<button|<input/);assert.equal((html.match(/<article /g)||[]).length,7);
 const snapshot=await fetch(server.url+'/archive/snapshot.json');assert.equal(snapshot.status,200);assert.match(snapshot.headers.get('content-type'),/application\/json/);const data=await snapshot.json();assert.equal(data.response.posts.length,7);assert.equal(data.response.scope.boardAddress,'0x186d5c5e5a9bcd6d971b5e6c2a5dfb1afb58a103ee1715f7ce9997cce0c199a6');
 for(const post of data.response.posts)assert(html.includes('id="post-'+post.id+'"'));
});
