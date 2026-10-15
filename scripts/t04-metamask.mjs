// Test-only wallet UI actions. The caller owns the context and its lifecycle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT} from './toolchain.mjs';
import {Interface,parseEther,formatUnits,Wallet,AbiCoder,keccak256,encodeBytes32String,verifyTypedData,TypedDataEncoder,Transaction} from 'ethers';
import {aggregateFundingAbi,collateralConsentTypes,usdcAuthorizationTypes} from '../shared/rolling/aggregate-funding.mjs';
import {verifyEthereumIntentReceipt} from '../shared/ethereum-journal.mjs';
import {validateAggregateFundingIntent} from '../shared/rolling/aggregate-recovery.mjs';
import {unpackRollingText,validateRollingScope} from '../shared/rolling/public-events.mjs';
export function assertMetaMaskTransaction({stage,request,account,chainId,tokenAddress,feePortalAddress,privateFeeAddress,boardPortalAddress,fundingAmount,collateralAmount,expectedChainId=31337n}){
 assert(Array.isArray(request)&&request.length===1);const tx=request[0];
 assert([31337n,11155111n].includes(BigInt(expectedChainId)),'Only disposable devnet or Sepolia testnet');
 assert.equal(BigInt(chainId),BigInt(expectedChainId));assert(tx.chainId===undefined||BigInt(tx.chainId)===BigInt(expectedChainId));
 assert.equal(tx.from?.toLowerCase(),account.toLowerCase());
 const methods={'fee-approval':'approve','fee-deposit':'depositToAztecPublic',deposit:'deposit',refund:'withdraw'};
 assert(Object.hasOwn(methods,stage));
 const iface=new Interface(['function approve(address,uint256)','function depositToAztecPublic(bytes32,uint256,bytes32)','function deposit(bytes32) payable','function withdraw(uint256,uint256,uint256,bytes32[])']);
 const parsed=iface.parseTransaction({data:tx.data});assert.equal(parsed?.name,methods[stage]);
 assert.equal(iface.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase(),tx.data.toLowerCase());
 const target=stage==='fee-approval'?tokenAddress:stage==='fee-deposit'?feePortalAddress:boardPortalAddress;
 assert.equal(tx.to?.toLowerCase(),target.toLowerCase());
 assert.equal(BigInt(tx.value??0),stage==='deposit'?parseEther(collateralAmount):0n);
 if(stage==='fee-approval'||stage==='fee-deposit'){
  assert.equal(parsed.args[0].toLowerCase(),(stage==='fee-approval'?feePortalAddress:privateFeeAddress).toLowerCase());
  assert.equal(parsed.args[1],parseEther(fundingAmount));
  if(stage==='fee-deposit')assert.notEqual(BigInt(parsed.args[2]),0n);
 }
}
export const metamaskArchive='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';
export function unpackMetaMask(directory){
 const archive=path.join(ROOT,metamaskArchive);
 assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'7ba00bfe4fe8b0ffb27be1e8fc06506248f1b888cb4f2e5e5e8b1c37f461f262');
 const extension=path.join(directory,'extension');execFileSync('/usr/bin/unzip',['-q',archive,'-d',extension]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,'13.49.0.0');return extension;
}
// Fixed, public page classes only: no URLs, extension IDs, account data or DOM.
export function metaMaskPageCounts(context,applicationOrigin){
 const counts={application:0,extensionHome:0,extensionSidepanel:0,extensionOther:0,blank:0,other:0,workers:0};
 for(const page of context.pages()){
  const url=new URL(page.url());
  const key=url.origin===applicationOrigin?'application':url.protocol==='chrome-extension:'?(url.pathname==='/home.html'?'extensionHome':url.pathname==='/sidepanel.html'?'extensionSidepanel':'extensionOther'):url.href==='about:blank'?'blank':'other';
  counts[key]++;
 }
 counts.workers=context.serviceWorkers().length;return counts;
}
export function recordMetaMaskStage(write,context,applicationOrigin,stage){
 // Observer failures must never replace application or wallet behavior.
 try{write({kind:'wallet-stage',stage,pages:metaMaskPageCounts(context,applicationOrigin)});}catch{}
}
export async function onboardMetaMask(context,mnemonic,password,extensionId,mark,beforeAcceptTerms=async()=>{}){
 for(const page of context.pages())if(page.url().startsWith('chrome-extension://'+extensionId+'/'))await page.close();
 const onboarding=await context.newPage();onboarding.setDefaultTimeout(10000);
 await onboarding.goto('chrome-extension://'+extensionId+'/home.html');
 await beforeAcceptTerms(onboarding);
 mark('wallet-import-method');await onboarding.getByTestId('onboarding-import-wallet').click();
 await onboarding.getByRole('button',{name:'Import using Secret Recovery Phrase',exact:true}).click();
 mark('wallet-import');const words=mnemonic.split(' '),first=onboarding.getByTestId('srp-input-import__srp-note');
 await first.fill(words[0]);await first.press('Space');
 for(let i=1;i<words.length;i++){const input=onboarding.getByTestId('import-srp__srp-word-'+i);await input.fill(words[i]);if(i<words.length-1)await input.press('Space');}
 await onboarding.getByTestId('import-srp-confirm').click();
 mark('wallet-password');await onboarding.getByTestId('create-password-new-input').fill(password);await onboarding.getByTestId('create-password-confirm-input').fill(password);await onboarding.getByTestId('create-password-terms').click();await onboarding.getByTestId('create-password-submit').click();
 mark('wallet-passkey');await onboarding.getByTestId('passkey-maybe-later-button').click();
 mark('wallet-privacy');const analytics=onboarding.getByTestId('metametrics-checkbox');await analytics.waitFor();assert.equal(await analytics.getAttribute('data-checked'),'true');await analytics.click();assert.equal(await analytics.getAttribute('data-checked'),'false');assert.equal(await onboarding.getByTestId('metametrics-data-collection-checkbox').getAttribute('data-checked'),'false');await onboarding.getByTestId('metametrics-i-agree').click();
 mark('wallet-completion');
 // MetaMask opens its own wallet page at completion; reuse that surface rather
 // than loading another copy of the extension UI alongside onboarding.
 await onboarding.getByTestId('onboarding-complete-done').click();
 const deadline=Date.now()+10000;let walletPage;
 while(Date.now()<deadline&&!walletPage) {
  for(const page of context.pages()) {
   if(page!==onboarding&&page.url().startsWith('chrome-extension://'+extensionId+'/home.html')&&await page.getByTestId('account-menu-icon').isVisible()){walletPage=page;break;}
  }
  if(!walletPage)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(walletPage,'MetaMask did not expose its completed wallet page');
 walletPage.setDefaultTimeout(10000);
 for(const page of context.pages())if(page!==walletPage&&page.url().startsWith('chrome-extension://'+extensionId+'/'))await page.close();
 assert.equal(context.pages().filter(page=>page.url().startsWith('chrome-extension://'+extensionId+'/')).length,1);return walletPage;
}

export async function discoverTestMetaMask(page){
 await page.waitForFunction(()=>window.BillboardWalletProviders?.list().some(wallet=>wallet.name==='MetaMask'));
 await page.evaluate(()=>{globalThis.__testMetaMask=window.BillboardWalletProviders.list().find(wallet=>wallet.name==='MetaMask').provider;});
}

export async function addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl,mark}){
 await page.evaluate(()=>{let changed;globalThis.__localNetworkReady=new Promise((resolve,reject)=>{changed=chain=>chain==='0x7a69'?resolve():reject(Error('Unexpected setup chain'));globalThis.__testMetaMask.on('chainChanged',changed);}).finally(()=>globalThis.__testMetaMask.removeListener('chainChanged',changed));});
 mark('add-network');await Promise.all([
  page.evaluate(()=>globalThis.__localNetworkReady),
  page.evaluate(rpcUrl=>globalThis.__testMetaMask.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a69',chainName:'Disposable board test',rpcUrls:[rpcUrl],nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}}]}),rpcUrl).then(async()=>{assert.equal(await page.evaluate(()=>globalThis.__testMetaMask.request({method:'eth_chainId'})),'0x7a69');}),
  (async()=>{if(!walletPage.url().startsWith('chrome-extension://'+extensionId+'/sidepanel.html'))await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');mark('network-confirmation-page');await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();mark('network-name');await walletPage.getByText('Disposable board test',{exact:true}).first().waitFor();mark('network-approve');await walletPage.getByTestId('confirm-footer-button').click();})(),
 ]);
}

export async function configureMetaMaskLocalNetwork(options){
 const {page,mark}=options;
 const chain=()=>page.evaluate(()=>globalThis.__testMetaMask.request({method:'eth_chainId'}));
 if(await chain()==='0x7a69')return 'already-selected';
 mark('switch-local-network');
 const unknown=await page.evaluate(async()=>{try{await globalThis.__testMetaMask.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x7a69'}]});return false;}catch(error){if(error?.code===4902)return true;throw error;}});
 if(unknown)await addMetaMaskNetwork(options);
 assert.equal(await chain(),'0x7a69');return 'selected';
}

// Observe the real provider request unchanged. Only the explicit test hook can
// approve it; unexpected or overlapping transactions stop the test.
export async function observeMetaMaskTransactions(page){
 await page.evaluate(()=>{
  const original=globalThis.__testMetaMask.request.bind(globalThis.__testMetaMask);
  globalThis.__walletTestPending=null;globalThis.__walletTestFailure=null;globalThis.__walletTestSubmitted=[];
  globalThis.__testMetaMask.request=async request=>{
   if(request.method!=='eth_sendTransaction')return original(request);
   if(globalThis.__walletTestPending)throw Error('Overlapping wallet transaction');
   globalThis.__walletTestPending=structuredClone(request.params);
   try{const hash=await original(request);globalThis.__walletTestSubmitted.push({hash,request:structuredClone(request.params[0])});return hash;}catch(error){
    const nested=error?.data?.originalError??error;const message=String(nested?.message??'');
    globalThis.__walletTestFailure={code:Number.isSafeInteger(nested?.code)?nested.code:null,nonceTooLow:/nonce too low/i.test(message),replacement:/replacement.*underpriced/i.test(message),insufficientFunds:/insufficient funds/i.test(message),transport:/fetch|network|connection/i.test(message)};throw error;
   }finally{globalThis.__walletTestPending=null;}
  };
 });
}

export function guardBrowserRequest(route,{origin,extensionWallet,onBlocked}){
 const request=route.request(),worker=request.serviceWorker(),frame=worker?null:request.frame(),url=new URL(request.url());
 if(extensionWallet&&(worker?worker.url().startsWith('chrome-extension:'):frame.url().startsWith('chrome-extension:')))return route.continue();
 if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){
  const owner=extensionWallet&&frame?.page().url().startsWith('chrome-extension:')?'extension':'application';
  onBlocked({owner,hostname:url.hostname,resource:request.resourceType(),navigation:request.isNavigationRequest()});
  return route.abort();
 }
 return route.continue();
}

// Actual extension send admission. The caller retains the independently reviewed
// original application intent in RAM; this check never manufactures a wallet reply.
// A USDC user signs only: its payment belongs to the configured relay, not this EOA.
export function assertMetaMaskAggregatePayment({asset,request,account,chainId,intent,maximumGasWei}){
 assert.equal(asset,'ETH','USDC funding must not request a user transaction');
 assert.equal(BigInt(chainId),31337n,'This payment check is local development only');
 assert.equal(intent.expected.kind,'aggregate-funding');
 const plan=validateAggregateFundingIntent(intent);
 assert.equal(intent.chainId,'31337');assert.equal(intent.from,account.toLowerCase());
 assert(Array.isArray(request)&&request.length===1);const tx=request[0];
 assert.equal(tx.from?.toLowerCase(),intent.from);assert.equal(tx.to?.toLowerCase(),intent.to);
 assert.equal(BigInt(tx.chainId),31337n);assert.equal(tx.data?.toLowerCase(),intent.data);
 assert.equal(BigInt(tx.value??'0x0'),BigInt(intent.value));
 assert.equal(BigInt(tx.nonce),BigInt(intent.nonce));
 const gas=BigInt(tx.gas),price=BigInt(tx.maxFeePerGas??tx.gasPrice);
 assert(gas>0n&&price>0n&&BigInt(maximumGasWei)>0n&&gas*price<=BigInt(maximumGasWei));
 if(tx.maxPriorityFeePerGas!==undefined)assert(BigInt(tx.maxPriorityFeePerGas)<=price);
 assert(tx.gasPrice===undefined||tx.maxFeePerGas===undefined,'Ambiguous fee fields');
 assert(tx.authorizationList===undefined&&tx.blobs===undefined&&tx.blobVersionedHashes===undefined,'Unexpected transaction extension');
 return {planHash:intent.expected.planHash,collateral:String(plan.collateral),feeAmount:String(plan.fee.amount),bokAmount:String(plan.bok.amount)};
}


const aggregateInterface=new Interface(aggregateFundingAbi);
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value??{}).sort(),keys.slice().sort());
const positive=value=>assert(typeof value==='string'&&/^[1-9][0-9]{0,76}$/.test(value));
const localOrigin=value=>{const u=new URL(value);assert.equal(u.protocol,'http:');assert.equal(u.hostname,'127.0.0.1');assert(u.port&&u.origin===value);return value;};
export function validateMetaMaskAggregateControl(value,asset){
 exactKeys(value,['schemaVersion','asset','origin','ethereumUrl','walletConfig','mnemonic','password','recoveryDirectory','allocation','runtimeSha256']);
 assert.match(value.runtimeSha256,/^[a-f0-9]{64}$/);
 assert.equal(value.schemaVersion,1);assert.equal(value.asset,asset);assert(['ETH','USDC'].includes(asset));
 localOrigin(value.origin);localOrigin(value.ethereumUrl);
 assert.equal(value.walletConfig.proofsEnabled,false);assert.equal(value.walletConfig.config.network.chainId,'31337');
 assert.equal(new URL(value.walletConfig.config.network.ethRpcUrl).origin,value.ethereumUrl);
 const scope=value.walletConfig.config.aggregateFunding;assert(scope&&scope.chainId==='31337');
 for(const key of ['router','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','quoter'])assert.match(scope[key],/^0x[0-9a-f]{40}$/);
 for(const key of ['routerCodeHash','quoterCodeHash'])assert.match(scope[key],/^0x[0-9a-f]{64}$/);
 assert.equal(scope.collateralPortal,value.walletConfig.config.board.portalAddress);
 if(asset==='USDC'){assert.match(scope.usdcRelayAddress,/^0x[0-9a-f]{40}$/);assert.deepEqual(scope.usdcDomain,{name:'Local USD Coin',version:'2'});for(const k of ['usdcCodeHash','usdcImplementationCodeHash'])assert.match(scope[k],/^0x[0-9a-f]{64}$/);assert.match(scope.usdcImplementation,/^0x[0-9a-f]{40}$/);}
 assert.equal(typeof value.password,'string');assert(value.password.length>=16&&value.password.length<=128);
 assert.equal(typeof value.mnemonic,'string');assert.equal(value.mnemonic.split(' ').length,12);Wallet.fromPhrase(value.mnemonic);
 assert(path.isAbsolute(value.recoveryDirectory));
 exactKeys(value.allocation,['collateralWei','feeAmount','bokAmount','gasBudgetWei','maximumPaymentWei','maximumUsdc','slippageBps']);
 for(const key of ['collateralWei','feeAmount','bokAmount','gasBudgetWei','maximumPaymentWei','maximumUsdc'])positive(value.allocation[key]);
 assert(Number.isSafeInteger(value.allocation.slippageBps)&&value.allocation.slippageBps>=0&&value.allocation.slippageBps<=500);
 return structuredClone(value);
}
export function readMetaMaskAggregateControl(filename,asset,{readinessOnly=false,continueUnfunded=false,continueUnsigned=false,paidRecovery=false}={}){
 assert([readinessOnly,continueUnfunded,continueUnsigned,paidRecovery].filter(Boolean).length<=1);const retained=readinessOnly||continueUnfunded||continueUnsigned||paidRecovery;
 assert(path.isAbsolute(filename??''),'Required private launch control is absent');
 const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.size<=65536);
 const c=validateMetaMaskAggregateControl(JSON.parse(fs.readFileSync(filename,'utf8')),asset),dir=fs.lstatSync(c.recoveryDirectory);
 assert(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid()&&(dir.mode&0o777)===0o700);
 assert.equal(fs.realpathSync(c.recoveryDirectory),c.recoveryDirectory);
 for(const name of ['profile','extension']){const location=path.join(c.recoveryDirectory,name);if(retained){const entry=fs.lstatSync(location);assert(entry.isDirectory()&&!entry.isSymbolicLink()&&entry.uid===process.getuid());}else assert(!fs.existsSync(location),'Use a new disposable profile; never replay an existing funding run');}
 if(retained){const backup=fs.lstatSync(path.join(c.recoveryDirectory,'initial-recovery.json'));assert(backup.isFile()&&!backup.isSymbolicLink()&&backup.uid===process.getuid()&&(backup.mode&0o777)===0o600);}
 if(continueUnfunded||continueUnsigned)assert(!fs.existsSync(path.join(c.recoveryDirectory,'prepared-recovery.json')),'Prepared funding must use journal recovery, never this continuation');
 if(paidRecovery){const backup=fs.lstatSync(path.join(c.recoveryDirectory,'prepared-recovery.json'));assert(backup.isFile()&&!backup.isSymbolicLink()&&backup.uid===process.getuid()&&(backup.mode&0o777)===0o600);}
 return c;
}
export function assertMetaMaskAggregateTypedData({data,account,scope,allocation,index,asset,consentNonce,nowSeconds}){
 assert(data&&typeof data==='object');const {EIP712Domain,...types}=data.types??{};
 const domain={...data.domain,chainId:BigInt(data.domain?.chainId).toString()},message=data.message;
 assert.equal(domain.chainId,'31337');assert(message&&typeof message==='object');
 if(index===0){
  assert.equal(data.primaryType,'DepositFor');assert.deepEqual(types,collateralConsentTypes);
  assert.deepEqual(domain,{name:'RollingCollateral',version:'1',chainId:'31337',verifyingContract:scope.collateralPortal});
  exactKeys(message,['beneficiary','executor','amount','secretHash','nonce','deadline']);
  assert.equal(message.beneficiary.toLowerCase(),account);assert.equal(message.executor.toLowerCase(),scope.router);
  assert.equal(BigInt(message.amount),BigInt(allocation.collateralWei));assert.equal(BigInt(message.nonce),BigInt(consentNonce));
  assert.match(message.secretHash,/^0x[0-9a-f]{64}$/);assert(BigInt(message.secretHash)>0n);
  assert(BigInt(message.deadline)>BigInt(nowSeconds)&&BigInt(message.deadline)<=BigInt(nowSeconds+120));
 }else{
  assert.equal(asset,'USDC');assert.equal(index,1);assert.equal(data.primaryType,'ReceiveWithAuthorization');assert.deepEqual(types,usdcAuthorizationTypes);
  assert.deepEqual(domain,{name:scope.usdcDomain.name,version:scope.usdcDomain.version,chainId:'31337',verifyingContract:scope.bokToken});
  exactKeys(message,['from','to','value','validAfter','validBefore','nonce']);
  assert.equal(message.from.toLowerCase(),account);assert.equal(message.to.toLowerCase(),scope.router);
  assert(BigInt(message.value)>0n&&BigInt(message.value)<=BigInt(allocation.maximumUsdc));
  assert(BigInt(message.validAfter)<BigInt(nowSeconds)&&BigInt(message.validBefore)>BigInt(nowSeconds)&&BigInt(message.validBefore)<=BigInt(nowSeconds+120));
  assert.match(message.nonce,/^0x[0-9a-f]{64}$/);
 }
 if(EIP712Domain!==undefined)assert.deepEqual(EIP712Domain,TypedDataEncoder.getPayload(domain,types,message).types.EIP712Domain);
 return {domain,types,value:structuredClone(message)};
}

// Bounded driver of the actual served application. Resources belong to the
// existing caller. Only public effects enter the report; signatures stay in RAM.
export async function driveMetaMaskAggregateFunding({context,page,walletPage,control,provider,mark,report,continueUnfunded=false,unsignedContinuation=null,deadlineAt}){
 const remaining=retainedBokRemaining(deadlineAt);
 const c=control,scope=c.walletConfig.config.aggregateFunding,a=c.allocation,account=Wallet.fromPhrase(c.mnemonic).address.toLowerCase();
 const portal=new Interface(['function depositNonces(address) view returns(uint256)']);
 const consentNonce=portal.decodeFunctionResult('depositNonces',await provider.call({to:scope.collateralPortal,data:portal.encodeFunctionData('depositNonces',[account])}))[0];
 assert.equal((await provider.getNetwork()).chainId,31337n);
 const initialBalance=await provider.getBalance(account);if(c.asset==='USDC')assert.equal(initialBalance,0n);else assert(initialBalance>=BigInt(a.maximumPaymentWei)+BigInt(a.gasBudgetWei));
 if(c.asset==='USDC'){const token=new Interface(['function balanceOf(address) view returns(uint256)']);const balance=token.decodeFunctionResult('balanceOf',await provider.call({to:scope.bokToken,data:token.encodeFunctionData('balanceOf',[account])}))[0];assert(balance>=BigInt(a.maximumUsdc));}
 const initialNonce=await provider.getTransactionCount(account,'pending');assert.equal(initialNonce,0,'Fresh disposable user only');
 let relayCompleted=false;let unsignedApproved=unsignedContinuation===null;let intent=null,hash=null,relayPosts=0,userSends=0,confirmedSignatures=0;const signatures=[],typed=[],pending=[],errors=[];
 const permission={entered:false,resolved:false,rejected:false};report.aggregatePermission=permission;
 const connectionMethods=new Set(['wallet_requestPermissions','eth_chainId','wallet_switchEthereumChain','eth_requestAccounts','eth_accounts']);
 const connection={entered:null,resolved:null,rejected:null};report.aggregateConnection=connection;
 const remember=error=>{errors.push(error);};
 const inspectData=(data,from)=>{
  const method=c.asset==='ETH'?'fund':'fundUsdc',parsed=aggregateInterface.parseTransaction({data});assert.equal(parsed.name,method);
  const plan=parsed.args[0],planHash=keccak256(AbiCoder.defaultAbiCoder().encode([aggregateInterface.getFunction(method).inputs[0]],[plan]));
  const expected={kind:c.asset==='ETH'?'aggregate-funding':'aggregate-usdc-funding',routerCodeHash:scope.routerCodeHash,collateralPortal:scope.collateralPortal,feePortal:scope.feePortal,bokPortal:scope.bokPortal,privateFpc:scope.privateFpc,planHash};
  const value=c.asset==='ETH'?String(plan.collateral+plan.fee.maxEth+plan.bok.maxEth):'0';
  const record={from,to:scope.router,chainId:'31337',nonce:initialNonce,data:data.toLowerCase(),value,expected};validateAggregateFundingIntent(record);
  assert.equal(plan.beneficiary.toLowerCase(),account);assert.equal(String(c.asset==='ETH'?plan.collateral:plan.collateral.amount),a.collateralWei);
  assert.equal(String(plan.fee.amount),a.feeAmount);assert.equal(String(c.asset==='ETH'?plan.bok.amount:plan.bokAmount),a.bokAmount);
  assert.equal(plan.fee.poolFee,3000n);assert.equal(c.asset==='ETH'?plan.bok.poolFee:plan.collateral.poolFee,3000n);
  assert.equal(String(plan.nonce),String(consentNonce));assert.equal(String(plan.deadline),String(typed[0]?.value.deadline));assert.equal(plan.collateralSecretHash,typed[0]?.value.secretHash);
  assert.equal(parsed.args[1],signatures[0]);
  if(c.asset==='ETH')assert(BigInt(value)<=BigInt(a.maximumPaymentWei));
  else{
   assert.equal(plan.relayer.toLowerCase(),scope.usdcRelayAddress);assert.equal(parsed.args[2],signatures[1]);
   const nonce=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32'],[encodeBytes32String('ROLLING_USDC_FUNDING_V1'),31337,scope.router,planHash]));
   assert.equal(nonce,typed[1]?.value.nonce);assert.equal(BigInt(typed[1].value.value),plan.collateral.maxUsdc+plan.fee.maxUsdc+plan.bokAmount+plan.relayFeeUsdc);
   assert.equal(BigInt(typed[1].value.validAfter),plan.validAfter);assert.equal(BigInt(typed[1].value.validBefore),plan.deadline);
  }
  return record;
 };
 await page.exposeFunction('__aggregateWalletBefore',async request=>{
  try{
   if(connectionMethods.has(request.method))connection.entered=request.method;
   if(request.method==='eth_signTypedData_v4'){
    assert(unsignedApproved,'Original unsigned custody must be verified before signing');
    assert.equal(request.params[0].toLowerCase(),account);assert.equal(typed.length,signatures.length);
    const data=JSON.parse(request.params[1]);typed.push(assertMetaMaskAggregateTypedData({data,account,scope,allocation:a,index:typed.length,asset:c.asset,consentNonce,nowSeconds:Math.floor(Date.now()/1000)}));pending.push('signature');return;
   }
   if(request.method==='eth_sendTransaction'){
    assert.equal(c.asset,'ETH');assert.equal(userSends,0);assert.equal(signatures.length,1);
    const tx=request.params[0];intent=inspectData(tx.data,account);
    assertMetaMaskAggregatePayment({asset:c.asset,request:request.params,account,chainId:'31337',intent,maximumGasWei:a.gasBudgetWei});userSends++;pending.push('payment');return;
   }
   if(request.method==='wallet_requestPermissions'){assert.deepEqual(request.params,[{eth_accounts:{}}]);permission.entered=true;return;}
   if(request.method==='wallet_switchEthereumChain'){assert.deepEqual(request.params,[{chainId:'0x7a69'}]);return;}
   assert(['eth_chainId','eth_accounts','eth_requestAccounts','eth_blockNumber','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_getCode'].includes(request.method),'Unexpected wallet method');
  }catch(error){remember(error);throw Error('Aggregate wallet request rejected');}
 });
 await page.exposeFunction('__aggregateWalletAfter',({method,result})=>{
  try{if(connectionMethods.has(method))connection.resolved=method;if(method==='wallet_requestPermissions')permission.resolved=true;else if(method==='eth_signTypedData_v4'){const t=typed[signatures.length];assert.equal(verifyTypedData(t.domain,t.types,t.value,result).toLowerCase(),account);signatures.push(result);}else if(method==='eth_sendTransaction'){assert.match(result,/^0x[0-9a-f]{64}$/);hash=result;}}catch(error){remember(error);throw Error('Aggregate wallet result rejected');}
 });
 await page.exposeFunction('__aggregateWalletPermissionRejected',()=>{permission.rejected=true;});
 await page.exposeFunction('__aggregateWalletConnectionRejected',record=>{assert(connectionMethods.has(record.method));assert([4001,4100,4200,4900,4901,4902,-32002,-32603,'unknown'].includes(record.code));connection.rejected=record;});
 await page.evaluate(installMetaMaskAggregateObserver);
 const routeTasks=new Set();
 const relayRoute=async route=>{
  const task=(async()=>{try{
   const req=route.request();if(req.method()!=='POST')return await route.continue();
   assert(unsignedApproved);assert.equal(c.asset,'USDC');assert.equal(relayPosts,0);assert.equal(signatures.length,2);const body=JSON.parse(req.postData());exactKeys(body,['data']);
   intent=inspectData(body.data,scope.usdcRelayAddress);relayPosts++;await route.continue();
   report.relayResponse={received:false,status:null};await observeMetaMaskRelayResponse(req,report.relayResponse);relayCompleted=true;
  }catch(error){remember(error);await route.abort();}})();routeTasks.add(task);try{await task;}finally{routeTasks.delete(task);}
 };
 await page.route(c.origin+'/api/funding/usdc',relayRoute);
 try{
  mark('aggregate-private-account');
  if(continueUnfunded||unsignedContinuation){
   assert.equal(consentNonce,0n,'Previously signed funding must be reconciled');
   await inspectMetaMaskAggregateReadiness({page,control:c,mark,remaining});
   // Inspect the real encrypted journal export inside the page; only booleans
   // leave it. No backup custody or private account identity is reported.
   if(unsignedContinuation){
    assert.equal(initialNonce,0);assert.equal(c.asset,'USDC');
    report.retainedUnsigned=await page.evaluate(inspectMetaMaskUnsignedExport,{network:c.walletConfig.config.network,board:c.walletConfig.config.board,router:scope.router,phase:'continuation',envelope:unsignedContinuation.envelope,password:c.password,account});
    assertMetaMaskUnsignedAdmission({ethereumNonce:initialNonce,consentNonce,binding:report.retainedUnsigned});
   }else{const empty=await page.evaluate(async password=>{const envelope=await window.BillboardAccount.exportRecovery(password),payload=await window.BillboardWalletBackup.decrypt(envelope,password);return Array.isArray(payload.journals)&&payload.journals.length===0&&Array.isArray(payload.claims)&&payload.claims.length===0;},c.password);
   assertMetaMaskUnfundedContinuation({ethereumNonce:initialNonce,consentNonce,emptyRecovery:empty});report.retainedUnfundedContinuation=true;}
  }else{
   await page.getByRole('button',{name:'Your account',exact:true}).click();const initialDialog=page.getByRole('dialog');
   if(await initialDialog.getByRole('button',{name:'Unlock',exact:true}).isVisible())await initialDialog.getByRole('button',{name:'Unlock',exact:true}).click();await initialDialog.getByLabel('Recovery password',{exact:true}).fill(c.password);
   const [initial]=await Promise.all([page.waitForEvent('download'),initialDialog.getByRole('button',{name:'Create account and download recovery',exact:true}).click()]);
   await saveEncryptedDownload(initial,path.join(c.recoveryDirectory,'initial-recovery.json'));mark('aggregate-initial-recovery-saved');
  }
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Recover funding',exact:true}).click({timeout:remaining()});
  mark('aggregate-connect-wallet');await dialog.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  report.accountSelection=await confirmMetaMaskRecoveryAccountSelection(walletPage,{page,account,chainId:'31337',permission,observe:state=>{report.accountSelectionState=state;}});
  await dialog.getByText('Funding wallet connected. No payment has been sent.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),account);
  if(c.asset==='USDC')await dialog.getByLabel('Pay with',{exact:true}).selectOption('USDC');
  for(const [label,value]of [['Posting deposit (ETH)',formatUnits(a.collateralWei,18)],['Network fee credit (fee tokens)',formatUnits(a.feeAmount,18)],['Bok credit (USDC)',formatUnits(a.bokAmount,6)],['Slippage limit (%)',String(a.slippageBps/100)]])await dialog.getByLabel(label,{exact:true}).fill(value);
  if(c.asset==='ETH')await dialog.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).fill(formatUnits(a.gasBudgetWei,18));
  mark('aggregate-review');await dialog.getByRole('button',{name:'Get fresh quote',exact:true}).click();await dialog.getByRole('button',{name:'Confirm funding and private claim',exact:true}).waitFor();
  // A fresh review must retain the original encrypted fee approval.
  if(unsignedContinuation){const checked=await page.evaluate(inspectMetaMaskUnsignedExport,{network:c.walletConfig.config.network,board:c.walletConfig.config.board,router:scope.router,phase:'requote',account});assert.equal(checked.originalFeeCapPreserved,true);report.retainedUnsigned.originalFeeCapPreserved=true;}
  // Custody written by prepare must be exported before any signature/payment.
  await dialog.getByText('Backup and account security',{exact:true}).click();await dialog.getByLabel('New recovery password',{exact:true}).fill(c.password);
  const [prepared]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download encrypted recovery',exact:true}).click()]);await saveEncryptedDownload(prepared,path.join(c.recoveryDirectory,'prepared-recovery.json'));
  assert.equal(userSends,0);assert.equal(relayPosts,0);assert.equal(signatures.length,0);
  unsignedApproved=true;mark('aggregate-confirm');await dialog.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();
  const expires=Date.now()+60000;
  while(Date.now()<expires){
   if(errors.length)throw errors[0];
   if(pending.length){const next=pending.shift();await walletPage.getByTestId('confirm-footer-button').click();if(next==='signature')confirmedSignatures++;}
   if(c.asset==='USDC'&&intent&&!hash){report.relayStatus??={received:false,status:null};const status=await pollMetaMaskRelayStatus({origin:c.origin,planHash:intent.expected.planHash,completed:relayCompleted,observation:report.relayStatus});if(status?.transactionHash)hash=status.transactionHash;}
   if(hash){
    const tx=await provider.getTransaction(hash),receipt=await provider.getTransactionReceipt(hash);
    if(tx&&receipt){if(c.asset==='USDC')intent={...intent,nonce:tx.nonce};const verified=await verifyEthereumIntentReceipt(provider,intent,hash);assert.equal(verified.outcome,'success');
     assert.equal(signatures.length,c.asset==='ETH'?1:2);assert.equal(confirmedSignatures,signatures.length);assert.equal(userSends,c.asset==='ETH'?1:0);assert.equal(relayPosts,c.asset==='ETH'?0:1);
     if(c.asset==='USDC')assert.equal(await provider.getBalance(account),0n);
     report.aggregate={asset:c.asset,transactionHash:hash,planHash:intent.expected.planHash,userSends,relayPosts,signatures:signatures.length,canonicalEffectsVerified:true,collateral:verified.event.collateral.amount,privateFee:verified.event.privateFee.amount,bok:verified.event.bok.amount,privateClaimQualified:false,postQualified:false};
     const timeout=Math.min(80000,deadlineAt-Date.now());assert(Number.isSafeInteger(timeout)&&timeout>0,'Original wallet deadline exhausted');
     mark('aggregate-automatic-private-claim');
     await waitMetaMaskAutomaticClaim({page,binding:{network:c.walletConfig.config.network,board:c.walletConfig.config.board,router:scope.router,intent,transactionHash:hash},report,timeout});
     if(c.asset==='USDC'){assert.equal(await provider.getBalance(account),0n);assert.equal(await provider.getTransactionCount(account,'pending'),0);}
     return ()=>{assert.equal(errors.length,0);assert.equal(userSends,c.asset==='ETH'?1:0);assert.equal(relayPosts,c.asset==='ETH'?0:1);assert.equal(signatures.length,c.asset==='ETH'?1:2);};
    }
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Aggregate payment observation deadline');
 }finally{await Promise.allSettled([...routeTasks]);report.aggregateAttempts={userSends,relayPosts,signatures:signatures.length,paymentHashObserved:hash!==null};}
 // The route remains installed until the caller closes the context, so a late
 // duplicate payment cannot escape admission during teardown.
}
// The trusted relay serializes submit/status. Observe the sole original POST's
// response before read-only polling; never turn an in-flight busy response into
// a reason to repeat the payment.
export async function observeMetaMaskRelayResponse(request,observation){
 const response=await request.response();observation.received=response!==null;
 observation.status=response&&[200,400,409,429,500,503].includes(response.status())?response.status():response?'other':null;
 assert(response?.status()===200,'Original relay response unavailable; preserve submitted journal');
}
export async function pollMetaMaskRelayStatus({origin,planHash,completed,observation,fetchImpl=fetch}){
 assert.equal(typeof completed,'boolean');if(!completed)return null;
 assert.match(planHash,/^0x[0-9a-f]{64}$/);
 const response=await fetchImpl(origin+'/api/funding/usdc/status?planHash='+planHash,{redirect:'error',signal:AbortSignal.timeout(3000)});
 observation.received=true;observation.status=[200,400,409,429,500,503].includes(response.status)?response.status:'other';
 assert(response.ok,'Original relay status unavailable; preserve submitted journal');const status=await response.json();
 assert.equal(status.scope,'aggregate-funding');assert.equal(status.planHash,planHash);assert(['absent','unresolved','succeeded','failed'].includes(status.status));assert.equal(typeof status.canonical,'boolean');
 if(status.transactionHash)assert.match(status.transactionHash,/^0x[0-9a-f]{64}$/);return status;
}
export async function saveEncryptedDownload(download,destination,observation){
 assert.equal(download.suggestedFilename(),'rolling-chat-encrypted-recovery.json');assert(!fs.existsSync(destination));
 try{await download.saveAs(destination);}catch(error){
  if(observation)try{const d=Object.getOwnPropertyDescriptor(error??{},'message'),message=d&&'value' in d&&typeof d.value==='string'?d.value:'';observation.failure=/Target.*closed|browser.*closed|context.*closed/i.test(message)?'target-closed':/cancel/i.test(message)?'cancelled':/crash/i.test(message)?'crashed':'unknown';}catch{}
  throw error;
 }fs.chmodSync(destination,0o600);
 const value=JSON.parse(fs.readFileSync(destination,'utf8'));assert.equal(value.kind,'aztec-billboard-encrypted-wallet');assert.equal(value.schemaVersion,1);assert.equal(value.kdf,'PBKDF2-SHA256');assert.equal(value.iterations,600000);assert.match(value.ciphertext,/^[0-9a-f]+$/);
}


// Count the real configured private RPC endpoint, including root-path services.
// This observes attempts only; no transaction body is returned or retained.
export function countMetaMaskAggregateNodeSubmissions({url,method,body},trustedQueryUrl){
 const expected=new URL(trustedQueryUrl),actual=new URL(url);
 if(method!=='POST'||actual.origin!==expected.origin||actual.pathname!==expected.pathname)return 0;
 assert.equal(actual.search,expected.search);assert.equal(actual.hash,'');
 assert(typeof body==='string'&&Buffer.byteLength(body)<=8*1024*1024);
 const parsed=JSON.parse(body),batch=Array.isArray(parsed)?parsed:[parsed];assert(batch.length>0&&batch.length<=100);
 let count=0;for(const item of batch){assert(item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.method==='string');if(item.method==='aztec_sendTx')count++;}return count;
}


export function assertMetaMaskUnsignedAdmission({ethereumNonce,consentNonce,binding}){
 assert.equal(ethereumNonce,0);assert.equal(consentNonce,0n);for(const key of ['unsigned','journalPresent','originalPreserved','completeEncryptedExport'])assert.equal(binding?.[key],true);
}
export function readMetaMaskUnsignedContinuation(flag,sha256,control,{readinessOnly=false,continueUnfunded=false,paidRecovery=false,observationOnly=false,retainedBok=false,networkOnly=false}={}){
 assert(flag===undefined||flag==='true'||flag==='false','Invalid unsigned continuation flag');
 if(flag!=='true'){assert.equal(sha256,undefined);return null;}
 assert.equal(control.asset,'USDC');assert(!readinessOnly&&!continueUnfunded&&!paidRecovery&&!observationOnly&&!retainedBok&&!networkOnly);
 assert.match(sha256??'',/^[a-f0-9]{64}$/);
 const file=path.join(control.recoveryDirectory,'unsigned-recovery-export-2.json'),stat=fs.lstatSync(file);
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.size<=34*1024*1024);
 const bytes=fs.readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,'Original unsigned export changed');
 return {envelope:JSON.parse(bytes),sha256};
}

// Original private records remain inside page RAM; only fixed booleans leave it.
export async function inspectMetaMaskUnsignedExport({network:n,board,router,phase,envelope,password,account}){
 const sdk=window.__aztec,wallet=window.walletState.aztec,storage=sdk.createBrowserJournalStorage();
 const slot=await sdk.createEncryptedJournalSlot({storage,walletSecret:wallet.secretKey,walletSalt:wallet.salt,scopeText:JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1',n.chainId,n.rollupVersion,n.rollupAddress,board.contractAddress,router,wallet.address.toString(),1]),keyDomain:'ROLLING_AGGREGATE_FUNDING_V1'});
 const saved=await slot.read(),value=saved.value;
 const unsigned=value?.kind==='usdc'&&value.intent===null&&value.claim===null&&value.relay?.submitted===false&&value.relay?.request===null&&!value.relay?.transactionHash&&!value.txHash&&!value.confirmedRequest&&!value.previousTxHash&&value.aggregateCustody?.planHash===value.relay?.planHash;
 if(!unsigned)throw Error('Original unsigned funding is unavailable');
 const claims=await window.BillboardClaimBackup.exportRecords(wallet);
 const journals=await(await sdk.createJournalBackup({storage,walletSecret:wallet.secretKey,walletSalt:wallet.salt})).exportRecords();
 if(phase==='capture'){if(!journals.length)throw Error('Original journal is unavailable');globalThis.__unsignedExportSnapshot=JSON.stringify({saved,journals,claims});return {unsigned:true,journalPresent:true};}
 if(phase==='requote'){
  if(value.depositor!==account||value.aggregateCustody?.beneficiary!==account||value.privateFeeCap!==globalThis.__unsignedContinuationCap)throw Error('Original unsigned fee approval changed');
  delete globalThis.__unsignedContinuationCap;return {originalFeeCapPreserved:true};
 }
 if(phase!=='continuation'&&(phase!=='verify'||globalThis.__unsignedExportSnapshot!==JSON.stringify({saved,journals,claims})))throw Error('Original recovery changed during export');
 const payload=await window.BillboardWalletBackup.decrypt(envelope,password);
 const complete=JSON.stringify(payload.journals)===JSON.stringify(journals)&&claims.length>0&&JSON.stringify(payload.claims)===JSON.stringify(claims)&&payload.wallet.secretKey===wallet.secretKey.toString()&&payload.wallet.salt===wallet.salt.toString();
 if(!complete)throw Error('Encrypted recovery export differs');
 if(phase==='continuation'){
  if(value.depositor!==account||value.aggregateCustody?.beneficiary!==account||value.aggregateCustody?.kind!=='aggregate-usdc-custody-v1'||typeof value.privateFeeCap!=='string'||! /^[1-9][0-9]{0,76}$/.test(value.privateFeeCap))throw Error('Original unsigned scope differs');
  globalThis.__unsignedContinuationCap=value.privateFeeCap;
 }
 delete globalThis.__unsignedExportSnapshot;
 return {unsigned:true,journalPresent:true,originalPreserved:true,completeEncryptedExport:true};
}
export async function exportMetaMaskUnsignedRecovery({page,control,mark,report}){
 await inspectMetaMaskAggregateReadiness({page,control,mark});
 const binding={network:control.walletConfig.config.network,board:control.walletConfig.config.board,router:control.walletConfig.config.aggregateFunding.router};
 report.unsignedExport=await page.evaluate(inspectMetaMaskUnsignedExport,{...binding,phase:'capture'});
 mark('aggregate-export-original-unsigned');const dialog=page.getByRole('dialog');
 await dialog.getByText('Backup and account security',{exact:true}).click();await dialog.getByLabel('New recovery password',{exact:true}).fill(control.password);
 const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download encrypted recovery',exact:true}).click()]);
 report.unsignedExport.downloadStarted=true;
 const destination=path.join(control.recoveryDirectory,'unsigned-recovery-export-2.json');
 await saveEncryptedDownload(download,destination,report.unsignedExport);
 assert(fs.statSync(destination).size<=34*1024*1024);
 Object.assign(report.unsignedExport,await page.evaluate(inspectMetaMaskUnsignedExport,{...binding,phase:'verify',envelope:JSON.parse(fs.readFileSync(destination,'utf8')),password:control.password}));
}

// A retained disposable profile may diagnose initialization without admitting any payment.
export async function inspectMetaMaskAggregateReadiness({page,control,mark,allowPrepared=false,recoveryFile,keysOnly=false,refundOnly=false,remaining}){
 if(keysOnly)assert.equal(recoveryFile,undefined,'Keys-only unlock cannot import a historical journal export');
 mark('aggregate-retained-readiness');await page.getByRole('button',{name:'Your account',exact:true}).click();const dialog=page.getByRole('dialog');
 const unlock=dialog.getByRole('button',{name:'Unlock',exact:true}),password=dialog.getByLabel('Recovery password',{exact:true});
 // The panel loads lazily. Wait for either supported state; an immediate
 // visibility snapshot can otherwise skip Unlock before it exists. The paid
 // recovery caller may already have loaded the runtime and recovery inputs.
 await unlock.or(password).first().waitFor();
 if(await unlock.isVisible())await unlock.click();
 if(keysOnly)await password.waitFor();
 if(keysOnly)assert.equal(await page.evaluate(async({envelope,password})=>{const p=await window.BillboardWalletBackup.decrypt(envelope,password);return Array.isArray(p.claims)&&p.claims.length===0&&Array.isArray(p.journals)&&p.journals.length===0;},{envelope:JSON.parse(fs.readFileSync(path.join(control.recoveryDirectory,'initial-recovery.json'),'utf8')),password:control.password}),true,'Unlock input must be keys-only; never restore stale journals');
 await password.fill(control.password);
 await dialog.getByLabel('Recovery file',{exact:true}).setInputFiles(recoveryFile??path.join(control.recoveryDirectory,'initial-recovery.json'));
 await dialog.getByRole('button',{name:'Import recovery',exact:true}).click();
 if(refundOnly){assert(keysOnly&&!allowPrepared);const refund=dialog.getByRole('button',{name:'Review Ethereum refund',exact:true}),recovery=dialog.getByRole('button',{name:'Check account recovery',exact:true}),failure=dialog.getByRole('alert');await refund.or(recovery).or(failure).first().waitFor(remaining?{timeout:remaining()}:undefined);return await refund.isVisible()?'refund':await recovery.isVisible()?'recovery':'initialization-failed';}
 const recover=dialog.getByRole('button',{name:'Recover funding',exact:true});
 if(!allowPrepared){await recover.waitFor(remaining?{timeout:remaining()}:undefined);return 'funding';}
 const confirm=dialog.getByRole('button',{name:'Confirm and send',exact:true});
 await recover.or(confirm).first().waitFor();
 return await recover.isVisible()?'funding':'prepared';
}
export function assertMetaMaskReadinessRequest({url,method,body},ethereumUrl){
 const actual=new URL(url),ethereum=new URL(ethereumUrl);
 if(method!=='POST')return;
 assert(!actual.pathname.startsWith('/api/funding/')&&!actual.pathname.endsWith('/v1/jobs'),'Readiness cannot fund or prove');
 if(actual.origin===ethereum.origin&&actual.pathname===ethereum.pathname){
  const value=JSON.parse(body),batch=Array.isArray(value)?value:[value];assert(batch.length>0&&batch.length<=100);
  for(const item of batch)assert(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_getCode','eth_getLogs','eth_getStorageAt'].includes(item?.method));
 }
}

// Only the pinned extension's own startup cache iframe may fetch its exact
// warning document and its static assets. Application frames and real warning
// navigation do not match. No other origin, version, or query is admitted.
export function isMetaMaskStartupFrameRequest({method,url,parentUrl,extensionOrigin,frameSource,sandbox}){
 try{
  const expected='https://metamask.github.io/phishing-warning/v5.1.0/';
  const target=new URL(url);
  return method==='GET'&&target.href.startsWith(expected)&&!target.search&&!target.hash&&!target.username&&!target.password&&/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin)&&new URL(parentUrl).protocol==='chrome-extension:'&&('chrome-extension://'+new URL(parentUrl).host)===extensionOrigin&&frameSource===expected+'#extensionStartup'&&sandbox==='allow-scripts allow-same-origin';
 }catch{return false;}
}

export function assertMetaMaskUnfundedContinuation({ethereumNonce,consentNonce,emptyRecovery}){
 assert.equal(ethereumNonce,0,'An existing Ethereum transaction requires journal recovery');
 assert.equal(consentNonce,0n,'An existing consent requires journal recovery');
 assert.equal(emptyRecovery,true,'Retained intent requires original journal recovery');
}

// Existing paid identities use only the application's saved-payment recovery.
// No quote, consent signature, relay submission or Ethereum send is permitted.
export function installMetaMaskPaidRecoveryGuard(){
 const original=__testMetaMask.request.bind(__testMetaMask);
 __testMetaMask.request=async request=>{
  const method=request?.method;
  const permission=request?.params;
  const accountSelection=method==='wallet_requestPermissions'&&Array.isArray(permission)&&permission.length===1&&
   permission[0]!==null&&typeof permission[0]==='object'&&!Array.isArray(permission[0])&&Object.keys(permission[0]).length===1&&
   Object.hasOwn(permission[0],'eth_accounts')&&permission[0].eth_accounts!==null&&typeof permission[0].eth_accounts==='object'&&
   !Array.isArray(permission[0].eth_accounts)&&Object.keys(permission[0].eth_accounts).length===0;
  if(!['eth_accounts','eth_requestAccounts','eth_chainId'].includes(method)&&!accountSelection){
   await window.__paidRecoveryDenied(typeof method==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(method)?method:'unknown');
   throw Error('Paid recovery forbids another wallet operation');
  }
  const observe=async state=>{try{if(accountSelection&&typeof window.__paidRecoveryPermission==='function')await window.__paidRecoveryPermission(state);}catch{}};
  await observe('entered');try{const result=await original(request);await observe('resolved');return result;}catch(error){await observe('rejected');throw error;}
 };
}

// Serialized into the application page. Preserve provider receiver, request,
// result and rejection identity; no error value crosses the observation port.
export function installMetaMaskAggregateObserver(){
 const original=__testMetaMask.request.bind(__testMetaMask);
 __testMetaMask.request=async request=>{
  await __aggregateWalletBefore(structuredClone(request));
  let result;
  try{result=await original(request);}catch(error){
   if(request.method==='wallet_requestPermissions')try{await __aggregateWalletPermissionRejected();}catch{}
   try{if(['wallet_requestPermissions','eth_chainId','wallet_switchEthereumChain','eth_requestAccounts','eth_accounts'].includes(request.method)){
    const descriptor=error!==null&&(typeof error==='object'||typeof error==='function')?Object.getOwnPropertyDescriptor(error,'code'):null;
    const code=descriptor&&Object.hasOwn(descriptor,'value')&&[4001,4100,4200,4900,4901,4902,-32002,-32603].includes(descriptor.value)?descriptor.value:'unknown';
    await __aggregateWalletConnectionRejected({method:request.method,code});
   }}catch{}
   throw error;
  }
  await __aggregateWalletAfter({method:request.method,result});return result;
 };
}

// Serialized read-only projection: no account value leaves the application.
export function inspectMetaMaskSelectedAccount({account,chainId}){
 const snapshot=window.BillboardAccount.snapshot(),state=window.walletState;
 const notices=[['operation-failed','This operation could not be completed. Recovery records were preserved. Check the existing transaction before preparing another.'],['connection-unavailable','The private connection is unavailable. Your encrypted recovery is preserved. Reconnect when the service returns.']];
 const notice=notices.find(([,text])=>[...document.querySelectorAll('dialog[open] p')].some(node=>node.getClientRects().length>0&&node.textContent===text))?.[0]??null;
 return {notice,busy:snapshot.busy===true,connected:snapshot.ethereumConnected===true,accountMatches:typeof snapshot.ethereumAddress==='string'&&snapshot.ethereumAddress.toLowerCase()===account,
  chainMatches:state?.ethChainId===chainId,walletMatches:snapshot.ethereumWalletName==='MetaMask',invalidated:snapshot.invalidated===true};
}
export async function confirmMetaMaskRecoveryAccountSelection(walletPage,completed){
 const confirm=walletPage.getByTestId('confirm-btn');
 if(completed){
  const {page,account,chainId,permission,observe=()=>{}}=completed;
  assert.match(account,/^0x[0-9a-f]{40}$/);assert.equal(chainId,'31337');
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   if(await confirm.isVisible())break;
   if(permission.rejected)throw Error('MetaMask account selection rejected');
   if(permission.entered&&permission.resolved){
    const state=await page.evaluate(inspectMetaMaskSelectedAccount,{account,chainId});
    observe(state);if(state.notice)throw Error('MetaMask connection failed: '+state.notice);
    if(state.connected){
     assert(state.accountMatches&&state.chainMatches&&state.walletMatches&&!state.invalidated,'MetaMask selected account or network differs');
     return 'already-completed';
    }
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(Date.now()<deadline,'MetaMask account selection did not complete');
 }else await confirm.waitFor();
 assert.equal((await confirm.innerText()).trim(),'Connect');
 await confirm.click();return 'prompt-confirmed';
}

// Serialized into the page: project only known notices and button states, never
// account text, amounts, input values or the contents of an unknown error.
export function inspectMetaMaskPaidRecoverySurface({settledOnly=false,terminalOnly=false}={}){
 const dialog=document.querySelector('dialog[open]');if(!dialog)return settledOnly?null:{state:'unavailable',busy:false,notices:[],buttons:{}};
 const visible=node=>node.getClientRects().length>0;
 const vocabulary={
  'claim-confirmed':'Transaction confirmed on the verified chain.',
  'claim-confirmed-feed-unavailable':'Transaction confirmed on the verified chain. Public feed refresh is unavailable; the transaction remains confirmed.',
  success:'Funding and the private claim are confirmed. Your posting deposit, network fees and Bok credit are ready.',
  'review-saved':'This saved claim has not been submitted. Review it explicitly before sending; the Ethereum payment will not repeat.',
  review:'The private claim needs a new review. No additional Ethereum payment will be sent.',
  reverted:'The private claim reverted. Review recovery; do not repeat the Ethereum payment.',
  'waiting-bridge':'Payment confirmed. Waiting for the bridge; no second Ethereum payment will be requested.',
  pending:'Checking the saved private claim. It will not be submitted again.',
  'receipt-review':'Payment and bridge delivery verified. Review the private claim and maximum fee.'
 };
 const notices=[];for(const node of dialog.querySelectorAll('.notice'))if(visible(node))for(const [code,text]of Object.entries(vocabulary))if(node.textContent===text)notices.push(code);
 const buttons={};for(const [code,text]of Object.entries({pause:'Pause bridge checks',resume:'Resume saved funding',confirm:'Confirm and send',check:'Check existing transaction',reviewAgain:'Review private claim again'})){
  const node=[...dialog.querySelectorAll('button')].find(node=>visible(node)&&node.textContent===text);buttons[code]={visible:!!node,enabled:!!node&&!node.disabled};
 }
 const busy=dialog.getAttribute('aria-busy')==='true',alert=[...dialog.querySelectorAll('[role="alert"]')].some(visible);
 const state=alert?'error':['review-saved','review','reverted','receipt-review','success','claim-confirmed','claim-confirmed-feed-unavailable','waiting-bridge','pending'].find(code=>notices.includes(code))??(buttons.confirm.visible?'review':'unknown');
 if(settledOnly&&(busy||state==='unknown'))return null;
 if(terminalOnly&&['waiting-bridge','pending','unknown'].includes(state))return null;
 return {state,busy,notices,buttons};
}

// The application owns automatic bridge/claim progress. This observer never
// confirms a second review, pauses its loop, or prepares/replays a payment.
export async function waitMetaMaskAutomaticClaim({page,binding,report,timeout}){
 assert(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=80000);
 let handle;report.automaticClaim={};
 try{
  handle=await page.waitForFunction(inspectMetaMaskPaidRecoverySurface,{settledOnly:true,terminalOnly:true},{timeout});
  const surface=await handle.jsonValue();report.automaticClaim.surface=surface;
  assert.equal(surface.state,'success','Automatic claim requires explicit recovery; do not repeat payment');
  const saved=await page.evaluate(inspectMetaMaskPaidBinding,binding);report.automaticClaim.saved=saved;
  for(const key of ['paymentMatches','claimMatches','claimConfirmed','paymentSaved','claimPresent','attempted','feeWithinSavedCap'])assert.equal(saved[key],true,'Original automatic claim binding differs');
  assert.equal(saved.workflowStatus,'confirmed');assert.match(saved.claimTxHash,/^0x[0-9a-f]{64}$/);
  Object.assign(report.aggregate,{privateClaimQualified:true,readyFromConfirmedPrivateClaim:true,claimTransactionHash:saved.claimTxHash});
 }finally{
  try{await handle?.dispose();}catch{report.automaticClaim.handleCleanupFailed=true;}
  if(!report.automaticClaim.saved)try{report.automaticClaim.saved=await page.evaluate(inspectMetaMaskPaidBinding,binding);}catch{report.automaticClaim.savedUnavailable=true;}
 }
}

export async function observeMetaMaskPaidRecovery({page,dialog,binding,report,timeout=80000}){
 let handle,surface;report.paidRecoveryObservation={};
 try{
  handle=await page.waitForFunction(inspectMetaMaskPaidRecoverySurface,{settledOnly:true},{timeout});
  surface=await handle.jsonValue();report.paidRecoveryObservation.surface=surface;
  // One completed advance is enough to classify a wait. Stop only the existing
  // automatic read loop; never approve a claim or replay a payment here.
  if(['waiting-bridge','pending'].includes(surface.state)&&surface.buttons.pause.enabled){await dialog.getByRole('button',{name:'Pause bridge checks',exact:true}).click();report.paidRecoveryObservation.checksPaused=true;}
  return surface;
 }finally{
  try{await handle?.dispose();}catch{report.paidRecoveryObservation.handleCleanupFailed=true;}
  if(!surface)try{report.paidRecoveryObservation.surface=await page.evaluate(inspectMetaMaskPaidRecoverySurface);}catch{report.paidRecoveryObservation.surfaceUnavailable=true;}
  try{report.paidRecoveryObservation.saved=await page.evaluate(inspectMetaMaskPaidBinding,binding);}catch{report.paidRecoveryObservation.savedUnavailable=true;}
 }
}

async function retainedCanonicalPayment(c,provider,transactionHash,{advanced=false}={}){
 assert.match(transactionHash,/^0x[0-9a-f]{64}$/);
 const scope=c.walletConfig.config.aggregateFunding,a=c.allocation,account=Wallet.fromPhrase(c.mnemonic).address.toLowerCase();
 const tx=await provider.getTransaction(transactionHash);assert(tx);assert.equal(tx.to.toLowerCase(),scope.router);
 assert.equal(tx.from.toLowerCase(),c.asset==='ETH'?account:scope.usdcRelayAddress);
 const method=c.asset==='ETH'?'fund':'fundUsdc',parsed=aggregateInterface.parseTransaction({data:tx.data});assert.equal(parsed.name,method);
 const plan=parsed.args[0],planHash=keccak256(AbiCoder.defaultAbiCoder().encode([aggregateInterface.getFunction(method).inputs[0]],[plan]));
 assert.equal(plan.beneficiary.toLowerCase(),account);assert.equal(String(c.asset==='ETH'?plan.collateral:plan.collateral.amount),a.collateralWei);assert.equal(String(plan.fee.amount),a.feeAmount);assert.equal(String(c.asset==='ETH'?plan.bok.amount:plan.bokAmount),a.bokAmount);
 const expected={kind:c.asset==='ETH'?'aggregate-funding':'aggregate-usdc-funding',routerCodeHash:scope.routerCodeHash,collateralPortal:scope.collateralPortal,feePortal:scope.feePortal,bokPortal:scope.bokPortal,privateFpc:scope.privateFpc,planHash};
 const intent={from:tx.from.toLowerCase(),to:scope.router,chainId:'31337',nonce:tx.nonce,data:tx.data.toLowerCase(),value:String(tx.value),expected};validateAggregateFundingIntent(intent);
 const effect=await verifyEthereumIntentReceipt(provider,intent,transactionHash);assert.equal(effect.outcome,'success');
 const nonce=await provider.getTransactionCount(account,'pending');if(advanced){assert(Number.isSafeInteger(nonce)&&nonce>=(c.asset==='ETH'?1:0));assert.equal(nonce,await provider.getTransactionCount(account,'latest'),'Unresolved Ethereum transaction prevents continuation');}else assert.equal(nonce,c.asset==='ETH'?1:0);
 return {scope,a,account,intent,nonce};
}

export async function verifyRetainedClaimReceipt({control,transactionHash,node}){
 assert.match(transactionHash,/^0x[0-9a-f]{64}$/);const {TxHash}=await import('@aztec-labs/stdlib/tx');if(!node){const {createAztecNodeClient}=await import('@aztec-labs/aztec.js/node');node=createAztecNodeClient(control.walletConfig.trustedQuery.url);}
 const n=control.walletConfig.config.network,[info,contracts]=await Promise.all([node.getNodeInfo(),node.getL1ContractAddresses()]);assert.equal(String(info.l1ChainId),n.chainId);assert.equal(String(info.rollupVersion),n.rollupVersion);assert.equal(contracts.rollupAddress.toString().toLowerCase(),n.rollupAddress);
 const receipt=await node.getTxReceipt(TxHash.fromString(transactionHash));assert.equal(receipt.txHash.toString(),transactionHash);assert(['checkpointed','proven','finalized'].includes(receipt.status));assert.equal(receipt.executionResult,'success');assert(Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0);const blockHash=receipt.blockHash?.toString();assert.match(blockHash,/^0x[0-9a-f]{64}$/);assert.equal((await node.getBlockData(receipt.blockNumber))?.blockHash?.toString(),blockHash);
 return {transactionHash,blockNumber:receipt.blockNumber,blockHash,canonical:true};
}

export async function exportMetaMaskReadyRecovery({page,control,provider,transactionHash,claimTransactionHash,mark,report}){
 const destination=path.join(control.recoveryDirectory,'ready-recovery-export.json');assert(!fs.existsSync(destination),'Preserve the original Ready export');
 const {scope,intent}=await retainedCanonicalPayment(control,provider,transactionHash);
 await inspectMetaMaskAggregateReadiness({page,control,mark,keysOnly:true});
 const binding={network:control.walletConfig.config.network,board:control.walletConfig.config.board,router:scope.router,intent,transactionHash};
 const check=async()=>{const r=await page.evaluate(inspectMetaMaskPaidBinding,binding);for(const k of ['paymentMatches','claimMatches','claimConfirmed','feeWithinSavedCap'])assert.equal(r[k],true,'Current profile must contain the original confirmed claim');return r;};
 const before=await check();assert.equal(before.claimTxHash,claimTransactionHash);const canonicalClaim=await verifyRetainedClaimReceipt({control,transactionHash:claimTransactionHash});mark('aggregate-export-current-ready');
 const exported=await exportRetainedBokRecovery({page,control,approval:{recoveryStem:'ready-recovery'},suffix:'export'});
 const after=await check();assert.deepEqual(after,before);
 assert.equal(await page.evaluate(async({envelope,password})=>{const expected=await window.BillboardWalletBackup.decrypt(await window.BillboardAccount.exportRecovery(password),password),actual=await window.BillboardWalletBackup.decrypt(envelope,password);return JSON.stringify(actual)===JSON.stringify(expected);},{envelope:JSON.parse(fs.readFileSync(destination,'utf8')),password:control.password}),true,'Ready export differs from current custody');
 report.readyExport={sha256:exported.sha256,claimTransactionHash:before.claimTxHash,currentConfirmedClaim:true,keysOnlyUnlock:true,currentCustodyExported:true,canonicalClaim};
}

// Historical Ready ciphertext is read only. It is never passed to account import
// or restoreRecords, and only fixed conclusions/public hashes leave the page.
export function readRetainedReadyExport(sha256,control){
 assert.match(sha256??'',/^[a-f0-9]{64}$/);
 const filename=path.join(control.recoveryDirectory,'ready-recovery-export.json'),stat=fs.lstatSync(filename);
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.nlink===1&&stat.size<=34*1024*1024);
 const bytes=fs.readFileSync(filename);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,'Original Ready export changed');
 return {envelope:JSON.parse(bytes),sha256};
}
export async function inspectRetainedReadyContinuity({network:n,board,router,intent,transactionHash,envelope,password}){
 const check=ok=>{if(!ok)throw Error('Original Ready claim continuity differs');},sdk=window.__aztec,w=window.walletState.aztec;
 const payload=await window.BillboardWalletBackup.decrypt(envelope,password);
 check(payload.wallet?.secretKey===w.secretKey.toString()&&payload.wallet?.salt===w.salt.toString()&&Array.isArray(payload.journals));
 const records=new Map();for(const r of payload.journals){check(typeof r?.key==='string'&&typeof r.encoded==='string'&&!records.has(r.key));records.set(r.key,r.encoded);}
 const historical={read:async key=>records.get(key)??null},current=sdk.createBrowserJournalStorage();
 const open=async(storage,scopeText,keyDomain)=>(await(await sdk.createEncryptedJournalSlot({storage,walletSecret:w.secretKey,walletSalt:w.salt,scopeText,keyDomain})).read()).value;
 const fundingScope=JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1',n.chainId,n.rollupVersion,n.rollupAddress,board.contractAddress,router,w.address.toString(),1]);
 const workflowScope=JSON.stringify(['ROLLING_WORKFLOW_V1',JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',w.address.toString(),n.chainId,n.rollupAddress,n.rollupVersion,board.contractAddress,board.portalAddress])]);
 const originalFunding=await open(historical,fundingScope,'ROLLING_AGGREGATE_FUNDING_V1'),funding=await open(current,fundingScope,'ROLLING_AGGREGATE_FUNDING_V1');
 check(!!funding&&JSON.stringify(originalFunding)===JSON.stringify(funding));
 const paid=funding.intent??funding.relay?.request;
 check(!!paid&&['from','to','chainId','data','value'].every(k=>paid[k]===intent[k])&&(paid.nonce===undefined||paid.nonce===intent.nonce)&&Object.keys(intent.expected).every(k=>paid.expected?.[k]===intent.expected[k])&&(funding.relay?.transactionHash===undefined||funding.relay.transactionHash===transactionHash));
 const claim=await open(historical,workflowScope,'ROLLING_WORKFLOW_V1'),currentWorkflow=await open(current,workflowScope,'ROLLING_WORKFLOW_V1');
 check(!!funding.claim&&funding.claim.attempted===true&&claim?.id===funding.claim.intentId&&claim.action?.type==='claim-deposit'&&['receipt','feeReceipt','bokReceipt'].every(k=>claim.action[k]?.txHash===transactionHash));
 const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(value);
 check(claim.status==='confirmed'&&hash(claim.txHash)&&decimal(claim.maximumFee)&&decimal(funding.privateFeeCap)&&BigInt(claim.maximumFee)<=BigInt(funding.privateFeeCap));
 // A newer workflow can be accepted only after the actual application's own
 // canonical recovery check. Prepared/unknown/submitted work cannot be replaced.
 check(!!currentWorkflow&&['confirmed','reverted','cancelled'].includes(currentWorkflow.status));
 const runtime=await import('/wallet/runtime.mjs'),session=await(await runtime.loadRollingWalletRuntime()).createSession(),status=await session.application.readAccountStatus();
 check(status.status==='fee-ready');
 check(JSON.stringify(await open(current,fundingScope,'ROLLING_AGGREGATE_FUNDING_V1'))===JSON.stringify(funding));
 return {sameCustody:true,originalFundingUnchanged:true,originalClaimConfirmed:true,claimTransactionHash:claim.txHash,currentAccountStatus:status.status};
}
export async function driveMetaMaskReadyContinuation({page,control,provider,transactionHash,readyExport,mark,report,deadlineAt}){
 const {scope,intent,account,nonce}=await retainedCanonicalPayment(control,provider,transactionHash,{advanced:true});
 const attempts={forbiddenWalletCalls:0,deniedMethods:[]};report.paidRecoveryAttempts=attempts;
 await page.exposeFunction('__paidRecoveryDenied',()=>{attempts.forbiddenWalletCalls++;});await page.evaluate(installMetaMaskPaidRecoveryGuard);
 await inspectMetaMaskAggregateReadiness({page,control,mark,keysOnly:true,remaining:retainedBokRemaining(deadlineAt)});
 const continuity=await page.evaluate(inspectRetainedReadyContinuity,{network:control.walletConfig.config.network,board:control.walletConfig.config.board,router:scope.router,intent,transactionHash,envelope:readyExport.envelope,password:control.password});
 const canonicalClaim=await verifyRetainedClaimReceipt({control,transactionHash:continuity.claimTransactionHash});
 assert.equal(attempts.forbiddenWalletCalls,0);assert.equal(await provider.getTransactionCount(account,'pending'),nonce);
 report.paidRecovery={asset:control.asset,transactionHash,planHash:intent.expected.planHash,claimTransactionHash:continuity.claimTransactionHash,originalCanonicalEffectsVerified:true,readyFromConfirmedPrivateClaim:true,userSends:0,relayPosts:0,signatures:0,postQualified:false,readyExportSha256:readyExport.sha256,continuity,canonicalClaim};
 return ()=>assert.equal(attempts.forbiddenWalletCalls,0,'A late wallet operation was attempted');
}

export async function driveMetaMaskPaidRecovery({page,walletPage,control:c,provider,transactionHash,mark,report,reviewPrepared=false,recoveryFile,deadlineAt}){
 assert.equal(typeof reviewPrepared,'boolean');
 assert.match(transactionHash,/^0x[0-9a-f]{64}$/);
 const {scope,a,account,intent,nonce}=await retainedCanonicalPayment(c,provider,transactionHash),planHash=intent.expected.planHash;
 const attempts={forbiddenWalletCalls:0,deniedMethods:[]};report.paidRecoveryAttempts=attempts;const permission={entered:false,resolved:false,rejected:false};report.paidRecoveryPermission=permission;
 await page.exposeFunction('__paidRecoveryPermission',state=>{assert(['entered','resolved','rejected'].includes(state));permission[state]=true;});
 await page.exposeFunction('__paidRecoveryDenied',method=>{attempts.forbiddenWalletCalls++;if(attempts.deniedMethods.length<16)attempts.deniedMethods.push(typeof method==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(method)?method:'unknown');});
 await page.evaluate(installMetaMaskPaidRecoveryGuard);
 const readiness=await inspectMetaMaskAggregateReadiness({page,control:c,mark,allowPrepared:reviewPrepared,recoveryFile,remaining:deadlineAt===undefined?undefined:retainedBokRemaining(deadlineAt)});
 const binding={network:c.walletConfig.config.network,board:c.walletConfig.config.board,router:scope.router,intent,transactionHash};
 report.paidRecoveryBefore=await page.evaluate(inspectMetaMaskPaidBinding,binding);assert.equal(report.paidRecoveryBefore.paymentMatches,true,'Retained payment differs from the canonical payment');
 const dialog=page.getByRole('dialog');
 const openFunding=async()=>{
  await dialog.getByRole('button',{name:'Recover funding',exact:true}).click();
  mark('aggregate-paid-recovery-connect');await dialog.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  report.accountSelection=await confirmMetaMaskRecoveryAccountSelection(walletPage,{page,account,chainId:'31337',permission,observe:state=>{report.accountSelectionState=state;}});
  await dialog.getByText('Funding wallet connected. No payment has been sent.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),account);
 };
 if(readiness!=='prepared'){
  await openFunding();
  mark('aggregate-paid-private-claim');await dialog.getByRole('button',{name:'Resume saved funding',exact:true}).click();
 }
 const recoveryDeadline=Date.now()+80000;
 const remaining=()=>{const ms=recoveryDeadline-Date.now();assert(ms>0,'Paid recovery observation deadline');return ms;};
 let recovery=await observeMetaMaskPaidRecovery({page,dialog,binding,report,timeout:remaining()});
 if(reviewPrepared&&(recovery.state==='review-saved'||readiness==='prepared')){
  report.preparedClaimReview={initial:report.paidRecoveryObservation,confirmations:0};
  await confirmMetaMaskPreparedClaim({page,dialog,binding,enabled:reviewPrepared,surface:recovery,restoredPrepared:readiness==='prepared',report:report.preparedClaimReview});
  recovery=await observeMetaMaskPaidRecovery({page,dialog,binding,report,timeout:remaining()});
  assert(['claim-confirmed','claim-confirmed-feed-unavailable'].includes(recovery.state),'Explicit saved claim is not confirmed; no second submission');
  const confirmed=await page.evaluate(inspectMetaMaskPaidBinding,binding);assert.equal(confirmed.claimConfirmed,true);assert.equal(confirmed.paymentMatches,true);
  // This existing action now only reconciles the confirmed saved claim. It does
  // not prepare another claim, alter the original cap or repeat Ethereum payment.
  if(readiness==='prepared')await openFunding();
  else await dialog.getByRole('button',{name:'Recover funding',exact:true}).click();
  await dialog.getByRole('button',{name:'Resume saved funding',exact:true}).click();
  recovery=await observeMetaMaskPaidRecovery({page,dialog,binding,report,timeout:remaining()});
 }
 assert.equal(recovery.state,'success','Saved funding recovery is not confirmed; inspect the closed diagnostic state');
 // The original claim amount stays bound above; current free credit may legitimately
 // be lower after a confirmed request or withdrawal. New budgets are simulated separately.
 await dialog.getByText(/^Private Bok balance: (?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})? USDC-backed credits\.$/).waitFor();
 const claimed=await page.evaluate(inspectMetaMaskPaidBinding,binding);assert.equal(claimed.paymentMatches,true);assert.equal(claimed.claimMatches,true);assert.equal(claimed.claimConfirmed,true);
 assert.equal(attempts.forbiddenWalletCalls,0);assert.equal(await provider.getTransactionCount(account,'pending'),nonce);
 report.paidRecovery={asset:c.asset,transactionHash,planHash,claimTransactionHash:claimed.claimTxHash,originalCanonicalEffectsVerified:true,readyFromConfirmedPrivateClaim:true,userSends:0,relayPosts:0,signatures:0,postQualified:false};
 return ()=>assert.equal(attempts.forbiddenWalletCalls,0,'A late wallet operation was attempted');
}

export function retainedPreparedClaimFlag(value,{paidRecovery=false,readinessOnly=false,continueUnfunded=false}={}){
 assert(value===undefined||value==='true'||value==='false','Invalid saved claim review flag');
 const enabled=value==='true';if(enabled)assert(paidRecovery&&!readinessOnly&&!continueUnfunded,'Saved claim review requires paid recovery only');return enabled;
}
export async function confirmMetaMaskPreparedClaim({page,dialog,binding,enabled=false,surface,report,restoredPrepared=false}){
 assert.equal(enabled,true,'Explicit saved claim review is required');
 assert.equal(typeof restoredPrepared,'boolean');
 assert.equal(surface.state,restoredPrepared?'review':'review-saved');assert.equal(surface.busy,false);assert.equal(surface.buttons.confirm.enabled,true);
 assert.equal(report.confirmations,0,'Saved claim confirmation already attempted');
 assert.equal((await page.evaluate(inspectMetaMaskPaidBinding,{...binding,preparedReview:'capture'})).preparedReviewAllowed,true,'Original unsent prepared claim or fee cap differs');
 assert.equal((await page.evaluate(inspectMetaMaskPaidBinding,{...binding,preparedReview:'consume'})).preparedReviewAllowed,true,'Original prepared claim changed before confirmation');
 report.confirmations++; // No retry even when the click or native readiness guard fails.
 await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();
 // The real submitPrepared entry point revalidates trusted-node freshness, all
 // receipts, journal admission and its saved maximum before recording a send.
}

// Executed inside the real wallet page. Only booleans and the public claim hash
// leave it; private keys, decrypted custody and user grouping remain in-page.
export async function inspectMetaMaskPaidBinding({network:n,board,router,intent,transactionHash,preparedReview}){
 const sdk=window.__aztec,wallet=window.walletState.aztec,owner=wallet.address.toString(),storage=sdk.createBrowserJournalStorage();
 const open=async(scopeText,keyDomain)=>(await(await sdk.createEncryptedJournalSlot({storage,walletSecret:wallet.secretKey,walletSalt:wallet.salt,scopeText,keyDomain})).read()).value;
 const funding=await open(JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1',n.chainId,n.rollupVersion,n.rollupAddress,board.contractAddress,router,owner,1]),'ROLLING_AGGREGATE_FUNDING_V1');
 const saved=funding?.intent??funding?.relay?.request;
 const paymentMatches=!!saved&&['from','to','chainId','data','value'].every(k=>saved[k]===intent[k])&&(saved.nonce===undefined||saved.nonce===intent.nonce)&&Object.keys(intent.expected).every(k=>saved.expected?.[k]===intent.expected[k])&&(funding.relay?.transactionHash===undefined||funding.relay.transactionHash===transactionHash);
 const scope=JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',owner,n.chainId,n.rollupAddress,n.rollupVersion,board.contractAddress,board.portalAddress]);
 const claim=await open(JSON.stringify(['ROLLING_WORKFLOW_V1',scope]),'ROLLING_WORKFLOW_V1');
 const claimMatches=paymentMatches&&!!funding?.claim&&claim?.id===funding.claim.intentId&&claim?.action?.type==='claim-deposit'&&['receipt','feeReceipt','bokReceipt'].every(k=>claim.action[k]?.txHash===transactionHash);
 const claimConfirmed=claimMatches&&claim.status==='confirmed'&&/^0x[0-9a-f]{64}$/.test(claim.txHash);
 const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(value);
 const feeWithinSavedCap=claimMatches&&decimal(claim.maximumFee)&&decimal(funding.privateFeeCap)?BigInt(claim.maximumFee)<=BigInt(funding.privateFeeCap):null;
 let preparedReviewAllowed;
 if(preparedReview!==undefined){
  const journal=await open(scope,'AZTEC_BB_L2_JOURNAL_KEY_V1');
  const eligible=paymentMatches&&claimMatches&&funding.claim.attempted===true&&claim.status==='prepared'&&claim.txHash==null&&journal==null&&feeWithinSavedCap===true;
  // The original records and context remain in private page RAM, never evidence.
  const snapshot=JSON.stringify({scope,router,intent,transactionHash,funding,claim});
  const prior=window.__retainedPreparedClaimReview;
  if(preparedReview==='capture'&&eligible&&!prior)window.__retainedPreparedClaimReview={snapshot,used:false};
  const captured=window.__retainedPreparedClaimReview;
  preparedReviewAllowed=eligible&&['capture','consume'].includes(preparedReview)&&!!captured&&!captured.used&&captured.snapshot===snapshot;
  if(preparedReview==='consume'&&preparedReviewAllowed)captured.used=true; // Before the UI can send, even if click throws.
 }
 return {paymentMatches,claimMatches,claimConfirmed,claimTxHash:claimConfirmed?claim.txHash:null,
  paymentSaved:!!saved,claimPresent:!!funding?.claim,attempted:funding?.claim?.attempted===true,
  workflowPrepared:claim?.status==='prepared',workflowStatus:claim==null?'absent':['prepared','submitting','unknown','submitted','confirmed','reverted','cancelled'].includes(claim.status)?claim.status:'other',
  feeWithinSavedCap,explicitClaimReview:funding?.explicitClaimReview===true,...(preparedReview!==undefined?{preparedReviewAllowed}: {})};
}


// The pinned warning iframe registers its own cache worker. Its read-only static
// fetches are separate from both the application and MetaMask background worker.
export function isMetaMaskStartupWorkerRequest({method,url,workerUrl,startupFrameObserved}){
 try{
  const base='https://metamask.github.io/phishing-warning/v5.1.0/',target=new URL(url);
  if(!startupFrameObserved||method!=='GET'||workerUrl!==base+'service-worker.js'||target.origin!=='https://metamask.github.io'||target.hash||target.username||target.password)return false;
  const file=target.pathname.slice('/phishing-warning/v5.1.0/'.length);
  if(target.pathname!=='/phishing-warning/v5.1.0/'+file||!['workbox-e6d70522.js','bundle.js','design-tokens.css','index.css','index.html','lockdown-install.js','lockdown-more.js','lockdown-run.js','metamask-fox.svg','warning-icon.svg'].includes(file))return false;
  return !target.search||/^\?__WB_REVISION__=[0-9a-f]{32}$/.test(target.search);
 }catch{return false;}
}

// Separate explicit operator approval. The original payment control/consent is
// never widened by opting into two further, individually reviewed L2 actions.
export function validateRetainedBokApproval(value,control,now=Date.now(),{observation=false}={}){
 if(value?.schemaVersion===2)return validateRetainedBokRecoveryApproval(value,control,now);
 const threaded=Object.hasOwn(value??{},'parent')||Object.hasOwn(value??{},'root'),postOnly=Object.hasOwn(value??{},'completion')||Object.hasOwn(value??{},'observationFile');
 exactKeys(value,['schemaVersion','runtimeSha256','content','contentSha256','budget','authorizeFeeCap','postFeeCap','expiresAt','publicScope',...(threaded?['parent','root']:[]),...(postOnly?['completion','observationFile']:[])]);
 if(postOnly){assert.equal(value.completion,'post-only');assert(path.isAbsolute(value.observationFile??''));assert.equal(path.dirname(value.observationFile),control.recoveryDirectory);assert.match(path.basename(value.observationFile),/^bok-[a-z0-9-]{1,64}-observation\.json$/);assert.equal(fs.realpathSync(control.recoveryDirectory),control.recoveryDirectory);if(!observation)assert(!fs.existsSync(value.observationFile),'Original posted request must be observed, never resubmitted');}
 if(threaded){for(const key of ['parent','root'])assert(typeof value[key]==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(value[key]));assert.equal(value.parent==='0',value.root==='0');}
 assert.equal(value.schemaVersion,1);assert.equal(value.runtimeSha256,control.runtimeSha256);
 assert(typeof value.content==='string'&&Buffer.byteLength(value.content)>0&&Buffer.byteLength(value.content)<=512&&!value.content.includes('\0'));
 assert.equal(createHash('sha256').update(value.content).digest('hex'),value.contentSha256);
 for(const key of ['budget','authorizeFeeCap','postFeeCap'])positive(value[key]);
 assert(BigInt(value.budget)<=BigInt(control.allocation.bokAmount));
 assert(BigInt(value.authorizeFeeCap)+BigInt(value.postFeeCap)<=BigInt(control.allocation.feeAmount));
 assert(Number.isSafeInteger(value.expiresAt)&&value.expiresAt>0&&(observation||value.expiresAt>now&&value.expiresAt<=now+3600000));
 const n=control.walletConfig.config.network,b=control.walletConfig.config.bok,s=value.publicScope;validateRollingScope(s);
 assert(s&&s.bok);for(const k of ['chainId','rollupVersion','rollupAddress'])assert.equal(s[k],n[k]);
 assert.equal(s.boardAddress,control.walletConfig.config.board.contractAddress);assert.equal(s.bok.address,b.contractAddress);assert.equal(s.bok.operatorAddress,b.operatorAddress);
 return structuredClone(value);
}
export function readRetainedBokApproval(filename,control,{enabled=false,paidRecovery=false,observation=false}={}){
 assert.equal(typeof enabled,'boolean');assert.equal(typeof paidRecovery,'boolean');
 if(!enabled){assert(filename===undefined,'Bok approval requires explicit continuation flag');return null;}
 assert(paidRecovery,'Bok continuation requires original paid recovery');assert(path.isAbsolute(filename??''));
 const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.nlink===1&&stat.size<=65536);
 return validateRetainedBokApproval(JSON.parse(fs.readFileSync(filename,'utf8')),control,Date.now(),{observation});
}

// Inside the actual page. Never return the decrypted record, private owner,
// request identifier before publication, message, nonce or deposit identifier.
export async function inspectRetainedBokWorkflow({config,approval,phase,status,capture=false,published=false}){
 const sdk=window.__aztec,w=window.walletState.aztec,n=config.network,b=config.board;
 const scope=JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',w.address.toString(),n.chainId,n.rollupAddress,n.rollupVersion,b.contractAddress,b.portalAddress]);
 const slot=await sdk.createEncryptedJournalSlot({storage:sdk.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',scope]),keyDomain:'ROLLING_WORKFLOW_V1'});
 const r=(await slot.read()).value,old=window.__retainedBokWorkflow;
 const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v),hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
 const correct=!!r&&r.action?.type==='bok'&&r.action.content===approval.content&&r.action.subboard==='0'&&r.action.name==='0'&&r.action.budget===approval.budget&&(r.action.parent??'0')===(approval.parent??'0')&&(r.action.root??'0')===(approval.root??'0')&&r.bok?.phase===phase&&r.status===status&&r.bok.budget===approval.budget&&r.bok.scope?.address===config.bok.contractAddress&&r.bok.scope?.pluginId===config.bok.pluginId&&Date.now()<approval.expiresAt;
 const feeWithinCap=correct&&decimal(r.maximumFee)&&BigInt(r.maximumFee)<=BigInt(phase==='authorize'?approval.authorizeFeeCap:approval.postFeeCap);
 const sameDraft=!old||r&&r.nonce===old.nonce&&r.bok?.requestId===old.requestId&&r.bok?.target===old.target&&JSON.stringify(r.action)===old.action&&r.bok.budget===old.budget;
 const originalAuthorization=phase==='authorize'||!!old&&r?.bok?.authorizationTxHash===old.authorizationTxHash&&hash(old.authorizationTxHash);
 if(capture&&correct&&feeWithinCap&&sameDraft){window.__retainedBokWorkflow={nonce:r.nonce,requestId:r.bok.requestId,target:r.bok.target,action:JSON.stringify(r.action),budget:r.bok.budget,authorizationTxHash:phase==='authorize'&&status==='confirmed'?r.txHash:old?.authorizationTxHash};}
 const result={correct,feeWithinCap,sameDraft,originalAuthorization:!!originalAuthorization};
 if(published&&phase==='post'&&status==='confirmed'&&correct&&feeWithinCap&&sameDraft&&originalAuthorization&&hash(r.txHash))result.public={transactionHash:r.txHash,authorizationTxHash:r.bok.authorizationTxHash,requestId:BigInt(r.bok.requestId).toString(),target:BigInt(r.bok.target).toString()};
 return result;
}
export function assertRetainedBokReview(value,{published=false}={}){
 assert.deepEqual([value.correct,value.feeWithinCap,value.sameDraft,value.originalAuthorization],[true,true,true,true],'Saved Bok approval or fee changed');
 if(published){assert(value.public);for(const k of ['transactionHash','authorizationTxHash'])assert.match(value.public[k],/^0x[0-9a-f]{64}$/);for(const k of ['requestId','target'])positive(value.public[k]);}
}

// Public untrusted cache discovery only. The caller authenticates returned
// transaction hashes through the existing SDK decoder, never trusts page labels.
export async function discoverRetainedBokCompletion({postId,requestId,scope}){
 const read=async path=>{const response=await fetch(path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4000)});if(response.status===503||response.status===404)return null;if(!response.ok)throw Error('BOK_PUBLIC_UNAVAILABLE');const text=await response.text();if(text.length>1048576)throw Error('BOK_PUBLIC_LIMIT');const value=JSON.parse(text);if(value.complete!==true||JSON.stringify(value.scope)!==JSON.stringify(scope))throw Error('BOK_PUBLIC_SCOPE');return value;};
 const parent=await read('/api/post?id='+postId);if(!parent?.post?.invocation?.reply)return false;
 const reply=await read('/api/post?id='+parent.post.invocation.reply);if(!reply?.post?.bot)return false;
 let cursor=null,revision=null,checkpoint=null,accounting=null;const seen=new Set();
 for(let count=0;count<8;count++){
  const page=await read('/api/bok-accounting?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!page)return false;
  if(revision===null){revision=page.revision;checkpoint=JSON.stringify(page.checkpoint);}else if(page.revision!==revision||JSON.stringify(page.checkpoint)!==checkpoint)return false;
  if(!Array.isArray(page.requests)||page.requests.length>100)throw Error('BOK_PUBLIC_SHAPE');
  for(const row of page.requests)if(row.requestId===requestId){if(accounting)throw Error('BOK_PUBLIC_DUPLICATE');accounting=row;}
  if(page.nextCursor===null){if(!accounting||accounting.state!=='4')return false;return {parent:parent.post,reply:reply.post,accounting,checkpoint:page.checkpoint};}
  if(typeof page.nextCursor!=='string'||! /^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(page.nextCursor)||seen.has(page.nextCursor))throw Error('BOK_PUBLIC_CURSOR');seen.add(page.nextCursor);cursor=page.nextCursor;
 }
 throw Error('BOK_PUBLIC_INCOMPLETE');
}
export function assertRetainedBokPostEvents({postEvents,publicIntent,approval,pluginId}){
 const one=(events,type,test)=>{const rows=events.filter(e=>e.type===type&&test(e.payload));assert.equal(rows.length,1);return rows[0];};
 const invocation=one(postEvents,'PluginInvoked',p=>p.request_id===publicIntent.requestId&&p.target===publicIntent.target&&p.plugin_id===BigInt(pluginId).toString());
 const post=one(postEvents,'PostPublished',p=>p.id===invocation.payload.post_id);const expectedParent=approval.parent??'0',expectedRoot=(approval.root??'0')==='0'?post.payload.id:approval.root;assert.equal(post.payload.record.root,expectedRoot);assert.equal(post.payload.record.parent,expectedParent);
 assert.equal(unpackRollingText(post.payload.message,post.payload.length,32*31),approval.content,'Canonical original Bok post differs from approval');
 assert.equal(createHash('sha256').update(approval.content).digest('hex'),approval.contentSha256);
 return {postId:post.payload.id,root:expectedRoot};
}
export function assertRetainedBokEvents({postEvents,replyEvents,accountingEvents,publicIntent,approval,pluginId,discovered}){
 const one=(events,type,test)=>{const rows=events.filter(e=>e.type===type&&test(e.payload));assert.equal(rows.length,1);return rows[0];};
 const {postId,root:expectedRoot}=assertRetainedBokPostEvents({postEvents,publicIntent,approval,pluginId}),post={payload:{id:postId}};
 const linked=one(replyEvents,'PluginReplyPublished',p=>p.request_id===publicIntent.requestId&&p.target===publicIntent.target&&p.parent_id===post.payload.id&&p.plugin_id===BigInt(pluginId).toString());
 const reply=one(replyEvents,'PostPublished',p=>p.id===linked.payload.post_id);assert.equal(reply.payload.record.kind,'4');assert.equal(reply.payload.record.parent,post.payload.id);assert.equal(reply.payload.record.root,expectedRoot);assert.equal(reply.position.txHash,linked.position.txHash);
 assert.equal(discovered.parent.id,post.payload.id);assert.equal(discovered.reply.id,reply.payload.id);assert.equal(discovered.reply.position.txHash,reply.position.txHash);
 const accounting=one(accountingEvents,'AccountingChanged',p=>p.request_id===publicIntent.requestId&&p.state==='4').payload;
 assert.equal(accounting.budget,approval.budget);assert.equal(accounting.available,'0');assert.equal(accounting.reserved,'0');assert(BigInt(accounting.charged)>0n);assert.equal(BigInt(accounting.charged)+BigInt(accounting.refunded),BigInt(approval.budget));
 for(const k of ['state','sequence','budget','available','reserved','charged','refunded'])assert.equal(discovered.accounting[k],accounting[k]);
 return {canonicalReply:true,canonicalTerminalAccounting:true,charged:accounting.charged,refunded:accounting.refunded};
}

export async function driveRetainedBokJourney({page,control,approval,mark,report,deadlineAt}){
 const remaining=retainedBokRemaining(deadlineAt);
 assert.equal(report.paidRecovery?.readyFromConfirmedPrivateClaim,true);approval=validateRetainedBokApproval(approval,control);
 const dialog=page.getByRole('dialog'),inspect=async(phase,status,options={})=>{const value=await page.evaluate(inspectRetainedBokWorkflow,{config:control.walletConfig.config,approval,phase,status,...options});assertRetainedBokReview(value,options);return value;};
 report.retainedBok={authorizationConfirmed:false,postConfirmed:false,canonicalReply:false,canonicalTerminalAccounting:false,providerBillingIndependentlyAttested:false};
 const observation=approval.completion==='post-only'?reserveRetainedBokObservation(approval.observationFile):null;
 try{
  const publicIntent=await driveRetainedBokConfirmations({page,dialog,approval,inspect,mark,report,remaining});
  if(observation){observation.complete(publicIntent);report.retainedBok.publicIntent=publicIntent;}
  await observeRetainedBokJourney({page,control,approval,publicIntent,mark,report,remaining,postOnly:approval.completion==='post-only'});
 }finally{observation?.close();await page.evaluate(()=>{delete window.__retainedBokWorkflow;});}
}

export function reserveRetainedBokObservation(filename){
 const fd=fs.openSync(filename,'wx+',0o600),original=fs.fstatSync(fd);let closed=false,completed=false;
 const close=()=>{if(!closed){closed=true;fs.closeSync(fd);}};
 try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,state:'entered'})+'\n');fs.fsyncSync(fd);const parent=fs.openSync(path.dirname(filename),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
 catch(error){close();throw error;} // Keep the entered sentinel even if initialization failed.
 return {close,complete(publicIntent){
  assert(!closed&&!completed);exactKeys(publicIntent,['authorizationTxHash','transactionHash','requestId','target']);for(const k of ['authorizationTxHash','transactionHash'])assert.match(publicIntent[k],/^0x[0-9a-f]{64}$/);for(const k of ['requestId','target'])positive(publicIntent[k]);
  const current=fs.lstatSync(filename);assert(current.isFile()&&!current.isSymbolicLink()&&current.dev===original.dev&&current.ino===original.ino&&current.uid===process.getuid()&&current.nlink===1&&(current.mode&0o777)===0o600,'Original observer reservation changed');
  const bytes=Buffer.from(JSON.stringify(publicIntent)+'\n');let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);assert(written>0);offset+=written;}fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);completed=true;
 }};
}
export function writeRetainedBokObservation(filename,publicIntent){
 exactKeys(publicIntent,['authorizationTxHash','transactionHash','requestId','target']);for(const k of ['authorizationTxHash','transactionHash'])assert.match(publicIntent[k],/^0x[0-9a-f]{64}$/);for(const k of ['requestId','target'])positive(publicIntent[k]);
 const reservation=reserveRetainedBokObservation(filename);try{reservation.complete(publicIntent);}finally{reservation.close();}
}

