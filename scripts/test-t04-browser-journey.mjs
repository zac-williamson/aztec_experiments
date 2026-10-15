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
  locator:selector=>({waitFor:async()=>{},press:async()=>{},textContent:async()=>selector==='#depositLimits'?'Minimum 0.001 ETH · Maximum 0.01 ETH':selector==='#depositSelection'?'0.001 ETH':'ERROR: claim failed',click:async()=>{assert.equal(selector,'#navNext');clicks++;},count:async()=>clicks?1:0}),
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
 const clicks=[],confirmations=[];
 const page={waitForFunction:async()=>{},
  locator:selector=>({waitFor:async()=>{},press:async()=>{},textContent:async()=>selector==='#depositLimits'?'Minimum 0.001 ETH · Maximum 0.01 ETH':selector==='#depositSelection'?'0.001 ETH':'ERROR: fee failed',click:async()=>clicks.push(selector),count:async()=>clicks.length?1:0})};
 await assert.rejects(driveT04BrowserFunding({page,directory:'/unused',message:'message',depositAmount:'0.001',remaining:()=>1000,mark(){},onSubstage(){},confirmEthereum:async stage=>{confirmations.push(stage);if(stage==='fee-deposit')throw Error('payment failed');}}));
 assert.deepEqual(clicks,['#navNext']);assert.deepEqual(confirmations,['fee-approval','fee-deposit']);
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
  assertMetaMaskTransaction({...input,chainId:'0xaa36a7',expectedChainId:11155111n});
  assert.throws(()=>assertMetaMaskTransaction({...input,expectedChainId:11155111n}));
  assert.throws(()=>assertMetaMaskTransaction({...input,chainId:'0x1',expectedChainId:1n}));
  for(const mutation of [{from:address('9')},{to:address('9')},{chainId:'0x1'},{value:'0x'+(value+1n).toString(16)},{data:request[0].data+'00'},{data:'0x00000000'}])assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],...mutation}]}));
  assert.throws(()=>assertMetaMaskTransaction({...input,chainId:'0x1'}));assert.throws(()=>assertMetaMaskTransaction({...input,stage:'unknown'}));assert.throws(()=>assertMetaMaskTransaction({...input,request:[...request,...request]}));
  if(stage.startsWith('fee-')){
   for(const changed of [[stage==='fee-approval'?address('9'):field('9'),...args.slice(1)],[args[0],1n,...args.slice(2)]])assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],data:abi.encodeFunctionData(method,changed)}]}));
   if(stage==='fee-deposit')assert.throws(()=>assertMetaMaskTransaction({...input,request:[{...request[0],data:abi.encodeFunctionData(method,[args[0],args[1],field('0')])}]}));
  }
 }
});

test('Phantom mode is explicit signature-only and leaves the original MetaMask mode unchanged',async()=>{
 const {walletExtensionMode}=await import('./t04-phantom.mjs');
 assert.equal(walletExtensionMode([]),'metamask');assert.equal(walletExtensionMode(['--wallet=phantom','--onboarding-only']),'phantom-onboarding');assert.equal(walletExtensionMode(['--wallet=phantom','--signatures-only']),'phantom');
 for(const args of [['--wallet=phantom'],['--wallet=metamask'],['--wallet=phantom','--signatures-only','--send'],['--wallet=phantom','--chain=31337']])assert.throws(()=>walletExtensionMode(args));
});
test('Phantom package pin rejects a modified official package before extracting any files',async()=>{
 const {phantomZip,phantomPackage}=await import('./t04-phantom.mjs');
 const bytes=await fs.readFile(new URL('../'+phantomPackage.archive,import.meta.url));
 assert.equal(phantomZip(bytes).subarray(0,2).toString(),'PK');bytes[bytes.length-1]^=1;assert.throws(()=>phantomZip(bytes));
 assert.throws(()=>phantomZip(Buffer.alloc(12)));
});
test('Phantom exact G04 typed payloads verify distinct domains and reject mutation or a different signer',async()=>{
 const {Wallet}=await import('ethers');
 const {phantomTypedData,assertPhantomSignature}=await import('./t04-phantom.mjs');
 const {collateralConsentTypes,usdcAuthorizationTypes}=await import('../shared/rolling/aggregate-funding.mjs');
 const wallet=Wallet.createRandom(),other=Wallet.createRandom(),inputs={account:wallet.address,portal:Wallet.createRandom().address,router:Wallet.createRandom().address,token:Wallet.createRandom().address,nonce:'0x'+'19'.repeat(32),now:1800000000};
 const data=phantomTypedData(inputs);assert.deepEqual(data.map(x=>x.types),[collateralConsentTypes,usdcAuthorizationTypes]);
 const digests=[];
 for(const item of data){
  assert.equal(item.domain.chainId,11155111);const signature=await wallet.signTypedData(item.domain,item.types,item.value);
  digests.push(assertPhantomSignature(item,signature,wallet.address));
  assert.throws(()=>assertPhantomSignature(item,signature,other.address));
  assert.throws(()=>assertPhantomSignature({...item,domain:{...item.domain,chainId:31337}},signature,wallet.address));
  assert.throws(()=>assertPhantomSignature({...item,value:{...item.value,...(item.value.amount?{amount:'2'}:{value:'2'})}},signature,wallet.address));
 }
 assert.notEqual(digests[0],digests[1]);
 assert.throws(()=>phantomTypedData({...inputs,nonce:'private'}));assert.throws(()=>phantomTypedData({...inputs,now:NaN}));
});
test('Phantom signature-only request admission denies financial sends and arbitrary signing',async()=>{
 const {phantomMethods,assertPhantomMethod}=await import('./t04-phantom.mjs');
 for(const method of phantomMethods)assertPhantomMethod(method);
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction','wallet_sendCalls','personal_sign','eth_sign','wallet_addEthereumChain',null])assert.throws(()=>assertPhantomMethod(method));
 assert(Object.isFrozen(phantomMethods));
});
test('Phantom onboarding acknowledges discovered accounts before the password form',async()=>{
 const {onboardPhantom}=await import('./t04-phantom.mjs');
 const calls=[],marks=[];let phase='start',checked=false,termsClicked=false;
 const control=name=>({locator(){return control(name+'-container');},async isChecked(){return checked;},async click(){calls.push(name);if(name==='onboarding-form-terms-of-service-checkbox-container')termsClicked=true;if(name==='onboarding-form-submit-button'){if(phase==='start')phase='accounts';else if(phase==='password'){assert.equal(checked,true);phase='done';}}if(name==='Continue'&&phase==='accounts')phase='password';},async fill(){if(name==='onboarding-form-password-input')assert.equal(phase,'password');},async check(){},async waitFor(){if(name==='Import Accounts')assert.equal(phase,'accounts');}});
 const page={setDefaultTimeout(){},async goto(){},async waitForFunction(){assert.equal(termsClicked,true);checked=true;},getByTestId:control,getByText:control,getByRole(_role,{name}){return control(name);}};
 await onboardPhantom({pages:()=>[],newPage:async()=>page},Array(12).fill('test').join(' '),'disposable-password',value=>marks.push(value),{passwordOnly:true});
 assert(calls.indexOf('Continue')>calls.indexOf('onboarding-form-submit-button'));assert.equal(phase,'done');
 assert.deepEqual(marks,['phantom-import-choice','phantom-import-phrase','phantom-import-accounts','phantom-password','phantom-terms','phantom-password-submit']);
});
for(const defer of [true,false])test('Phantom completion '+(defer?'prefers the offered defer control':'uses only a disposable username and records remote retention'),async()=>{
 const {completePhantomOnboarding}=await import('./t04-phantom.mjs');let phase='username',closed=false,blurred=false;const profiles=[],names=[];
 const control=name=>({async isEnabled(){return blurred;},async press(key){assert.equal(name,'username');assert.equal(key,'Tab');assert.equal(names.length,1);blurred=true;},async isVisible(){return name==='onboarding-create-username-continue'?phase==='username':name==='onboarding-create-username-complete-later'?defer&&phase==='username':name==='username'?phase==='username':name==='onboarding-claiming-username-get-started'?phase==='claimed':name==='Get Started'?phase==='done':false;},async fill(value){names.push(value);},async click(){if(name==='onboarding-create-username-complete-later')phase='done';if(name==='onboarding-create-username-continue')phase='claimed';},async waitFor(){}});
 const page={getByTestId:control,getByPlaceholder:control,getByRole(_,{name}){return control(name);},isClosed:()=>closed,async close(){closed=true;}};
 const wallet={setDefaultTimeout(){},async goto(){},getByTestId:control};
 assert.equal(await completePhantomOnboarding({pages:()=>[],newPage:async()=>wallet},page,()=>{},value=>profiles.push(value)),wallet);
 assert.equal(closed,true);
 if(defer){assert.deepEqual(names,[]);assert.deepEqual(profiles,[]);}else{assert.equal(blurred,true);assert.match(names[0],/^test[0-9a-f]{12}$/);assert.deepEqual(profiles,[{attempted:true,created:false,externalDeletionVerified:false},{attempted:true,created:true,externalDeletionVerified:false}]);}
});


test('MetaMask aggregate admission binds one exact local ETH payment and its gas ceiling',async()=>{
 const {Interface,AbiCoder,keccak256}=await import('ethers');
 const {aggregateFundingAbi}=await import('../shared/rolling/aggregate-funding.mjs');
 const {assertMetaMaskAggregatePayment}=await import('./t04-metamask.mjs');
 const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const abi=new Interface(aggregateFundingAbi),plan={beneficiary:address(1),collateral:'100',collateralSecretHash:field(8),fee:{amount:'200',maxEth:'20',poolFee:3000},feeSecretHash:field(9),bok:{amount:'300',maxEth:'30',poolFee:3000},bokCommitment:field(10),bokSecretHash:field(11),nonce:'7',deadline:'2000000000'};
 const expected={kind:'aggregate-funding',routerCodeHash:keccak256('0x6001'),collateralPortal:address(3),feePortal:address(4),bokPortal:address(5),privateFpc:field(6),planHash:keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fund').inputs[0]],[plan]))};
 const intent={from:address(1),to:address(2),chainId:'31337',nonce:2,data:abi.encodeFunctionData('fund',[plan,'0x'+'ab'.repeat(65)]),value:'150',expected};
 const tx={from:intent.from,to:intent.to,chainId:'0x7a69',nonce:'0x2',data:intent.data,value:'0x96',gas:'0x64',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x1'};
 const input={asset:'ETH',request:[tx],account:intent.from,chainId:'31337',intent,maximumGasWei:'1000'};
 assert.deepEqual(assertMetaMaskAggregatePayment(input),{planHash:expected.planHash,collateral:'100',feeAmount:'200',bokAmount:'300'});
 for(const mutation of [{from:address(9)},{to:address(9)},{chainId:'0x1'},{nonce:'0x7'},{data:tx.data+'00'},{value:'0x97'},{gas:'0x65'},{gas:undefined},{maxPriorityFeePerGas:'0xb'},{gasPrice:'0xa'},{authorizationList:[]}])assert.throws(()=>assertMetaMaskAggregatePayment({...input,request:[{...tx,...mutation}]}));
 for(const mutation of [{asset:'USDC'},{chainId:'1'},{request:[tx,tx]},{maximumGasWei:'999'},{intent:{...intent,expected:{...expected,kind:'aggregate-usdc-funding'}}}])assert.throws(()=>assertMetaMaskAggregatePayment({...input,...mutation}));
});


test('MetaMask aggregate modes require an explicit asset and do not change legacy or Phantom modes',async()=>{
 const {walletExtensionMode}=await import('./t04-phantom.mjs');
 for(const asset of ['ETH','USDC'])assert.equal(walletExtensionMode(['--wallet=metamask','--aggregate-devnet='+asset]),'metamask-aggregate-'+asset);
 for(const args of [['--wallet=metamask'],['--wallet=metamask','--aggregate-devnet=DAI'],['--wallet=metamask','--aggregate-devnet=ETH','--retry'],['--aggregate-devnet=ETH','--wallet=metamask']])assert.throws(()=>walletExtensionMode(args));
 assert.equal(walletExtensionMode([]),'metamask');assert.equal(walletExtensionMode(['--wallet=phantom','--signatures-only']),'phantom');
});

test('MetaMask aggregate launch rejects absent, nonlocal or unpinned deployment and preserves private control ownership',async t=>{
 const {Wallet}=await import('ethers');const {validateMetaMaskAggregateControl,readMetaMaskAggregateControl}=await import('./t04-metamask.mjs');
 const a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'t04-aggregate-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const scope={chainId:'31337',router:a(1),routerCodeHash:h(1),collateralPortal:a(2),feePortal:a(3),bokPortal:a(4),weth:a(5),swapRouter:a(6),feeToken:a(7),bokToken:a(8),privateFpc:h(9),quoter:a(10),quoterCodeHash:h(2),usdcRelayAddress:a(11),usdcCodeHash:h(3),usdcImplementation:a(12),usdcImplementationCodeHash:h(4),usdcDomain:{name:'Local USD Coin',version:'2'}};
 const c={schemaVersion:1,asset:'USDC',origin:'http://127.0.0.1:8080',ethereumUrl:'http://127.0.0.1:8545',walletConfig:{proofsEnabled:false,config:{network:{chainId:'31337',ethRpcUrl:'http://127.0.0.1:8545'},board:{portalAddress:a(2)},aggregateFunding:scope}},mnemonic:Wallet.createRandom().mnemonic.phrase,password:'disposable-test-password',recoveryDirectory:directory,runtimeSha256:'a'.repeat(64),allocation:{collateralWei:'1',feeAmount:'2',bokAmount:'3',gasBudgetWei:'4',maximumPaymentWei:'5',maximumUsdc:'6',slippageBps:100}};
 assert.deepEqual(validateMetaMaskAggregateControl(c,'USDC'),c);
 for(const change of [x=>delete x.walletConfig.config.aggregateFunding,x=>x.walletConfig.proofsEnabled=true,x=>x.origin='https://public.example',x=>x.walletConfig.config.network.chainId='1',x=>x.walletConfig.config.aggregateFunding.usdcRelayAddress=undefined,x=>x.walletConfig.config.aggregateFunding.usdcDomain.version='1',x=>x.runtimeSha256='unknown',x=>x.allocation.slippageBps=501,x=>x.allocation.maximumUsdc='0',x=>x.password='short',x=>x.extra=true]){const bad=structuredClone(c);change(bad);assert.throws(()=>validateMetaMaskAggregateControl(bad,'USDC'));}
 assert.throws(()=>readMetaMaskAggregateControl(undefined,'USDC'));
 const file=path.join(directory,'control.json');await fs.writeFile(file,JSON.stringify(c),{mode:0o600});assert.deepEqual(readMetaMaskAggregateControl(file,'USDC'),c);
 await fs.chmod(file,0o644);assert.throws(()=>readMetaMaskAggregateControl(file,'USDC'));await fs.chmod(file,0o600);
 await fs.mkdir(path.join(directory,'extension'));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC'),/new disposable profile/);await fs.rmdir(path.join(directory,'extension'));
 await fs.mkdir(path.join(directory,'profile'));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC'),/new disposable profile/);
 assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{readinessOnly:true}));await fs.mkdir(path.join(directory,'extension'));
 assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{readinessOnly:true}));await fs.writeFile(path.join(directory,'initial-recovery.json'),'{}',{mode:0o600});
 assert.deepEqual(readMetaMaskAggregateControl(file,'USDC',{readinessOnly:true}),c);assert.deepEqual(readMetaMaskAggregateControl(file,'USDC',{continueUnfunded:true}),c);assert.deepEqual(readMetaMaskAggregateControl(file,'USDC',{continueUnsigned:true}),c);assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{continueUnsigned:true,continueUnfunded:true}));
 assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{readinessOnly:true,continueUnfunded:true}));
 assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{paidRecovery:true}));await fs.writeFile(path.join(directory,'prepared-recovery.json'),'{}',{mode:0o600});assert.deepEqual(readMetaMaskAggregateControl(file,'USDC',{paidRecovery:true}),c);assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{paidRecovery:true,continueUnfunded:true}));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{paidRecovery:true,readinessOnly:true}));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{continueUnfunded:true}));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{continueUnsigned:true}));await fs.unlink(path.join(directory,'prepared-recovery.json'));assert.throws(()=>readMetaMaskAggregateControl(file,'USDC'));
 await fs.chmod(path.join(directory,'initial-recovery.json'),0o644);assert.throws(()=>readMetaMaskAggregateControl(file,'USDC',{readinessOnly:true}));
});

test('MetaMask aggregate typed consent binds exact local scope, allocation, nonce, expiry and two-signature USDC ordering',async()=>{
 const {assertMetaMaskAggregateTypedData}=await import('./t04-metamask.mjs');const {collateralConsentTypes,usdcAuthorizationTypes}=await import('../shared/rolling/aggregate-funding.mjs');
 const a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),h='0x'+'01'.repeat(32),account=a(1),scope={router:a(2),collateralPortal:a(3),bokToken:a(4),usdcDomain:{name:'Local USD Coin',version:'2'}},allocation={collateralWei:'100',maximumUsdc:'200'};
 const consent={domain:{name:'RollingCollateral',version:'1',chainId:'31337',verifyingContract:a(3)},types:collateralConsentTypes,primaryType:'DepositFor',message:{beneficiary:account,executor:a(2),amount:'100',secretHash:h,nonce:'7',deadline:'1100'}};
 const input={data:consent,account,scope,allocation,index:0,asset:'ETH',consentNonce:7n,nowSeconds:1000};assert.equal(assertMetaMaskAggregateTypedData(input).value.nonce,'7');
 const {TypedDataEncoder}=await import('ethers');const wire=TypedDataEncoder.getPayload(consent.domain,consent.types,consent.message);assert.equal(assertMetaMaskAggregateTypedData({...input,data:wire}).value.nonce,'7');
 const invalidDomain=structuredClone(wire);invalidDomain.types.EIP712Domain=[];assert.throws(()=>assertMetaMaskAggregateTypedData({...input,data:invalidDomain}));
 for(const change of [d=>d.domain.chainId='1',d=>d.domain.verifyingContract=a(9),d=>d.message.beneficiary=a(9),d=>d.message.executor=a(9),d=>d.message.amount='101',d=>d.message.nonce='0',d=>d.message.deadline='999',d=>d.message.deadline='1121',d=>d.message.extra='secret',d=>d.primaryType='Permit']){const data=structuredClone(consent);change(data);assert.throws(()=>assertMetaMaskAggregateTypedData({...input,data}));}
 const authorization={domain:{name:'Local USD Coin',version:'2',chainId:'31337',verifyingContract:a(4)},types:usdcAuthorizationTypes,primaryType:'ReceiveWithAuthorization',message:{from:account,to:a(2),value:'200',validAfter:'999',validBefore:'1100',nonce:h}};
 assert.equal(assertMetaMaskAggregateTypedData({...input,data:authorization,index:1,asset:'USDC'}).value.value,'200');
 for(const change of [x=>x.asset='ETH',x=>x.index=2,x=>x.data.message.value='201',x=>x.data.message.to=a(9),x=>x.data.domain.name='Other Coin',x=>x.data.message.validAfter='1000']){const bad=structuredClone({...input,data:authorization,index:1,asset:'USDC'});change(bad);assert.throws(()=>assertMetaMaskAggregateTypedData(bad));}
});


