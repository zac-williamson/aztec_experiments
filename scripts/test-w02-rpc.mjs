import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const app of ['user','deploy'])test(`${app} CLI keeps RPC credentials at the exact configured endpoint`,async()=>{
 const source=fs.readFileSync(new URL(`../apps/src/billboard/${app}/cli.mjs`,import.meta.url),'utf8');
 const start=source.indexOf('function createCliRpcFetch('),end=source.indexOf('\nif',start);
 const c=vm.createContext({URL,Headers,Request});vm.runInContext(source.slice(start,end),c);
 const calls=[],fetch=c.createCliRpcFetch(async(url,options)=>{calls.push({url,options});},'https://rpc.example/rpc','test-api-key');
 await fetch('https://rpc.example/rpc',{headers:{Existing:'value'}});
 assert.equal(calls[0].options.headers.get('x-aztec-api-key'),'test-api-key');assert.equal(calls[0].options.redirect,'error');
 for(const url of ['https://rpc.example/elsewhere','https://evil.example/?next=rpc.example/rpc','https://rpc.example.evil.example/rpc'])await fetch(url);
 for(const call of calls.slice(1))assert.equal(call.options?.headers?.get?.('x-aztec-api-key'),undefined);
 await fetch('https://rpc.example/rpc',{credentials:'omit',referrerPolicy:'no-referrer'});
 assert.equal(calls.at(-1).options.headers,undefined);
});


// Controlled local HTTP only: actual installed SDK transport, unchanged CLI
// injector and synthetic capability. This does not load the CLI's wallet input.
test('deployment CLI authenticates actual SDK HTTP batches only at its exact endpoint',async()=>{
 const {createServer}=await import('node:http');
 const {createAztecNodeClient}=await import('../shared/aztec-node-client.mjs');
 const source=fs.readFileSync(new URL('../apps/src/billboard/deploy/cli.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function createCliRpcFetch('),end=source.indexOf('\nif',start);
 assert(start>=0&&end>start);assert.equal(source.indexOf('function createCliRpcFetch(',start+1),-1);
 const context=vm.createContext({URL,Headers,Request});vm.runInContext(source.slice(start,end),context);
 const key='ab'.repeat(32),calls=[],errors=[],original=globalThis.fetch;
 const server=createServer(async(req,res)=>{
  try{
   const authenticated=req.headers['x-aztec-api-key']===key;
   const call={path:req.url,authenticated,keyPresent:Object.hasOwn(req.headers,'x-aztec-api-key')};calls.push(call);
   if(req.url!=='/v1/node'||!authenticated){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Unauthorized synthetic operator'}}));return;}
   let body='';for await(const part of req)body+=part;
   const batch=JSON.parse(body);assert(Array.isArray(batch));assert(batch.length>0&&batch.length<=3);
   call.size=batch.length;
   for(const item of batch)assert.equal(item.method,'aztec_getBlockNumber');
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(batch.map(item=>({jsonrpc:'2.0',id:item.id,result:123}))));
  }catch(error){errors.push(error);res.writeHead(500);res.end('Controlled fixture rejected request');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const endpoint='http://127.0.0.1:'+server.address().port+'/v1/node';
 try{
  globalThis.fetch=context.createCliRpcFetch(original.bind(globalThis),endpoint,key);
  const node=createAztecNodeClient(endpoint);
  assert.deepEqual(await Promise.all(Array.from({length:7},()=>node.getBlockNumber())),Array(7).fill(123));
  assert.deepEqual(calls.map(x=>x.size).sort((a,b)=>a-b),[1,3,3]);
  const previous=calls.length;
  await assert.rejects(createAztecNodeClient(endpoint+'/other').getBlockNumber());
  assert.equal(calls.length,previous+1);assert.equal(calls.at(-1).keyPresent,false);
  globalThis.fetch=original;
  await assert.rejects(createAztecNodeClient(endpoint).getBlockNumber());assert.equal(calls.at(-1).keyPresent,false);
  globalThis.fetch=context.createCliRpcFetch(original.bind(globalThis),endpoint,'cd'.repeat(32));
  await assert.rejects(createAztecNodeClient(endpoint).getBlockNumber());assert.equal(calls.at(-1).keyPresent,true);assert.equal(calls.at(-1).authenticated,false);
  assert.equal(calls.length,previous+3);assert.deepEqual(errors,[]);
 }finally{
  globalThis.fetch=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(server.listening,false);
 }
});