export function readRetainedBokObservation(filename){
 assert(path.isAbsolute(filename??''));const st=fs.lstatSync(filename);assert(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o600&&st.nlink===1&&st.size<=4096);
 const v=JSON.parse(fs.readFileSync(filename,'utf8'));exactKeys(v,['authorizationTxHash','transactionHash','requestId','target']);
 for(const k of ['authorizationTxHash','transactionHash'])assert.match(v[k],/^0x[0-9a-f]{64}$/);
 for(const k of ['requestId','target'])positive(v[k]);return v;
}
export async function waitRetainedBokCompletion({page,input,remaining}){
 // Installed Playwright treats an async predicate's Promise as truthy. Await
 // each bounded public read before deciding whether completion was discovered.
 for(;;){remaining();const value=await page.evaluate(discoverRetainedBokCompletion,input);remaining();if(value){assert(value.parent&&value.reply&&value.accounting);return value;}await page.waitForTimeout(Math.min(1000,remaining()));}
}
export async function observeRetainedBokJourney({page,control,approval,publicIntent,mark,report,remaining,postOnly=false}){
 report.retainedBok??={authorizationConfirmed:false,postConfirmed:false,canonicalReply:false,canonicalTerminalAccounting:false,providerBillingIndependentlyAttested:false};
 const [{createAztecNodeClient},{loadContractArtifact},{loadRollingArtifacts},{createRollingEventDecoder}]=await Promise.all([import('@aztec-labs/aztec.js/node'),import('@aztec-labs/stdlib/abi'),import('../prover/rolling-artifacts.mjs'),import('../shared/rolling/public-events.mjs')]);
 const node=createAztecNodeClient(control.walletConfig.trustedQuery.url),[board,bok]=loadRollingArtifacts();
 const decoder=await createRollingEventDecoder({artifact:loadContractArtifact(board),bokArtifact:loadContractArtifact(bok),scope:approval.publicScope});
 const authorizationEvents=await decoder.decodeTransaction(node,publicIntent.authorizationTxHash);const opened=authorizationEvents.filter(e=>e.type==='AccountingChanged'&&e.payload.request_id===publicIntent.requestId);assert.equal(opened.length,1);assert.equal(opened[0].payload.state,'1');assert.equal(opened[0].payload.budget,approval.budget);assert.equal(opened[0].payload.available,approval.budget);assert.equal(opened[0].payload.reserved,'0');report.retainedBok.authorizationConfirmed=true;
 const {TxHash}=await import('@aztec-labs/stdlib/tx');const fees={};for(const [kind,hash,cap] of [['authorization',publicIntent.authorizationTxHash,approval.authorizeFeeCap],['post',publicIntent.transactionHash,approval.postFeeCap]]){const receipt=await node.getTxReceipt(TxHash.fromString(hash));assert.equal(receipt.executionResult,'success');assert.equal(typeof receipt.transactionFee,'bigint');assert(receipt.transactionFee>=0n&&receipt.transactionFee<=BigInt(cap));fees[kind]=String(receipt.transactionFee);}
 const postEvents=await decoder.decodeTransaction(node,publicIntent.transactionHash),invocation=postEvents.filter(e=>e.type==='PluginInvoked'&&e.payload.request_id===publicIntent.requestId);assert.equal(invocation.length,1);const postId=invocation[0].payload.post_id;report.retainedBok.postConfirmed=true;
 if(postOnly){assert.equal(approval.completion,'post-only');assertRetainedBokPostEvents({postEvents,publicIntent,approval,pluginId:control.walletConfig.config.bok.pluginId});for(const event of [...authorizationEvents,...postEvents])assert.equal((await node.getBlockData(Number(event.position.blockNumber))).blockHash.toString(),event.position.blockHash);Object.assign(report.retainedBok,{canonicalPost:true,postId,completion:'post-only',networkFees:fees,authorizationTransactionHash:publicIntent.authorizationTxHash,postTransactionHash:publicIntent.transactionHash});return;}
 mark('retained-bok-reply-accounting');
 const discovered=await waitRetainedBokCompletion({page,input:{postId,requestId:publicIntent.requestId,scope:approval.publicScope},remaining});
  const replyEvents=await decoder.decodeTransaction(node,discovered.reply.position.txHash),accountingEvents=await decoder.decodeTransaction(node,discovered.accounting.position.txHash);
  // Recheck all event anchors after the final decoded transaction; a moved
  // canonical block invalidates the complete observation.
  for(const event of [...authorizationEvents,...postEvents,...replyEvents,...accountingEvents])assert.equal((await node.getBlockData(Number(event.position.blockNumber))).blockHash.toString(),event.position.blockHash);
  Object.assign(report.retainedBok,assertRetainedBokEvents({postEvents,replyEvents,accountingEvents,publicIntent,approval,pluginId:control.walletConfig.config.bok.pluginId,discovered}),{networkFees:fees,authorizationTransactionHash:publicIntent.authorizationTxHash,postTransactionHash:publicIntent.transactionHash,replyTransactionHash:discovered.reply.position.txHash,accountingTransactionHash:discovered.accounting.position.txHash});
}