test('MetaMask aggregate observer counts every actual configured root RPC send and rejects malformed batches',async()=>{
 const {countMetaMaskAggregateNodeSubmissions:count}=await import('./t04-metamask.mjs');
 const endpoint='http://127.0.0.1:19080/',body=JSON.stringify([{method:'aztec_getBlock'},{method:'aztec_sendTx',params:[{}]},{method:'aztec_sendTx',params:[{}]}]);
 assert.equal(count({url:endpoint,method:'POST',body},endpoint),2);
 assert.equal(count({url:endpoint+'v1/node',method:'POST',body},endpoint),0);
 assert.equal(count({url:endpoint+'v1/node',method:'POST',body},endpoint+'v1/node'),2);
 assert.equal(count({url:'http://127.0.0.1:8545/',method:'POST',body},endpoint),0);
 assert.equal(count({url:endpoint,method:'GET',body:null},endpoint),0);
 for(const malformed of ['{','[]','null','[null]','[{}]',JSON.stringify(Array(101).fill({method:'aztec_getBlock'}))])assert.throws(()=>count({url:endpoint,method:'POST',body:malformed},endpoint));
 assert.throws(()=>count({url:endpoint+'?elsewhere=true',method:'POST',body},endpoint));
});

test('MetaMask retained readiness denies all payment/proof requests without substituting reads',async()=>{
 const {assertMetaMaskReadinessRequest:check}=await import('./t04-metamask.mjs');const endpoint='http://127.0.0.1:18545';
 for(const method of ['eth_chainId','eth_call','eth_getCode','eth_getTransactionReceipt'])check({url:endpoint,method:'POST',body:JSON.stringify({method})},endpoint);
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction','eth_signTypedData_v4','anvil_setBalance','personal_sign'])assert.throws(()=>check({url:endpoint,method:'POST',body:JSON.stringify([{method:'eth_chainId'},{method}])},endpoint));
 for(const suffix of ['/api/funding/usdc','/v1/jobs'])assert.throws(()=>check({url:'http://127.0.0.1:8080'+suffix,method:'POST',body:'{}'},endpoint));
 for(const body of ['[]','null','{}','[null]','not json'])assert.throws(()=>check({url:endpoint,method:'POST',body},endpoint));
});

test('MetaMask retained readiness imports the existing encrypted recovery through actual accessible input names only',async()=>{
 const {inspectMetaMaskAggregateReadiness}=await import('./t04-metamask.mjs');const events=[];
 const dialog={getByRole(role,{name}){assert.equal(role,'button');assert(['Unlock','Import recovery','Recover funding'].includes(name));return{or:()=>({first:()=>({waitFor:async()=>events.push('wait-surface')})}),isVisible:async()=>true,click:async()=>events.push(name),waitFor:async()=>events.push(name)};},getByLabel(name){assert(['Recovery password','Recovery file'].includes(name));return{fill:async()=>events.push(name),setInputFiles:async p=>{assert.equal(p,'/private/recovery/initial-recovery.json');events.push(name);}};}};
 const page={getByRole(role,options){if(role==='dialog')return dialog;assert.equal(options.name,'Your account');return{click:async()=>events.push('open')};}};
 await inspectMetaMaskAggregateReadiness({page,control:{password:'not-retained-in-report',recoveryDirectory:'/private/recovery'},mark:x=>events.push(x)});
 assert.deepEqual(events,['aggregate-retained-readiness','open','wait-surface','Unlock','Recovery password','Recovery file','Import recovery','Recover funding']);
});

test('MetaMask startup exception requires the pinned extension parent and exact sandboxed cache iframe',async()=>{
 const {isMetaMaskStartupFrameRequest:check}=await import('./t04-metamask.mjs');
 const extensionOrigin='chrome-extension://'+'a'.repeat(32),url='https://metamask.github.io/phishing-warning/v5.1.0/';
 const input={method:'GET',url,parentUrl:extensionOrigin+'/home.html',extensionOrigin,frameSource:url+'#extensionStartup',sandbox:'allow-scripts allow-same-origin'};assert.equal(check(input),true);
 for(const name of ['lockdown-install.js','lockdown-run.js','lockdown-more.js','bundle.js','design-tokens.css','index.css','warning-icon.svg'])assert.equal(check({...input,url:url+name}),true);
 for(const change of [{method:'POST'},{url:url+'?account=x'},{url:url+'../v5.2.0/script.js'},{url:'https://example.com/script.js'},{url:url+'script.js?account=x'},{parentUrl:'http://127.0.0.1:8080/'},{parentUrl:'chrome-extension://'+'b'.repeat(32)+'/home.html'},{frameSource:url+'#hostname=127.0.0.1'},{frameSource:url},{sandbox:'allow-scripts allow-same-origin allow-top-navigation'},{extensionOrigin:'chrome-extension://invalid'},{parentUrl:null}])assert.equal(check({...input,...change}),false);
});

test('MetaMask unfunded continuation rejects any saved journal or prior Ethereum/consent nonce',async()=>{
 const {assertMetaMaskUnfundedContinuation:check}=await import('./t04-metamask.mjs');const input={ethereumNonce:0,consentNonce:0n,emptyRecovery:true};check(input);
 for(const change of [{ethereumNonce:1},{ethereumNonce:'0'},{consentNonce:1n},{consentNonce:0},{emptyRecovery:false},{emptyRecovery:null},{emptyRecovery:undefined}])assert.throws(()=>check({...input,...change}));
});


