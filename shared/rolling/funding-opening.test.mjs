import {pricePrivateFeeGasSettings} from '../network-fee-pricing.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRollingFundingOpening} from './funding-session.mjs';
const tick=()=>new Promise(setImmediate),defer=()=>Promise.withResolvers();
const empty={status:'fee-needed',depositIds:[]};
function fixture(){
 const seen=[],native=defer(),allocation=defer(),rate=defer(),construction=defer(),token={};let valid=true;
 const options={asset:'ETH',guard:async()=>assert(valid,'owner changed'),readStatus:async()=>{seen.push('status');return native.promise;},readAllocation:async()=>{seen.push('allocation');return allocation.promise;},readRate:async()=>{seen.push('rate');return rate.promise;},prepareQuote:async value=>{seen.push('quote');assert.deepEqual(value,{amount:'200'});await construction.promise;return {breakdown:{maximumTotalWei:'1000000000000000000'}};}};
 return {options,seen,native,allocation,rate,construction,token,invalidate:()=>valid=false};
}
for(const status of [{status:'fee-ready',depositIds:['1']},{status:'fee-needed',depositIds:['1']},{status:'recovering',intent:{intentId:'saved'}},{status:'locked'}])test('native '+status.status+' returns without any signup payment reads',async()=>{
 const f=fixture(),pending=prepareRollingFundingOpening(f.options);await tick();assert.deepEqual(f.seen,['status']);f.native.resolve(status);
 assert.deepEqual(await pending,{status});assert.deepEqual(f.seen,['status']);
});
for(const asset of ['ETH','USDC'])test('fresh '+asset+' keeps full pricing before readiness, with independent fiat read',async()=>{
 const f=fixture();f.options.asset=asset;const pending=prepareRollingFundingOpening(f.options);await tick();assert.deepEqual(f.seen,['status']);
 f.native.resolve(empty);await tick();assert.deepEqual(f.seen,['status','allocation','rate']);
 f.allocation.resolve({amount:'200'});await tick();assert(!f.seen.includes('quote'),'no quote freshness fence while rate is still held');
 f.rate.resolve({price:2000n,decimals:0});await tick();assert.equal(f.seen.filter(x=>x==='quote').length,1);f.construction.resolve(f.token);
 const result=await pending;assert.equal(result.status,empty);assert(result.quote);
 assert.equal(f.seen.filter(x=>x==='quote').length,1);
 if(asset==='ETH')assert.equal(result.quote.usdEstimate,'2000.00');
});
test('failed native state starts no payment work',async()=>{
 const f=fixture(),error=Error('native'),pending=prepareRollingFundingOpening(f.options);f.native.reject(error);await assert.rejects(pending,e=>e===error);assert.deepEqual(f.seen,['status']);
});
for(const failed of ['allocation','rate'])test('fresh '+failed+' failure drains active sibling before returning a quote error',async()=>{
 const f=fixture(),error=Error(failed);let done=false;const pending=prepareRollingFundingOpening(f.options).finally(()=>done=true);f.native.resolve(empty);await tick();
 f[failed].reject(error);await tick();assert.equal(done,false);assert(!f.seen.includes('quote'));
 if(failed==='rate')f.allocation.resolve({amount:'200'});else f.rate.resolve(null);
 const result=await pending;assert.equal(result.quoteError,error);assert(!f.seen.includes('quote'));
});
test('fresh direct preparation failure is returned without another quote or payment',async()=>{
 const f=fixture(),error=Error('quote'),pending=prepareRollingFundingOpening(f.options);f.native.resolve(empty);f.allocation.resolve({amount:'200'});f.rate.resolve(null);await tick();f.construction.reject(error);
 const result=await pending;assert.equal(result.quoteError,error);assert.equal(f.seen.filter(x=>x==='quote').length,1);
});
test('owner replacement after native status starts no payment work',async()=>{
 const f=fixture(),pending=prepareRollingFundingOpening(f.options);await tick();f.invalidate();f.native.resolve(empty);await assert.rejects(pending,/owner changed/);assert.deepEqual(f.seen,['status']);
});
test('owner replacement after quote preparation prevents publishing readiness',async()=>{
 const f=fixture(),pending=prepareRollingFundingOpening(f.options);f.native.resolve(empty);f.allocation.resolve({amount:'200'});f.rate.resolve(null);await tick();f.invalidate();f.construction.resolve(f.token);await assert.rejects(pending,/owner changed/);
});
test('fresh signup uses one ordinary preparation after native eligibility',async()=>{
 const f=fixture(),pending=prepareRollingFundingOpening(f.options);f.native.resolve(empty);f.allocation.resolve({amount:'200'});f.rate.resolve(null);f.construction.resolve(null);assert((await pending).quote);assert(f.seen.includes('quote'));
});