export function retainedBokRemaining(deadlineAt,now=Date.now){
 const initial=now();assert(Number.isSafeInteger(deadlineAt)&&deadlineAt>initial&&deadlineAt-initial<=525000,'Invalid original Bok deadline');
 return ()=>{const ms=deadlineAt-now();assert(ms>0&&ms<=525000,'Original Bok deadline exhausted');return ms;};
}
export async function driveRetainedBokConfirmations({page,dialog,approval,inspect,mark,report,remaining=()=>80000}){
 const waitForState=async(expected,message)=>{await expected.or(dialog.getByRole('alert',{exact:true})).first().waitFor({timeout:remaining()});assert(await expected.isVisible(),message+'; preserve the original workflow');};
 const reviewReady=()=>waitForState(dialog.getByRole('button',{name:'Confirm and send',exact:true}),'Bok preparation failed before confirmation');
 mark('retained-bok-authorize-review');
 const reply=Object.hasOwn(approval,'parent')&&approval.parent!=='0';
 if(reply){
  await dialog.getByRole('button',{name:'Close account panel',exact:true}).click();
  await page.evaluate(({root,parent})=>{location.hash='/thread/'+root+'/'+parent;},{root:approval.root,parent:approval.parent});
  await page.locator('#post-'+approval.parent).getByRole('button',{name:'Reply',exact:true}).click({timeout:remaining()});
 }else await dialog.getByRole('button',{name:'Actions',exact:true}).click();
 await dialog.getByLabel('Action',{exact:true}).selectOption('bok');
 if(reply){await dialog.getByText('Replying in this conversation',{exact:true}).waitFor({timeout:remaining()});assert.equal(await dialog.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/'+approval.root+'/'+approval.parent);}
 else await dialog.getByText('New conversation',{exact:true}).waitFor({timeout:remaining()});
 await dialog.getByLabel('Message',{exact:true}).fill(approval.content);await dialog.getByLabel('Maximum Bok credits',{exact:true}).fill(approval.budget);
 await dialog.getByRole('button',{name:'Check action and review fee',exact:true}).click();await reviewReady();await inspect('authorize','prepared',{capture:true});
 mark('retained-bok-authorize');remaining();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();await waitForState(dialog.getByRole('button',{name:'Review saved Bok post',exact:true}),'Bok authorization did not complete');await inspect('authorize','confirmed',{capture:true});report.retainedBok.authorizationConfirmed=true;
 mark('retained-bok-post-review');await dialog.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await reviewReady();await inspect('post','prepared');
 mark('retained-bok-post');remaining();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();await waitForState(dialog.getByText('Transaction confirmed on the verified chain.',{exact:true}),'Bok publication did not complete');const {public:publicIntent}=await inspect('post','confirmed',{published:true});return publicIntent;
}

// Diagnostic only: Node still owns fatal exception handling and its exit status.
// The Supervisor otherwise ignores stderr, so retain a closed safe stdout record.
export function installWalletFatalObservation(runtime,write,getStage){
 let emitted=false;
 const observe=error=>{try{
  if(emitted)return;emitted=true;
  const own=key=>{const d=error&&Object.getOwnPropertyDescriptor(error,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const code=own('code'),stack=own('stack'),name=own('name');
  const failure={stage:getStage(),errorClass:['Error','TypeError','RangeError','ReferenceError','AssertionError'].includes(name)?name:'Error',code:['ERR_WORKER_OUT_OF_MEMORY','ERR_WORKER_INIT_FAILED','ERR_DLOPEN_FAILED','ERR_MODULE_NOT_FOUND','ERR_SOCKET_CONNECTION_TIMEOUT','ECONNRESET','ENOENT','ERR_ASSERTION'].includes(code)?code:'unknown'};
  const location=typeof stack==='string'&&stack.match(/(?:t04-metamask|test-wallet-extension-browser|coreBundle|native_socket)\.(?:mjs|js):\d+:\d+/);if(location)failure.location=location[0];
  write({passed:false,scope:'Fatal wallet driver observation; original exit is unchanged',failure});
 }catch{}};
 runtime.on('uncaughtExceptionMonitor',observe);return()=>runtime.removeListener('uncaughtExceptionMonitor',observe);
}

// Explicit, pinned test-browser upgrade; the existing bundled browser is default.
export function walletChromiumLaunch(env=process.env,{aggregate=false}={}){
 const executablePath=env.T04_CHROMIUM_EXECUTABLE??(aggregate?path.join(ROOT,'.build/cft-155.0.8059.79-mac-arm64/unpacked/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'):undefined);
 if(executablePath===undefined)return {channel:'chromium'};
 assert(path.isAbsolute(executablePath)&&executablePath.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),'Invalid pinned test browser');
 assert(fs.existsSync(executablePath),'Install pinned Chrome for Testing155.0.8059.79 using TESTING.md; no fallback to153');
 const sha=file=>{const hash=createHash('sha256'),buffer=Buffer.alloc(65536),fd=fs.openSync(file,'r');try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{fs.closeSync(fd);}};
 assert.equal(sha(executablePath),'c41c446837b5888d9574dbe462a4f01f02459bffee534eb945d2418984135a92','Pinned test browser executable changed');
 const framework=path.resolve(path.dirname(executablePath),'../Frameworks/Google Chrome for Testing Framework.framework/Versions/155.0.8059.79/Google Chrome for Testing Framework');
 assert.equal(sha(framework),'f20c7ab27196bfdaa20026299acd6d14b6619db3fc4680192fdc7785d1414263','Pinned test browser framework changed');
 return {executablePath};
}

// Separate finite, source-bound approvals for the same funded private account.
// These stages never publish a post or authorize a model call. Withdrawal is a
// later invocation so gas provision cannot contaminate zero-ETH onboarding.
export function validateRetainedBokRecoveryApproval(value,control,now=Date.now()){
 exactKeys(value,['schemaVersion','journey','runtimeSha256','content','contentSha256','budget','authorizeFeeCap','releaseFeeCap','withdrawFeeCap','withdrawAmount','refundGasCap','expiresAt','publicScope','recoveryFile','recoverySha256','recoveryStem','releaseTransactionHash',...(value.journey==='refund'?['withdrawalTransactionHash']:[])]);
 assert.equal(value.schemaVersion,2);assert(['release','withdraw','refund'].includes(value.journey));
 if(value.journey==='refund')assert.match(value.withdrawalTransactionHash,/^0x[0-9a-f]{64}$/);
 validateRetainedBokApproval({schemaVersion:1,runtimeSha256:value.runtimeSha256,content:value.content,contentSha256:value.contentSha256,budget:value.budget,authorizeFeeCap:value.authorizeFeeCap,postFeeCap:value.releaseFeeCap,expiresAt:value.expiresAt,publicScope:value.publicScope},control,now);
 for(const k of ['withdrawFeeCap','withdrawAmount','refundGasCap'])positive(value[k]);
 assert(BigInt(value.authorizeFeeCap)+BigInt(value.releaseFeeCap)+BigInt(value.withdrawFeeCap)<=BigInt(control.allocation.feeAmount));
 assert(BigInt(value.withdrawAmount)<=BigInt(control.allocation.bokAmount));
 assert(BigInt(value.refundGasCap)<=parseEther('0.003'));
 assert.match(value.recoverySha256,/^[a-f0-9]{64}$/);assert.match(value.recoveryStem,/^[a-z][a-z0-9-]{0,63}$/);
 assert(path.isAbsolute(value.recoveryFile));assert.equal(path.dirname(value.recoveryFile),control.recoveryDirectory);
 if(value.journey==='release')assert.equal(value.releaseTransactionHash,null);else assert.match(value.releaseTransactionHash,/^0x[0-9a-f]{64}$/);
 return structuredClone(value);
}
export function verifyRetainedBokRecoveryFiles(approval,control){
 const stat=fs.lstatSync(approval.recoveryFile);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.nlink===1&&stat.size<=34*1024*1024);
 assert.equal(fs.realpathSync(approval.recoveryFile),approval.recoveryFile);assert.equal(createHash('sha256').update(fs.readFileSync(approval.recoveryFile)).digest('hex'),approval.recoverySha256);
 for(const suffix of approval.journey==='release'?['authorized','released']:approval.journey==='refund'?['refunded']:['withdrawn','refunded'])assert(!fs.existsSync(path.join(control.recoveryDirectory,approval.recoveryStem+'-'+suffix+'.json')),'Preserve the previous recovery output; do not repeat this stage');
}

// In-page only: the existing runtime returns its already-created real session.
// All private identifiers and decrypted originals stay in this page. Only closed
// assertions, counts and public transaction hashes cross back to the driver.
export async function inspectRetainedBokRecovery({config,approval,phase,expectedDigest,expectedRecipient}){
 const check=(ok)=>{if(!ok)throw Error('Retained Bok recovery binding changed');};
 const sdk=window.__aztec,w=window.walletState.aztec,n=config.network,b=config.board;
 const scope=JSON.stringify(['AZTEC_BB_L2_JOURNAL_V1',w.address.toString(),n.chainId,n.rollupAddress,n.rollupVersion,b.contractAddress,b.portalAddress]);
 const slot=await sdk.createEncryptedJournalSlot({storage:sdk.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',scope]),keyDomain:'ROLLING_WORKFLOW_V1'});
 const r=(await slot.read()).value,hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v),decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
 check(r&&Date.now()<approval.expiresAt);
 const original=r.bokReleaseSource??r;
 const auth=original.action?.type==='bok'&&original.action.content===approval.content&&original.action.subboard==='0'&&original.action.name==='0'&&original.action.budget===approval.budget&&original.bok?.budget===approval.budget&&original.bok.phase==='authorize'&&original.bok.scope.address===config.bok.contractAddress&&original.bok.scope.pluginId===config.bok.pluginId;
 if(phase.startsWith('authorize')){
  check(auth&&r===original&&r.status===(phase==='authorize-prepared'?'prepared':'confirmed'));
  check(decimal(r.maximumFee)&&BigInt(r.maximumFee)<=BigInt(approval.authorizeFeeCap));
 }else if(phase.startsWith('release')){
  check(auth&&original.status==='confirmed'&&hash(original.txHash)&&r.action.type==='cancel-bok-request'&&r.action.requestId===original.bok.requestId&&r.status===(phase==='release-prepared'?'prepared':'confirmed'));
  check(decimal(r.maximumFee)&&BigInt(r.maximumFee)<=BigInt(approval.releaseFeeCap));
 }else if(phase.startsWith('withdraw')){
  check(r.action.type==='withdraw-bok'&&r.action.amount===approval.withdrawAmount&&r.action.recipient===(expectedRecipient??window.walletState.ethAccount?.toLowerCase())&&r.withdrawal?.kind==='bok'&&r.withdrawal.amount===approval.withdrawAmount&&r.withdrawal.depositor===r.action.recipient&&r.withdrawal.bokScope.recipient===config.bok.contractAddress&&r.withdrawal.bokScope.portal===config.aggregateFunding.bokPortal&&r.withdrawal.bokScope.token===config.aggregateFunding.bokToken);
  check(r.status===(phase==='withdraw-prepared'?'prepared':'confirmed')&&decimal(r.maximumFee)&&BigInt(r.maximumFee)<=BigInt(approval.withdrawFeeCap));
 }else throw Error('Unknown recovery phase');
 if(phase.endsWith('confirmed'))check(hash(r.txHash));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(r))))).map(v=>v.toString(16).padStart(2,'0')).join('');
 if(expectedDigest!==undefined)check(digest===expectedDigest);
 if(phase==='authorize-confirmed')window.__retainedReleaseOriginal=structuredClone(r);
 if(phase.startsWith('release'))check(JSON.stringify(original)===JSON.stringify(window.__retainedReleaseOriginal??original));
 if(phase==='release-confirmed'){
  if(approval.journey==='withdraw')check(r.txHash===approval.releaseTransactionHash);
  window.__retainedReleasedRequest=original.bok.requestId;
 }
 if(phase==='withdraw-confirmed'){if(approval.journey==='refund')check(r.txHash===approval.withdrawalTransactionHash);check(decimal(r.actualNetworkFee)&&BigInt(r.actualNetworkFee)<=BigInt(approval.withdrawFeeCap));window.__retainedWithdrawal=structuredClone(r);}
 return {matched:true,digest,...(phase.endsWith('confirmed')?{transactionHash:r.txHash,authorizationTransactionHash:original.bok?original.txHash:undefined,...(phase==='withdraw-confirmed'?{actualNetworkFee:r.actualNetworkFee}:{})}:{})};
}

