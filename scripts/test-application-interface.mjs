import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {mentions,handleField,packText} from '../plugins/protocol.mjs';
import {prepareInvocation} from '../plugins/client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(new URL('../shared/application.js',import.meta.url),'utf8');
function fixture(kind='author') {
 let configuration=0,fail=false,result={state:'postable'},subscriber;
 const calls=[],state={aztec:{address:{toString:()=> '1'},secretKey:'private',salt:'salt',raw:{secretKey:'private'}}};
 const saved=new Map();const ctx={structuredClone,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},crypto,TextEncoder,publicOperationFailure:e=>e,window:{BillboardPlugins:{mentions:()=>[]},walletState:state,billboardConfigStore:{subscribe:f=>subscriber=f},__aztec:{NO_FROM:0},BillboardPublic:{readFeed:async()=>({posts:[]})}},
  BILLBOARD_ARTIFACT:{},PORTAL_BYTECODE:'',BILLBOARD_PRIVATE_FEE_ARTIFACT:{},_getConfigRevision:()=>configuration,_getPublicConfig:()=>({board:{portalAddress:'portal'},network:{},remoteProver:{url:'https://prover.test'}}),_walletGeneration:0,
  _assertWalletLive:()=>{if(state.invalidated)throw Error('invalidated');},_invalidateWalletContext:()=>state.invalidated=true,
  makeClaimSecretStore:()=>({}),extractInt:v=>v,readBillboardDepositInfo:async()=>({amount:1n,depositChainId:2n}),getL2Timestamp:async()=>100,
  makeCallEngine:()=>async(action,progress,input)=>{calls.push({action,input});progress('Working','info');if(fail)throw Error('failed');return result;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../shared/operation-state.js',import.meta.url),'utf8'),ctx);ctx.window.BillboardOperations=ctx.BillboardOperations;ctx.window.BillboardProving={snapshot:()=> 'remote'};vm.runInContext(source,ctx);
 return {api:ctx.createBillboardApplication({kind}),ctx,calls,state,setResult:r=>result=r,fail:()=>fail=true,change:()=>{configuration++;subscriber();}};
}
test('interface hides SDK objects and owns acknowledgements and withdrawal state',async()=>{
 const f=fixture();const privateHandles={wallet:{secretKey:'private'}};
 f.setResult({state:'postable',handles:privateHandles,receipt:{sdk:true},lastL2TxHash:'tx',lastEthereumTxHash:'eth',withdrawTxHash:'withdraw'});
 const messages=[],data=await f.api.run('status',{},(...args)=>messages.push(args));
 assert(!('handles'in data));assert(!('receipt'in data));assert.deepEqual(messages,[['Working','info']]);
 await f.api.run('post',{message:'hello'});assert.equal(f.calls[1].input.acknowledgeTx,'tx');assert.equal(f.calls[1].input.acknowledgeEthereumTx,'eth');assert.equal(f.calls[1].input.withdrawTxHash,'withdraw');
 assert.equal(f.api.connected,true);f.change();assert.equal(f.api.connected,false);
 f.setResult({});await f.api.run('status');assert.equal(f.calls[2].input.acknowledgeTx,undefined);
});
test('failed operations do not acknowledge a new transaction',async()=>{
 const f=fixture();f.setResult({lastL2TxHash:'confirmed'});await f.api.run('post',{message:'test'});f.fail();await assert.rejects(f.api.run('post',{message:'test'}));assert.equal(f.calls[1].input.acknowledgeTx,'confirmed');
});
test('public feed remains readable after wallet disconnect',async()=>{const f=fixture();f.state.invalidated=true;assert.equal((await f.api.readFeed()).posts.length,0);});
test('reads expose deposit values and chain time without a node or contract',async()=>{
 const f=fixture();f.setResult({handles:{contract:{},address:'1'}});await f.api.run('status');
 const info=await f.api.readDeposit();assert.equal(info.chainTime,100);assert.equal(info.depositChainId,2n);assert(!('contract'in info));
});
test('account and application modules do not read DOM; transaction pages do not use private handles',()=>{
 const account=fs.readFileSync(new URL('../shared/account.js',import.meta.url),'utf8');assert.doesNotMatch(account,/document\./);assert.doesNotMatch(source,/document\./);
 for(const path of ['billboard/user','billboard/censor','fee-juice']){const ui=fs.readFileSync(new URL('../apps/src/'+path+'/app.js',import.meta.url),'utf8');assert.doesNotMatch(ui,/walletState|\.contract\.methods|\.handles|journalAcknowledgements|ethereumAcknowledgements/);}
 const env=fs.readFileSync(new URL('../shared/app-env.js',import.meta.url),'utf8');assert.doesNotMatch(env,/getElementById\('deploymentManifest'\)/);
});

test('public JSDoc interfaces typecheck with the lockfile compiler',()=>{
 execFileSync(process.execPath,[createRequire(import.meta.url).resolve('typescript/bin/tsc'),'--allowJs','--checkJs','--noImplicitAny','false','--noEmit','--skipLibCheck','--target','es2022','--types','node','shared/application.js','shared/account.js','scripts/application-type-environment.d.ts'],{cwd:fileURLToPath(new URL('../',import.meta.url)),timeout:10000,stdio:'pipe'});
});

test('an operation completed after a configuration change cannot acknowledge its result',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>release=resolve);
 f.ctx.makeCallEngine=()=>async()=>{await gate;return {lastL2TxHash:'stale',handles:{}};};
 const api=f.ctx.createBillboardApplication({kind:'author'});const pending=api.run('post',{message:'test'});f.change();release();
 await assert.rejects(pending,/configuration changed/);assert.equal(api.connected,false);
});