test('paid MetaMask recovery binds encrypted scope, exact payment and all claim legs',async()=>{
 const {inspectMetaMaskPaidBinding}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 const network={chainId:'31337',rollupVersion:'17',rollupAddress:'rollup'},board={contractAddress:'board',portalAddress:'portal'},router='router',owner='owner';
 const intent={from:'payer',to:router,chainId:'31337',nonce:1,data:'0x1234',value:'9',expected:{planHash:'plan',kind:'aggregate-funding'}};
 const input={network,board,router,intent,transactionHash:hash};
 const funding={intent:structuredClone(intent),claim:{intentId:'claim'}};
 const claim={id:'claim',status:'confirmed',txHash:'0x'+'cd'.repeat(32),action:{type:'claim-deposit',receipt:{txHash:hash},feeReceipt:{txHash:hash},bokReceipt:{txHash:hash}}};
 // Labelled storage doubles exercise the exact function serialized into Playwright,
 // including both real application scope formats. No wallet/payment qualification.
 async function inspect(f=funding,c=claim){
  const slots=[];const window={walletState:{aztec:{address:{toString:()=>owner},secretKey:1,salt:2}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async args=>{slots.push(args);return {read:async()=>({value:args.keyDomain==='ROLLING_AGGREGATE_FUNDING_V1'?f:c})};}}};
  const result=await runInNewContext('('+inspectMetaMaskPaidBinding.toString()+')(input)',{window,input});
  assert.equal(slots[0].scopeText,JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1','31337','17','rollup','board','router',owner,1]));
  assert.equal(slots[1].scopeText,JSON.stringify(['ROLLING_WORKFLOW_V1',JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',owner,'31337','rollup','17','board','portal'])]));
  return JSON.parse(JSON.stringify(result));
 }
 assert.deepEqual(await inspect(),{paymentMatches:true,claimMatches:true,claimConfirmed:true,claimTxHash:claim.txHash,paymentSaved:true,claimPresent:true,attempted:false,workflowPrepared:false,workflowStatus:'confirmed',feeWithinSavedCap:null,explicitClaimReview:false});
 for(const mutate of [x=>x.intent.data='0x5678',x=>x.intent.nonce=2,x=>x.intent.expected.planHash='different',x=>x.relay={transactionHash:'0x'+'ef'.repeat(32)}]){const f=structuredClone(funding);mutate(f);assert.equal((await inspect(f)).paymentMatches,false);}
 assert.equal((await inspect(null)).paymentMatches,false);
 const paidUsdc={...intent,from:'relayer',nonce:0,value:'0',expected:{...intent.expected,kind:'aggregate-usdc-funding'}},request={...paidUsdc};delete request.nonce;const prior=input.intent;input.intent=paidUsdc;const relayFunding={intent:null,relay:{submitted:true,request,transactionHash:hash},claim:{intentId:'claim'}};assert.equal((await inspect(relayFunding)).paymentMatches,true);assert.equal((await inspect(relayFunding)).claimMatches,true);assert.equal((await inspect({...relayFunding,relay:{...relayFunding.relay,request:{...request,from:'beneficiary'}}})).paymentMatches,false);input.intent=prior;
 for(const mutate of [x=>x.id='another',x=>x.action.type='claim-bok',...['receipt','feeReceipt','bokReceipt'].map(k=>x=>x.action[k].txHash='0x'+'ef'.repeat(32))]){const c=structuredClone(claim);mutate(c);assert.equal((await inspect(funding,c)).claimMatches,false);}
 assert.equal((await inspect(funding,{...claim,status:'submitted'})).claimConfirmed,false);
 assert.equal((await inspect(funding,null)).claimConfirmed,false);
 const usdc={relay:{request:structuredClone(intent),transactionHash:hash},claim:funding.claim};delete usdc.relay.request.nonce;
 assert.equal((await inspect(usdc)).claimConfirmed,true);
 const reviewed={...funding,privateFeeCap:'10',explicitClaimReview:true,claim:{...funding.claim,attempted:true}},prepared={...claim,status:'prepared',maximumFee:'10'};
 const state=await inspect(reviewed,prepared);assert.equal(state.feeWithinSavedCap,true);assert.equal(state.attempted,true);assert.equal(state.workflowPrepared,true);assert.equal(state.explicitClaimReview,true);
 assert.equal((await inspect(reviewed,{...prepared,maximumFee:'11'})).feeWithinSavedCap,false);
 for(const value of [undefined,'private-amount','-1','9'.repeat(78)])assert.equal((await inspect(reviewed,{...prepared,maximumFee:value})).feeWithinSavedCap,null);
 assert.equal((await inspect(reviewed,{...prepared,id:'unrelated'})).feeWithinSavedCap,null);
 assert.equal((await inspect(null,null)).paymentSaved,false);assert.equal((await inspect(null,null)).workflowStatus,'absent');
 assert.equal((await inspect(reviewed,{...prepared,status:'private-status'})).workflowStatus,'other');
 assert(!JSON.stringify(state).includes('privateFeeCap'));assert(!Object.values(state).includes('10'));
});

test('paid recovery surface projects only closed visible notices and controls',async()=>{
 const {inspectMetaMaskPaidRecoverySurface}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 const notice={'claim-confirmed':'Transaction confirmed on the verified chain.','claim-confirmed-feed-unavailable':'Transaction confirmed on the verified chain. Public feed refresh is unavailable; the transaction remains confirmed.',success:'Funding and the private claim are confirmed. Your posting deposit, network fees and Bok credit are ready.','review-saved':'This saved claim has not been submitted. Review it explicitly before sending; the Ethereum payment will not repeat.',review:'The private claim needs a new review. No additional Ethereum payment will be sent.',reverted:'The private claim reverted. Review recovery; do not repeat the Ethereum payment.','waiting-bridge':'Payment confirmed. Waiting for the bridge; no second Ethereum payment will be requested.',pending:'Checking the saved private claim. It will not be submitted again.'};
 const node=(textContent,shown=true,disabled=false)=>({textContent,disabled,getClientRects:()=>shown?[{}]:[]});
 function inspect({text='PRIVATE_SENTINEL',busy=false,alert=false,hidden=false,confirm=false,settledOnly=false}={}){
  const dialog={getAttribute:key=>{assert.equal(key,'aria-busy');return String(busy);},querySelectorAll:selector=>selector==='.notice'?[node(text,!hidden)]:selector==='[role="alert"]'?alert?[node('PRIVATE_SENTINEL')]:[]:[node('Pause bridge checks',true,busy),node('Confirm and send',confirm),node('PRIVATE_SENTINEL')]};
  return runInNewContext('('+inspectMetaMaskPaidRecoverySurface.toString()+')(input)',{document:{querySelector:selector=>{assert.equal(selector,'dialog[open]');return dialog;}},input:{settledOnly}});
 }
 for(const [state,text]of Object.entries(notice)){const result=inspect({text});assert.equal(result.state,state);assert.equal(result.notices[0],state);assert.equal(inspect({text,busy:true,settledOnly:true}),null);assert.equal(inspect({text,hidden:true}).state,'unknown');}
 assert.equal(inspect({alert:true}).state,'error');assert.equal(inspect({confirm:true}).state,'review');assert.equal(inspect({settledOnly:true}),null);
 for(const input of [{},{alert:true},{text:notice.success,alert:true}])assert(!JSON.stringify(inspect(input)).includes('PRIVATE_SENTINEL'));
 assert.equal(inspect({text:notice.success,alert:true}).state,'error');
});

for(const state of ['success','review','review-saved','reverted','error','waiting-bridge','pending','timeout'])test('paid recovery observes one classified advance without new approval: '+state,async()=>{
 const {observeMetaMaskPaidRecovery,inspectMetaMaskPaidRecoverySurface,inspectMetaMaskPaidBinding}=await import('./t04-metamask.mjs');
 const events=[],original=Error('controlled timeout'),binding={},report={},surface={state:state==='timeout'?'unknown':state,buttons:{pause:{enabled:true}}};
 const page={async waitForFunction(fn,arg,options){assert.equal(fn,inspectMetaMaskPaidRecoverySurface);assert.deepEqual(arg,{settledOnly:true});assert.deepEqual(options,{timeout:80000});events.push('wait');if(state==='timeout')throw original;return{jsonValue:async()=>surface,dispose:async()=>events.push('dispose')};},async evaluate(fn,arg){if(fn===inspectMetaMaskPaidRecoverySurface){events.push('surface');return surface;}assert.equal(fn,inspectMetaMaskPaidBinding);assert.equal(arg,binding);events.push('saved');return{paymentSaved:true,claimPresent:false};}};
 const dialog={getByRole(role,options){assert.equal(role,'button');assert.deepEqual(options,{name:'Pause bridge checks',exact:true});return{click:async()=>events.push('pause')};}};
 const result=observeMetaMaskPaidRecovery({page,dialog,binding,report});if(state==='timeout')await assert.rejects(result,error=>error===original);else assert.equal(await result,surface);
 assert.deepEqual(events,state==='timeout'?['wait','surface','saved']:['waiting-bridge','pending'].includes(state)?['wait','pause','dispose','saved']:['wait','dispose','saved']);
 assert.equal(report.paidRecoveryObservation.surface,surface);assert.equal(report.paidRecoveryObservation.saved.paymentSaved,true);
});

test('paid recovery diagnostic failures cannot replace the original wait failure',async()=>{
 const {observeMetaMaskPaidRecovery}=await import('./t04-metamask.mjs');const original=0,report={};
 await assert.rejects(observeMetaMaskPaidRecovery({page:{async waitForFunction(){throw original;},async evaluate(){throw Error('PRIVATE_SENTINEL');}},report}),error=>error===original);
 assert.deepEqual(report.paidRecoveryObservation,{surfaceUnavailable:true,savedUnavailable:true});assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('paid recovery permits only the exact non-signing MetaMask account permission',async()=>{
 const {installMetaMaskPaidRecoveryGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 const states=[],forwarded=[],denied=[],provider={async request(request){assert.equal(this,provider);forwarded.push(request);return 'selected';}};
 runInNewContext('('+installMetaMaskPaidRecoveryGuard.toString()+')()',{__testMetaMask:provider,window:{__paidRecoveryDenied:async method=>denied.push(method),__paidRecoveryPermission:async state=>states.push(state)}});
 const permission={method:'wallet_requestPermissions',params:[{eth_accounts:{}}]};
 assert.equal(await provider.request(permission),'selected');assert.equal(forwarded[0],permission);
 for(const method of ['eth_accounts','eth_requestAccounts','eth_chainId'])assert.equal(await provider.request({method}),'selected');
 for(const params of [undefined,null,[],[{}],[{eth_accounts:null}],[{eth_accounts:[]}],[{eth_accounts:{caveats:[]}}],[{eth_accounts:{},eth_sendTransaction:{}}],[{eth_accounts:{}},{}]])await assert.rejects(provider.request({method:'wallet_requestPermissions',params}),/forbids/);
 for(const method of ['eth_sendTransaction','eth_signTypedData_v4','personal_sign','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_revokePermissions','private payload with spaces'])await assert.rejects(provider.request({method,params:['never forwarded']}),/forbids/);
 assert.deepEqual(states,['entered','resolved']);assert.equal(forwarded.length,4);assert.equal(denied.length,16);assert.equal(denied.at(-1),'unknown');
 assert(denied.every(method=>method==='unknown'||/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(method)));
});

test('paid recovery account selection retains original provider rejection',async()=>{
 const {installMetaMaskPaidRecoveryGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');const original={code:4001};let denied=0;
 const provider={async request(){throw original;}};runInNewContext('('+installMetaMaskPaidRecoveryGuard.toString()+')()',{__testMetaMask:provider,window:{__paidRecoveryDenied:async()=>denied++}});
 await assert.rejects(provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]}),error=>error===original);assert.equal(denied,0);
});

for(const outcome of ['delayed-connect','other-confirmation','warning-confirmation','missing-prompt'])test('paid recovery waits for authentic MetaMask account selection: '+outcome,async()=>{
 const {confirmMetaMaskRecoveryAccountSelection}=await import('./t04-metamask.mjs');const events=[],original=Error('prompt unavailable');let visible=false;
 const confirm={async waitFor(){events.push('wait');await new Promise(resolve=>setImmediate(resolve));if(outcome==='missing-prompt')throw original;visible=true;},async innerText(){assert(visible);events.push('label');return outcome==='other-confirmation'?'Sign':outcome==='warning-confirmation'?'Continue at your own risk':' Connect ';},async click(){assert(visible);events.push('click');}};
 const run=confirmMetaMaskRecoveryAccountSelection({getByTestId(id){assert.equal(id,'confirm-btn');return confirm;}});
 if(outcome==='missing-prompt'){await assert.rejects(run,error=>error===original);assert.deepEqual(events,['wait']);}
 else if(['other-confirmation','warning-confirmation'].includes(outcome)){await assert.rejects(run,/Connect/);assert.deepEqual(events,['wait','label']);}
 else{await run;assert.deepEqual(events,['wait','label','click']);}
});


test('MetaMask startup cache worker permits only pinned static reads after a verified frame',async()=>{
 const {isMetaMaskStartupWorkerRequest:check}=await import('./t04-metamask.mjs');
 const base='https://metamask.github.io/phishing-warning/v5.1.0/',good={method:'GET',url:base+'workbox-e6d70522.js',workerUrl:base+'service-worker.js',startupFrameObserved:true};
 assert.equal(check(good),true);assert.equal(check({...good,url:base+'bundle.js?__WB_REVISION__='+'a'.repeat(32)}),true);
 for(const change of [{method:'POST'},{startupFrameObserved:false},{workerUrl:'http://127.0.0.1/service-worker.js'},{url:base+'unknown.js'},{url:base+'bundle.js?private=data'},{url:base+'../bundle.js'},{url:base+'bundle.js#secret'}])assert.equal(check({...good,...change}),false);
});

for(const mode of ['delayed-unlock','already-loaded','load-failure'])test('retained readiness waits for actual account surface: '+mode,async()=>{
 const {inspectMetaMaskAggregateReadiness}=await import('./t04-metamask.mjs');const events=[];let appeared=mode==='already-loaded',unlocked=mode==='already-loaded';const original=Error('surface unavailable');
 const ready={first(){return this;},async waitFor(){events.push('wait-surface');await new Promise(resolve=>setImmediate(resolve));if(mode==='load-failure')throw original;appeared=true;}};
 const unlock={or(other){assert.equal(other,password);return ready;},async isVisible(){return appeared&&!unlocked;},async click(){assert(appeared);unlocked=true;events.push('unlock');}};
 const password={async fill(value){assert(unlocked,'Recovery input cannot exist before the delayed Unlock');assert.equal(value,'test-password');events.push('password');}};
 const dialog={getByRole(role,{name}){assert.equal(role,'button');if(name==='Unlock')return unlock;return{async click(){assert.equal(name,'Import recovery');assert(unlocked);events.push('import');},async waitFor(){assert.equal(name,'Recover funding');events.push('ready');}};},getByLabel(name){if(name==='Recovery password')return password;assert.equal(name,'Recovery file');return{async setInputFiles(value){assert.equal(value,'/private/recovery/initial-recovery.json');assert(unlocked);events.push('file');}};}};
 const page={getByRole(role,{name}={}){if(role==='dialog')return dialog;assert.equal(name,'Your account');return{async click(){events.push('open');}};}};
 const run=inspectMetaMaskAggregateReadiness({page,control:{password:'test-password',recoveryDirectory:'/private/recovery'},mark:()=>{}});
 if(mode==='load-failure'){await assert.rejects(run,error=>error===original);assert.deepEqual(events,['open','wait-surface']);}
 else{await run;assert.deepEqual(events,['open','wait-surface',...(mode==='delayed-unlock'?['unlock']:[]),'password','file','import','ready']);}
});

function retainedBokFixture(){
 const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),config={network:{chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20)},board:{contractAddress:field(1),portalAddress:'portal'},bok:{contractAddress:field(2),operatorAddress:field(3),pluginId:field(4)}};
 const control={runtimeSha256:'a'.repeat(64),walletConfig:{config},allocation:{bokAmount:'100',feeAmount:'1000'}};
 const approval={schemaVersion:1,runtimeSha256:control.runtimeSha256,content:'test request',contentSha256:'',budget:'100',authorizeFeeCap:'100',postFeeCap:'200',expiresAt:Date.now()+300000,publicScope:{...config.network,boardAddress:config.board.contractAddress,classId:field(20),bok:{address:config.bok.contractAddress,classId:field(21),operatorAddress:config.bok.operatorAddress,deployer:config.bok.operatorAddress,salt:field(22),deployment:{blockNumber:1,blockHash:hash,txHash:hash}}}};
 const record={id:field(10),nonce:'private-nonce',action:{type:'bok',content:approval.content,subboard:'0',name:'0',budget:'100',deposit:'private-deposit'},maximumFee:'90',status:'prepared',bok:{phase:'authorize',scope:{address:config.bok.contractAddress,pluginId:config.bok.pluginId},requestId:field(11),target:field(12),budget:'100'}};
 return {field,config,control,approval,record};
}
test('retained Bok opt-in defaults to no action and bounds exact approval before launch',async()=>{
 const {validateRetainedBokApproval,readRetainedBokApproval}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedBokFixture();f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');
 assert.equal(readRetainedBokApproval(undefined,f.control),null);assert.throws(()=>readRetainedBokApproval('/private/a',f.control));assert.throws(()=>readRetainedBokApproval('/private/a',f.control,{enabled:true}));assert.deepEqual(validateRetainedBokApproval(f.approval,f.control),f.approval);
 for(const change of [a=>a.content+='changed',a=>a.budget='101',a=>a.authorizeFeeCap='900',a=>a.runtimeSha256='b'.repeat(64),a=>a.expiresAt=Date.now()-1,a=>a.expiresAt=Date.now()+3600001,a=>a.publicScope.bok.address=f.field(99),a=>delete a.publicScope.classId,a=>delete a.publicScope.bok.deployment,a=>a.publicScope.bok.deployment.blockNumber=0,a=>a.extra=true]){const a=structuredClone(f.approval);change(a);assert.throws(()=>validateRetainedBokApproval(a,f.control));}
});
test('retained Bok thread approval requires both exact public IDs and rejects mixed root/reply modes',async()=>{
 const {validateRetainedBokApproval:validate}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedBokFixture();f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');
 for(const pair of [{parent:'0',root:'0'},{parent:'12',root:'10'}]){const a={...f.approval,...pair};assert.deepEqual(validate(a,f.control),a);}
 for(const pair of [{parent:'1'},{root:'1'},{parent:'0',root:'1'},{parent:'1',root:'0'},{parent:1,root:'1'},{parent:'01',root:'1'}])assert.throws(()=>validate({...f.approval,...pair},f.control));
});
test('retained Bok approval file requires private regular owned input',async t=>{
 const {readRetainedBokApproval}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedBokFixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-approval-')),file=path.join(dir,'approval.json');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');await fs.writeFile(file,JSON.stringify(f.approval),{mode:0o600});assert.deepEqual(readRetainedBokApproval(file,f.control,{enabled:true,paidRecovery:true}),f.approval);
 await fs.chmod(file,0o644);assert.throws(()=>readRetainedBokApproval(file,f.control,{enabled:true,paidRecovery:true}));await fs.chmod(file,0o600);await fs.symlink(file,path.join(dir,'link'));assert.throws(()=>readRetainedBokApproval(path.join(dir,'link'),f.control,{enabled:true,paidRecovery:true}));
});
test('retained Bok saved workflow keeps private identifiers in page until confirmed public post',async()=>{
 const {inspectRetainedBokWorkflow,assertRetainedBokReview}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),f=retainedBokFixture();let record=f.record;
 const window={walletState:{aztec:{address:{toString:()=> 'private-owner'},secretKey:'private-secret',salt:'private-salt'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async()=>({read:async()=>({value:record})})}};
 const run=async(input)=>JSON.parse(JSON.stringify(await runInNewContext(`(${inspectRetainedBokWorkflow})`,{window})( {config:f.config,approval:f.approval,...input})));
 const prepared=await run({phase:'authorize',status:'prepared',capture:true});assertRetainedBokReview(prepared);assert(!JSON.stringify(prepared).includes('private'));assert.equal(prepared.public,undefined);
 record.status='confirmed';record.txHash=f.field(20);assertRetainedBokReview(await run({phase:'authorize',status:'confirmed',capture:true}));
 record={...record,status:'prepared',txHash:null,bok:{...record.bok,phase:'post',authorizationTxHash:f.field(20)}};assertRetainedBokReview(await run({phase:'post',status:'prepared'}));assert.equal((await run({phase:'post',status:'prepared',published:true})).public,undefined);
 record.status='confirmed';record.txHash=f.field(21);const published=await run({phase:'post',status:'confirmed',published:true});assertRetainedBokReview(published,{published:true});assert.deepEqual(published.public,{transactionHash:f.field(21),authorizationTxHash:f.field(20),requestId:'11',target:'12'});
 for(const change of [r=>r.action.content+='changed',r=>r.action.parent='8',r=>r.action.root='7',r=>r.maximumFee='201',r=>r.nonce='different',r=>r.bok.requestId=f.field(99),r=>r.bok.authorizationTxHash=f.field(99),r=>r.status='unknown']){const before=structuredClone(record);change(record);const result=await run({phase:'post',status:'confirmed',published:true});assert.throws(()=>assertRetainedBokReview(result,{published:true}));record=before;}
});

test('retained Bok UI confirms only two exact saved reviews and stops before any invalid confirmation',async()=>{
 const {driveRetainedBokConfirmations}=await import('./t04-metamask.mjs');
 for(const failure of [null,'authorize-prepared','authorize-confirmed','post-prepared']){
  const events=[],original={failure},approval={content:'PRIVATE_LOCAL_PROMPT',budget:'100'},report={retainedBok:{}};
  const node=name=>({or(){return this;},first(){return this;},isVisible:async()=>true,async click(){events.push('click:'+name);},async waitFor(){events.push('wait:'+name);},async fill(){events.push('fill:'+name);},async selectOption(value){assert.equal(value,'bok');events.push('select');}});
  const dialog={getByRole:(_,o)=>node(o.name),getByLabel:name=>node(name),getByText:text=>node(text)};
  const inspect=async(phase,status)=>{events.push('inspect:'+phase+'-'+status);if(failure===phase+'-'+status)throw original;return {public:{transactionHash:hash}};};
  const run=driveRetainedBokConfirmations({dialog,approval,inspect,mark:()=>{},report});
  if(failure)await assert.rejects(run,e=>e===original);else assert.deepEqual(await run,{transactionHash:hash});
  assert.equal(events.filter(x=>x==='click:Confirm and send').length,failure==='authorize-prepared'?0:failure?1:2);
  for(const [i,event]of events.entries())if(event==='click:Confirm and send')assert.equal(events[i-1],i===events.indexOf(event)?'inspect:authorize-prepared':'inspect:post-prepared');
  assert(!JSON.stringify(report).includes(approval.content));
 }
});

test('retained Bok public discovery uses only public post IDs and uniform bounded accounting pages',async()=>{
 const {discoverRetainedBokCompletion}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),scope={public:true},cursor='a'.repeat(32)+':'+'b'.repeat(64)+':'+'c'.repeat(16),paths=[];
 const parent={id:'10',invocation:{reply:'20'}},reply={id:'20',bot:{}},accounting={requestId:'30',state:'4'};
 const pages=[{post:parent},{post:reply},{revision:'fixed',checkpoint:{number:1,hash},requests:[],nextCursor:cursor},{revision:'fixed',checkpoint:{number:1,hash},requests:[accounting],nextCursor:null}];
 const fetch=async path=>{paths.push(path);const body=pages.shift();return{ok:true,status:200,text:async()=>JSON.stringify({complete:true,scope,...body})};};
 const actual=await runInNewContext(`(${discoverRetainedBokCompletion})`,{fetch,AbortSignal,encodeURIComponent})({postId:'10',requestId:'30',scope});
 assert.deepEqual(JSON.parse(JSON.stringify(actual)),{parent,reply,accounting,checkpoint:{number:1,hash}});assert.deepEqual(paths,['/api/post?id=10','/api/post?id=20','/api/bok-accounting?limit=100','/api/bok-accounting?limit=100&cursor='+encodeURIComponent(cursor)]);assert(!paths.some(x=>x.includes('30')));
});

test('retained Bok canonical event checks reject wrong reply linkage and unfinished or dishonest accounting',async()=>{
 const {assertRetainedBokEvents}=await import('./t04-metamask.mjs'),p={requestId:'30',target:'40'},position={txHash:hash},post={id:'10',record:{root:'10',parent:'0'}},reply={id:'20',record:{root:'10',parent:'10',kind:'4'}},accounting={request_id:'30',state:'4',sequence:'1',budget:'100',available:'0',reserved:'0',charged:'6',refunded:'94'};
 const content='original',contentSha256=(await import('node:crypto')).createHash('sha256').update(content).digest('hex');post.length=String(Buffer.byteLength(content));post.message=[BigInt('0x'+Buffer.from(content).toString('hex').padEnd(62,'0')).toString(),...Array(31).fill('0')];
 const base={publicIntent:p,pluginId:'5',approval:{budget:'100',content,contentSha256},postEvents:[{type:'PluginInvoked',payload:{request_id:'30',target:'40',plugin_id:'5',post_id:'10'}},{type:'PostPublished',payload:post}],replyEvents:[{type:'PluginReplyPublished',payload:{request_id:'30',target:'40',plugin_id:'5',parent_id:'10',post_id:'20'},position},{type:'PostPublished',payload:reply,position}],accountingEvents:[{type:'AccountingChanged',payload:accounting}],discovered:{parent:{id:'10'},reply:{id:'20',position},accounting:{...accounting}}};
 assert.deepEqual(assertRetainedBokEvents(base),{canonicalReply:true,canonicalTerminalAccounting:true,charged:'6',refunded:'94'});
 const threaded=structuredClone(base);threaded.approval.parent='8';threaded.approval.root='7';threaded.postEvents[1].payload.record={root:'7',parent:'8'};threaded.replyEvents[1].payload.record.root='7';assert.equal(assertRetainedBokEvents(threaded).canonicalReply,true);for(const change of [b=>b.postEvents[1].payload.record.parent='9',b=>b.postEvents[1].payload.record.root='8',b=>b.replyEvents[1].payload.record.root='10']){const bad=structuredClone(threaded);change(bad);assert.throws(()=>assertRetainedBokEvents(bad));}
 for(const change of [b=>b.approval.content='different',b=>b.approval.contentSha256='0'.repeat(64),b=>b.postEvents[1].payload.message[0]='0',b=>b.replyEvents[0].payload.target='41',b=>b.replyEvents[1].payload.record.kind='0',b=>b.accountingEvents[0].payload.state='3',b=>b.accountingEvents[0].payload.reserved='1',b=>b.accountingEvents[0].payload.refunded='100',b=>b.accountingEvents[0].payload.charged='0',b=>b.discovered.accounting.charged='7',b=>b.replyEvents.push(b.replyEvents[0])]){const bad=structuredClone(base);change(bad);assert.throws(()=>assertRetainedBokEvents(bad));}
});

test('retained Bok discovery fails closed on mixed snapshots, duplicate matches and pagination exhaustion',async()=>{
 const {discoverRetainedBokCompletion}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),scope={public:true},cursor='a'.repeat(32)+':'+'b'.repeat(64)+':'+'c'.repeat(16);
 for(const mode of ['mixed','duplicate','exhausted','wrong-scope']){
  let calls=0;const paths=[];
  const fetch=async path=>{paths.push(path);let value;if(calls++===0)value={post:{invocation:{reply:'20'}}};else if(calls===2)value={post:{bot:{}}};else value={revision:mode==='mixed'&&calls>3?'changed':'one',checkpoint:{number:1,hash},requests:mode==='duplicate'?[{requestId:'30',state:'4'},{requestId:'30',state:'4'}]:[],nextCursor:cursor.slice(0,-2)+(calls%256).toString(16).padStart(2,'0')};return{ok:true,status:200,text:async()=>JSON.stringify({complete:true,scope:mode==='wrong-scope'?{}:scope,...value})};};
  const run=runInNewContext(`(${discoverRetainedBokCompletion})`,{fetch,AbortSignal,encodeURIComponent})({postId:'10',requestId:'30',scope});
  if(mode==='mixed')assert.equal(await run,false);else await assert.rejects(run,/BOK_PUBLIC_/);assert(paths.length<=10);
 }
});