export function assertRetainedBokBalanceChange(before,after,{budget,withdrawAmount,phase}){
 for(const x of [before,after]){assert.equal(x.complete,true);for(const k of ['available','allocated','reserved','charged','refunded'])assert.match(x[k],/^(0|[1-9][0-9]*)$/);assert(Number.isSafeInteger(x.requests)&&x.requests>=0);}
 assert.equal(after.reserved,before.reserved);assert.equal(after.charged,before.charged);
 if(phase==='authorized'){assert.equal(BigInt(after.available),BigInt(before.available)-BigInt(budget));assert.equal(BigInt(after.allocated),BigInt(before.allocated)+BigInt(budget));assert.equal(after.requests,before.requests+1);assert.equal(after.refunded,before.refunded);}
 else if(phase==='released'){assert.equal(after.available,before.available);assert.equal(after.allocated,before.allocated);assert.equal(after.requests,before.requests+1);assert.equal(BigInt(after.refunded),BigInt(before.refunded)+BigInt(budget));assert.equal(after.selectedClosed,true);}
 else if(phase==='withdrawn'){assert.equal(BigInt(after.available),BigInt(before.available)-BigInt(withdrawAmount));for(const k of ['allocated','refunded','requests'])assert.equal(after[k],before[k]);}
 else throw Error('Unknown balance assertion');
}
export async function readRetainedBokBalances({page,remaining,ui=true}){
 if(ui){const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Balances and withdrawals',exact:true}).click();await dialog.getByRole('button',{name:'Check private balances',exact:true}).click();await dialog.getByText(/^Unallocated Bok credit:/).waitFor({timeout:remaining()});
 await dialog.getByRole('button',{name:'Check all Bok requests',exact:true}).click();
 for(;;){remaining();const done=dialog.getByText(/^Complete owned-request accounting at block /);if(await done.isVisible())break;const more=dialog.getByRole('button',{name:'Continue checking Bok requests',exact:true});if(await more.isEnabled().catch(()=>false))await more.click();else await page.waitForTimeout(Math.min(250,remaining()));}
 }
 // Verify through the same existing public acquisition/private filtering API;
 // no owner/request-selected public RPC or alternate balance implementation.
 return page.evaluate(async deadlineAt=>{
  const runtime=await import('/wallet/runtime.mjs'),app=(await(await runtime.loadRollingWalletRuntime()).createSession()).application;
  let cursor=0,r;for(let i=0;i<10000;i++){if(Date.now()>=deadlineAt)throw Error('Original balance deadline');r=await app.readBokAccounting({cursor});if(r.complete)break;cursor=r.nextCursor;}if(!r?.complete)throw Error('Incomplete private accounting');
  const selected=window.__retainedReleasedRequest,row=selected?r.requests.find(x=>x.requestId===selected):null;
  return {complete:true,available:r.available,allocated:r.totals.available,reserved:r.totals.reserved,charged:r.totals.charged,refunded:r.totals.refunded,requests:r.requests.length,selectedClosed:!!row&&row.state==='4'&&row.available==='0'&&row.reserved==='0'&&row.charged==='0',anchor:{blockNumber:r.anchor.blockNumber,blockHash:r.anchor.blockHash}};
 },Date.now()+remaining());
}