test('deployment settings export uses the captured manifest, never a later edited one',async()=>{
 const f=fixture('deploy');f.ctx.window.BillboardConfig={validate:value=>value};
 const api=f.ctx.createBillboardApplication({kind:'deploy',deploymentConfig:()=>{throw Error('Later edited manifest must not be read');}});
 const network={nodeUrl:'old-node',ethRpcUrl:'old-eth',chainId:'1',rollupVersion:'5',rollup:'old-rollup'};
 const config=await api.publicConfiguration({portalAddr:'0xABC',l2Addr:'0xDEF'},null,{network});
 assert.equal(config.network.nodeUrl,'old-node');assert.equal(config.network.rollupAddress,'old-rollup');assert.equal(config.board.contractAddress,'0xdef');
});

for(const initial of ['zero_balance_need_deposit','deposited_l1_not_claimed_l2','postable'])test(`funding completes ${initial} without a second UI action`,async()=>{
 const f=fixture(),actions=[];
 f.ctx.makeCallEngine=()=>async(action)=>{actions.push(action);return {state:action==='status'?initial:action==='deposit'?'deposited_l1_not_claimed_l2':'postable'};};
 const api=f.ctx.createBillboardApplication();
 const result=await api.completeDeposit({depositAmount:'0.01'});
 assert.equal(result.state,'postable');
 assert.deepEqual(actions,initial==='postable'?['status']:initial==='zero_balance_need_deposit'?['status','deposit','claim']:['status','claim']);
});
test('duplicate funding requests share one operation and a failed claim never sends another deposit',async()=>{
 const f=fixture(),actions=[];let release,paid=false,fail=true;const gate=new Promise(r=>release=r);
 f.ctx.makeCallEngine=()=>async(action)=>{actions.push(action);if(action==='status'){await gate;return {state:paid?'deposited_l1_not_claimed_l2':'zero_balance_need_deposit'};}if(action==='deposit'){paid=true;return {};}if(fail)throw Object.assign(Error('missing'),{code:'BB_CLAIM_SECRET_MISSING'});return {state:'postable'};};
 const api=f.ctx.createBillboardApplication();const first=api.completeDeposit({depositAmount:'0.01'}),second=api.completeDeposit({depositAmount:'0.02'});assert.equal(first,second);release();
 await assert.rejects(first,{code:'BB_CLAIM_SECRET_MISSING'});fail=false;await api.completeDeposit();assert.deepEqual(actions,['status','deposit','claim','status','claim']);
});
test('configuration change after payment stops automatic continuation',async()=>{
 const f=fixture(),actions=[];let api;
 f.ctx.makeCallEngine=()=>async(action)=>{actions.push(action);if(action==='deposit')f.change();return {state:'zero_balance_need_deposit'};};
 api=f.ctx.createBillboardApplication();await assert.rejects(api.completeDeposit({depositAmount:'0.01'}));assert.deepEqual(actions,['status','deposit']);
});

test('progress callback cannot switch the board before claim starts',async()=>{
 const f=fixture(),actions=[];f.ctx.makeCallEngine=()=>async action=>{actions.push(action);return {state:'deposited_l1_not_claimed_l2'};};
 const api=f.ctx.createBillboardApplication();await assert.rejects(api.completeDeposit({},message=>{if(message.startsWith('Deposit confirmed'))f.change();}));assert.deepEqual(actions,['status']);assert.equal(api.fundingState,null);
});

