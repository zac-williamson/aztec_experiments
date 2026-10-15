import fs from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {createProverServer} from './server.mjs';
import {createPrivateQuery,validateQueryNode} from './private-query.mjs';
import {validateCompactTier} from '../shared/rolling/compact-client.mjs';

// Operator option contains only a tier. Browser origins always come from the
// same server configuration; a second endpoint allowlist cannot diverge.
export function compactBlockOptions(config){
 if(config.compactBlocks===undefined)return undefined;
 const value=config.compactBlocks;
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==1||!Object.hasOwn(value,'tier')||!config.queryNode)throw Error('Invalid compact service configuration');
 const descriptor=Object.getOwnPropertyDescriptor(value,'tier');
 if(!Object.hasOwn(descriptor,'value'))throw Error('Invalid compact service configuration');
 return {tier:validateCompactTier(descriptor.value),origins:config.origins};
}

const queryKeys=new Set(['serviceMode','chainId','rollupVersion','proofs','host','port','origins','queryNode','compactBlocks','compactRequestsPerMinute','trustedProxy','operatorAuthSha256']);
// Capture only own data properties: no ignored proof settings or accessor-backed
// configuration can smuggle a second lifecycle into this explicit mode.
export function validateQueryService(config){
 if(!config||Object.getPrototypeOf(config)!==Object.prototype)throw Error('Invalid query-only configuration');
 const captured={};
 for(const key of Reflect.ownKeys(config)){
  const descriptor=Object.getOwnPropertyDescriptor(config,key);
  if(!queryKeys.has(key)||!Object.hasOwn(descriptor,'value'))throw Error('Invalid query-only configuration');
  captured[key]=descriptor.value;
 }
 if(!Array.isArray(captured.origins))throw Error('Invalid query-only configuration');
 for(const key of Reflect.ownKeys(captured.origins)){const d=Object.getOwnPropertyDescriptor(captured.origins,key);if(!Object.hasOwn(d,'value')||(key!=='length'&&!/^(0|[1-9][0-9]*)$/.test(key)))throw Error('Invalid origins');}
 if(Object.keys(captured.origins).length!==captured.origins.length)throw Error('Invalid origins');
 const decimal=(value,bits)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<(1n<<BigInt(bits))&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER);
 const origin=value=>{try{return typeof value==='string'&&value.length<=2048&&['http:','https:'].includes(new URL(value).protocol)&&new URL(value).origin===value;}catch{return false;}};
 if(captured.serviceMode!=='query-only'||captured.proofs!=='real'||!decimal(captured.chainId,64)||!decimal(captured.rollupVersion,32)
  ||!Array.isArray(captured.origins)||captured.origins.length>64||!captured.origins.every(origin)||new Set(captured.origins).size!==captured.origins.length
  ||typeof (captured.host??'127.0.0.1')!=='string'||!(captured.host??'127.0.0.1').length||(captured.host??'127.0.0.1').length>253
  ||!Number.isSafeInteger(captured.port??8081)||(captured.port??8081)<0||(captured.port??8081)>65535
  ||(captured.trustedProxy!==undefined&&!isIP(captured.trustedProxy)))throw Error('Invalid query-only configuration');
 if(captured.operatorAuthSha256!==undefined&&(typeof captured.operatorAuthSha256!=='string'||!/^[0-9a-f]{64}$/.test(captured.operatorAuthSha256)))throw Error('Invalid query operator authentication');
 const rawNode=captured.queryNode;
 if(!rawNode||Object.getPrototypeOf(rawNode)!==Object.prototype)throw Error('Query node required');
 const nodeFields={};for(const key of Reflect.ownKeys(rawNode)){const d=Object.getOwnPropertyDescriptor(rawNode,key);if(!['url','rollupAddress','maxLagSeconds'].includes(key)||!Object.hasOwn(d,'value'))throw Error('Invalid query node configuration');nodeFields[key]=d.value;}
 if(typeof nodeFields.url!=='string'||typeof nodeFields.rollupAddress!=='string')throw Error('Invalid query node configuration');
 const queryNode=validateQueryNode(nodeFields);if(!queryNode)throw Error('Query node required');
 // Compact options keep the existing single origin policy and explicit opt-in.
 const origins=Object.freeze([...captured.origins]);
 const normalized={...captured,origins,queryNode};const compact=compactBlockOptions(normalized);
 if(compact)normalized.compactBlocks=Object.freeze({tier:compact.tier});
 return Object.freeze(normalized);
}
async function listen(server,port,host){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
}
async function startQueryOnlyService(input,observers){
 const config=validateQueryService(input);
 const privateQuery=await createPrivateQuery({...config,proofsEnabled:true,compactBlocks:compactBlockOptions(config)},observers);
 const server=createProverServer({...config,privateQuery,proofsEnabled:true});
 const close=()=>server.closeAndDrain();
 try{
  await listen(server,config.port??8081,config.host??'127.0.0.1');
  return {address:server.address(),close,stats:()=>Object.freeze({serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false})};
 }catch(error){await close();throw error;}
}