async function exportRetainedBokRecovery({page,control,approval,suffix}){
 const dialog=page.getByRole('dialog'),details=dialog.getByText('Backup and account security',{exact:true});
 if(!await dialog.getByLabel('New recovery password',{exact:true}).isVisible())await details.click();
 await dialog.getByLabel('New recovery password',{exact:true}).fill(control.password);
 const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download encrypted recovery',exact:true}).click()]);
 const filename=path.join(control.recoveryDirectory,approval.recoveryStem+'-'+suffix+'.json');await saveEncryptedDownload(download,filename);
 return {filename,sha256:createHash('sha256').update(fs.readFileSync(filename)).digest('hex')};
}
async function reopenRetainedBokRecovery({page,control,filename,mark}){
 // Close the real session before reload, preserving its exact new export.
 const dialog=page.getByRole('dialog');if(!await dialog.getByRole('button',{name:'Lock account',exact:true}).isVisible())await dialog.getByText('Backup and account security',{exact:true}).click();
 await dialog.getByRole('button',{name:'Lock account',exact:true}).click();await dialog.getByText('Account locked. Reload before unlocking again.',{exact:true}).waitFor();await page.reload();
 await page.getByRole('button',{name:'Your account',exact:true}).click();await dialog.getByRole('button',{name:'Unlock',exact:true}).click();await discoverTestMetaMask(page);await page.evaluate(installMetaMaskPaidRecoveryGuard);
 await dialog.getByLabel('Recovery password',{exact:true}).fill(control.password);await dialog.getByLabel('Recovery file',{exact:true}).setInputFiles(filename);await dialog.getByRole('button',{name:'Import recovery',exact:true}).click();mark('retained-bok-original-reopened');
}

