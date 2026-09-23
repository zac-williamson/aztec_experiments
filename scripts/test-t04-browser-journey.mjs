import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {validateJourneySignal,writeJourneySignal,waitJourneyRelease,transactionHashes} from './t04-browser-journey.mjs';
const hash='0x'+'ab'.repeat(32),signal={stage:'exit',transactionHashes:[hash]};
test('rendezvous accepts only fixed stages and bounded unique public transaction identifiers',()=>{
 assert.deepEqual(validateJourneySignal(signal),signal);
 for(const value of [{...signal,stage:'../../outside'},{...signal,secret:'SECRET'},{...signal,transactionHashes:[]},{...signal,transactionHashes:[hash,hash]},{...signal,transactionHashes:['SECRET']}])assert.throws(()=>validateJourneySignal(value));
 assert.deepEqual(transactionHashes(`Transaction hash: ${hash}\nTransaction hash: ${hash}`),[hash]);
});
test('atomic rendezvous cannot overwrite a prior stage or accept an unverified release',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await writeJourneySignal(dir,signal);await assert.rejects(writeJourneySignal(dir,signal),{code:'EEXIST'});
 await fs.writeFile(path.join(dir,'browser-journey-exit-verified.json'),JSON.stringify({stage:'exit',verified:false}));
 await assert.rejects(waitJourneyRelease(dir,'exit',()=>100));
 await fs.writeFile(path.join(dir,'browser-journey-exit-verified.json'),JSON.stringify({stage:'exit',verified:true}));
 await waitJourneyRelease(dir,'exit',()=>100);
});
test('missing release respects remaining parent budget',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await assert.rejects(waitJourneyRelease(dir,'exit',()=>0),/T04_RENDEZVOUS_DEADLINE/);
});
test('canonical exit rejects wrong leaf, duplicate leaf, wrong nullifier and ineligible anchor',async()=>{
 const {assertJourneyExit}=await import('./t04-browser-journey-verify.mjs');
 const value=n=>({equals(other){return other.id===n;},id:n}),leaf=value(1),nullifier=value(2);
 const good={effect:{l2ToL1Msgs:[leaf],nullifiers:[nullifier]},leaf,consumedNullifier:nullifier,anchorTimestamp:10n,nextAllowedTime:10n};
 assertJourneyExit(good);
 for(const mutation of [{anchorTimestamp:9n},{effect:{l2ToL1Msgs:[value(3)],nullifiers:[nullifier]}},{effect:{l2ToL1Msgs:[leaf,leaf],nullifiers:[nullifier]}},{effect:{l2ToL1Msgs:[leaf],nullifiers:[value(3)]}}])assert.throws(()=>assertJourneyExit({...good,...mutation}));
});
test('aborted lifecycle terminates a rendezvous even with a clamped legacy time callback',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const abort=new AbortController(),waiting=waitJourneyRelease(dir,'exit',()=>1,abort.signal);abort.abort();await assert.rejects(waiting,/T04_RENDEZVOUS_ABORTED/);
});
test('browser modes roundtrip strictly across the real handoff boundary',async()=>{
 const {createBrowserHandoff,validateBrowserHandoff,validateBrowserControl,validateBrowserWorkerControl}=await import('./t04-browser-journey.mjs');
 const directory='/private/tmp/t04-fixture',address='0x'+'12'.repeat(20),board='0x'+'01'.repeat(32);
 const publicConfig={schemaVersion:1,network:{nodeUrl:'https://127.0.0.1:1234/rpc/aztec',ethRpcUrl:'https://127.0.0.1:1234/rpc/ethereum',chainId:'31337',rollupVersion:'1',rollupAddress:address},board:{portalAddress:address,contractAddress:board}};
 const base={nodeUrl:'http://127.0.0.1:1235',ethereumUrl:'http://127.0.0.1:1236',publicConfig,backupPath:directory+'/browser-wallet.encrypted.json',ethereumAccount:address,message:'Fixture GUI message'};
 for(const browserEngine of ['chromium','chrome','firefox','webkit'])for(const browserMode of ['post','lifecycle','recovery','withdraw-recovery','funding','performance']){
  const control={ethereumWallet:'disposable',browserEngine,browserMode,origin:'https://127.0.0.1:1234',rpcToken:'a'.repeat(32),backupPassword:'b'.repeat(32)};
  if(['recovery','withdraw-recovery'].includes(browserMode)&&browserEngine!=='chromium'){assert.throws(()=>validateBrowserControl(control));continue;}
  const actual=createBrowserHandoff(base,{directory,browserMode,depositAmount:'0.001',fundingAmount:'1.0'});
  assert.deepEqual(validateBrowserHandoff(JSON.parse(JSON.stringify(actual)),{directory,browserMode}),actual);
  const merged={...actual,...control,timeoutMs:480000};
  assert.deepEqual(validateBrowserWorkerControl(JSON.parse(JSON.stringify(merged)),{directory}),merged);
  for(const mutation of [{...merged,browserMode:'unknown'},{...merged,browserMode:undefined},{...merged,browserJourney:true},{...merged,browserRecovery:false},{...merged,extra:'SECRET'},{...merged,timeoutMs:480001}])assert.throws(()=>validateBrowserWorkerControl(mutation,{directory}));
  for(const mutation of [{...actual,secret:'SECRET'},{...actual,backupPath:'/private/tmp/elsewhere/browser-wallet.encrypted.json'},{...actual,backupPath:directory+'/../escape'},{...actual,nodeUrl:'https://outside.example'}])assert.throws(()=>validateBrowserHandoff(mutation,{directory,browserMode}));
  if(browserMode==='funding'){const missing={...actual};delete missing.fundingAmount;assert.throws(()=>validateBrowserHandoff(missing,{directory,browserMode}));}
 }
 for(const depositAmount of ['0.0','-1.0','1e-3','1.0000000000000000001'])assert.throws(()=>createBrowserHandoff(base,{directory,browserMode:'lifecycle',depositAmount}));
 for(const fundingAmount of ['0.0','-1.0','1e-3'])assert.throws(()=>createBrowserHandoff(base,{directory,browserMode:'funding',depositAmount:'0.001',fundingAmount}));
 const control={ethereumWallet:'disposable',browserEngine:'chromium',browserMode:'lifecycle',origin:'https://127.0.0.1:1234',rpcToken:'a'.repeat(32),backupPassword:'b'.repeat(32)};
 for(const browserEngine of [undefined,'unknown'])assert.throws(()=>validateBrowserControl({...control,browserEngine}));
 assert.throws(()=>validateBrowserControl({...control,arbitrary:'SECRET'}));
});
test('journey diagnostic outputs fixed milestones and allowlisted exception only',async()=>{
 const {readJourneyUiDiagnostic,safeJourneyDriverFailure}=await import('./t04-browser-journey.mjs');
 const previous=globalThis.document;
 try{globalThis.document={getElementById:id=>({textContent:id==='depositStatus'?'Making new L1 deposit Claim secret saved locally SECRET_PRIVATE_KEY':id==='withdrawStatus'?'SECRET_WITNESS':'ETH claimed successfully! SECRET_RPC_URL'}),querySelector:selector=>selector==='#depositStatus .error'?{}:null};
  const result=readJourneyUiDiagnostic();assert.equal(result.depositHasError,true);assert.equal(result.milestones.claimSecretSaved,true);assert.equal(result.milestones.depositConfirmed,false);assert.equal(result.milestones.refundComplete,true);assert.ok(!JSON.stringify(result).includes('SECRET'));
 }finally{globalThis.document=previous;}
 assert.deepEqual(safeJourneyDriverFailure({name:'AssertionError',message:'SECRET',code:'SECRET'},'await-deposit-claim'),{exceptionClass:'AssertionError',substage:'await-deposit-claim'});
 assert.deepEqual(safeJourneyDriverFailure({name:'SECRET'},'SECRET'),{exceptionClass:'OtherError',substage:'other'});
});