test('explicit prepared claim review flag is default-off and paid-recovery-only',async()=>{
 const {retainedPreparedClaimFlag:flag}=await import('./t04-metamask.mjs');
 assert.equal(flag(undefined),false);assert.equal(flag('false'),false);assert.equal(flag('true',{paidRecovery:true}),true);
 for(const value of ['',true,'TRUE','1'])assert.throws(()=>flag(value,{paidRecovery:true}));
 for(const mode of [{},{paidRecovery:true,readinessOnly:true},{paidRecovery:true,continueUnfunded:true}])assert.throws(()=>flag('true',mode));
});
test('prepared claim review binds original encrypted records, three receipts, empty journal and saved cap',async()=>{
 const {inspectMetaMaskPaidBinding}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 const input={network:{chainId:'31337',rollupVersion:'17',rollupAddress:'rollup'},board:{contractAddress:'board',portalAddress:'portal'},router:'router',transactionHash:hash,intent:{from:'payer',to:'router',chainId:'31337',nonce:1,data:'0x1234',value:'9',expected:{planHash:'plan'}}};
 const original={funding:{intent:structuredClone(input.intent),privateFeeCap:'10',claim:{intentId:'claim',attempted:true}},claim:{id:'claim',status:'prepared',maximumFee:'10',action:{type:'claim-deposit',receipt:{txHash:hash},feeReceipt:{txHash:hash},bokReceipt:{txHash:hash}}},journal:null};
 function fixture(mutate=()=>{}){
  const records=structuredClone(original);mutate(records);
  const window={walletState:{aztec:{address:{toString:()=> 'private-owner'},secretKey:'private-secret',salt:1}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async({keyDomain})=>({read:async()=>({value:keyDomain==='ROLLING_AGGREGATE_FUNDING_V1'?records.funding:keyDomain==='ROLLING_WORKFLOW_V1'?records.claim:records.journal})})}};
  const read=preparedReview=>runInNewContext('('+inspectMetaMaskPaidBinding.toString()+')(input)',{window,input:{...input,preparedReview}});
  return {records,read};
 }
 const good=fixture();assert.equal((await good.read('capture')).preparedReviewAllowed,true);assert.equal((await good.read('consume')).preparedReviewAllowed,true);assert.equal((await good.read('consume')).preparedReviewAllowed,false);assert.equal((await good.read('capture')).preparedReviewAllowed,false);
 const mutations=[r=>r.funding.intent.data='0x5678',r=>r.funding.privateFeeCap='9',r=>r.claim.maximumFee='11',r=>delete r.funding.privateFeeCap,r=>r.funding.claim.attempted=false,r=>r.claim.id='other',r=>r.claim.action.type='post',...['submitting','submitted','unknown','confirmed','reverted','cancelled'].map(status=>r=>r.claim.status=status),...['receipt','feeReceipt','bokReceipt'].map(k=>r=>r.claim.action[k].txHash='0x'+'ff'.repeat(32)),r=>r.claim.txHash=hash,r=>r.journal={operation:'anything',txHash:hash}];
 for(const mutate of mutations)assert.equal((await fixture(mutate).read('capture')).preparedReviewAllowed,false);
 for(const mutate of [r=>r.claim.maximumFee='9',r=>r.funding.privateFeeCap='11',r=>r.claim.nonce='different',r=>r.funding.claim.explicitReview=true,r=>r.journal={txHash:hash}]){
  const f=fixture();assert.equal((await f.read('capture')).preparedReviewAllowed,true);mutate(f.records);assert.equal((await f.read('consume')).preparedReviewAllowed,false);
 }
 const absent=fixture();assert.equal((await absent.read('consume')).preparedReviewAllowed,false);assert.equal((await absent.read('invalid')).preparedReviewAllowed,false);
 const safe=JSON.stringify(await fixture().read('capture'));for(const privateValue of ['private-owner','private-secret','0x1234','privateFeeCap','"10"'])assert(!safe.includes(privateValue));
});
test('prepared claim confirms exactly once through existing UI after two original-record checks',async()=>{
 const {confirmMetaMaskPreparedClaim:confirm}=await import('./t04-metamask.mjs');
 const surface={state:'review-saved',busy:false,buttons:{confirm:{enabled:true}}};
 function fixture({allowed=[true,true],clickError}={}){const events=[],report={confirmations:0};return {events,report,args:{enabled:true,surface,report,binding:{transactionHash:hash},page:{evaluate:async(_fn,input)=>{events.push(input.preparedReview);return {preparedReviewAllowed:allowed.shift()};}},dialog:{getByRole:(role,options)=>{assert.equal(role,'button');assert.deepEqual(options,{name:'Confirm and send',exact:true});return {click:async()=>{events.push('confirm');if(clickError!==undefined)throw clickError;}};}}}};}
 const f=fixture();await confirm(f.args);assert.deepEqual(f.events,['capture','consume','confirm']);await assert.rejects(confirm(f.args));assert.equal(f.report.confirmations,1);assert.equal(f.events.length,3);
 for(const allowed of [[false],[true,false]]){const f=fixture({allowed});await assert.rejects(confirm(f.args));assert(!f.events.includes('confirm'));assert.equal(f.report.confirmations,0);}
 for(const change of [{enabled:false},{surface:{...surface,state:'review'}},{surface:{...surface,busy:true}},{surface:{...surface,buttons:{confirm:{enabled:false}}}}]){const f=fixture();await assert.rejects(confirm({...f.args,...change}));assert.equal(f.events.length,0);}
 const failed=fixture({clickError:false});await assert.rejects(confirm(failed.args),e=>e===false);await assert.rejects(confirm(failed.args));assert.equal(failed.events.filter(x=>x==='confirm').length,1);
});

for(const prepared of [false,true])test('explicit retained readiness recognizes restored prepared surface: '+prepared,async()=>{
 const {inspectMetaMaskAggregateReadiness:inspect}=await import('./t04-metamask.mjs');const events=[];
 const controls=Object.fromEntries(['Unlock','Import recovery','Recover funding','Confirm and send'].map(name=>[name,{waitFor:async()=>{events.push('wait:'+name);if(name==='Recover funding'&&prepared)throw Error('wrong surface');},click:async()=>events.push('click:'+name),isVisible:async()=>name==='Recover funding'?!prepared:name==='Unlock',or(other){return{first:()=>({waitFor:async()=>{assert(name==='Unlock'||name==='Recover funding');if(name==='Recover funding')assert.equal(other,controls['Confirm and send']);events.push('wait:either:'+name);}})};}}]));
 const dialog={getByRole:(_,{name})=>controls[name],getByLabel:name=>({fill:async()=>events.push(name),setInputFiles:async()=>events.push(name)})},page={getByRole:role=>role==='dialog'?dialog:{click:async()=>events.push('open')}};
 assert.equal(await inspect({page,control:{password:'private',recoveryDirectory:'/private/recovery'},mark:()=>{},allowPrepared:true}),prepared?'prepared':'funding');
 assert(events.includes('wait:either:Recover funding'));assert(!events.includes('click:Confirm and send'));
 if(prepared)await assert.rejects(inspect({page,control:{password:'private',recoveryDirectory:'/private/recovery'},mark:()=>{}}),/wrong surface/);
});
test('restored prepared confirmation still requires explicit mode and original-record checks',async()=>{
 const {confirmMetaMaskPreparedClaim:confirm}=await import('./t04-metamask.mjs');const events=[],report={confirmations:0},surface={state:'review',busy:false,buttons:{confirm:{enabled:true}}};
 const args={enabled:true,restoredPrepared:true,surface,report,binding:{},page:{evaluate:async(_,{preparedReview})=>{events.push(preparedReview);return{preparedReviewAllowed:true};}},dialog:{getByRole:(_,{name})=>({click:async()=>events.push(name)})}};
 await assert.rejects(confirm({...args,enabled:false}));await assert.rejects(confirm({...args,restoredPrepared:false}));assert.equal(events.length,0);
 await confirm(args);assert.deepEqual(events,['capture','consume','Confirm and send']);await assert.rejects(confirm(args));assert.equal(events.length,3);
});

test('existing browser owner grants application budget only to explicit aggregate Bok continuation',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./run-bounded-browser-check.mjs',import.meta.url),'utf8');
 const body=source.match(/export function browserCheckDeadline\([\s\S]*?\n}/)[0].replace('export ','');const choose=runInNewContext('('+body+')');
 assert.equal(choose({walletExtension:true,aggregate:true}),120000);assert.equal(choose({walletExtension:true,aggregate:true,retainedBok:'false'}),120000);
 assert.equal(choose({walletExtension:true,aggregate:true,retainedBok:'true'}),540000);assert.equal(choose({passkey:true}),60000);assert.equal(choose({}),540000);
 for(const input of [{retainedBok:'true'},{walletExtension:true,retainedBok:'true'},{walletExtension:true,aggregate:true,retainedBok:'1'}])assert.throws(()=>choose(input));
 assert(source.includes('T04_BROWSER_DEADLINE_AT:String(browserDeadlineAt)'));assert(source.includes('Date.now()+deadlineMs-15000'));
});
test('Bok canonical phases consume one original deadline rather than restarting wait budgets',async()=>{
 const {retainedBokRemaining}=await import('./t04-metamask.mjs');let now=1000;const remaining=retainedBokRemaining(526000,()=>now);assert.equal(remaining(),525000);now+=120000;assert.equal(remaining(),405000);now+=400000;assert.equal(remaining(),5000);now+=5000;assert.throws(remaining);
 for(const deadline of [NaN,Infinity,1000,526001])assert.throws(()=>retainedBokRemaining(deadline,()=>1000));
});

for(const phase of ['authorize','post'])test('Bok deadline expiring during '+phase+' inspection prevents its confirmation',async()=>{
 const {driveRetainedBokConfirmations}=await import('./t04-metamask.mjs');let expired=false,clicks=0;const waits=[];
 const node=name=>({or(){return this;},first(){return this;},isVisible:async()=>true,click:async()=>{if(name==='Confirm and send')clicks++;},waitFor:async options=>{waits.push(options?.timeout);},fill:async()=>{},selectOption:async()=>{}});
 const dialog={getByRole:(_,{name})=>node(name),getByLabel:node,getByText:node};
 await assert.rejects(driveRetainedBokConfirmations({dialog,approval:{},report:{retainedBok:{}},mark:()=>{},inspect:async(p,status)=>{if(p===phase&&status==='prepared')expired=true;return{};},remaining:()=>{assert(!expired,'expired');return 1234;}}),/expired/);
 assert.equal(clicks,phase==='authorize'?0:1);assert(waits.every(x=>x===1234));
});
test('installed Playwright async false predicate is a truthy Promise; awaited discovery does not finish early',async()=>{
 const {runInNewContext}=await import('node:vm'),{waitRetainedBokCompletion,discoverRetainedBokCompletion}=await import('./t04-metamask.mjs');
 const source=await fs.readFile(new URL('../node_modules/playwright-core/lib/coreBundle.js',import.meta.url),'utf8'),start=source.indexOf('const next = () => {',source.indexOf('async waitForFunctionExpression(')),end=source.indexOf('\n            next();',start);
 assert(start>0&&end>start);const tick=source.slice(start,end);let fulfill,reject,timers=0;const result=new Promise((a,b)=>{fulfill=a;reject=b;});
 runInNewContext(tick+'\nnext();',{aborted:false,predicate:async()=>false,fulfill,reject,polling:1000,injected:{utils:{builtins:{setTimeout:()=>timers++}}}});
 assert.equal(await result,false);assert.equal(timers,0);
 let reads=0,delays=0;const completed={parent:{id:'1'},reply:{id:'2'},accounting:{state:'4'}},page={evaluate:async fn=>{assert.equal(fn,discoverRetainedBokCompletion);return ++reads<3?false:completed;},waitForTimeout:async ms=>{assert.equal(ms,1000);delays++;}};
 assert.equal(await waitRetainedBokCompletion({page,input:{},remaining:()=>10000}),completed);assert.equal(reads,3);assert.equal(delays,2);
 await assert.rejects(waitRetainedBokCompletion({page:{evaluate:async()=>({}),waitForTimeout:async()=>{}},input:{},remaining:()=>10000}));
 let checks=0;await assert.rejects(waitRetainedBokCompletion({page:{evaluate:async()=>false},input:{},remaining:()=>{if(++checks>1)throw Error('expired');return 1000;}}),/expired/);
});
test('read-only Bok observation accepts only exact original public identifiers and cannot authorize expired approval',async t=>{
 const {readRetainedBokObservation,validateRetainedBokApproval}=await import('./t04-metamask.mjs'),f=retainedBokFixture();
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-observe-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'original.json'),original={authorizationTxHash:hash,transactionHash:'0x'+'cd'.repeat(32),requestId:'11',target:'12'};
 await fs.writeFile(file,JSON.stringify(original),{mode:0o600});assert.deepEqual(readRetainedBokObservation(file),original);
 await fs.writeFile(file,JSON.stringify({...original,send:true}));assert.throws(()=>readRetainedBokObservation(file));
 f.approval.contentSha256=(await import('node:crypto')).createHash('sha256').update(f.approval.content).digest('hex');
 const expired={...f.approval,expiresAt:1};assert.throws(()=>validateRetainedBokApproval(expired,f.control));assert.deepEqual(validateRetainedBokApproval(expired,f.control,Date.now(),{observation:true}),expired);
 const changed={...expired,budget:String(BigInt(f.control.allocation.bokAmount)+1n)};assert.throws(()=>validateRetainedBokApproval(changed,f.control,Date.now(),{observation:true}));
});

test('fatal wallet diagnostics retain only closed fields without intercepting errors or invoking getters',async()=>{
 const {installWalletFatalObservation}=await import('./t04-metamask.mjs'),{EventEmitter}=await import('node:events');
 const runtime=new EventEmitter(),records=[],stop=installWalletFatalObservation(runtime,x=>records.push(x),()=> 'aggregate-extension');
 assert.equal(runtime.listenerCount('uncaughtException'),0);assert.equal(runtime.listenerCount('unhandledRejection'),0);
 const error={code:'ERR_WORKER_INIT_FAILED',message:'PRIVATE_SENTINEL',stack:'Error PRIVATE_SENTINEL at test-wallet-extension-browser.mjs:140:12'};
 Object.defineProperty(error,'name',{get(){throw Error('getter must not run');}});runtime.emit('uncaughtExceptionMonitor',error);runtime.emit('uncaughtExceptionMonitor',error);
 assert.equal(records.length,1);assert.equal(records[0].failure.code,'ERR_WORKER_INIT_FAILED');assert.equal(records[0].failure.location,'test-wallet-extension-browser.mjs:140:12');assert(!JSON.stringify(records).includes('PRIVATE_SENTINEL'));stop();assert.equal(runtime.listenerCount('uncaughtExceptionMonitor'),0);
 const throwing=new EventEmitter();installWalletFatalObservation(throwing,()=>{throw false;},()=>{throw 0;});assert.doesNotThrow(()=>throwing.emit('uncaughtExceptionMonitor',false));
});

test('fresh automatic three-leg claim waits for Ready and binds original saved consent without another action',async()=>{
 const {waitMetaMaskAutomaticClaim:wait,inspectMetaMaskPaidRecoverySurface,inspectMetaMaskPaidBinding}=await import('./t04-metamask.mjs');
 const saved={paymentMatches:true,claimMatches:true,claimConfirmed:true,paymentSaved:true,claimPresent:true,attempted:true,feeWithinSavedCap:true,workflowStatus:'confirmed',claimTxHash:hash};
 function fixture(change={}){const events=[],report={aggregate:{privateClaimQualified:false}},value={...saved,...change};const page={waitForFunction:async(fn,args,options)=>{assert.equal(fn,inspectMetaMaskPaidRecoverySurface);assert.deepEqual(args,{settledOnly:true,terminalOnly:true});assert.deepEqual(options,{timeout:7000});events.push('observe');return{jsonValue:async()=>({state:'success'}),dispose:async()=>events.push('dispose')};},evaluate:async(fn)=>{assert.equal(fn,inspectMetaMaskPaidBinding);events.push('binding');return value;}};return{events,report,page};}
 const f=fixture();await wait({...f,binding:{},timeout:7000});assert.equal(f.report.aggregate.privateClaimQualified,true);assert.equal(f.report.aggregate.claimTransactionHash,hash);assert.deepEqual(f.events,['observe','binding','dispose']);
 for(const key of ['paymentMatches','claimMatches','claimConfirmed','paymentSaved','claimPresent','attempted','feeWithinSavedCap']){const f=fixture({[key]:false});await assert.rejects(wait({...f,binding:{},timeout:7000}));assert.equal(f.report.aggregate.privateClaimQualified,false);}
 for(const status of ['prepared','unknown','submitted','reverted']){const f=fixture({workflowStatus:status});await assert.rejects(wait({...f,binding:{},timeout:7000}));}
 for(const state of ['error','review','review-saved','receipt-review','reverted']){const f=fixture();f.page.waitForFunction=async()=>({jsonValue:async()=>({state}),dispose:async()=>{}});await assert.rejects(wait({...f,binding:{},timeout:7000}));assert.equal(f.report.aggregate.privateClaimQualified,false);}
});
test('automatic claim surface keeps waiting states pending without interacting with the application',async()=>{
 const {inspectMetaMaskPaidRecoverySurface}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 for(const text of ['Payment confirmed. Waiting for the bridge; no second Ethereum payment will be requested.','Checking the saved private claim. It will not be submitted again.']){
  const document={querySelector:()=>({getAttribute:()=> 'false',querySelectorAll:s=>s==='.notice'?[{textContent:text,getClientRects:()=>[{}]}]:[]})};
  assert.equal(runInNewContext('('+inspectMetaMaskPaidRecoverySurface+')(options)',{document,options:{settledOnly:true,terminalOnly:true}}),null);
 }
});

test('wallet stage memory observations contain only page classes and cannot replace execution failures',async()=>{
 const {metaMaskPageCounts,recordMetaMaskStage}=await import('./t04-metamask.mjs');
 const urls=['http://127.0.0.1:8081/private?secret=PRIVATE_SENTINEL','chrome-extension://private-id/home.html#secret','chrome-extension://private-id/sidepanel.html','chrome-extension://private-id/notification.html','about:blank','https://private.invalid/secret'];
 const context={pages:()=>urls.map(url=>({url:()=>url})),serviceWorkers:()=>[{},{}]};
 const expected={application:1,extensionHome:1,extensionSidepanel:1,extensionOther:1,blank:1,other:1,workers:2};
 assert.deepEqual(metaMaskPageCounts(context,'http://127.0.0.1:8081'),expected);
 const records=[];recordMetaMaskStage(value=>records.push(value),context,'http://127.0.0.1:8081','aggregate-private-account');
 assert.deepEqual(records,[{kind:'wallet-stage',stage:'aggregate-private-account',pages:expected}]);assert(!JSON.stringify(records).includes('PRIVATE_SENTINEL'));
 assert.doesNotThrow(()=>recordMetaMaskStage(()=>{throw false;},context,'http://127.0.0.1:8081','aggregate-private-account'));
 assert.doesNotThrow(()=>recordMetaMaskStage(()=>{}, {pages:()=>{throw 0;}},'http://127.0.0.1:8081','aggregate-private-account'));
});

test('aggregate account permission observation preserves pending, resolved and rejected provider behavior',async()=>{
 const {installMetaMaskAggregateObserver}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 for(const outcome of ['resolved','rejected','falsy-rejection','observer-failure','admission-denied']){
  const events=[],request={method:'wallet_requestPermissions',params:[{eth_accounts:{}}]},result={PRIVATE_SENTINEL:true},original=outcome==='falsy-rejection'?false:Error('PRIVATE_SENTINEL');let release;
  const provider={async request(value){assert.equal(this,provider);assert.equal(value,request);events.push('provider');await new Promise(resolve=>release=resolve);if(outcome!=='resolved')throw original;return result;}};
  const sandbox={__testMetaMask:provider,structuredClone,__aggregateWalletBefore:async value=>{assert.deepEqual(value,request);events.push('entered');if(outcome==='admission-denied')throw original;},__aggregateWalletAfter:async value=>{assert.equal(value.result,result);events.push('resolved');},__aggregateWalletPermissionRejected:async(...args)=>{assert.equal(args.length,0);events.push('rejected');if(outcome==='observer-failure')throw Error('observer');}};
  runInNewContext('('+installMetaMaskAggregateObserver.toString()+')()',sandbox);
  const run=provider.request(request);
  if(outcome==='admission-denied'){await assert.rejects(run,error=>error===original);assert.deepEqual(events,['entered']);continue;}
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['entered','provider']);release();
  if(outcome==='resolved'){assert.equal(await run,result);assert.deepEqual(events,['entered','provider','resolved']);}
  else{await assert.rejects(run,error=>error===original);assert.deepEqual(events,['entered','provider','rejected']);}
 }
});