test('progress subscribers cannot interrupt transactions or receive private inputs',async()=>{
 const f=fixture();f.api.subscribe(()=>{throw Error('render failure');});
 await f.api.run('post',{message:'private-draft-test'});assert.equal(f.calls.length,1);
 const report=f.api.diagnosticReport();assert(!report.includes('private-draft-test'));assert(!report.includes('private'));assert.equal(f.api.operation().status,'complete');
});
test('a proving preference change only affects a future operation',async()=>{
 const f=fixture();let mode='remote',release;f.ctx.window.BillboardProving.snapshot=()=>mode;
 const gate=new Promise(resolve=>release=resolve),seen=[];
 f.ctx.makeCallEngine=()=>async(action,_log,input)=>{seen.push(input.provingMode);if(action==='status'){await gate;return {state:'zero_balance_need_deposit'};}return {state:'postable'};};
 const api=f.ctx.createBillboardApplication();const pending=api.completeDeposit({depositAmount:'0.01'});mode='local';release();await pending;
 assert.deepEqual(seen,['remote','remote','remote']);await api.run('status');assert.equal(seen.at(-1),'local');
});
test('another workflow cannot break ownership of an active onboarding operation',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>release=resolve);f.ctx.makeCallEngine=()=>async()=>{await gate;return {state:'postable'};};
 const api=f.ctx.createBillboardApplication();const pending=api.completeDeposit();assert.throws(()=>api.completeWithdrawal(),{code:'BB_OPERATION_BUSY'});await assert.rejects(api.run('post',{message:'hello'}),{code:'BB_OPERATION_BUSY'});release();await pending;
});
test('message validation rejects oversized UTF-8 before reaching the engine',async()=>{
 const f=fixture();await assert.rejects(f.api.run('post',{message:'🙂'.repeat(249)}),{code:'BB_MESSAGE_LONG'});assert.equal(f.calls.length,0);
});

test('a board without a remote endpoint reports the actual local mode',async()=>{const f=fixture();f.ctx._getPublicConfig=()=>({board:{portalAddress:'portal'},network:{}});await f.api.run('status');assert.equal(f.api.operation().mode,'local');});
test('operation receipts whitelist public results and preserve the failed phase',async()=>{const f=fixture();f.setResult({lastL2TxHash:'hash',handles:{secretKey:'private'},secret:'hidden'});await f.api.run('post',{message:'hello'});assert.equal(f.api.operation().result.lastL2TxHash,'hash');assert(!JSON.stringify(f.api.operation()).includes('private'));const state=f.ctx.BillboardOperations.create();state.begin('post','remote');state.progress('proving');state.fail({code:'BB_REMOTE_PROVER_OFFLINE',message:'unavailable'});assert.equal(JSON.parse(state.report()).stage,'proving');});
for(const scenario of ['fresh','consumed','pending','resume-missing'])test('fee funding application sequence: '+scenario,async()=>{const f=fixture('fees'),actions=[],stored=new Map();f.ctx.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};f.ctx.ethers={parseEther:v=>BigInt(v)};f.ctx.window.BillboardConfig={maximumFee:()=>1n};f.ctx.makeCallEngine=()=>async(action)=>{actions.push(action);if(action==='recover-eth'){if(['fresh','resume-missing'].includes(scenario))throw {code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'};return {outcome:'funded',claimConsumed:scenario==='consumed',record:{schema:'private-fee-funding-v1',chainId:'1',version:'1',rollupAddress:'rollup',portalAddress:'portal',tokenAddress:'token',privateFeeAddress:'fee',sender:'sender',nonce:0,amount:'2'}};}if(action==='recover-l2')throw {code:'BB_NO_SAVED_TRANSACTION'};return {};};const app=f.ctx.createBillboardApplication({kind:'fees'});if(scenario==='resume-missing')await assert.rejects(app.completeFeeFunding({resumeOnly:true}),{code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'});else await app.completeFeeFunding({depositAmount:'2'});assert.deepEqual(actions,scenario==='fresh'?['recover-eth','deposit','claim','balance']:scenario==='consumed'?['recover-eth','recover-l2','deposit','claim','balance']:scenario==='pending'?['recover-eth','claim','balance']:['recover-eth']);});
test('Activity acknowledges only canonical outcomes from its journal interface',async()=>{for(const correct of [true,false]){const f=fixture();const sdk=f.ctx.window.__aztec,hash='0x'+'1'.repeat(64),scope={network:{chainId:'1',rollupVersion:'1',rollupAddress:'rollup'},board:{contractAddress:'board',portalAddress:'portal'}};f.ctx._getPublicConfig=()=>scope;sdk.createBrowserJournalStorage=()=>({});sdk.createL2Journal=async()=>({inspectOutcome:async()=>({operation:JSON.stringify({kind:'post'}),txHash:hash,outcome:correct?'success':'pending',receipt:correct?{transactionFee:5n}:null})});sdk.TxHash={fromString:v=>v};f.setResult({handles:{aztecNode:{getTxReceipt:async()=>({status:'checkpointed',txHash:correct?hash:'other',executionResult:'success',blockNumber:1,blockHash:'canonical',transactionFee:5n}),getBlock:async()=>({hash:'canonical'})}}});await f.api.run('status');const rows=await f.api.readActivity();assert.equal(rows[0].status,correct?'confirmed':'pending');await f.api.run('post',{message:'new'});assert.equal(f.calls.at(-1).input.acknowledgeTx,correct?hash:undefined);}});
test('explicit onboarding Resume recovers its fee scope and original reviewed deposit amount',async()=>{const f=fixture(),inputs=[];let attempts=0;f.ctx.makeCallEngine=()=>async(action,_log,input)=>{inputs.push({action,input});if(action==='status')return {state:'zero_balance_need_deposit'};if(action==='deposit'&&attempts++===0)throw {code:'PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN',phase:'fee-funding'};return {state:'postable'};};const app=f.ctx.createBillboardApplication();await assert.rejects(app.completeDeposit({depositAmount:'0.00001'}));await app.resume();assert.deepEqual(inputs.map(x=>x.action),['status','deposit','status','deposit','claim']);assert.equal(inputs[3].input.retryEthereum,true);assert.equal(inputs[3].input.depositAmount,'0.00001');});

