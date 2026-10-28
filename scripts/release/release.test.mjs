import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {sha256,sealBundle,verifyBundle,checkPublicAssets,assertCompatibleChanges} from './bundle.mjs';
import {releaseCandidate,rollbackRelease,replaceLink} from './pipeline.mjs';
import {validateJourneyConfig,createTestWalletBridge} from './journey.mjs';
import {reuseCandidate} from './prepare.mjs';
import {runtimeIdentity,stageRuntimeIdentity} from './compatibility.mjs';
import {checkRuntime} from './smoke.mjs';
import {releaseRestrictions,releaseJobUnit} from './install-job.mjs';
import {pruneReleases} from './prune.mjs';

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
test('release job sandbox blocks metadata and confines writes; injected unit paths are rejected',()=>{
 const cfg={releaseDirectory:'/opt/rolling-releases',stagingLink:'/opt/rolling-stage/current',liveLink:'/opt/rolling-app/current',stateFile:'/var/lib/rolling-ops/release-state.json',nodeBinary:'/opt/node/bin/node'};
 const unit=releaseRestrictions(cfg,'/var/lib/rolling-release-job');assert.match(unit,/User=rolling-release/);assert.match(unit,/IPAddressDeny=169\.254\.169\.254\/32/);assert.match(unit,/IPAddressDeny=fd00:ec2::254\/128/);assert.match(unit,/ProtectSystem=strict/);assert.match(unit,/AWS_SHARED_CREDENTIALS_FILE=\/dev\/null/);assert.match(unit,/job-preflight\.mjs/);assert(!unit.includes('ReadWritePaths=\/etc'));
 assert.throws(()=>releaseRestrictions({...cfg,nodeBinary:'/bin/node\nUser=root'},'/var/lib/rolling-release-job'),{code:'RELEASE_CONFIG'});
});
test('separate stage signer is pinned while every other contract field remains identical',()=>{
 const live={proofsEnabled:true,remoteProver:{proofsEnabled:true},config:{network:{chainId:'11155111',rollupAddress:'rollup',rollupVersion:'6'},board:{contractAddress:'board'},privateFee:{contractAddress:'fee'},bok:{contractAddress:'bok'},aggregateFunding:{router:'router',usdcRelayAddress:'0x'+'1'.repeat(40)}}};
 const stage=structuredClone(live);stage.config.aggregateFunding.usdcRelayAddress='0x'+'2'.repeat(40);assert.equal(stageRuntimeIdentity(live,stage),runtimeIdentity(stage));assert.notEqual(runtimeIdentity(live),runtimeIdentity(stage));
 stage.config.aggregateFunding.router='other';assert.throws(()=>stageRuntimeIdentity(live,stage),{code:'RELEASE_STAGE_CONTRACT_CHANGED'});
});
test('smoke checks actual hash-pinned wallet URLs and catches a stale edge cache',async t=>{
 const f=await setup(t),manifest=(await verifyBundle(f.candidate)).manifest;manifest.publicFiles['/wallet/runtime.mjs']='index.html';let stale=true,observed=false;
 const server=http.createServer((req,res)=>{const pinned=req.url==='/wallet/runtime.mjs?sha256='+manifest.files['index.html'].sha256;if(pinned)observed=true;res.writeHead(200);res.end(pinned&&stale?'stale':'candidate');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const origin='http://127.0.0.1:'+server.address().port;
 await assert.rejects(checkPublicAssets(origin,manifest),{code:'RELEASE_ASSET_BYTES'});assert(observed);stale=false;await checkPublicAssets(origin,manifest);
});
test('retention preserves live, stage, rollback and a newly prepared candidate',async t=>{
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-retention-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 for(const digit of ['1','2','3','4']){const dir=path.join(directory,digit.repeat(40));await fs.mkdir(dir);const file=path.join(dir,'release.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,revision:digit.repeat(40)}));if(digit!=='4')await fs.utimes(file,new Date(1),new Date(1));}
 const liveLink=path.join(directory,'live'),stageLink=path.join(directory,'stage'),stateFile=path.join(directory,'state.json');await fs.symlink(path.join(directory,'2'.repeat(40)),liveLink);await fs.symlink(path.join(directory,'2'.repeat(40)),stageLink);await fs.writeFile(stateFile,JSON.stringify({status:'live',revision:'2'.repeat(40),previousRevision:'1'.repeat(40),updatedAt:new Date(Date.now()-500).toISOString()}));
 const options={directory,liveLink,stageLink,stateFile};await fs.writeFile(stateFile+'.lock','');assert.equal((await pruneReleases(options)).reason,'release-active');await fs.rm(stateFile+'.lock');assert.equal((await pruneReleases(options)).removed,1);
 for(const digit of ['1','2','4'])assert((await fs.stat(path.join(directory,digit.repeat(40)))).isDirectory());await assert.rejects(fs.stat(path.join(directory,'3'.repeat(40))),{code:'ENOENT'});
});

test('fixed host job rejects non-master or superseded source; git has no credential or hook path',async()=>{
 const {assertMasterRevision,gitOptions,REPOSITORY}=await import('./host-job.mjs');
 assertMasterRevision(revision,revision+'\trefs/heads/master\n');
 for(const value of [oldRevision+'\trefs/heads/master',revision+'\trefs/heads/feature',revision+'\trefs/heads/master\n'+oldRevision+'\trefs/heads/master'])assert.throws(()=>assertMasterRevision(revision,value),{code:'RELEASE_SUPERSEDED'});
 assert.equal(REPOSITORY,'https://github.com/zac-williamson/aztec_experiments.git');
 assert(gitOptions().includes('core.hooksPath=/dev/null'));assert(gitOptions().includes('credential.helper='));assert(gitOptions().includes('protocol.allow=never'));
});
test('release transport has an exact environment trust and parameterless command with no arbitrary execution grant',async()=>{
 const template=JSON.parse(await fs.readFile(new URL('./oidc-template.json',import.meta.url),'utf8'));
 const role=template.Resources.ReleaseRole.Properties,trust=role.AssumeRolePolicyDocument.Statement[0];
 assert.deepEqual(trust.Condition.StringEquals,{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':'repo:zac-williamson/aztec_experiments:environment:rolling-testnet-release'});
 const statements=role.Policies[0].PolicyDocument.Statement;assert.deepEqual(statements.map(x=>x.Action),['ssm:SendCommand','ssm:GetCommandInvocation']);assert.equal(statements[0].Resource.length,2);assert(!statements[0].Resource.includes('*'));
 const doc=template.Resources.ReleaseCommand.Properties.Content;assert.deepEqual(doc.parameters,{});assert.equal(doc.mainSteps.length,1);assert(doc.mainSteps[0].inputs.runCommand.includes('/usr/bin/systemctl start --wait rolling-release-job.service'));
 const unit=releaseJobUnit({releaseDirectory:'/opt/rolling-releases',stagingLink:'/opt/rolling-stage/current',liveLink:'/opt/rolling-release-live/current',stateFile:'/var/lib/rolling-release-state/state.json',nodeBinary:'/opt/rolling-ops/runtime/node'});
 assert.match(unit,/MemoryMax=8G/);assert.match(unit,/CPUQuota=200%/);assert.match(unit,/TasksMax=512/);assert.match(unit,/Type=oneshot/);assert.match(unit,/host-job\.mjs/);assert(!unit.includes('actions.runner'));assert(!unit.includes('[Install]'));
});

test('gasless wallet bridge refuses even a zero-value transaction requiring gas',async()=>{
 const wallet={address:'0x'+'1'.repeat(40),sendTransaction:()=>{throw Error('must never sign');}},target='0x'+'2'.repeat(40);
 const bridge=await createTestWalletBridge({wallet,provider:{},allowedTargets:new Set([target]),capWei:0n,getBytes:x=>x});
 await assert.rejects(bridge({method:'eth_sendTransaction',params:[{from:wallet.address,to:target,gas:'0x5208',gasPrice:'0x1',value:'0x0'}]}),{code:'RELEASE_FIXTURE_SPEND_LIMIT'});
});

test('sanitized candidates built with private permissions become readable to separate app users',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-readable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const nested=path.join(root,'wallet');await fs.mkdir(nested,{mode:0o700});await fs.writeFile(path.join(nested,'runtime.mjs'),'public bytes',{mode:0o600});
 const {makeRuntimeReadable}=await import('./prepare.mjs');await makeRuntimeReadable(root);
 assert.equal((await fs.stat(nested)).mode&0o777,0o755);assert.equal((await fs.stat(path.join(nested,'runtime.mjs'))).mode&0o777,0o644);
 await fs.symlink('/etc/passwd',path.join(root,'unexpected'));await assert.rejects(makeRuntimeReadable(root),{code:'RELEASE_SYMLINK'});
});

test('private job umask still permits the dashboard group to read sanitized release state',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-state-mode-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {writeReleaseState}=await import('./pipeline.mjs'),target=path.join(root,'state.json'),old=process.umask(0o077);
 try{await writeReleaseState(target,{status:'checking'});}finally{process.umask(old);}
 assert.equal((await fs.stat(target)).mode&0o777,0o640);
});

test('public sealed manifest stays readable under restrictive root installation umask',async t=>{
 const f=await setup(t),target=path.join(f.root,'umask-baseline');await fs.mkdir(target);await fs.writeFile(path.join(target,'index.html'),'public');const old=process.umask(0o077);
 try{await sealBundle(target,{revision,baseline:oldRevision,compatibility:{test:true},publicFiles:{'/':'index.html'}});}finally{process.umask(old);}
 assert.equal((await fs.stat(path.join(target,'release.json'))).mode&0o777,0o644);
});

test('sealing admits only hash-bound Solidity SDK inputs and rejects executable nested packages',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-sdk-input-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const name='billboard/portal/node_modules/@aztec-foundation/l1-artifacts/l1-contracts/lib/Public.sol';await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),'public solidity');await fs.mkdir(path.join(root,'.build/sdk'),{recursive:true});await fs.writeFile(path.join(root,'.build/sdk/sdk-manifest.json'),JSON.stringify({inputs:{[name]:sha256('public solidity')}}));await fs.writeFile(path.join(root,'index.html'),'public');
 await sealBundle(root,{revision,baseline:oldRevision,compatibility:{test:true},publicFiles:{'/':'index.html'}});await verifyBundle(root);await fs.unlink(path.join(root,'release.json'));
 await fs.writeFile(path.join(root,name),'changed');await assert.rejects(sealBundle(root,{revision,baseline:oldRevision,compatibility:{test:true},publicFiles:{'/':'index.html'}}),{code:'RELEASE_DEPENDENCIES'});
 await fs.writeFile(path.join(root,name),'public solidity');await fs.writeFile(path.join(path.dirname(path.join(root,name)),'execute.js'),'executable');await assert.rejects(sealBundle(root,{revision,baseline:oldRevision,compatibility:{test:true},publicFiles:{'/':'index.html'}}),{code:'RELEASE_PRIVATE_PATH'});
});
