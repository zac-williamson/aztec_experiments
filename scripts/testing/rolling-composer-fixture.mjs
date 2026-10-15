import {applicationProofsEnabled} from './proof-policy.mjs';
// TEST ONLY. Real production reader/assets and encrypted disposable custody.
// Parent keeps real node/prover/miner alive and verifies both private fee balances.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import {webcrypto} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT} from '../toolchain.mjs';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call']);
export function composerBudget(deadlineAt,now=Date.now()){
 assert(Number.isSafeInteger(deadlineAt)&&Number.isSafeInteger(now));
 const remaining=deadlineAt-now-15000;assert(remaining>=30000,'Insufficient remaining browser and cleanup budget');return Math.min(120000,remaining);
}
export async function startComposerL1Reader({upstream,origin}){
 const u=new URL(upstream),o=new URL(origin);assert.equal(u.protocol,'http:');assert.equal(u.hostname,'127.0.0.1');assert.equal(o.origin,origin);assert.equal(o.protocol,'http:');assert.equal(o.hostname,'127.0.0.1');
 assert(!u.username&&!u.password&&!u.search&&!u.hash);
 const stats={requests:0,forwarded:0,rejected:0,errors:0,pending:0};
 const server=http.createServer(async(req,res)=>{
  stats.requests++;stats.pending++;
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
  const reply=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value));};
  try{
   if(req.headers.origin!==origin||req.url!=='/'){stats.rejected++;reply(403,{error:'Denied'});return;}
   if(req.method==='OPTIONS'){reply(204,null);return;}
   if(req.method!=='POST'){stats.rejected++;reply(405,{error:'Denied'});return;}
   let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>262144)throw Error();}
   const body=JSON.parse(text),batch=Array.isArray(body)?body:[body];
   if(batch.length<1||batch.length>32||batch.some(r=>!r||r.jsonrpc!=='2.0'||!allowed.has(r.method)||Object.keys(r).some(k=>!['id','jsonrpc','method','params'].includes(k)))){stats.rejected++;reply(403,{error:'Read-only endpoint'});return;}
   stats.forwarded+=batch.length;
   const response=await fetch(upstream,{method:'POST',headers:{'Content-Type':'application/json'},body:text,signal:AbortSignal.timeout(5000),redirect:'error'});
   assert(response.ok);const reader=response.body.getReader();let size=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=1048576);chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
   reply(200,JSON.parse(Buffer.concat(chunks).toString()));
  }catch{stats.errors++;if(!res.headersSent)reply(502,{error:'Read unavailable'});else res.destroy();}
  finally{stats.pending--;}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:'http://127.0.0.1:'+server.address().port,stats:()=>({...stats}),close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();})};
}
// A failed browser must not trigger supervisor-wide cleanup before the fixture
// persists receiver/accounting evidence. The hard supervisor remains authoritative.
export async function writeComposerResultAndAwaitAck({directory,result,timeoutMs=30000}){
 assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000);
 await fs.writeFile(path.join(directory,'browser-result.json'),JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
 const deadline=Date.now()+timeoutMs;
 for(;;){
  try{const ack=JSON.parse(await fs.readFile(path.join(directory,'composer-observed.json'),'utf8'));assert.deepEqual(ack,{schemaVersion:1,observed:true});return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  assert(Date.now()<deadline,'Composer observation acknowledgement unavailable');await sleep(25);
 }
}
export async function finishComposerEvidence({observation,verifyFees,receiver,persist,ack}){
 assert(Array.isArray(verifyFees)&&verifyFees.length===2&&verifyFees.every(fn=>typeof fn==='function'));
 const errors=[];observation.accounting={};
 for(const [i,role]of ['a','b'].entries())try{await verifyFees[i]();observation.accounting[role]=true;}catch(error){observation.accounting[role]=false;errors.push(error);}
 observation.accountingVerified=errors.length===0;observation.receiver=receiver();
 try{assert.equal(observation.receiver.newProofJobs,0);assert.equal(observation.receiver.newNodeSubmissions,0);assert(observation.receiver.l1.forwarded>0);for(const key of ['rejected','errors','pending'])assert.equal(observation.receiver.l1[key],0);}catch(error){errors.push(error);}
 if(errors.length)observation.passed=false;
 await persist(); // Never acknowledge evidence that was not successfully saved.
 await ack();
 if(errors.length)throw new AggregateError(errors,'Composer final accounting or receiver checks failed');
}
// Return the actual index together with its listener so the parent retains sole
// cleanup ownership. Awaiting its factory is required before the server polls it.
export async function startComposerPublicReader({node,artifact,scope,deployment,cacheDirectory,port,wallet}){
 const {startRollingReader}=await import('../../apps/rolling/start.mjs');
 const {createRollingPublicIndex}=await import('../../shared/rolling/public-index.mjs');
 const {publicFeedFileStorage}=await import('../../shared/public-feed-file-storage.mjs');
 const index=await createRollingPublicIndex({node,artifact,scope,deployment,storage:publicFeedFileStorage(cacheDirectory,{maxRecordBytes:1048576,maxSnapshotBytes:67108864}),rangeSize:10,pagesPerSync:20,timeoutMs:10000});
 const reader=await startRollingReader({index,port,wallet});return {index,reader};
}
export async function runRollingComposerFixture({ctx,actors,fees,claim,endpoint,network,artifact,scope,deployment,service,sendCount,observation,persist,verifyFees}){
 const {loadRollingWalletAssets}=await import('../rolling-wallet-assets.mjs');
 const {validateRollingComposerControl}=await import('./rolling-composer-browser.mjs');
 const control=ctx.browserControl;assert.equal(control?.browserMode,'rolling-composer');assert.equal(control.browserEngine,'chromium');
 assert.equal(actors.length,2);assert.equal(fees.length,2);
 Object.assign(observation,{passed:false,scope:'Production browser encrypted import and composer; no browser posting/funding acceptance',cleanup:{}});
 assert.equal(typeof persist,'function');assert(Array.isArray(verifyFees)&&verifyFees.length===2);
 let l1,reader,failure,browserResult,before;
 try{
  const expectedNames={a:(await actors[0].application.ownedIdentities()).records,b:(await actors[1].application.ownedIdentities()).records};
  const backupPaths={a:path.join(ctx.directory,'composer-a.json'),b:path.join(ctx.directory,'composer-b.json')};
  const cryptoContext=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),cryptoContext);
  for(const [i,role]of ['a','b'].entries()){
   const account=fees[i].authorAccount;
   const claims=i===0?[{scope:{...claim.scope,depositor:claim.depositor},record:{schemaVersion:1,secretHash:claim.secretHash.toString(),secret:claim.secret.toString()}}]:[];
   const encrypted=await cryptoContext.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:account.secret.toString(),salt:account.salt.toString()},claims},control.backupPassword);
   await fs.writeFile(backupPaths[role],JSON.stringify(encrypted),{flag:'wx',mode:0o600});
  }
  for(const actor of actors)await actor.close();observation.cliActorsClosed=true;
  l1=await startComposerL1Reader({upstream:ctx.config.l1RpcUrls[0],origin:control.origin});
  const gas=fees[0].browserFixture.gas;
  const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(gas[name][key])]))]));
  const configuration={config:{network:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,ethRpcUrl:l1.url},board:{contractAddress:String(ctx.instance.address),portalAddress:String(ctx.ready.portalAddress).toLowerCase()},privateFee:{contractAddress:String(fees[0].browserFixture.instance.address),gasSettings}},trustedQuery:{url:endpoint+'/v1/node',allowLocalDev:true},remoteProver:{url:endpoint,board:String(ctx.instance.address),chainId:network.chainId,rollupVersion:network.version,proofsEnabled:applicationProofsEnabled()},proofsEnabled:applicationProofsEnabled()};
  const wallet=await loadRollingWalletAssets(configuration,scope);
  const started=await startComposerPublicReader({node:ctx.node,artifact,scope,deployment,cacheDirectory:path.join(ctx.directory,'composer-public-index'),port:Number(new URL(control.origin).port),wallet});
  reader=started.reader;const index=started.index;assert.equal(reader.url,control.origin);
  const readyDeadline=Math.min(Date.now()+10000,ctx.applicationDeadlineAt-30000);
  while(index.status().state!=='ready'){assert(Date.now()<readyDeadline);assert.notEqual(index.status().state,'unavailable');await sleep(25);}
  const handoff={browserMode:'rolling-composer',browserEngine:'chromium',origin:control.origin,trustedOrigin:endpoint,ethereumOrigin:l1.url,backupPaths,backupPassword:control.backupPassword,expectedNames,timeoutMs:composerBudget(ctx.applicationDeadlineAt)};
  await validateRollingComposerControl(handoff,{directory:ctx.directory});
  before={proofs:service.stats().submitted,sends:sendCount()};
  await fs.writeFile(path.join(ctx.directory,'browser-ready.json'),JSON.stringify(handoff),{flag:'wx',mode:0o600});
  ctx.mark('browser-ready');
  const deadline=Date.now()+handoff.timeoutMs+5000;
  let result;
  for(;;){
   try{result=JSON.parse(await fs.readFile(path.join(ctx.directory,'browser-result.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
   assert(Date.now()<deadline);await sleep(100);
  }
  browserResult=result;observation.browser=result;observation.receiver={newProofJobs:service.stats().submitted-before.proofs,newNodeSubmissions:sendCount()-before.sends,l1:l1.stats()};
  assert.equal(result.passed,true);assert.equal(observation.receiver.newProofJobs,0);assert.equal(observation.receiver.newNodeSubmissions,0);
  assert(observation.receiver.l1.forwarded>0);for(const key of ['rejected','errors','pending'])assert.equal(observation.receiver.l1[key],0);
  observation.passed=true;
 }catch(error){failure=error;throw error;}
 finally{
  const errors=[];
  for(const [name,resource]of [['reader',reader],['l1',l1]])if(resource)try{await resource.close();observation.cleanup[name]=true;}catch(error){observation.cleanup[name]=false;errors.push(error);}
  if(errors.length)observation.passed=false;
  if(before){
   try{await finishComposerEvidence({observation,verifyFees,receiver:()=>({newProofJobs:service.stats().submitted-before.proofs,newNodeSubmissions:sendCount()-before.sends,l1:l1.stats()}),persist,
    ack:async()=>{if(browserResult)await fs.writeFile(path.join(ctx.directory,'composer-observed.json'),JSON.stringify({schemaVersion:1,observed:true}),{flag:'wx',mode:0o600});}});}catch(error){errors.push(error);}
  }else try{await persist();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'Composer fixture cleanup or accounting failed');
 }
}
