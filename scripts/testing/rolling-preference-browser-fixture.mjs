import {applicationProofsEnabled} from './proof-policy.mjs';
// Test-only adapter. The existing parent owns the chain, miner and prover.
// Only keys cross into the fresh native browser; no private cache is copied.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT} from '../toolchain.mjs';
import {startComposerL1Reader,startComposerPublicReader} from './rolling-composer-fixture.mjs';

export function preferenceBrowserBudget(deadlineAt,now=Date.now()){
 assert(Number.isSafeInteger(deadlineAt)&&Number.isSafeInteger(now));
 assert(deadlineAt-now>=150000,'Insufficient remaining browser and accounting budget');return 120000;
}
export async function writePreferenceKeyBackup({account,password,file}){
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});
 vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),context);
 const encrypted=await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:account.secret.toString(),salt:account.salt.toString()},claims:[]},password);
 await fs.writeFile(file,JSON.stringify(encrypted),{flag:'wx',mode:0o600});
}
export async function finishPreferenceBrowserEvidence({observation,verifyFees,receiver,persist,ack}){
 const errors=[];
 try{await verifyFees();observation.accountingVerified=true;}catch(error){observation.accountingVerified=false;errors.push(error);}
 try{
  observation.receiver=receiver();assert.equal(observation.receiver.newProofJobs,0);assert.equal(observation.receiver.newNodeSubmissions,0);
  assert(observation.receiver.l1.forwarded>0);for(const key of ['rejected','errors','pending'])assert.equal(observation.receiver.l1[key],0);
 }catch(error){errors.push(error);}
 if(errors.length)observation.passed=false;
 await persist();await ack();
 if(errors.length)throw new AggregateError(errors,'Preference browser accounting or receiver checks failed');
}
export async function runRollingPreferenceBrowserFixture({ctx,actor,fees,endpoint,network,artifact,scope,deployment,service,sendCount,expected,observation,persist,verifyFees}){
 const {loadRollingWalletAssets}=await import('../rolling-wallet-assets.mjs');
 const {validateRollingPreferenceBrowserControl}=await import('./rolling-preference-browser.mjs');
 const control=ctx.browserControl;assert.equal(control?.browserMode,'rolling-preferences');assert.equal(control.browserEngine,'chromium');
 preferenceBrowserBudget(ctx.applicationDeadlineAt);
 Object.assign(observation,{passed:false,scope:'Genuine encrypted chain preferences recovered from keys in fresh Chromium native IndexedDB; no browser publication/funding',cleanup:{}});
 let reader,l1,before,result,failure;
 try{
  const backupPath=path.join(ctx.directory,'preferences-key-recovery.json');
  await writePreferenceKeyBackup({account:fees.authorAccount,password:control.backupPassword,file:backupPath});
  await actor.close();assert.throws(()=>actor.contextGuard());observation.nativeActorClosed=true;
  observation.keysOnlyBackup=true; // Constructed above from exact two-key schema, claims:[] only.
  l1=await startComposerL1Reader({upstream:ctx.config.l1RpcUrls[0],origin:control.origin});
  const gas=fees.browserFixture.gas;
  const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(gas[name][key])]))]));
  const configuration={config:{network:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,ethRpcUrl:l1.url},board:{contractAddress:String(ctx.instance.address),portalAddress:String(ctx.ready.portalAddress).toLowerCase()},privateFee:{contractAddress:String(fees.browserFixture.instance.address),gasSettings}},trustedQuery:{url:endpoint+'/v1/node',allowLocalDev:true},remoteProver:{url:endpoint,board:String(ctx.instance.address),chainId:network.chainId,rollupVersion:network.version,proofsEnabled:applicationProofsEnabled()},proofsEnabled:applicationProofsEnabled()};
  const wallet=await loadRollingWalletAssets(configuration,scope);
  const started=await startComposerPublicReader({node:ctx.node,artifact,scope,deployment,cacheDirectory:path.join(ctx.directory,'preferences-browser-public-index'),port:Number(new URL(control.origin).port),wallet});
  reader=started.reader;const index=started.index;assert.equal(reader.url,control.origin);
  const readyDeadline=Math.min(Date.now()+10000,ctx.applicationDeadlineAt-150000);
  while(index.status().state!=='ready'){assert(Date.now()<readyDeadline);assert.notEqual(index.status().state,'unavailable');await sleep(25);}
  const handoff={browserMode:'rolling-preferences',browserEngine:'chromium',origin:control.origin,trustedOrigin:endpoint,ethereumOrigin:l1.url,backupPath,backupPassword:control.backupPassword,expected,timeoutMs:preferenceBrowserBudget(ctx.applicationDeadlineAt)};
  await validateRollingPreferenceBrowserControl(handoff,{directory:ctx.directory});
  before={proofs:service.stats().submitted,sends:sendCount()};
  await fs.writeFile(path.join(ctx.directory,'browser-ready.json'),JSON.stringify(handoff),{flag:'wx',mode:0o600});ctx.mark('browser-ready');
  const deadline=Date.now()+handoff.timeoutMs+5000;
  for(;;){
   try{result=JSON.parse(await fs.readFile(path.join(ctx.directory,'browser-result.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
   assert(Date.now()<deadline);await sleep(100);
  }
  observation.browser=result;assert.equal(result.passed,true);observation.passed=true;
 }catch(error){failure=error;throw error;}
 finally{
  const errors=[];
  for(const [name,resource]of [['reader',reader],['l1',l1]])if(resource)try{await resource.close();observation.cleanup[name]=true;}catch(error){observation.cleanup[name]=false;errors.push(error);}
  if(errors.length)observation.passed=false;
  if(before){
   try{await finishPreferenceBrowserEvidence({observation,verifyFees,receiver:()=>({newProofJobs:service.stats().submitted-before.proofs,newNodeSubmissions:sendCount()-before.sends,l1:l1.stats()}),persist,
    ack:async()=>{if(result)await fs.writeFile(path.join(ctx.directory,'composer-observed.json'),JSON.stringify({schemaVersion:1,observed:true}),{flag:'wx',mode:0o600});}});}catch(error){errors.push(error);}
  }else try{await persist();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'Preference browser cleanup or accounting failed');
 }
}
