// Synthetic transport/budget fixtures only; real browser/proof acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {composerBudget,startComposerL1Reader} from './rolling-composer-fixture.mjs';
test('browser time is bounded and leaves explicit cleanup reserve',()=>{
 assert.equal(composerBudget(200000,1000),120000);assert.equal(composerBudget(46000,1000),30000);
 for(const deadline of [45999,1000,NaN,Infinity])assert.throws(()=>composerBudget(deadline,1000));
});
test('real loopback proxy forwards read batch and refuses mutation, mixed batch and foreign origin before upstream',async()=>{
 let forwarded=0;
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const value=JSON.parse(body);forwarded++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(value)?value.map(r=>({jsonrpc:'2.0',id:r.id,result:'0x1'})):{jsonrpc:'2.0',id:value.id,result:'0x1'}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:31111';let proxy;
 try{
  proxy=await startComposerL1Reader({upstream:'http://127.0.0.1:'+upstream.address().port,origin});
  const rpc=method=>({jsonrpc:'2.0',id:1,method,params:[]});
  const send=(body,from=origin)=>fetch(proxy.url,{method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
  let response=await send([rpc('eth_chainId'),rpc('eth_getBlockByNumber')]);assert.equal(response.status,200);assert.equal((await response.json()).length,2);assert.equal(forwarded,1);
  for(const body of [rpc('eth_sendRawTransaction'),rpc('evm_mine'),[rpc('eth_call'),rpc('eth_sendTransaction')],{...rpc('eth_call'),unexpected:1}]){response=await send(body);assert.equal(response.status,403);}
  assert.equal((await send(rpc('eth_call'),'http://127.0.0.1:31112')).status,403);assert.equal(forwarded,1);
  assert.deepEqual(proxy.stats(),{requests:6,forwarded:2,rejected:5,errors:0,pending:0});
 }finally{await proxy?.close();await new Promise(resolve=>upstream.close(resolve));}
});
test('malformed and oversized request produce failed evidence with no upstream send',async()=>{
 let calls=0;const upstream=http.createServer((req,res)=>{calls++;res.end('{}');});await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 let proxy;const origin='http://127.0.0.1:31111';
 try{proxy=await startComposerL1Reader({upstream:'http://127.0.0.1:'+upstream.address().port,origin});
  for(const body of ['{','x'.repeat(262145)]){const result=await fetch(proxy.url,{method:'POST',headers:{origin},body});assert.equal(result.status,502);}
  assert.equal(calls,0);assert.equal(proxy.stats().errors,2);
 }finally{await proxy?.close();await new Promise(resolve=>upstream.close(resolve));}
});

test('failed browser process waits for durable parent evidence before nonzero exit',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {spawn}=await import('node:child_process');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'composer-ack-'));let child;
 try{
  const moduleURL=new URL('./rolling-composer-fixture.mjs',import.meta.url).href;
  const code=`import {writeComposerResultAndAwaitAck} from ${JSON.stringify(moduleURL)};await writeComposerResultAndAwaitAck({directory:${JSON.stringify(directory)},result:{passed:false,stage:'forced-synthetic-failure'},timeoutMs:2000});process.exitCode=1;`;
  child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});const exited=new Promise(resolve=>child.once('exit',resolve));
  let result;const end=Date.now()+1500;
  while(!result){try{result=JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}assert(Date.now()<end);await new Promise(r=>setTimeout(r,10));}
  assert.equal(result.passed,false);assert.equal(child.exitCode,null);
  const evidence={browser:result,receiver:{newNodeSubmissions:0},accountingVerified:true};
  await fs.writeFile(path.join(directory,'durable-observation.json'),JSON.stringify(evidence),{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(directory,'composer-observed.json'),JSON.stringify({schemaVersion:1,observed:true}),{flag:'wx',mode:0o600});
  assert.equal(await exited,1);assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'durable-observation.json'),'utf8')),evidence);
 }finally{if(child&&child.exitCode===null)child.kill('SIGKILL');await fs.rm(directory,{recursive:true,force:true});}
});
test('missing parent acknowledgement fails within explicit bound',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {writeComposerResultAndAwaitAck}=await import('./rolling-composer-fixture.mjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'composer-no-ack-'));
 try{await assert.rejects(writeComposerResultAndAwaitAck({directory,result:{passed:false},timeoutMs:50}),/acknowledgement unavailable/);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'browser-result.json'),'utf8')).passed,false);}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});