import * as realEthers from 'ethers';
import {validateDeploymentManifest} from '../shared/deployment-manifest.mjs';
test('guided deployment prepares a validated, scoped manifest without sending transactions',async()=>{
 const f=fixture('deploy'),field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
 const network={nodeUrl:'https://node.test/',ethRpcUrl:'https://ethereum.test/',chainId:'11155111',rollupVersion:'5',rollupAddress:address(1)};
 f.ctx.ethers=realEthers;f.ctx.PORTAL_BYTECODE='0x12';f.ctx.window.BillboardAccount={snapshot:()=>({address:field(2),ethereumAddress:address(3),ethereumConnected:true})};f.ctx.window.loadHostedSettings=async()=>({network});
 f.ctx.window.BillboardPublic.metadata={classId:field(4)};Object.assign(f.ctx.window.__aztec,{validateDeploymentManifest,portalRuntimeMetadata:{},Fr:{random:()=>({toBigInt:()=>9n})},createAztecNodeClient:()=>({getNodeInfo:async()=>({l1ChainId:11155111,rollupVersion:5,l1ContractAddresses:{rollupAddress:address(1),inboxAddress:address(5),outboxAddress:address(6)}})})});
 const board={minDeposit:'0.000001',maxDeposit:'0.00001',baseCooldown:'60',kMultiplier:'4',censorWindow:'3600',maxSaveUp:'2',censor:field(7),policy:'No threats.'};
 const result=await f.api.prepareDeployment(board);assert.equal(result.manifest.board.minDeposit,'1000000000000');assert.equal(result.manifest.actors.ethereumDeployer,address(3));assert.equal(f.calls.length,0);
 for(const change of [{minDeposit:'1',maxDeposit:'0.1'},{baseCooldown:'1.5'},{policy:'🙂'.repeat(373)}])await assert.rejects(f.api.prepareDeployment({...board,...change}));
 const loader=f.ctx.window.__aztec.createAztecNodeClient;f.ctx.window.__aztec.createAztecNodeClient=()=>({getNodeInfo:async()=>{const info=await loader().getNodeInfo();info.l1ChainId=1;return info;}});await assert.rejects(f.api.prepareDeployment(board),{code:'BB_CONNECTION_VERIFICATION_FAILED'});assert.equal(f.calls.length,0);
});
test('moderator recovery review is invalidated by a newer review or configuration change',async()=>{
 const f=fixture('moderator'),sdk=f.ctx.window.__aztec,hash='0x'+'1'.repeat(64),version='1';f.ctx._getPublicConfig=()=>({network:{chainId:'1',rollupVersion:'1',rollupAddress:'rollup'},board:{contractAddress:'board',portalAddress:'portal'}});
 sdk.createBrowserJournalStorage=()=>({});sdk.createL2Journal=async()=>({inspectOutcome:async()=>({operation:'["transfer_censor",["3"]]',txHash:hash,outcome:'pending'}),inspect:async()=>({operation:'["transfer_censor",["3"]]',txHash:hash})});sdk.TxHash={fromString:v=>v};f.ctx.window.unpackFieldsToString=()=> 'rules';f.ctx.window.BillboardModerationCodec={restoreModeratorOperation:()=>({action:'transfer-censor',newCensor:'3'})};
 const methods={get_censor:()=>({simulate:async()=>1n}),get_k_multiplier:()=>({simulate:async()=>4}),get_moderation_policy_snapshot:()=>({simulate:async()=>({result:[[],0,version]})})};
 f.setResult({handles:{address:{toString:()=> '1'},contract:{methods},aztecNode:{getTxReceipt:async()=>({status:'dropped',txHash:hash})}}});await f.api.run('status');const first=await f.api.readModeratorRecovery(),second=await f.api.readModeratorRecovery();assert.throws(()=>f.api.resumeModeratorRecovery(first.id),{code:'BB_MODERATOR_REVIEW_CHANGED'});const before=f.calls.length;f.change();assert.throws(()=>f.api.resumeModeratorRecovery(second.id,true),{code:'BB_MODERATOR_REVIEW_CHANGED'});assert.equal(f.calls.length,before);
});

