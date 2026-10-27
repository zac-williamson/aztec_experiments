import {observeRollingSetup,rollingSetupErrorCode} from './deployment.mjs';
// Thin composition of the existing quote, custody and Ethereum journal APIs.
// Only the owning private session calls this capability, under its account lock.
export const FUNDING_PREPARATION_STAGES = Object.freeze([
 'allocation', 'qualification', 'journal', 'wallet', 'nonce', 'secrets', 'quote', 'save',
]);
export async function timeFundingPreparation(observer, step, operation) {
 const start = performance.now();
 try {
  const result = await operation();
  observeRollingSetup(observer, {stage:'funding-preparation', step, state:'complete', start,
   timeOrigin:performance.timeOrigin, duration:performance.now()-start});
  return result;
 } catch (error) {
  observeRollingSetup(observer, {stage:'funding-preparation', step, state:'failed', start,
   timeOrigin:performance.timeOrigin, duration:performance.now()-start, code:rollingSetupErrorCode(error)});
  throw error;
 } finally {
  // Fixed stage labels only; timing never changes funding or error handling.
  if(FUNDING_PREPARATION_STAGES.includes(step))try{
   const name='rolling.funding-preparation.'+step;performance.clearMeasures(name);
   performance.measure(name,{start,end:performance.now()});
  }catch{}
 }
}
const fail=code=>Object.assign(Error('Funding is unavailable. Preserve saved recovery records.'),{code:'ROLLING_FUNDING_'+code});
const check=(value,code='INVALID')=>{if(!value)throw fail(code);};
const errorValue=(error,key)=>{try{const d=error!=null?Object.getOwnPropertyDescriptor(error,key):null;return d&&'value'in d?d.value:undefined;}catch{return undefined;}};
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// Product defaults, derived from the authenticated deployment, not form inputs.
// Exact router gas can only be estimated after the user's consent signature.
// This conservative 5m-unit ceiling covers three bridge legs and swaps; confirm
// still estimates the real transaction and refuses to exceed the reviewed cap.
export async function starterFundingAllocation({asset,minDeposit,privateFeeCap,provider}){
 check(['ETH','USDC'].includes(asset),'INVALID');
 for(const value of [minDeposit,privateFeeCap])check(typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value),'INVALID');
 const allocation={asset,collateralWei:minDeposit,feeAmount:(BigInt(privateFeeCap)*2n).toString(),bokAmount:'0',feePoolFee:3000,slippageBps:100,privateFeeCap};
 if(asset==='USDC')return {...allocation,collateralPoolFee:3000};
 return {...allocation,bokPoolFee:0,gasBudgetWei:await automaticFundingGasBudget(provider)};
}
export async function automaticFundingGasBudget(provider){
 const fees=await provider.getFeeData(),price=fees.maxFeePerGas??fees.gasPrice;
 check(typeof price==='bigint'&&price>0n,'GAS_UNAVAILABLE');
 return (5000000n*price).toString();
}
export const AGGREGATE_SCOPE_KEYS=Object.freeze(['chainId','router','routerCodeHash','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','quoter','quoterCodeHash']);
export const AGGREGATE_USDC_SCOPE_KEYS=Object.freeze([...AGGREGATE_SCOPE_KEYS,'usdcCodeHash','usdcImplementation','usdcImplementationCodeHash','usdcDomain','usdcRelayAddress']);
export function aggregateWalletScope(scope,network,board,owner){
 return JSON.stringify(['ROLLING_AGGREGATE_FUNDING_V1',network.chainId,network.version,network.rollup,board,scope.router,owner,1]);
}
export async function createAggregateWallet({sdk,ethers,scope,network,board,bok,owner,walletSecret,walletSalt,storage,provider,captureWallet,contextGuard,verifyScope,verifyFeeCredit,reconcileClaim,verifyClaim,claimStore,relay,onProgress}){
 const captured=freeze(clone(scope)),n=freeze(clone(network));
 const usdc=captured?.usdcRelayAddress!==undefined;
 check(captured&&Object.keys(captured).sort().join()===Array.from(usdc?AGGREGATE_USDC_SCOPE_KEYS:AGGREGATE_SCOPE_KEYS).sort().join());
 const s=freeze(Object.fromEntries(AGGREGATE_SCOPE_KEYS.map(key=>[key,captured[key]])));
 const usdcScope=usdc?freeze(Object.fromEntries(Object.entries(captured).filter(([key])=>key!=='usdcRelayAddress'))):null;
 check(s.chainId===n.chainId&&typeof captureWallet==='function'&&typeof verifyScope==='function');
 const scopeText=aggregateWalletScope(s,n,board,owner);
 const openSlot=text=>sdk.createEncryptedJournalSlot({storage,walletSecret,walletSalt,scopeText:text,keyDomain:'ROLLING_AGGREGATE_FUNDING_V1'});
 const slot=await openSlot(scopeText);
 const archiveSlot=txHash=>{check(typeof txHash==='string'&&/^0x[0-9a-f]{64}$/.test(txHash));const frame=JSON.parse(scopeText);frame.splice(-1,0,txHash);return openSlot(JSON.stringify(frame));};
 let prepared=null,pendingJournal=null;
 const readOnlyQuotes=new WeakMap();
 const read=async fn=>{await contextGuard();const result=await fn();await contextGuard();return result;};
 // A refused signature has no broadcast ambiguity. Normalize it only at
 // this signing boundary; transaction/relay failures keep their journal fences.
 async function signConsent(wallet,typed){
  let signature;
  try{signature=await read(()=>wallet.signer.signTypedData(typed.domain,typed.types,typed.value));}
  catch(error){
   if([4001,'ACTION_REJECTED'].includes(errorValue(error,'code'))){await read(wallet.guard);throw fail('SIGNATURE_CANCELLED');}
   throw error;
  }
  check(ethers.verifyTypedData(typed.domain,typed.types,typed.value,signature).toLowerCase()===wallet.address,'CONSENT');
  await read(wallet.guard);return signature;
 }
 const journal=depositor=>sdk.createEthereumJournal({storage,walletSecret,walletSalt,
  scope:{account:owner,...n,board,portal:s.router,depositor},provider,contextGuard});
 async function stored(){const saved=await read(()=>slot.read());if(saved.value){check(saved.value.schemaVersion===1&&typeof saved.value.depositor==='string');if(saved.value.bokScope!==null)check(saved.value.bokScope?.recipient===bok&&saved.value.bokScope?.portal===s.bokPortal);}return saved;}
 function original(saved,request){
  const value=saved.value;check(value?.intent,'RECOVERY_REQUIRED');
  for(const key of ['from','to','chainId','nonce','data','value'])check(value.intent[key]===request[key],'MISMATCH');
  check(JSON.stringify(value.intent.expected)===JSON.stringify(request.expected),'MISMATCH');
  sdk.validateAggregateFundingIntent(request);return value;
 }
 function receipts(result){
  check(result.outcome==='success'&&result.event,'PENDING');
  const base={txHash:result.txHash,blockHash:result.receipt.blockHash.toLowerCase(),blockNumber:result.receipt.blockNumber,
   sender:result.request.from,nonce:String(result.request.nonce)};
  const leg=name=>{const {amount,secretHash,messageKey,leafIndex}=result.event[name];return {...base,amount:String(amount),secretHash,messageKey,leafIndex:String(leafIndex)};};
  return result.event.collateral?freeze({receipt:leg('collateral'),feeReceipt:leg('privateFee'),...(result.event.bok?{bokReceipt:leg('bok')}:{})}):freeze({receipt:leg('privateFee')});
 }
 async function reconcile(txHash,allowReverted=false){
  const saved=await stored();if(saved.value?.kind==='usdc')return reconcileUsdc(saved,txHash,undefined,allowReverted);check(saved.value?.intent,'RECOVERY_REQUIRED');
  const result=await read(async()=> (await journal(saved.value.depositor)).recover({retry:false}));
  original(saved,result.request);if(txHash!==undefined)check(result.txHash===txHash,'MISMATCH');
  check(result.outcome==='success'||allowReverted&&result.outcome==='reverted',result.outcome==='reverted'?'REVERTED':'PENDING');return {saved,result};
 }
 async function terminalPayment(result){
  check(result&&['success','reverted'].includes(result.outcome),'RECOVERY_REQUIRED');
  if(result.outcome==='reverted'){
   const network=await read(()=>provider.getNetwork());check(String(network.chainId)===n.chainId,'MISMATCH');
  }
  const current=await read(()=>provider.getBlock(result.receipt.blockNumber));
  check(current?.hash?.toLowerCase()===result.receipt.blockHash.toLowerCase(),'MISMATCH');
  return result;
 }
 // Completion outlives the single active application workflow. Its original
 // canonical L2 hash remains mandatory before a successor payment.
 async function completedClaim(value){
  const confirmed=value.confirmedClaim;
  check(value.claim?.attempted&&confirmed&&typeof verifyClaim==='function','RECOVERY_REQUIRED');
  check(confirmed.intentId===value.claim.intentId&&/^0x[0-9a-f]{64}$/.test(confirmed.txHash),'MISMATCH');
  await read(()=>verifyClaim(confirmed.txHash));
 }
 function sameReceipts(action,original){
  const feeOnly=original.feeReceipt===undefined;
  return action?.type===(feeOnly?'claim-private-fee':'claim-deposit')&&(feeOnly?['receipt']:['receipt','feeReceipt','bokReceipt']).every(key=>{
   const a=action[key],b=original[key];if(a===undefined||b===undefined)return key==='bokReceipt'&&a===b;return a&&Object.keys(a).sort().join()===Object.keys(b).sort().join()&&Object.keys(b).every(field=>a[field]===b[field]);
  });
 }
 async function predecessor(value){
  if(!value?.previousTxHash)return null;
  const saved=await read(async()=>(await archiveSlot(value.previousTxHash)).read()),old=saved.value;
  check(old?.txHash===value.previousTxHash&&old.confirmedRequest,'MISMATCH');original(saved,old.confirmedRequest);
  const result=await read(()=>sdk.verifyEthereumIntentReceipt(provider,old.confirmedRequest,old.txHash));
  check(result?.outcome===(old.paymentOutcome??'success'),'RECOVERY_REQUIRED');
  check(result&&['success','reverted'].includes(result.outcome),'RECOVERY_REQUIRED');
  // This exact verifier just checked the successful aggregate receipt's
  // canonical block after all effect reads. No result is retained across calls.
  // Reverted outcomes retain their separate network/terminal qualification.
  if(result.outcome==='reverted')await terminalPayment({...result,request:old.confirmedRequest});
  if(result.outcome==='success')await completedClaim(old);
  return {...result,request:old.confirmedRequest};
 }
 async function archivePrevious(previous){
  if(!previous.value?.intent&&!previous.value?.relay?.submitted)return predecessor(previous.value);
  const {result}=await reconcile(undefined,true);await terminalPayment(result);
  if(result.outcome==='success')await completedClaim(previous.value);
  const archive=await archiveSlot(result.txHash),old=await read(()=>archive.read());
  const retained={...previous.value,intent:clone(result.request),confirmedRequest:clone(result.request),txHash:result.txHash,paymentOutcome:result.outcome};
  if(old.value===null)await read(()=>archive.write(old,retained));
  else check(JSON.stringify(old.value.intent)===JSON.stringify(retained.intent),'MISMATCH');
  return result;
 }
 async function bokCustody(amount){
  if(BigInt(amount)===0n)return {recipientSalt:null,bridgeSecret:null,bokScope:null,bokSecretHash:new sdk.Fr(0n).toString(),bokCommitment:new sdk.Fr(0n).toString()};
  check(typeof bok==='string','UNAVAILABLE');
  const recipientSalt=sdk.Fr.random().toString(),bridgeSecret=sdk.Fr.random().toString();
  const bokSecretHash=(await read(()=>sdk.computeSecretHash(sdk.Fr.fromString(bridgeSecret)))).toString();
  const bokCommitment=(await read(()=>sdk.poseidon2HashWithSeparator([new sdk.Fr(BigInt(n.chainId)),new sdk.Fr(BigInt(s.bokPortal)),sdk.Fr.fromString(bok),new sdk.Fr(BigInt(n.version)),sdk.Fr.fromString(owner),sdk.Fr.fromString(recipientSalt)],0x424b4301))).toString();
  return {recipientSalt,bridgeSecret,bokScope:{...n,portal:s.bokPortal,recipient:bok,token:s.bokToken},bokSecretHash,bokCommitment};
 }
 async function prepareUsdc(values,recheckScope){
  check(usdc&&relay&&claimStore&&typeof claimStore.save==='function','UNAVAILABLE');
  check(Object.keys(values).sort().join()==='asset,bokAmount,collateralPoolFee,collateralWei,feeAmount,feePoolFee,privateFeeCap,slippageBps');
  const previous=await stored(),priorPayment=await archivePrevious(previous);
  check(typeof values.privateFeeCap==='string'&&/^[1-9][0-9]{0,76}$/.test(values.privateFeeCap));
  const wallet=await read(captureWallet);await read(wallet.guard);
  const terms=await read(()=>relay.terms());
  check(terms&&Object.keys(terms).sort().join()==='feeUsdc,gasBudgetWei,relayer'&&terms.relayer===captured.usdcRelayAddress,'RELAY_SCOPE');
  for(const key of ['feeUsdc','gasBudgetWei'])check(typeof terms[key]==='string'&&/^[1-9][0-9]{0,77}$/.test(terms[key]),'RELAY_SCOPE');
  const collateralSecret=sdk.Fr.random(),privateFeeSalt=sdk.Fr.random();
  const collateralSecretHash=values.collateralWei==='0'?'0x'+'0'.repeat(64):(await read(()=>sdk.computeSecretHash(collateralSecret))).toString();
  const feeSecret=await read(()=>sdk.derivePrivateFeeBridgeSecret({salt:privateFeeSalt,owner}));
  const feeSecretHash=(await read(()=>sdk.computeSecretHash(feeSecret))).toString();
  const {recipientSalt,bridgeSecret,bokScope,bokSecretHash,bokCommitment}=await bokCustody(values.bokAmount);
  const {privateFeeCap,...amounts}=values;
  const quote=await read(()=>sdk.prepareAggregateUsdcFunding({scope:usdcScope,allocation:{...amounts,collateralSecretHash,feeSecretHash,bokCommitment,bokSecretHash,authorizationSalt:sdk.Fr.random().toString()},wallet:{address:wallet.address,chainId:n.chainId,canSignTypedData:true},relay:{address:terms.relayer,feeUsdc:terms.feeUsdc,gasBudgetWei:terms.gasBudgetWei}},
   {provider:{request:({method,params})=>read(()=>provider.send(method,params))}}));
  await read(wallet.guard);
  // Random collateral custody is persisted using the original beneficiary
  // scope. No relayer or collateral-consent nonce derives any user secret.
  if(values.collateralWei!=='0')await read(()=>claimStore.save({l1ChainId:n.chainId,rollupVersion:n.version,rollupAddress:n.rollup,boardAddress:board,portalAddress:s.collateralPortal,depositor:wallet.address},{schemaVersion:1,secret:collateralSecret.toString(),secretHash:collateralSecretHash}));
  const saved=await read(()=>slot.write(previous,{schemaVersion:1,kind:'usdc',...(values.collateralWei==='0'?{feeOnly:true,amount:values.feeAmount,asset:values.asset}:{}),depositor:wallet.address,recipientSalt,bridgeSecret,bokScope,privateFeeCap,claim:null,intent:null,previousTxHash:priorPayment?.txHash??null,
   aggregateCustody:{kind:'aggregate-usdc-custody-v1',planHash:quote.planHash,beneficiary:wallet.address,privateFeeSalt:privateFeeSalt.toString()},relay:{planHash:quote.planHash,submitted:false,request:null}}));
  prepared={kind:'usdc',wallet,quote,saved,recheckScope,feeAmount:values.feeAmount};
  return freeze({kind:quote.kind,breakdown:clone(quote.breakdown),deadline:quote.plan.deadline,beneficiary:wallet.address,router:s.router,walletName:wallet.name,privateFeeCap,slippageBps:values.slippageBps,relayer:terms.relayer,relayGasBudgetWei:terms.gasBudgetWei});
 }
 async function confirmUsdc({wallet,quote,saved,recheckScope,feeAmount},onSubmitted){
  await read(wallet.guard);await read(()=>verifyFeeCredit(feeAmount));await read(()=>sdk.validateAggregateFundingQuote(quote));
  const consent=(quote.plan.collateral?.amount??quote.plan.collateral)==='0'?'0x':await signConsent(wallet,quote.consent);
  await read(()=>sdk.validateAggregateFundingQuote(quote));
  const authorization=await signConsent(wallet,quote.authorization);
  await read(recheckScope);
  const tx=await read(()=>sdk.aggregateUsdcFundingTransaction(quote,consent,authorization));
  const request={from:tx.from,to:tx.to,chainId:tx.chainId,data:tx.data.toLowerCase(),value:tx.value,expected:{kind:'aggregate-usdc-funding',routerCodeHash:s.routerCodeHash,collateralPortal:s.collateralPortal,feePortal:s.feePortal,bokPortal:s.bokPortal,privateFpc:s.privateFpc,planHash:tx.planHash}};
  sdk.validateAggregateFundingIntent(request);await read(wallet.guard);await predecessor(saved.value);
  // This checkpoint is deliberately before the sole POST. Even a crash before
  // the request reaches the relay is status-only recovery, never an auto-retry.
  await read(()=>verifyFeeCredit(feeAmount));
  await read(()=>sdk.validateAggregateFundingQuote(quote));
  const start=await read(()=>provider.getBlock('latest'));check(Number.isSafeInteger(start?.number)&&start.number>=0,'PENDING');
  await read(()=>slot.write(saved,{...saved.value,relay:{planHash:tx.planHash,submitted:true,request,startBlock:start.number}}));
  await read(wallet.guard);
  let state;try{state=await read(()=>relay.submit(request.data));}catch{state=await read(()=>relay.status(tx.planHash));}
  const acknowledged=await rememberRelayState(await stored(),state);
  // Only a validated, durably retained relay hash acknowledges Ethereum submission.
  if(acknowledged.value.relay.transactionHash)try{void Promise.resolve(onSubmitted?.()).catch(()=>{});}catch{}
  return {pending:true};
 }
 async function rememberRelayState(saved,state){
  const value=saved.value;
  check(state&&state.scope==='aggregate-funding'&&state.planHash===value.relay.planHash&&['absent','unresolved','succeeded','failed'].includes(state.status)&&typeof state.canonical==='boolean','RELAY_SCOPE');
  const hash=state.transactionHash;
  if(hash===undefined)return saved;
  check(typeof hash==='string'&&/^0x[0-9a-f]{64}$/.test(hash)&&state.status!=='absent','RELAY_SCOPE');
  check(value.relay.transactionHash===undefined||value.relay.transactionHash===hash,'MISMATCH');
  // A relay hash is only a lookup hint. Receipt recovery still verifies the
  // exact signed request, event effects and canonical Ethereum block.
  return value.relay.transactionHash===hash?saved:read(()=>slot.write(saved,{...value,relay:{...value.relay,transactionHash:hash}}));
 }
 async function reconcileUsdc(saved,requiredHash,lookupHash,allowReverted=false){
  let value=saved.value;check(value.relay?.submitted&&value.relay.request,'RECOVERY_REQUIRED');
  const request=value.relay.request;sdk.validateAggregateFundingIntent(request);
  let hash=lookupHash??value.relay.transactionHash;
  if(hash===undefined){
   const state=await read(()=>relay.status(value.relay.planHash));
   saved=await rememberRelayState(saved,state);
   value=saved.value;hash=value.relay.transactionHash;
  }
  check(typeof hash==='string'&&/^0x[0-9a-f]{64}$/.test(hash),'PENDING');
  if(requiredHash!==undefined)check(requiredHash===hash,'MISMATCH');
  const network=await read(()=>provider.getNetwork());check(String(network.chainId)===n.chainId,'MISMATCH');
  const tx=await read(()=>provider.getTransaction(hash));
  if(lookupHash!==undefined&&(!tx||tx.hash?.toLowerCase()!==hash||tx.from?.toLowerCase()!==request.from||tx.to?.toLowerCase()!==request.to||tx.data?.toLowerCase()!==request.data||String(tx.chainId)!==request.chainId||String(tx.value)!==request.value))return null;
  check(tx&&tx.hash?.toLowerCase()===hash&&Number.isSafeInteger(tx.nonce)&&tx.nonce>=0,'PENDING');
  const intent={...request,nonce:tx.nonce};
  // The nonce lookup already returned this exact hash. Detach only immutable
  // transaction fields for this verification; receipt, code and canonical block
  // remain fresh and the ordinary verifier still checks the complete request.
  const transaction=Object.freeze(Object.fromEntries(['hash','from','to','nonce','chainId','data','value'].map(key=>[key,tx[key]])));
  const receiptProvider={
   getTransaction:async requested=>{check(requested===hash,'MISMATCH');return transaction;},
   ...Object.fromEntries(['getTransactionReceipt','getBlock','getCode'].map(name=>[name,provider[name].bind(provider)])),
  };
  const verified=await read(()=>sdk.verifyEthereumIntentReceipt(receiptProvider,intent,hash,read));
  if(verified&&verified.outcome!=='success'&&!(allowReverted&&verified.outcome==='reverted'))throw fail(verified.outcome==='reverted'?'REVERTED':'MISMATCH');
  check(verified,'PENDING');
  if(value.intent)original(saved,intent);
  if(verified.outcome==='success'&&!allowReverted&&(!value.intent||value.relay.transactionHash!==hash))await read(()=>slot.write(saved,{...value,intent,relay:{...value.relay,transactionHash:hash}}));
  return {saved,result:{...verified,request:intent}};
 }
 function unsignedQuote(value){
  if(value===null)return true;
  // Only the exact current-format unsigned ETH draft may be replaced here.
  // Signed/submitted, inherited payments and uncertain records keep the normal
  // explicit reconciliation path. Ethereum journal emptiness is checked again
  // under the common funding lease immediately before the exact custody CAS.
  return value&&Object.keys(value).sort().join()==='bokScope,bridgeSecret,claim,depositor,intent,nonce,previousTxHash,privateFeeCap,recipientSalt,schemaVersion'&&
   value.schemaVersion===1&&/^0x[0-9a-f]{40}$/.test(value.depositor)&&Number.isSafeInteger(value.nonce)&&value.nonce>=0&&
   typeof value.privateFeeCap==='string'&&/^[1-9][0-9]{0,76}$/.test(value.privateFeeCap)&&
   ['bokScope','bridgeSecret','claim','intent','previousTxHash','recipientSalt'].every(key=>value[key]===null);
 }
 async function qualify(values){
   check(typeof verifyFeeCredit==='function','UNAVAILABLE');check(typeof values.bokAmount==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(values.bokAmount),'INVALID');
   return timeFundingPreparation(onProgress,'qualification',async()=>{
   const qualification=await Promise.allSettled([
    ()=>read(()=>verifyFeeCredit(values.feeAmount)),
    ()=>read(()=>verifyScope({includeBok:BigInt(values.bokAmount)>0n,asset:values.asset})),
   ].map(qualify=>Promise.resolve().then(qualify)));
   const failure=qualification.find(result=>result.status==='rejected');if(failure)throw failure.reason;
   const recheckScope=qualification[1].value;check(typeof recheckScope==='function');return recheckScope;
   });
 }
 async function captureEthInputs(){
   const wallet=await timeFundingPreparation(onProgress,'wallet',()=>read(captureWallet));
   const nonce=await timeFundingPreparation(onProgress,'nonce',()=>read(()=>provider.getTransactionCount(wallet.address,'pending')));
   check(Number.isSafeInteger(nonce)&&nonce>=0);
   return {wallet,nonce};
 }
 async function constructEth(values,previous,priorPayment,readOnly=false,capturedInputs){
   // Production capture resolves only after checking the live wallet and chain.
   const wallet=capturedInputs?.wallet??await timeFundingPreparation(onProgress,'wallet',()=>read(captureWallet));
   const depositor=wallet.address;
   const existing=readOnly?null:await read(async()=> (await journal(depositor)).inspectSummary());
   check(existing===null||priorPayment&&existing.txHash===priorPayment.txHash&&existing.outcome===priorPayment.outcome,'RECOVERY_REQUIRED');
   // Unsigned custody may belong to an earlier selected Ethereum wallet. Do
   // not hide its outstanding journal when preparing a replacement directly.
   if(!readOnly&&unsignedQuote(previous.value)&&previous.value?.depositor&&previous.value.depositor!==depositor)
    check(await read(async()=> (await journal(previous.value.depositor)).inspectSummary())===null,'RECOVERY_REQUIRED');
   let nonce=capturedInputs?.nonce??await timeFundingPreparation(onProgress,'nonce',()=>read(()=>provider.getTransactionCount(depositor,'pending')));if(priorPayment?.request.from===depositor)nonce=Math.max(nonce,priorPayment.request.nonce+1);check(Number.isSafeInteger(nonce)&&nonce>=0);
   const {collateral,fee,recipientSalt,bridgeSecret,bokScope,bokSecretHash,bokCommitment}=await timeFundingPreparation(onProgress,'secrets',async()=>{
   const collateral=values.collateralWei==='0'?{secretHash:'0x'+'0'.repeat(64)}:await read(()=>sdk.deriveBoardDepositSecret({walletSecret,walletSalt,owner,
    scope:{l1ChainId:n.chainId,rollupVersion:n.version,rollupAddress:n.rollup,boardAddress:board,portalAddress:s.collateralPortal,depositor},nonce}));
   const fee=await read(()=>sdk.claimSecrets({walletSecret,owner,record:{chainId:n.chainId,version:n.version,privateFeeAddress:s.privateFpc,sender:depositor,nonce}}));
   const bok=await bokCustody(values.bokAmount);return {collateral,fee,...bok};
   });
   check(Object.keys(values).sort().join()==='asset,bokAmount,bokPoolFee,collateralWei,feeAmount,feePoolFee,gasBudgetWei,privateFeeCap,slippageBps');
   const {gasBudgetWei,privateFeeCap,...amounts}=values;check(typeof privateFeeCap==='string'&&/^[1-9][0-9]{0,76}$/.test(privateFeeCap));
   const quote=await timeFundingPreparation(onProgress,'quote',()=>read(()=>sdk.prepareAggregateFunding({scope:s,allocation:{...amounts,collateralSecretHash:collateral.secretHash,feeSecretHash:fee.secretHash.toString(),bokCommitment,bokSecretHash},
    wallet:{address:depositor,chainId:n.chainId,canSendTransaction:true,canSignTypedData:true,gasBudgetWei}},
    {provider:{request:({method,params})=>read(()=>provider.send(method,params))}})));
   await read(wallet.guard);
   return {values,previous,wallet,depositor,existing,nonce,recipientSalt,bridgeSecret,bokScope,privateFeeCap,quote};
 }
 async function installEth(candidate){
   const {values,recheckScope,previous,wallet,depositor,existing,nonce,recipientSalt,bridgeSecret,bokScope,privateFeeCap,quote}=candidate;
   const saved=await timeFundingPreparation(onProgress,'save',()=>read(()=>slot.write(previous,{schemaVersion:1,...(values.collateralWei==='0'?{feeOnly:true,amount:values.feeAmount,asset:values.asset}:{}),depositor,nonce,recipientSalt,bridgeSecret,bokScope,intent:null,privateFeeCap,claim:null,previousTxHash:existing?.txHash??null})));
   prepared={wallet,quote,saved,nonce,recheckScope,feeAmount:values.feeAmount};
   // Never return the original secrets or calldata to the renderer.
   return freeze({kind:quote.kind,breakdown:clone(quote.breakdown),deadline:quote.plan.deadline,beneficiary:depositor,router:s.router,
    walletName:wallet.name,privateFeeCap,slippageBps:values.slippageBps,consentNonce:quote.plan.nonce,ethereumNonce:nonce});
 }
 return Object.freeze({
  async prepare(allocation){
   const values=clone(allocation);prepared=null;
   if(values.asset==='USDC')return prepareUsdc(values,await qualify(values));
   // Wallet identity and the pending nonce do not depend on fee/scope reads.
   // Drain both branches before any journal inspection or archive/custody write.
   const reads=await Promise.allSettled([
    ()=>qualify(values),()=>captureEthInputs(),
   ].map(read=>Promise.resolve().then(read)));
   const failure=reads.find(result=>result.status==='rejected');if(failure)throw failure.reason;
   await contextGuard();
   const recheckScope=reads[0].value,capturedInputs=reads[1].value;
   const {previous,priorPayment}=await timeFundingPreparation(onProgress,'journal',async()=>{const previous=await stored();return {previous,priorPayment:await archivePrevious(previous)};});
   return installEth({...await constructEth(values,previous,priorPayment,false,capturedInputs),recheckScope});
  },
  // Internal opening capability, never a renderer quote or payment authority.
  // Sent or uncertain custody takes the ordinary post-status preparation path.
  async prepareReadOnly(allocation){
   const values=clone(allocation);check(values.asset==='ETH'&&values.bokAmount==='0','INVALID');
   const previous=await stored();if(!unsignedQuote(previous.value))return null;
   // Quote construction only reads public Ethereum data. Its nonce and swap
   // reads do not depend on fee/scope admission; join both before issuing the
   // local token. Neither branch writes custody or requests a signature.
   const results=await Promise.allSettled([
    ()=>qualify(values),()=>constructEth(values,previous,null,true),
   ].map(read=>Promise.resolve().then(read)));
   const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
   await contextGuard();
   const candidate={...results[1].value,recheckScope:results[0].value};
   const token=Object.freeze({});readOnlyQuotes.set(token,candidate);return token;
  },
  async installPreparedQuote(token){
   const candidate=readOnlyQuotes.get(token);check(candidate,'QUOTE_REQUIRED');readOnlyQuotes.delete(token);
   const previous=await stored();check(previous.encoded===candidate.previous.encoded&&unsignedQuote(previous.value),'MISMATCH');
   // Waiting for native status grants no Ethereum freshness. Recheck the exact
   // wallet, derivation nonce and quote anchor/deadline before the custody CAS.
   const checks=await Promise.allSettled([
    ()=>read(candidate.wallet.guard),
    async()=>check(await read(()=>provider.getTransactionCount(candidate.depositor,'pending'))===candidate.nonce,'NONCE_CHANGED'),
    ()=>read(()=>sdk.validateAggregateFundingQuote(candidate.quote)),
    ...[...new Set([candidate.depositor,candidate.previous.value?.depositor].filter(Boolean))].map(depositor=>
     async()=>check(await read(async()=>(await journal(depositor)).inspectSummary())===null,'RECOVERY_REQUIRED')),
   ].map(check=>Promise.resolve().then(check)));
   for(const result of checks)if(result.status==='rejected')throw result.reason;
   await contextGuard();return installEth(candidate);
  },
  async confirm({onSubmitted}={}){
   const current=prepared;prepared=null;check(current,'QUOTE_REQUIRED');
   if(current.kind==='usdc')return confirmUsdc(current,onSubmitted);
   const {wallet,quote,nonce}=current;await read(wallet.guard);await read(()=>verifyFeeCredit(current.feeAmount));await read(()=>sdk.validateAggregateFundingQuote(quote));
   // Signature is requested only after explicit review. It is narrowly bound to
   // the captured portal consent nonce, which is NOT the derivation nonce.
   const consent=(quote.plan.collateral?.amount??quote.plan.collateral)==='0'?'0x':await signConsent(wallet,quote.consent);
   // The reviewed quote already authenticated the deployment. Recheck mutable
   // scope after consent, before any payment intent, rather than consuming the
   // short quote lifetime with native reads before the wallet even opens.
   await read(current.recheckScope);
   const tx=await read(()=>sdk.encodeAggregateFundingTransaction(quote,consent));
   const expected={kind:'aggregate-funding',routerCodeHash:s.routerCodeHash,collateralPortal:s.collateralPortal,feePortal:s.feePortal,bokPortal:s.bokPortal,privateFpc:s.privateFpc,planHash:tx.planHash};
   // The original journal estimates this exact signed request and doubles its
   // gas allowance. Its prepareRequest checks fresh fees and the reviewed budget
   // immediately before the sole broadcast; no earlier duplicate estimate.
   await read(wallet.guard);
   const j=await sdk.createEthereumJournal({storage,walletSecret,walletSalt,scope:{account:owner,...n,board,portal:s.router,depositor:wallet.address},provider,
    acknowledgeTx:current.saved.value.previousTxHash,signer:wallet.signer,onSubmitted,prepareRequest:async request=>{
     await wallet.guard();const fees=await read(()=>provider.getFeeData());await wallet.guard();
     const price=fees.maxFeePerGas??fees.gasPrice;check(typeof price==='bigint'&&price>0n&&typeof request.gasLimit==='bigint'&&request.gasLimit*price<=BigInt(quote.breakdown.gasBudgetWei),'GAS_CHANGED');
     const bounded=fees.maxFeePerGas!==null&&fees.maxFeePerGas!==undefined?{maxFeePerGas:price,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{gasPrice:price};
     await read(()=>sdk.validateAggregateFundingQuote(quote));
     await wallet.guard();return bounded;
    },contextGuard});
   let result;try{result=await read(()=>j.send(async ethereumNonce=>{
    await wallet.guard();check(ethereumNonce===nonce,'NONCE_CHANGED');await predecessor(current.saved.value);
    // Validate deadline again after any wallet consent interaction, before both
    // encrypted intent writes and the journal's one broadcast.
    await read(()=>verifyFeeCredit(current.feeAmount));
    const verified=await read(()=>sdk.aggregateFundingTransaction(quote,consent));
    check(['from','to','chainId','data','value','planHash'].every(key=>verified[key]===tx[key]),'MISMATCH');
    const intent={from:tx.from,to:tx.to,chainId:tx.chainId,nonce:ethereumNonce,data:tx.data.toLowerCase(),value:tx.value,expected};
    sdk.validateAggregateFundingIntent(intent);
    await slot.write(current.saved,{...current.saved.value,intent});await contextGuard();await wallet.guard();
    return {data:intent.data,value:intent.value,expected};
   },{waitForReceipt:false}));}catch(error){
    // Only the original journal's explicit first-attempt rollback proves a
    // cancelled/unfunded request was not broadcast. Unknown outcomes retain
    // every byte of the original recovery context.
    const descriptor=error==null?null:Object.getOwnPropertyDescriptor(error,'code');
    if(descriptor&&'value' in descriptor&&['BB_ETH_REQUEST_CANCELLED','BB_ETH_INSUFFICIENT_FUNDS','BB_ETH_PREFLIGHT_FAILED'].includes(descriptor.value)){
     try{const saved=await stored();check(saved.value?.intent?.nonce===nonce,'MISMATCH');await read(()=>slot.write(saved,current.saved.value));}
     catch(cleanup){throw new AggregateError([error,cleanup],'Funding cancellation recovery could not be saved.');}
    }
    throw error;
   }
   pendingJournal=j;original(await stored(),result.request);return result.outcome==='submitted'?{pending:true,txHash:result.txHash}:receipts(result);
  },
  async inspect(){const saved=await stored();return saved.value?freeze({paymentSaved:!!(saved.value.intent||saved.value.relay?.submitted),privateFeeCap:saved.value.privateFeeCap,claim:clone(saved.value.claim),explicitClaimReview:saved.value.explicitClaimReview===true,...(saved.value.feeOnly?{claimAction:'claim-private-fee',amount:saved.value.amount,asset:saved.value.asset,completed:!!saved.value.confirmedClaim,phase:'deposit'}:{})}):null;},
  async reviewRevertedClaim(){
   const saved=await stored();check(saved.value?.intent&&saved.value.claim&&typeof reconcileClaim==='function','RECOVERY_REQUIRED');
   const previous=await read(()=>reconcileClaim(saved.value.claim.intentId));check(previous.status==='reverted'&&saved.value.claim.attempted||previous.status==='cancelled','RECOVERY_REQUIRED');
   await read(()=>slot.write(saved,{...saved.value,claim:null,confirmedClaim:null,explicitClaimReview:true}));
  },
  async checkpointClaim(value){
   check(value&&Object.keys(value).sort().join()==='attempted,intentId'&&typeof value.intentId==='string'&&/^0x[0-9a-f]{64}$/.test(value.intentId)&&typeof value.attempted==='boolean');
   const saved=await stored();check(saved.value?.intent,'RECOVERY_REQUIRED');
   if(saved.value.claim)check(saved.value.claim.intentId===value.intentId&&(!saved.value.claim.attempted||value.attempted),'RECOVERY_REQUIRED');
   await read(()=>slot.write(saved,{...saved.value,claim:clone(value)}));
  },
  async checkpointSubmission(intentId,action){
   const saved=await stored();if(saved.value?.claim?.intentId!==intentId)return;
   const {result}=await reconcile();check(sameReceipts(action,receipts(result)),'MISMATCH');
   await read(()=>slot.write(saved,{...saved.value,claim:{intentId,attempted:true}}));
  },
  async recordClaimCompletion(result){
   if(!['included','confirmed'].includes(result?.status)||!['claim-deposit','claim-private-fee'].includes(result.action?.type))return;
   const reported=freeze(clone(result));
   const saved=await stored();if(saved.value?.claim?.intentId!==reported.intentId)return;
   check(saved.value.claim.attempted&&typeof reconcileClaim==='function'&&typeof verifyClaim==='function','RECOVERY_REQUIRED');
   // Successful aggregate reconciliation already checks the canonical L1 block
   // after every effect read. No async work intervenes before this result.
   const payment=await reconcile();
   // The trusted application reopens the exact signed journal and checks its
   // receipt canonically without reuse. Keep this L2 fence after payment reads.
   const original=await read(async()=>freeze(clone(await reconcileClaim(reported.intentId))));
   check(['included','confirmed'].includes(original.status)&&original.intentId===reported.intentId&&original.txHash===reported.txHash&&/^0x[0-9a-f]{64}$/.test(original.txHash),'MISMATCH');
   const expected=receipts(payment.result);check(sameReceipts(original.action,expected)&&sameReceipts(reported.action,expected),'MISMATCH');
   const confirmed=saved.value.confirmedClaim;
   if(confirmed)check(confirmed.intentId===original.intentId&&confirmed.txHash===original.txHash,'MISMATCH');
   await read(()=>slot.write(saved,{...saved.value,confirmedClaim:{intentId:original.intentId,txHash:original.txHash,status:original.status}}));
  },
  async recover({wait=false}={}){
   let recovered;
   try{recovered=await reconcile();}catch(error){
    if(!wait||!['ROLLING_FUNDING_PENDING','BB_ETH_RECOVERY_REQUIRED'].includes(errorValue(error,'code')))throw error;
    const saved=await stored();
    if(saved.value?.kind!=='usdc'){
     const j=pendingJournal??await journal(saved.value.depositor);
     const result=await read(()=>j.recover({retry:false,wait:true}));
     original(saved,result.request);check(result.outcome==='success',result.outcome==='reverted'?'REVERTED':'PENDING');
     recovered={saved,result};
    }else{
     const hash=saved.value.relay?.transactionHash,request=saved.value.relay?.request;
     if(!hash||!request)throw error;
     const tx=await read(()=>provider.getTransaction(hash));
     check(tx&&tx.hash?.toLowerCase()===hash&&tx.from?.toLowerCase()===request.from&&tx.to?.toLowerCase()===request.to&&tx.data?.toLowerCase()===request.data&&String(tx.chainId)===request.chainId&&String(tx.value)===request.value&&Number.isSafeInteger(tx.nonce)&&tx.nonce>=0&&typeof tx.replaceableTransaction==='function','PENDING');
     const startBlock=saved.value.relay.startBlock??tx.blockNumber;
     check(Number.isSafeInteger(startBlock)&&startBlock>=0,'PENDING');
     let completedHash=hash;
     try{await read(()=>tx.replaceableTransaction(startBlock).wait(1));}
     catch(cause){
      const code=errorValue(cause,'code');
      if(code==='TRANSACTION_REPLACED')completedHash=errorValue(errorValue(cause,'replacement'),'hash');
      else if(code!=='CALL_EXCEPTION')throw cause;
     }
     check(typeof completedHash==='string'&&/^0x[0-9a-f]{64}$/.test(completedHash),'MISMATCH');
     const completed=await read(()=>provider.getTransaction(completedHash));
     check(completed?.nonce===tx.nonce,'MISMATCH');
     recovered=await reconcileUsdc(await stored(),undefined,completedHash);
     check(recovered,'MISMATCH');
    }
   }
   return receipts(recovered.result);
  },
  async loadAggregate(txHash){
   check(typeof txHash==='string'&&/^0x[0-9a-f]{64}$/.test(txHash));
   const saved=await stored();let value=saved.value,result;
   if(value?.kind==='usdc'&&value.relay?.submitted){
    const request=value.relay.request;sdk.validateAggregateFundingIntent(request);
    const tx=await read(()=>provider.getTransaction(txHash));
    const matches=value.relay.transactionHash===txHash||tx?.hash?.toLowerCase()===txHash&&tx.from?.toLowerCase()===request.from&&tx.to?.toLowerCase()===request.to&&tx.data?.toLowerCase()===request.data&&String(tx.chainId)===request.chainId&&String(tx.value)===request.value;
    if(matches){const outcome=await reconcileUsdc(saved,undefined,txHash);if(outcome)result=outcome.result;}
   }else if(value?.intent){
    sdk.validateAggregateFundingIntent(value.intent);
    // The authenticated request identifies custody; reconcile below performs the
    // fresh receipt/effect/canonical validation before any secrets are returned.
    const request=await read(async()=> (await journal(value.depositor)).inspectRequest());
    let matches=request?.txHash===txHash;
    if(request?.txHash===null){
     const tx=await read(()=>provider.getTransaction(txHash));
     matches=!!tx&&tx.hash?.toLowerCase()===txHash&&tx.from?.toLowerCase()===value.intent.from&&Number(tx.nonce)===value.intent.nonce;
    }
    if(matches)result=(await reconcile(txHash)).result;
   }
   if(!result){
    const archive=await archiveSlot(txHash);value=(await read(()=>archive.read())).value;
    if(value===null)return null;
    check(value.txHash===txHash&&value.confirmedRequest,'MISMATCH');original({value},value.confirmedRequest);
    result=await read(()=>sdk.verifyEthereumIntentReceipt(provider,value.confirmedRequest,txHash));check(result?.outcome==='success','PENDING');
    result={...result,request:value.confirmedRequest};
   }
   return freeze({intent:clone(result.request),recipientSalt:value.recipientSalt,bridgeSecret:value.bridgeSecret,bokScope:clone(value.bokScope),...(value.aggregateCustody?{aggregateCustody:clone(value.aggregateCustody)}:{})});
  },
 });
}

const claimProgressCodes=new Set(['ROLLING_FUNDING_INVALID','ROLLING_FUNDING_PENDING','ROLLING_FUNDING_NOT_READY','ROLLING_FUNDING_RECOVERY_REQUIRED','ROLLING_FUNDING_MISMATCH','ROLLING_FUNDING_UNKNOWN','ROLLING_FUNDING_REORG','ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_ACTION','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','ROLLING_FEE_CHANGED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
function claimProgressCode(error){try{const d=error!=null?Object.getOwnPropertyDescriptor(error,'code'):null;return d&&Object.hasOwn(d,'value')&&claimProgressCodes.has(d.value)?d.value:rollingSetupErrorCode(error);}catch{return 'unknown';}}

/** Owned funding continuation. Journals remain authoritative; optional session
 * waiters observe exact saved identities and never authorize a second send. */
export async function advanceAggregateClaim({application,funding,contextGuard=async()=>{},onProgress=()=>{},waits,paused=()=>false}){
 const pause=()=>{if(paused())throw fail('PAUSED');};
 let step='inspect',observedFailure=false;
 const emit=(state,error,readStep=step)=>observeRollingSetup(onProgress,{stage:'funding-claim',step:readStep,deploymentStep:null,state,code:state==='failed'?claimProgressCode(error):null});
 const read=async(name,fn,span=name,deferFailure=false)=>{
  step=name;observedFailure=false;emit('started',undefined,name);let start;
  try{start=performance.now();}catch{}
  try{await contextGuard();pause();const value=await fn();await contextGuard();pause();emit('complete',undefined,name);return value;}
  catch(error){if(!deferFailure){observedFailure=true;emit('failed',error,name);}throw error;}
  finally{try{if(Number.isFinite(start))performance.measure('rolling.funding-claim.'+span,{start,end:performance.now()});}catch{}}
 };
 try{
 const saved=await read('inspect',()=>funding.inspect());check(saved?.paymentSaved,'RECOVERY_REQUIRED');const claimAction=saved.claimAction??'claim-deposit';check(['claim-deposit','claim-private-fee','claim-bok'].includes(claimAction));
 let next;
 if(saved.claim?.attempted){
  next=await read('reconcile',()=>application.reconcile(saved.claim.intentId));
  if(next.status==='prepared')return {state:'review-saved',intent:next};
 }else{
  let recoveryRead,workflowRead;
  if(claimAction==='claim-bok'&&!saved.claim&&saved.phase==='deposit'){
   // These journals are independent: Ethereum recovery owns new funding custody;
   // workflow inspection owns the prior Aztec intent and does not read custody.
   // Drain both before advancing, preserving recovery failure priority.
   [recoveryRead,workflowRead]=await Promise.allSettled([
    ()=>read('recover',()=>funding.recover({wait:!!waits}),'recover',true),
    ()=>read('account-status',()=>application.readFundingState(),'account-status',true),
   ].map(fn=>Promise.resolve().then(fn)));
  }
  const selectedRead=(name,result)=>{
   step=name;
   if(result.status==='rejected'){observedFailure=true;emit('failed',result.reason,name);throw result.reason;}
   return result.value;
  };
  let receipts;try{receipts=recoveryRead?selectedRead('recover',recoveryRead):await read('recover',()=>funding.recover({wait:!!waits}));}catch(error){const d=error==null?null:Object.getOwnPropertyDescriptor(error,'code');if(d&&'value' in d&&['ROLLING_FUNDING_PENDING','BB_ETH_RECOVERY_REQUIRED'].includes(d.value))return {state:'waiting',phase:'payment'};throw error;}
  if(receipts.approved===true)return {state:'review-payment'};
  if(saved.claim)next=await read('reconcile',()=>application.reconcile(saved.claim.intentId));
  else{
   try{
    const current=workflowRead?selectedRead('account-status',workflowRead):await read('account-status',()=>application.readFundingState());
    check(['ready','recovering'].includes(current?.status),'RECOVERY_REQUIRED');
    if(current.status==='recovering'){
     const action=current.intent?.action;
     const same=(a,b)=>a&&b&&Object.keys(a).sort().join()===Object.keys(b).sort().join()&&Object.keys(b).every(key=>a[key]===b[key]);
     check(action?.type===claimAction&&(claimAction==='claim-deposit'?['receipt','feeReceipt','bokReceipt']:['receipt']).every(key=>key==='bokReceipt'&&action[key]===undefined&&receipts[key]===undefined||same(action[key],receipts[key])),'RECOVERY_REQUIRED');
     next=current.intent;
    }else{
     // Recovered receipts already identify the exact incoming messages. Wait
     // for their native tree readiness before the expensive full preparation.
     // This is only scheduling: preparation still verifies native message
     // membership and root at a fresh anchor. Generic paths also recheck L1.
     if(waits?.bridge)await read('prepare',()=>waits.bridge(receipts),'bridge');
     try{next=await read('prepare',()=>application.prepare({type:claimAction,...receipts},{immediate:true}));}
     catch(error){
      if(errorValue(error,'code')!=='ROLLING_FUNDING_NOT_READY'||!waits||errorValue(error,'reason')!=='l2-delivery')throw error;
      await read('prepare',()=>waits.bridge(receipts,errorValue(error,'reason')),'bridge');
      next=await read('prepare',()=>application.prepare({type:claimAction,...receipts},{immediate:true}));
     }
    }
   }catch(error){const d=error==null?null:Object.getOwnPropertyDescriptor(error,'code');if(d&&'value' in d&&d.value==='ROLLING_FUNDING_NOT_READY')return {state:'waiting',phase:'bridge'};throw error;}
   await read('checkpoint',()=>funding.checkpointClaim({intentId:next.intentId,attempted:next.status!=='prepared'}));
  }
  if(next.status!=='prepared')await read('checkpoint',()=>funding.checkpointClaim({intentId:next.intentId,attempted:true}));
  else{
   if(saved.explicitClaimReview||typeof next.maximumFee!=='string'||BigInt(next.maximumFee)>BigInt(saved.privateFeeCap))return {state:'review',intent:next};
   await read('checkpoint',()=>funding.checkpointClaim({intentId:next.intentId,attempted:true}));
   try{next=await read('submit',()=>application.submitPrepared(next.intentId));}
   catch(error){
    if(!waits||errorValue(error,'code')==='ROLLING_FUNDING_PAUSED')throw error;
    const recovered=await read('reconcile',()=>application.reconcile(next.intentId));
    // Only an authoritative saved hash can continue a failed submission. A
    // failure before signing remains a failure, never permission to send again.
    if(!recovered.txHash)throw error;
    next=recovered;
   }
  }
 }
 if(!['included','confirmed','reverted','cancelled'].includes(next.status)&&next.txHash&&waits){
  await read('reconcile',()=>waits.claim(next.txHash));
  next=await read('reconcile',()=>application.reconcile(next.intentId));
 }
 if(['included','confirmed'].includes(next.status)&&funding.recordClaimCompletion)await read('checkpoint',()=>funding.recordClaimCompletion(next));
 return {state:next.status==='included'?'included':next.status==='confirmed'?'complete':next.status==='reverted'?'reverted':next.status==='cancelled'?'cancelled':'pending',intent:next};
 }catch(error){if(errorValue(error,'code')==='ROLLING_FUNDING_PAUSED')return {state:'paused'};if(!observedFailure)emit('failed',error);throw error;}
}

/** Direct token top-ups compose the original Ethereum journal and private claim
 * workflow. They never touch posting collateral or create a public L2 account. */
export async function createStandaloneTopupWallet({sdk,ethers,kind,network,board,owner,walletSecret,walletSalt,storage,provider,captureWallet,contextGuard,resolveScope,reconcileClaim,verifyClaim,swapScope,topupScope,operationScope}){
 check(['private-fee','bok'].includes(kind));const n=freeze(clone(network));topupScope=topupScope===undefined?undefined:freeze(clone(topupScope));let captured,prepared,claimContinuation;
 const read=async fn=>{await contextGuard();const value=await fn();await contextGuard();return value;};
 const together=async tasks=>{const results=await Promise.allSettled(tasks.map(task=>Promise.resolve().then(task)));const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;return results.map(result=>result.value);};
 const tokenAbi=new ethers.Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
 const portalAbi=new ethers.Interface(kind==='bok'?['function deposit(bytes32,uint128,bytes32)']:['function depositToAztecPublic(bytes32,uint256,bytes32)']);
 // Admission remains fresh at quote and payment boundaries. Once qualified,
 // the immutable captured binding is only the encrypted custody namespace;
 // reading that local journal does not require current portal admission.
 const owned=()=>{const operation=operationScope?.();check(operation===undefined||operation===null||typeof operation==='object','MISMATCH');return operation;};
 const checkEthereumNetwork=async()=>check(String((await read(()=>provider.getNetwork())).chainId)===n.chainId,'MISMATCH');
 async function qualifyScope(){
  await contextGuard();const operation=owned();
  const scope=freeze(clone(await read(resolveScope)));check(scope&&Object.keys(scope).sort().join()==='portal,recipient,token');
  for(const key of ['portal','token'])check(/^0x[0-9a-f]{40}$/.test(scope[key])&&BigInt(scope[key])>0n);
  check(/^0x[0-9a-f]{64}$/.test(scope.recipient)&&BigInt(scope.recipient)>0n);
  if(captured)check(JSON.stringify(scope)===JSON.stringify(captured),'MISMATCH');
  await checkEthereumNetwork();
  check(owned()===operation,'MISMATCH');captured??=scope;return captured;
 }
 async function slot(hash){await contextGuard();const scope=captured??await qualifyScope(),frame=['ROLLING_TOPUP_FUNDING_V1',n.chainId,n.version,n.rollup,board,owner,kind,scope.portal,scope.token,scope.recipient];if(hash!==undefined){check(/^0x[0-9a-f]{64}$/.test(hash));frame.push(hash);}frame.push(1);return sdk.createEncryptedJournalSlot({storage,walletSecret,walletSalt,scopeText:JSON.stringify(frame),keyDomain:'ROLLING_TOPUP_FUNDING_V1'});}
 async function stored(){const store=await slot(),saved=await read(()=>store.read());if(saved.value)check(saved.value.kind===kind&&saved.value.schemaVersion===1,'MISMATCH');return {store,saved};}
 function journalOptions(value){return {storage,walletSecret,walletSalt,scope:{account:owner,...n,board:captured.recipient,portal:value.purchaseRouter??(value.phase==='swap'?value.swapRouter:captured.portal),token:captured.token,depositor:value.depositor},provider,contextGuard};}
 async function verified(value,wait=false){
  check(value?.intent,'RECOVERY_REQUIRED');const j=await sdk.createEthereumJournal(journalOptions(value));let result;
  result=await read(()=>j.recover({retry:false,wait}));
  return verifiedResult(value,result);
 }
 async function verifiedResult(value,result){
  for(const key of ['from','to','chainId','nonce','data','value'])check(result.request[key]===value.intent[key],'MISMATCH');
  check(JSON.stringify(result.request.expected)===JSON.stringify(value.intent.expected),'MISMATCH');
  check(['success','reverted'].includes(result.outcome),'RECOVERY_REQUIRED');
  const block=await read(()=>provider.getBlock(result.receipt.blockNumber));check(block?.hash?.toLowerCase()===result.receipt.blockHash.toLowerCase(),'MISMATCH');return result;
 }
 function receiptResult(value,result){
  check(result.outcome==='success','REVERTED');if(value.phase==='approval')return {approved:true};if(value.phase==='swap')return {swapped:true};const e=result.event;
  return {receipt:{txHash:result.txHash,blockHash:result.receipt.blockHash.toLowerCase(),blockNumber:result.receipt.blockNumber,sender:result.request.from,nonce:String(result.request.nonce),amount:result.request.expected.amount,secretHash:result.request.expected.secretHash,messageKey:e.key,leafIndex:String(e.index)}};
 }
 async function completedClaim(value){
  check(value.claim?.attempted,'RECOVERY_REQUIRED');
  if(value.confirmedClaim){const confirmed=value.confirmedClaim;check(confirmed.intentId===value.claim.intentId&&/^0x[0-9a-f]{64}$/.test(confirmed.txHash)&&typeof verifyClaim==='function','MISMATCH');await read(()=>verifyClaim(confirmed.txHash));}
  else{check(typeof reconcileClaim==='function','RECOVERY_REQUIRED');check(['included','confirmed'].includes((await read(()=>reconcileClaim(value.claim.intentId))).status),'RECOVERY_REQUIRED');}
 }
 async function archived(hash){const store=await slot(hash),record=await read(()=>store.read());check(record.value?.txHash===hash&&record.value.intent,'MISMATCH');const result=await read(()=>sdk.verifyEthereumIntentReceipt(provider,record.value.intent,hash));check(result?.outcome===record.value.outcome,'MISMATCH');const block=await read(()=>provider.getBlock(result.receipt.blockNumber));check(block?.hash?.toLowerCase()===result.receipt.blockHash.toLowerCase(),'MISMATCH');return {value:record.value,result};}
 const cap={
  async prepare(input){
   prepared=null;check(input&&['amount,privateFeeCap','amount,gasBudgetWei,privateFeeCap','amount,asset,privateFeeCap','amount,asset,gasBudgetWei,privateFeeCap'].includes(Object.keys(input).sort().join()));
   const values=clone(input);values.asset??='USDC';check(['USDC','ETH'].includes(values.asset));
   check(values.asset!=='ETH'||kind==='bok'&&topupScope,'SWAP_UNAVAILABLE');
   for(const key of Object.keys(values).filter(key=>key!=='asset'))check(typeof values[key]==='string'&&/^[1-9][0-9]{0,76}$/.test(values[key]));check(BigInt(values.amount)<1n<<128n);
   await qualifyScope();const {store,saved}=await stored();let priorHash=saved.value?.previousTxHash??null,reuse=null;
   if(saved.value?.intent){
    const result=await verified(saved.value);priorHash=result.txHash;
    if(result.outcome==='success'&&['approval','swap'].includes(saved.value.phase)&&values.asset===(saved.value.asset??'USDC')&&values.amount===saved.value.amount&&values.privateFeeCap===saved.value.privateFeeCap){
     reuse=saved.value;
     if(saved.value.phase==='swap'){
      const archive=await slot(result.txHash),old=await read(()=>archive.read()),value={...saved.value,txHash:result.txHash,outcome:result.outcome};
      if(old.value===null)await read(()=>archive.write(old,value));else check(JSON.stringify(old.value.intent)===JSON.stringify(value.intent),'MISMATCH');
     }
    }else{
     if(result.outcome==='success'&&saved.value.phase==='deposit'){
      await completedClaim(saved.value);
     }
     const archive=await slot(result.txHash),old=await read(()=>archive.read()),value={...saved.value,txHash:result.txHash,outcome:result.outcome};
     if(old.value===null)await read(()=>archive.write(old,value));else check(JSON.stringify(old.value.intent)===JSON.stringify(value.intent),'MISMATCH');
    }
   }else if(priorHash)await archived(priorHash);
   const wallet=await read(captureWallet);await read(wallet.guard);if(reuse)check(wallet.address===reuse.depositor,'MISMATCH');
   // These independent reads share the held wallet operation; every sibling
   // finishes before any failure escapes the account lease.
   const [head,pendingNonce]=await together([()=>read(()=>provider.getBlock('latest')),()=>read(()=>provider.getTransactionCount(wallet.address,'pending'))]);
   check(Number.isSafeInteger(head?.number)&&/^0x[0-9a-f]{64}$/.test(head?.hash));check(Number.isSafeInteger(pendingNonce)&&pendingNonce>=0);
   const call=async(name,args)=>tokenAbi.decodeFunctionResult(name,await read(()=>provider.call({to:captured.token,data:tokenAbi.encodeFunctionData(name,args),blockTag:head.number})))[0];
   const atomic=values.asset==='ETH'&&!reuse;
   const tokenReads=atomic?[]:await Promise.allSettled([Promise.resolve().then(()=>call('balanceOf',[wallet.address])),Promise.resolve().then(()=>call('allowance',[wallet.address,captured.portal]))]);
   const failed=tokenReads.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   const [balance,allowance]=atomic?[0n,0n]:tokenReads.map(result=>result.value);
   const phase=atomic?'deposit':allowance<BigInt(values.amount)?'approval':'deposit';
   const exchanged=phase!=='swap'&&(reuse?.phase==='swap'||reuse?.exchanged===true);
   if(!atomic&&phase!=='swap')check(balance>=BigInt(values.amount),kind==='bok'?'TOKEN_BALANCE':'FEE_TOKEN_BALANCE');
   if(reuse?.phase==='approval')check(phase==='deposit','RECOVERY_REQUIRED');
   const j=await sdk.createEthereumJournal(journalOptions({depositor:wallet.address,phase,swapRouter:swapScope?.swapRouter,...(atomic?{purchaseRouter:topupScope.router}:{})})),existing=await read(()=>j.inspectSummary());
   // Swap and bridge use different destination journals. A previous completed
   // claim may leave a terminal record in either; its saved request still binds it.
   check(existing===null||['success','reverted'].includes(existing.outcome),'RECOVERY_REQUIRED');
   if(existing&&existing.txHash!==priorHash){
    const previous=await archived(existing.txHash);
    if(previous.result.outcome==='success'&&previous.value.phase==='deposit')await completedClaim(previous.value);
   }
   let nonce=pendingNonce;if(saved.value?.intent&&saved.value.depositor===wallet.address)nonce=Math.max(nonce,saved.value.intent.nonce+1);
   let recipientSalt=reuse?.recipientSalt??sdk.Fr.random().toString(),bridgeSecret=reuse?.bridgeSecret??sdk.Fr.random().toString(),recipient= captured.recipient,secretHash;
   if(kind==='bok'){
    const [secret,commitment]=await together([()=>read(()=>sdk.computeSecretHash(sdk.Fr.fromString(bridgeSecret))),()=>read(()=>sdk.poseidon2HashWithSeparator([new sdk.Fr(BigInt(n.chainId)),new sdk.Fr(BigInt(captured.portal)),sdk.Fr.fromString(captured.recipient),new sdk.Fr(BigInt(n.version)),sdk.Fr.fromString(owner),sdk.Fr.fromString(recipientSalt)],0x424b4301))]);
    secretHash=secret.toString();recipient=commitment.toString();
   }else secretHash=(await read(()=>sdk.claimSecrets({walletSecret,owner,record:{...n,privateFeeAddress:captured.recipient,sender:wallet.address,nonce}}))).secretHash.toString();
   const data=phase==='approval'?tokenAbi.encodeFunctionData('approve',[captured.portal,values.amount]):portalAbi.encodeFunctionData(kind==='bok'?'deposit':'depositToAztecPublic',[recipient,values.amount,secretHash]);
   const expected=phase==='approval'?{kind:'approve',amount:values.amount,spender:captured.portal}:{kind:kind==='bok'?'bok-deposit':'fee-deposit',amount:values.amount,secretHash,recipient};
   const payment=atomic?await read(()=>sdk.prepareBokCreditPurchase({provider,scope:topupScope,portal:captured.portal,token:captured.token,recipient,secretHash,amount:values.amount,chainId:n.chainId})):phase==='swap'?await read(async()=>{
    const {prepareTopupSwap}=await import('./topup-swap.mjs');
    return prepareTopupSwap({ethers,provider,scope:swapScope,portal:captured.portal,token:captured.token,recipient:wallet.address,amount:values.amount,chainId:n.chainId});
   }):
    {to:phase==='approval'?captured.token:captured.portal,data:data.toLowerCase(),value:'0',expected};
   const request={from:wallet.address,chainId:n.chainId,nonce,...payment};
   const [gas,fees]=await together([()=>read(()=>provider.estimateGas({...request,value:BigInt(request.value),chainId:BigInt(n.chainId)})),()=>read(()=>provider.getFeeData())]),price=fees.maxFeePerGas??fees.gasPrice;
   check(typeof gas==='bigint'&&gas>0n&&typeof price==='bigint'&&price>0n,'GAS_CHANGED');
   values.gasBudgetWei??=(gas*2n*price).toString();
   check(gas*2n*price<=BigInt(values.gasBudgetWei),'GAS_CHANGED');
   check((await read(()=>provider.getBlock(head.number)))?.hash===head.hash,'MISMATCH');await read(wallet.guard);
   prepared={store,saved,wallet,request,priorHash,journalPriorHash:existing?.txHash,value:{schemaVersion:1,kind,...values,fixedGasBudget:input.gasBudgetWei!==undefined,phase,exchanged,...(atomic?{purchaseRouter:topupScope.router}:{}),...(phase==='swap'?{swapRouter:swapScope.swapRouter}:{}),depositor:wallet.address,recipientSalt,bridgeSecret,bokScope:kind==='bok'?{...n,...captured}:null,intent:null,claim:null,previousTxHash:priorHash}};
   return freeze({kind,phase,...values,exchanged,maximumSwapWei:request.value,walletName:wallet.name,token:captured.token,portal:captured.portal});
  },
  async confirm({onSubmitted}={}){
   const current=prepared;prepared=null;check(current,'QUOTE_REQUIRED');const {wallet,request}=current;await read(wallet.guard);
   if(current.saved.value?.intent){const prior=await verified(current.saved.value);if(prior.outcome==='success'&&current.saved.value.phase==='deposit')await completedClaim(current.saved.value);}else if(current.priorHash)await archived(current.priorHash);
   let saved=await read(()=>current.store.write(current.saved,current.value));
   const prepareRequest=async tx=>{await read(wallet.guard);
    const [,fees]=await together([()=>qualifyScope(),()=>read(()=>provider.getFeeData())]),price=fees.maxFeePerGas??fees.gasPrice;
    const gasLimit=tx.gasLimit??(await read(()=>provider.estimateGas(tx)))*2n;
    check(typeof gasLimit==='bigint'&&gasLimit>0n&&typeof price==='bigint'&&price>0n&&(!current.value.fixedGasBudget||gasLimit*price<=BigInt(current.value.gasBudgetWei)),'GAS_CHANGED');
    await read(wallet.guard);return {gasLimit,...(fees.maxFeePerGas!==undefined&&fees.maxFeePerGas!==null?{maxFeePerGas:price,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{gasPrice:price})};
   };
   const j=await sdk.createEthereumJournal({...journalOptions(current.value),signer:wallet.signer,prepareRequest,onSubmitted,acknowledgeTx:current.journalPriorHash,contextGuard:async()=>{await contextGuard();await wallet.guard();}});
   let result;try{result=await read(()=>j.send(async nonce=>{check(nonce===request.nonce,'NONCE_CHANGED');saved=await read(()=>current.store.write(saved,{...saved.value,intent:request}));return {data:request.data,value:request.value,expected:request.expected};}));}
   catch(error){const d=error==null?null:Object.getOwnPropertyDescriptor(error,'code');if(d&&'value'in d&&['BB_ETH_REQUEST_CANCELLED','BB_ETH_INSUFFICIENT_FUNDS','BB_ETH_PREFLIGHT_FAILED'].includes(d.value)){try{await read(()=>current.store.write(saved,current.saved.value));}catch(cleanup){throw new AggregateError([error,cleanup],'Top-up cancellation could not be saved.');}}throw error;}
   // Only this exact successful send result may skip another journal recovery.
   // Reopen authenticated custody and retain the final fresh canonical check.
   const {saved:currentSaved}=await stored();
   check(currentSaved.encoded===saved.encoded,'MISMATCH');
   return receiptResult(currentSaved.value,await verifiedResult(currentSaved.value,result));
  },
  async inspect(){const {saved}=await stored();return saved.value?freeze({paymentSaved:!!saved.value.intent,completed:!!saved.value.confirmedClaim,amount:saved.value.amount,asset:saved.value.asset??'USDC',privateFeeCap:saved.value.privateFeeCap,claim:clone(saved.value.claim),claimAction:kind==='bok'?'claim-bok':'claim-private-fee',explicitClaimReview:saved.value.explicitClaimReview===true,phase:saved.value.phase}):null;},
  // The session enters this lifetime under its account lease. The verified
  // payment selects custody; native anchored message consumption authorizes credit.
  async withClaimContinuation(work){
   if(kind!=='bok')return work();
   check(!claimContinuation,'BUSY');const run=claimContinuation={custody:null};
   try{await contextGuard();return await work();}finally{if(claimContinuation===run)claimContinuation=null;}
  },
  async readClaimCustody(receipt){
   const run=claimContinuation,custody=run?.custody;if(!custody)return null;
   const checkCurrent=async()=>{
    await contextGuard();check(claimContinuation===run&&run.custody===custody,'MISMATCH');
    check(await read(()=>custody.store.isCurrent(custody.saved.encoded)),'MISMATCH');
    check(claimContinuation===run&&run.custody===custody,'MISMATCH');
   };
   await checkCurrent();
   check(receipt&&Object.keys(receipt).sort().join()===Object.keys(custody.receipt).sort().join()&&Object.keys(custody.receipt).every(key=>receipt[key]===custody.receipt[key]),'MISMATCH');
   const value=custody.saved.value;
   return Object.freeze({bokScope:freeze(clone(value.bokScope)),recipientSalt:value.recipientSalt,bridgeSecret:value.bridgeSecret,checkCurrent});
  },
  async recover({wait=false}={}){
   const run=claimContinuation,{store,saved}=await stored(),result=receiptResult(saved.value,await verified(saved.value,wait));
   if(run&&kind==='bok'&&saved.value.phase==='deposit'){
    check(claimContinuation===run&&await read(()=>store.isCurrent(saved.encoded)),'MISMATCH');
    check(claimContinuation===run,'MISMATCH');run.custody={store,saved,receipt:freeze(clone(result.receipt))};
   }
   return result;
  },
  async checkpointClaim(value){check(value&&Object.keys(value).sort().join()==='attempted,intentId'&&/^0x[0-9a-f]{64}$/.test(value.intentId)&&typeof value.attempted==='boolean');const {store,saved}=await stored();check(saved.value?.phase==='deposit'&&saved.value.intent,'RECOVERY_REQUIRED');if(saved.value.claim)check(saved.value.claim.intentId===value.intentId&&(!saved.value.claim.attempted||value.attempted),'RECOVERY_REQUIRED');const next=await read(()=>store.write(saved,{...saved.value,claim:clone(value)}));if(claimContinuation?.custody?.saved.encoded===saved.encoded)claimContinuation.custody.saved=next;},
  async checkpointSubmission(intentId,receipt){
   const {saved}=await stored();if(saved.value?.claim?.intentId!==intentId)return;
   const original=(await cap.recover()).receipt;check(receipt&&Object.keys(receipt).sort().join()===Object.keys(original).sort().join()&&Object.keys(original).every(key=>receipt[key]===original[key]),'MISMATCH');
   await cap.checkpointClaim({intentId,attempted:true});
  },
  async recordClaimCompletion(result){
   if(!['included','confirmed'].includes(result?.status)||result.action?.type!==(kind==='bok'?'claim-bok':'claim-private-fee'))return;
   const reported=freeze(clone(result));
   const {store,saved}=await stored();if(!saved.value?.claim||saved.value.claim.intentId!==reported.intentId)return;
   check(saved.value.claim.attempted&&typeof reconcileClaim==='function'&&typeof verifyClaim==='function','RECOVERY_REQUIRED');
   // One fresh authoritative application reconciliation; the reported result
   // supplies identity only, never an alternative receipt or completion proof.
   const original=await read(async()=>freeze(clone(await reconcileClaim(reported.intentId))));check(['included','confirmed'].includes(original.status)&&original.intentId===reported.intentId&&original.txHash===reported.txHash&&/^0x[0-9a-f]{64}$/.test(original.txHash),'MISMATCH');
   const receipt=original.action?.receipt,reportedReceipt=reported.action.receipt;
   check(original.action?.type===reported.action.type&&receipt&&reportedReceipt&&Object.keys(receipt).sort().join()===Object.keys(reportedReceipt).sort().join()&&Object.keys(receipt).every(key=>receipt[key]===reportedReceipt[key]),'MISMATCH');
   await read(()=>store.write(saved,{...saved.value,confirmedClaim:{intentId:original.intentId,txHash:original.txHash,status:original.status}}));
  },
  async reviewRevertedClaim(){const {store,saved}=await stored();check(saved.value?.claim&&typeof reconcileClaim==='function','RECOVERY_REQUIRED');const result=await read(()=>reconcileClaim(saved.value.claim.intentId));check(result.status==='cancelled'||result.status==='reverted'&&saved.value.claim.attempted,'RECOVERY_REQUIRED');await read(()=>store.write(saved,{...saved.value,claim:null,explicitClaimReview:true}));},
  // Authenticated request metadata selects custody; the full verifier below
  // still checks this exact intent, effects and canonical block before disclosure.
  // Successful purchases finish that verifier with a current canonical check;
  // only local outcome/phase checks and projection follow in this direct path.
  async loadAggregate(hash){check(/^0x[0-9a-f]{64}$/.test(hash));if(kind!=='bok')return null;await checkEthereumNetwork();const {saved}=await stored();let value;
   if(saved.value?.intent){const j=await sdk.createEthereumJournal(journalOptions(saved.value)),request=await read(()=>j.inspectRequest());const tx=request?.txHash===hash?null:await read(()=>provider.getTransaction(hash));if(request?.txHash===hash||tx?.hash?.toLowerCase()===hash&&tx.from?.toLowerCase()===saved.value.intent.from&&Number(tx.nonce)===saved.value.intent.nonce){const result=await read(()=>sdk.verifyEthereumIntentReceipt(provider,saved.value.intent,hash));check(result?.outcome==='success'&&saved.value.phase==='deposit','PENDING');if(saved.value.intent.expected.kind!=='bok-purchase'){const block=await read(()=>provider.getBlock(result.receipt.blockNumber));check(block?.hash?.toLowerCase()===result.receipt.blockHash.toLowerCase(),'MISMATCH');}value=saved.value;}}
   if(!value){const archive=await slot(hash),old=await read(()=>archive.read());if(old.value===null)return null;const checked=await archived(hash);check(checked.result.outcome==='success'&&checked.value.phase==='deposit','PENDING');value=checked.value;}
   return freeze({bokScope:clone(value.bokScope),recipientSalt:value.recipientSalt,bridgeSecret:value.bridgeSecret});
  },
 };
 return Object.freeze(cap);
}

// Used for the explicit fee-review path as well as ordinary application sends.
// A durable attempt precedes submission, even if the response is lost.
export async function submitWithFundingCheckpoint({application,topups,aggregate,intentId}){
 const current=await application.reconcile(intentId),kind=current.action?.type==='claim-bok'?'bok':current.action?.type==='claim-private-fee'?'private-fee':null;
 const funding=kind?topups?.[kind]:current.action?.type==='claim-deposit'?aggregate:null;
 if(current.status==='prepared'&&funding)await funding.checkpointSubmission(intentId,kind?current.action.receipt:current.action);
 const result=await application.submitPrepared(intentId);
 if(['included','confirmed'].includes(result.status)&&funding)await funding.recordClaimCompletion(result);
 return result;
}