const cleanReceiver=()=>({newProofJobs:0,newNodeSubmissions:0,l1:{forwarded:2,rejected:0,errors:0,pending:0}});
test('A accounting failure still checks B then persists both failures before acknowledgement',async()=>{
 const {finishComposerEvidence}=await import('./rolling-composer-fixture.mjs');const seen=[],observation={passed:true};const original=Error('synthetic A mismatch');let saved;
 await assert.rejects(finishComposerEvidence({observation,verifyFees:[async()=>{seen.push('a');throw original;},async()=>seen.push('b')],receiver:cleanReceiver,persist:async()=>{seen.push('persist');saved=structuredClone(observation);},ack:async()=>seen.push('ack')}),e=>e instanceof AggregateError&&e.errors[0]===original);
 assert.deepEqual(seen,['a','b','persist','ack']);assert.deepEqual(saved.accounting,{a:false,b:true});assert.equal(saved.passed,false);
});
for(const property of ['newProofJobs','newNodeSubmissions'])test('late '+property+' invalidates final evidence before acknowledgement',async()=>{
 const {finishComposerEvidence}=await import('./rolling-composer-fixture.mjs');const observation={passed:true};let saved,acked=false;
 await assert.rejects(finishComposerEvidence({observation,verifyFees:[async()=>{},async()=>{}],receiver:()=>({...cleanReceiver(),[property]:1}),persist:async()=>{saved=structuredClone(observation);},ack:async()=>{acked=true;}}),AggregateError);
 assert.equal(saved.passed,false);assert.equal(saved.receiver[property],1);assert.equal(acked,true);
});
test('failed persistence never acknowledges or masks its failure',async()=>{
 const {finishComposerEvidence}=await import('./rolling-composer-fixture.mjs');const failure=Error('synthetic storage failure');let acked=false;
 await assert.rejects(finishComposerEvidence({observation:{passed:true},verifyFees:[async()=>{},async()=>{}],receiver:cleanReceiver,persist:async()=>{throw failure;},ack:async()=>{acked=true;}}),e=>e===failure);assert.equal(acked,false);
});

// Actual processed artifact, decoder, canonical index, SQLite and HTTP listener.
// The upstream is deliberately unavailable: this is no chain/proof acceptance.
test('composer reader awaits its actual index factory and preserves unavailable upstream as an HTTP state',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {loadContractArtifact}=await import('@aztec-labs/stdlib/abi');const {getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract');
 const {BarretenbergSync}=await import('@aztec-foundation/bb.js');const {startComposerPublicReader}=await import('./rolling-composer-fixture.mjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'composer-index-'));let reader,url,reads=0;
 try{
  const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
  const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:hex(42),classId:String((await getContractClassFromArtifact(artifact)).id)};
  const started=await startComposerPublicReader({node:{getNodeInfo:async()=>{reads++;throw Error('synthetic upstream unavailable');}},artifact,scope,deployment:{blockNumber:1,blockHash:hex(1),txHash:hex(2)},cacheDirectory:directory,port:0});
  reader=started.reader;url=reader.url;assert.equal(typeof started.index.status,'function');assert.equal(typeof started.index.sync,'function');
  const denied=await fetch(url+'/api/feed');assert.equal(denied.status,503);assert.equal((await denied.json()).error,'not-ready');
  const response=await fetch(url+'/api/status');assert.equal(response.status,200);const state=await response.json();assert.equal(state.state,'unavailable');assert.equal(state.complete,false);assert.deepEqual(state.scope,scope);assert(reads>0);
 }finally{await reader?.close();await fs.rm(directory,{recursive:true,force:true});await BarretenbergSync.destroySingleton();}
 await assert.rejects(fetch(url+'/api/status',{signal:AbortSignal.timeout(1000)}));
});