test('aggregate selection accepts the exact completed account without a redundant Connect click',async()=>{
 const {confirmMetaMaskRecoveryAccountSelection,inspectMetaMaskSelectedAccount}=await import('./t04-metamask.mjs');const {runInNewContext}=await import('node:vm');
 const account='0x'+'1'.repeat(40),chainId='31337';let clicks=0,reads=0;
 const page={async evaluate(fn,args){assert.equal(fn,inspectMetaMaskSelectedAccount);reads++;return runInNewContext('('+fn.toString()+')(input)',{input:args,document:{querySelectorAll:()=>[]},window:{BillboardAccount:{snapshot:()=>({ethereumConnected:reads>1,ethereumAddress:account.toUpperCase(),ethereumWalletName:'MetaMask',invalidated:false})},walletState:{ethChainId:chainId}}});}};
 const result=await confirmMetaMaskRecoveryAccountSelection({getByTestId:()=>({isVisible:async()=>false,click:async()=>clicks++})},{page,account,chainId,permission:{entered:true,resolved:true,rejected:false}});
 assert.equal(result,'already-completed');assert.equal(reads,2);assert.equal(clicks,0);
});
for(const field of ['accountMatches','chainMatches','walletMatches','invalidated'])test('aggregate completed selection rejects mismatched '+field,async()=>{
 const {confirmMetaMaskRecoveryAccountSelection}=await import('./t04-metamask.mjs');let clicks=0;
 const state={connected:true,accountMatches:true,chainMatches:true,walletMatches:true,invalidated:false};state[field]=field==='invalidated';
 await assert.rejects(confirmMetaMaskRecoveryAccountSelection({getByTestId:()=>({isVisible:async()=>false,click:async()=>clicks++})},{page:{evaluate:async()=>state},account:'0x'+'1'.repeat(40),chainId:'31337',permission:{entered:true,resolved:true,rejected:false}}),/account or network differs/);assert.equal(clicks,0);
});
for(const label of ['Connect','Continue at your own risk'])test('aggregate selection retains exact visible prompt guard: '+label,async()=>{
 const {confirmMetaMaskRecoveryAccountSelection}=await import('./t04-metamask.mjs');let clicks=0,reads=0;
 const run=confirmMetaMaskRecoveryAccountSelection({getByTestId:()=>({isVisible:async()=>true,innerText:async()=>label,click:async()=>clicks++})},{page:{evaluate:async()=>{reads++;}},account:'0x'+'1'.repeat(40),chainId:'31337',permission:{entered:true,resolved:true,rejected:false}});
 if(label==='Connect')assert.equal(await run,'prompt-confirmed');else await assert.rejects(run,/Connect/);
 assert.equal(reads,0);assert.equal(clicks,label==='Connect'?1:0);
});
test('aggregate selection does not infer completion from a stale account or rejected permission',async()=>{
 const {confirmMetaMaskRecoveryAccountSelection}=await import('./t04-metamask.mjs');let reads=0,visibility=0,clicks=0;
 const wallet={getByTestId:()=>({isVisible:async()=>++visibility>1,innerText:async()=>'Connect',click:async()=>clicks++})};
 assert.equal(await confirmMetaMaskRecoveryAccountSelection(wallet,{page:{evaluate:async()=>{reads++;}},account:'0x'+'1'.repeat(40),chainId:'31337',permission:{entered:false,resolved:false,rejected:false}}),'prompt-confirmed');assert.equal(reads,0);assert.equal(clicks,1);
 await assert.rejects(confirmMetaMaskRecoveryAccountSelection({getByTestId:()=>({isVisible:async()=>false})},{page:{evaluate:async()=>{reads++;}},account:'0x'+'1'.repeat(40),chainId:'31337',permission:{entered:true,resolved:false,rejected:true}}),/selection rejected/);assert.equal(reads,0);
});


test('aggregate selection stops on fixed application failure without a confirmation click',async()=>{
 const {confirmMetaMaskRecoveryAccountSelection}=await import('./t04-metamask.mjs');let clicks=0;const seen=[];
 await assert.rejects(confirmMetaMaskRecoveryAccountSelection({getByTestId:()=>({isVisible:async()=>false,click:async()=>clicks++})},{page:{evaluate:async()=>({connected:false,notice:'operation-failed'})},account:'0x'+'1'.repeat(40),chainId:'31337',permission:{entered:true,resolved:true,rejected:false},observe:state=>seen.push(state)}),/connection failed: operation-failed/);assert.equal(clicks,0);assert.equal(seen.length,1);
});
test('aggregate connection failure projection preserves provider errors and excludes private fields',async()=>{
 const {installMetaMaskAggregateObserver}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 for(const code of [4001,4901,'PRIVATE_SENTINEL']){const error={code,message:'PRIVATE_SENTINEL'},records=[];const provider={async request(){throw error;}};
  runInNewContext('('+installMetaMaskAggregateObserver.toString()+')()',{__testMetaMask:provider,structuredClone,__aggregateWalletBefore:async()=>{},__aggregateWalletConnectionRejected:async record=>records.push(record)});
  await assert.rejects(provider.request({method:'eth_chainId'}),e=>e===error);assert.equal(records.length,1);assert.equal(records[0].method,'eth_chainId');assert.equal(records[0].code,typeof code==='number'?code:'unknown');assert(!JSON.stringify(records).includes('PRIVATE_SENTINEL'));
 }
});

test('retained MetaMask network setup handles selected, registered and missing local network without payment',async()=>{
 const {configureMetaMaskLocalNetwork}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 for(const mode of ['selected','registered','missing','rejected']){
  let chain=mode==='selected'?'0x7a69':'0x1',listener,approve,clicks=0;const methods=[],original={code:4001};
  const provider={on(event,fn){assert.equal(event,'chainChanged');listener=fn;},removeListener(){listener=null;},async request(req){methods.push(req.method);if(req.method==='eth_chainId')return chain;
   if(req.method==='wallet_switchEthereumChain'){assert.equal(req.params[0].chainId,'0x7a69');if(mode==='missing')throw {code:4902};if(mode==='rejected')throw original;chain='0x7a69';return null;}
   assert.equal(req.method,'wallet_addEthereumChain');assert.equal(req.params[0].rpcUrls[0],'http://127.0.0.1:18546');await new Promise(r=>approve=r);return null;
  }};
  const sandbox={__testMetaMask:provider},page={evaluate:async(fn,arg)=>{sandbox.arg=arg;return runInNewContext('('+fn.toString()+')(arg)',sandbox);}};
  const walletPage={url:()=> 'chrome-extension://test/sidepanel.html',getByText:()=>({first:()=>({waitFor:async()=>{}})}),getByTestId:id=>({waitFor:async()=>{while(!approve)await new Promise(r=>setImmediate(r));},click:async()=>{assert.equal(id,'confirm-footer-button');clicks++;chain='0x7a69';listener(chain);approve();}})};
  const run=configureMetaMaskLocalNetwork({page,walletPage,extensionId:'test',rpcUrl:'http://127.0.0.1:18546',mark:()=>{}});
  if(mode==='rejected')await assert.rejects(run,e=>e===original);else assert.equal(await run,mode==='selected'?'already-selected':'selected');
  assert.equal(clicks,mode==='missing'?1:0);assert(!methods.some(m=>/send|sign/i.test(m)));
 }
});
test('network-only extension probe uses sixty seconds and cannot request Bok continuation',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./run-bounded-browser-check.mjs',import.meta.url),'utf8');
 const choose=runInNewContext('('+source.match(/export function browserCheckDeadline\([\s\S]*?\n}/)[0].replace('export ','')+')',{assert});
 assert.equal(choose({walletExtension:true,aggregate:true,networkOnly:'true'}),60000);
 assert.throws(()=>choose({walletExtension:true,aggregate:true,networkOnly:'true',retainedBok:'true'}));assert.throws(()=>choose({networkOnly:'true'}));
});