test('withdrawal keeps one owner across settlement and passes the reviewed fee budget',async()=>{
 const f=fixture(),actions=[];let wake,settlementChecks=0;
 f.ctx.setTimeout=resolve=>{wake=resolve;};f.ctx.window.BillboardConfig={maximumFee:()=>7n};
 f.ctx.readBillboardDepositInfo=async()=>({amount:10n,depositChainId:2n,lastRealPostIndex:0n,lastScreenedIndex:0n,nextAllowedTime:0n});
 f.ctx.makeCallEngine=()=>async(action,_log,input)=>{actions.push({action,input});if(action==='status')return {state:'postable',handles:{contract:{},address:'1'}};if(action==='withdraw')return {withdrawTxHash:'l2'};if(settlementChecks++===0)throw {code:'BB_SETTLEMENT_PENDING'};return {refundAmount:'10',refundRecipient:'recipient',lastEthereumTxHash:'refund'};};
 const api=f.ctx.createBillboardApplication();await api.run('status');const plan=await api.readWithdrawalPlan(),pending=api.completeWithdrawal(plan);
 for(let spin=0;!wake&&spin<100;spin++)await Promise.resolve();assert(wake,'Settlement did not reach its waiting boundary');assert.equal(api.completeWithdrawal(plan),pending);assert.equal(api.operation().stage,'settlement');assert.equal(api.operation().status,'waiting');await assert.rejects(api.run('post',{message:'hello'}),{code:'BB_OPERATION_BUSY'});
 wake();const receipt=await pending;assert.equal(receipt.refundAmount,'10');assert.equal(api.operation().status,'complete');assert.deepEqual(actions.map(x=>x.action),['status','status','withdraw','claim-l1','claim-l1']);const withdrawal=actions.find(x=>x.action==='withdraw');assert.equal(withdrawal.input.maximumCreditSpend,'7');assert.equal(withdrawal.input.maxScreeningSteps,0);
});
test('pausing settlement preserves the withdrawal and never requests another refund',async()=>{
 const f=fixture(),actions=[];let wake;f.ctx.setTimeout=resolve=>{wake=resolve;};
 f.ctx.makeCallEngine=()=>async action=>{actions.push(action);if(action==='status')return {state:'withdrawal_needs_verification'};throw {code:'BB_SETTLEMENT_PENDING'};};
 const api=f.ctx.createBillboardApplication(),pending=api.completeWithdrawal();for(let spin=0;!wake&&spin<100;spin++)await Promise.resolve();assert(wake,'Settlement did not reach its waiting boundary');assert.equal(api.requestPause(),true);wake();await assert.rejects(pending,{code:'BB_OPERATION_PAUSED'});assert.equal(api.operation().status,'paused');assert.deepEqual(actions,['status','claim-l1']);
});
test('gas quote estimates the selected deposit without signing and disposes stale reads',async()=>{
 const f=fixture();let disposed=0,request;
 f.ctx.window.BillboardAccount={snapshot:()=>({ethereumConnected:true,ethereumAddress:'0x'+'1'.repeat(40)})};f.ctx._getPublicConfig=()=>({network:{ethRpcUrl:'https://eth.test'},board:{portalAddress:'0x'+'2'.repeat(40)}});
 f.ctx.ethers={...realEthers,JsonRpcProvider:class{async estimateGas(value){request=value;return 50000n;}async getFeeData(){return {maxFeePerGas:3n};}destroy(){disposed++;}}};
 const quote=await f.api.estimateDepositGas('0.00001');assert.equal(quote.maximumGasCost,300000n);assert.equal(request.value,10000000000000n);assert.equal(request.from,'0x'+'1'.repeat(40));assert.equal(f.calls.length,0);assert.equal(disposed,1);
 f.ctx.ethers.JsonRpcProvider=class{async estimateGas(){f.change();return 50000n;}async getFeeData(){return {maxFeePerGas:3n};}destroy(){disposed++;}};
 await assert.rejects(f.api.estimateDepositGas('0.00001'),/configuration changed/);assert.equal(disposed,2);
});