test('actual browser journey stops after one deposit action when claim reports an error',async()=>{
 const {driveT04BrowserJourney}=await import('./t04-browser-journey.mjs');
 let clicks=0;
 const page={
  waitForFunction:async()=>{},
  locator:selector=>({waitFor:async()=>{},press:async()=>{},textContent:async()=>selector==='#depositLimits'?'Minimum 0.001 ETH · Maximum 0.01 ETH':selector==='#depositSelection'?'0.001 ETH':'ERROR: claim failed',click:async()=>{assert.equal(selector,'#navNext');clicks++;},count:async()=>1}),
 };
 await assert.rejects(driveT04BrowserJourney({page,directory:'/unused',message:'message',depositAmount:'0.001',remaining:()=>1000,mark(){}}));
 assert.equal(clicks,1);
});

// Persist only bounded public canonical progress, never captured proof/note data.
test('partial canonical progress is ordered, bounded, public-only and copied',async()=>{
 const {validateVerifiedBrowserStages}=await import('./t04-browser-journey.mjs');
 const one={stage:'claim',txHash:hash,blockHash:'0x'+'cd'.repeat(32),blockNumber:'2',canonicalReceipt:true,normalNodeVerification:true};
 const input={schemaVersion:1,stages:[one]},copy=validateVerifiedBrowserStages(input);copy.stages[0].blockNumber='3';assert.equal(input.stages[0].blockNumber,'2');
 for(const value of [{...input,secret:'secret'},{schemaVersion:1,stages:[]},{schemaVersion:1,stages:[{...one,stage:'exit'}]},{schemaVersion:1,stages:[{...one,proof:'secret'}]},{schemaVersion:1,stages:[{...one,canonicalReceipt:false}]},{schemaVersion:1,stages:[{...one,blockNumber:'0'}]},{schemaVersion:1,stages:[one,{...one,stage:'post'}]}])assert.throws(()=>validateVerifiedBrowserStages(value));
});