export async function driveRetainedBokRelease({page,control,approval,mark,report,deadlineAt}){
 const remaining=retainedBokRemaining(deadlineAt),dialog=page.getByRole('dialog');
 const inspect=(phase,expectedDigest)=>page.evaluate(inspectRetainedBokRecovery,{config:control.walletConfig.config,approval,phase,expectedDigest});
 report.bokRecovery={journey:'release',authorizationSends:0,releaseSends:0,postSends:0,expiryQualified:false};const result=report.bokRecovery;
 const before=await readRetainedBokBalances({page,remaining});
 await dialog.getByRole('button',{name:'Actions',exact:true}).click();await dialog.getByLabel('Action',{exact:true}).selectOption('bok');await dialog.getByLabel('Message',{exact:true}).fill(approval.content);await dialog.getByLabel('Maximum Bok credits',{exact:true}).fill(approval.budget);
 await dialog.getByRole('button',{name:'Check action and review fee',exact:true}).click();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).waitFor({timeout:remaining()});await inspect('authorize-prepared');remaining();result.authorizationSends++;mark('retained-bok-release-authorize');await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();await dialog.getByRole('button',{name:'Review release of this saved request',exact:true}).waitFor({timeout:remaining()});
 const auth=await inspect('authorize-confirmed');result.authorizationTransactionHash=auth.transactionHash;
 const authorized=await readRetainedBokBalances({page,remaining,ui:false});assertRetainedBokBalanceChange(before,authorized,{budget:approval.budget,phase:'authorized'});
 const saved=await exportRetainedBokRecovery({page,control,approval,suffix:'authorized'});result.authorizedRecoverySha256=saved.sha256;
 await reopenRetainedBokRecovery({page,control,filename:saved.filename,mark});await dialog.getByRole('button',{name:'Review release of this saved request',exact:true}).waitFor({timeout:remaining()});await inspect('authorize-confirmed',auth.digest);result.reopenedOriginal=true;
 // Cancelling the first fee review must restore precisely the same authorization.
 await dialog.getByRole('button',{name:'Review release of this saved request',exact:true}).click();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).waitFor({timeout:remaining()});await inspect('release-prepared');await dialog.getByRole('button',{name:'Cancel prepared action',exact:true}).click();await dialog.getByRole('button',{name:'Review release of this saved request',exact:true}).waitFor({timeout:remaining()});await inspect('authorize-confirmed',auth.digest);result.reviewCancelledWithoutSend=true;
 await dialog.getByRole('button',{name:'Review release of this saved request',exact:true}).click();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).waitFor({timeout:remaining()});await inspect('release-prepared');remaining();result.releaseSends++;mark('retained-bok-release-confirm');await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();await dialog.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor({timeout:remaining()});const released=await inspect('release-confirmed');result.releaseTransactionHash=released.transactionHash;
 const after=await readRetainedBokBalances({page,remaining});assertRetainedBokBalanceChange(before,after,{budget:approval.budget,phase:'released'});result.completeOwnedHistory=true;result.availableRestored=true;result.reservationsUnchanged=true;
 const output=await exportRetainedBokRecovery({page,control,approval,suffix:'released'});result.releasedRecoverySha256=output.sha256;
 await reopenRetainedBokRecovery({page,control,filename:output.filename,mark});await dialog.getByRole('button',{name:'Balances and withdrawals',exact:true}).waitFor({timeout:remaining()});await inspect('release-confirmed',released.digest);const reopened=await readRetainedBokBalances({page,remaining});assertRetainedBokBalanceChange(before,reopened,{budget:approval.budget,phase:'released'});result.closedRequestSurvivesReopen=true;result.canonicalAccounting=await verifyRetainedReleaseTransactions({control,approval,authorizationHash:auth.transactionHash,releaseHash:released.transactionHash});
}

