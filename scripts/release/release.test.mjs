import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {sealBundle,verifyBundle,checkPublicAssets,assertCompatibleChanges} from './bundle.mjs';
import {releaseCandidate,rollbackRelease,replaceLink} from './pipeline.mjs';
import {validateJourneyConfig,createTestWalletBridge} from './journey.mjs';
import {reuseCandidate} from './prepare.mjs';
import {runtimeIdentity} from './compatibility.mjs';
import {checkRuntime} from './smoke.mjs';

const oldRevision='1'.repeat(40),revision='2'.repeat(40);
const successful={passed:true,proofs:'real',chainId:'11155111',completed:['signup-ETH','signup-USDC','post','reply','like','reload','bok']};
async function setup(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-release-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const old=path.join(root,'old'),candidate=path.join(root,'candidate');for(const dir of [old,candidate]){await fs.mkdir(dir);await fs.writeFile(path.join(dir,'index.html'),dir===old?'previous':'candidate');}
 const compatibility={board:'same-board',dependencies:null};
 await sealBundle(old,{revision:oldRevision,baseline:'0'.repeat(40),compatibility,publicFiles:{'/':'index.html'}});
 await sealBundle(candidate,{revision,baseline:oldRevision,compatibility,publicFiles:{'/':'index.html'}});
 const liveLink=path.join(root,'current'),stageLink=path.join(root,'staging');await fs.symlink(old,liveLink);await fs.symlink(old,stageLink);
 const calls=[];
 const options={candidate,liveLink,stageLink,stageOrigin:'http://127.0.0.1:8091',liveOrigin:'http://127.0.0.1:8090',stateFile:path.join(root,'state.json'),restartStage:async()=>calls.push('restart-stage'),restartLive:async()=>calls.push('restart-live'),journey:async()=>{calls.push('journey');return successful;},smoke:async(origin,m)=>calls.push('smoke-'+(origin.endsWith('8091')?'stage':'live')+'-'+m.revision)};
 return {root,old,candidate,options,calls};
}