test('non-Chromium lifecycle scenarios retain one explicit engine and existing bounds',async()=>{
 const {getScenario}=await import('./testing/scenarios.mjs');
 for(const browserEngine of ['firefox','webkit']){
  const scenario=getScenario('browser-'+browserEngine+'-journey');
  assert.equal(scenario.browserEngine,browserEngine);assert.equal(scenario.browser,'lifecycle');
  assert.equal(scenario.deadlineMs,540000);assert.equal(scenario.applicationThreads,1);
 }
});

test('cold funding driver never claims or deposits again after a failed deposit',async()=>{
 const {driveT04BrowserFunding}=await import('./t04-browser-funding.mjs');
 const clicks=[];
 const page={waitForFunction:async()=>{},evaluate:async()=>'{"schemaVersion":1}',
  locator:selector=>({fill:async()=>{},click:async()=>clicks.push(selector),count:async()=>selector==='#setupStatus .error'?0:1})};
 await assert.rejects(driveT04BrowserFunding({page,directory:'/unused',message:'message',depositAmount:'0.001',fundingAmount:'1.0',remaining:()=>1000,mark(){},onSubstage(){}}));
 assert.deepEqual(clicks,['#depositBtn']);
});

test('handoff accepts actual SDK whole-token formatting and rejects invalid amounts',async()=>{
 const {formatEther}=await import('viem');
 const {createBrowserHandoff}=await import('./t04-browser-journey.mjs');
 const directory='/private/tmp/t04-fixture',address='0x'+'12'.repeat(20),board='0x'+'01'.repeat(32);
 const publicConfig={schemaVersion:1,network:{nodeUrl:'https://127.0.0.1:1234/rpc/aztec',ethRpcUrl:'https://127.0.0.1:1234/rpc/ethereum',chainId:'31337',rollupVersion:'1',rollupAddress:address},board:{portalAddress:address,contractAddress:board}};
 const base={nodeUrl:'http://127.0.0.1:1235',ethereumUrl:'http://127.0.0.1:1236',publicConfig,backupPath:directory+'/browser-wallet.encrypted.json',ethereumAccount:address,message:'message'};
 const options={directory,browserMode:'funding',depositAmount:formatEther(10n**15n),fundingAmount:formatEther(10n**18n)};
 assert.equal(createBrowserHandoff(base,options).fundingAmount,'1');
 for(const fundingAmount of ['0','00','01','1.','+1','1e3','1.0000000000000000001'])assert.throws(()=>createBrowserHandoff(base,{...options,fundingAmount}));
});

test('MetaMask is accepted only for explicit Chromium lifecycle and funding',async()=>{
 const {validateBrowserControl}=await import('./t04-browser-journey.mjs');
 const control={ethereumWallet:'metamask',browserEngine:'chromium',browserMode:'lifecycle',origin:'https://127.0.0.1:1234',rpcToken:'a'.repeat(32),backupPassword:'b'.repeat(32)};
 assert.equal(validateBrowserControl(control),control);assert.equal(validateBrowserControl({...control,browserMode:'funding'}).browserMode,'funding');
 for(const mutation of [{ethereumWallet:undefined},{ethereumWallet:'unknown'},{browserEngine:'firefox'},{browserMode:'post'}])assert.throws(()=>validateBrowserControl({...control,...mutation}));
});