export async function verifyRetainedReleaseTransactions({control,approval,authorizationHash,releaseHash}){
 const [{createAztecNodeClient},{loadContractArtifact},{loadRollingArtifacts},{createRollingEventDecoder},{TxHash}]=await Promise.all([import('@aztec-labs/aztec.js/node'),import('@aztec-labs/stdlib/abi'),import('../prover/rolling-artifacts.mjs'),import('../shared/rolling/public-events.mjs'),import('@aztec-labs/stdlib/tx')]);
 const node=createAztecNodeClient(control.walletConfig.trustedQuery.url),[board,bok]=loadRollingArtifacts(),decoder=await createRollingEventDecoder({artifact:loadContractArtifact(board),bokArtifact:loadContractArtifact(bok),scope:approval.publicScope});
 const fees={},events=[];
 for(const [kind,hash,cap]of [['authorization',authorizationHash,approval.authorizeFeeCap],['release',releaseHash,approval.releaseFeeCap]]){
  assert.match(hash,/^0x[0-9a-f]{64}$/);const receipt=await node.getTxReceipt(TxHash.fromString(hash));assert(['checkpointed','proven','finalized'].includes(receipt.status));assert.equal(receipt.executionResult,'success');assert.equal(receipt.txHash.toString(),hash);assert(receipt.transactionFee>=0n&&receipt.transactionFee<=BigInt(cap));fees[kind]=String(receipt.transactionFee);
  const decoded=await decoder.decodeTransaction(node,hash);assert(!decoded.some(e=>['PostPublished','PluginInvoked','PluginReplyPublished'].includes(e.type)));
  const accounting=decoded.filter(e=>e.type==='AccountingChanged');assert.equal(accounting.length,1);events.push(accounting[0]);
 }
 const [opened,closed]=events;assert.equal(opened.payload.request_id,closed.payload.request_id);
 for(const event of events){assert.equal(event.payload.budget,approval.budget);assert.equal(event.payload.reserved,'0');assert.equal(event.payload.charged,'0');assert.equal((await node.getBlockData(Number(event.position.blockNumber))).blockHash.toString(),event.position.blockHash);}
 assert.equal(opened.payload.state,'1');assert.equal(opened.payload.available,approval.budget);assert.equal(opened.payload.refunded,'0');assert.equal(closed.payload.state,'4');assert.equal(closed.payload.available,'0');assert.equal(closed.payload.refunded,approval.budget);
 return {canonical:true,noPost:true,fees};
}