test('standalone fee balance uses a read operation without replacing completed progress',async()=>{
 const f=fixture('fees');f.setResult({feeBalance:'42'});await f.api.run('status');const id=f.api.operation().id;
 assert.equal(await f.api.readFeeBalance(),42n);assert.equal(f.calls.at(-1).action,'balance');assert.equal(f.api.operation().id,id);assert.equal(f.api.operation().status,'complete');
});
test('Ethereum refund recovery returns its verified receipt without restarting onboarding',async()=>{
 const f=fixture(),calls=[];f.ctx.makeCallEngine=()=>async action=>{calls.push(action);if(action==='claim-l1')throw {code:'BB_ETH_SUBMISSION_UNKNOWN'};return {refundAmount:'10',refundRecipient:'recipient',lastEthereumTxHash:'refund'};};const api=f.ctx.createBillboardApplication();await assert.rejects(api.run('claim-l1'));const result=await api.resume();assert.equal(result.refundAmount,'10');assert.deepEqual(calls,['claim-l1','recover-eth']);
});

test('top-up retains ownership through balance refresh and cannot start a second payment',async()=>{
 const f=fixture('fees');f.ctx.ethers={parseEther:()=>3n};f.ctx.window.BillboardConfig={maximumFee:()=>1n};let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),calls=[];
 f.ctx.makeCallEngine=()=>async action=>{calls.push(action);if(action==='recover-eth')throw {code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'};if(action==='balance'){entered();await gate;return {feeBalance:'42'};}return {state:'funded'};};
 const api=f.ctx.createBillboardApplication({kind:'fees'}),first=api.completeFeeFunding({depositAmount:'3'});await ready;assert.equal(api.operation().status,'working');assert.equal(api.operation().stage,'syncing');assert.equal(api.completeFeeFunding({depositAmount:'9'}),first);await assert.rejects(api.run('deposit',{depositAmount:'9'}),{code:'BB_OPERATION_BUSY'});release();assert.equal((await first).feeBalance,'42');assert.equal(api.operation().status,'complete');assert.deepEqual(calls,['recover-eth','deposit','claim','balance']);
});
test('balance unavailability does not reclassify a confirmed top-up as failed',async()=>{
 const f=fixture('fees');f.ctx.ethers={parseEther:()=>3n};f.ctx.window.BillboardConfig={maximumFee:()=>1n};f.ctx.makeCallEngine=()=>async action=>{if(action==='recover-eth')throw {code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'};if(action==='balance')throw Error('network unavailable');return {lastL2TxHash:'confirmed'};};const api=f.ctx.createBillboardApplication({kind:'fees'}),result=await api.completeFeeFunding({depositAmount:'3'});assert.equal(result.lastL2TxHash,'confirmed');assert.equal(result.feeBalance,null);assert.equal(api.operation().status,'complete');
});

// Use the shipped Noir artifact so the adapter cannot silently pass an unnormalized ABI.
test('author balance read normalizes the raw contract ABI at the SDK boundary',async()=>{
 const f=fixture(),raw=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url)));
 f.ctx.BILLBOARD_PRIVATE_FEE_ARTIFACT=raw;f.ctx.extractBigInt=BigInt;f.ctx._getPublicConfig=()=>({board:{portalAddress:'portal'},network:{},privateFee:{contractAddress:'0x'+'01'.repeat(32)}});
 const normalized=loadContractArtifact(raw);let registered;const wallet={registerContract:async(_instance,artifact)=>{registered=artifact;}};
 f.ctx.window.__aztec={loadContractArtifact,AztecAddress,derivePrivateFeeInstance:async()=>({address:'fee'}),Contract:{at:async(address,artifact,w)=>{assert.equal(address.toString(),'0x'+'01'.repeat(32));assert.equal(w,wallet);assert.equal(artifact,registered);assert.deepEqual(artifact.functions,normalized.functions);return {methods:{balance_of:owner=>({simulate:async()=>{assert.equal(owner,'owner');return 42n;}})}};}}};
 f.setResult({handles:{wallet,address:'owner'}});await f.api.run('status');assert.equal(await f.api.readFeeBalance(),42n);
});