test('MetaMask request observation preserves provider result and refuses overlapping transactions',async()=>{
 const {observeMetaMaskTransactions}=await import('./t04-metamask.mjs');
 const prior=globalThis.__testMetaMask;let release,calls=0;
 const tx={method:'eth_sendTransaction',params:[{to:'fixture'}]},provider={request:async request=>{calls++;assert.equal(request,tx);return new Promise(resolve=>{release=resolve;});}};
 try{
  globalThis.__testMetaMask=provider;await observeMetaMaskTransactions({evaluate:fn=>fn()});
  const sending=provider.request(tx);assert.deepEqual(globalThis.__walletTestPending,tx.params);
  await assert.rejects(provider.request(tx),/Overlapping/);assert.equal(calls,1);
  release('canonical-hash');assert.equal(await sending,'canonical-hash');assert.equal(globalThis.__walletTestPending,null);
 }finally{globalThis.__testMetaMask=prior;delete globalThis.__walletTestPending;}
});

test('request guard attributes blank extension iframes without exempting application requests',async()=>{
 const {guardBrowserRequest}=await import('./t04-metamask.mjs');
 for(const [pageUrl,workerUrl,expected] of [['chrome-extension://wallet/home.html',null,'extension'],['https://127.0.0.1:1234/user.html',null,'application'],[null,'https://127.0.0.1:1234/worker.js','application']]){
  let aborted=0,record;
  const request={url:()=> 'https://metamask.github.io/docs',serviceWorker:()=>workerUrl?{url:()=>workerUrl}:null,frame:()=>({url:()=> 'about:blank',page:()=>({url:()=>pageUrl})}),resourceType:()=> 'document',isNavigationRequest:()=>true};
  await guardBrowserRequest({request:()=>request,abort:()=>aborted++,continue:()=>{throw Error('External request must remain blocked');}},{origin:'https://127.0.0.1:1234',extensionWallet:true,onBlocked:r=>{record=r;}});
  assert.equal(aborted,1);assert.equal(record.owner,expected);assert.equal(record.hostname,'metamask.github.io');
 }
});

test('MetaMask confirmation guard binds exact account, chain, target, amount and calldata',async()=>{
 const {assertMetaMaskTransaction}=await import('./t04-metamask.mjs'),{Interface}=await import('ethers');
 const address=n=>'0x'+n.repeat(40),field=n=>'0x'+n.repeat(64);
 const options={account:address('1'),chainId:'0x7a69',tokenAddress:address('2'),feePortalAddress:address('3'),boardPortalAddress:address('4'),privateFeeAddress:field('5'),fundingAmount:'1',collateralAmount:'0.001'};
 const abi=new Interface(['function approve(address,uint256)','function depositToAztecPublic(bytes32,uint256,bytes32)','function deposit(bytes32) payable','function withdraw(uint256,uint256,uint256,bytes32[])']);
 const cases=[['fee-approval',options.tokenAddress,'approve',[options.feePortalAddress,10n**18n],0n],['fee-deposit',options.feePortalAddress,'depositToAztecPublic',[options.privateFeeAddress,10n**18n,field('6')],0n],['deposit',options.boardPortalAddress,'deposit',[field('6')],10n**15n],['refund',options.boardPortalAddress,'withdraw',[1n,1n,0n,[field('6')]],0n]];
 for(const [stage,to,method,args,value] of cases){
  const request=[{from:options.account,to,data:abi.encodeFunctionData(method,args),value:'0x'+value.toString(16)}],input={...options,stage,request};assertMetaMaskTransaction(input);
  for(const mutation of [{from:address('9')},{to:address('9')},{chainId:'0x1'},{value:'0x'+(value+1n).toString(16)},{data:request[0].data+'00'},{data:'0x00000000'}])assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],...mutation}]}));
  assert.throws(()=>assertMetaMaskTransaction({...input,chainId:'0x1'}));assert.throws(()=>assertMetaMaskTransaction({...input,stage:'unknown'}));assert.throws(()=>assertMetaMaskTransaction({...input,request:[...request,...request]}));
  if(stage.startsWith('fee-')){
   for(const changed of [[stage==='fee-approval'?address('9'):field('9'),...args.slice(1)],[args[0],1n,...args.slice(2)]])assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],data:abi.encodeFunctionData(method,changed)}]}));
   if(stage==='fee-deposit')assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],data:abi.encodeFunctionData(method,[args[0],args[1],field('0')])}]}));
  }
 }
});