// Operator-only capability: absence reaches the worker as an absent environment
// entry. Capture own primitive scope values before the first await; the caller
// cannot later turn a restricted service into a Bok prover by mutating config.
function captureApplicationScope(input){
 const captured={};
 for(const key of ['applicationProfile','bokEnabled','board','privateBokAddress','privateFeeAddress']){
  const d=Object.getOwnPropertyDescriptor(input,key);
  if((d&&!Object.hasOwn(d,'value'))||(!d&&key in input))throw Error('Invalid application scope');
  captured[key]=d?.value;
 }
 const profile=captured.applicationProfile??'legacy';
 if(!['legacy','rolling'].includes(profile))throw Error('Invalid application profile');
 const enabled=captured.bokEnabled===undefined?true:captured.bokEnabled;
 if(typeof enabled!=='boolean'||(profile!=='rolling'&&captured.bokEnabled!==undefined))throw Error('Invalid Bok capability');
 const address=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)!==0n;
 if(profile==='rolling'){
  if(!address(captured.board)||!address(captured.privateFeeAddress)||captured.board===captured.privateFeeAddress
   ||(enabled?(!address(captured.privateBokAddress)||[captured.board,captured.privateFeeAddress].includes(captured.privateBokAddress)):captured.privateBokAddress!==undefined))throw Error('Distinct rolling board, Bok and private fee addresses required');
 }
 return Object.freeze({...captured,applicationProfile:profile,bokEnabled:enabled});
}

// Composition root: owns only the resources it creates. Tests and the host use
// this same entry point; HTTP, queue and worker communicate through interfaces.
export async function startProverService(config,observers){
 const mode=Object.getOwnPropertyDescriptor(config,'serviceMode');
 if(mode&&!Object.hasOwn(mode,'value'))throw Error('Invalid service mode');
 if(mode?.value==='query-only')return startQueryOnlyService(config,observers);
 if(mode&&mode.value!=='prover')throw Error('Invalid service mode');
 if('operatorAuthSha256' in config)throw Error('Query operator authentication requires query-only mode');
 const scope=captureApplicationScope(config);
 config={...config,...scope};
 if(!/^[1-9][0-9]*$/.test(String(config.chainId))||!/^[1-9][0-9]*$/.test(String(config.rollupVersion))||!Array.isArray(config.origins)||!config.origins.every(o=>{try{return new URL(o).origin===o;}catch{return false;}})||!Number.isSafeInteger(config.threads??1)||(config.threads??1)<1||(config.threads??1)>256)throw Error('Invalid network, origins or threads');
 if(!/^0x[0-9a-f]{64}$/.test(config.board)||!['real','disabled'].includes(config.proofs))throw Error('Invalid board/proofs configuration');
 if(config.privateFeeAddress!==undefined&&!/^0x[0-9a-f]{64}$/.test(config.privateFeeAddress))throw Error('Invalid private fee address');
 if(config.pluginAddresses!==undefined&&(!Array.isArray(config.pluginAddresses)||config.pluginAddresses.length>32||config.pluginAddresses.some(address=>!/^0x[0-9a-f]{64}$/.test(address)||BigInt(address)===0n)))throw Error('Invalid plugin address allowlist');
 const applicationProfile=scope.applicationProfile;
 const host=config.host??'127.0.0.1',proofsEnabled=config.proofs==='real';
 if(!proofsEnabled&&(!['127.0.0.1','::1','localhost'].includes(host)||String(config.chainId)!=='31337'))throw Error('Disabled proofs require loopback local devnet');
 validateQueryNode(config.queryNode);
 const privateQuery=await createPrivateQuery({...config,proofsEnabled,compactBlocks:compactBlockOptions(config)},observers);
 // Query-only returns above, before any proof-only module or resource exists.
 const [{prepareNativeRuntime},{loadCircuitCatalog},{createProcessWorker},{createProofQueue}]=await Promise.all([import('./runtime.mjs'),import('./catalog.mjs'),import('./process-worker.mjs'),import('./queue.mjs')]);
 const runtime=proofsEnabled?await prepareNativeRuntime(config):{};
 await loadCircuitCatalog({applicationProfile});
 const directory=await fs.mkdtemp(path.join(config.queueDirectory??'/tmp','board-prover-'));
 const worker=createProcessWorker({applicationProfile,privateBokAddress:scope.privateBokAddress,proofsEnabled,threads:config.threads??1,privateFeeAddress:scope.privateFeeAddress,pluginAddresses:config.pluginAddresses,...runtime});
 let queue,server,closing;
 const close=()=>closing??=(async()=>{try{if(server)await server.closeAndDrain();}finally{try{await (queue?queue.close():worker.close());}finally{await fs.rm(directory,{recursive:true,force:true});}}})();
 try{
  queue=await createProofQueue({directory,worker,maxJobs:1000,maxBytes:config.maxQueueBytes??2*1024**3});
  server=createProverServer({...config,queue,proofsEnabled,privateQuery});
  await listen(server,config.port??8081,host);
  return {address:server.address(),close,stats:()=>queue.stats()};
 }catch(error){await close();throw error;}
}