test('resuming an already confirmed post preserves its public identity and actual fee',async()=>{
 const f=fixture();f.ctx.makeCallEngine=()=>async action=>action==='recover'?{state:'transaction_recovered',postId:'post',feePaid:'5',lastL2TxHash:'hash'}:{state:'postable'};
 const app=f.ctx.createBillboardApplication();const result=await app.resume();assert.equal(result.state,'postable');assert.equal(result.postId,'post');assert.equal(result.feePaid,'5');
});
test('failure before a new proof cannot silently recover an older confirmed post instead',async()=>{
 const f=fixture(),actions=[];let attempt=0;
 f.ctx.makeCallEngine=()=>async(action,_progress,input)=>{actions.push(action);if(action==='post'){await input.onPostPrepared({postId:'0x'+'2'.repeat(64)});if(attempt++===0)throw {code:'BB_REMOTE_PROVER_OFFLINE'};return {postId:'0x'+'2'.repeat(64),state:'postable'};}return {state:'transaction_recovered',postId:'0x'+'1'.repeat(64),lastL2TxHash:'old'};};
 const app=f.ctx.createBillboardApplication();await assert.rejects(app.run('post',{message:'new message'}));const result=await app.resume();assert.equal(result.postId,'0x'+'2'.repeat(64));assert.deepEqual(actions,['post','recover','post']);
});

for(const state of ['active','pending-settlement'])test('deployment records survive continuation without crossing manifests: '+state,()=>{
 const f=fixture('deploy');f.ctx.window.__aztec.validateDeploymentManifest=v=>structuredClone(v);const manifest={identity:'first'},result={status:state,l2Addr:'0x'+'1'.repeat(64),portalAddr:'0x'+'2'.repeat(40)},readyTxHash='0x'+'3'.repeat(64);
 f.api.saveDeployment({manifest,result,readyTxHash});const reopened=f.ctx.createBillboardApplication({kind:'deploy'});assert.deepEqual(reopened.readDeployment().result,{...result,readyTxHash});reopened.saveDeployment({manifest,readyTxHash});assert.equal(reopened.readDeployment().result.status,state);reopened.saveDeployment({manifest:{identity:'second'}});assert.equal(reopened.readDeployment().result,null);
});
test('a freshly reviewed deployment can replace damaged public deployment settings',()=>{
 const f=fixture('deploy');f.ctx.window.__aztec.validateDeploymentManifest=v=>structuredClone(v);f.ctx.localStorage.setItem('board-deployment-resume-v2','invalid');assert.throws(()=>f.api.readDeployment(),{code:'BB_DEPLOYMENT_RECORD'});f.api.saveDeployment({manifest:{identity:'new'}});assert.equal(f.api.readDeployment().manifest.identity,'new');
});

test('restored settlement gives priority to an uncertain Ethereum refund',async()=>{
 const f=fixture(),a=f.ctx.window.__aztec,hash='0x'+'1'.repeat(64);f.state.ethAccount='0x'+'2'.repeat(40);f.ctx.ethers={JsonRpcProvider:class{destroy(){}}};
 f.ctx._getPublicConfig=()=>({network:{chainId:'1',rollupAddress:'rollup',rollupVersion:'1'},board:{contractAddress:'board',portalAddress:'portal'},privateFee:{contractAddress:'0x'+'01'.repeat(32)}});
 a.createBrowserJournalStorage=()=>({});a.createL2Journal=async()=>({inspectOutcome:async()=>({outcome:'success',operation:JSON.stringify({kind:'withdraw'}),txHash:hash})});a.createEthereumJournal=async({scope})=>({inspectSummary:async()=>scope.board==='board'?{outcome:'unknown',kind:'withdraw',txHash:'ethereum-refund'}:null});
 f.setResult({state:'withdrawal_needs_verification',withdrawTxHash:hash,handles:{aztecNode:{getL1ContractAddresses:async()=>({feeJuicePortalAddress:'feePortal',feeJuiceAddress:'token'})}}});await f.api.run('status');await f.api.readActivity();f.setResult({refundAmount:'1',refundRecipient:f.state.ethAccount});await f.api.resume();assert.equal(f.calls.at(-1).action,'recover-eth');assert(!f.calls.some(c=>c.action==='claim-l1'));
});