test('failed real-testnet journey never switches live or restarts it',async t=>{
 const f=await setup(t);f.options.journey=async()=>({...successful,completed:successful.completed.filter(x=>x!=='bok')});
 await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_JOURNEY_FAILED'});
 assert.equal(await fs.realpath(f.options.liveLink),f.old);assert(!f.calls.includes('restart-live'));
 assert.equal(JSON.parse(await fs.readFile(f.options.stateFile)).status,'blocked');
});
test('mock proof label cannot qualify a release',async t=>{
 const f=await setup(t);f.options.journey=async()=>({...successful,proofs:'disabled'});await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_JOURNEY_FAILED'});assert.equal(await fs.realpath(f.options.liveLink),f.old);
});
test('successful journey promotes exactly the candidate tested',async t=>{
 const f=await setup(t);const state=await releaseCandidate(f.options);assert.equal(state.status,'live');assert.equal(await fs.realpath(f.options.liveLink),f.candidate);assert.equal(f.calls.indexOf('journey')<f.calls.indexOf('restart-live'),true);
});
test('changed candidate bytes during journey cannot be promoted',async t=>{
 const f=await setup(t);f.options.journey=async()=>{await fs.writeFile(path.join(f.candidate,'index.html'),'different');return successful;};await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_BYTES'});assert.equal(await fs.realpath(f.options.liveLink),f.old);
});
test('another deployment during staging blocks this stale candidate',async t=>{
 const f=await setup(t),other=path.join(f.root,'other');await fs.cp(f.old,other,{recursive:true});f.options.journey=async()=>{await replaceLink(f.options.liveLink,other);return successful;};await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_CHANGED_DURING_TEST'});assert.equal(await fs.realpath(f.options.liveLink),other);
});
test('failed live asset check automatically restores previous bytes and verifies them',async t=>{
 const f=await setup(t);let count=0;f.options.smoke=async(origin,m)=>{if(origin===f.options.liveOrigin){count++;if(m.revision===revision)throw Object.assign(Error(),{code:'RELEASE_ASSET_UNAVAILABLE'});}};
 await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_ASSET_UNAVAILABLE'});assert.equal(await fs.realpath(f.options.liveLink),f.old);assert.equal(count,2);assert.equal(JSON.parse(await fs.readFile(f.options.stateFile)).status,'rolled-back');
});
test('rollback failure is recorded visibly',async t=>{
 const f=await setup(t);f.options.smoke=async(origin)=>{if(origin===f.options.liveOrigin)throw Error();};await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_ROLLBACK_FAILED'});assert.equal(JSON.parse(await fs.readFile(f.options.stateFile)).status,'rollback-failed');
});
test('release lock prevents competing operators',async t=>{
 const f=await setup(t);await fs.writeFile(f.options.stateFile+'.lock','');await assert.rejects(releaseCandidate(f.options),{code:'RELEASE_BUSY'});assert.deepEqual(f.calls,[]);
});
test('explicit same-contract rollback checks the actual previous bundle',async t=>{
 const f=await setup(t);await releaseCandidate(f.options);await rollbackRelease({...f.options,target:f.old});assert.equal(await fs.realpath(f.options.liveLink),f.old);
});
test('operator rollback shares the deployment lock and exposes failed verification',async t=>{
 const f=await setup(t);await fs.writeFile(f.options.stateFile+'.lock','');await assert.rejects(rollbackRelease({...f.options,target:f.old}),{code:'RELEASE_BUSY'});await fs.unlink(f.options.stateFile+'.lock');
 await releaseCandidate(f.options);await assert.rejects(rollbackRelease({...f.options,target:f.old,smoke:async()=>{throw Object.assign(Error(),{code:'RELEASE_ASSET_BYTES'});}}),{code:'RELEASE_ASSET_BYTES'});assert.equal(JSON.parse(await fs.readFile(f.options.stateFile)).status,'rollback-failed');
});
test('retry reuses only a complete candidate for the current exact baseline',async t=>{
 const f=await setup(t),m=(await verifyBundle(f.candidate)).manifest;
 assert.equal(await reuseCandidate(f.candidate,m),true);assert.equal(await reuseCandidate(path.join(f.root,'missing'),m),false);
 await assert.rejects(reuseCandidate(f.candidate,{...m,baseline:'3'.repeat(40)}),{code:'RELEASE_BASELINE_CHANGED'});
 await fs.writeFile(path.join(f.candidate,'index.html'),'partly rebuilt');await assert.rejects(reuseCandidate(f.candidate,m),{code:'RELEASE_BYTES'});
});
test('live smoke binds reader scope and all funding contracts to the tested runtime',async()=>{
 const runtime={proofsEnabled:true,remoteProver:{proofsEnabled:true},config:{network:{chainId:'11155111',rollupAddress:'rollup',rollupVersion:'6',ethRpcUrl:'https://stage.example/rpc'},board:{contractAddress:'board'},privateFee:{contractAddress:'fee'},bok:{contractAddress:'bok'},aggregateFunding:{router:'router'}}};
 const compatibility={chainId:'11155111',rollup:'rollup',rollupVersion:'6',board:'board',runtimeSha256:runtimeIdentity(runtime)};
 let feed={schemaVersion:1,complete:true,scope:{chainId:'11155111',rollupAddress:'rollup',rollupVersion:'6',boardAddress:'board'}};
 const fetcher=async url=>new Response(JSON.stringify(url.endsWith('runtime.json')?runtime:feed),{headers:{'content-type':'application/json'}});
 await checkRuntime('https://live.example',{compatibility},{fetcher});runtime.config.network.ethRpcUrl='https://different.example/rpc';await checkRuntime('https://live.example',{compatibility},{fetcher});
 runtime.config.privateFee.contractAddress='new-fee';await assert.rejects(checkRuntime('https://live.example',{compatibility},{fetcher}),{code:'RELEASE_RUNTIME_CHANGED'});runtime.config.privateFee.contractAddress='fee';
 feed={...feed,complete:false};await assert.rejects(checkRuntime('https://live.example',{compatibility},{fetcher}),{code:'RELEASE_API_INVALID'});
});
test('manifest rejects symlinks, untracked files and changed bytes',async t=>{
 const f=await setup(t);await fs.symlink('/etc/passwd',path.join(f.candidate,'leak'));await assert.rejects(verifyBundle(f.candidate),{code:'RELEASE_SYMLINK'});await fs.unlink(path.join(f.candidate,'leak'));await fs.writeFile(path.join(f.candidate,'extra'),'untracked');await assert.rejects(verifyBundle(f.candidate),{code:'RELEASE_INVENTORY'});
});
test('HTTP verification rejects wrong bytes and missing assets rather than a green homepage',async t=>{
 const f=await setup(t),m=(await verifyBundle(f.candidate)).manifest;let wrong=true;
 const server=http.createServer((req,res)=>{res.writeHead(200);res.end(wrong?'wrong':'candidate');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const origin='http://127.0.0.1:'+server.address().port;
 await assert.rejects(checkPublicAssets(origin,m),{code:'RELEASE_ASSET_BYTES'});wrong=false;assert.equal((await checkPublicAssets(origin,m)).assetCount,1);
});
test('contract, dependency and prover changes require a different deployment path',()=>{
 for(const name of ['billboard/rolling_contract/src/main.nr','billboard/portal/src/Router.sol','package-lock.json','prover/application-policy.mjs'])assert.throws(()=>assertCompatibleChanges([name]),{code:'RELEASE_REQUIRES_CONTRACT_OR_RUNTIME_DEPLOYMENT'});
 assert.doesNotThrow(()=>assertCompatibleChanges(['apps/rolling/wallet-panel.mjs','scripts/rolling-public-server.mjs']));
});
test('test fixture cannot use same origin, mainnet-like arbitrary cap or public file fields',()=>{
 const cfg={stagingOrigin:'https://stage.example',liveOrigin:'https://live.example',ethereumRpc:'https://rpc.example',testFunderKey:'0x'+'1'.repeat(64),ethPerAccountWei:'1000000000000000',usdcPerAccount:'2000000',timeoutMs:540000,testOnly:true};assert.equal(validateJourneyConfig(cfg),cfg);
 for(const patch of [{stagingOrigin:cfg.liveOrigin},{testOnly:false},{ethPerAccountWei:'1000000000000000000'},{walletAddress:'identity'}])assert.throws(()=>validateJourneyConfig({...cfg,...patch}));
});
test('test wallet signs only Sepolia fixture targets and rejects unbounded transfers',async()=>{
 const wallet={address:'0x'+'1'.repeat(40),signTypedData:async()=> 'signed',sendTransaction:async()=>({hash:'sent'})};const target='0x'+'2'.repeat(40);const bridge=await createTestWalletBridge({wallet,provider:{send:async()=>null},allowedTargets:new Set([target]),capWei:100n,getBytes:x=>x});
 await assert.rejects(bridge({method:'wallet_switchEthereumChain',params:[{chainId:'0x1'}]}),{code:'RELEASE_NETWORK'});
 await assert.rejects(bridge({method:'eth_sendTransaction',params:[{from:wallet.address,to:target,gas:'0x1',gasPrice:'0x1',value:'0x100'}]}),{code:'RELEASE_FIXTURE_SPEND_LIMIT'});
 await assert.rejects(bridge({method:'eth_signTypedData_v4',params:[wallet.address,JSON.stringify({domain:{chainId:1,verifyingContract:target},types:{}})]}),{code:'RELEASE_NETWORK'});
});
test('GitHub baseline gate binds trusted workflow success to exact source and rejects newer failure',async()=>{
 const {acceptBaseline}=await import('./github-build.mjs');
 const run={id:1,head_sha:revision,head_branch:'master',event:'push',head_repository:{full_name:'zac-williamson/aztec_experiments'},status:'completed',conclusion:'success'};
 assert.equal(acceptBaseline([run],revision),1);
 for(const patch of [{head_sha:oldRevision},{event:'pull_request'},{conclusion:'failure'},{status:'in_progress'},{head_repository:{full_name:'someone/fork'}}])assert.throws(()=>acceptBaseline([{...run,...patch}],revision),{code:'RELEASE_BASELINE_CHECK'});
 assert.throws(()=>acceptBaseline([run,{...run,id:2,conclusion:'failure'}],revision));
});