// Actual context and worker modules, with labelled native/session/provider gates.
// No browser/native startup is claimed by this transport/lifecycle fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
if(typeof vm.SourceTextModule!=='function'){
 test('actual worker and context opening boundaries use the VM module fixture',()=>{
  const child=spawnSync(process.execPath,[...process.execArgv,'--experimental-vm-modules','--test','--test-name-pattern=early opening context|actual worker overlaps',import.meta.filename],{encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stdout+child.stderr);
 });
}else{
const repository=path.resolve(import.meta.dirname,'../..');
const sourceFile=relative=>fs.readFile(path.join(repository,relative),'utf8');
async function openingContextFixture(){
 const quote=defer(),rate=defer(),events=[];let valid=true,installed=0;
 const owner='0x'+'1'.repeat(64),node={getCurrentMinFees:async()=>({feePerDaGas:1n,feePerL2Gas:1n})},sdk={isTrustedPrivateNode:x=>x===node,normalizePrivateFeeGasSettings:()=>({gasSettings:{getFeeLimit:()=>({toBigInt:()=>100n})}}),createBrowserJournalStorage:()=>({})};
 const config={network:{chainId:'11155111',rollupVersion:'1',rollupAddress:'rollup'},board:{contractAddress:'board'},privateFee:{gasSettings:{gasLimits:{daGas:'25',l2Gas:'25'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}},aggregateFunding:{chainId:'11155111',collateralPortal:'portal',privateFpc:'fpc'}};
 const deployment={portal:'portal',board:{address:{toString:()=> 'board'}},privateFee:{address:{toString:()=> 'fpc'}},proofsEnabled:true,network:{chainId:'11155111',version:'1',rollup:'rollup'},economics:{minDeposit:'1'}};
 const quoteToken={},provider={async getBlock(){events.push('rate');await rate.promise;throw Error('No display rate');}};
 const locks={async request(name,options,work){events.push('lease-enter');try{return await work({name});}finally{events.push('lease-exit');}}};
 const context=vm.createContext({console,structuredClone,Promise,performance});
 const module=new vm.SourceTextModule(await sourceFile('shared/rolling/funding-session.mjs'),{context});
 await module.link(async name=>{
  const exports=name==='../network-fee-pricing.mjs'?{pricePrivateFeeGasSettings}:name==='./deployment.mjs'?{assertRollingDeploymentPreparation(){},prepareRollingDeployment:async()=>({deployment}),readRollingDeploymentRegistration:async()=>({deployment})}:{
   createAggregateWallet:async()=>({async prepareReadOnly(){throw Error('No split quote');},async installPreparedQuote(){throw Error('No split install');},async prepare(){events.push('quote-start');await quote.promise;events.push('quote-end');events.push('install');installed++;return {breakdown:{maximumTotalWei:'1'}};}}),
   automaticFundingGasBudget:async()=> '1',starterFundingAllocation:async()=>({asset:'ETH',feeAmount:'200'}),timeFundingPreparation:(_observer,_step,read)=>read(),
  };
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});
 });await module.evaluate();
 const funding=await module.namespace.createRollingFundingSession({sdk,ethers:{Interface:class{}},config,account:{secretKey:'secret',salt:'salt',address:owner},node,deploymentPreparation:{},boardArtifact:{},privateFeeArtifact:{},contextGuard:async()=>{if(!valid)throw Object.assign(Error('Changed owner'),{code:'ROLLING_CONTEXT_CHANGED'});},captureWallet:async()=>{},provider,locks});
 return {funding,quote,rate,events,owner,installed:()=>installed,invalidate:()=>{valid=false;},finish(){quote.resolve();rate.resolve();}};
}
test('early opening context binds the token to its issuing context and asset and consumes it once',async()=>{
 const f=await openingContextFixture(),other=await openingContextFixture(),token=f.funding.beginOpening({asset:'ETH'});await tick();assert(!f.events.includes('quote-start'));assert.equal(f.installed(),0);
 await assert.rejects(other.funding.prepareOpening(async()=>empty,{asset:'ETH'},token),e=>e.code==='ROLLING_CONTEXT_CHANGED');
 await assert.rejects(f.funding.prepareOpening(async()=>empty,{asset:'USDC'},token),e=>e.code==='ROLLING_CONTEXT_CHANGED');
 await assert.rejects(f.funding.prepareOpening(async()=>empty,{asset:'ETH'},structuredClone(token)),e=>e.code==='ROLLING_CONTEXT_CHANGED');
 f.finish();const result=await f.funding.prepareOpening(async()=>empty,{asset:'ETH'},token);assert(result.quote);assert.equal(f.installed(),1);assert.equal(f.events.filter(e=>e==='lease-enter').length,1);assert.equal(f.events.filter(e=>e==='lease-exit').length,1);
 await assert.rejects(f.funding.prepareOpening(async()=>empty,{asset:'ETH'},token),e=>e.code==='ROLLING_CONTEXT_CHANGED');
});
for(const mode of ['discard','status','owner','funded'])test('early opening context completes '+mode+' without starting payment work',async()=>{
 const f=await openingContextFixture(),token=f.funding.beginOpening({asset:'ETH'}),error=Error('Native failed');await tick();let finished=false;
 if(mode==='owner')f.invalidate();
 const pending=(mode==='discard'?f.funding.discardOpening(token,error):f.funding.prepareOpening(async()=>{if(mode==='status')throw error;return mode==='funded'?{status:'fee-ready',depositIds:['1']}:empty;},{asset:'ETH'},token)).finally(()=>{finished=true;});pending.catch(()=>{});
 await tick();assert.equal(finished,true);assert(!f.events.includes('quote-start'));assert(!f.events.includes('rate'));
 if(mode==='status')await assert.rejects(pending,e=>e===error);else if(mode==='owner')await assert.rejects(pending,e=>e.code==='ROLLING_CONTEXT_CHANGED');else await pending;
 assert.equal(f.installed(),0);
});
async function workerOpeningFixture({nativeFailure=false}={}){
 const f=await openingContextFixture(),native=defer(),status=defer(),sent=[];let handler,statusCalls=0;
 const context=vm.createContext({console,performance,structuredClone,AbortController,URL,Promise,__aztec:{normalizePrivateFeeGasSettings:()=>({gasSettings:{getFeeLimit:()=>({toBigInt:()=>100n})}}),ordinaryPostFeeLimit:()=>100n},ethers:{},BillboardPrivateFeeRouting:{},postMessage:value=>sent.push(value),addEventListener:(_name,fn)=>{handler=fn;}});
 const source=await sourceFile('apps/rolling/wallet-worker-entry.mjs');
 const module=new vm.SourceTextModule(source+'\nexport function prime(f,ready){account={};funding=f;opening=Promise.resolve();settings={config:{privateFee:{gasSettings:{}}}};creating=ready.then(value=>(session=value));creating.catch(()=>{});}',{context});
 const stubs={'../../shared/rolling/account-preparation.mjs':{prepareRollingAccount(){}},'./performance.mjs':{beginRollingMeasure:()=>()=>{},observeRollingWorkerPerformance:()=>()=>{}},'./wallet-session.mjs':{createRollingWalletSession(){throw Error('Already constructing');},createRollingRefundSession(){}},'../../shared/rolling/deployment.mjs':{createRollingDeploymentPreparation(){},prepareRollingDeployment(){}},'../../shared/rolling/funding-session.mjs':{createRollingFundingSession(){},verifyRollingAggregateScope(){}}};
 await module.link(async name=>{if(name==='./wallet-worker-protocol.mjs')return new vm.SourceTextModule(await sourceFile('apps/rolling/wallet-worker-protocol.mjs'),{context});const exports=stubs[name];assert(exports,name);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});});await module.evaluate();
 let busy=false;
 // Extract the actual session's forwarding property; locked holds the account
 // operation until real context status+installation completes.
 const sessionSource=await sourceFile('apps/rolling/wallet-session.mjs');
 const property=sessionSource.slice(sessionSource.indexOf('prepareOpening:fundingContext?'),sessionSource.indexOf(',preparePostingState,observeIncluded:'));
 const sessionModule=new vm.SourceTextModule('export function make(fundingContext,locked,synchronized){return {'+property+'};}',{context});await sessionModule.link(()=>{throw Error('No imports');});await sessionModule.evaluate();
 const active=sessionModule.namespace.make(f.funding,async work=>{assert(!busy);busy=true;try{return await work();}finally{busy=false;}},{async readAccountStatus(){statusCalls++;return status.promise;}});
 Object.defineProperty(active,'busy',{get:()=>busy});active.close=async()=>f.events.push('native-close');
 module.namespace.prime(f.funding,native.promise);
 const send=(id,method,args=[])=>handler({data:{type:'call',id,method,args}}),result=id=>sent.find(x=>x.type==='result'&&x.id===id);
 send(1,'prepareOpening',[{asset:'ETH'}]);await tick();assert(!f.events.includes('quote-start'));assert.equal(statusCalls,0);assert.equal(f.installed(),0);
 send(2,'prepareOpening',[{asset:'ETH'}]);send(3,'close');send(4,'funding.prepareStarter',[{asset:'ETH'}]);await tick();
 for(const id of [2,3,4])assert.equal(result(id)?.error?.code,'ROLLING_BUSY');assert.equal(f.events.filter(x=>x==='quote-start').length,0);
 if(nativeFailure)native.reject(Error('Native failed'));else native.resolve(active);
 await tick();if(!nativeFailure)assert.equal(result(1),undefined);if(!nativeFailure){assert.equal(statusCalls,1);assert.equal(busy,true);status.resolve(empty);}
 await tick();if(nativeFailure){assert(result(1)?.error);assert(!f.events.includes('quote-start'));}else{assert(!f.events.includes('quote-start'),'fiat read must drain before quote freshness begins');assert.equal(busy,true);f.rate.resolve();await tick();assert(f.events.includes('quote-start'));assert.equal(result(1),undefined);f.quote.resolve();await tick();await tick();}
 assert(result(1));if(nativeFailure){assert(result(1).error);assert.equal(f.installed(),0);}else{assert(result(1).value.quote);assert.equal(f.installed(),1);assert.equal(busy,false);}
 send(5,'close');await tick();await tick();assert.equal(result(5)?.value,true);
}
for(const nativeFailure of [false,true])test('actual worker overlaps opening reads, blocks duplicates and drains '+(nativeFailure?'failed':'successful')+' native startup',()=>workerOpeningFixture({nativeFailure}));

}
