// Labelled development doubles and disposable child processes. No provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';
import {HttpRequestError,RpcRequestError} from 'viem';
import {L1RpcError,getRpcUrlsFromClient,getPublicClient} from '@aztec-labs/ethereum/client';
import {runDiagnostic,numericError,actualOperations,supervise,initialReport,SCOPE,ENDPOINT,PHASES} from './l1-config-diagnostic.mjs';
const H='0x'+'a'.repeat(64),SECRET='PRIVATE_PROVIDER_TEXT';
function fixture(overrides={}){
 const calls=[],addresses={registryAddress:{toString:()=>SCOPE.registry},rollupAddress:{toString:()=>SCOPE.rollup}};
 const ops={source:async()=>true,chain:async()=>11155111,finalized:async()=>({number:100n,timestamp:1000n,hash:H}),collectAddresses:async()=>addresses,contractsConfig:async value=>{assert.equal(value,addresses);return {rollupVersion:SCOPE.rollupVersion,genesisArchiveTreeRoot:H,l1StartBlock:50n,l1GenesisTime:500n,aztecEpochDuration:32,aztecSlotDuration:72,secret:SECRET};},block:async n=>({number:n,timestamp:1000n,hash:H}),...overrides};
 for(const name of Object.keys(ops)){const fn=ops[name];ops[name]=(...args)=>{calls.push(name);return fn(...args);};}return {ops,calls};
}
async function run(overrides={}){const f=fixture(overrides),snapshots=[];const report=await runDiagnostic(f.ops,r=>snapshots.push(JSON.parse(JSON.stringify(r))));assert(!JSON.stringify(report).includes(SECRET));return {...f,report,snapshots};}
const http=status=>new HttpRequestError({status,url:'https://private.invalid/?key='+SECRET,body:{secret:SECRET},details:SECRET});
const rpc=code=>new RpcRequestError({url:'https://private.invalid/?key='+SECRET,body:{secret:SECRET},error:{code,message:SECRET,data:SECRET}});
test('actual installed source pins and fixed official client configuration without network',async()=>{
 const ops=actualOperations();assert.equal(await ops.source(),true);assert.equal(ENDPOINT,'https://sepolia.gateway.tenderly.co');
 assert.deepEqual(getRpcUrlsFromClient(getPublicClient({l1RpcUrls:[ENDPOINT],l1ChainId:SCOPE.chainId})),[ENDPOINT]);
});
test('labelled fake phases persist before/after in exact order and pass exact addresses to official-config seam',async()=>{
 const {report,calls,snapshots}=await run();assert.equal(report.passed,true);assert.equal(report.nodeStartupQualified,false);assert.equal(report.imageExecution,false);assert.deepEqual(report.stages.map(r=>r.name),PHASES);assert.deepEqual(calls,['source','chain','finalized','collectAddresses','contractsConfig','block']);
 for(const phase of PHASES)assert(snapshots.some(s=>s.stages.some(r=>r.name===phase&&r.status==='running')));
 assert.equal(report.readsPinned,false);assert.match(report.sdkReadRetries,/installed defaults/);assert.equal(report.stages[4].observation.l1StartBlock,'50');
});
test('each failing phase stops without replay or downstream calls',async()=>{
 for(const name of ['source','chain','finalized','collectAddresses','contractsConfig','block']){
  const {report,calls}=await run({[name]:async()=>{throw Error(SECRET);}});assert.equal(report.passed,false);assert.equal(calls.filter(x=>x===name).length,1);assert.equal(calls.at(-1),name);assert.equal(report.stages.at(-1).category,'UNAVAILABLE');assert.deepEqual(report.stages.at(-1).error,{httpStatus:null,rpcCode:null});
 }
});
test('separate address and26-read config failures retain exact phase and numeric official HTTP/RPC status',async()=>{
 const a=await run({collectAddresses:async()=>{throw new L1RpcError('hidden',{cause:http(429)});}});assert.equal(a.report.stages.at(-1).name,'collect-addresses');assert.equal(a.report.stages.at(-1).error.httpStatus,429);assert.equal(a.report.stages.at(-1).category,'HTTP_ERROR');assert(!a.calls.includes('contractsConfig'));
 const b=await run({contractsConfig:async()=>{throw new L1RpcError('hidden',{cause:rpc(4444)});}});assert.equal(b.report.stages.at(-1).name,'contracts-config');assert.equal(b.report.stages.at(-1).error.rpcCode,4444);assert.equal(b.report.stages.at(-1).category,'RPC_ERROR');assert(!b.calls.includes('block'));
});
test('official typed numeric causes accepted, arbitrary names/code/messages not accepted',()=>{
 assert.deepEqual(numericError(new L1RpcError(SECRET,{cause:http(503)})),{httpStatus:503,rpcCode:null});assert.deepEqual(numericError(rpc(-32005)),{httpStatus:null,rpcCode:-32005});
 const forged=Object.assign(new Error(SECRET),{name:'HttpRequestError',status:429,code:4444});assert.deepEqual(numericError(forged),{httpStatus:null,rpcCode:null});
 for(const value of [SECRET,NaN,Infinity,-1,600])assert.equal(numericError(http(value)).httpStatus,null);
 for(const value of [SECRET,NaN,Infinity,2**31,-(2**31)-1])assert.equal(numericError(rpc(value)).rpcCode,null);
});
test('changing/throwing numeric, message and cause getters never execute',()=>{
 let calls=0;const error=http(429);for(const key of ['status','message','stack','cause','name'])Object.defineProperty(error,key,{configurable:true,get(){calls++;throw Error(SECRET);}});
 assert.deepEqual(numericError(error),{httpStatus:null,rpcCode:null});assert.equal(calls,0);
 const changed=rpc(4444);Object.defineProperty(changed,'code',{get(){calls++;return calls===1?4444:SECRET;}});assert.deepEqual(numericError(changed),{httpStatus:null,rpcCode:null});assert.equal(calls,0);
});
test('cyclic/deep/error-proxy cause chains terminate with no raw values',()=>{
 const cycle=Error(SECRET);cycle.cause=cycle;assert.deepEqual(numericError(cycle),{httpStatus:null,rpcCode:null});
 let deep=http(429);for(let i=0;i<9;i++)deep=Error(SECRET,{cause:deep});assert.deepEqual(numericError(deep),{httpStatus:null,rpcCode:null});
 const proxy=new Proxy({}, {getOwnPropertyDescriptor(){throw Error(SECRET);},getPrototypeOf(){throw Error(SECRET);}});assert.deepEqual(numericError(proxy),{httpStatus:null,rpcCode:null});
});
test('wrong chain, registry, rollup and configuration version are distinct rejection gates',async()=>{
 for(const [overrides,category]of [[{chain:async()=>1},'CHAIN_MISMATCH'],[{collectAddresses:async()=>({registryAddress:{toString:()=>SCOPE.registry},rollupAddress:{toString:()=>H}})},'IDENTITY_MISMATCH'],[{collectAddresses:async()=>({registryAddress:{toString:()=>H},rollupAddress:{toString:()=>SCOPE.rollup}})},'IDENTITY_MISMATCH'],[{contractsConfig:async()=>({rollupVersion:1})},'IDENTITY_MISMATCH']]){const {report}=await run(overrides);assert.equal(report.passed,false);assert.equal(report.stages.at(-1).category,category);}
});
test('source failure and malformed public projection fail closed without leaking extra fields',async()=>{
 assert.equal((await run({source:async()=>false})).report.stages.at(-1).category,'SOURCE_MISMATCH');
 for(const block of [{number:-1n,timestamp:1n,hash:H},{number:1n,timestamp:1n,hash:SECRET},{number:'1',timestamp:1n,hash:H}])assert.equal((await run({finalized:async()=>block})).report.passed,false);
 for(const config of [{genesisArchiveTreeRoot:SECRET},{l1StartBlock:101n},{aztecEpochDuration:0},{aztecSlotDuration:NaN}]){const original=fixture().ops;const {report}=await run({contractsConfig:async()=>({...await original.contractsConfig(await original.collectAddresses()),...config})});assert.equal(report.passed,false);}
});
test('anchor continuity preserves exact number/hash/timestamp and retains preceding successes',async()=>{
 for(const b of [{number:101n,timestamp:1000n,hash:H},{number:100n,timestamp:1001n,hash:H},{number:100n,timestamp:1000n,hash:'0x'+'b'.repeat(64)}]){const {report}=await run({block:async()=>b});assert.equal(report.stages.at(-1).category,'ANCHOR_CHANGED');assert.equal(report.stages[4].status,'passed');}
});
test('receipt creation is exclusive, symlinks/relative paths reject before child',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l1-config-diagnostic-'));try{const file=path.join(dir,'existing');fs.writeFileSync(file,'preserve');const link=path.join(dir,'link');fs.symlinkSync(file,link);let calls=0;for(const p of [file,link,'relative.json'])await assert.rejects(supervise(p,{spawnWorker(){calls++;throw Error(SECRET);}}));assert.equal(calls,0);assert.equal(fs.readFileSync(file,'utf8'),'preserve');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual disposable child timeout preserves partial phase and kills/reaps TERM-ignoring process',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l1-config-diagnostic-'));let child;try{const output=path.join(dir,'report.json');const report=await supervise(output,{deadlineMs:300,spawnWorker(fd){const r=initialReport();r.stages.push({name:'collect-addresses',status:'running'});child=spawn(process.execPath,['-e',`const fs=require('fs');process.on('SIGTERM',()=>{});const b=Buffer.from(${JSON.stringify(JSON.stringify(r))});fs.writeSync(3,b,0,b.length,0);fs.ftruncateSync(3,b.length);fs.fsyncSync(3);process.stdout.write('${SECRET}');process.stderr.write('${SECRET}');setInterval(()=>{},1000);`],{stdio:['ignore','ignore','ignore',fd]});return child;}});assert.equal(report.processCategory,'DEADLINE');assert.equal(report.passed,false);assert.equal(report.stages.at(-1).status,'running');assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0));assert.equal(fs.statSync(output).mode&0o777,0o600);assert(!fs.readFileSync(output,'utf8').includes(SECRET));}finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}
});
test('spawn failure rejects promptly and retains initial safe receipt',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l1-config-diagnostic-'));try{const output=path.join(dir,'report.json');await assert.rejects(supervise(output,{spawnWorker(fd){return spawn('/nonexistent/l1-config-diagnostic-child',[],{stdio:['ignore','ignore','ignore',fd]});}}));const report=JSON.parse(fs.readFileSync(output));assert.equal(report.passed,false);assert.deepEqual(report.stages,[]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

import {SPLIT_MODE,SPLIT_PHASES,providerConfig} from './l1-config-diagnostic.mjs';
const D='0x'+'b'.repeat(64);
const historyLog=()=>({address:SCOPE.rollup,blockNumber:50n,blockHash:D,removed:false,eventName:'OwnershipTransferred',privateExtra:SECRET});
function splitFixture(overrides={}){return fixture({historyChain:async()=>SCOPE.chainId,historyBlock:async n=>({number:n,timestamp:n===50n?500n:1000n,hash:n===50n?D:H}),historyLogs:async()=>[historyLog()],...overrides});}
async function runSplit(overrides={}){const f=splitFixture(overrides),snapshots=[];const report=await runDiagnostic(f.ops,r=>snapshots.push(JSON.parse(JSON.stringify(r))),SPLIT_MODE);assert(!JSON.stringify(report).includes(SECRET));return {...f,report,snapshots};}
test('explicit split roles are immutable; default Tenderly mode is preserved; unsupported selectors fail before work',async()=>{
 const a=providerConfig(),b=providerConfig(SPLIT_MODE);assert.equal(a.history,null);assert.deepEqual(a.configuration.l1RpcUrls,[ENDPOINT]);assert.deepEqual(b.configuration.l1RpcUrls,['https://ethereum-sepolia-rpc.publicnode.com']);assert.deepEqual(b.history.l1RpcUrls,[ENDPOINT]);assert.throws(()=>b.configuration.l1RpcUrls.push('https://private.invalid'));
 for(const mode of ['https://other.invalid','publicnode','auto',null,{}]){assert.throws(()=>providerConfig(mode));let calls=0;await assert.rejects(runDiagnostic({source(){calls++;}},()=>{},mode));assert.equal(calls,0);}
 assert.equal((await run()).report.mode,'tenderly-only');assert.equal((await run()).report.configurationProvider,'tenderly');
});
test('split full config plus actual historical seam pass only after both before/after common anchors',async()=>{
 const {report,calls,snapshots}=await runSplit();assert.equal(report.passed,true);assert.equal(report.mode,SPLIT_MODE);assert.equal(report.configurationProvider,'publicnode');assert.equal(report.historyProvider,'tenderly');assert.deepEqual(report.stages.map(s=>s.name),SPLIT_PHASES);assert.equal(calls.filter(s=>s==='contractsConfig').length,1);assert.equal(calls.filter(s=>s==='historyLogs').length,1);assert.equal(calls.filter(s=>s==='historyBlock').length,3);assert(calls.indexOf('contractsConfig')<calls.indexOf('historyLogs'));assert.equal(report.nodeStartupQualified,false);for(const phase of SPLIT_PHASES)assert(snapshots.some(r=>r.stages.some(s=>s.name===phase&&s.status==='running')));
});
test('split wrong chain/common anchor fails before address collection or any history request',async()=>{
 for(const [override,category]of [[{historyChain:async()=>1},'HISTORY_CHAIN_MISMATCH'],[{historyBlock:async n=>({number:n,timestamp:1000n,hash:D})},'HISTORY_ANCHOR_MISMATCH']]){const {report,calls}=await runSplit(override);assert.equal(report.passed,false);assert.equal(report.stages.at(-1).category,category);assert(!calls.includes('collectAddresses'));assert(!calls.includes('historyLogs'));}
});
test('split config429 and historical4444 stay errors without retry/fallback',async()=>{
 for(const [method,error,category]of [['contractsConfig',http(429),'HTTP_ERROR'],['historyLogs',rpc(4444),'RPC_ERROR']]){const {report,calls}=await runSplit({[method]:async()=>{throw error;}});assert.equal(report.passed,false);assert.equal(report.stages.at(-1).category,category);assert.equal(calls.filter(s=>s===method).length,1);assert.equal(calls.at(-1),method);assert.equal(report.configurationProvider,'publicnode');assert.equal(report.historyProvider,'tenderly');}
});
test('split logs require nonempty <=128 actual SDK event name and exact deployment/address/removal binding',async()=>{
 for(const logs of [[],Array(129).fill(historyLog()),[{...historyLog(),blockNumber:51n}],[{...historyLog(),blockHash:H}],[{...historyLog(),address:'0x'+'1'.repeat(40)}],[{...historyLog(),removed:true}],[{...historyLog(),eventName:'Other'}]]){const {report,calls}=await runSplit({historyLogs:async()=>logs});assert.equal(report.passed,false);assert.equal(report.stages.at(-1).name,'history-logs');assert(!calls.includes('block'));}
 const {report}=await runSplit({historyBlock:async n=>({number:n===50n?51n:n,timestamp:1000n,hash:n===50n?D:H})});assert.equal(report.stages.at(-1).category,'HISTORY_DEPLOY_MISMATCH');
});
test('split post-history reorg on either provider rejects all preceding successful checks',async()=>{
 const a=await runSplit({block:async n=>({number:n,timestamp:1000n,hash:D})});assert.equal(a.report.stages.at(-1).category,'ANCHOR_CHANGED');
 let calls=0;const b=await runSplit({historyBlock:async n=>({number:n,timestamp:n===50n?500n:1000n,hash:++calls===3?D:n===50n?D:H})});assert.equal(b.report.stages.at(-1).category,'HISTORY_ANCHOR_CHANGED');assert.equal(b.report.stages.find(s=>s.name==='history-logs').status,'passed');
});
test('split labels survive child failure and invalid mode refuses receipt creation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l1-config-split-'));try{const report=await supervise(path.join(dir,'partial.json'),{mode:SPLIT_MODE,spawnWorker:fd=>spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore',fd]})});assert.equal(report.passed,false);assert.equal(report.mode,SPLIT_MODE);assert.equal(report.configurationProvider,'publicnode');assert.equal(report.historyProvider,'tenderly');assert.equal(report.process.deadlineMs,59000);const invalid=path.join(dir,'invalid');await assert.rejects(supervise(invalid,{mode:'auto'}));assert.equal(fs.existsSync(invalid),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual installed SDK full configuration and history use distinct fixed transports against labelled fetch doubles only',async()=>{
 const saved=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);calls.push({url,method:body.method});let result;
  if(url==='https://ethereum-sepolia-rpc.publicnode.com'){
   assert.equal(body.method,'eth_call');result='0x'+'0'.repeat(64);
  }else{
   assert.equal(url,ENDPOINT);
   if(body.method==='eth_call')result='0x'+50n.toString(16).padStart(64,'0');
   else{assert.equal(body.method,'eth_getLogs');assert.equal(body.params[0].fromBlock,'0x32');assert.equal(body.params[0].toBlock,'0x32');assert.equal(body.params[0].address,SCOPE.rollup);result=[{address:SCOPE.rollup,blockNumber:'0x32',blockHash:D,removed:false,transactionHash:H,transactionIndex:'0x0',logIndex:'0x0',data:'0x',topics:['0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0','0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+'1'.repeat(40)]}];}
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{const ops=actualOperations(SPLIT_MODE),addresses=await ops.collectAddresses();assert(calls.length>=10);assert(calls.every(c=>c.url==='https://ethereum-sepolia-rpc.publicnode.com'));const before=calls.length;await ops.contractsConfig(addresses);assert(calls.length>before+15);assert(calls.every(c=>c.url==='https://ethereum-sepolia-rpc.publicnode.com'));const historyStart=calls.length,logs=await ops.historyLogs();assert.equal(logs.length,1);assert.equal(logs[0].eventName,'OwnershipTransferred');assert.equal(logs[0].blockNumber,50n);assert.deepEqual(calls.slice(historyStart).map(c=>c.url),[ENDPOINT,ENDPOINT]);assert.deepEqual(calls.slice(historyStart).map(c=>c.method),['eth_call','eth_getLogs']);}
 finally{globalThis.fetch=saved;}
});