test('posting adapter connects portable plugin APIs without exposing private handles',async()=>{
 const f=fixture(),values=new Map(),id='0x'+'1'.padStart(64,'0'),receiver='0x'+'2'.padStart(64,'0');
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'12'.repeat(20),boardAddress:id};
 const descriptor={protocol:'billboard-plugin/v2',scope:{...scope,receiver},description:'bok',funding:{protocol:'aztec-escrow-usdc/v1',portalAddress:'0x'+'34'.repeat(20),tokenAddress:'0x'+'56'.repeat(20)}};
 f.ctx._getPublicConfig=()=>({network:scope,board:{contractAddress:id}});
 f.ctx.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 f.ctx.getBrowserSigner=async()=>({provider:'wallet'});f.ctx.window.__aztec.Fr={fromString:x=>x};
 const url=packText('https://example.test/descriptor',8);
 f.setResult({handles:{address:id,contract:{methods:{get_plugin:handle=>{assert.equal(handle,handleField('bok'));return {simulate:async()=>({result:[receiver,true,url.fields,url.length]})};}}}}});
 await f.api.run('status');f.setResult({postId:id,lastL2TxHash:'post-tx'});
 f.ctx.getBrowserSigner=async()=>{throw Error('Posting must not request an Ethereum signature');};
 f.ctx.window.BillboardPlugins={mentions,prepareInvocation:args=>prepareInvocation({...args,loadDescriptor:async()=>descriptor})};
 const result=await f.api.run('post',{message:'@bok help'});
 assert.equal(f.calls.at(-1).input.pluginHandle,handleField('bok'));assert.equal(values.size,0);assert.equal(result.postId,id);assert(!('handles' in result));
});

test('plugin account shares the operation lock and captures proving before asynchronous work',async()=>{
 const f=fixture();let release,mode='remote';const gate=new Promise(r=>release=r),seen=[];
 f.ctx.window.BillboardProving.snapshot=()=>mode;
 f.ctx.makeCallEngine=()=>async(action,_progress,input)=>{seen.push({action,input});await gate;return {lastL2TxHash:'plugin-hash'};};
 const api=f.ctx.createBillboardApplication();const pending=api.pluginAccount('claim',{handle:'bok'});mode='local';
 await assert.rejects(api.run('post',{message:'overlap'}),{code:'BB_OPERATION_BUSY'});await assert.rejects(api.pluginAccount('balance',{handle:'bok'}),{code:'BB_OPERATION_BUSY'});
 release();await pending;assert.equal(seen.length,1);assert.equal(seen[0].input.provingMode,'remote');assert.equal(seen[0].action,'plugin-account');
 await api.run('post',{message:'next'});assert.equal(seen[1].input.provingMode,'local');assert.equal(seen[1].input.acknowledgeTx,'plugin-hash');
});


test('withdrawal review reports screened cooldown debt and clears expired debt',async()=>{
 const f=fixture();let nextAllowedTime=200n;
 f.ctx.window.BillboardConfig={maximumFee:()=>7n};
 f.ctx.readBillboardDepositInfo=async()=>({amount:1n,depositChainId:2n,lastScreenedIndex:3n,lastRealPostIndex:3n,nextAllowedTime});
 f.setResult({handles:{contract:{},address:'1'}});await f.api.run('status');
 const waiting=await f.api.readWithdrawalPlan();assert.equal(waiting.chainTime,100);assert.equal(waiting.readyAt,200);assert.equal(waiting.waitingReason,'Your posting cooldown is still running.');assert.equal(waiting.remaining,0);
 nextAllowedTime=99n;const ready=await f.api.readWithdrawalPlan();assert.equal(ready.readyAt,99);assert.equal(ready.waitingReason,null);assert.equal(ready.maxScreeningSteps,0);
});