test('unsigned export checks original scoped custody and complete ciphertext records without modifying them',async()=>{
 const {inspectMetaMaskUnsignedExport}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');const key='0x'+'1'.repeat(64),salt='0x'+'0'.repeat(64),owner='0x'+'2'.repeat(64),network={chainId:'31337',rollupVersion:'6',rollupAddress:'0x'+'3'.repeat(40)},board={contractAddress:'0x'+'4'.repeat(64)},router='0x'+'5'.repeat(40);
 const saved={value:{kind:'usdc',intent:null,claim:null,relay:{submitted:false,request:null,planHash:'PRIVATE_PLAN'},aggregateCustody:{planHash:'PRIVATE_PLAN'}}},journals=[{key:'6'.repeat(64),encoded:'PRIVATE_CIPHERTEXT'}];const claims=[{scope:['original'],record:{secret:'PRIVATE_COLLATERAL'}}];let payload={wallet:{secretKey:key,salt},claims,journals};
 const sandbox={window:{walletState:{aztec:{secretKey:key,salt,address:{toString:()=>owner}}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async args=>{assert.equal(args.scopeText,JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1','31337','6',network.rollupAddress,board.contractAddress,router,owner,1]));return{read:async()=>saved};},createJournalBackup:async()=>({exportRecords:async()=>journals})},BillboardClaimBackup:{exportRecords:async()=>claims},BillboardWalletBackup:{decrypt:async()=>payload}}};
 const inspect=arg=>{sandbox.input={network,board,router,...arg};return runInNewContext('('+inspectMetaMaskUnsignedExport.toString()+')(input)',sandbox);};
 assert.equal((await inspect({phase:'capture'})).journalPresent,true);assert.equal((await inspect({phase:'verify',envelope:{},password:'PRIVATE_PASSWORD'})).originalPreserved,true);
 await inspect({phase:'capture'});saved.value.relay.submitted=true;await assert.rejects(inspect({phase:'verify'}),/unsigned funding/);saved.value.relay.submitted=false;
 for(const bad of [[],[{scope:['unrelated'],record:{secret:'OTHER_PRIVATE'}}]]){await inspect({phase:'capture'});payload={...payload,claims:bad};await assert.rejects(inspect({phase:'verify'}),/export differs/);}
 payload={...payload,claims};await inspect({phase:'capture'});claims.push({scope:['changed'],record:{secret:'CHANGED'}});await assert.rejects(inspect({phase:'verify'}),/changed during export/);claims.pop();
 await inspect({phase:'capture'});payload={...payload,journals:[]};await assert.rejects(inspect({phase:'verify'}),/export differs/);
 payload={wallet:{secretKey:key,salt},claims,journals};Object.assign(saved.value,{depositor:'0x'+'9'.repeat(40),privateFeeCap:'123',aggregateCustody:{kind:'aggregate-usdc-custody-v1',planHash:'PRIVATE_PLAN',beneficiary:'0x'+'9'.repeat(40)}});
 const account=saved.value.depositor;assert.equal((await inspect({phase:'continuation',account})).completeEncryptedExport,true);
 await assert.rejects(inspect({phase:'continuation',account:'0x'+'8'.repeat(40)}),/scope differs/);
 for(const mutation of [{intent:{}},{claim:{}},{txHash:'hash'},{previousTxHash:'hash'},{relay:{...saved.value.relay,submitted:true}},{relay:{...saved.value.relay,request:{}}},{relay:{...saved.value.relay,transactionHash:'hash'}}]){const original={...saved.value};Object.assign(saved.value,mutation);await assert.rejects(inspect({phase:'continuation',account}),/unsigned funding/);saved.value=original;}
 await inspect({phase:'continuation',account});saved.value.privateFeeCap='124';await assert.rejects(inspect({phase:'requote',account}),/fee approval changed/);saved.value.privateFeeCap='123';assert.equal((await inspect({phase:'requote',account})).originalFeeCapPreserved,true);
 await assert.rejects(inspect({phase:'requote',account}),/fee approval changed/);
});
test('encrypted download failure records only a fixed category and preserves original error',async()=>{
 const {saveEncryptedDownload}=await import('./t04-metamask.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-download-'));
 try{for(const message of ['Target page, context or browser has been closed','canceled','PRIVATE_SENTINEL']){const original=Error(message),observation={};await assert.rejects(saveEncryptedDownload({suggestedFilename:()=> 'rolling-chat-encrypted-recovery.json',saveAs:async()=>{throw original;}},path.join(dir,'never.json'),observation),e=>e===original);assert.equal(observation.failure,message.startsWith('Target')?'target-closed':message==='canceled'?'cancelled':'unknown');assert(!JSON.stringify(observation).includes('PRIVATE_SENTINEL'));}}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unsigned export mode remains a sixty second non-Bok owner',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./run-bounded-browser-check.mjs',import.meta.url),'utf8');const choose=runInNewContext('('+source.match(/export function browserCheckDeadline\([\s\S]*?\n}/)[0].replace('export ','')+')',{assert});
 assert.equal(choose({walletExtension:true,aggregate:true,exportOnly:'true'}),60000);assert.throws(()=>choose({walletExtension:true,aggregate:true,exportOnly:'true',retainedBok:'true'}));assert.throws(()=>choose({walletExtension:true,aggregate:true,exportOnly:'true',networkOnly:'true'}));
});

// Opt-in local browser diagnostic: no application, extension, identity or network.
test('pinned Chromium pure blob download survives persistent profile reopen', {skip:process.env.T04_PURE_BLOB_DIAGNOSTIC!=='true',timeout:25000}, async()=>{
 const {chromium}=await import('playwright');const {walletChromiumLaunch}=await import('./t04-metamask.mjs');
 const directory=await fs.mkdtemp(path.resolve('.build/t04-pure-blob-'));await fs.chmod(directory,0o700);
 const observation={schemaVersion:1,profile:'disposable',networkRequests:0,launches:[]};
 try {
  for(let launch=1;launch<=2;launch++){
   const row={launch,version:null,downloadStarted:false,saved:false,contextClosedBeforeCleanup:false,failure:null};observation.launches.push(row);
   let context,cleanup=false;
   try{
    context=await chromium.launchPersistentContext(path.join(directory,'profile'),{...walletChromiumLaunch(),headless:true,acceptDownloads:true,args:['--js-flags=--max-old-space-size=256']});
    context.on('close',()=>{if(!cleanup)row.contextClosedBeforeCleanup=true;});
    row.version=context.browser().version();assert.equal(row.version,process.env.T04_CHROMIUM_EXECUTABLE?'155.0.8059.79':'153.0.8010.12');
    await context.route('**/*',route=>{observation.networkRequests++;return route.abort();});
    const page=context.pages()[0];page.setDefaultTimeout(5000);
    await page.setContent('<button id="download">Download</button>');
    await page.evaluate(()=>document.querySelector('button').onclick=()=>{const url=URL.createObjectURL(new Blob(['local-download-probe'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='probe.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const pending=page.waitForEvent('download',{timeout:5000});await page.locator('#download').click();const download=await pending;row.downloadStarted=true;
    const destination=path.join(directory,`saved-${launch}.json`);await download.saveAs(destination);assert.equal(await fs.readFile(destination,'utf8'),'local-download-probe');row.saved=true;
   }catch(error){row.failure=row.contextClosedBeforeCleanup?'target-closed':'other';throw error;}finally{cleanup=true;await context?.close().catch(()=>{});}
  }
 }finally{await fs.writeFile(path.join(directory,'observation.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o600});console.log('PURE_BLOB_OBSERVATION '+JSON.stringify({directory,...observation}));}
});

test('test browser override is explicit and rejects unpinned executables',async t=>{
 const {walletChromiumLaunch}=await import('./t04-metamask.mjs');assert.deepEqual(walletChromiumLaunch({}),{channel:'chromium'});const syncFs=(await import('node:fs')).default,exists=syncFs.existsSync;let selected;try{syncFs.existsSync=file=>{selected=file;return false;};assert.throws(()=>walletChromiumLaunch({},{aggregate:true}),/no fallback to153/);assert.match(selected,/cft-155\.0\.8059\.79-mac-arm64/);}finally{syncFs.existsSync=exists;}
 for(const executable of ['', 'relative', '/usr/bin/true'])assert.throws(()=>walletChromiumLaunch({T04_CHROMIUM_EXECUTABLE:executable}));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-browser-pin-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const executable=path.join(dir,'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');await fs.mkdir(path.dirname(executable),{recursive:true});await fs.writeFile(executable,'changed');assert.throws(()=>walletChromiumLaunch({T04_CHROMIUM_EXECUTABLE:executable}),/executable changed/);
});

test('retained unsigned continuation requires explicit USDC export hash and exclusive mode',async t=>{
 const {readMetaMaskUnsignedContinuation:read}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-unsigned-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const c={asset:'USDC',recoveryDirectory:dir},bytes=Buffer.from('{"encrypted":"synthetic"}'),hash=createHash('sha256').update(bytes).digest('hex');
 await fs.writeFile(path.join(dir,'unsigned-recovery-export-2.json'),bytes,{mode:0o600});assert.equal(read(undefined,undefined,c),null);assert.equal(read('true',hash,c).sha256,hash);
 for(const flag of ['yes','',false])assert.throws(()=>read(flag,hash,c));assert.throws(()=>read('false',hash,c));assert.throws(()=>read('true',hash,{...c,asset:'ETH'}));assert.throws(()=>read('true','0'.repeat(64),c));
 for(const mode of ['readinessOnly','continueUnfunded','paidRecovery','observationOnly','retainedBok','networkOnly'])assert.throws(()=>read('true',hash,c,{[mode]:true}));
 await fs.chmod(path.join(dir,'unsigned-recovery-export-2.json'),0o644);assert.throws(()=>read('true',hash,c));
});

test('retained unsigned admission rejects nonzero nonces and incomplete original custody',async()=>{
 const {assertMetaMaskUnsignedAdmission:check}=await import('./t04-metamask.mjs');const binding={unsigned:true,journalPresent:true,originalPreserved:true,completeEncryptedExport:true},input={ethereumNonce:0,consentNonce:0n,binding};check(input);
 for(const change of [{ethereumNonce:1},{consentNonce:1n},{ethereumNonce:undefined},{binding:null},...Object.keys(binding).map(key=>({binding:{...binding,[key]:false}}))])assert.throws(()=>check({...input,...change}));
});

test('aggregate relay status waits for the sole original POST response without another mutation',async()=>{
 const {observeMetaMaskRelayResponse:observe,pollMetaMaskRelayStatus:poll}=await import('./t04-metamask.mjs');let release,completed=false,gets=0;const response=new Promise(resolve=>release=resolve),post={received:false,status:null},status={received:false,status:null};
 const waiting=observe({response:()=>response},post).then(()=>{completed=true;});const input={origin:'http://127.0.0.1:8081',planHash:hash,observation:status,fetchImpl:async(url,options)=>{gets++;assert.equal(url,'http://127.0.0.1:8081/api/funding/usdc/status?planHash='+hash);assert.equal(options.method,undefined);return{ok:true,status:200,json:async()=>({scope:'aggregate-funding',status:'succeeded',canonical:true,planHash:hash,transactionHash:hash})};}};
 assert.equal(await poll({...input,completed}),null);assert.equal(gets,0);release({status:()=>200});await waiting;assert.equal(post.status,200);assert.equal((await poll({...input,completed})).transactionHash,hash);assert.equal(gets,1);
 for(const code of [400,503]){const observed={};await assert.rejects(observe({response:async()=>({status:()=>code})},observed),/preserve submitted/);assert.equal(observed.status,code);}
 const observed={};await assert.rejects(observe({response:async()=>null},observed),/preserve submitted/);assert.equal(observed.received,false);
 const failed={};await assert.rejects(poll({...input,completed:true,observation:failed,fetchImpl:async()=>({status:503,ok:false})}),/preserve submitted/);assert.equal(failed.status,503);assert.equal(gets,1);
});

function retainedReleaseFixture(){
 const f=retainedBokFixture();const approval={schemaVersion:2,journey:'release',runtimeSha256:f.control.runtimeSha256,content:f.approval.content,contentSha256:'',budget:'100',authorizeFeeCap:'100',releaseFeeCap:'200',withdrawFeeCap:'200',withdrawAmount:'10',refundGasCap:'1000',expiresAt:Date.now()+300000,publicScope:f.approval.publicScope,recoveryFile:'/private/recovery/ready.json',recoverySha256:'a'.repeat(64),recoveryStem:'release-one',releaseTransactionHash:null};
 f.control.recoveryDirectory='/private/recovery';return {...f,approval};
}
test('retained release and withdrawal approvals are separate finite capabilities; neither authorizes post or gas funding',async()=>{
 const {validateRetainedBokApproval}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedReleaseFixture();f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');
 assert.deepEqual(validateRetainedBokApproval(f.approval,f.control),f.approval);
 const withdrawal={...f.approval,journey:'withdraw',releaseTransactionHash:hash};assert.deepEqual(validateRetainedBokApproval(withdrawal,f.control),withdrawal);
 for(const change of [a=>a.journey='post',a=>a.recoveryFile='/another/ready.json',a=>a.recoveryStem='../escape',a=>a.refundGasCap='3000000000000001',a=>a.withdrawAmount='101',a=>a.withdrawFeeCap='701',a=>a.releaseTransactionHash=hash,a=>a.expiresAt=0,a=>a.newPayment=true]){const bad=structuredClone(f.approval);change(bad);assert.throws(()=>validateRetainedBokApproval(bad,f.control));}
 assert.throws(()=>validateRetainedBokApproval({...withdrawal,releaseTransactionHash:null},f.control));
});
test('retained recovery inputs bind exact private export bytes and refuse existing outputs before launch',async t=>{
 const {verifyRetainedBokRecoveryFiles}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedReleaseFixture();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'release-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(await fs.realpath(dir),'ready.json');await fs.writeFile(file,'encrypted-only',{mode:0o600});f.control.recoveryDirectory=path.dirname(file);f.approval.recoveryFile=file;f.approval.recoverySha256=createHash('sha256').update('encrypted-only').digest('hex');
 verifyRetainedBokRecoveryFiles(f.approval,f.control);await fs.writeFile(file,'different');assert.throws(()=>verifyRetainedBokRecoveryFiles(f.approval,f.control));await fs.writeFile(file,'encrypted-only');
 await fs.writeFile(path.join(path.dirname(file),'release-one-authorized.json'),'retained',{mode:0o600});assert.throws(()=>verifyRetainedBokRecoveryFiles(f.approval,f.control));
});
test('actual retained release inspector preserves original draft and authorization across fee cancellation and reload',async()=>{
 const {inspectRetainedBokRecovery}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),{webcrypto}=await import('node:crypto'),f=retainedReleaseFixture();let record=structuredClone(f.record);record.status='confirmed';record.txHash=f.field(20);
 const original=structuredClone(record),window={walletState:{aztec:{address:{toString:()=>f.field(30)},secretKey:'private',salt:'private'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async()=>({read:async()=>({value:record})})}};
 const inspect=runInNewContext(`(${inspectRetainedBokRecovery})`,{window,crypto:webcrypto,TextEncoder,structuredClone,Date});
 const auth=await inspect({config:f.config,approval:f.approval,phase:'authorize-confirmed'});assert.equal(auth.matched,true);assert(!JSON.stringify(auth).includes('private'));
 await inspect({config:f.config,approval:f.approval,phase:'authorize-confirmed',expectedDigest:auth.digest});
 record={id:f.field(40),action:{type:'cancel-bok-request',requestId:original.bok.requestId},status:'prepared',maximumFee:'150',bokReleaseSource:original};await inspect({config:f.config,approval:f.approval,phase:'release-prepared'});
 record.status='confirmed';record.txHash=f.field(41);const done=await inspect({config:f.config,approval:f.approval,phase:'release-confirmed'});assert.equal(done.transactionHash,f.field(41));assert.equal(window.__retainedReleasedRequest,original.bok.requestId);
 for(const change of [r=>r.action.requestId=f.field(99),r=>r.bokReleaseSource.action.content='other',r=>r.bokReleaseSource.txHash=f.field(98),r=>r.maximumFee='201',r=>r.status='unknown',r=>r.txHash=null]){const old=structuredClone(record);change(record);await assert.rejects(inspect({config:f.config,approval:f.approval,phase:'release-confirmed'}));record=old;}
 await assert.rejects(inspect({config:f.config,approval:f.approval,phase:'release-confirmed',expectedDigest:auth.digest}));
});
test('retained balance assertions keep returned credit out of available totals and preserve closed request history',async()=>{
 const {assertRetainedBokBalanceChange:check}=await import('./t04-metamask.mjs');const before={complete:true,available:'1000',allocated:'5',reserved:'7',charged:'3',refunded:'2',requests:2};
 const auth={...before,available:'900',allocated:'105',requests:3},released={...before,refunded:'102',requests:3,selectedClosed:true},withdrawn={...released,available:'990'};
 check(before,auth,{phase:'authorized',budget:'100'});check(before,released,{phase:'released',budget:'100'});check(released,withdrawn,{phase:'withdrawn',withdrawAmount:'10'});
 for(const bad of [{...released,available:'1100'},{...released,reserved:'0'},{...released,charged:'0'},{...released,requests:2},{...released,selectedClosed:false},{...released,complete:false}])assert.throws(()=>check(before,bad,{phase:'released',budget:'100'}));
});

test('actual saved PluginPortal refund guard permits one exact journal send and fences replay, funding and changed gas/recipient',async()=>{
 const {installMetaMaskBokRefundGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),ethers=await import('ethers');
 const account='0x'+'11'.repeat(20),portal='0x'+'22'.repeat(20),token='0x'+'33'.repeat(20),board='0x'+'44'.repeat(32),nonce='0x'+'55'.repeat(32),abi=new ethers.Interface(['function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']);
 const data=abi.encodeFunctionData('withdraw',[account,10,nonce,1,2,0,[hash]]).toLowerCase();
 for(const mutation of [null,'recipient','amount','nonce','calldata','gas','chain','journal','unknown','funding','extra','lost-response']){
  const saved={version:1,txHash:null,from:account,to:portal,chainId:'31337',nonce:0,value:'0',data,expected:{kind:'bok-withdraw',amount:'10',recipient:account,exitNonce:nonce}};
  const tx={from:account,to:portal,chainId:'0x7a69',nonce:'0x0',data,value:'0x0',gas:'0xa',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x1'};
  const r={status:'confirmed',action:{type:'withdraw-bok',amount:'10',recipient:account},withdrawal:{kind:'bok',amount:'10',depositor:account,nonce,bokScope:{recipient:board,portal,token}}};
  if(mutation==='recipient')tx.to=account;if(mutation==='amount')r.action.amount='11';if(mutation==='nonce')tx.nonce='0x1';if(mutation==='calldata')tx.data=abi.encodeFunctionData('withdraw',[account,11,nonce,1,2,0,[hash]]);if(mutation==='gas')tx.maxFeePerGas='0x100';if(mutation==='chain')tx.chainId='0x1';if(mutation==='journal')saved.expected.kind='aggregate-funding';if(mutation==='unknown')saved.txHash=hash;if(mutation==='funding')tx.value='0x1';if(mutation==='extra')tx.authorizationList=[];
  let sends=0;const provider={async request(request){if(request.method==='eth_sendTransaction'){sends++;if(mutation==='lost-response')throw Error('Transport response lost');return hash;}return '0x7a69';}};
  const window={ethers,__bokRefundObserve:async()=>{},__retainedWithdrawal:r,walletState:{aztec:{address:{toString:()=>board},secretKey:'private',salt:'private'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async({scopeText})=>{assert.equal(JSON.parse(scopeText).at(-1),token);return {read:async()=>({value:saved})};}}};
  runInNewContext(`(${installMetaMaskBokRefundGuard})`,{window,__testMetaMask:provider,Date,structuredClone})({config:{network:{chainId:'31337',rollupAddress:account,rollupVersion:'1'},bok:{contractAddress:board},aggregateFunding:{bokPortal:portal,bokToken:token}},approval:{withdrawAmount:'10',refundGasCap:'1000',expiresAt:Date.now()+10000},account});
  if(mutation==='lost-response'){await assert.rejects(provider.request({method:'eth_sendTransaction',params:[tx]}),/Transport response lost/);await assert.rejects(provider.request({method:'eth_sendTransaction',params:[tx]}));assert.equal(sends,1);}else if(mutation){await assert.rejects(provider.request({method:'eth_sendTransaction',params:[tx]}));assert.equal(sends,0);}else{
   assert.equal(await provider.request({method:'eth_sendTransaction',params:[tx]}),hash);assert.equal(sends,1);await assert.rejects(provider.request({method:'eth_sendTransaction',params:[tx]}));assert.equal(sends,1);
   await provider.request({method:'eth_getTransactionReceipt',params:[hash]});await assert.rejects(provider.request({method:'eth_getTransactionReceipt',params:['0x'+'66'.repeat(32)]}));
  }
  await assert.rejects(provider.request({method:'eth_signTypedData_v4',params:[]}));await assert.rejects(provider.request({method:'eth_sendRawTransaction',params:[]}));
 }
});
test('refund guard consumes its sole send authority after invalid admission before any wallet call',async()=>{
 const {installMetaMaskBokRefundGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');let calls=0;
 const provider={request:async()=>{calls++;}},window={__bokRefundObserve:async()=>{},__retainedWithdrawal:null,walletState:{aztec:{}},__aztec:{}};
 runInNewContext(`(${installMetaMaskBokRefundGuard})`,{window,__testMetaMask:provider,Date})({config:{network:{}},approval:{expiresAt:Date.now()+1000},account:'x'});
 await assert.rejects(provider.request({method:'eth_sendTransaction',params:[{}]}));await assert.rejects(provider.request({method:'eth_sendTransaction',params:[{}]}));assert.equal(calls,0);assert.equal(window.__retainedRefundTraffic.attempted,true);
});

test('existing release driver reloads the new export and cancels review without a second send when re-review fails',async t=>{
 const {driveRetainedBokRelease}=await import('./t04-metamask.mjs'),f=retainedReleaseFixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'release-flow-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));f.control.recoveryDirectory=dir;f.control.password='test-password';
 const clicks=[],imports=[],marks=[],report={};let balanceRead=0,releaseReviews=0,reloads=0;
 const selected=name=>({async click(){clicks.push(name);},async fill(){},async selectOption(){},async waitFor(){},async isVisible(){return true;},async isEnabled(){return true;},async setInputFiles(file){imports.push(file);}});
 const dialog={getByRole:(_,o)=>selected(o.name),getByLabel:(name)=>selected(name),getByText:text=>selected(text)};
 const page={getByRole:(role,o)=>role==='dialog'?dialog:selected(o.name),async waitForFunction(){},async reload(){reloads++;},async waitForTimeout(){},async waitForEvent(name){assert.equal(name,'download');return {suggestedFilename:()=> 'rolling-chat-encrypted-recovery.json',saveAs:filename=>fs.writeFile(filename,JSON.stringify({kind:'aztec-billboard-encrypted-wallet',schemaVersion:1,kdf:'PBKDF2-SHA256',iterations:600000,ciphertext:'aabb'}),{flag:'wx',mode:0o600})};},async evaluate(fn,arg){
  if(fn.name==='inspectRetainedBokRecovery'){
   if(arg.phase==='release-prepared'&&++releaseReviews===2)throw Error('Changed saved second review');
   return {matched:true,digest:'same-auth',transactionHash:hash};
  }
  if(fn.toString().includes('app.readBokAccounting')){balanceRead++;return {complete:true,available:balanceRead===1?'100':'0',allocated:balanceRead===1?'0':'100',reserved:'0',charged:'0',refunded:'0',requests:balanceRead===1?0:1};}
 }};
 await assert.rejects(driveRetainedBokRelease({page,control:f.control,approval:f.approval,mark:x=>marks.push(x),report,deadlineAt:Date.now()+60000}),/Changed saved second review/);
 assert.equal(reloads,1);assert.deepEqual(imports,[path.join(dir,'release-one-authorized.json')]);assert.equal(clicks.filter(x=>x==='Confirm and send').length,1);assert.equal(clicks.filter(x=>x==='Cancel prepared action').length,1);assert(!clicks.includes('Review saved Bok post'));assert.equal(report.bokRecovery.releaseSends,0);assert.equal(report.bokRecovery.reviewCancelledWithoutSend,true);
});

test('withdrawal inspection requires the actual saved recipient, portal, amount and charged fee below its separate cap',async()=>{
 const {inspectRetainedBokRecovery}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),{webcrypto}=await import('node:crypto'),f=retainedReleaseFixture(),account='0x'+'11'.repeat(20),portal='0x'+'22'.repeat(20),token='0x'+'33'.repeat(20);
 f.config.aggregateFunding={bokPortal:portal,bokToken:token};let record={status:'confirmed',txHash:hash,action:{type:'withdraw-bok',amount:'10',recipient:account},maximumFee:'150',actualNetworkFee:'100',withdrawal:{kind:'bok',amount:'10',depositor:account,bokScope:{recipient:f.config.bok.contractAddress,portal,token}}};
 const window={walletState:{ethAccount:account,aztec:{address:{toString:()=>f.field(30)},secretKey:'private',salt:'private'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async()=>({read:async()=>({value:record})})}};
 const inspect=runInNewContext(`(${inspectRetainedBokRecovery})`,{window,crypto:webcrypto,TextEncoder,structuredClone,Date});
 assert.equal((await inspect({config:f.config,approval:f.approval,phase:'withdraw-confirmed'})).actualNetworkFee,'100');
 for(const change of [r=>r.actualNetworkFee='201',r=>delete r.actualNetworkFee,r=>r.action.recipient=portal,r=>r.withdrawal.amount='11',r=>r.withdrawal.bokScope.token=portal,r=>r.status='unknown']){const old=structuredClone(record);change(record);await assert.rejects(inspect({config:f.config,approval:f.approval,phase:'withdraw-confirmed'}));record=old;}
});

test('composed paid outer guard admits only the once journal-bound Bok refund and observes teardown denials in Node',async()=>{
 const {installMetaMaskBokRefundGuard,createRetainedBokRefundAdmission,assertMetaMaskReadinessRequest}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),ethers=await import('ethers');
 const signer=ethers.Wallet.createRandom(),account=signer.address.toLowerCase(),portal='0x'+'22'.repeat(20),token='0x'+'33'.repeat(20),board='0x'+'44'.repeat(32),exitNonce='0x'+'55'.repeat(32),url='http://127.0.0.1:18545/';
 const config={network:{chainId:'31337',rollupAddress:portal,rollupVersion:'1'},bok:{contractAddress:board},aggregateFunding:{bokPortal:portal,bokToken:token}},approval={withdrawAmount:'10',refundGasCap:'1000',expiresAt:Date.now()+10000};
 const abi=new ethers.Interface(['function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']),data=abi.encodeFunctionData('withdraw',[account,10,exitNonce,1,2,0,[hash]]).toLowerCase(),tx={from:account,to:portal,chainId:'0x7a69',nonce:'0x0',data,value:'0x0',gas:'0xa',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x1',type:'0x2'};
 const observed={url,method:'POST',body:JSON.stringify({id:1,jsonrpc:'2.0',method:'eth_sendTransaction',params:[tx]})};assert.throws(()=>assertMetaMaskReadinessRequest(observed,url));
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction']){
  const admission=createRetainedBokRefundAdmission({config,approval,account}),signed=await signer.signTransaction({to:portal,chainId:31337,nonce:0,data,value:0,gasLimit:10,maxFeePerGas:10,maxPriorityFeePerGas:1,type:2});let sends=0;
  const rpc={...observed,body:JSON.stringify({id:1,jsonrpc:'2.0',method,params:[method==='eth_sendTransaction'?tx:signed]})};
  const saved={version:1,txHash:null,from:account,to:portal,chainId:'31337',nonce:0,value:'0',data,expected:{kind:'bok-withdraw',amount:'10',recipient:account,exitNonce}};
  const r={status:'confirmed',action:{type:'withdraw-bok',amount:'10',recipient:account},withdrawal:{kind:'bok',amount:'10',depositor:account,nonce:exitNonce,bokScope:{recipient:board,portal,token}}};
  const window={ethers,__bokRefundObserve:event=>admission.observe(event),__retainedWithdrawal:r,walletState:{aztec:{address:{toString:()=>board},secretKey:'private',salt:'private'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async()=>({read:async()=>({value:saved})})}};
  const provider={request:async request=>{assert.equal(request.method,'eth_sendTransaction');admission.assertRequest(rpc,url);sends++;return ethers.keccak256(signed);}};
  runInNewContext(`(${installMetaMaskBokRefundGuard})`,{window,__testMetaMask:provider,Date,structuredClone})({config,approval,account});
  await provider.request({method:'eth_sendTransaction',params:[tx]});assert.deepEqual(admission.finish(),{providerSends:1,outerSends:1,denied:0,acknowledged:true});assert.equal(sends,1);
  // Simulate a late authentic page request during context close; removing the
  // page-owned counter cannot erase the already observed Node-owned denial.
  await assert.rejects(provider.request({method:'personal_sign',params:[]}));delete window.__retainedRefundTraffic;assert.throws(()=>admission.finish());assert.equal(admission.snapshot().denied,1);assert.equal(sends,1);
 }
 const absent=createRetainedBokRefundAdmission({config,approval,account});assert.throws(()=>absent.assertRequest(observed,url));
 const admission=createRetainedBokRefundAdmission({config,approval,account});admission.observe({type:'admit',transaction:tx});const wrong={...observed,body:JSON.stringify({method:'eth_sendTransaction',params:[{...tx,value:'0x1'}]})};assert.throws(()=>admission.assertRequest(wrong,url));assert.equal(admission.snapshot().outerSends,0);
 const replay=createRetainedBokRefundAdmission({config,approval,account});replay.observe({type:'admit',transaction:tx});replay.assertRequest(observed,url);assert.throws(()=>replay.assertRequest(observed,url));assert.equal(replay.snapshot().outerSends,1);
});

test('current Ready export unlock accepts keys only and refuses stale recovery journals before import',async t=>{
 const {inspectMetaMaskAggregateReadiness:inspect}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'t04-ready-export-'));t.after(()=>fs.rm(directory,{recursive:true}));await fs.writeFile(path.join(directory,'initial-recovery.json'),'{}',{mode:0o600});
 for(const payload of [{claims:[],journals:[]},{claims:[],journals:[{stale:true}]},{claims:[{}],journals:[]},{claims:[]}]){
  const events=[],controls=Object.fromEntries(['Unlock','Import recovery','Recover funding'].map(name=>[name,{or:()=>({first:()=>({waitFor:async()=>{}})}),isVisible:async()=>true,click:async()=>events.push(name),waitFor:async()=>events.push(name)}]));
  const dialog={getByRole:(_,{name})=>controls[name],getByLabel:()=>({waitFor:async()=>events.push('runtime-ready'),fill:async()=>{},setInputFiles:async()=>events.push('file')})};
  const page={getByRole:role=>role==='dialog'?dialog:{click:async()=>{}},evaluate:async(fn,args)=>runInNewContext(`(${fn})`,{window:{BillboardWalletBackup:{decrypt:async()=>payload}}})(args)};
  const run=inspect({page,control:{recoveryDirectory:directory,password:'synthetic'},mark:()=>{},keysOnly:true});
  if(payload.claims.length===0&&payload.journals?.length===0){assert.equal(await run,'funding');assert.deepEqual(events,['Unlock','runtime-ready','file','Import recovery','Recover funding']);}
  else{await assert.rejects(run,/keys-only/);assert.deepEqual(events,['Unlock','runtime-ready']);}
 }
});


test('Ready export original claim requires exact current network receipt and canonical block',async()=>{
 const hash='0x'+'1a'.repeat(32);const {verifyRetainedClaimReceipt:verify}=await import('./t04-metamask.mjs'),rollup='0x'+'11'.repeat(20),blockHash='0x'+'22'.repeat(32),control={walletConfig:{config:{network:{chainId:'31337',rollupVersion:'1',rollupAddress:rollup}}}};
 const fixture=()=>({getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),getTxReceipt:async tx=>({txHash:tx,status:'proven',executionResult:'success',blockNumber:10,blockHash}),getBlockData:async n=>{assert.equal(n,10);return {blockHash};}});
 assert.deepEqual(await verify({control,transactionHash:hash,node:fixture()}),{transactionHash:hash,blockNumber:10,blockHash,canonical:true});
 for(const mutate of [n=>n.getNodeInfo=async()=>({l1ChainId:1,rollupVersion:1}),n=>n.getL1ContractAddresses=async()=>({rollupAddress:'0x'+'33'.repeat(20)}),n=>n.getBlockData=async()=>null,n=>n.getBlockData=async()=>({blockHash:hash}),n=>{const read=n.getTxReceipt;n.getTxReceipt=async tx=>({...await read(tx),status:'pending'});},n=>{const read=n.getTxReceipt;n.getTxReceipt=async tx=>({...await read(tx),executionResult:'app_logic_reverted'});},n=>{const read=n.getTxReceipt;n.getTxReceipt=async tx=>({...await read(tx),txHash:blockHash});}]){const node=fixture();mutate(node);await assert.rejects(verify({control,transactionHash:hash,node}));}
});


test('cold retained account wait uses the original finite owner remainder without extending it',async()=>{
 const {inspectMetaMaskAggregateReadiness:inspect,retainedBokRemaining}=await import('./t04-metamask.mjs');let now=1000,waited;
 const remaining=retainedBokRemaining(106000,()=>now),controls=Object.fromEntries(['Unlock','Import recovery','Recover funding'].map(name=>[name,{or:()=>({first:()=>({waitFor:async()=>{}})}),isVisible:async()=>true,click:async()=>{if(name==='Import recovery')now+=15000;},waitFor:async options=>{assert.equal(name,'Recover funding');waited=options.timeout;}}]));
 const dialog={getByRole:(_,{name})=>controls[name],getByLabel:()=>({fill:async()=>{},setInputFiles:async()=>{}})},page={getByRole:role=>role==='dialog'?dialog:{click:async()=>{}}};
 await inspect({page,control:{password:'synthetic',recoveryDirectory:'/private/recovery'},mark:()=>{},remaining});assert.equal(waited,90000);now=106000;await assert.rejects(inspect({page,control:{password:'synthetic',recoveryDirectory:'/private/recovery'},mark:()=>{},remaining}),/deadline exhausted/);
});


test('keys-only retained unlock rejects any historical journal file before opening the profile UI',async()=>{
 const {inspectMetaMaskAggregateReadiness:inspect}=await import('./t04-metamask.mjs');let opened=false;
 await assert.rejects(inspect({page:{getByRole(){opened=true;throw Error('must not open');}},control:{},mark:()=>{},keysOnly:true,recoveryFile:'/private/old-released.json'}),/historical journal/);assert.equal(opened,false);
});

test('refund-only approval binds the exact existing withdrawal and preserves prior recovery files',async()=>{
 const {validateRetainedBokApproval}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),f=retainedReleaseFixture();
 const approval={...f.approval,journey:'refund',releaseTransactionHash:hash,withdrawalTransactionHash:'0x'+'12'.repeat(32)};approval.contentSha256=createHash('sha256').update(approval.content).digest('hex');
 assert.deepEqual(validateRetainedBokApproval(approval,f.control),approval);
 for(const change of [a=>delete a.withdrawalTransactionHash,a=>a.withdrawalTransactionHash=null,a=>a.journey='withdraw',a=>a.releaseTransactionHash=null]){const bad=structuredClone(approval);change(bad);assert.throws(()=>validateRetainedBokApproval(bad,f.control));}
});
test('refund-only reopened workflow waits for existing refund surface, not missing funding navigation',async t=>{
 const {inspectMetaMaskAggregateReadiness:inspect}=await import('./t04-metamask.mjs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'refund-unlock-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'initial-recovery.json'),'{}');
 const waited=[];const element=name=>({or(){return this;},first(){return this;},async waitFor(options){waited.push([name,options?.timeout]);},async isVisible(){return name==='Unlock'||name==='Review Ethereum refund';},async click(){},async fill(){},async setInputFiles(){}}),dialog={getByRole:(role,o)=>element(o?.name??role),getByLabel:n=>element(n)};
 const result=await inspect({page:{getByRole:(r,o)=>r==='dialog'?dialog:element(o.name),evaluate:async()=>true},control:{password:'synthetic',recoveryDirectory:dir},mark:()=>{},keysOnly:true,refundOnly:true,remaining:()=>321});
 assert.equal(result,'refund');assert(waited.some(x=>x[0]==='Review Ethereum refund'&&x[1]===321));assert(!waited.some(x=>x[0]==='Recover funding'));
});
test('readonly refund guard refuses sends even with an otherwise authorized original account',async()=>{
 const {installMetaMaskBokRefundGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');let sends=0;const events=[],provider={request:async r=>{if(r.method==='eth_chainId')return '0x7a69';sends++;}},window={__bokRefundObserve:async e=>events.push(e)};
 runInNewContext(`(${installMetaMaskBokRefundGuard})`,{window,__testMetaMask:provider,Date,structuredClone})({config:{},approval:{expiresAt:Date.now()+1000},account:'unused',readOnly:true});
 assert.equal(await provider.request({method:'eth_chainId'}),'0x7a69');await assert.rejects(provider.request({method:'eth_sendTransaction',params:[{}]}));assert.equal(sends,0);assert.equal(events.length,1);assert.equal(events[0].type,'denied');
});
test('actual refund preparation projection never calls confirm and clears quote on success and finite failure',async()=>{
 const {prepareRetainedBokRefund}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');let confirms=0,cancels=0,error=null;
 const session={application:{readAccountStatus:async()=>{if(error)throw error;}},withdrawal:{prepare:async()=>{if(error)throw error;return {amount:'10',recipient:'account',maximumGasWei:'100',estimatedGasWei:'40'};},confirm:async()=>confirms++,cancel(){cancels++;}}};
 // Replace only the browser module import with the already-created labelled session.
 const fn=runInNewContext(`(${prepareRetainedBokRefund.toString().replace("await import('/wallet/runtime.mjs')",'runtimeModule')})`,{runtimeModule:{loadRollingWalletRuntime:async()=>({createSession:async()=>session})}});
 const good=await fn({maximumGasWei:'100',amount:'10',recipient:'account'});assert.equal(good.passed,true);assert.equal(good.prepare.estimatedGasWei,'40');
 error=Object.assign(new TypeError('PRIVATE_SENTINEL'),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED',stack:'TypeError PRIVATE_SENTINEL\n at original (http://localhost/wallet/wallet-session.mjs:73:11)'});
 const bad=await fn({maximumGasWei:'100',amount:'10',recipient:'account'});assert.equal(bad.accountStatus.code,'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');assert.equal(bad.prepare.source,'wallet-session.mjs:73:11');assert(!JSON.stringify(bad).includes('PRIVATE_SENTINEL'));assert.equal(cancels,2);assert.equal(confirms,0);
 error=new Error('BB_JOURNAL_INVALID');const journal=await fn({maximumGasWei:'100',amount:'10',recipient:'account'});assert.equal(journal.accountStatus.code,'BB_JOURNAL_INVALID');error=new Error('BB_JOURNAL_INVALID PRIVATE_SENTINEL');assert.equal((await fn({maximumGasWei:'100',amount:'10',recipient:'account'})).accountStatus.code,'unknown');assert.equal(confirms,0);
});
test('readonly refund owner uses120 seconds only in explicitly selected retained aggregate mode',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./run-bounded-browser-check.mjs',import.meta.url),'utf8'),choose=runInNewContext('('+source.match(/export function browserCheckDeadline\([\s\S]*?\n}/)[0].replace('export ','')+')',{assert});
 const input={walletExtension:true,aggregate:true,retainedBok:'true',refundReadOnly:'true'};assert.equal(choose(input),120000);assert.equal(choose({...input,refundReadOnly:'false'}),540000);
 for(const change of [{retainedBok:'false'},{aggregate:false},{networkOnly:'true'},{exportOnly:'true'},{refundReadOnly:'yes'}])assert.throws(()=>choose({...input,...change}));
});

test('refund readiness stops immediately at a visible initialization failure without retrying account creation',async t=>{
 const {inspectMetaMaskAggregateReadiness:inspect}=await import('./t04-metamask.mjs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'refund-failed-init-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'initial-recovery.json'),'{}');
 const clicked=[];const element=name=>({or(){return this;},first(){return this;},async waitFor(){},async isVisible(){return name==='Unlock'||name==='alert';},async click(){clicked.push(name);},async fill(){},async setInputFiles(){}}),dialog={getByRole:(role,o)=>element(o?.name??role),getByLabel:n=>element(n)};
 const result=await inspect({page:{getByRole:(role,o)=>role==='dialog'?dialog:element(o?.name??role),evaluate:async()=>true},control:{password:'synthetic',recoveryDirectory:dir},mark:()=>{},keysOnly:true,refundOnly:true,remaining:()=>300});
 assert.equal(result,'initialization-failed');assert(!clicked.includes('Connect private account'));assert(!clicked.includes('Check account recovery'));
});
test('latest full refund export reopens through ordinary import with readonly guard and unchanged accounting',async()=>{
 const {reopenRetainedBokRefund}=await import('./t04-metamask.mjs');const clicks=[],imports=[],guards=[];let state='fee-ready';
 const balances={complete:true,available:'90',allocated:'0',reserved:'0',charged:'0',refunded:'100',requests:1};
 const element=name=>({or(){return this;},first(){return this;},async waitFor(){},async isVisible(){return true;},async isEnabled(){return true;},async click(){clicks.push(name);},async fill(){},async setInputFiles(file){imports.push(file);}}),dialog={getByRole:(role,o)=>element(o?.name??role),getByLabel:n=>element(n),getByText:n=>element(n)};
 const page={getByRole:(role,o)=>role==='dialog'?dialog:element(o.name),async reload(){},async waitForFunction(){},async evaluate(fn,arg){
  if(fn.name==='installMetaMaskBokRefundGuard'){guards.push(arg);return;}
  if(fn.name==='inspectRetainedBokRecovery')return {transactionHash:hash};
  if(fn.toString().includes('application.readAccountStatus'))return {status:state};
  if(fn.toString().includes('app.readBokAccounting'))return balances;
 }};
 const input={page,control:{password:'synthetic',walletConfig:{config:{}}},approval:{withdrawalTransactionHash:hash},filename:'/private/latest-refunded.json',account:'account',mark:()=>{},remaining:()=>300,expectedBalances:balances};
 await reopenRetainedBokRefund(input);assert.deepEqual(imports,['/private/latest-refunded.json']);assert.equal(guards.length,1);assert.equal(guards[0].readOnly,true);assert(clicks.includes('Import recovery'));assert(!clicks.some(x=>String(x).startsWith('Confirm')));
 state='recovering';await assert.rejects(reopenRetainedBokRefund(input));assert(!clicks.some(x=>String(x).startsWith('Confirm')));
});

test('full backup import paid guard reports denied signatures to the same Node refund owner before the later guard is installed',async()=>{
 const {bindRetainedRefundObservation,installMetaMaskPaidRecoveryGuard,createRetainedBokRefundAdmission}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');const window={},admission=createRetainedBokRefundAdmission({config:{},approval:{},account:'unused'});let calls=0;
 await bindRetainedRefundObservation({exposeFunction:async(name,fn)=>{window[name]=fn;}},admission);
 const provider={request:async()=>{calls++;return '0x7a69';}};runInNewContext(`(${installMetaMaskPaidRecoveryGuard})`,{window,__testMetaMask:provider})();// Before full import and before the later refund guard.
 await assert.rejects(provider.request({method:'eth_signTypedData_v4',params:[]}));assert.equal(calls,0);assert.equal(admission.snapshot().denied,1);assert.throws(()=>admission.finish(),/forbidden refund/);
 await assert.rejects(provider.request({method:'eth_sendTransaction',params:[]}));assert.equal(admission.snapshot().denied,2);
});


test('readiness-only runner forwards its original owner deadline to the actual initialization helper',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./test-wallet-extension-browser.mjs',import.meta.url),'utf8');
 const branch=source.slice(source.indexOf('else if(readinessOnly){report.scope='),source.indexOf('report.readinessOnly=true;')+'report.readinessOnly=true;'.length);
 const call=branch.match(/await inspectMetaMaskAggregateReadiness\(.*?\);/)[0];let observed;
 await runInNewContext('(async()=>{'+call+'})()',{page:{},control:{},markAggregate(){},process:{env:{T04_BROWSER_DEADLINE_AT:'120000'}},retainedBokRemaining:deadline=>{assert.equal(deadline,120000);return()=>75000;},inspectMetaMaskAggregateReadiness:async options=>{observed=options.remaining();}});
 assert.equal(observed,75000);
});

test('retained Bok reply uses the real thread Reply action and immutable conversation context',async()=>{
 const {driveRetainedBokConfirmations}=await import('./t04-metamask.mjs');const fills=[],events=[];const node=name=>({or(){return this;},first(){return this;},isVisible:async()=>true,click:async()=>events.push(name),waitFor:async()=>{},getAttribute:async()=>'#/thread/7/8',fill:async value=>fills.push([name,value]),selectOption:async()=>events.push('select-bok')});const dialog={getByRole:(_,{name})=>node(name),getByLabel:name=>node(name),getByText:node},page={evaluate:async(fn,arg)=>{assert.deepEqual(arg,{root:'7',parent:'8'});events.push('navigate-thread');},locator:selector=>{assert.equal(selector,'#post-8');return{getByRole:(_,{name})=>{assert.equal(name,'Reply');return node('reader-reply');}};}};
 await driveRetainedBokConfirmations({page,dialog,approval:{content:'bounded reply',budget:'400000',parent:'8',root:'7'},inspect:async()=>({public:{transactionHash:hash}}),mark:()=>{},report:{retainedBok:{}}});
 assert.deepEqual(fills,[['Message','bounded reply'],['Maximum Bok credits','400000']]);assert.deepEqual(events.slice(0,4),['Close account panel','navigate-thread','reader-reply','select-bok']);assert.equal(events.filter(x=>x==='Confirm and send').length,2);
});

test('retained Bok reply saved review binds approved thread before any authorization',async()=>{
 const {inspectRetainedBokWorkflow:inspect}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),f=retainedBokFixture();Object.assign(f.approval,{parent:'8',root:'7'});Object.assign(f.record.action,{parent:'8',root:'7'});
 const window={walletState:{aztec:{address:{toString:()=> 'private-owner'},secretKey:'private-secret',salt:'private-salt'}},__aztec:{createBrowserJournalStorage:()=>({}),createEncryptedJournalSlot:async()=>({read:async()=>({value:f.record})})}};const run=()=>runInNewContext('('+inspect+')',{window})({config:f.config,approval:f.approval,phase:'authorize',status:'prepared'});
 assert.equal((await run()).correct,true);f.record.action.root='9';assert.equal((await run()).correct,false);f.record.action.root='7';f.record.action.parent='9';assert.equal((await run()).correct,false);
});

test('paid recovery forwards owner deadline and records original private binding before resume',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await fs.readFile(new URL('./test-wallet-extension-browser.mjs',import.meta.url),'utf8');const paid=source.slice(source.indexOf('else if(paidRecovery){report.scope='));const call=paid.match(/await driveMetaMaskPaidRecovery\(.*?\);/)[0];let observed;
 await runInNewContext('(async()=>{'+call+'})()',{page:{},walletPage:{},control:{},provider:{},reviewPrepared:false,markAggregate(){},report:{},process:{env:{T04_BROWSER_DEADLINE_AT:'120000',T04_AGGREGATE_PAID_HASH:hash}},driveMetaMaskPaidRecovery:async options=>{observed=options.deadlineAt;}});assert.equal(observed,120000);
 const helper=await fs.readFile(new URL('./t04-metamask.mjs',import.meta.url),'utf8'),start=helper.indexOf('export async function driveMetaMaskPaidRecovery'),end=helper.indexOf('export function retainedPreparedClaimFlag',start),body=helper.slice(start,end);assert(body.indexOf('report.paidRecoveryBefore=')<body.indexOf("mark('aggregate-paid-private-claim')"));assert(body.includes('remaining:deadlineAt===undefined?undefined:retainedBokRemaining(deadlineAt)'));
});

test('post-only approval binds a fresh private observer file and rejects financial reuse',async t=>{
 const {validateRetainedBokApproval:validate,writeRetainedBokObservation:write,readRetainedBokObservation:read}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-post-observation-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=retainedBokFixture();f.control.recoveryDirectory=await fs.realpath(dir);f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');const a={...f.approval,completion:'post-only',observationFile:path.join(f.control.recoveryDirectory,'bok-a-root-observation.json')};
 assert.deepEqual(validate(a,f.control),a);for(const change of [x=>x.completion='complete',x=>delete x.observationFile,x=>x.observationFile=path.join(f.control.recoveryDirectory,'other.json'),x=>x.observationFile=path.join(f.control.recoveryDirectory,'..','bok-escape-observation.json')]){const bad=structuredClone(a);change(bad);assert.throws(()=>validate(bad,f.control));}
 const intent={authorizationTxHash:hash,transactionHash:'0x'+'cd'.repeat(32),requestId:'30',target:'40'};write(a.observationFile,intent);assert.deepEqual(read(a.observationFile),intent);assert.equal((await fs.stat(a.observationFile)).mode&0o777,0o600);assert.throws(()=>write(a.observationFile,intent),{code:'EEXIST'});assert.throws(()=>validate(a,f.control),/never resubmitted/);assert.deepEqual(validate(a,f.control,Date.now(),{observation:true}),a);
 const other=path.join(f.control.recoveryDirectory,'bok-invalid-observation.json');assert.throws(()=>write(other,{...intent,privateKey:'sentinel'}));await assert.rejects(fs.stat(other),{code:'ENOENT'});
});
test('post-only canonical checks retain exact invocation, content and approved thread without claiming a reply',async()=>{
 const {assertRetainedBokPostEvents:verify}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),content='existing thread edit';const approval={content,contentSha256:createHash('sha256').update(content).digest('hex'),parent:'8',root:'7'},publicIntent={requestId:'30',target:'40'},post={id:'10',record:{parent:'8',root:'7'},length:String(Buffer.byteLength(content)),message:[BigInt('0x'+Buffer.from(content).toString('hex').padEnd(62,'0')).toString(),...Array(31).fill('0')]};const input={approval,publicIntent,pluginId:'5',postEvents:[{type:'PluginInvoked',payload:{request_id:'30',target:'40',plugin_id:'5',post_id:'10'}},{type:'PostPublished',payload:post}]};assert.deepEqual(verify(input),{postId:'10',root:'7'});for(const change of [x=>x.postEvents[0].payload.target='41',x=>x.postEvents[1].payload.record.parent='9',x=>x.postEvents[1].payload.record.root='8',x=>x.approval.content='changed',x=>x.postEvents.push(x.postEvents[0])]){const bad=structuredClone(input);change(bad);assert.throws(()=>verify(bad));}
});

test('existing Bok driver saves post observation before verification and selects only explicitly approved post-only mode',async()=>{
 const {driveRetainedBokJourney}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm');const intent={authorizationTxHash:hash,transactionHash:hash,requestId:'30',target:'40'};
 for(const postOnly of [false,true]){const events=[],approval=postOnly?{completion:'post-only',observationFile:'/private/bok-a-observation.json'}:{},report={paidRecovery:{readyFromConfirmedPrivateClaim:true}};const context={retainedBokRemaining:()=>()=>1000,assert,validateRetainedBokApproval:a=>a,driveRetainedBokConfirmations:async()=>{events.push('confirmed');return intent;},reserveRetainedBokObservation:file=>{assert.equal(file,approval.observationFile);events.push('reserved');return{complete:value=>{assert.equal(value,intent);events.push('saved');},close:()=>events.push('reservation-closed')};},observeRetainedBokJourney:async options=>{assert.equal(options.postOnly,postOnly);assert.deepEqual(events,postOnly?['reserved','confirmed','saved']:['confirmed']);events.push('verified');}};await runInNewContext('('+driveRetainedBokJourney+')',context)({page:{getByRole:()=>({}),evaluate:async()=>events.push('closed')},control:{},approval,mark:()=>{},report,deadlineAt:1});assert.deepEqual(events,postOnly?['reserved','confirmed','saved','verified','reservation-closed','closed']:['confirmed','verified','closed']);assert.equal(report.retainedBok.canonicalReply,false);assert.equal(report.retainedBok.canonicalTerminalAccounting,false);}
});

test('paid recovery accepts current spent balance while retaining exact original payment and claim checks',async()=>{
 const source=await fs.readFile(new URL('./t04-metamask.mjs',import.meta.url),'utf8'),{runInNewContext}=await import('node:vm');const start=source.indexOf('export async function driveMetaMaskPaidRecovery'),end=source.indexOf('export function retainedPreparedClaimFlag',start),body=source.slice(start,end),call=body.match(/await dialog\.getByText\(\/\^Private Bok balance:.*?\.waitFor\(\);/)[0];let matcher;await runInNewContext('(async()=>{'+call+'})()',{dialog:{getByText:pattern=>{matcher=pattern;return{waitFor:async()=>{}};}}});
 for(const amount of ['1','0.99','0.59','0','0.000001'])assert(matcher.test('Private Bok balance: '+amount+' USDC-backed credits.'));for(const amount of ['-1','NaN','01','0.0000001','private'])assert(!matcher.test('Private Bok balance: '+amount+' USDC-backed credits.'));
 assert(body.includes('claimed.paymentMatches,true'));assert(body.includes('claimed.claimMatches,true'));assert(body.includes('claimed.claimConfirmed,true'));
});

test('entered Bok approval survives interrupted confirmation and rejects a second financial invocation',async t=>{
 const {driveRetainedBokJourney:drive,reserveRetainedBokObservation:reserve,readRetainedBokObservation:read,validateRetainedBokApproval:validate}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),{createHash}=await import('node:crypto');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-entered-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=retainedBokFixture();f.control.recoveryDirectory=await fs.realpath(dir);Object.assign(f.approval,{completion:'post-only',observationFile:path.join(f.control.recoveryDirectory,'bok-entered-observation.json')});f.approval.contentSha256=createHash('sha256').update(f.approval.content).digest('hex');let confirmations=0;const failure=Error('simulated process interruption after submission'),page={getByRole:()=>({}),evaluate:async()=>{}};const context={assert,retainedBokRemaining:()=>()=>1000,validateRetainedBokApproval:validate,reserveRetainedBokObservation:reserve,driveRetainedBokConfirmations:async()=>{confirmations++;throw failure;}};const invoke=()=>runInNewContext('('+drive+')',context)({page,control:f.control,approval:f.approval,mark:()=>{},report:{paidRecovery:{readyFromConfirmedPrivateClaim:true}},deadlineAt:1});await assert.rejects(invoke(),e=>e===failure);assert.throws(()=>read(f.approval.observationFile));await assert.rejects(invoke(),/never resubmitted/);assert.equal(confirmations,1);
 const other=path.join(f.control.recoveryDirectory,'bok-replaced-observation.json'),r=reserve(other);await fs.unlink(other);await fs.writeFile(other,'replacement',{mode:0o600});assert.throws(()=>r.complete({authorizationTxHash:hash,transactionHash:hash,requestId:'30',target:'40'}),/reservation changed/);r.close();assert.throws(()=>reserve(other),{code:'EEXIST'});
});

test('Ready continuity authenticates original encrypted claim without restoring stale journals',async()=>{
 const {inspectRetainedReadyContinuity:inspect}=await import('./t04-metamask.mjs'),{createEncryptedJournalSlot}=await import('../shared/journal-record.mjs'),{runInNewContext}=await import('node:vm');
 const secret='0x'+'01'.repeat(32),salt='1',owner='0x'+'02'.repeat(32),n={chainId:'31337',rollupVersion:'17',rollupAddress:'0x'+'03'.repeat(20)},board={contractAddress:'0x'+'04'.repeat(32),portalAddress:'0x'+'05'.repeat(20)},router='0x'+'06'.repeat(20);
 const intent={from:'payer',to:router,chainId:'31337',nonce:0,data:'0x1234',value:'0',expected:{planHash:'plan'}},input={network:n,board,router,intent,transactionHash:hash,envelope:{},password:'synthetic'};
 const fundingScope=JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1',n.chainId,n.rollupVersion,n.rollupAddress,board.contractAddress,router,owner,1]),workflowScope=JSON.stringify(['ROLLING_WORKFLOW_V1',JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',owner,n.chainId,n.rollupAddress,n.rollupVersion,board.contractAddress,board.portalAddress])]);
 const funding={intent,privateFeeCap:'20',claim:{intentId:'original',attempted:true}},claim={id:'original',status:'confirmed',txHash:'0x'+'ab'.repeat(32),maximumFee:'19',action:{type:'claim-deposit',...Object.fromEntries(['receipt','feeReceipt','bokReceipt'].map(k=>[k,{txHash:hash}]))}};
 async function fixture(change=()=>{}){
  const state={funding:structuredClone(funding),historicalFunding:structuredClone(funding),claim:structuredClone(claim),current:{id:'newer',status:'confirmed',action:{type:'withdraw-bok'}},status:'fee-ready',wallet:{secretKey:secret,salt}};change(state);let writes=0,statusReads=0;
  const build=async(f,c)=>{const records=new Map(),storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,old,value)=>{assert.equal(records.get(key)??null,old);records.set(key,value);}};for(const [scopeText,keyDomain,value]of [[fundingScope,'ROLLING_AGGREGATE_FUNDING_V1',f],[workflowScope,'ROLLING_WORKFLOW_V1',c]]){const slot=await createEncryptedJournalSlot({storage,walletSecret:secret,walletSalt:salt,scopeText,keyDomain});await slot.write(await slot.read(),value);}return records;};
  const original=await build(state.historicalFunding,state.claim),current=await build(state.funding,state.current),before=JSON.stringify([...current]);
  const storage={read:async key=>current.get(key)??null,compareAndSwap:async()=>{writes++;throw Error('must not restore');}},window={walletState:{aztec:{secretKey:secret,salt,address:{toString:()=>owner}}},BillboardWalletBackup:{decrypt:async()=>({wallet:state.wallet,journals:[...original].map(([key,encoded])=>({key,encoded}))})},__aztec:{createBrowserJournalStorage:()=>storage,createEncryptedJournalSlot}};
  const runtimeLoader=async()=>({loadRollingWalletRuntime:async()=>({createSession:async()=>({application:{readAccountStatus:async()=>{statusReads++;return {status:state.status};}}})})});
  const fn=runInNewContext('('+inspect.toString().replace("await import('/wallet/runtime.mjs')",'await runtimeLoader()')+')',{window,runtimeLoader});
  return {run:()=>fn(input),check:()=>{assert.equal(writes,0);assert.equal(JSON.stringify([...current]),before);},statusReads:()=>statusReads};
 }
 for(const type of ['withdraw-bok','bok']){const f=await fixture(s=>s.current.action.type=type),result=await f.run();assert.equal(result.originalClaimConfirmed,true);assert.equal(result.claimTransactionHash,claim.txHash);assert.equal(result.currentAccountStatus,'fee-ready');assert.equal(f.statusReads(),1);f.check();}
 for(const mutate of [s=>s.wallet.secretKey='foreign',s=>s.wallet.salt='2',s=>s.funding.claim.intentId='other',s=>s.historicalFunding.intent.data='0x5678',s=>s.claim.id='other',s=>s.claim.action.bokReceipt.txHash='0x'+'de'.repeat(32),s=>s.claim.status='submitted',s=>s.claim.maximumFee='21',s=>s.current.status='unknown',s=>s.current.status='prepared',s=>s.status='recovering',s=>s.status='collateral-pending']){const f=await fixture(mutate);await assert.rejects(f.run(),/continuity differs/);f.check();}
});