// This additional provider mode is used only for the separately approved exit.
// Admission inspects the ORIGINAL encrypted Ethereum journal written by the app
// before send. There is no broad payment exception and no second send after an
// unknown/rejected result. No private record escapes the page.
export function installMetaMaskBokRefundGuard({config,approval,account,readOnly=false}){
 const original=__testMetaMask.request.bind(__testMetaMask);let attempted=false,sentHash=null;
 window.__retainedRefundTraffic={attempted:false,denied:0,confirmedHash:null};
 const observations=new Set(),emit=event=>{const p=Promise.resolve().then(()=>window.__bokRefundObserve(event));observations.add(p);return p;};
 const deny=()=>{window.__retainedRefundTraffic.denied++;emit({type:'denied'});throw Error('Only the exact saved Bok refund is permitted');};
 __testMetaMask.request=async request=>{try{
  const method=request?.method;
  if(['eth_accounts','eth_requestAccounts','eth_chainId','eth_blockNumber'].includes(method))return original(request);
  if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)&&sentHash&&request.params?.length===1&&request.params[0]===sentHash)return original(request);
  if(method==='wallet_requestPermissions'&&JSON.stringify(request.params)==='[{"eth_accounts":{}}]'){await window.__bokRefundPermission('entered');try{const result=await original(request);await window.__bokRefundPermission('resolved');return result;}catch(error){await window.__bokRefundPermission('rejected');throw error;}}
  if(readOnly||method!=='eth_sendTransaction'||attempted||Date.now()>=approval.expiresAt||request.params?.length!==1)return deny();
  // Reserve before any await. A failed check is terminal for this invocation.
  attempted=true;window.__retainedRefundTraffic.attempted=true;
  const tx=request.params[0],w=window.walletState.aztec,sdk=window.__aztec,r=window.__retainedWithdrawal,n=config.network;
  const check=ok=>{if(!ok)deny();};
  check(r?.status==='confirmed'&&r.action.type==='withdraw-bok'&&r.withdrawal?.kind==='bok'&&r.action.amount===approval.withdrawAmount&&r.action.recipient===account&&r.withdrawal.depositor===account&&r.withdrawal.amount===approval.withdrawAmount);
  const selected=r.withdrawal.bokScope;check(selected.portal===config.aggregateFunding.bokPortal&&selected.token===config.aggregateFunding.bokToken&&selected.recipient===config.bok.contractAddress);
  const scope=JSON.stringify(['AZTEC_BB_ETH_JOURNAL_V1',w.address.toString(),n.chainId,n.rollupAddress,n.rollupVersion,selected.recipient,selected.portal,account,selected.token]);
  const slot=await sdk.createEncryptedJournalSlot({storage:sdk.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scopeText:scope,keyDomain:'AZTEC_BB_ETH_JOURNAL_KEY_V1'}),saved=(await slot.read()).value;
  check(saved?.version===1&&saved.txHash===null&&saved.expected?.kind==='bok-withdraw'&&saved.expected.amount===approval.withdrawAmount&&saved.expected.recipient===account&&saved.expected.exitNonce===r.withdrawal.nonce&&saved.from===account&&saved.to===selected.portal&&saved.chainId===n.chainId&&saved.value==='0');
  check(tx&&Object.keys(tx).every(k=>['from','to','chainId','nonce','data','value','gas','gasLimit','maxFeePerGas','maxPriorityFeePerGas','gasPrice','type'].includes(k)));
  check(tx.from?.toLowerCase()===saved.from&&tx.to?.toLowerCase()===saved.to&&tx.data?.toLowerCase()===saved.data&&BigInt(tx.value??0)===0n&&BigInt(tx.chainId)===BigInt(saved.chainId)&&BigInt(tx.nonce)===BigInt(saved.nonce));
  const abi=new window.ethers.Interface(['function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']);
  const parsed=abi.parseTransaction({data:tx.data});check(parsed?.name==='withdraw'&&abi.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase()===saved.data&&parsed.args[0].toLowerCase()===account&&String(parsed.args[1])===approval.withdrawAmount&&parsed.args[2]===r.withdrawal.nonce&&parsed.args[6].length<=256);
  const gas=BigInt(tx.gas??tx.gasLimit??0),price=BigInt(tx.maxFeePerGas??tx.gasPrice??0);check(gas>0n&&price>0n&&gas*price<=BigInt(approval.refundGasCap));if(tx.maxPriorityFeePerGas!==undefined)check(BigInt(tx.maxPriorityFeePerGas)<=price);
  await emit({type:'admit',transaction:structuredClone(tx)});
  const hash=await original(request);check(typeof hash==='string'&&/^0x[0-9a-f]{64}$/.test(hash));sentHash=hash;window.__retainedRefundTraffic.confirmedHash=hash;await emit({type:'acknowledged',hash});return hash;
 }finally{const drained=[...observations];observations.clear();await Promise.all(drained);}};
}
// Calls the existing session capability, never confirm/sign/send. Only a closed
// error projection crosses the page boundary; raw exception text stays private.
export async function prepareRetainedBokRefund({maximumGasWei,amount,recipient}){
 let session;
 const failure=error=>{
  const allowed=['BB_JOURNAL_INVALID','ROLLING_WITHDRAWAL_RECOVERY_REQUIRED','ROLLING_FUNDING_UNAVAILABLE','ROLLING_CONTEXT_CHANGED','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE','BB_TRANSACTION_READ_TIMEOUT','CALL_EXCEPTION','NETWORK_ERROR','TIMEOUT','UNKNOWN_ERROR'];
  const code=allowed.includes(error?.code)?error.code:allowed.includes(error?.message)?error.message:'unknown';
  const errorClass=['Error','TypeError','RangeError','AssertionError'].includes(error?.name)?error.name:'Error';
  const match=typeof error?.stack==='string'?error.stack.match(/wallet-session\.mjs:(\d+):(\d+)/):null;
  return {passed:false,code,errorClass,source:match?'wallet-session.mjs:'+match[1]+':'+match[2]:null};
 };
 try{
  const runtime=await import('/wallet/runtime.mjs');session=await(await runtime.loadRollingWalletRuntime()).createSession();
  let accountStatus;try{await session.application.readAccountStatus();accountStatus={passed:true};}catch(error){accountStatus=failure(error);}
  try{
   const quote=await session.withdrawal.prepare({maximumGasWei});
   if(quote.amount!==amount||quote.recipient!==recipient||quote.maximumGasWei!==maximumGasWei||!/^[1-9][0-9]*$/.test(quote.estimatedGasWei)||BigInt(quote.estimatedGasWei)>BigInt(maximumGasWei))throw Error('Refund quote binding changed');
   return {passed:accountStatus.passed,accountStatus,prepare:{passed:true,estimatedGasWei:quote.estimatedGasWei}};
  }catch(error){return {passed:false,accountStatus,prepare:failure(error)};}
 }catch(error){return {passed:false,session:failure(error)};}
 finally{session?.withdrawal.cancel();}
}
export async function bindRetainedRefundObservation(page,admission){
 await page.exposeFunction('__bokRefundObserve',event=>admission.observe(event));
 // The ordinary full-backup reopen installs its read-only guard before import.
 // Its denial channel must reach the same Node owner throughout that interval.
 await page.exposeFunction('__paidRecoveryDenied',()=>admission.observe({type:'denied'}));
}
export async function driveRetainedBokWithdrawal({page,walletPage,control,approval,provider,refundAdmission,mark,report,deadlineAt,readOnly=false}){
 const remaining=retainedBokRemaining(deadlineAt),dialog=page.getByRole('dialog'),account=Wallet.fromPhrase(control.mnemonic).address.toLowerCase();
 const refundOnly=approval.journey==='refund';assert(!readOnly||refundOnly);
 const result=report.bokRecovery={journey:approval.journey,withdrawalSends:0,refundConfirmations:0,expiryQualified:false};
 const binding={config:control.walletConfig.config,approval};
 assert(refundAdmission);await bindRetainedRefundObservation(page,refundAdmission);
 const permission={entered:false,resolved:false,rejected:false};await page.exposeFunction('__bokRefundPermission',state=>{assert(['entered','resolved','rejected'].includes(state));permission[state]=true;});
 await page.evaluate(installMetaMaskBokRefundGuard,{...binding,account,readOnly});
 // The released export remains the bound recovery authority. Unlock this same
 // profile with keys only: its current accounting/cache journals may be newer
 // than that export. The exact released operation is checked immediately below.
 const surface=await inspectMetaMaskAggregateReadiness({page,control,mark,keysOnly:true,refundOnly,remaining});
 assert.notEqual(surface,'initialization-failed','Private session initialization failed; preserve its finite diagnostic');
 if(readOnly){
  if(surface==='refund'){const connect=dialog.getByRole('button',{name:'Connect MetaMask',exact:true});if(await connect.isVisible()){await connect.click();await confirmMetaMaskRecoveryAccountSelection(walletPage,{page,account,chainId:'31337',permission});await dialog.getByText(/^MetaMask connected:/).waitFor({timeout:remaining()});}assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),account);}
  const exit=await page.evaluate(inspectRetainedBokRecovery,{...binding,phase:'withdraw-confirmed',expectedRecipient:account});
  result.originalWithdrawal=await verifyRetainedClaimReceipt({control,transactionHash:exit.transactionHash});result.withdrawalTransactionHash=exit.transactionHash;result.actualPrivateFee=exit.actualNetworkFee;result.surface=surface;
  const originalNonce=await provider.getTransactionCount(account,'pending');mark('retained-bok-refund-readonly-prepare');
  result.prepare=await page.evaluate(prepareRetainedBokRefund,{maximumGasWei:approval.refundGasCap,amount:approval.withdrawAmount,recipient:account});
  assert.equal(await provider.getTransactionCount(account,'pending'),originalNonce);assert.equal(result.prepare.passed,true,'Saved exit refund preparation failed; inspect the bounded result');return;
 }
 assert.equal(surface,refundOnly?'refund':'funding','Saved account recovery must succeed before financial review');
 assert(await provider.getBalance(account)>=BigInt(approval.refundGasCap),'Refund recipient needs separately provisioned gas after zero-ETH Ready');
 const nonce=await provider.getTransactionCount(account,'pending');
 const connect=dialog.getByRole('button',{name:'Connect MetaMask',exact:true});if(await connect.isVisible()){
  await connect.click();await confirmMetaMaskRecoveryAccountSelection(walletPage,{page,account,chainId:'31337',permission});await dialog.getByText(/^MetaMask connected:/).waitFor({timeout:remaining()});
 }
 assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),account);
 let before;
 if(refundOnly){
  const exit=await page.evaluate(inspectRetainedBokRecovery,{...binding,phase:'withdraw-confirmed'});
  result.originalWithdrawal=await verifyRetainedClaimReceipt({control,transactionHash:exit.transactionHash});result.withdrawalTransactionHash=exit.transactionHash;result.actualPrivateFee=exit.actualNetworkFee;
  before=await readRetainedBokBalances({page,remaining,ui:false});
 }else{
  const released=await page.evaluate(inspectRetainedBokRecovery,{...binding,phase:'release-confirmed'});
  result.originalRelease=await verifyRetainedReleaseTransactions({control,approval,authorizationHash:released.authorizationTransactionHash,releaseHash:released.transactionHash});
  before=await readRetainedBokBalances({page,remaining});assert.equal(before.selectedClosed,true);assert(BigInt(before.available)>=BigInt(approval.withdrawAmount));
 await dialog.getByLabel('Bok credit to withdraw in USDC',{exact:true}).fill(formatUnits(approval.withdrawAmount,6));await dialog.getByRole('button',{name:'Review Bok credit exit',exact:true}).click();await dialog.getByRole('button',{name:'Confirm and send',exact:true}).waitFor({timeout:remaining()});await page.evaluate(inspectRetainedBokRecovery,{...binding,phase:'withdraw-prepared'});
 remaining();result.withdrawalSends++;mark('retained-bok-private-withdrawal');await dialog.getByRole('button',{name:'Confirm and send',exact:true}).click();await dialog.getByRole('button',{name:'Review Ethereum refund',exact:true}).waitFor({timeout:remaining()});const exit=await page.evaluate(inspectRetainedBokRecovery,{...binding,phase:'withdraw-confirmed'});result.withdrawalTransactionHash=exit.transactionHash;result.actualPrivateFee=exit.actualNetworkFee;
 const after=await readRetainedBokBalances({page,remaining,ui:false});assertRetainedBokBalanceChange(before,after,{phase:'withdrawn',withdrawAmount:approval.withdrawAmount});result.unallocatedCreditDebitedOnce=true;
 const output=await exportRetainedBokRecovery({page,control,approval,suffix:'withdrawn'});result.withdrawalRecoverySha256=output.sha256;
 }
 await dialog.getByLabel('Maximum refund gas cost in ETH',{exact:true}).fill(formatUnits(approval.refundGasCap,18));
 // Review performs the real Outbox eth_call. A not-yet-settled exit fails here
 // without a send; the retained export is the sole recovery source, not a retry.
 await dialog.getByRole('button',{name:'Review Ethereum refund',exact:true}).click();const confirmRefund=dialog.getByRole('button',{name:'Confirm Ethereum refund',exact:true}),refundError=dialog.getByRole('alert');await confirmRefund.or(refundError).first().waitFor({timeout:remaining()});assert(await confirmRefund.isVisible(),'Saved refund review failed without a send');
 remaining();result.refundConfirmations++;mark('retained-bok-ethereum-refund');await dialog.getByRole('button',{name:'Confirm Ethereum refund',exact:true}).click();
 await walletPage.getByTestId('confirm-footer-button').waitFor({timeout:remaining()});await walletPage.getByTestId('confirm-footer-button').click();await dialog.getByText(/^Ethereum refund confirmed:/).waitFor({timeout:remaining()});
 const traffic=await page.evaluate(()=>window.__retainedRefundTraffic);assert.equal(traffic.attempted,true);assert.equal(traffic.denied,0);assert.match(traffic.confirmedHash,/^0x[0-9a-f]{64}$/);assert.equal(await provider.getTransactionCount(account,'pending'),nonce+1);
 const tx=await provider.getTransaction(traffic.confirmedHash),receipt=await provider.getTransactionReceipt(traffic.confirmedHash);assert.equal(receipt.status,1);assert.equal((await provider.getBlock(receipt.blockNumber)).hash,receipt.blockHash);assert.equal(tx.from.toLowerCase(),account);assert.equal(tx.to.toLowerCase(),control.walletConfig.config.aggregateFunding.bokPortal);
 const abi=new Interface(['event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)']),events=receipt.logs.filter(x=>x.address.toLowerCase()===tx.to.toLowerCase()).map(x=>{try{return abi.parseLog(x);}catch{return null;}}).filter(x=>x?.name==='Withdrawn');assert.equal(events.length,1);assert.equal(events[0].args.recipient.toLowerCase(),account);assert.equal(String(events[0].args.amount),approval.withdrawAmount);assert(receipt.gasUsed*receipt.gasPrice<=BigInt(approval.refundGasCap));
 const token=new Interface(['function balanceOf(address) view returns(uint256)']),balance=async blockTag=>token.decodeFunctionResult('balanceOf',await provider.call({to:control.walletConfig.config.aggregateFunding.bokToken,data:token.encodeFunctionData('balanceOf',[account]),blockTag}))[0];
 assert.equal(await balance(receipt.blockNumber)-await balance(receipt.blockNumber-1),BigInt(approval.withdrawAmount));
 result.refundTransactionHash=traffic.confirmedHash;result.canonicalRefund=true;result.refundAmount=approval.withdrawAmount;result.actualGasWei=String(receipt.gasUsed*receipt.gasPrice);
 const final=await readRetainedBokBalances({page,remaining,ui:false});if(refundOnly){assert.equal(final.complete,true);for(const key of ['available','allocated','reserved','charged','refunded','requests'])assert.equal(final[key],before[key]);}else assertRetainedBokBalanceChange(before,final,{phase:'withdrawn',withdrawAmount:approval.withdrawAmount});result.closedRequestHistoryRetained=true;const finalExport=await exportRetainedBokRecovery({page,control,approval,suffix:'refunded'});result.refundedRecoverySha256=finalExport.sha256;
 await reopenRetainedBokRefund({page,control,approval:{...approval,withdrawalTransactionHash:result.withdrawalTransactionHash},filename:finalExport.filename,account,mark,remaining,expectedBalances:final});
 const finalReceipt=await provider.getTransactionReceipt(traffic.confirmedHash);assert.equal(finalReceipt.status,1);assert.equal(finalReceipt.blockHash,receipt.blockHash);assert.equal((await provider.getBlock(finalReceipt.blockNumber)).hash,finalReceipt.blockHash);assert.equal(await provider.getTransactionCount(account,'pending'),nonce+1);
 result.fullLatestBackupReopened=true;result.refundStillCanonicalAfterReopen=true;
}
export async function reopenRetainedBokRefund({page,control,approval,filename,account,mark,remaining,expectedBalances}){
 await reopenRetainedBokRecovery({page,control,filename,mark});
 // The latest completed export is imported through the ordinary account UI.
 // This second page can only read; its denials still reach the Node owner.
 await page.evaluate(installMetaMaskBokRefundGuard,{config:control.walletConfig.config,approval,account,readOnly:true});
 const dialog=page.getByRole('dialog'),balances=dialog.getByRole('button',{name:'Balances and withdrawals',exact:true}),failure=dialog.getByRole('alert');
 await balances.or(failure).first().waitFor({timeout:remaining()});assert(await balances.isVisible(),'Latest full backup did not recover the confirmed refund');
 const status=await page.evaluate(async()=>{const runtime=await import('/wallet/runtime.mjs'),session=await(await runtime.loadRollingWalletRuntime()).createSession(),value=await session.application.readAccountStatus();return {status:value.status};});
 assert.notEqual(status.status,'recovering');
 const exit=await page.evaluate(inspectRetainedBokRecovery,{config:control.walletConfig.config,approval,phase:'withdraw-confirmed',expectedRecipient:account});assert.equal(exit.transactionHash,approval.withdrawalTransactionHash);
 const current=await readRetainedBokBalances({page,remaining});assert.equal(current.complete,true);for(const key of ['available','allocated','reserved','charged','refunded','requests'])assert.equal(current[key],expectedBalances[key]);
}


// Node-owned admission survives page reload and context.close. Only the public
// transaction tuple already admitted against the encrypted journal is retained
// in RAM; it is never included in the public report. Existing read-only checks
// remain the default for all other outer requests.
export function createRetainedBokRefundAdmission({config,approval,account}){
 let admitted=null,acknowledged=null;const counts={providerSends:0,outerSends:0,denied:0};
 const reject=()=>{counts.denied++;throw Error('Exact retained refund boundary refused');};
 const normalize=tx=>{
  assert(tx&&typeof tx==='object');
  const from=tx.from?.toLowerCase(),to=tx.to?.toLowerCase(),data=tx.data?.toLowerCase();assert.equal(from,account);assert.equal(to,config.aggregateFunding.bokPortal);assert.match(data,/^0x[0-9a-f]+$/);
  const abi=new Interface(['function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']),parsed=abi.parseTransaction({data});assert.equal(parsed.name,'withdraw');assert.equal(abi.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase(),data);assert.equal(parsed.args[0].toLowerCase(),account);assert.equal(String(parsed.args[1]),approval.withdrawAmount);assert(BigInt(parsed.args[2])>0n);assert(parsed.args[6].length<=256);
  const value=BigInt(tx.value??0),chainId=BigInt(tx.chainId),nonce=BigInt(tx.nonce),gas=BigInt(tx.gas??tx.gasLimit??0),max=tx.maxFeePerGas==null?null:BigInt(tx.maxFeePerGas),priority=tx.maxPriorityFeePerGas==null?null:BigInt(tx.maxPriorityFeePerGas),price=tx.gasPrice==null?null:BigInt(tx.gasPrice);
  assert.equal(value,0n);assert.equal(chainId,31337n);assert(nonce>=0n&&nonce<=BigInt(Number.MAX_SAFE_INTEGER));assert(gas>0n&&(max??price)>0n&&gas*(max??price)<=BigInt(approval.refundGasCap));assert(max===null?priority===null:priority!==null&&priority>=0n&&priority<=max);assert(tx.accessList==null||tx.accessList.length===0);assert(tx.authorizationList==null||tx.authorizationList.length===0);
  const type=tx.type==null?(max===null?0n:2n):BigInt(tx.type);assert(type===(max===null?0n:2n));
  return {from,to,data,value:String(value),chainId:String(chainId),nonce:String(nonce),gas:String(gas),max:max===null?null:String(max),priority:priority===null?null:String(priority),price:price===null?null:String(price),type:String(type)};
 };
 return Object.freeze({
  observe(event){try{
   assert(event&&typeof event==='object'&&!Array.isArray(event));
   if(event.type==='denied'){exactKeys(event,['type']);counts.denied++;return;}
   if(event.type==='admit'){exactKeys(event,['type','transaction']);assert.equal(admitted,null);assert(Date.now()<approval.expiresAt);admitted=normalize(event.transaction);counts.providerSends++;return;}
   exactKeys(event,['type','hash']);assert.equal(event.type,'acknowledged');assert(admitted&&acknowledged===null);assert.match(event.hash,/^0x[0-9a-f]{64}$/);acknowledged=event.hash;
  }catch{reject();}},
  assertRequest(observed,ethereumUrl){
   const url=new URL(observed.url),ethereum=new URL(ethereumUrl);
   if(observed.method!=='POST'||url.origin!==ethereum.origin||url.pathname!==ethereum.pathname)return assertMetaMaskReadinessRequest(observed,ethereumUrl);
   let body;try{body=JSON.parse(observed.body);}catch{reject();}
   const batch=Array.isArray(body)?body:[body];
   if(!batch.some(r=>['eth_sendTransaction','eth_sendRawTransaction'].includes(r?.method)))return assertMetaMaskReadinessRequest(observed,ethereumUrl);
   try{assert.equal(batch.length,1);const rpc=batch[0];assert.equal(rpc.params?.length,1);assert(admitted&&counts.outerSends===0);assert(Date.now()<approval.expiresAt);
    const tx=rpc.method==='eth_sendRawTransaction'?Transaction.from(rpc.params[0]):rpc.params[0];assert.deepEqual(normalize(tx),admitted);if(rpc.method==='eth_sendRawTransaction'){assert(tx.isSigned());if(acknowledged)assert.equal(tx.hash,acknowledged);}counts.outerSends++;
   }catch{reject();}
  },
  snapshot(){return {...counts,acknowledged:acknowledged!==null};},
  finish(){assert.equal(counts.denied,0,'A forbidden refund wallet or outer request occurred');assert.equal(counts.providerSends,1);assert(counts.outerSends<=1);assert.match(acknowledged??'',/^0x[0-9a-f]{64}$/);return {...counts,acknowledged:true};}
 });
}
