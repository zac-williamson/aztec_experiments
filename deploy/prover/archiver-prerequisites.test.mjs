// Development-only test doubles; none of these tests qualify a live node.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {runChecks,supervise,initialReport,SCOPE,PHASES,SOURCE_HASHES} from './archiver-prerequisites.mjs';
const H='0x'+'a'.repeat(64),D='0x'+'b'.repeat(64),A='0x'+'1'.repeat(40);
function fixture(overrides={}){const calls=[];const ops={source:async()=>({node:'24.21.0',aztec:'6.0.0-rc.1',sourceSha256:'c'.repeat(64),sourceFiles:{...SOURCE_HASHES}}),chain:async()=>SCOPE.chainId,finalized:async()=>({number:20n,timestamp:1000n,hash:H}),identity:async()=>({version:BigInt(SCOPE.version),hasCode:true,codeSha256:H}),constants:async()=>({startBlock:10n,genesisTime:900n,proofSubmissionEpochs:2n,genesisArchiveRoot:1n,slashingProposer:A,committeeSize:48n,manaLimit:100n}),block:async n=>({number:n,timestamp:1000n,hash:n===10n?D:H}),historicalLogs:async()=>[{blockNumber:10n,blockHash:D,address:SCOPE.rollup,removed:false}],latest:async()=>({number:22n,timestamp:1000n,hash:H}),nowSeconds:()=>1100,trace:async()=>({debugTraceRecent:true,traceTransactionRecent:false,debugTraceOld:false,traceTransactionOld:false}),blobSources:async()=>true,close:async()=>{},...overrides};for(const k of Object.keys(ops)){const fn=ops[k];ops[k]=(...a)=>{calls.push(k);return fn(...a);};}return {ops,calls};}
async function run(overrides={}){const {ops,calls}=fixture(overrides),snapshots=[];const result=await runChecks(ops,r=>snapshots.push(JSON.parse(JSON.stringify(r))));return {result,calls,snapshots};}
test('labelled fake complete path persists running then exact stages, never startup qualification',async()=>{const {result,snapshots}=await run();assert.equal(result.passed,true);assert.equal(result.nodeStartupQualified,false);assert.deepEqual(result.stages.map(x=>x.name),PHASES);assert(result.stages.every(x=>x.status==='passed'));assert.equal(result.cleanup,true);for(const phase of PHASES)assert(snapshots.some(s=>s.stages.some(x=>x.name===phase&&x.status==='running')));});
test('wrong chain stops before personalized or further provider reads',async()=>{const {result,calls}=await run({chain:async()=>1});assert.equal(result.passed,false);assert.deepEqual(calls,['source','chain','close']);});
test('wrong rollup version and missing code fail the actual identity boundary',async()=>{for(const v of [{version:1n,hasCode:true,codeSha256:H},{version:BigInt(SCOPE.version),hasCode:false,codeSha256:H}]){const {result}=await run({identity:async()=>v});assert.equal(result.stages.at(-1).name,'rollup-identity');assert.equal(result.stages.at(-1).status,'failed');}});
test('historical logs require nonempty exact deployblock/hash/contract and not removed',async()=>{for(const logs of [[],[{blockNumber:11n,blockHash:D,address:SCOPE.rollup,removed:false}],[{blockNumber:10n,blockHash:H,address:SCOPE.rollup,removed:false}],[{blockNumber:10n,blockHash:D,address:A,removed:false}],[{blockNumber:10n,blockHash:D,address:SCOPE.rollup,removed:true}]]){const {result,calls}=await run({historicalLogs:async()=>logs});assert.equal(result.stages.at(-1).name,'historical-logs');assert.equal(result.passed,false);assert(!calls.includes('trace'));}});
test('strict 300-second SDK L1 drift boundary preserved',async()=>{assert.equal((await run({nowSeconds:()=>1300})).result.passed,true);const {result}=await run({nowSeconds:()=>1301});assert.equal(result.stages.at(-1).name,'latest-clock');assert.equal(result.passed,false);});
test('trace acceptance exactly requires at least one actual supported method',async()=>{const {result}=await run({trace:async()=>({debugTraceRecent:false,traceTransactionRecent:false,debugTraceOld:false,traceTransactionOld:false})});assert.equal(result.stages.at(-1).name,'trace');assert.equal(result.passed,false);});
test('SDK blob source rejection is retained, no success fallback',async()=>{const {result,calls}=await run({blobSources:async()=>false});assert.equal(result.stages.at(-1).name,'blob-sources');assert.equal(result.passed,false);assert.equal(calls.filter(v=>v==='blobSources').length,1);});
test('finalized anchor mutation rejects the otherwise passing probe',async()=>{let calls=0;const {result}=await run({block:async n=>({number:n,timestamp:1000n,hash:++calls===1?D:D})});assert.equal(result.stages.at(-1).name,'anchor-continuity');assert.equal(result.passed,false);});
test('provider thrown objects, messages, causes and changing getters never enter receipt',async()=>{let accessed=0;const secret='PRIVATE_PROVIDER_TEXT';const error=Object.defineProperties({},Object.fromEntries(['message','code','cause','stack','toJSON'].map(k=>[k,{get(){accessed++;throw new Error(secret);}}])));const {result}=await run({historicalLogs:async()=>{throw error;}});assert.equal(accessed,0);assert(!JSON.stringify(result).includes(secret));assert.equal(result.stages.at(-1).category,'UNAVAILABLE');});
test('source projection rejects arbitrary digest values and extra private source fields',async()=>{const {result}=await run({source:async()=>({node:'24.21.0',aztec:'6.0.0-rc.1',sourceSha256:'SECRET',sourceFiles:{...SOURCE_HASHES,SECRET:'value'}})});assert.equal(result.stages[0].status,'failed');assert(!JSON.stringify(result).includes('SECRET'));});
test('cleanup failure cannot turn checks into an overall pass',async()=>{const {result}=await run({close:async()=>{throw new Error('SECRET');}});assert.equal(result.passed,false);assert.equal(result.cleanup,false);assert(!JSON.stringify(result).includes('SECRET'));});
test('actual disposable child enforces deadline, kills ignored TERM and preserves partial receipt',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archiver-probe-test-'));let child;try{const output=path.join(dir,'report.json');const r=await supervise(output,{deadlineMs:300,spawnWorker(fd){child=spawn(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';process.on('SIGTERM',()=>{});const r=${JSON.stringify(initialReport())};r.stages.push({name:'source',status:'running'});const b=Buffer.from(JSON.stringify(r));fs.writeSync(3,b,0,b.length,0);fs.ftruncateSync(3,b.length);fs.fsyncSync(3);process.stdout.write('PRIVATE_STDOUT');process.stderr.write('PRIVATE_STDERR');setInterval(()=>{},1000);`],{stdio:['ignore','ignore','ignore',fd]});return child;}});assert.equal(r.passed,false);assert.equal(r.processCategory,'DEADLINE');assert.equal(r.stages[0].status,'running');assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0));assert.equal(fs.statSync(output).mode&0o777,0o600);assert(!fs.readFileSync(output,'utf8').includes('PRIVATE'));}finally{if(child&&!child.signalCode&&child.exitCode===null)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}});
test('existing or symlinked receipt refuses execution without modifying target',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archiver-probe-test-'));try{const target=path.join(dir,'existing');fs.writeFileSync(target,'preserve');const link=path.join(dir,'link');fs.symlinkSync(target,link);let invoked=false;for(const file of [target,link])await assert.rejects(supervise(file,{spawnWorker(){invoked=true;throw new Error();}}));assert.equal(invoked,false);assert.equal(fs.readFileSync(target,'utf8'),'preserve');}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('fixed locally-branded failure categories discriminate empty logs, clock, trace and reorg',async()=>{for(const [overrides,category] of [[{historicalLogs:async()=>[]},'HISTORICAL_LOGS_EMPTY'],[{nowSeconds:()=>1301},'L1_STALE'],[{trace:async()=>({debugTraceRecent:false,traceTransactionRecent:false,debugTraceOld:false,traceTransactionOld:false})},'TRACE_UNAVAILABLE'],[{block:async n=>({number:n,timestamp:1000n,hash:D})},'ANCHOR_CHANGED']])assert.equal((await run(overrides)).result.stages.at(-1).category,category);});

test('actual installed source bytes match every declared SDK pin without RPC',()=>{const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');for(const [file,digest] of Object.entries(SOURCE_HASHES))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),digest);});

import {diagnoseHistoricalLogs} from './archiver-prerequisites.mjs';
const topic='0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0';
const deploymentHash='0x58d0033b3e1bd75ef5035779824d90a6bf4312be8d7cf2989ecb9c5ad4e34622';
const rawLog=()=>({address:SCOPE.rollup,blockNumber:'0xb3d474',blockHash:deploymentHash,removed:false,transactionHash:H,transactionIndex:'0x0',logIndex:'0x0',data:'0x',topics:[topic,'0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+'1'.repeat(40)]});
const envelope=result=>({jsonrpc:'2.0',id:1,result});
async function rawProbe(payload,options={}){let requests=0;const r=await diagnoseHistoricalLogs({fetchImpl:async(url,init)=>{requests++;assert.equal(url,'https://ethereum-sepolia-rpc.publicnode.com');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.deepEqual(JSON.parse(init.body),{jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[{address:SCOPE.rollup,topics:[topic],fromBlock:'0xb3d474',toBlock:'0xb3d474'}]});return new Response(typeof payload==='string'?payload:JSON.stringify(payload),{status:200});},...options});assert.equal(requests,1);assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));return r;}
test('single labelled HTTP response passes real SDK and strict ABI decoding offline, without another provider request',async()=>{const r=await rawProbe(envelope([rawLog()]));assert.equal(r.passed,true);assert.equal(r.status,'PASSED');assert.equal(r.rawCount,1);assert.equal(r.sdkCount,1);assert.equal(r.strictDecodedCount,1);assert.equal(r.nodeStartupQualified,false);assert.equal(r.requests,1);});
test('numeric RPC errors only, never provider messages, data or extra fields',async()=>{for(const code of [-32602,-32000,429]){const r=await rawProbe({jsonrpc:'2.0',id:1,error:{code,message:'PRIVATE_SENTINEL',data:{secret:'PRIVATE_SENTINEL'}},private:'PRIVATE_SENTINEL'});assert.equal(r.status,'RPC_ERROR');assert.equal(r.rpcCode,code);}for(const code of ['PRIVATE_SENTINEL',1.5,2**31,null])assert.equal((await rawProbe({jsonrpc:'2.0',id:1,error:{code,message:'PRIVATE_SENTINEL'}})).status,'INVALID_RPC_ERROR');});
test('HTTP failure and changing status getters are captured once and projected as bounded numeric status',async()=>{let reads=0,calls=0;const r=await diagnoseHistoricalLogs({fetchImpl:async()=>{calls++;return{get status(){reads++;return reads===1?403:'PRIVATE_SENTINEL';},get body(){throw Error('must not read');}};}});assert.equal(reads,1);assert.equal(calls,1);assert.equal(r.status,'HTTP_ERROR');assert.equal(r.httpStatus,403);assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));});
test('thrown malicious objects and response property getters never leak or cause retries',async()=>{let reads=0;const hostile=Object.defineProperties({},Object.fromEntries(['message','code','cause','stack','toJSON'].map(k=>[k,{get(){reads++;throw Error('PRIVATE_SENTINEL');}}])));for(const fetchImpl of [async()=>{throw hostile;},async()=>({get status(){throw hostile;}}),async()=>({status:200,get body(){throw hostile;}})]){const r=await diagnoseHistoricalLogs({fetchImpl});assert.equal(r.status,'UNAVAILABLE');assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));}assert.equal(reads,0);});
test('response envelope, JSON, UTF8, count and exact canonical log bindings fail closed',async()=>{for(const [value,status] of [['not JSON','INVALID_JSON'],[{},'INVALID_ENVELOPE'],[{jsonrpc:'2.0',id:2,result:[]},'INVALID_ENVELOPE'],[{jsonrpc:'2.0',id:1,error:{code:1},result:[]},'INVALID_ENVELOPE'],[envelope([]),'EMPTY_LOGS'],[envelope({}),'INVALID_LOG_ARRAY'],[envelope(Array(129).fill(rawLog())),'RESPONSE_TOO_LARGE']])assert.equal((await rawProbe(value)).status,status);
 for(const changes of [{address:A},{blockHash:H},{blockNumber:'0xb3d475'},{removed:true},{transactionHash:'PRIVATE_SENTINEL'},{transactionIndex:'0x00'},{logIndex:null},{data:'0x00'},{topics:[H,...rawLog().topics.slice(1)]},{topics:[topic]}])assert.equal((await rawProbe(envelope([{...rawLog(),...changes}]))).status,'LOG_BINDING_OR_SHAPE');
 assert.equal((await rawProbe(envelope(Array(129).fill(null)))).status,'INVALID_LOG_ARRAY');
 const invalid=await diagnoseHistoricalLogs({fetchImpl:async()=>new Response(new Uint8Array([255]),{status:200})});assert.equal(invalid.status,'INVALID_JSON');
});
test('bounded streamed response rejects oversize, cancels and releases stream with no raw output',async()=>{let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(16384));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}));const r=await diagnoseHistoricalLogs({fetchImpl:async()=>response});assert.equal(r.status,'RESPONSE_TOO_LARGE');assert.equal(cancelled,true);assert.equal(response.body.locked,false);});
test('timeout aborts the sole request or streaming read, preserving fixed status and cleanup',async()=>{for(const stream of [false,true]){let calls=0,aborted=false;const r=await diagnoseHistoricalLogs({timeoutMs:10,fetchImpl:async(_,init)=>{calls++;if(!stream)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('PRIVATE_SENTINEL'));},{once:true}));return new Response(new ReadableStream({start(c){init.signal.addEventListener('abort',()=>{aborted=true;c.error(Error('PRIVATE_SENTINEL'));},{once:true});}}));}});assert.equal(r.status,'TIMEOUT');assert.equal(r.passed,false);assert.equal(calls,1);assert.equal(aborted,true);assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));}});
test('same-response strict ABI stage rejects noncanonical indexed address padding after SDK parser',async()=>{const log=rawLog();log.topics[1]='0x'+'f'.repeat(64);const r=await rawProbe(envelope([log]));assert.equal(r.rawCount,1);assert.equal(r.sdkCount,1);assert.equal(r.strictDecodedCount,null);assert.equal(r.status,'STRICT_DECODE_FAILED');assert.equal(r.passed,false);});
test('named Tenderly mode selects exact keyless endpoint, preserves identical query and offline decoding',async()=>{
 let count=0;let body;
 const pub=await rawProbe(envelope([rawLog()]));assert.equal(pub.provider,'publicnode');
 const result=await diagnoseHistoricalLogs({provider:'tenderly',fetchImpl:async(url,options)=>{
  count++;assert.equal(url,'https://sepolia.gateway.tenderly.co');const parsed=new URL(url);assert.equal(parsed.username,'');assert.equal(parsed.password,'');assert.equal(parsed.search,'');assert.equal(parsed.pathname,'/');
  assert.deepEqual(options.headers,{'content-type':'application/json'});assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
  body=JSON.parse(options.body);return new Response(JSON.stringify(envelope([rawLog()])));
 }});
 assert.equal(count,1);assert.equal(result.provider,'tenderly');assert.equal(result.passed,true);assert.equal(result.sdkCount,1);assert.equal(result.strictDecodedCount,1);
 assert.deepEqual(body,{jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[{address:SCOPE.rollup,topics:[topic],fromBlock:'0xb3d474',toBlock:'0xb3d474'}]});
});
test('unsupported provider rejected before request or receipt creation, without coercing hostile selectors',async()=>{
 let requests=0,coercions=0;const hostile={toString(){coercions++;throw Error('PRIVATE_SENTINEL');}};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-provider-'));
 try{for(const provider of ['https://sepolia.gateway.tenderly.co','tenderly?key=PRIVATE_SENTINEL','TENDERLY','toString','__proto__','',null,hostile]){
  await assert.rejects(diagnoseHistoricalLogs({provider,fetchImpl:async()=>{requests++;}}));
  const output=path.join(dir,'must-not-exist');await assert.rejects(supervise(output,{historicalOnly:true,historicalProvider:provider,spawnWorker(){requests++;}}));assert.equal(fs.existsSync(output),false);
 }assert.equal(requests,0);assert.equal(coercions,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Tenderly failure records selected provider and numeric status only; never falls back or retries',async()=>{
 for(const type of ['rpc','http','exception']){let calls=0;const result=await diagnoseHistoricalLogs({provider:'tenderly',fetchImpl:async url=>{
  calls++;assert.equal(url,'https://sepolia.gateway.tenderly.co');if(type==='exception')throw Error('PRIVATE_SENTINEL');
  if(type==='http')return new Response('PRIVATE_SENTINEL',{status:429});
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32602,message:'PRIVATE_SENTINEL',data:'PRIVATE_SENTINEL'}}));
 }});assert.equal(calls,1);assert.equal(result.requests,1);assert.equal(result.provider,'tenderly');assert.equal(result.passed,false);assert.equal(result.status,{rpc:'RPC_ERROR',http:'HTTP_ERROR',exception:'UNAVAILABLE'}[type]);assert.equal(result.rpcCode,type==='rpc'?-32602:null);assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));}
});
test('supervisor retains selected provider in partial receipt if worker fails before diagnostic and forbids changing full prerequisite provider',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-provider-'));try{
  const report=await supervise(path.join(dir,'partial.json'),{historicalOnly:true,historicalProvider:'tenderly',spawnWorker(fd){return spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore',fd]});}});
  assert.equal(report.provider,'tenderly');assert.equal(report.status,'NOT_STARTED');assert.equal(report.requests,0);assert.equal(report.passed,false);assert.equal(report.processCategory,'WORKER_FAILED');
  const invalid=path.join(dir,'wrongmode.json');await assert.rejects(supervise(invalid,{historicalProvider:'tenderly'}));assert.equal(fs.existsSync(invalid),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

import {prerequisiteProviderConfig} from './archiver-prerequisites.mjs';
test('full prerequisite fixed provider config reaches actual SDK transport and blob L1 config, with strict sources unchanged',async()=>{
 const {getPublicClient,getRpcUrlsFromClient}=await import('@aztec-labs/ethereum/client');
 for(const [provider,url] of [['publicnode','https://ethereum-sepolia-rpc.publicnode.com'],['tenderly','https://sepolia.gateway.tenderly.co']]){
  const config=prerequisiteProviderConfig(provider),client=getPublicClient(config.client); // construction only: no RPC
  assert.deepEqual(getRpcUrlsFromClient(client),[url]);assert.deepEqual(config.client.l1RpcUrls,[url]);assert.equal(client.chain.id,11155111);
  assert.equal(config.blob.l1RpcUrls,config.client.l1RpcUrls);assert.deepEqual(config.blob.l1ConsensusHostUrls,['https://ethereum-sepolia-beacon-api.publicnode.com']);assert.deepEqual(config.blob.blobFileStoreUrls,['https://aztec-labs-snapshots.com/testnet/blobs']);assert.equal(config.blob.blobAllowEmptySources,false);assert.equal(config.blob.rollupAddress,SCOPE.rollup);assert.equal(config.blob.rollupVersion,SCOPE.version);assert.equal(config.blob.blobFileStoreTimeoutMs,10000);
  assert.throws(()=>config.client.l1RpcUrls.push('https://fallback.invalid'));assert.throws(()=>{config.blob.blobAllowEmptySources=true;});
 }
 assert.deepEqual(prerequisiteProviderConfig(),prerequisiteProviderConfig('publicnode'));
 for(const selector of ['https://sepolia.gateway.tenderly.co','constructor',null,{}])assert.throws(()=>prerequisiteProviderConfig(selector));
});
test('selected full provider preserves every acceptance gate and failure cleanup; no alternate retry',async()=>{
 const good=await runChecks(fixture().ops,()=>{},'tenderly');assert.equal(good.provider,'tenderly');assert.equal(good.passed,true);assert.deepEqual(good.stages.map(x=>x.name),PHASES);
 for(const [overrides,stage] of [[{chain:async()=>1},'chain'],[{identity:async()=>({version:1n,hasCode:true,codeSha256:H})},'rollup-identity'],[{historicalLogs:async()=>[]},'historical-logs'],[{nowSeconds:()=>1301},'latest-clock'],[{trace:async()=>({debugTraceRecent:false,traceTransactionRecent:false,debugTraceOld:false,traceTransactionOld:false})},'trace'],[{blobSources:async()=>false},'blob-sources'],[{block:async n=>({number:n,timestamp:1000n,hash:D})},'anchor-continuity']]){
  const {ops,calls}=fixture(overrides);const r=await runChecks(ops,()=>{},'tenderly');assert.equal(r.provider,'tenderly');assert.equal(r.passed,false);assert.equal(r.stages.at(-1).name,stage);assert.equal(r.cleanup,true);assert.equal(calls.filter(x=>x==='source').length,1);
 }
 let ran=false;await assert.rejects(runChecks({source(){ran=true;}},()=>{},'unknown'));assert.equal(ran,false);
});
test('full mode retains explicit provider on child failure and refuses mixed provider modes before receipt creation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-full-provider-'));try{
  const r=await supervise(path.join(dir,'partial.json'),{prerequisiteProvider:'tenderly',spawnWorker(fd){return spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore',fd]});}});
  assert.equal(r.provider,'tenderly');assert.equal(r.scope,'public-read-only-archiver-prerequisites');assert.equal(r.passed,false);assert.deepEqual(r.stages,[]);assert.equal(r.processCategory,'WORKER_FAILED');assert.equal(r.process.deadlineMs,59000);
  for(const options of [{prerequisiteProvider:'unknown'},{historicalOnly:true,prerequisiteProvider:'tenderly'}]){const file=path.join(dir,'invalid.json');await assert.rejects(supervise(file,options));assert.equal(fs.existsSync(file),false);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const SPLIT='tenderly-publicnode-debug';
const splitFixture=overrides=>fixture({debugChain:async()=>11155111,debugBlock:async n=>({number:n,timestamp:1000n,hash:H}),...overrides});
test('supported SDK separate debug client uses fixed PublicNode while ordinary/history/blob execution stays Tenderly',async()=>{
 const {getPublicClient,getRpcUrlsFromClient}=await import('@aztec-labs/ethereum/client');const config=prerequisiteProviderConfig(SPLIT);
 assert.deepEqual(getRpcUrlsFromClient(getPublicClient(config.client)),['https://sepolia.gateway.tenderly.co']);
 assert.deepEqual(getRpcUrlsFromClient(getPublicClient(config.debugClient)),['https://ethereum-sepolia-rpc.publicnode.com']);
 assert.equal(config.blob.l1RpcUrls,config.client.l1RpcUrls);assert.equal(config.blob.blobAllowEmptySources,false);
 assert.equal(config.client.l1ChainId,11155111);assert.equal(config.debugClient.l1ChainId,11155111);assert.throws(()=>config.debugClient.l1RpcUrls.push('https://other.invalid'));
 assert.throws(()=>prerequisiteProviderConfig('publicnode-tenderly-debug'));assert.throws(()=>prerequisiteProviderConfig('https://sepolia.gateway.tenderly.co'));
 const f=splitFixture(),r=await runChecks(f.ops,()=>{},SPLIT);assert.equal(r.passed,true);assert.equal(r.provider,SPLIT);assert.equal(r.ordinaryProvider,'tenderly');assert.equal(r.debugProvider,'publicnode');
 assert.deepEqual(r.stages.map(x=>x.name),[...PHASES.slice(0,8),'debug-chain-and-anchor',...PHASES.slice(8)]);
 assert(f.calls.indexOf('historicalLogs')<f.calls.indexOf('debugChain'));assert(f.calls.indexOf('debugBlock')<f.calls.indexOf('trace'));assert.equal(f.calls.filter(x=>x==='debugBlock').length,2);
});
test('split debug identity and canonical anchor disagreement stop before any trace and preserve safe failure',async()=>{
 for(const [overrides,category] of [[{debugChain:async()=>1},'DEBUG_CHAIN_MISMATCH'],[{debugBlock:async n=>({number:n,timestamp:1000n,hash:D})},'DEBUG_ANCHOR_MISMATCH'],[{debugBlock:async n=>({number:n+1n,timestamp:1000n,hash:H})},'DEBUG_ANCHOR_MISMATCH'],[{debugChain:async()=>{throw Error('PRIVATE_SENTINEL');}},'UNAVAILABLE']]){
  const f=splitFixture(overrides),r=await runChecks(f.ops,()=>{},SPLIT);assert.equal(r.passed,false);assert.equal(r.cleanup,true);assert.equal(r.stages.at(-1).category,category);assert(!f.calls.includes('trace'));assert(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
 }
});
test('split mode checks debug anchor again after all gates and fails a changed canonical view',async()=>{let reads=0;const f=splitFixture({debugBlock:async n=>({number:n,timestamp:1000n,hash:++reads===1?H:D})});const r=await runChecks(f.ops,()=>{},SPLIT);assert.equal(r.passed,false);assert.equal(r.stages.at(-1).name,'anchor-continuity');assert.equal(r.stages.at(-1).category,'DEBUG_ANCHOR_CHANGED');assert.equal(r.cleanup,true);});
test('split mode preserves ordinary history, trace and blob failure gates without provider fallback',async()=>{
 for(const [overrides,name] of [[{historicalLogs:async()=>[]},'historical-logs'],[{trace:async()=>({debugTraceRecent:false,traceTransactionRecent:false,debugTraceOld:false,traceTransactionOld:false})},'trace'],[{blobSources:async()=>false},'blob-sources']]){
  const f=splitFixture(overrides),r=await runChecks(f.ops,()=>{},SPLIT);assert.equal(r.passed,false);assert.equal(r.stages.at(-1).name,name);assert.equal(r.ordinaryProvider,'tenderly');assert.equal(r.debugProvider,'publicnode');assert.equal(f.calls.filter(x=>x==='source').length,1);assert.equal(r.cleanup,true);
 }
});
test('split provider labels survive worker failure and cannot be passed to historical-only mode',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'split-provider-'));try{
  const r=await supervise(path.join(dir,'partial.json'),{prerequisiteProvider:SPLIT,spawnWorker(fd){return spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore',fd]});}});assert.equal(r.passed,false);assert.equal(r.ordinaryProvider,'tenderly');assert.equal(r.debugProvider,'publicnode');assert.equal(r.process.deadlineMs,59000);
  const file=path.join(dir,'invalid');await assert.rejects(supervise(file,{historicalOnly:true,historicalProvider:SPLIT}));assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