test('Ready continuity input requires the exact immutable private export and rejects aliases',async t=>{
 const {readRetainedReadyExport:read}=await import('./t04-metamask.mjs'),{createHash}=await import('node:crypto'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'ready-continuity-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filename=path.join(directory,'ready-recovery-export.json'),body='{"synthetic":true}',sha=createHash('sha256').update(body).digest('hex');await fs.writeFile(filename,body,{mode:0o600});assert.deepEqual(read(sha,{recoveryDirectory:directory}),{envelope:{synthetic:true},sha256:sha});assert.throws(()=>read('0'.repeat(64),{recoveryDirectory:directory}));await fs.chmod(filename,0o644);assert.throws(()=>read(sha,{recoveryDirectory:directory}));await fs.chmod(filename,0o600);await fs.rename(filename,filename+'.original');await fs.symlink(filename+'.original',filename);assert.throws(()=>read(sha,{recoveryDirectory:directory}));
});

test('Ready continuation observes existing custody and canonical claim without opening saved funding',async()=>{
 const {driveMetaMaskReadyContinuation:drive,inspectRetainedReadyContinuity,installMetaMaskPaidRecoveryGuard}=await import('./t04-metamask.mjs'),{runInNewContext}=await import('node:vm'),events=[],report={},readyExport={envelope:{ciphertext:'synthetic'},sha256:'ab'},control={asset:'USDC',password:'synthetic',walletConfig:{config:{network:{},board:{}}}};
 const context={assert,retainedCanonicalPayment:async(c,p,tx,options)=>{assert.equal(options.advanced,true);events.push('payment');return{scope:{router:'router'},intent:{expected:{planHash:'plan'}},account:'account',nonce:1};},installMetaMaskPaidRecoveryGuard,inspectRetainedReadyContinuity,retainedBokRemaining:()=>()=>1000,inspectMetaMaskAggregateReadiness:async args=>{assert.equal(args.keysOnly,true);assert.equal(args.recoveryFile,undefined);events.push('keys-only');},verifyRetainedClaimReceipt:async()=>{events.push('canonical-claim');return{canonical:true};}};
 const page={exposeFunction:async()=>{},evaluate:async(fn,args)=>{if(fn===installMetaMaskPaidRecoveryGuard){events.push('guard');return;}assert.equal(fn,inspectRetainedReadyContinuity);assert.equal(args.envelope,readyExport.envelope);events.push('continuity');return{claimTransactionHash:hash};}},provider={getTransactionCount:async()=>1};const final=await runInNewContext('('+drive+')',context)({page,control,provider,transactionHash:hash,readyExport,mark:()=>{},report,deadlineAt:1});final();assert.deepEqual(events,['payment','guard','keys-only','continuity','canonical-claim']);assert.equal(report.paidRecovery.readyFromConfirmedPrivateClaim,true);assert.equal(report.paidRecovery.userSends,0);
});

test('failed observation fsync leaves an exclusive blocker before any confirmation',async t=>{
 const {reserveRetainedBokObservation:reserve}=await import('./t04-metamask.mjs'),sync=await import('node:fs'),{runInNewContext}=await import('node:vm'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-fsync-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filename=path.join(dir,'bok-failure-observation.json'),failure=Error('synthetic fsync failure'),broken={...sync,fsyncSync(){throw failure;}};assert.throws(()=>runInNewContext('('+reserve+')',{fs:broken,path,assert,process})(filename),e=>e===failure);assert.equal(JSON.parse(await fs.readFile(filename,'utf8')).state,'entered');assert.throws(()=>reserve(filename),{code:'EEXIST'});
});

for(const failedPhase of ['authorize','post'])test('Bok '+failedPhase+' preparation error stops before confirmation without waiting the full deadline',async()=>{
 const {driveRetainedBokConfirmations}=await import('./t04-metamask.mjs');let phase='authorize',sends=0,errorRaced=false;
 const node=name=>({or(other){assert.equal(other.name,undefined);errorRaced=true;return this;},first(){return this;},name,
  waitFor:async()=>{},isVisible:async()=>phase!==failedPhase,fill:async()=>{},selectOption:async()=>{},
  click:async()=>{if(name==='Review saved Bok post')phase='post';if(name==='Confirm and send')sends++;}});
 const dialog={getByRole:(_,{name})=>node(name),getByLabel:node,getByText:node};
 await assert.rejects(driveRetainedBokConfirmations({dialog,approval:{},report:{retainedBok:{}},mark:()=>{},inspect:async()=>({})}),/Bok preparation failed/);
 assert(errorRaced);assert.equal(sends,failedPhase==='authorize'?0:1);
});

for(const failedPhase of ['authorize','post'])test('Bok '+failedPhase+' confirmation error stops without replay or a full-deadline wait',async()=>{
 const {driveRetainedBokConfirmations}=await import('./t04-metamask.mjs');let phase='authorize',sends=0,failedWaits=0;
 const node=name=>({name,or(other){assert.equal(other.name,undefined);return this;},first(){return this;},
  waitFor:async()=>{if((name==='Review saved Bok post'&&failedPhase==='authorize')||(name==='Transaction confirmed on the verified chain.'&&failedPhase==='post'))failedWaits++;},
  isVisible:async()=>!((name==='Review saved Bok post'&&failedPhase==='authorize')||(name==='Transaction confirmed on the verified chain.'&&failedPhase==='post')),
  fill:async()=>{},selectOption:async()=>{},click:async()=>{if(name==='Review saved Bok post')phase='post';if(name==='Confirm and send')sends++;}});
 const dialog={getByRole:(_,{name})=>node(name),getByLabel:node,getByText:node},inspections=[];
 await assert.rejects(driveRetainedBokConfirmations({dialog,approval:{},report:{retainedBok:{}},mark:()=>{},inspect:async(p,s)=>{inspections.push(p+'-'+s);return{};}}),failedPhase==='authorize'?/Bok authorization did not complete/:/Bok publication did not complete/);
 assert.equal(failedWaits,1);assert.equal(sends,failedPhase==='authorize'?1:2);assert(!inspections.includes(failedPhase+'-confirmed'));
});
