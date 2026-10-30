// Real quote/ABI/signatures, AEAD slots and Ethereum journal; labelled finite RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {computeSecretHash} from '@aztec-labs/stdlib/hash';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {deriveBoardDepositSecret} from '../deposit-custody.mjs';
import {claimSecrets} from '../private-fee-funding.mjs';
import {derivePrivateFeeBridgeSecret} from '../private-fee-client.mjs';
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {createEthereumJournal,verifyEthereumIntentReceipt} from '../ethereum-journal.mjs';
import {prepareAggregateFunding,validateAggregateFundingQuote,encodeAggregateFundingTransaction,aggregateFundingTransaction,prepareAggregateUsdcFunding,aggregateUsdcFundingTransaction,aggregateFundingAbi} from './aggregate-funding.mjs';
import {validateAggregateFundingIntent} from './aggregate-recovery.mjs';
import {createAggregateWallet} from './aggregate-wallet.mjs';
import {verifyRollingTopupClaim} from '../../apps/rolling/wallet-session.mjs';
import {requireSuccessfulReceipt} from '../transaction-outcomes.mjs';
const a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const router=new ethers.Interface(aggregateFundingAbi),portal=new ethers.Interface(['function depositNonces(address) view returns(uint256)','function depositsEnabled() view returns(bool)','function getDeposit(address) view returns(uint128)','function MIN_DEPOSIT() view returns(uint256)','function MAX_DEPOSIT() view returns(uint256)','event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const bok=new ethers.Interface(['function active() view returns(bool)','event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
const fee=new ethers.Interface(['event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const quoter=new ethers.Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
function fixture({chainId='31337'}={}){
 const scope={chainId,router:a(1),routerCodeHash:ethers.keccak256('0x6000'),collateralPortal:a(2),feePortal:a(3),bokPortal:a(4),weth:a(5),swapRouter:a(6),feeToken:a(7),bokToken:a(8),privateFpc:h(9),quoter:a(10),quoterCodeHash:ethers.keccak256('0x6000')};
 const signer=new ethers.Wallet(h(99)),address=signer.address.toLowerCase(),records=new Map();
 const state={sends:0,signatures:0,nonce:7,pendingTime:1000,connected:true,invalid:false,unknown:false,landed:false,reads:0};
 const allocation={asset:'ETH',collateralWei:'100',feeAmount:'200',bokAmount:'300',feePoolFee:3000,bokPoolFee:500,slippageBps:100,gasBudgetWei:'10000',privateFeeCap:'1000'};
 const storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,old,value)=>{assert.equal(records.get(key)??null,old);records.set(key,value);}};
 let tx,receipt;
 const provider={getNetwork:async()=>({chainId:BigInt(chainId)}),getTransactionCount:async()=>state.nonce,getBlockNumber:async()=>state.landed?17:16,
  getBlock:async number=>({number:number==='latest'?16:number,hash:h(number==='latest'?16:number),parentHash:h(Number(number)-1||15),prefetchedTransactions:state.landed?[tx]:[]}),
  getFeeData:async()=>({maxFeePerGas:2n,maxPriorityFeePerGas:1n}),estimateGas:async()=>100n,getCode:async()=> '0x6000',getTransaction:async()=>tx,getTransactionReceipt:async()=>state.landed?receipt:null,
  async send(method,params){state.reads++;
   if(method==='eth_chainId')return '0x'+BigInt(chainId).toString(16);
   if(method==='eth_getBlockByNumber'&&params[0]==='pending')return {number:null,hash:null,timestamp:'0x'+state.pendingTime.toString(16)};
   if(method==='eth_getBlockByNumber')return {number:'0x10',hash:h(16),timestamp:'0x3e8'};
   if(method==='eth_getCode')return '0x6000';if(method==='eth_getBalance')return '0xffffff';
   assert.equal(method,'eth_call');if(params[1]==='pending'){assert(['fund','fundUsdc'].includes(router.parseTransaction(params[0]).name));if(state.simulationFails)throw Error('PRIVATE_SENTINEL');return '0x';}const {to,data}=params[0];
   if(to===scope.router){const call=router.parseTransaction({data});return router.encodeFunctionResult(call.name,[scope[call.name]]);}
   if(to===scope.collateralPortal){const call=portal.parseTransaction({data});return portal.encodeFunctionResult(call.name,[{depositNonces:2n,depositsEnabled:true,getDeposit:0n,MIN_DEPOSIT:1n,MAX_DEPOSIT:200n}[call.name]]);}
   if(to===scope.bokPortal)return bok.encodeFunctionResult('active',[true]);
   const call=quoter.parseTransaction({data});return quoter.encodeFunctionResult(call.name,[call.args[0].amount,1,0,1]);
  }};
 const wallet={address,name:'Test named wallet',guard:async()=>{if(!state.connected||state.invalid)throw Error('Context changed');},signer:{
  getAddress:async()=>address,signTypedData:async(...args)=>{state.signatures++;return signer.signTypedData(...args);},
  sendTransaction:async request=>{state.sends++;tx={...request,value:String(request.value),chainId:String(request.chainId),hash:h(20)};
   const p=router.parseTransaction({data:request.data}).args.p;const expectedHash=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([router.getFunction('fund').inputs[0]],[p]));
   const log=(address,iface,name,args)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
   receipt={hash:h(20),from:address,to:scope.router,blockNumber:17,blockHash:h(17),status:1,logs:[
    log(scope.router,router,'Funded',[address,expectedHash,p.collateral,p.fee.amount,p.bok.amount,p.fee.maxEth,p.bok.maxEth,0]),
    ...(p.collateral>0n?[log(scope.collateralPortal,portal,'Deposited',[address,p.collateral,p.collateralSecretHash,h(30),1])]:[]),
    log(scope.feePortal,fee,'DepositToAztecPublic',[scope.privateFpc,p.fee.amount,p.feeSecretHash,h(31),2]),
    ...(p.bok.amount>0n?[log(scope.bokPortal,bok,'Deposited',[p.bokCommitment,p.bok.amount,h(32),3])]:[])
   ]};if(state.unknown)throw Error('Lost acknowledgement');state.landed=true;return {hash:h(20)};
  }}};
 const options={sdk:{Fr,prepareBokCreditPurchase,computeSecretHash,poseidon2HashWithSeparator,deriveBoardDepositSecret,claimSecrets,createEncryptedJournalSlot,createEthereumJournal,verifyEthereumIntentReceipt,prepareAggregateFunding,validateAggregateFundingQuote,encodeAggregateFundingTransaction,aggregateFundingTransaction,validateAggregateFundingIntent},ethers,scope,
  network:{chainId,version:'1',rollup:a(11)},board:h(12),bok:h(13),owner:h(14),walletSecret:h(15),walletSalt:'0',storage,provider,
  reconcileClaim:id=>state.workflow.open().reconcile(id),verifyClaim:async hash=>assert.equal(hash,h(70)),
  verifyFeeCredit:async amount=>{assert.equal(typeof amount,'string');state.creditChecks=(state.creditChecks??0)+1;if(state.creditRejected)throw Object.assign(Error('Insufficient credit'),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT',minimumFeeCredit:'1000'});},
  captureWallet:async()=>{if(!state.connected)throw Error('No wallet');return wallet;},contextGuard:async()=>{if(state.invalid)throw Error('Context changed');},verifyScope:async()=>async()=>{}};
 return {options,state,allocation,records,wallet,open:()=>createAggregateWallet(options)};
}
test('aggregate review never signs/sends; explicit confirm uses Ethereum nonce, distinct consent nonce, and authenticates three receipts',async()=>{
 const f=fixture(),app=await f.open(),review=await app.prepare(f.allocation);assert.equal(review.ethereumNonce,7);assert.equal(review.consentNonce,'2');assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
 assert(!JSON.stringify(review).includes('recipientSalt'));assert(!JSON.stringify([...f.records.values()]).includes('recipientSalt'));
 const result=await app.confirm();assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);assert.equal(result.bokReceipt.nonce,'7');assert.equal(result.feeReceipt.amount,'200');
 f.state.connected=false;const reopened=await f.open(),context=await reopened.loadAggregate(result.receipt.txHash);assert.equal(context.intent.nonce,7);assert.equal(context.bokScope.portal,f.options.scope.bokPortal);
 assert.equal((await reopened.recover()).receipt.txHash,result.receipt.txHash);assert.equal(f.state.sends,1);await assert.rejects(reopened.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 // The read-only wallet capture now precedes journal inspection. Both failures
 // still veto a new quote, with no mutation or additional signature/broadcast.
 const retained=[...f.records];
 await assert.rejects(reopened.prepare(f.allocation),/No wallet/);
 assert.deepEqual([...f.records],retained);assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
 f.state.connected=true;
 await assert.rejects(reopened.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 assert.deepEqual([...f.records],retained);assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
});
test('changed Ethereum nonce rejects inside original journal callback before encrypted intent and broadcast',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);f.state.nonce=8;
 await assert.rejects(app.confirm(),{code:'ROLLING_FUNDING_NONCE_CHANGED'});assert.equal(f.state.sends,0);
 f.state.nonce=7;assert.equal((await app.prepare(f.allocation)).ethereumNonce,7);
});
test('lost send reply retains original context; recovery never rebroadcasts',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);f.state.unknown=true;
 await assert.rejects(app.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});f.state.connected=false;
 const reopened=await f.open();await assert.rejects(reopened.recover());assert.equal(f.state.sends,1);
 f.state.landed=true;f.state.nonce=8;assert.equal((await reopened.recover()).receipt.txHash,h(20));assert.equal(f.state.sends,1);
});
for(const mode of ['expired','account','signature','pending-state'])test('aggregate confirmation fails closed for '+mode,async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);
 if(mode==='expired')f.state.pendingTime=1901;if(mode==='pending-state')f.state.simulationFails=true;if(mode==='account')f.state.invalid=true;if(mode==='signature')f.wallet.signer.signTypedData=(...args)=>new ethers.Wallet(h(98)).signTypedData(...args);
 await assert.rejects(app.confirm());assert.equal(f.state.sends,0);if(mode==='expired')assert.equal(f.state.signatures,0);
});
test('unrelated tx hash cannot load retained secret context',async()=>{const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();assert.equal(await app.loadAggregate(h(21)),null);});
test('gas increase rolls back the unsent original payment intent before wallet invocation',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);f.options.provider.getFeeData=async()=>({maxFeePerGas:10000n});
 await assert.rejects(app.confirm(),{code:'BB_ETH_PREFLIGHT_FAILED',ethereumStage:'preflight'});assert.equal(f.state.sends,0);assert.equal((await app.inspect()).paymentSaved,false);
});
test('private claim attempt survives encrypted reopen and cannot change its identity or erase attempted state',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();
 await app.checkpointClaim({intentId:h(100),attempted:false});await app.checkpointClaim({intentId:h(100),attempted:true});
 const reopened=await f.open();assert.deepEqual((await reopened.inspect()).claim,{intentId:h(100),attempted:true});assert.equal((await reopened.inspect()).privateFeeCap,'1000');
 await assert.rejects(reopened.checkpointClaim({intentId:h(101),attempted:true}));await assert.rejects(reopened.checkpointClaim({intentId:h(100),attempted:false}));assert.equal(f.state.sends,1);
});
test('direct receipt lookup remains available with no aggregate record or unrelated retained aggregate',async()=>{
 const f=fixture(),app=await f.open();assert.equal(await app.loadAggregate(h(81)),null);
 await app.prepare(f.allocation);assert.equal(await app.loadAggregate(h(81)),null);await app.confirm();assert.equal(await app.loadAggregate(h(81)),null);
});
test('matching aggregate pending or corrupted context is never treated as an unrelated direct receipt',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);f.state.unknown=true;await assert.rejects(app.confirm());
 await assert.rejects(app.loadAggregate(h(20)));assert.equal(f.state.sends,1);
 const key=[...f.records.keys()][0];const envelope=JSON.parse(f.records.get(key));envelope.data='00'+envelope.data.slice(2);f.records.set(key,JSON.stringify(envelope));await assert.rejects(app.loadAggregate(h(81)));
});
test('an earlier deposit does not block a successor quote and original payment records remain intact',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();
 const workflow=durableClaimApplication(f,app);await advanceAggregateClaim({application:workflow.open(),funding:app});const original=await app.loadAggregate(h(20));
 const send=f.options.provider.send;f.options.provider.send=async(method,params)=>{
  if(method==='eth_call'&&params[0].to===f.options.scope.collateralPortal&&portal.parseTransaction({data:params[0].data}).name==='getDeposit')return portal.encodeFunctionResult('getDeposit',[100]);
  return send(method,params);
 };
 assert.equal((await app.inspect()).paymentSaved,true);
 const reopened=await f.open();await reopened.prepare(f.allocation);assert.equal((await reopened.inspect()).paymentSaved,false);
 assert.deepEqual(await reopened.loadAggregate(h(20)),original);assert.equal(f.state.sends,1);
 const foreign=await createAggregateWallet({...f.options,owner:h(77)});assert.equal(await foreign.loadAggregate(h(20)),null);
});

import fs from 'node:fs';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {encodeArguments,loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {createRollingApplication} from './application.mjs';
import {normalizePrivateFeeGasSettings} from '../private-fee-client.mjs';
import {advanceAggregateClaim} from './aggregate-wallet.mjs';
const boardArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const bokArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url))));
function durableClaimApplication(f,funding,{proposed=false}={}){
 // Original application, ABIs and AES-GCM/CAS workflow; the canonical L2
 // outcome and bridge witness adapter are labelled finite SDK fixtures.
 const state={sends:0,prepares:0,outcome:null},owner=new AztecAddress(Fr.fromString(f.options.owner));
 const node={getBlockData:async()=>({header:{globalVariables:{blockNumber:3}},blockHash:h(60)}),getNodeInfo:async()=>({l1ContractAddresses:{feeJuicePortalAddress:f.options.scope.feePortal,feeJuiceAddress:f.options.scope.feeToken}})};
 const journal={assertCanStart:async()=>{},inspectOutcome:async()=>state.outcome,inspect:async()=>state.outcome,confirmed:()=>{},included:async receipt=>assert.equal(receipt.status,'proposed')};
 const wallet={aztecNode:node,pxe:{getSyncedBlockHeader:async()=>({globalVariables:{blockNumber:3},hash:async()=>h(60),state:{l1ToL2MessageTree:{root:new Fr(61)}}})},getAccounts:async()=>[owner],getChainInfo:async()=>({chainId:31337,version:1}),sendTx:async(_payload,options)=>{
  state.sends++;state.outcome={operation:options.journalOperation,outcome:'success',txHash:h(70),receipt:{txHash:h(70),status:options.confirmationTier==='proposed'?'proposed':'checkpointed',executionResult:'success',blockNumber:3,blockHash:h(60),transactionFee:1n}};return {receipt:{}};
 }};
 const sdk={Fr,AztecAddress,encodeArguments,normalizePrivateFeeGasSettings,isTrustedPrivateNode:n=>n===node,isPrivateWalletForNode:(w,n)=>w===wallet&&n===node,isPrivatePXEForNode:(p,n)=>p===wallet.pxe&&n===node,inspectTrustedNode:async()=>{},
  Contract:{at:()=>({methods:new Proxy({},{get:(_,name)=>(...args)=>({name,args,simulate:async()=>({result:[0n,...Array(9).fill(0n)]})})})})},
  BatchCall:class{constructor(_wallet,interactions){this.interactions=interactions;}},
  preparePrivateFeePayment:async()=>({availableCredit:100n,metadata:{maximumFee:'100'}}),estimatePrivateFeeTransaction:async({interaction})=>{state.prepares++;return {maximumFee:10n,payload:interaction,gasSettings:{}};},
  prepareFundingClaim:async input=>({status:'claim-ready',claim:input.kind==='collateral'?{contract:f.options.board,method:'claim_deposit',args:[input.receipt.sender,input.receipt.amount,h(80),input.receipt.leafIndex]}:input.kind==='private-fee'?{contract:f.options.scope.privateFpc,kind:'private-fee-bridge',bridgeClaim:{amount:input.receipt.amount,salt:h(81),leafIndex:input.receipt.leafIndex}}:{contract:f.options.bok,method:'claim',args:[input.receipt.amount,input.secrets.recipientSalt,input.secrets.bridgeSecret,input.receipt.leafIndex]}})};
 const options={sdk,deployment:{board:{address:f.options.board,artifact:boardArtifact},network:f.options.network,portal:f.options.scope.collateralPortal,
  privateFee:{address:f.options.scope.privateFpc,artifact:{},gasSettings:{gasLimits:{daGas:5,l2Gas:5},teardownGasLimits:{daGas:0,l2Gas:1},maxFeesPerGas:{feePerDaGas:1,feePerL2Gas:1},maxPriorityFeesPerGas:{feePerDaGas:0,feePerL2Gas:0}}},bok:{address:f.options.bok,operator:h(16),pluginId:h(17),artifact:bokArtifact}},
  accountSession:{proposedTransactions:proposed,owner,wallet,node,journal,walletSecret:f.options.walletSecret,walletSalt:f.options.walletSalt},privateStore:f.options.storage,contextGuard:async()=>{},funding:{provider:f.options.provider,loadAggregate:hash=>funding.loadAggregate(hash)}};
 const workflow={state,open:()=>createRollingApplication(options)};f.state.workflow=workflow;return workflow;
}
test('original encrypted application workflow relinks after prepare-before-checkpoint interruption and sends once',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();
 const workflow=durableClaimApplication(f,funding),first=workflow.open(),prepared=await first.prepare({type:'claim-deposit',...receipts});assert.equal((await funding.inspect()).claim,null);
 const next=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(next.state,'complete');assert.equal(next.intent.intentId,prepared.intentId);assert.equal(workflow.state.sends,1);assert.equal(f.state.sends,1);
 assert.equal((await advanceAggregateClaim({application:workflow.open(),funding:await f.open()})).state,'complete');assert.equal(workflow.state.sends,1);
});
test('aggregate confirmed claim permits a fresh quote after the current application intent is replaced',async()=>{
 const f=fixture();let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);f.options.verifyClaim=async hash=>assert.equal(hash,h(70));
 const funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();workflow=durableClaimApplication(f,funding);
 const complete=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(complete.state,'complete');
 const original=await funding.loadAggregate(h(20));
 f.options.reconcileClaim=async()=>{throw Object.assign(Error('The later post/preferences intent replaced the funding intent'),{code:'ROLLING_INTENT_NOT_FOUND'});};
 const reopened=await f.open();await reopened.prepare(f.allocation);
 assert.deepEqual(await reopened.loadAggregate(h(20)),original);assert.equal(f.state.sends,1);assert.equal(workflow.state.sends,1);
});
test('aggregate retained completion rechecks canonical L2 receipt before preparation and again before payment',async()=>{
 const f=fixture();let canonical=true;
 f.options.verifyClaim=async txHash=>verifyRollingTopupClaim({sdk:{TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn(),requireSuccessfulReceipt},
  node:{getTxReceipt:async()=>({txHash:h(70),status:'checkpointed',executionResult:'success',blockNumber:3,blockHash:h(60)}),getBlock:async()=>({hash:canonical?h(60):h(61)})},txHash,contextGuard:f.options.contextGuard});
 const funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();const workflow=durableClaimApplication(f,funding);
 await advanceAggregateClaim({application:workflow.open(),funding});f.options.reconcileClaim=async()=>{throw Error('later unrelated workflow');};
 canonical=false;await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_SESSION_CONFIG'});
 canonical=true;const next=await f.open();await next.prepare(f.allocation);canonical=false;
 await assert.rejects(next.confirm(),{code:'ROLLING_SESSION_CONFIG'});await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_SESSION_CONFIG'});
 assert.equal(f.state.sends,1);assert.equal(workflow.state.sends,1);
});

test('aggregate completion rejects substituted intent hash and receipts, unknown or reverted outcomes, and incomplete old records',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();const workflow=durableClaimApplication(f,funding);
 const app=workflow.open(),prepared=await app.prepare({type:'claim-deposit',...receipts});await funding.checkpointClaim({intentId:prepared.intentId,attempted:true});
 const done=await app.submitPrepared(prepared.intentId);
 await assert.rejects(funding.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 await assert.rejects(funding.recordClaimCompletion({...done,txHash:h(71)}),{code:'ROLLING_FUNDING_MISMATCH'});
 for(const key of ['receipt','feeReceipt','bokReceipt'])await assert.rejects(funding.recordClaimCompletion({...done,action:{...done.action,[key]:{...done.action[key],amount:'999'}}}),{code:'ROLLING_FUNDING_MISMATCH'});
 for(const status of ['unknown','reverted']){
  await funding.recordClaimCompletion({...done,status});await assert.rejects(funding.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 }
 const outcome=workflow.state.outcome;workflow.state.outcome={...outcome,outcome:'reverted'};
 await assert.rejects(funding.recordClaimCompletion(done),{code:'ROLLING_FUNDING_MISMATCH'});workflow.state.outcome=outcome;
 await funding.recordClaimCompletion(done);await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,1);assert.equal(workflow.state.sends,1);
});

test('aggregate manual over-cap confirmation checkpoints before send and retains completion for the next quote',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare({...f.allocation,privateFeeCap:'1'});await funding.confirm();const workflow=durableClaimApplication(f,funding);
 const review=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(review.state,'review');assert.equal((await funding.inspect()).claim.attempted,false);
 const app=workflow.open(),application={...app,submitPrepared:async id=>{assert.equal((await funding.inspect()).claim.attempted,true);return app.submitPrepared(id);}};
 const tampered={...application,reconcile:async id=>{const current=await app.reconcile(id);return {...current,action:{...current.action,bokReceipt:{...current.action.bokReceipt,amount:'999'}}};}};
 await assert.rejects(submitWithFundingCheckpoint({application:tampered,aggregate:funding,intentId:review.intent.intentId}),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(workflow.state.sends,0);
 const done=await submitWithFundingCheckpoint({application,aggregate:funding,intentId:review.intent.intentId});assert.equal(done.status,'confirmed');
 f.options.reconcileClaim=async()=>{throw Error('later post/preferences workflow');};await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,1);assert.equal(workflow.state.sends,1);
});

test('USDC aggregate confirmed completion survives later workflow without another relay POST',async()=>{
 const f=usdcWalletFixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();const workflow=durableClaimApplication(f,funding);
 const done=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(done.state,'complete');const original=await funding.loadAggregate(h(200));
 f.options.reconcileClaim=async()=>{throw Error('later post/preferences workflow');};const next=await f.open();await next.prepare(f.allocation);
 assert.deepEqual(await next.loadAggregate(h(200)),original);assert.equal(f.state.posts,1);assert.equal(workflow.state.sends,1);
});

test('original encrypted application exposes prepared recovery after attempted checkpoint before submission',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();const workflow=durableClaimApplication(f,funding);
 const prepared=await workflow.open().prepare({type:'claim-deposit',...receipts});await funding.checkpointClaim({intentId:prepared.intentId,attempted:true});
 const next=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(next.state,'review-saved');assert.equal(next.intent.intentId,prepared.intentId);assert.equal(workflow.state.sends,0);assert.equal(f.state.sends,1);
});

for(const code of ['ACTION_REJECTED','INSUFFICIENT_FUNDS'])test('original journal '+code+' rollback permits a fresh quote without erasing unknown outcomes',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);const send=f.wallet.signer.sendTransaction;
 f.wallet.signer.sendTransaction=async()=>{throw Object.assign(Error('labelled wallet refusal'),{code});};
 await assert.rejects(app.confirm(),{code:code==='ACTION_REJECTED'?'BB_ETH_REQUEST_CANCELLED':'BB_ETH_INSUFFICIENT_FUNDS'});
 assert.equal((await app.inspect()).paymentSaved,false);assert.equal(f.state.sends,0);
 f.wallet.signer.sendTransaction=send;await app.prepare(f.allocation);await app.confirm();assert.equal(f.state.sends,1);
});

function usdcWalletFixture(){
 const f=fixture(),s=f.options.scope,relayer=a(71),claims=new Map();
 Object.assign(s,{usdcCodeHash:ethers.keccak256('0x6000'),usdcImplementation:a(70),usdcImplementationCodeHash:ethers.keccak256('0x6000'),usdcDomain:{name:'USDC',version:'2'},usdcRelayAddress:relayer});
 Object.assign(f.options.sdk,{prepareAggregateUsdcFunding,aggregateUsdcFundingTransaction,derivePrivateFeeBridgeSecret});
 const usdc=new ethers.Interface(['function implementation() view returns(address)','function DOMAIN_SEPARATOR() view returns(bytes32)','function balanceOf(address) view returns(uint256)','function authorizationState(address,bytes32) view returns(bool)']);
 const original=f.options.provider.send;f.state.posts=0;f.state.statusReads=0;f.state.withhold=false;f.state.lost=false;f.state.usdcTx=null;f.state.usdcReceipt=null;
 f.options.provider.send=async(method,params)=>{
  if(method==='eth_getBalance'){assert.equal(params[0],relayer);return '0xffffff';}
  if(method==='eth_call'){
   const {to,data}=params[0];
   if(to===s.bokToken){const c=usdc.parseTransaction({data});return usdc.encodeFunctionResult(c.name,[{implementation:s.usdcImplementation,DOMAIN_SEPARATOR:ethers.TypedDataEncoder.hashDomain({...s.usdcDomain,chainId:s.chainId,verifyingContract:s.bokToken}),balanceOf:999999999n,authorizationState:false}[c.name]]);}
   if(to===s.router&&router.parseTransaction({data}).name==='usdcAuthorizationNonce'){
    const plan=router.parseTransaction({data}).args[0],hash=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([router.getFunction('fundUsdc').inputs[0]],[plan]));
    return router.encodeFunctionResult('usdcAuthorizationNonce',[ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32'],[ethers.encodeBytes32String('ROLLING_USDC_FUNDING_V1'),s.chainId,s.router,hash]))]);
   }
  }
  return original(method,params);
 };
 f.options.claimStore={save:async(scope,record)=>{assert.equal(f.state.signatures%2,0);assert.equal(scope.depositor,f.wallet.address);claims.set(record.secretHash,{scope,record});}};
 f.options.provider.getTransactionCount=async()=>{throw Error('USDC custody must not derive an Ethereum nonce');};
 f.options.provider.getTransaction=async()=>f.state.usdcTx;f.options.provider.getTransactionReceipt=async()=>f.state.usdcReceipt;
 f.options.relay={terms:async()=>({relayer,feeUsdc:'50',gasBudgetWei:'10000'}),submit:async data=>{
  f.state.posts++;assert.equal(f.state.signatures,f.allocation.collateralWei==='0'?1:2);assert.equal(claims.size,f.allocation.collateralWei==='0'?0:1);assert(f.records.size>0);
  if(f.state.lost)throw Error('labelled lost relay reply');
  const p=router.parseTransaction({data}).args.p,hash=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([router.getFunction('fundUsdc').inputs[0]],[p]));
  f.state.usdcTx={hash:h(200),from:relayer,to:s.router,nonce:42,chainId:31337n,value:0n,data};
  const log=(address,iface,name,args)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
  f.state.usdcReceipt={hash:h(200),from:relayer,to:s.router,blockNumber:17,blockHash:h(17),status:1,logs:[
   log(s.router,router,'UsdcFunded',[p.beneficiary,hash,p.relayer,p.collateral.amount,p.fee.amount,p.bokAmount,p.collateral.maxUsdc,p.fee.maxUsdc,p.relayFeeUsdc,0]),
   ...(p.collateral.amount>0n?[log(s.collateralPortal,portal,'Deposited',[p.beneficiary,p.collateral.amount,p.collateralSecretHash,h(30),1])]:[]),
   log(s.feePortal,fee,'DepositToAztecPublic',[s.privateFpc,p.fee.amount,p.feeSecretHash,h(31),2]),
   ...(p.bokAmount>0n?[log(s.bokPortal,bok,'Deposited',[p.bokCommitment,p.bokAmount,h(32),3])]:[])
  ]};return {status:'unresolved',scope:'aggregate-funding',canonical:false,planHash:hash,transactionHash:h(200)};
 },status:async planHash=>{f.state.statusReads++;return {status:f.state.usdcTx&&!f.state.withhold?'succeeded':'absent',scope:'aggregate-funding',canonical:!!f.state.usdcTx,planHash,...(f.state.usdcTx&&!f.state.withhold?{transactionHash:h(200)}:{})};}};
 f.wallet.signer.sendTransaction=async()=>{throw Error('USDC user must never send an Ethereum transaction');};
 f.allocation={asset:'USDC',collateralWei:'100',feeAmount:'200',bokAmount:'300',collateralPoolFee:500,feePoolFee:3000,slippageBps:100,privateFeeCap:'1000'};
 return {...f,claims};
}
test('USDC uses two real signatures, retained random custody and one relay post without user Ethereum send',async()=>{
 const f=usdcWalletFixture(),app=await f.open(),q=await app.prepare(f.allocation);assert.equal(q.kind,'rolling-aggregate-usdc-v1');assert.equal(f.state.signatures,0);assert.equal(f.claims.size,1);
 assert.deepEqual(await app.confirm(),{pending:true});assert.equal(f.state.posts,1);assert.equal(f.state.sends,0);
 f.state.connected=false;const reopened=await f.open(),r=await reopened.recover();assert.equal(r.receipt.sender,a(71));assert.equal(r.receipt.nonce,'42');
 const context=await reopened.loadAggregate(h(200));assert.equal(context.aggregateCustody.beneficiary,f.wallet.address);assert.equal(context.intent.from,a(71));assert.equal(context.intent.nonce,42);assert.equal(f.state.posts,1);
 const original=await f.options.sdk.computeSecretHash(Fr.fromString([...f.claims.values()][0].record.secret));assert.equal(original.toString(),r.receipt.secretHash);
});
test('USDC lost relay acknowledgement and absent status never authorize a second POST after reopen',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);f.state.lost=true;assert.deepEqual(await app.confirm(),{pending:true});
 const reopened=await f.open();await assert.rejects(reopened.recover(),{code:'ROLLING_FUNDING_PENDING'});await assert.rejects(reopened.prepare(f.allocation),{code:'ROLLING_FUNDING_PENDING'});await assert.rejects(reopened.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});assert.equal(f.state.posts,1);assert.equal(f.state.sends,0);
 assert.equal((await advanceAggregateClaim({application:{},funding:reopened})).state,'waiting');assert.equal(f.state.posts,1);
});
test('USDC terms cannot change the pinned relayer and failed custody stops before either signature',async()=>{
 const f=usdcWalletFixture();f.options.relay.terms=async()=>({relayer:a(72),feeUsdc:'50',gasBudgetWei:'10000'});await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_FUNDING_RELAY_SCOPE'});assert.equal(f.state.signatures,0);
 const g=usdcWalletFixture();g.options.claimStore.save=async()=>{throw Error('durable storage failed');};await assert.rejects((await g.open()).prepare(g.allocation));assert.equal(g.state.signatures,0);assert.equal(g.state.posts,0);
});
test('USDC service success cannot replace exact canonical transaction and all three effect checks',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();f.state.usdcTx.data='0x1234';await assert.rejects(app.recover(),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(f.state.posts,1);
});

test('USDC exact canonical saved calldata can recover after relay status is lost, while wrong chain and incomplete effects fail',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();f.state.withhold=true;
 const found=await app.loadAggregate(h(200));assert.equal(found.intent.nonce,42);assert.equal(found.aggregateCustody.beneficiary,f.wallet.address);assert.equal(f.state.posts,1);
 f.options.provider.getNetwork=async()=>({chainId:1n});await assert.rejects(app.loadAggregate(h(200)),{code:'ROLLING_FUNDING_MISMATCH'});
 f.options.provider.getNetwork=async()=>({chainId:31337n});f.state.usdcReceipt.logs.pop();await assert.rejects(app.loadAggregate(h(200)));assert.equal(f.state.posts,1);
});

test('unrelated direct receipts do not depend on a pending USDC relay and verified transaction hashes survive lost status',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();await app.recover();
 f.state.withhold=true;assert.equal((await(await f.open()).recover()).receipt.txHash,h(200));
 f.options.relay.status=async()=>{throw Error('relay unavailable');};assert.equal(await app.loadAggregate(h(999)),null);assert.equal(f.state.posts,1);
});

test('canonical reverted private claim is explicitly re-reviewed without repeat payment or automatic send, and manual confirmation relinks',async()=>{
 const f=fixture();let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();workflow=durableClaimApplication(f,funding);
 await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(workflow.state.sends,1);workflow.state.outcome={...workflow.state.outcome,outcome:'reverted'};
 assert.equal((await advanceAggregateClaim({application:workflow.open(),funding})).state,'reverted');
 await funding.reviewRevertedClaim();const reviewed=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(reviewed.state,'review');assert.equal(workflow.state.sends,1);assert.equal(f.state.sends,1);
 await workflow.open().submitPrepared(reviewed.intent.intentId);const final=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(final.state,'complete');assert.equal((await funding.inspect()).claim.attempted,true);assert.equal(workflow.state.sends,2);assert.equal(f.state.sends,1);
 await assert.rejects(funding.reviewRevertedClaim(),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
});
test('USDC crash after durable one-shot checkpoint but before POST remains status-only even when relay says absent',async()=>{
 const f=usdcWalletFixture(),cas=f.options.storage.compareAndSwap;let writes=0;
 f.options.storage.compareAndSwap=async(...args)=>{await cas(...args);if(++writes===2)throw Error('labelled lost local checkpoint reply');};
 const app=await f.open();await app.prepare(f.allocation);await assert.rejects(app.confirm());assert.equal(f.state.signatures,2);assert.equal(f.state.posts,0);
 const recovered=await f.open();assert.equal((await recovered.inspect()).paymentSaved,true);await assert.rejects(recovered.recover(),{code:'ROLLING_FUNDING_PENDING'});await assert.rejects(recovered.prepare(f.allocation),{code:'ROLLING_FUNDING_PENDING'});assert.equal(f.state.posts,0);
});

test('canonical reverted ETH payment archives the original before explicit fresh quote and original journal acknowledgement',async()=>{
 const f=fixture(),get=f.options.provider.getTransactionReceipt;let reverted=true;
 f.options.provider.getTransactionReceipt=async(...args)=>{const r=await get(...args);return r?{...r,status:reverted?0:1,logs:reverted?[]:r.logs}:r;};
 const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm(),{code:'BB_ETH_TRANSACTION_FAILED'});
 const before=f.records.size;const q=await(await f.open()).prepare(f.allocation);assert.equal(q.ethereumNonce,8);assert.equal(f.state.sends,1);assert.equal(f.records.size,before+1);
 // A new explicit confirmation uses the original Ethereum journal, which
 // rechecks the acknowledged reverted request before its nonce successor.
 const next=await f.open();await next.prepare(f.allocation);const send=f.wallet.signer.sendTransaction;f.wallet.signer.sendTransaction=async request=>{const sent=await send(request);reverted=false;return sent;};await next.confirm();assert.equal(f.state.sends,2);
});
test('reverted payment successor rejects reorg, replacement, missing finality and archive persistence failure',async()=>{
 for(const mode of ['reorg','replacement','archive']){
  const f=fixture(),get=f.options.provider.getTransactionReceipt;
  f.options.provider.getTransactionReceipt=async(...args)=>{const r=await get(...args);return r?{...r,status:0,logs:[]}:r;};
  const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm());
  if(mode==='reorg'){const getBlock=f.options.provider.getBlock;let calls=0;f.options.provider.getBlock=async n=>({...await getBlock(n),...(n===17&&++calls>1?{hash:h(999)}:{})});}
  if(mode==='replacement'){const getTx=f.options.provider.getTransaction;f.options.provider.getTransaction=async(...a)=>({...await getTx(...a),data:'0x1234'});}
  if(mode==='archive'){const cas=f.options.storage.compareAndSwap;f.options.storage.compareAndSwap=async(key,...args)=>{if(!f.records.has(key))throw Error('archive unavailable');return cas(key,...args);};}
  await assert.rejects((await f.open()).prepare(f.allocation));assert.equal(f.state.sends,1);assert.equal((await funding.inspect()).paymentSaved,true);
 }
});
test('canonical mined reverted payment permits fresh review without finalized head',async()=>{
 const f=fixture({chainId:'1'}),get=f.options.provider.getTransactionReceipt,block=f.options.provider.getBlock;
 f.options.provider.getTransactionReceipt=async(...args)=>{const r=await get(...args);return r?{...r,status:0,logs:[]}:r;};
 f.options.provider.getBlock=async n=>{assert.notEqual(n,'finalized');return block(n);};
 const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm());
 assert(await (await f.open()).prepare(f.allocation));assert.equal(f.state.sends,1);
});
test('USDC canonical revert permits only a fresh reviewed plan and keeps the failed original encrypted',async()=>{
 const f=usdcWalletFixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();f.state.usdcReceipt.status=0;f.state.usdcReceipt.logs=[];
 await assert.rejects(funding.recover(),{code:'ROLLING_FUNDING_REVERTED'});
 const original=[...f.records.values()],q=await(await f.open()).prepare(f.allocation);assert.equal(q.kind,'rolling-aggregate-usdc-v1');assert.equal(f.state.posts,1);assert.equal(f.state.signatures,2);assert.equal(f.records.size,original.length+1);assert.equal(f.state.sends,0);
});
test('cancelled saved private claim pauses and requires explicit re-review without repeated payment',async()=>{
 const f=fixture();let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();workflow=durableClaimApplication(f,funding);
 const prepared=await workflow.open().prepare({type:'claim-deposit',...receipts});await funding.checkpointClaim({intentId:prepared.intentId,attempted:false});await workflow.open().cancelPrepared(prepared.intentId);
 assert.equal((await advanceAggregateClaim({application:workflow.open(),funding})).state,'cancelled');assert.equal(workflow.state.sends,0);
 await funding.reviewRevertedClaim();assert.equal((await advanceAggregateClaim({application:workflow.open(),funding})).state,'review');assert.equal(workflow.state.sends,0);assert.equal(f.state.sends,1);
});

test('USDC matching imported and retained canonical transaction hashes recover while relay status throws',async()=>{
 const f=usdcWalletFixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();
 f.options.relay.status=async()=>{throw Error('labelled HTTP503');};
 const reopened=await f.open(),context=await reopened.loadAggregate(h(200));assert.equal(context.intent.nonce,42);assert.equal(context.aggregateCustody.beneficiary,f.wallet.address);
 assert.equal((await(await f.open()).recover()).receipt.txHash,h(200));assert.equal(f.state.posts,1);assert.equal(f.state.statusReads,0);
 f.state.usdcReceipt.logs.pop();await assert.rejects(reopened.loadAggregate(h(200)));assert.equal(f.state.posts,1);
});

import {createStandaloneTopupWallet} from './aggregate-wallet.mjs';
function topupFixture(kind='bok'){
 const f=fixture(),s=f.options.scope,scope={portal:kind==='bok'?s.bokPortal:s.feePortal,token:kind==='bok'?s.bokToken:s.feeToken,recipient:kind==='bok'?f.options.bok:s.privateFpc};
 const token=new ethers.Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
 const deposit=new ethers.Interface(kind==='bok'?['function deposit(bytes32,uint128,bytes32)']:['function depositToAztecPublic(bytes32,uint256,bytes32)']);
 const transactions=new Map(),receipts=new Map();f.state.allowance=0n;f.state.balance=100000n;f.state.unknown=false;f.state.revert=false;
 f.options.provider.getTransactionCount=async()=>7+f.state.sends;
 f.options.provider.getBlockNumber=async()=>16+f.state.sends;
 f.options.provider.getBlock=async number=>{number=number==='latest'?16+f.state.sends:number;return {number,hash:h(number),parentHash:h(number-1),prefetchedTransactions:[...transactions.values()].filter(t=>t.blockNumber===number)};};
 f.options.provider.getTransaction=async hash=>transactions.get(hash)??null;f.options.provider.getTransactionReceipt=async hash=>receipts.get(hash)??null;
 f.options.provider.call=async({to,data})=>{assert.equal(to,scope.token);const parsed=token.parseTransaction({data});return token.encodeFunctionResult(parsed.name,[parsed.name==='balanceOf'?f.state.balance:f.state.allowance]);};
 f.wallet.signer.sendTransaction=async request=>{
  f.state.sends++;const hash=h(300+f.state.sends),blockNumber=16+f.state.sends,tx={...request,hash,blockNumber,value:String(request.value),chainId:String(request.chainId)};transactions.set(hash,tx);
  let log;
  if(request.to===scope.token){const parsed=token.parseTransaction({data:request.data});assert.equal(parsed.name,'approve');assert.equal(parsed.args[0].toLowerCase(),scope.portal);if(!f.state.revert)f.state.allowance=parsed.args[1];log={address:scope.token,...token.encodeEventLog('Approval',[f.wallet.address,scope.portal,parsed.args[1]])};}
  else{assert.equal(request.to,scope.portal);const p=deposit.parseTransaction({data:request.data});const abi=kind==='bok'?bok:fee;log={address:scope.portal,...abi.encodeEventLog(kind==='bok'?'Deposited':'DepositToAztecPublic',kind==='bok'?[p.args[0],p.args[1],h(32),3]:[p.args[0],p.args[1],p.args[2],h(31),2])};}
  receipts.set(hash,{hash,from:f.wallet.address,to:request.to,blockNumber,blockHash:h(blockNumber),status:f.state.revert?0:1,logs:f.state.revert?[]:[log]});
  if(f.state.unknown)throw Error('labelled lost acknowledgement');return {hash};
 };
 f.options.verifyClaim=async hash=>assert.equal(hash,h(70));f.options.resolveScope=async()=>scope;f.options.kind=kind;f.options.reconcileClaim=async()=>({status:'confirmed'});
 return {...f,scope,transactions,receipts,allocation:{amount:'300',gasBudgetWei:'10000',privateFeeCap:'1000'},open:()=>createStandaloneTopupWallet(f.options)};
}
for(const kind of ['private-fee','bok'])test(`direct ${kind} top-up reviews approval and deposit separately, with real journal receipts and no collateral`,async()=>{
 const f=topupFixture(kind),cap=await f.open();assert.equal((await cap.prepare(f.allocation)).phase,'approval');assert.equal(f.state.sends,0);
 assert.deepEqual(await cap.confirm(),{approved:true});assert.equal(f.state.sends,1);
 assert.equal((await advanceAggregateClaim({funding:cap,application:{}})).state,'review-payment');
 const reopened=await f.open();assert.equal((await reopened.prepare(f.allocation)).phase,'deposit');assert.equal(f.state.sends,1);
 const result=await reopened.confirm();assert.equal(result.receipt.amount,'300');assert.equal(result.receipt.nonce,'8');assert.equal(f.state.sends,2);
 const context=await reopened.loadAggregate(result.receipt.txHash);if(kind==='bok'){assert.equal(context.bokScope.recipient,f.scope.recipient);assert(context.bridgeSecret);assert.equal(context.intent,undefined);}else assert.equal(context,null);
 await assert.rejects(reopened.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 await reopened.checkpointClaim({intentId:h(900),attempted:true});await reopened.prepare(f.allocation);assert.equal(f.state.sends,2);if(kind==='bok')assert.deepEqual(await reopened.loadAggregate(result.receipt.txHash),context);
});
test('direct top-up lost submission reply only recovers original receipt; changed scope and extra effects fail',async()=>{
 const f=topupFixture(),cap=await f.open();f.state.allowance=1000n;await cap.prepare(f.allocation);f.state.unknown=true;await assert.rejects(cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
 const reopened=await f.open(),result=await reopened.recover();assert.equal(f.state.sends,1);assert.equal(result.receipt.txHash,h(301));
 const receipt=f.receipts.get(h(301));receipt.logs.push(receipt.logs[0]);await assert.rejects(reopened.recover());assert.equal(f.state.sends,1);
 f.options.resolveScope=async()=>({...f.scope,portal:a(999)});assert.equal(await (await f.open()).inspect(),null);
});
for(const code of ['ACTION_REJECTED','INSUFFICIENT_FUNDS'])test(`direct top-up ${code} restores only the never-sent draft for explicit review`,async()=>{
 const f=topupFixture(),cap=await f.open();await cap.prepare(f.allocation);f.wallet.signer.sendTransaction=async()=>{throw Object.assign(Error('labelled'),{code});};
 await assert.rejects(cap.confirm());assert.equal(await cap.inspect(),null);assert.equal(f.state.sends,0);assert.equal((await cap.prepare(f.allocation)).phase,'approval');
});
test('direct top-up re-reviews changed amount after approval and stops changed account or gas before send',async()=>{
 const f=topupFixture(),cap=await f.open();await cap.prepare(f.allocation);await cap.confirm();assert.equal((await cap.prepare({...f.allocation,amount:'301'})).phase,'approval');assert.equal(f.state.sends,1);
 await cap.prepare(f.allocation);f.state.invalid=true;await assert.rejects(cap.confirm());assert.equal(f.state.sends,1);
 f.state.invalid=false;await cap.prepare(f.allocation);f.options.provider.getFeeData=async()=>({maxFeePerGas:99999n});await assert.rejects(cap.confirm());assert.equal(f.state.sends,1);
});

for(const kind of ['private-fee','bok'])for(const cut of ['prepare','attempt'])test(`direct ${kind} original private claim resumes ${cut} crash without collateral or repeat payment`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();workflow=durableClaimApplication(f,funding);
 const prepared=await workflow.open().prepare({type:kind==='bok'?'claim-bok':'claim-private-fee',...receipts});if(cut==='attempt')await funding.checkpointClaim({intentId:prepared.intentId,attempted:true});
 const result=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(result.state,cut==='attempt'?'review-saved':'complete');assert.equal(result.intent.action.type,kind==='bok'?'claim-bok':'claim-private-fee');assert.equal(workflow.state.sends,cut==='attempt'?0:1);assert.equal(f.state.sends,1);
});
for(const kind of ['private-fee','bok'])test(`direct ${kind} canonical reverted payment needs fresh review and retains failed custody`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;f.state.revert=true;const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm(),{code:'BB_ETH_TRANSACTION_FAILED'});const before=f.records.size;
 const q=await(await f.open()).prepare(f.allocation);assert.equal(q.phase,'deposit');assert.equal(f.state.sends,1);assert.equal(f.records.size,before+1);
 const receipt=f.receipts.get(h(301));receipt.blockHash=h(999);await assert.rejects(funding.prepare(f.allocation));assert.equal(f.state.sends,1);
});

for(const kind of ['private-fee','bok'])test(`direct ${kind} confirmed claim survives later workflow replacement but rejects a reorg`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();workflow=durableClaimApplication(f,funding);
 const complete=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(complete.state,'complete');assert.equal(workflow.state.sends,1);
 f.options.reconcileClaim=async()=>{throw Error('labelled subsequent workflow replaced old slot');};
 await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,1);
 const successor=await f.open();await successor.prepare(f.allocation);f.options.verifyClaim=async()=>{throw Error('labelled canonical claim reorg');};await assert.rejects((await f.open()).prepare(f.allocation),/canonical claim reorg/);assert.equal(f.state.sends,1);
 // The captured callback can observe a chain change after review, before send.
 f.options.verifyClaim=async()=>{};let canonical=true;f.options.verifyClaim=async()=>{if(!canonical)throw Error('claim changed after review');};const race=await f.open();await race.prepare(f.allocation);canonical=false;await assert.rejects(race.confirm(),/claim changed after review/);assert.equal(f.state.sends,1);
});

import {submitWithFundingCheckpoint} from './aggregate-wallet.mjs';
for(const kind of ['private-fee','bok'])test(`direct ${kind} manual over-cap claim checkpoints before send and retains confirmed successor`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare({...f.allocation,privateFeeCap:'1'});await funding.confirm();workflow=durableClaimApplication(f,funding);
 const review=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(review.state,'review');assert.equal((await funding.inspect()).claim.attempted,false);assert.equal(workflow.state.sends,0);
 const original=workflow.open(),application={...original,submitPrepared:async id=>{assert.equal((await funding.inspect()).claim.attempted,true);return original.submitPrepared(id);}};
 const done=await submitWithFundingCheckpoint({application,topups:{[kind]:funding},intentId:review.intent.intentId});assert.equal(done.status,'confirmed');assert.equal(workflow.state.sends,1);
 f.options.reconcileClaim=async()=>{throw Error('later unrelated workflow');};await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,1);
});

test('direct top-up manual checkpoint rejects substituted receipt and leaves unrelated imported claim alone',async()=>{
 const f=topupFixture(),funding=await f.open();f.state.allowance=1000n;await funding.prepare(f.allocation);const {receipt}=await funding.confirm();await funding.checkpointClaim({intentId:h(901),attempted:false});let sends=0;
 const app=id=>({reconcile:async()=>({intentId:id,status:'prepared',action:{type:'claim-bok',receipt:{...receipt,amount:'999'}}}),submitPrepared:async()=>{sends++;return {status:'unknown'};}});
 await assert.rejects(submitWithFundingCheckpoint({application:app(h(901)),topups:{bok:funding},intentId:h(901)}),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(sends,0);assert.equal((await funding.inspect()).claim.attempted,false);
 await submitWithFundingCheckpoint({application:app(h(902)),topups:{bok:funding},intentId:h(902)});assert.equal(sends,1);assert.equal((await funding.inspect()).claim.attempted,false);
});

function claimProgressFixture(failureStep,original){
 const rows=[],calls=[],run=(name,value)=>async()=>{calls.push(name);if(name===failureStep)throw original;return value;};
 const saved={paymentSaved:true,privateFeeCap:'10',claim:failureStep==='reconcile'?{intentId:'PRIVATE_ID',attempted:true}:null};
 const prepared={intentId:'PRIVATE_ID',status:'prepared',maximumFee:'10'},confirmed={...prepared,status:'confirmed'};
 return {rows,calls,input:{onProgress:row=>rows.push(row),funding:{inspect:run('inspect',saved),recover:run('recover',{receipt:{private:'SECRET_RECEIPT'}}),checkpointClaim:run('checkpoint'),recordClaimCompletion:run('record')},application:{readFundingState:run('account-status',{status:'ready'}),prepare:run('prepare',prepared),submitPrepared:run('submit',confirmed),reconcile:run('reconcile',confirmed)}}};
}
for(const step of ['inspect','recover','account-status','prepare','checkpoint','submit','reconcile'])test('claim progress reports exact failing '+step+' without exposing original exception or values',async()=>{
 const original=Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_FUNDING_MISMATCH'}),f=claimProgressFixture(step,original);
 await assert.rejects(advanceAggregateClaim(f.input),e=>e===original);assert.deepEqual(f.rows.at(-1),{stage:'funding-claim',step,deploymentStep:null,state:'failed',code:'ROLLING_FUNDING_MISMATCH'});
 assert.equal(f.rows.filter(r=>r.state==='failed').length,1);assert(f.rows.every(Object.isFrozen));assert(!JSON.stringify(f.rows).match(/PRIVATE|SECRET/));assert(!f.calls.includes('submit')||step==='submit');
});
test('claim progress preserves successful order and diagnostics cannot change submission',async()=>{
 const f=claimProgressFixture();f.input.onProgress=row=>{f.rows.push(row);if(row.state==='started')throw Error('OBSERVER');return Promise.reject(Error('OBSERVER'));};
 assert.equal((await advanceAggregateClaim(f.input)).state,'complete');assert.deepEqual(f.calls,['inspect','recover','account-status','prepare','checkpoint','checkpoint','submit','record']);
 assert.deepEqual(f.rows.filter(r=>r.state==='started').map(r=>r.step),['inspect','recover','account-status','prepare','checkpoint','checkpoint','submit','checkpoint']);assert(f.rows.every(r=>r.code===null));
});
for(const original of [undefined,null,false,0,'PRIVATE_SENTINEL',Object.assign(Error('PRIVATE_SENTINEL'),{code:'PRIVATE_SENTINEL'}),Object.defineProperty({},'code',{get(){throw Error('GETTER_SENTINEL');}})])test('claim progress retains original unusual failure '+String(typeof original),async()=>{
 const f=claimProgressFixture('prepare',original);let caught=false;try{await advanceAggregateClaim(f.input);}catch(e){caught=true;assert.equal(e,original);}assert(caught);assert.equal(f.rows.at(-1).code,'unknown');assert.equal(f.rows.filter(r=>r.state==='failed').length,1);assert(!JSON.stringify(f.rows).includes('SENTINEL'));
});
test('claim progress retains waiting semantics for bridge and claim availability failures',async()=>{
 for(const [step,code]of [['recover','ROLLING_FUNDING_PENDING'],['prepare','ROLLING_FUNDING_NOT_READY']]){const f=claimProgressFixture(step,Object.assign(Error('private'),{code}));assert.deepEqual(await advanceAggregateClaim(f.input),{state:'waiting',phase:step==='recover'?'payment':'bridge'});assert.equal(f.rows.at(-1).code,code);assert(!f.calls.includes('submit'));}
});

test('USDC lost submit response recovers the original relay hash and pending receipt without another POST',async()=>{
 const f=usdcWalletFixture(),original=f.options.relay.submit;let landed=false,waits=0;
 f.options.relay.submit=async data=>{await original(data);throw Error('lost HTTP response');};
 f.options.provider.getTransactionReceipt=async()=>landed?f.state.usdcReceipt:null;
 const get=f.options.provider.getTransaction;f.options.provider.getTransaction=async hash=>{const tx=await get(hash);return tx&&Object.assign(tx,{replaceableTransaction:start=>{assert.equal(start,16);return {wait:async(confirmations,timeout)=>{assert.equal(confirmations,1);assert.equal(timeout,undefined);waits++;landed=true;return f.state.usdcReceipt;}};}});};
 const app=await f.open();await app.prepare(f.allocation);await app.confirm();
 f.options.relay.status=async()=>{throw Error('hash already retained');};
 assert.equal((await app.recover({wait:true})).receipt.txHash,h(200));assert.equal(waits,1);assert.equal(f.state.posts,1);
});
test('USDC malformed or changed submit hash never becomes verified funding',async()=>{
 const f=usdcWalletFixture(),original=f.options.relay.submit;
 f.options.relay.submit=async data=>({...await original(data),planHash:h(999)});
 const app=await f.open();await app.prepare(f.allocation);await assert.rejects(app.confirm(),{code:'ROLLING_FUNDING_RELAY_SCOPE'});
 assert.equal(f.state.posts,1);assert.equal((await app.recover()).receipt.txHash,h(200));assert.equal(f.state.posts,1);
});
test('known original ETH hash waits for receipt then rechecks canonical effects without rebroadcast',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();f.state.landed=false;let waits=0;
 const get=f.options.provider.getTransaction;f.options.provider.getTransaction=async hash=>{const tx=await get(hash);return tx&&Object.assign(tx,{replaceableTransaction:start=>{assert.equal(start,16);return {wait:async(confirmations,timeout)=>{assert.equal(confirmations,1);assert.equal(timeout,undefined);waits++;f.state.landed=true;return {};}};}});};
 assert.equal((await app.recover({wait:true})).receipt.txHash,h(20));assert.equal(waits,1);assert.equal(f.state.sends,1);
});

for(const [asset,make] of [['ETH',fixture],['USDC',usdcWalletFixture]])for(const code of [4001,'ACTION_REJECTED'])test(`${asset} rejected consent preserves custody and permits only a fresh reviewed quote (${code})`,async()=>{
 const f=make(),funding=await f.open();await funding.prepare(f.allocation);const original=f.wallet.signer.signTypedData;
 f.wallet.signer.signTypedData=async()=>{throw Object.assign(Error('PRIVATE_SENTINEL'),{code});};
 await assert.rejects(funding.confirm(),{code:'ROLLING_FUNDING_SIGNATURE_CANCELLED'});
 assert.equal((await funding.inspect()).paymentSaved,false);assert.equal(f.state.invalid,false);assert.equal(f.state.sends,0);assert.equal(f.state.posts??0,0);
 await assert.rejects(funding.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 f.wallet.signer.signTypedData=original;await funding.prepare(f.allocation);await funding.confirm();
 assert.equal(asset==='ETH'?f.state.sends:f.state.posts,1);
});
test('consent opens before repeated scope reads, but a changed scope prevents payment and durable intent',async()=>{
 const f=fixture();let checks=0;f.options.verifyScope=async()=>{checks++;return async()=>{checks++;assert.equal(f.state.signatures,1);throw Error('Changed scope');};};
 const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm(),/Changed scope/);
 assert.equal(checks,2);assert.equal(f.state.sends,0);assert.equal((await funding.inspect()).paymentSaved,false);
});
test('rejected consent does not hide an actual changed account',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);
 f.wallet.signer.signTypedData=async()=>{f.state.invalid=true;throw Object.assign(Error('Cancelled'),{code:4001});};
 await assert.rejects(funding.confirm(),/Context changed/);assert.equal(f.state.sends,0);
});

test('USDC consent delay cannot open an already expired authorization prompt',async()=>{
 const f=usdcWalletFixture(),funding=await f.open();await funding.prepare(f.allocation);const sign=f.wallet.signer.signTypedData;
 f.wallet.signer.signTypedData=async(...args)=>{const value=await sign(...args);f.state.pendingTime=1901;return value;};
 await assert.rejects(funding.confirm(),{code:'AGGREGATE_STALE_QUOTE'});assert.equal(f.state.signatures,1);assert.equal(f.state.posts,0);assert.equal((await funding.inspect()).paymentSaved,false);
});

for(const asset of ['ETH','USDC'])test(asset+' funding rejects unaffordable new payment before quote RPC or signatures',async()=>{
 const f=asset==='ETH'?fixture():usdcWalletFixture();f.state.creditRejected=true;
 const funding=await f.open();await assert.rejects(funding.prepare(f.allocation),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT'});
 assert.equal(f.state.reads,0);assert.equal(f.state.signatures,0);assert.equal(f.state.sends,0);assert.equal(f.state.posts??0,0);assert.equal(f.records.size,0);
});
for(const asset of ['ETH','USDC'])test(asset+' rechecks private credit before first signature and before dispatch',async()=>{
 const f=asset==='ETH'?fixture():usdcWalletFixture(),funding=await f.open();await funding.prepare(f.allocation);
 f.state.creditRejected=true;await assert.rejects(funding.confirm(),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT'});assert.equal(f.state.signatures,0);
 f.state.creditRejected=false;await funding.prepare(f.allocation);const sign=f.wallet.signer.signTypedData;
 f.wallet.signer.signTypedData=async(...args)=>{const result=await sign(...args);f.state.creditRejected=true;return result;};
 await assert.rejects(funding.confirm(),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT'});assert.equal(f.state.sends,0);assert.equal(f.state.posts??0,0);
});
test('already-paid funding recovery does not rerun new-payment eligibility',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();const checks=f.state.creditChecks;
 f.state.creditRejected=true;const receipt=await funding.recover();assert(receipt.receipt.txHash);assert.equal(f.state.creditChecks,checks);assert.equal(f.state.sends,1);
});

for(const asset of ['ETH','USDC'])test(asset+' expiry during final credit check prevents payment dispatch',async()=>{
 const f=asset==='ETH'?fixture():usdcWalletFixture();const verify=f.options.verifyFeeCredit;let checks=0;
 f.options.verifyFeeCredit=async amount=>{await verify(amount);if(++checks===3)f.state.pendingTime=1901;};
 const funding=await f.open();await funding.prepare(f.allocation);
 await assert.rejects(funding.confirm(),{code:'AGGREGATE_STALE_QUOTE'});
 assert.equal(checks,3);assert.equal(f.state.sends,0);assert.equal(f.state.posts??0,0);assert.equal((await funding.inspect()).paymentSaved,false);
});

test('starter funding derives the minimum deposit and funds the claim plus another action',async()=>{
 const {starterFundingAllocation}=await import('./aggregate-wallet.mjs');let reads=0;
 const eth=await starterFundingAllocation({asset:'ETH',minDeposit:'123456789',privateFeeCap:'700',provider:{async getFeeData(){reads++;return {maxFeePerGas:2n,gasPrice:1n};}}});
 assert.deepEqual(eth,{asset:'ETH',collateralWei:'123456789',feeAmount:'1400',bokAmount:'0',feePoolFee:3000,slippageBps:100,privateFeeCap:'700',bokPoolFee:0,gasBudgetWei:'10000000'});assert.equal(reads,1);
 const usdc=await starterFundingAllocation({asset:'USDC',minDeposit:'400',privateFeeCap:'11',provider:{getFeeData(){throw Error('USDC must use relay pricing');}}});
 assert.equal(usdc.bokAmount,'0');assert.equal(usdc.feeAmount,'22');assert.equal(usdc.collateralWei,'400');assert.equal(usdc.gasBudgetWei,undefined);assert.equal(usdc.collateralPoolFee,3000);
 await assert.rejects(starterFundingAllocation({asset:'ETH',minDeposit:'1',privateFeeCap:'1',provider:{async getFeeData(){return {maxFeePerGas:null,gasPrice:null};}}}),{code:'ROLLING_FUNDING_GAS_UNAVAILABLE'});
});

test('direct top-up estimates fees without imposing an unapproved stale gas-price ceiling',async()=>{
 const f=topupFixture(),cap=await f.open();const {gasBudgetWei,...input}=f.allocation;
 const quote=await cap.prepare(input);assert.equal(quote.gasBudgetWei,'400');assert.equal(f.state.sends,0);
 f.options.provider.getFeeData=async()=>({maxFeePerGas:3n});await cap.confirm();assert.equal(f.state.sends,1);assert.equal([...f.transactions.values()][0].maxFeePerGas,3n);
});


test('zero Bok aggregate payment retains two exact receipts without any Bok secret or claim',async()=>{
 const f=fixture(),scopes=[];f.options.bok=undefined;
 f.options.verifyScope=async value=>{scopes.push(value);return async()=>{};};
 f.options.sdk.poseidon2HashWithSeparator=()=>{throw Error('Zero Bok must not derive plugin custody');};
 const app=await f.open();await app.prepare({...f.allocation,bokAmount:'0',bokPoolFee:0});
 assert.deepEqual(scopes,[{includeBok:false,asset:'ETH'}]);
 const receipts=await app.confirm();assert.deepEqual(Object.keys(receipts).sort(),['feeReceipt','receipt']);
 const reopened=await f.open(),custody=await reopened.loadAggregate(receipts.receipt.txHash);
 assert.equal(custody.bokScope,null);assert.equal(custody.recipientSalt,null);assert.equal(custody.bridgeSecret,null);
 assert.deepEqual(await reopened.recover(),receipts);assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
 await reopened.checkpointClaim({intentId:h(100),attempted:false});
 await reopened.checkpointSubmission(h(100),{type:'claim-deposit',...receipts});
 await assert.rejects(reopened.checkpointSubmission(h(100),{type:'claim-deposit',receipt:receipts.receipt}),{code:'ROLLING_FUNDING_MISMATCH'});
 await assert.rejects(reopened.checkpointSubmission(h(100),{type:'claim-deposit',...receipts,bokReceipt:receipts.feeReceipt}),{code:'ROLLING_FUNDING_MISMATCH'});
});

import {prepareBokCreditPurchase,bokCreditPurchaseAbi,validateBokCreditPurchaseIntent} from './bok-credit-purchase.mjs';
const purchaseInterface=new ethers.Interface(bokCreditPurchaseAbi);
import {runTopupPayment,aggregateFundingFailure} from '../../apps/rolling/wallet-panel.mjs';
function ethTopupFixture(){
 const f=topupFixture(),s=f.options.scope;f.options.topupScope=s;f.state.balance=0n;
 const call=f.options.provider.call,getBlock=f.options.provider.getBlock,send=f.wallet.signer.sendTransaction;
 f.options.provider.getBlock=async tag=>({...await getBlock(tag),timestamp:1000});
 f.options.provider.call=async request=>request.to===f.scope.token?call(request):f.options.provider.send('eth_call',[request,'0x10']);
 f.wallet.signer.sendTransaction=async request=>{
  if(request.to!==s.router)return send(request);
  assert.equal(request.to,s.router);f.state.sends++;
  const hash=h(300+f.state.sends),blockNumber=16+f.state.sends,tx={...request,hash,blockNumber,value:String(request.value),chainId:String(request.chainId)};
  const parsed=purchaseInterface.parseTransaction({data:request.data}),p=parsed.args[0];assert.equal(parsed.name,'buyCredit');
  assert.equal(String(p.deadline),'1900');assert.equal(String(p.amount),'300');
  f.transactions.set(hash,tx);
  f.receipts.set(hash,{hash,from:f.wallet.address,to:request.to,blockNumber,blockHash:h(blockNumber),status:1,logs:[
   {address:s.router,...purchaseInterface.encodeEventLog('CreditPurchased',[f.wallet.address,p.commitment,p.amount,p.secretHash,h(32),3,300,3])},
   {address:f.scope.portal,...bok.encodeEventLog('Deposited',[p.commitment,p.amount,h(32),3])},
  ]});
  if(f.state.unknown)throw Error('Lost payment acknowledgement.');return {hash};
 };
 return {...f,allocation:{...f.allocation,asset:'ETH'}};
}

test('USDC top-up reports insufficient wallet tokens before any payment',async()=>{
 const f=topupFixture();f.state.balance=0n;
 await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_FUNDING_TOKEN_BALANCE'});
 assert.equal(f.state.sends,0);
});

test('ETH Bok purchase swaps and bridges with one wallet transaction',async()=>{
 const f=ethTopupFixture(),cap=await f.open(),quote=await cap.prepare(f.allocation),phases=[];
 assert.equal(quote.phase,'deposit');assert.equal(quote.maximumSwapWei,'303');assert.equal(f.state.sends,0);
 const result=await runTopupPayment(cap,f.allocation,quote,phase=>phases.push(phase));
 assert.deepEqual(phases,['deposit','confirmation']);assert.equal(f.state.sends,1);assert.equal(result.receipt.amount,'300');
 assert.deepEqual([...f.transactions.values()].map(tx=>tx.to),[f.options.scope.router]);
 assert.deepEqual([...f.transactions.values()].map(tx=>tx.value),['303']);
 const custody=await cap.loadAggregate(result.receipt.txHash);assert(custody.bridgeSecret&&custody.recipientSalt);
});
test('confirmed ETH purchase survives reopen without a second payment',async()=>{
 const f=ethTopupFixture(),first=await f.open();await first.prepare(f.allocation);const result=await first.confirm();
 const next=await f.open();assert.deepEqual(await next.recover(),result);assert.equal(f.state.sends,1);
 await assert.rejects(next.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
});
test('lost ETH purchase reply reconciles the original receipt without repeating payment',async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare(f.allocation);f.state.unknown=true;
 await assert.rejects(cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.equal(f.state.sends,1);
 f.state.unknown=false;const result=await (await f.open()).recover();assert.equal(result.receipt.amount,'300');assert.equal(f.state.sends,1);
});
test('ETH purchase validates configured router code and refuses altered recipient or value',async()=>{
 const f=ethTopupFixture();f.options.topupScope={...f.options.scope,routerCodeHash:h(901)};
 await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_FUNDING_PURCHASE_SCOPE'});assert.equal(f.state.sends,0);
 const g=ethTopupFixture(),cap=await g.open();await cap.prepare(g.allocation);await cap.confirm();
 const saved=await (await g.options.sdk.createEthereumJournal({storage:g.options.storage,walletSecret:g.options.walletSecret,walletSalt:g.options.walletSalt,
  scope:{account:g.options.owner,...g.options.network,board:g.scope.recipient,portal:g.options.scope.router,token:g.scope.token,depositor:g.wallet.address},provider:g.options.provider})).inspectRequest();
 const scope={portal:g.options.scope.router,token:g.scope.token};validateBokCreditPurchaseIntent(saved,scope);
 assert.throws(()=>validateBokCreditPurchaseIntent({...saved,expected:{...saved.expected,recipient:a(999)}},scope));
 assert.throws(()=>validateBokCreditPurchaseIntent({...saved,value:'999'},scope));
});

test('payment continuation stops at failed wallet stage and preserves actionable code',async()=>{
 let prepares=0,sends=0;const events=[];
 const cap={async confirm(){sends++;throw Object.assign(Error('private detail'),{code:'BB_ETH_REQUEST_CANCELLED'});},async prepare(){prepares++;}};
 await assert.rejects(runTopupPayment(cap,{}, {phase:'swap'},phase=>events.push(phase)),error=>error.code==='BB_ETH_REQUEST_CANCELLED'&&error.topupStage==='swap'&&!error.message.includes('private detail'));
 assert.deepEqual(events,['swap']);assert.equal(sends,1);assert.equal(prepares,0);
});


test('credit errors identify missing USDC, cancelled exchange, and retained USDC after later cancellation',async()=>{
 assert.match(aggregateFundingFailure({code:'ROLLING_FUNDING_TOKEN_BALANCE'}),/Choose Pay with ETH/);
 assert.equal(aggregateFundingFailure({code:'BB_ETH_REQUEST_CANCELLED',topupStage:'swap'}),'ETH exchange cancelled. No ETH was spent.');
 let confirms=0;
 const cap={async confirm(){if(++confirms===1)return {swapped:true};throw Object.assign(Error('private detail'),{code:'BB_ETH_REQUEST_CANCELLED'});},async prepare(){return {phase:'approval'};}};
 await assert.rejects(runTopupPayment(cap,{}, {phase:'swap'}),error=>{
  assert.equal(error.topupStage,'approval');assert.equal(error.topupExchanged,true);
  assert.match(aggregateFundingFailure(error),/USDC is in your wallet/);return true;
 });
 assert.match(aggregateFundingFailure({code:'UNKNOWN',topupStage:'claim'}),/payment was sent/);
});

test('ETH credit continuation awaits native receipt completion with no second wallet prompt',async()=>{
 const f=ethTopupFixture(),send=f.wallet.signer.sendTransaction,getBlock=f.options.provider.getBlock,getHead=f.options.provider.getBlockNumber;
 let pending=false,release,waitStarted;
 const started=new Promise(resolve=>{waitStarted=resolve;});
 f.options.provider.getBlockNumber=()=>pending?Promise.resolve(16):getHead();
 f.options.provider.getBlock=tag=>pending&&(tag==='latest'||tag===16)?Promise.resolve({number:16,hash:h(16),timestamp:1000,prefetchedTransactions:[]}):getBlock(tag);
 f.wallet.signer.sendTransaction=async request=>{
  const response=await send(request);
  if(request.to!==f.options.scope.router)return response;
  pending=true;const receipt=f.receipts.get(response.hash);f.receipts.delete(response.hash);
  const tx=f.transactions.get(response.hash);tx.replaceableTransaction=()=>({wait:()=>new Promise(resolve=>{
   release=()=>{pending=false;f.receipts.set(response.hash,receipt);resolve(receipt);};waitStarted();
  })});
  return response;
 };
 const cap=await f.open(),quote=await cap.prepare(f.allocation),phases=[];
 const result=runTopupPayment(cap,f.allocation,quote,phase=>phases.push(phase));
 await started;assert.equal(f.state.sends,1);assert.deepEqual(phases,['deposit','confirmation']);
 release();await result;assert.deepEqual(phases,['deposit','confirmation']);assert.equal(f.state.sends,1);
});

test('ETH purchase completes the original private Bok claim and allows a later independent credit purchase',async()=>{
 const f=ethTopupFixture();let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);
 const funding=await f.open();await runTopupPayment(funding,f.allocation,await funding.prepare(f.allocation));
 workflow=durableClaimApplication(f,funding);
 const done=await advanceAggregateClaim({application:workflow.open(),funding});
 assert.equal(done.state,'complete');assert.equal(done.intent.action.type,'claim-bok');assert.equal(workflow.state.sends,1);assert.equal(f.state.sends,1);
 const next=await f.open(),quote=await next.prepare(f.allocation);assert.equal(quote.phase,'deposit');
 await runTopupPayment(next,f.allocation,quote);assert.equal(f.state.sends,2);
});

test('posting token balance failure does not suggest USDC or an unavailable ETH option',async()=>{
 const f=topupFixture('private-fee');f.state.balance=0n;
 await assert.rejects((await f.open()).prepare(f.allocation),error=>{
  assert.equal(error.code,'ROLLING_FUNDING_FEE_TOKEN_BALANCE');
  const text=aggregateFundingFailure(error);assert.match(text,/fee tokens/);assert.doesNotMatch(text,/USDC|ETH/);return true;
 });assert.equal(f.state.sends,0);
});

test('fresh ETH funding uses the verified waiter result without a second receipt recovery',async()=>{
 const f=fixture(),recoverCalls=[];const original=f.options.sdk.createEthereumJournal;
 f.options.sdk.createEthereumJournal=async options=>{
  const journal=await original(options);
  return {...journal,recover:async options=>{recoverCalls.push(options);if(options.wait)f.state.landed=true;return journal.recover(options);}};
 };
 const app=await f.open();await app.prepare(f.allocation);await app.confirm();f.state.landed=false;
 const result=await app.recover({wait:true});
 assert.equal(result.receipt.txHash,h(20));assert.equal(f.state.sends,1);
 assert.deepEqual(recoverCalls,[{retry:false},{retry:false,wait:true}]);
});

test('automatic funding prepares directly for submission, including after bridge readiness',async()=>{
 const f=claimProgressFixture(),prepare=f.input.application.prepare,calls=[];let bridgeWaits=0;
 f.input.application.prepare=async(action,options)=>{
  calls.push({action,options});
  if(calls.length===1)throw Object.assign(Error('bridge pending'),{code:'ROLLING_FUNDING_NOT_READY',reason:'l2-delivery'});
  return prepare(action,options);
 };
 f.input.waits={bridge:async()=>{bridgeWaits++;},claim:()=>assert.fail('Already confirmed')};
 assert.equal((await advanceAggregateClaim(f.input)).state,'complete');assert.equal(bridgeWaits,2);assert.equal(calls.length,2);
 for(const call of calls)assert.deepEqual(call,{action:{type:'claim-deposit',receipt:{private:'SECRET_RECEIPT'}},options:{immediate:true,maximumFee:'10'}});
 assert.equal(f.calls.filter(call=>call==='submit').length,1);
});
test('automatic ETH topup fee refresh accepts current gas price at wallet confirmation',async()=>{
 const f=ethTopupFixture(),input={amount:'300',asset:'ETH',privateFeeCap:'1000'},cap=await f.open();
 await cap.prepare(input);f.options.provider.getFeeData=async()=>({maxFeePerGas:3n,maxPriorityFeePerGas:1n});
 await cap.confirm();assert.equal(f.state.sends,1);assert.equal([...f.transactions.values()][0].maxFeePerGas,3n);
});
test('explicit fee cap failure occurs before wallet call and permits a fresh quote',async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare(f.allocation);
 f.options.provider.getFeeData=async()=>({maxFeePerGas:100000n,maxPriorityFeePerGas:1n});
 await assert.rejects(cap.confirm(),{code:'BB_ETH_PREFLIGHT_FAILED',ethereumStage:'preflight'});assert.equal(f.state.sends,0);
 assert.equal(await cap.inspect(),null);f.options.provider.getFeeData=async()=>({maxFeePerGas:1n,maxPriorityFeePerGas:0n});await cap.prepare(f.allocation);
});
test('atomic ETH purchase does not query unused wallet token balance or allowance',async()=>{
 const f=ethTopupFixture(),call=f.options.provider.call;f.options.provider.call=request=>{assert.notEqual(request.to,f.scope.token);return call(request);};
 await (await f.open()).prepare(f.allocation);
});

test('switching an unfinished USDC approval to ETH creates an atomic purchase without requiring USDC',async()=>{
 const f=ethTopupFixture();f.state.balance=300n;const first=await f.open();
 assert.equal((await first.prepare({...f.allocation,asset:'USDC'})).phase,'approval');assert.deepEqual(await first.confirm(),{approved:true});
 f.state.balance=0n;const next=await f.open(),quote=await next.prepare(f.allocation);assert.equal(quote.phase,'deposit');assert.equal(quote.asset,'ETH');assert.equal(quote.maximumSwapWei,'303');
 assert.equal((await next.confirm()).receipt.amount,'300');assert.equal(f.state.sends,2);
 assert.deepEqual([...f.transactions.values()].map(tx=>tx.to),[f.scope.token,f.options.topupScope.router]);
});

test('ETH confirmation simulates once then the real journal estimates the exact signed calldata once',async()=>{
 const f=fixture(),app=await f.open(),seen=[],original=f.options.provider.send,estimate=f.options.provider.estimateGas;
 f.options.provider.send=async(method,params)=>{if(method==='eth_call'&&params[1]==='pending'){seen.push({phase:'simulate',request:params[0]});assert.equal(f.state.sends,0);assert.equal((await app.inspect()).paymentSaved,false);}return original(method,params);};
 f.options.provider.estimateGas=async request=>{seen.push({phase:'estimate',request:{...request}});return estimate(request);};
 await app.prepare(f.allocation);await app.confirm();
 assert.deepEqual(seen.map(value=>value.phase),['simulate','estimate']);
 for(const key of ['from','to','data'])assert.equal(seen[0].request[key],seen[1].request[key]);
 assert.equal(BigInt(seen[0].request.value),BigInt(seen[1].request.value));assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
});
for(const change of ['pending-state','expiry','encoded-request'])test(`ETH final authority rejects ${change} changed during gas estimation without sending`,async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);
 const original=f.options.provider.estimateGas;
 f.options.provider.estimateGas=async request=>{
  if(change==='pending-state')throw Object.assign(Error('pending EVM execution reverted'),{code:'CALL_EXCEPTION'});
  if(change==='expiry')f.state.pendingTime=1901;
  return original(request);
 };
 if(change==='encoded-request'){
  const encode=f.options.sdk.encodeAggregateFundingTransaction;
  f.options.sdk.encodeAggregateFundingTransaction=(...args)=>({...encode(...args),value:'1'});
 }
 await assert.rejects(app.confirm());assert.equal(f.state.sends,0);assert.equal((await app.inspect()).paymentSaved,false);
});

for(const owned of [false,true])test(`top-up admission stays fresh while custody uses its fixed namespace: ${owned}`,async()=>{
 const f=topupFixture();f.state.allowance=1000n;let operation={},scopes=0;
 f.options.resolveScope=async()=>{scopes++;return f.scope;};if(owned)f.options.operationScope=()=>operation;
 const cap=await f.open();await cap.prepare(f.allocation);assert.equal(scopes,1);
 operation={};scopes=0;await cap.confirm();assert.equal(scopes,1,'Fresh presend qualification remains immediately before payment');
 operation={};scopes=0;
 await cap.inspect();await cap.recover();await cap.checkpointClaim({intentId:h(900),attempted:false});await cap.checkpointClaim({intentId:h(900),attempted:true});
 assert.equal(scopes,0,'Local custody plumbing does not repeat admission');
 operation={};await cap.inspect();assert.equal(scopes,0,'Native anchor invalidation does not change the custody namespace');
});
for(const change of ['scope','guard','operation'])test(`top-up scope reuse refuses ${change} changes`,async()=>{
 const f=topupFixture();let operation={},calls=0,invalid=false;
 f.options.operationScope=()=>operation;
 f.options.contextGuard=async()=>{if(invalid)throw Error('Account replaced');};
 f.options.resolveScope=async()=>{calls++;return f.scope;};
 const cap=await f.open();await cap.inspect();assert.equal(calls,1);
 if(change==='guard'){invalid=true;await assert.rejects(cap.inspect(),/Account replaced/);assert.equal(calls,1);}
 else if(change==='scope'){operation={};f.scope.portal=a(999);assert.equal(await cap.inspect(),null);assert.equal(calls,1);await assert.rejects(cap.prepare(f.allocation),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(calls,2);assert.equal(f.state.sends,0);}
 else{
  operation={};const before=operation;f.options.resolveScope=async()=>f.scope;
  // Captured resolver switches the owned operation while it is being qualified.
  const g=topupFixture();g.options.operationScope=()=>operation;g.options.resolveScope=async()=>{operation={};return g.scope;};
  await assert.rejects((await g.open()).inspect(),{code:'ROLLING_FUNDING_MISMATCH'});assert.notEqual(operation,before);
 }
});
test('top-up presend failure leaves custody readable but cannot authorize another payment',async()=>{
 const f=topupFixture();f.state.allowance=1000n;let operation={},calls=0,reject=false;
 f.options.operationScope=()=>operation;f.options.resolveScope=async()=>{calls++;if(reject)throw Error('Portal disabled');return f.scope;};
 const cap=await f.open();await cap.prepare(f.allocation);operation={};
 const guard=f.wallet.guard;let guards=0;f.wallet.guard=async()=>{await guard();if(++guards===2)reject=true;};
 await assert.rejects(cap.confirm());assert.equal(f.state.sends,0);
 const before=calls;await cap.inspect();assert.equal(calls,before);await assert.rejects(cap.prepare(f.allocation),/Portal disabled/);assert.equal(calls,before+1);assert.equal(f.state.sends,0);
});

for(const asset of ['ETH','USDC'])test(`standalone ${asset} quote overlaps independent RPC waves without changing calls or final authority`,async()=>{
 const f=asset==='ETH'?ethTopupFixture():topupFixture();const cap=await f.open(),seen=[];
 let releaseHead,releaseGas,headEntered,nonceEntered,gasEntered,feeEntered;
 const headGate=new Promise(r=>releaseHead=r),gasGate=new Promise(r=>releaseGas=r);
 const headStarted=new Promise(r=>headEntered=r),nonceStarted=new Promise(r=>nonceEntered=r),gasStarted=new Promise(r=>gasEntered=r),feeStarted=new Promise(r=>feeEntered=r);
 const p=f.options.provider,head=p.getBlock,nonce=p.getTransactionCount,gas=p.estimateGas,fees=p.getFeeData;
 p.getBlock=async tag=>{if(tag==='latest'&&!seen.includes('head')){seen.push('head');headEntered();await headGate;}return head(tag);};
 p.getTransactionCount=async(...args)=>{seen.push('nonce');nonceEntered();return nonce(...args);};
 p.estimateGas=async request=>{seen.push('gas');gasEntered();await gasGate;return gas(request);};
 p.getFeeData=async()=>{seen.push('fees');feeEntered();return fees();};
 const preparation=cap.prepare(f.allocation);await headStarted;await nonceStarted;assert.deepEqual(seen,['head','nonce']);releaseHead();
 await gasStarted;await feeStarted;assert.deepEqual(seen,['head','nonce','gas','fees']);releaseGas();const quote=await preparation;
 assert.equal(quote.phase,asset==='ETH'?'deposit':'approval');assert.equal(f.state.sends,0);assert.equal(seen.filter(v=>v==='nonce').length,1);assert.equal(seen.filter(v=>v==='fees').length,1);
 p.getTransactionCount=async()=>8;await assert.rejects(cap.confirm(),{code:'ROLLING_FUNDING_NONCE_CHANGED'});assert.equal(f.state.sends,0);
});
for(const wave of ['head-nonce','gas-fees','secret-commitment'])test(`standalone funding drains ${wave} siblings before a synchronous rejection escapes`,async()=>{
 const f=ethTopupFixture();let entered,release,settled=false;
 const started=new Promise(r=>entered=r),held=new Promise(r=>release=r),failure=Error('controlled first branch failure');
 if(wave==='head-nonce'){
  f.options.provider.getBlock=()=>{throw failure;};f.options.provider.getTransactionCount=async()=>{entered();await held;return 7;};
 }else if(wave==='gas-fees'){
  f.options.provider.estimateGas=()=>{throw failure;};f.options.provider.getFeeData=async()=>{entered();await held;return {maxFeePerGas:2n};};
 }else{
  f.options.sdk.computeSecretHash=()=>{throw failure;};const original=f.options.sdk.poseidon2HashWithSeparator;
  f.options.sdk.poseidon2HashWithSeparator=async(...args)=>{entered();await held;return original(...args);};
 }
 const cap=await f.open(),pending=cap.prepare(f.allocation).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await started;await new Promise(r=>setImmediate(r));assert.equal(settled,false);release();assert.equal(await pending,failure);assert.equal(f.state.sends,0);await assert.rejects(cap.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
});
test('parallel quote retains final canonical block and wallet guards after independent work',async()=>{
 for(const change of ['canonical','wallet']){
  const f=ethTopupFixture(),getBlock=f.options.provider.getBlock,fees=f.options.provider.getFeeData;let changed=false;
  f.options.provider.getFeeData=async()=>{changed=true;if(change==='wallet')f.state.invalid=true;return fees();};
  f.options.provider.getBlock=async tag=>{const block=await getBlock(tag);return changed&&change==='canonical'&&typeof tag==='number'?{...block,hash:h(999)}:block;};
  await assert.rejects((await f.open()).prepare(f.allocation));assert.equal(f.state.sends,0);
 }
});

for(const kind of ['aggregate','private-fee','bok'])test(`included ${kind} claim retains authenticated custody and permits a successor payment without checkpoint`,async()=>{
 const f=kind==='aggregate'?fixture():topupFixture(kind);f.state.allowance=1000n;let workflow,canonical=true,verified=0;
 const slots=[],createSlot=f.options.sdk.createEncryptedJournalSlot;f.options.sdk.createEncryptedJournalSlot=async options=>{const slot=await createSlot(options);slots.push(slot);return slot;};
 f.options.reconcileClaim=id=>workflow.open().reconcile(id);
 f.options.verifyClaim=async txHash=>{verified++;return verifyRollingTopupClaim({sdk:{TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn(),requireSuccessfulReceipt},node:{getTxReceipt:async()=>({txHash:h(70),status:'proposed',executionResult:'success',blockNumber:3,blockHash:h(60)}),getBlock:async()=>({hash:canonical?h(60):h(61)})},txHash,contextGuard:f.options.contextGuard,confirmationTier:'proposed'});};
 const funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();workflow=durableClaimApplication(f,funding,{proposed:true});
 const result=await advanceAggregateClaim({application:workflow.open(),funding,waits:{claim:async()=>assert.fail('included claim must not wait for checkpoint')}});
 assert.equal(result.state,'included');assert.equal(result.intent.status,'included');assert.equal(workflow.state.sends,1);assert.equal(f.state.sends,1);assert.equal(verified,0,'fresh application reconciliation is the sole completion check');
 const original=await funding.loadAggregate(receipts.receipt.txHash);
 // The completion field must remain stable when the confirmation tier changes.
 // Otherwise an already completed payment is mistaken for a pending workflow.
 const savedRecords=await Promise.all(slots.map(async slot=>({slot,saved:await slot.read()})));
 const completed=savedRecords.find(({saved})=>saved.value?.confirmedClaim);
 assert(completed,'completion is durable under the established field name');
 assert.equal(completed.saved.value.claimCompletion,undefined);
 const value=structuredClone(completed.saved.value);delete value.confirmedClaim.status;
 await completed.slot.write(completed.saved,value);
 if(kind!=='aggregate')assert.equal((await funding.inspect()).completed,true);
 f.options.reconcileClaim=async()=>{throw Error('a later ordinary action has replaced the single workflow');};
 const reopened=await f.open();await reopened.prepare(f.allocation);assert(verified>0,'a later payment independently rechecks the completed claim');assert.deepEqual(await reopened.loadAggregate(receipts.receipt.txHash),original);assert.equal(f.state.sends,1);
 canonical=false;await assert.rejects((await f.open()).prepare(f.allocation),{code:'ROLLING_SESSION_CONFIG'});assert.equal(f.state.sends,1);
});

for(const kind of ['private-fee','bok'])test(`direct ${kind} forwards durable payment submission feedback before receipt completion`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;const cap=await f.open();await cap.prepare(f.allocation);
 let observed=0,release,entered;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});const receipt=f.options.provider.getTransactionReceipt;
 f.options.provider.getTransactionReceipt=async hash=>{entered();await held;return receipt(hash);};
 let done=false;const pending=cap.confirm({onSubmitted:()=>{observed++;assert.equal(f.state.sends,1);}}).then(value=>{done=true;return value;});
 await started;assert.equal(observed,1);assert.equal(done,false);release();const result=await pending;assert.equal(result.receipt.amount,'300');assert.equal(observed,1);assert.equal(f.state.sends,1);
});


for(const mode of ['success','gas-failure','fee-failure','changed-account'])test('aggregate ETH journal owns the only final gas and fee boundary: '+mode,{timeout:3000},async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);
 const gas=Promise.withResolvers(),fees=Promise.withResolvers(),gasStarted=Promise.withResolvers(),feesStarted=Promise.withResolvers();let settled=false,gasCalls=0,feeCalls=0;
 f.options.provider.estimateGas=()=>{gasCalls++;gasStarted.resolve();if(mode==='gas-failure')throw Error('gas unavailable');return gas.promise.then(()=>100n);};
 f.options.provider.getFeeData=()=>{feeCalls++;feesStarted.resolve();if(mode==='fee-failure')throw Error('fees unavailable');return fees.promise.then(()=>({maxFeePerGas:2n,maxPriorityFeePerGas:1n}));};
 const result=app.confirm().finally(()=>settled=true),observed=mode==='success'?result:assert.rejects(result);
 await gasStarted.promise;assert.equal(gasCalls,1);assert.equal(feeCalls,0);assert.equal(f.state.sends,0);
 if(mode==='gas-failure'){await observed;assert.equal(feeCalls,0);assert.equal((await app.inspect()).paymentSaved,false);return;}
 assert.equal(settled,false);gas.resolve();await feesStarted.promise;assert.equal(feeCalls,1);assert.equal(f.state.sends,0);
 if(mode==='changed-account')f.state.connected=false;
 if(mode!=='fee-failure'){await new Promise(setImmediate);assert.equal(settled,false,'final fee read still owns the flow');}
 fees.resolve();await observed;assert.equal(f.state.sends,mode==='success'?1:0);assert.equal(gasCalls,1);assert.equal(feeCalls,1);
 if(mode!=='success')assert.equal((await app.inspect()).paymentSaved,false);
});


for(const mode of ['wrong-claim','mismatched-receipt','locked'])test('claim workflow inspection cannot bypass an unrelated or unusable saved workflow: '+mode,async()=>{
 const f=claimProgressFixture();f.input.application.readAccountStatus=()=>assert.fail('must not scan unrelated balances');
 f.input.application.readFundingState=async()=>mode==='locked'?{status:'locked'}:{status:'recovering',intent:{intentId:'other',status:'prepared',action:{type:mode==='wrong-claim'?'claim-bok':'claim-deposit',receipt:{private:'different'}}}};
 await assert.rejects(advanceAggregateClaim(f.input),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 assert(!f.calls.includes('prepare'));assert(!f.calls.includes('submit'));
});
test('claim workflow inspection failure drains before continuation and never scans balances',async()=>{
 const f=claimProgressFixture(),entered=Promise.withResolvers(),held=Promise.withResolvers(),error=Error('context changed');let settled=false;
 f.input.application.readAccountStatus=()=>assert.fail('must not scan unrelated balances');
 f.input.application.readFundingState=async()=>{entered.resolve();await held.promise;throw error;};
 const result=advanceAggregateClaim(f.input).finally(()=>settled=true),observed=assert.rejects(result,e=>e===error);
 await entered.promise;assert.equal(settled,false);assert(!f.calls.includes('prepare'));held.resolve();await observed;assert(!f.calls.includes('submit'));
});

test('exact unknown claim remains pending without preparing or sending another claim',async()=>{
 const f=claimProgressFixture(),intent={intentId:'saved',status:'unknown',action:{type:'claim-bok',receipt:{private:'SECRET_RECEIPT'}}};
 f.input.funding.inspect=async()=>({paymentSaved:true,privateFeeCap:'10',claim:null,claimAction:'claim-bok'});
 f.input.application.readFundingState=async()=>({status:'recovering',intent});
 assert.deepEqual(await advanceAggregateClaim(f.input),{state:'pending',intent});assert(!f.calls.includes('prepare'));assert(!f.calls.includes('submit'));
});


for(const mode of ['no-bok','unexpected-bok','missing-bok','changed-bok','missing-fee'])test('current aggregate claim relinks optional Bok receipt exactly: '+mode,async()=>{
 const f=fixture(),funding=await f.open(),hasBok=['missing-bok','changed-bok'].includes(mode);
 await funding.prepare({...f.allocation,...(hasBok?{}:{bokAmount:'0',bokPoolFee:0})});const receipts=await funding.confirm();
 const workflow=durableClaimApplication(f,funding),first=workflow.open(),prepared=await first.prepare({type:'claim-deposit',...receipts});
 assert.equal((await funding.inspect()).claim,null);
 const app=workflow.open(),application=mode==='no-bok'?app:{...app,readFundingState:async()=>{
  const value=await app.readFundingState(),action=structuredClone(value.intent.action);
  if(mode==='unexpected-bok')action.bokReceipt={...receipts.feeReceipt};
  if(mode==='missing-bok')delete action.bokReceipt;
  if(mode==='changed-bok')action.bokReceipt={...action.bokReceipt,amount:'1'};
  if(mode==='missing-fee')delete action.feeReceipt;
  return {...value,intent:{...value.intent,action}};
 }};
 if(mode==='no-bok'){
  const result=await advanceAggregateClaim({application,funding:await f.open()});assert.equal(result.state,'complete');assert.equal(result.intent.intentId,prepared.intentId);assert.equal(workflow.state.sends,1);
 }else{await assert.rejects(advanceAggregateClaim({application,funding:await f.open()}),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});assert.equal(workflow.state.sends,0);}
 assert.equal(f.state.sends,1);
});

for(const mode of ['normal','throw','reject','pending'])test(`aggregate ETH reports durable submission before receipt without awaiting callback: ${mode}`,{timeout:3000},async()=>{
 const f=fixture(),receipt=Promise.withResolvers(),receiptStarted=Promise.withResolvers(),ack=Promise.withResolvers(),read=f.options.provider.getTransactionReceipt;let calls=0;
 f.options.provider.getTransactionReceipt=async(...args)=>{if(f.state.sends){receiptStarted.resolve();await receipt.promise;}return read(...args);};
 const app=await f.open();await app.prepare(f.allocation);let finished=false;
 const work=app.confirm({onSubmitted:(...args)=>{assert.deepEqual(args,[]);calls++;ack.resolve();if(mode==='throw')throw Error('observer');if(mode==='reject')return Promise.reject(Error('observer'));if(mode==='pending')return new Promise(()=>{});}}).then(value=>{finished=true;return value;});
 await ack.promise;await receiptStarted.promise;assert.equal(calls,1);assert.equal(finished,false);assert.equal((await app.inspect()).paymentSaved,true);
 receipt.resolve();const result=await work;assert.equal(result.receipt.txHash,h(20));assert.equal(f.state.sends,1);assert.equal(calls,1);
});
for(const mode of ['hash','no-hash','malformed'])test(`aggregate USDC submission notification requires validated saved relay hash: ${mode}`,{timeout:3000},async()=>{
 const f=usdcWalletFixture(),submit=f.options.relay.submit,slots=[],create=f.options.sdk.createEncryptedJournalSlot;let calls=0,checked;
 f.options.sdk.createEncryptedJournalSlot=async options=>{const value=await create(options);slots.push(value);return value;};
 f.options.relay.submit=async data=>{const state=await submit(data);if(mode==='no-hash')delete state.transactionHash;if(mode==='malformed')state.transactionHash='invalid';return state;};
 const app=await f.open();await app.prepare(f.allocation);
 const work=app.confirm({onSubmitted:(...args)=>{assert.deepEqual(args,[]);calls++;checked=slots[0].read().then(saved=>assert.equal(saved.value.relay.transactionHash,h(200)));}});
 if(mode==='malformed')await assert.rejects(work,{code:'ROLLING_FUNDING_RELAY_SCOPE'});else assert.equal((await work).pending,true);
 if(checked)await checked;assert.equal(calls,mode==='hash'?1:0);assert.equal(f.state.posts,1);
});

for(const mode of ['success','wrong-request','wrong-block','context-change'])test(`USDC reconciliation captures one exact transaction and preserves fresh authority: ${mode}`,async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();
 let txReads=0,receiptReads=0,codeReads=0,blockReads=0;const getTx=f.options.provider.getTransaction,getReceipt=f.options.provider.getTransactionReceipt,getBlock=f.options.provider.getBlock,getCode=f.options.provider.getCode;
 if(mode==='wrong-request')f.state.usdcTx.data='0x1234';
 f.options.provider.getTransaction=async hash=>{txReads++;return getTx(hash);};
 f.options.provider.getTransactionReceipt=async hash=>{receiptReads++;if(mode==='context-change')f.state.invalid=true;return getReceipt(hash);};
 f.options.provider.getBlock=async number=>{blockReads++;const block=await getBlock(number);return mode==='wrong-block'?{...block,hash:h(999)}:block;};
 f.options.provider.getCode=async(...args)=>{codeReads++;return getCode(...args);};
 if(mode==='success'){
  await app.recover();assert.equal(codeReads,1);assert.equal(blockReads,2);assert.equal(receiptReads,1);assert.equal(txReads,1);
  await app.recover();assert.equal(txReads,2,'No reuse across separate recovery operations');
 }else await assert.rejects(app.recover());
 assert.equal(txReads,mode==='success'?2:1);assert.equal(f.state.posts,1);assert.equal(f.state.sends,0);
});
test('USDC immutable transaction snapshot is detached before the receipt await',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();const receipt=f.options.provider.getTransactionReceipt;
 f.options.provider.getTransactionReceipt=async hash=>{f.state.usdcTx.nonce=99;f.state.usdcTx.data='0x1234';return receipt(hash);};
 const result=await app.recover();assert.equal(result.receipt.nonce,'42');assert.equal(f.state.posts,1);
});
test('USDC confirmation retains all five fresh state boundaries and exact signed simulation',async()=>{
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);const send=f.options.provider.send,calls=[];
 f.options.provider.send=async(method,params)=>{calls.push({method,params,signatures:f.state.signatures});return send(method,params);};
 await app.confirm();
 assert.deepEqual(calls.filter(x=>x.method==='eth_chainId').map(x=>x.signatures),[0,1,2,2,2]);
 for(const tag of ['0x10','pending'])assert.equal(calls.filter(x=>x.method==='eth_getBlockByNumber'&&x.params[0]===tag).length,5);
 const simulations=calls.filter(x=>x.method==='eth_call'&&x.params[1]==='pending');assert.equal(simulations.length,1);assert.equal(simulations[0].signatures,2);
 assert.equal(simulations[0].params[0].data,f.state.usdcTx.data);assert.equal(f.state.posts,1);
});

for(const kind of ['private-fee','bok'])for(const phase of ['approval','deposit'])test(`terminal reuse: ${kind} ${phase} projects only its successful current send without recovery`,async()=>{
 const f=topupFixture(kind);if(phase==='deposit')f.state.allowance=1000n;
 let recoveries=0,receiptReads=0,txReads=0;const native=f.options.sdk.createEthereumJournal,receipt=f.options.provider.getTransactionReceipt,transaction=f.options.provider.getTransaction;
 f.options.sdk.createEthereumJournal=async options=>{const j=await native(options);return {...j,recover:async(...args)=>{recoveries++;return j.recover(...args);}};};
 f.options.provider.getTransactionReceipt=async hash=>{receiptReads++;return receipt(hash);};f.options.provider.getTransaction=async hash=>{txReads++;return transaction(hash);};
 const cap=await f.open();await cap.prepare(f.allocation);recoveries=receiptReads=txReads=0;
 const result=await cap.confirm();assert.equal(recoveries,0);assert.equal(receiptReads,1);assert.equal(txReads,1);assert.equal(f.state.sends,1);
 if(phase==='approval')assert.deepEqual(result,{approved:true});else assert.equal(result.receipt.amount,'300');
 await cap.recover();assert.equal(recoveries,1);assert.equal(receiptReads,2);assert.equal(txReads,2);
});
for(const change of ['request','outcome','canonical','owner','custody'])test(`terminal reuse: ${change} change after authenticated send prevents effect projection`,async()=>{
 const f=topupFixture();f.state.allowance=1000n;const native=f.options.sdk.createEthereumJournal;
 f.options.sdk.createEthereumJournal=async options=>{const j=await native(options);return {...j,send:async(...args)=>{const result=await j.send(...args);
  if(change==='request')result.request={...result.request,nonce:result.request.nonce+1};
  if(change==='outcome')result.outcome='reverted';
  if(change==='canonical'){const block=f.options.provider.getBlock;f.options.provider.getBlock=async n=>({...await block(n),hash:h(999)});}
  if(change==='owner')f.state.invalid=true;
  if(change==='custody'){for(const key of f.records.keys())f.records.set(key,'changed ciphertext');}
  return result;
 }};};
 const cap=await f.open();await cap.prepare(f.allocation);await assert.rejects(cap.confirm());assert.equal(f.state.sends,1);
});
test('terminal reuse: final canonical read stays held before returning deposit receipt',async()=>{
 const f=topupFixture();f.state.allowance=1000n;const native=f.options.sdk.createEthereumJournal,held=Promise.withResolvers(),entered=Promise.withResolvers();
 f.options.sdk.createEthereumJournal=async options=>{const j=await native(options);return {...j,send:async(...args)=>{const result=await j.send(...args),block=f.options.provider.getBlock;f.options.provider.getBlock=async n=>{entered.resolve();await held.promise;return block(n);};return result;}};};
 const cap=await f.open();await cap.prepare(f.allocation);let done=false;const work=cap.confirm().finally(()=>{done=true;});await entered.promise;assert.equal(done,false);held.resolve();assert.equal((await work).receipt.amount,'300');
});

for(const kind of ['private-fee','bok'])test(`direct ${kind} completion binds the exact receipt and holds custody through final reconciliation`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;let workflow,hold=false;const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 f.options.reconcileClaim=async id=>{if(hold){entered.resolve();await gate.promise;}return workflow.open().reconcile(id);};
 const funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();workflow=durableClaimApplication(f,funding,{proposed:true});
 const app=workflow.open(),prepared=await app.prepare({type:kind==='bok'?'claim-bok':'claim-private-fee',...receipts});await funding.checkpointClaim({intentId:prepared.intentId,attempted:true});const done=await app.submitPrepared(prepared.intentId);
 await assert.rejects(funding.recordClaimCompletion({...done,action:{...done.action,receipt:{...done.action.receipt,amount:'999'}}}),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal((await funding.inspect()).completed,false);
 hold=true;const pending=funding.recordClaimCompletion(done);await entered.promise;assert.equal((await funding.inspect()).completed,false);
 workflow.state.outcome={...workflow.state.outcome,outcome:'reverted'};const rejected=assert.rejects(pending,{code:'ROLLING_FUNDING_MISMATCH'});gate.resolve();await rejected;assert.equal((await funding.inspect()).completed,false);
});

test('aggregate ETH uses exactly one native journal gas estimate and fresh fee read before its sole send',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);let estimates=0,fees=0,sent;
 f.options.provider.estimateGas=async request=>{estimates++;assert.equal(f.state.sends,0);assert.equal((await app.inspect()).paymentSaved,true);assert.equal(request.nonce,7);assert.equal(request.chainId,31337n);return 123n;};
 f.options.provider.getFeeData=async()=>{fees++;return {maxFeePerGas:3n,maxPriorityFeePerGas:1n};};
 const original=f.wallet.signer.sendTransaction;f.wallet.signer.sendTransaction=async request=>{sent={...request};return original(request);};
 await app.confirm();assert.equal(estimates,1);assert.equal(fees,1);assert.equal(f.state.sends,1);assert.equal(sent.gasLimit,246n);assert.equal(sent.maxFeePerGas,3n);assert.equal(sent.maxPriorityFeePerGas,1n);
});
for(const mutation of ['budget','estimate-reject','account','context','chain','expiry'])test(`aggregate ETH native final gas boundary rejects ${mutation} without sending or crossing changed context`,{timeout:3000},async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);const entered=Promise.withResolvers(),held=Promise.withResolvers();let settled=false,estimateCount=0,feeCount=0;
 f.options.provider.estimateGas=async()=>{estimateCount++;entered.resolve();await held.promise;if(mutation==='estimate-reject')throw Object.assign(Error('EVM reverted'),{code:'CALL_EXCEPTION'});return 100n;};
 f.options.provider.getFeeData=async()=>{feeCount++;return {maxFeePerGas:mutation==='budget'?10000n:2n,maxPriorityFeePerGas:1n};};
 const confirming=app.confirm().finally(()=>settled=true),rejected=assert.rejects(confirming);await entered.promise;assert.equal(settled,false);assert.equal(f.state.sends,0);
 if(mutation==='account')f.state.connected=false;
 if(mutation==='context')f.state.invalid=true;
 if(mutation==='chain'){const send=f.options.provider.send;f.options.provider.send=(method,params)=>method==='eth_chainId'?'0x1':send(method,params);}
 if(mutation==='expiry')f.state.pendingTime=1901;
 held.resolve();await rejected;assert.equal(estimateCount,1);assert.equal(f.state.sends,0);f.state.invalid=false;
 assert.equal((await app.inspect()).paymentSaved,mutation==='context','ordinary failures roll back; a changed native owner forbids even cleanup writes');
 // The actual encrypted Ethereum journal also must be empty; no orphaned unsent
 // request may prevent a fresh, explicitly reviewed payment.
 const journal=await createEthereumJournal({storage:f.options.storage,walletSecret:f.options.walletSecret,walletSalt:f.options.walletSalt,scope:{account:f.options.owner,...f.options.network,board:f.options.board,portal:f.options.scope.router,depositor:f.wallet.address},provider:f.options.provider,signer:f.wallet.signer,contextGuard:f.options.contextGuard});
 assert.equal(await journal.inspectSummary(),null);
 assert.equal(feeCount,['estimate-reject','account','context'].includes(mutation)?0:1);
});


test('aggregate custody performs one fresh native journal verification per load',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);const payment=await app.confirm();
 const counts={};for(const method of ['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode']){
  const original=f.options.provider[method];f.options.provider[method]=async(...args)=>{counts[method]=(counts[method]??0)+1;return original(...args);};
 }
 for(let call=1;call<=2;call++){
  const custody=await (await f.open()).loadAggregate(payment.receipt.txHash);assert.equal(custody.intent.nonce,7);assert(custody.bridgeSecret&&custody.recipientSalt);
  assert.equal(counts.getTransactionReceipt,call);assert.equal(counts.getTransaction,call);assert.equal(counts.getCode,call);assert.equal(counts.getBlock,2*call);assert.equal(counts.getNetwork,call);
 }
 assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
});
for(const failure of ['initial-fork','final-fork','effects','request','network','owner'])test('aggregate custody still rejects fresh '+failure+' without another send',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);const payment=await app.confirm();
 let blockReads=0;const getBlock=f.options.provider.getBlock,getReceipt=f.options.provider.getTransactionReceipt,getTransaction=f.options.provider.getTransaction;
 if(failure.endsWith('fork'))f.options.provider.getBlock=async(...args)=>{const block=await getBlock(...args);blockReads++;return {...block,hash:blockReads===(failure==='initial-fork'?1:2)?h(999):block.hash};};
 if(failure==='effects')f.options.provider.getTransactionReceipt=async(...args)=>({...await getReceipt(...args),logs:[]});
 if(failure==='request')f.options.provider.getTransaction=async(...args)=>({...await getTransaction(...args),data:'0x'});
 if(failure==='network')f.options.provider.getNetwork=async()=>({chainId:1n});
 if(failure==='owner')f.options.provider.getTransactionReceipt=async(...args)=>{const receipt=await getReceipt(...args);f.state.invalid=true;return receipt;};
 await assert.rejects((await f.open()).loadAggregate(payment.receipt.txHash));assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);
 if(failure==='final-fork')assert.equal(blockReads,2);
});


test('aggregate archived predecessor uses the exact verifier final canonical read once and retains fork rejection',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();
 durableClaimApplication(f,funding);await advanceAggregateClaim({application:f.state.workflow.open(),funding});
 const next=await f.open();await next.prepare(f.allocation);
 const getBlock=f.options.provider.getBlock,verify=f.options.sdk.verifyEthereumIntentReceipt;
 let inside=false,after=false,canonicalReads=0,duplicateReads=0,verified=0,fork=false;
 f.options.provider.getBlock=async(...args)=>{
  const value=await getBlock(...args);
  if(args[0]===17){if(inside){canonicalReads++;if(fork&&canonicalReads===2)return {...value,hash:h(99)};}else if(after)duplicateReads++;}
  return value;
 };
 f.options.sdk.verifyEthereumIntentReceipt=async(...args)=>{inside=true;after=false;canonicalReads=0;try{const result=await verify(...args);verified++;after=true;return result;}finally{inside=false;}};
 const verifyClaim=f.options.verifyClaim;f.options.verifyClaim=async(...args)=>{assert.equal(duplicateReads,0);after=false;return verifyClaim(...args);};
 const reopened=await f.open();await reopened.prepare(f.allocation);
 assert.equal(verified,1);assert.equal(canonicalReads,2,'initial and final canonical checks in real receipt verifier remain');assert.equal(duplicateReads,0);
 fork=true;await assert.rejects((await f.open()).prepare(f.allocation));assert.equal(verified,1);assert.equal(f.state.sends,1);
});

// Actual SDK quote, encrypted slots and journal; no speculative custody writes.
const openingAllocation=f=>({...f.allocation,bokAmount:'0',bokPoolFee:0});
test('opening readonly quote is opaque, writes nothing, then installs once and confirms normally',async()=>{
 const f=fixture(),app=await f.open(),token=await app.prepareReadOnly(openingAllocation(f));
 assert.deepEqual(token,{});assert.equal(f.records.size,0);assert.equal(f.state.signatures,0);assert.equal(f.state.sends,0);
 await assert.rejects(app.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 const quote=await app.installPreparedQuote(token);assert.equal(quote.ethereumNonce,7);assert.equal(f.records.size,1);
 await assert.rejects(app.installPreparedQuote(token),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 const result=await app.confirm();assert.equal(result.feeReceipt.amount,'200');assert.equal(result.bokReceipt,undefined);assert.equal(f.state.sends,1);
});
test('opening readonly quote rejects forged, cloned and other-instance tokens',async()=>{
 const f=fixture(),app=await f.open(),other=await f.open(),token=await app.prepareReadOnly(openingAllocation(f));
 for(const value of [{},structuredClone(token)])await assert.rejects(app.installPreparedQuote(value),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 await assert.rejects(other.installPreparedQuote(token),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});assert.equal(f.records.size,0);
 await app.installPreparedQuote(token);assert.equal(f.records.size,1);
});
for(const changed of ['nonce','expired','fork','chain','owner','wallet'])test('opening readonly quote rechecks '+changed+' before saving',async()=>{
 const f=fixture(),app=await f.open(),token=await app.prepareReadOnly(openingAllocation(f)),send=f.options.provider.send;
 if(changed==='nonce')f.state.nonce++;
 if(changed==='expired')f.state.pendingTime=1901;
 if(changed==='owner')f.state.invalid=true;
 if(changed==='wallet')f.state.connected=false;
 if(changed==='fork'||changed==='chain')f.options.provider.send=async(method,params)=>{
  const result=await send(method,params);
  return changed==='chain'&&method==='eth_chainId'?'0x1':changed==='fork'&&method==='eth_getBlockByNumber'&&params[0]!=='pending'?{...result,hash:h(90)}:result;
 };
 await assert.rejects(app.installPreparedQuote(token));assert.equal(f.records.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
});
test('opening readonly quote refuses replaced custody and leaves saved bytes intact',async()=>{
 const f=fixture(),app=await f.open(),token=await app.prepareReadOnly(openingAllocation(f)),other=await f.open();
 await other.prepare(openingAllocation(f));const saved=[...f.records.entries()];
 await assert.rejects(app.installPreparedQuote(token),{code:'ROLLING_FUNDING_MISMATCH'});assert.deepEqual([...f.records.entries()],saved);
 assert(await app.prepareReadOnly(openingAllocation(f)));assert.deepEqual([...f.records.entries()],saved,'new construction remains read-only even for the newer unsigned draft');
});
test('opening readonly quote installation drains failed validity and held wallet before releasing',async()=>{
 const f=fixture(),app=await f.open(),token=await app.prepareReadOnly(openingAllocation(f)),held=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('quote invalid');
 f.wallet.guard=async()=>{entered.resolve();await held.promise;};f.options.sdk.validateAggregateFundingQuote=async()=>{throw failure;};
 let settled=false;const pending=app.installPreparedQuote(token).finally(()=>{settled=true;});pending.catch(()=>{});
 await entered.promise;await new Promise(setImmediate);assert.equal(settled,false);assert.equal(f.records.size,0);
 held.resolve();await assert.rejects(pending,e=>e===failure);assert.equal(f.records.size,0);
});
test('opening readonly quote capability preserves issuing identity across the common funding lease',async()=>{
 const {withRollingFundingLease}=await import('./funding-session.mjs');
 const f=fixture(),raw=await f.open();let tail=Promise.resolve(),held=false;const names=[];
 const locks={request(name,options,run){names.push(name);const next=tail.then(async()=>{assert.equal(held,false);held=true;try{return await run();}finally{held=false;}});tail=next.catch(()=>{});return next;}};
 const app=withRollingFundingLease(raw,{owner:f.options.owner,locks,contextGuard:f.options.contextGuard});
 const token=await app.prepareReadOnly(openingAllocation(f));assert.equal(held,false);assert.equal(f.records.size,0);
 await app.installPreparedQuote(token);assert.equal(held,false);assert.equal(new Set(names).size,1);assert.equal(f.records.size,1);
});

for(const fork of [false,true])test('claim completion uses native final Ethereum canonical fence without duplicate, fork='+fork,async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();const workflow=durableClaimApplication(f,funding);
 const complete=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(complete.state,'complete');
 const getBlock=f.options.provider.getBlock;let blocks=0;
 f.options.provider.getBlock=async number=>{const block=await getBlock(number);if(number===17){blocks++;if(fork&&blocks===2)return {...block,hash:h(999)};}return block;};
 const before=[...f.records];
 if(fork){await assert.rejects(funding.recordClaimCompletion(complete.intent));assert.deepEqual([...f.records],before);}
 else await funding.recordClaimCompletion(complete.intent);
 assert.equal(blocks,2,'original receipt block plus native verifier final block; no third duplicate');assert.equal(f.state.sends,1);assert.equal(workflow.state.sends,1);
});

test('unsigned saved opening quote constructs readonly after reopen and replaces exact draft once',async()=>{
 const f=fixture(),first=await f.open(),allocation=openingAllocation(f);await first.prepare(allocation);const before=[...f.records];
 const reopened=await f.open(),token=await reopened.prepareReadOnly({...allocation,feeAmount:'250'});assert(token);assert.deepEqual([...f.records],before);assert.equal(f.state.signatures,0);assert.equal(f.state.sends,0);
 const result=await reopened.installPreparedQuote(token);assert.equal(result.breakdown.fee.amount,'250');assert.notDeepEqual([...f.records],before);
 await assert.rejects(reopened.installPreparedQuote(token),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});const paid=await reopened.confirm();assert.equal(paid.feeReceipt.amount,'250');assert.equal(f.state.sends,1);
});
test('unsigned saved opening quote replacement rejects a newer unsigned custody draft',async()=>{
 const f=fixture(),first=await f.open(),allocation=openingAllocation(f);await first.prepare(allocation);
 const reopened=await f.open(),token=await reopened.prepareReadOnly(allocation),other=await f.open();await other.prepare({...allocation,feeAmount:'300'});const before=[...f.records];
 await assert.rejects(reopened.installPreparedQuote(token),{code:'ROLLING_FUNDING_MISMATCH'});assert.deepEqual([...f.records],before);assert.equal(f.state.sends,0);
});
for(const mode of ['submitted','unknown'])test('unsigned saved opening quote excludes '+mode+' original payment',async()=>{
 const f=fixture(),first=await f.open(),allocation=openingAllocation(f);await first.prepare(allocation);
 if(mode==='unknown'){f.state.unknown=true;await assert.rejects(first.confirm());}else await first.confirm();
 const before=[...f.records],reopened=await f.open();assert.equal(await reopened.prepareReadOnly(allocation),null);assert.deepEqual([...f.records],before);assert.equal(f.state.sends,1);
});
for(const changedWallet of [false,true])test('unsigned saved opening quote cannot replace hidden Ethereum intent, changedWallet='+changedWallet,async()=>{
 const f=fixture(),app=await f.open(),allocation=openingAllocation(f);await app.prepare(allocation);const unsigned=[...f.records];
 f.state.unknown=true;await assert.rejects(app.confirm());assert.equal(f.state.sends,1);
 // Model an aggregate draft restored beside its still-authenticated unknown ETH
 // journal. The final native journal inspection must veto custody replacement.
 for(const [key,value]of unsigned)f.records.set(key,value);
 if(changedWallet)f.wallet.address=new ethers.Wallet(h(98)).address.toLowerCase();
 const before=[...f.records],reopened=await f.open(),token=await reopened.prepareReadOnly(allocation);assert(token);assert.deepEqual([...f.records],before);
 await assert.rejects(reopened.installPreparedQuote(token),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});assert.deepEqual([...f.records],before);assert.equal(f.state.sends,1);
});

import {readRollingFundingOperation} from './funding-session.mjs';
function operationFundingReader(provider,owner){
 return Object.fromEntries(Object.entries(provider).filter(([,fn])=>typeof fn==='function').map(([name])=>[name,(...args)=>readRollingFundingOperation({provider,operationScope:()=>owner.scope,name,args})]));
}
test('mature funding operation reuses actual claim receipt reads while every canonical fence stays fresh',async()=>{
 const f=fixture(),first=await f.open();await first.prepare(f.allocation);const payment=await first.confirm();
 const raw=f.options.provider,counts={};for(const name of ['getNetwork','getTransactionReceipt','getTransaction','getCode','getBlock']){const call=raw[name];raw[name]=async(...args)=>{counts[name]=(counts[name]??0)+1;const value=await call(...args);return name==='getTransaction'?{...value,blockHash:h(17),blockNumber:17}:value;};}
 const owner={scope:{synchronized:true}};f.options.provider=operationFundingReader(raw,owner);const funding=await f.open();
 for(let i=0;i<2;i++){const custody=await funding.loadAggregate(payment.receipt.txHash);assert.equal(custody.intent.nonce,7);assert(custody.bridgeSecret&&custody.recipientSalt);}
 assert.deepEqual(counts,{getNetwork:1,getTransactionReceipt:1,getTransaction:1,getBlock:4,getCode:1});
 owner.scope={synchronized:true};await funding.loadAggregate(payment.receipt.txHash);
 assert.deepEqual(counts,{getNetwork:2,getTransactionReceipt:2,getTransaction:2,getBlock:6,getCode:2});assert.equal(f.state.sends,1);
});
for(const forkRead of [3,4])test('mature funding cached receipt rejects fresh canonical fork at read '+forkRead,async()=>{
 const f=fixture(),first=await f.open();await first.prepare(f.allocation);const payment=await first.confirm(),raw=f.options.provider;
 let blocks=0,receipts=0;const getBlock=raw.getBlock,getReceipt=raw.getTransactionReceipt;
 raw.getBlock=async(...args)=>{const result=await getBlock(...args);return ++blocks===forkRead?{...result,hash:h(999)}:result;};
 raw.getTransactionReceipt=async(...args)=>{receipts++;return getReceipt(...args);};
 const owner={scope:{synchronized:true}};f.options.provider=operationFundingReader(raw,owner);const funding=await f.open();
 await funding.loadAggregate(payment.receipt.txHash);const before=[...f.records];await assert.rejects(funding.loadAggregate(payment.receipt.txHash));
 assert.equal(receipts,1);assert.equal(blocks,forkRead);assert.deepEqual([...f.records],before);assert.equal(f.state.sends,1);
});
test('mature funding failed receipt is evicted and same operation can read its real receipt',async()=>{
 const f=fixture(),first=await f.open();await first.prepare(f.allocation);const payment=await first.confirm(),raw=f.options.provider;
 let receipts=0;const read=raw.getTransactionReceipt;raw.getTransactionReceipt=async(...args)=>{if(++receipts===1)throw Error('receipt unavailable');return read(...args);};
 const owner={scope:{synchronized:true}};f.options.provider=operationFundingReader(raw,owner);const funding=await f.open();
 await assert.rejects(funding.loadAggregate(payment.receipt.txHash));assert(await funding.loadAggregate(payment.receipt.txHash));assert.equal(receipts,2);assert.equal(f.state.sends,1);
});
test('mature funding held receipt rejects operation replacement without releasing before it drains',async()=>{
 const f=fixture(),first=await f.open();await first.prepare(f.allocation);const payment=await first.confirm(),raw=f.options.provider;
 const held=Promise.withResolvers(),entered=Promise.withResolvers(),read=raw.getTransactionReceipt;let reads=0,settled=false;
 raw.getTransactionReceipt=async(...args)=>{reads++;entered.resolve();await held.promise;return read(...args);};
 const owner={scope:{synchronized:true}};f.options.provider=operationFundingReader(raw,owner);const funding=await f.open();
 const pending=funding.loadAggregate(payment.receipt.txHash).finally(()=>settled=true);pending.catch(()=>{});await entered.promise;owner.scope={synchronized:true};await new Promise(setImmediate);assert.equal(settled,false);
 held.resolve();await assert.rejects(pending);assert.equal(reads,1);assert.equal(f.state.sends,1);
});
test('mature funding read identity separates providers and changed method capabilities',async()=>{
 const owner={scope:{synchronized:true}},a={getTransactionReceipt:async()=>({blockHash:h(1)})},b={getTransactionReceipt:async()=>({blockHash:h(2)})};
 const one=operationFundingReader(a,owner),two=operationFundingReader(b,owner);
 assert.equal((await one.getTransactionReceipt(h(3))).blockHash,h(1));assert.equal((await two.getTransactionReceipt(h(3))).blockHash,h(2));
 a.getTransactionReceipt=async()=>({blockHash:h(4)});assert.equal((await one.getTransactionReceipt(h(3))).blockHash,h(4));
});
test('mature funding mutable and null or pending observations never reuse stale values',async()=>{
 const owner={scope:{synchronized:true}},counts={};
 const raw=Object.fromEntries(['getBlock','getFeeData','getTransactionCount','send','getCode','call','getTransactionReceipt','getTransaction'].map(name=>[name,async()=>{counts[name]=(counts[name]??0)+1;return name==='getTransactionReceipt'?null:name==='getTransaction'?{blockHash:null}:counts[name];}]));
 const read=operationFundingReader(raw,owner);
 for(let i=0;i<2;i++)await Promise.all([read.getBlock(17),read.getFeeData(),read.getTransactionCount(a(1),'pending'),read.send('eth_chainId',[]),read.getCode(a(1),'latest'),read.call({to:a(1),blockTag:'pending'}),read.getTransactionReceipt(h(1)),read.getTransaction(h(1))]);
 for(const count of Object.values(counts))assert.equal(count,2);
 owner.scope=null;await read.getCode(a(1),17);await read.getCode(a(1),17);assert.equal(counts.getCode,4);
});

for(const asset of ['ETH','token'])test('standalone Bok custody verifies one exact fresh receipt per load: '+asset,async()=>{
 const f=asset==='ETH'?ethTopupFixture():topupFixture();f.state.allowance=1000n;
 const cap=await f.open();await cap.prepare({...f.allocation,...(asset==='ETH'?{asset:'ETH'}:{})});const payment=await cap.confirm();
 const counts={};for(const method of ['getTransactionReceipt','getTransaction','getBlock','getCode']){const original=f.options.provider[method];f.options.provider[method]=async(...args)=>{counts[method]=(counts[method]??0)+1;return original(...args);};}
 for(let n=1;n<=2;n++){const custody=await cap.loadAggregate(payment.receipt.txHash);assert(custody.bridgeSecret&&custody.recipientSalt);assert.equal(counts.getTransactionReceipt,n);assert.equal(counts.getTransaction,n);assert.equal(counts.getCode??0,asset==='ETH'?n:0);assert.equal(counts.getBlock,2*n);}
 assert.equal(f.state.sends,1);
});
for(const failure of ['initial-fork','verifier-final-fork','effects','request','network','owner'])test('standalone Bok custody retains exact authority on '+failure,async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare({...f.allocation,asset:'ETH'});const payment=await cap.confirm();
 const getBlock=f.options.provider.getBlock,getReceipt=f.options.provider.getTransactionReceipt,getTransaction=f.options.provider.getTransaction;let blockReads=0;
 if(failure.endsWith('fork'))f.options.provider.getBlock=async(...args)=>{const block=await getBlock(...args);return {...block,hash:++blockReads===(failure==='initial-fork'?1:failure==='verifier-final-fork'?2:3)?h(999):block.hash};};
 if(failure==='effects')f.options.provider.getTransactionReceipt=async(...args)=>({...await getReceipt(...args),logs:[]});
 if(failure==='request')f.options.provider.getTransaction=async(...args)=>({...await getTransaction(...args),data:'0x'});
 if(failure==='network')f.options.provider.getNetwork=async()=>({chainId:1n});
 if(failure==='owner')f.options.provider.getTransactionReceipt=async(...args)=>{const value=await getReceipt(...args);f.state.invalid=true;return value;};
 await assert.rejects(cap.loadAggregate(payment.receipt.txHash));assert.equal(f.state.sends,1);if(failure==='verifier-final-fork')assert.equal(blockReads,2);
});

import {invalidateRollingFundingNativeSnapshot} from './funding-session.mjs';
import {createFundingContinuation} from '../../apps/rolling/wallet-session.mjs';
for(const failure of [null,'fork','network','owner'])test('Bok bridge keeps exact Ethereum reads but fresh authority rejects '+failure,async()=>{
 const f=ethTopupFixture(),initial=await f.open();await initial.prepare({...f.allocation,asset:'ETH'});const payment=await initial.confirm();
 const raw=f.options.provider,counts={},owner={scope:null};let bridged=false,invalid=false,prepared=0;
 for(const name of ['getNetwork','getTransactionReceipt','getTransaction','getCode','getBlock','call']){
  const call=raw[name];raw[name]=async(...args)=>{
   counts[name]=(counts[name]??0)+1;const value=await call(...args);
   if(bridged&&failure==='network'&&name==='getNetwork')return {chainId:1n};
   if(bridged&&failure==='fork'&&name==='getBlock'&&Number.isSafeInteger(args[0]))return {...value,hash:h(999)};
   return name==='getTransaction'&&value?{...value,blockHash:h(value.blockNumber)}:value;
  };
 }
 f.options.provider=operationFundingReader(raw,owner);f.options.operationScope=()=>owner.scope;
 f.options.contextGuard=async()=>{if(invalid)throw Error('owner changed');};const funding=await f.open();
 const stop=Error('stop after authentic custody, before proof');let replacements=0;
 const continuation=createFundingContinuation({funding,application:{readFundingState:async()=>({status:'ready'}),prepare:async()=>{
  prepared++;assert.equal(owner.scope.synchronized,false);assert.equal(owner.scope.nativeSentinel,undefined);
  const custody=await funding.loadAggregate(payment.receipt.txHash);assert(custody.bridgeSecret&&custody.recipientSalt);throw stop;
 }},sdk:{Fr,waitForL1ToL2MessageReady:async()=>{bridged=true;if(failure==='owner')invalid=true;}},node:{},
 contextGuard:f.options.contextGuard,onProgress:()=>{},locked:async work=>{assert.equal(owner.scope,null);owner.scope={synchronized:false,nativeSentinel:{}};try{return await work();}finally{owner.scope=null;}},
 invalidateSnapshot:()=>{owner.scope=invalidateRollingFundingNativeSnapshot(owner.scope);replacements++;}});
 const before=[...f.records];await assert.rejects(continuation.advanceClaim(),error=>failure?error!==stop:error===stop);
 assert.equal(f.state.sends,1);assert.deepEqual([...f.records],before);assert.equal(owner.scope,null);
 assert.equal(counts.getTransactionReceipt,1);assert.equal(counts.getTransaction,1);assert.equal(counts.getCode,!failure?2:1);
 if(failure==='owner'){assert.equal(prepared,0);assert.equal(replacements,0);}else{assert.equal(prepared,1);assert.equal(replacements,1);assert.equal(counts.getNetwork,2);}
 if(!failure){assert.equal(counts.getBlock,5,'recover keeps its post-journal check; direct custody uses verifier final check');
  const receipts=counts.getTransactionReceipt;bridged=false;await assert.rejects(continuation.advanceClaim(),error=>error===stop);assert.equal(counts.getTransactionReceipt,receipts+1,'next outer lease obtains a fresh receipt');}
});
test('native reset retains only completed positive Ethereum identities, not pending, negative or network reads',async()=>{
 const owner={scope:{}},gates=Promise.withResolvers(),counts={};
 const raw={getNetwork:async()=>{counts.network=(counts.network??0)+1;return {chainId:1n};},
  getTransactionReceipt:async hash=>{counts[hash]=(counts[hash]??0)+1;
   if(hash===h(1))return {hash,blockHash:h(8),blockNumber:8};
   if(hash===h(2))return null;if(hash===h(3))return {hash,blockHash:null,blockNumber:null};
   if(hash===h(4))return {hash:h(999),blockHash:h(8),blockNumber:8};
   if(hash===h(5))throw Error('unavailable');await gates.promise;return {hash,blockHash:h(8),blockNumber:8};}};
 const read=operationFundingReader(raw,owner);
 await read.getNetwork();for(let n=1;n<=4;n++)await read.getTransactionReceipt(h(n));await assert.rejects(read.getTransactionReceipt(h(5)));
 const pending=read.getTransactionReceipt(h(6)),rejected=assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});await Promise.resolve();
 owner.scope=invalidateRollingFundingNativeSnapshot(owner.scope);gates.resolve();await rejected;
 await read.getNetwork();for(let n=1;n<=4;n++)await read.getTransactionReceipt(h(n));await assert.rejects(read.getTransactionReceipt(h(5)));await read.getTransactionReceipt(h(6));
 assert.equal(counts.network,2);assert.equal(counts[h(1)],1);for(let n=2;n<=6;n++)assert.equal(counts[h(n)],2);
});

test('native reset rereads same-height Ethereum code and bindings under the new canonical hash',async()=>{
 const owner={scope:{}},counts={code:0,call:0};let fork=false;
 const raw={getBlock:async()=>({number:8,hash:fork?h(9):h(8)}),getCode:async()=>{counts.code++;return fork?'0x02':'0x01';},call:async()=>{counts.call++;return fork?'0x04':'0x03';}};
 const read=operationFundingReader(raw,owner),request={to:a(1),data:'0x1234',blockTag:8};
 const first=await read.getBlock(8);assert.equal(await read.getCode(a(1),8),'0x01');assert.equal(await read.call(request),'0x03');
 fork=true;owner.scope=invalidateRollingFundingNativeSnapshot(owner.scope);
 const next=await read.getBlock(8);assert.notEqual(next.hash,first.hash);
 assert.equal(await read.getCode(a(1),8),'0x02');assert.equal(await read.call(request),'0x04');assert.equal((await read.getBlock(8)).hash,next.hash);
 assert.deepEqual(counts,{code:2,call:2});
});

for(const phase of ['recover','custody'])for(const mutation of ['fork-during-effects','owner-after-verifier'])test('purchase terminal fence rejects '+mutation+' in '+phase,async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare({...f.allocation,asset:'ETH'});const paid=await cap.confirm();
 const originalBlock=f.options.provider.getBlock,originalCode=f.options.provider.getCode,guard=f.options.contextGuard;
 let fork=false,blocks=0,invalid=false;const entered=Promise.withResolvers(),release=Promise.withResolvers();
 f.options.provider.getCode=async(...args)=>{entered.resolve();await release.promise;return originalCode(...args);};
 f.options.provider.getBlock=async(...args)=>{const value=await originalBlock(...args);blocks++;if(blocks===2&&mutation==='owner-after-verifier')invalid=true;return fork?{...value,hash:h(999)}:value;};
 f.options.contextGuard=async()=>{await guard();if(invalid)throw Error('owner changed after verifier');};
 // The capability captures its context guard at construction.
 const reopened=await f.open(),before=[...f.records];let settled=false;
 const pending=(phase==='recover'?reopened.recover():reopened.loadAggregate(paid.receipt.txHash)).finally(()=>settled=true),rejected=assert.rejects(pending);
 await entered.promise;assert.equal(settled,false);if(mutation==='fork-during-effects')fork=true;release.resolve();await rejected;
 assert.equal(blocks,2);assert.deepEqual([...f.records],before);assert.equal(f.state.sends,1);
});
test('purchase confirm still checks canonical block after reopening saved custody',async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare({...f.allocation,asset:'ETH'});
 const block=f.options.provider.getBlock;let receiptChecks=0;
 f.options.provider.getBlock=async number=>{const value=await block(number);if(f.state.sends&&number===17&&++receiptChecks===3)return {...value,hash:h(999)};return value;};
 await assert.rejects(cap.confirm());assert.equal(receiptChecks,3);assert.equal(f.state.sends,1);
});

test('purchase recovery retains final canonical check after fallback journal write',async()=>{
 const f=ethTopupFixture(),cap=await f.open();await cap.prepare({...f.allocation,asset:'ETH'});await cap.confirm();
 const receipt=f.options.provider.getTransactionReceipt,block=f.options.provider.getBlock,cas=f.options.storage.compareAndSwap;
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let reads=0,writes=0,fork=false,finalForkReads=0,settled=false;
 // The stored hash is unavailable initially. The real journal scans its nonce,
 // verifies the rediscovered transaction, then persists its hash before return.
 f.options.provider.getTransactionReceipt=async(...args)=>++reads===1?null:receipt(...args);
 f.options.storage.compareAndSwap=async(...args)=>{writes++;entered.resolve();await release.promise;return cas(...args);};
 f.options.provider.getBlock=async(...args)=>{const value=await block(...args);if(fork){finalForkReads++;return {...value,hash:h(999)};}return value;};
 const pending=cap.recover().finally(()=>settled=true),rejected=assert.rejects(pending);
 await entered.promise;assert.equal(settled,false);assert.equal(reads,2);assert.equal(writes,1);
 fork=true;release.resolve();await rejected;assert.equal(finalForkReads,1);assert.equal(f.state.sends,1);
});

for(const failure of ['none','scope','fees','owner'])test(`standalone confirm scope and fee wave drains before send: ${failure}`,async()=>{
 const hold=Promise.withResolvers(),entered=Promise.withResolvers(),started=new Set();
 let scopes=0,done=false;const mark=name=>{started.add(name);if(started.size===2)entered.resolve();};
 // Scope qualification belongs to the journal's prepareRequest immediately
 // before the wallet send; local custody writes do not repeat this RPC wave.
 const g=ethTopupFixture();let armed=false;const originalScope=g.options.resolveScope,originalFees=g.options.provider.getFeeData;
 g.options.resolveScope=async()=>{if(armed&&++scopes===1){mark('scope');if(failure==='scope')throw Error('scope read failed');await hold.promise;}return originalScope();};
 g.options.provider.getFeeData=async()=>{if(armed){mark('fees');if(failure==='fees')throw Error('fee read failed');await hold.promise;}return originalFees();};
 const current=await g.open();await current.prepare(g.allocation);armed=true;
 const pending=current.confirm().then(value=>({value}),error=>({error})).finally(()=>done=true);
 await entered.promise;await new Promise(setImmediate);assert.equal(done,false);assert.equal(g.state.sends,0);
 if(failure==='owner')g.state.invalid=true;hold.resolve();const result=await pending;
 if(failure==='none'){assert(result.value.receipt);assert.equal(g.state.sends,1);}else{assert(result.error);assert.equal(g.state.sends,0);}
});

for(const failure of ['network','operation','resolver'])test(`top-up failed first namespace qualification cannot seed custody: ${failure}`,async()=>{
 const f=topupFixture();let calls=0,operation={},bad=true;
 const network=f.options.provider.getNetwork;
 f.options.operationScope=()=>operation;
 f.options.resolveScope=async()=>{calls++;if(bad&&failure==='resolver')throw Error('scope failed');if(bad&&failure==='operation')operation={};return f.scope;};
 f.options.provider.getNetwork=async()=>bad&&failure==='network'?{chainId:1n}:network();
 const cap=await f.open();await assert.rejects(cap.inspect());assert.equal(calls,1);bad=false;
 assert.equal(await cap.inspect(),null);assert.equal(calls,2,'failed qualification did not publish the namespace');
 assert.equal(await cap.inspect(),null);assert.equal(calls,2);assert.equal(f.state.sends,0);
});

test('top-up custody survives native anchor replacement but receipt/fork authority stays fresh',async()=>{
 const f=ethTopupFixture();let operation={},scopes=0,receipts=0,blocks=0;
 f.options.operationScope=()=>operation;f.options.resolveScope=async()=>{scopes++;return f.scope;};
 const receipt=f.options.provider.getTransactionReceipt,block=f.options.provider.getBlock;
 f.options.provider.getTransactionReceipt=async(...args)=>{receipts++;return receipt(...args);};
 f.options.provider.getBlock=async(...args)=>{blocks++;return block(...args);};
 const cap=await f.open();await cap.prepare(f.allocation);const paid=await cap.confirm();const qualified=scopes;
 operation={};await cap.inspect();const before=receipts;await cap.recover();assert(receipts>before);const canonical=blocks;
 operation={synchronized:true};await cap.loadAggregate(paid.receipt.txHash);assert(blocks>canonical);assert.equal(scopes,qualified);
 f.options.provider.getBlock=async tag=>({...await block(tag),hash:h(999)});
 await assert.rejects(cap.recover());await assert.rejects(cap.loadAggregate(paid.receipt.txHash));assert.equal(scopes,qualified);assert.equal(f.state.sends,1);
});

for(const phase of ['approval','deposit','ETH'])test(`standalone ${phase} final scope failure restores both journals before any new send`,async()=>{
 const f=phase==='ETH'?ethTopupFixture():topupFixture(),journals=[],create=f.options.sdk.createEthereumJournal,scope=f.options.resolveScope;
 let failScope=false,scopeReads=0,writes=0;
 f.options.resolveScope=async()=>{scopeReads++;if(failScope)throw Error('Portal no longer active');return scope();};
 f.options.sdk.createEthereumJournal=async input=>{const journal=await create(input);journals.push(journal);return journal;};
 const cas=f.options.storage.compareAndSwap;f.options.storage.compareAndSwap=async(...args)=>{writes++;return cas(...args);};
 const cap=await f.open();await cap.prepare(f.allocation);
 if(phase==='deposit'){await cap.confirm();assert.equal(f.state.sends,1);assert.equal((await cap.prepare(f.allocation)).phase,'deposit');}
 const before=await cap.inspect(),previousRequest=await journals.at(-1).inspectRequest(),sends=f.state.sends,beforeWrites=writes;
 scopeReads=0;failScope=true;
 await assert.rejects(cap.confirm(),{code:'BB_ETH_PREFLIGHT_FAILED'});
 assert.equal(scopeReads,1,'fresh scope is checked exactly at the actual presend boundary');
 assert.equal(f.state.sends,sends,'no new wallet transaction was invoked');
 assert(writes>=beforeWrites+5,'both staged journal values and their rollbacks were exercised');
 assert.deepEqual(await cap.inspect(),before);assert.deepEqual(await journals.at(-1).inspectRequest(),previousRequest);
 await assert.rejects(cap.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 failScope=false;await cap.prepare(f.allocation);await cap.confirm();assert.equal(f.state.sends,sends+1,'explicitly reviewed replacement can send once');
});

for(const failed of [null,'qualification','quote'])test('readonly opening joins independent admission and quote, failure='+failed,async()=>{
 const f=fixture(),qualification=Promise.withResolvers(),quote=Promise.withResolvers(),qualificationEntered=Promise.withResolvers(),quoteEntered=Promise.withResolvers();
 const originalQuote=f.options.sdk.prepareAggregateFunding,error=Error('held '+failed);
 f.options.verifyScope=async()=>{qualificationEntered.resolve();await qualification.promise;return async()=>{};};
 f.options.sdk.prepareAggregateFunding=async(...args)=>{quoteEntered.resolve();await quote.promise;return originalQuote(...args);};
 const app=await f.open();let done=false;
 const pending=app.prepareReadOnly(openingAllocation(f)).finally(()=>{done=true;});pending.catch(()=>{});
 await Promise.all([qualificationEntered.promise,quoteEntered.promise]);
 assert.equal(f.records.size,0);assert.equal(f.state.signatures,0);assert.equal(f.state.sends,0);
 if(failed==='qualification')qualification.reject(error);else qualification.resolve();
 await new Promise(setImmediate);assert.equal(done,false,'held quote must drain before operation release');
 if(failed==='quote')quote.reject(error);else quote.resolve();
 if(failed)await assert.rejects(pending,e=>e===error);
 else{const token=await pending;await app.installPreparedQuote(token);assert.equal(f.records.size,1);}
 assert.equal(f.state.signatures,0);assert.equal(f.state.sends,0);
});

for(const asset of ['ETH','token'])test('owned Bok continuation keeps exact local custody through its own checkpoint only: '+asset,async()=>{
 const f=asset==='ETH'?ethTopupFixture():topupFixture(),cap=await f.open();await runTopupPayment(cap,f.allocation,await cap.prepare(f.allocation));
 const {receipt}=await cap.recover();assert.equal(await cap.readClaimCustody(receipt),null);let leaked;
 await cap.withClaimContinuation(async()=>{
  assert.equal(await cap.readClaimCustody(receipt),null);const paid=await cap.recover();
  for(const name of ['getNetwork','getTransactionReceipt','getTransaction','getBlock','getCode','call'])f.options.provider[name]=async()=>{throw Error('L1 must not be read for owned custody');};
  leaked=await cap.readClaimCustody(paid.receipt);assert.equal(leaked.bokScope.recipient,f.scope.recipient);await leaked.checkCurrent();
  const changed={...paid.receipt,amount:'301'};await assert.rejects(cap.readClaimCustody(changed),{code:'ROLLING_FUNDING_MISMATCH'});
  await cap.checkpointClaim({intentId:h(777),attempted:false});await leaked.checkCurrent();
  await cap.checkpointClaim({intentId:h(777),attempted:true});await leaked.checkCurrent();
  await assert.rejects(cap.withClaimContinuation(async()=>{}),{code:'ROLLING_FUNDING_BUSY'});
 });
 assert.equal(await cap.readClaimCustody(receipt),null);await assert.rejects(leaked.checkCurrent(),{code:'ROLLING_FUNDING_MISMATCH'});
 assert.equal(f.state.sends,asset==='ETH'?1:2);
});
for(const failure of ['cursor','owner','failed-payment','throw'])test('owned Bok continuation rejects changed custody or failure: '+failure,async()=>{
 const f=ethTopupFixture(),cap=await f.open();await runTopupPayment(cap,f.allocation,await cap.prepare(f.allocation));let invalid=false;
 f.options.contextGuard=async()=>{if(invalid)throw Error('owner replaced');};
 // Reopen to capture the guard, using the same authenticated slot.
 const current=await f.open();let receipt,leaked;
 await assert.rejects(current.withClaimContinuation(async()=>{
  if(failure==='failed-payment')f.options.provider.getTransactionReceipt=async()=>null;
  ({receipt}=await current.recover());leaked=await current.readClaimCustody(receipt);
  if(failure==='cursor'){
   const entry=[...f.records.entries()].find(([,value])=>value.includes('recovery'));assert(entry);
   // Changing any slot is insufficient; change the exact active topup record.
   for(const [key,value]of f.records)f.records.set(key,value+' ');
  }else if(failure==='owner')invalid=true;
  else if(failure==='throw')throw Error('owned work failed');
  await leaked.checkCurrent();
 }));
 invalid=false;assert.equal(await current.readClaimCustody(receipt),null);
 if(leaked)await assert.rejects(leaked.checkCurrent());assert.equal(f.state.sends,1);
});

for(const changedWallet of [false,true])test('direct opening quote cannot replace hidden Ethereum intent, changedWallet='+changedWallet,async()=>{
 const f=fixture(),app=await f.open(),allocation=openingAllocation(f);await app.prepare(allocation);const unsigned=[...f.records];
 f.state.unknown=true;await assert.rejects(app.confirm());assert.equal(f.state.sends,1);
 // Model an aggregate draft restored beside its still-authenticated unknown ETH
 // journal. The final native journal inspection must veto custody replacement.
 for(const [key,value]of unsigned)f.records.set(key,value);
 if(changedWallet)f.wallet.address=new ethers.Wallet(h(98)).address.toLowerCase();
 const before=[...f.records],reopened=await f.open();
 await assert.rejects(reopened.prepare(allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});assert.deepEqual([...f.records],before);assert.equal(f.state.sends,1);
});

test('direct fresh quote uses one nonce read and one final canonical quote fence before custody save',async()=>{
 const f=fixture(),counts={nonce:0,numbered:0},read=f.options.provider.send,nonce=f.options.provider.getTransactionCount;
 f.options.provider.getTransactionCount=async(...args)=>{counts.nonce++;return nonce(...args);};
 f.options.provider.send=async(method,params)=>{if(method==='eth_getBlockByNumber'&&params[0]==='0x10')counts.numbered++;return read(method,params);};
 f.options.sdk.validateAggregateFundingQuote=()=>assert.fail('direct preparation must not repeat the SDK final validity fence');
 const app=await f.open();await app.prepare(openingAllocation(f));assert.deepEqual(counts,{nonce:1,numbered:1});assert.equal(f.records.size,1);assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
});
for(const changed of ['fork','chain','expiry'])test('direct fresh quote retains final '+changed+' rejection before custody',async()=>{
 const f=fixture(),read=f.options.provider.send;let pending=0,chains=0;
 f.options.provider.send=async(method,params)=>{
  const value=await read(method,params);
  if(method==='eth_getBlockByNumber'&&params[0]==='0x10'&&changed==='fork')return {...value,hash:h(90)};
  if(method==='eth_chainId'&&++chains===2&&changed==='chain')return '0x2';
  if(method==='eth_getBlockByNumber'&&params[0]==='pending'&&++pending===2&&changed==='expiry')return {...value,timestamp:'0x10000'};
  return value;
 };
 const app=await f.open();await assert.rejects(app.prepare(openingAllocation(f)));assert.equal(f.records.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
});

for(const failure of ['none','qualification','nonce','both','owner'])test('direct ETH qualification/nonce wave drains before journal work: '+failure,async()=>{
 const f=fixture(),qualification=Promise.withResolvers(),nonce=Promise.withResolvers(),qualificationEntered=Promise.withResolvers(),nonceEntered=Promise.withResolvers();
 const rejectedQualification=Error('qualification failed'),rejectedNonce=Error('nonce failed');
 let captures=0,nonceReads=0,journalReads=0,writes=0,settled=false;
 const capture=f.options.captureWallet,createSlot=f.options.sdk.createEncryptedJournalSlot;
 f.options.captureWallet=async()=>{captures++;return capture();};
 f.options.verifyScope=async()=>{qualificationEntered.resolve();await qualification.promise;if(['qualification','both'].includes(failure))throw rejectedQualification;return async()=>{};};
 f.options.provider.getTransactionCount=async()=>{nonceReads++;nonceEntered.resolve();await nonce.promise;if(['nonce','both'].includes(failure))throw rejectedNonce;return 7;};
 f.options.sdk.createEncryptedJournalSlot=async options=>{const slot=await createSlot(options);return {...slot,read:async(...args)=>{journalReads++;return slot.read(...args);},write:async(...args)=>{writes++;return slot.write(...args);}};};
 const app=await f.open(),pending=app.prepare(f.allocation).finally(()=>settled=true);pending.catch(()=>{});
 await Promise.all([qualificationEntered.promise,nonceEntered.promise]);
 assert.equal(captures,1);assert.equal(nonceReads,1);assert.equal(journalReads,0);assert.equal(writes,0);assert.equal(f.records.size,0);
 if(failure==='nonce'){nonce.resolve();await new Promise(setImmediate);assert.equal(settled,false);qualification.resolve();}
 else{qualification.resolve();await new Promise(setImmediate);assert.equal(settled,false);assert.equal(journalReads,0);if(failure==='owner')f.state.invalid=true;nonce.resolve();}
 if(failure==='none'){const quote=await pending;assert.equal(quote.ethereumNonce,7);assert.equal(writes,1);assert.equal(captures,1);assert.equal(nonceReads,1);}
 else{await assert.rejects(pending,failure==='owner'?/Context changed/:error=>error===(failure==='nonce'?rejectedNonce:rejectedQualification));assert.equal(journalReads,0);assert.equal(writes,0);assert.equal(f.records.size,0);}
 assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
});
test('direct ETH early nonce retains predecessor maximum and final wallet guard',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();
 const workflow=durableClaimApplication(f,app);await advanceAggregateClaim({application:workflow.open(),funding:app});
 f.state.nonce=6;
 const review=await app.prepare(f.allocation);assert.equal(review.ethereumNonce,8);
 const sends=f.state.sends;f.state.nonce=9;await assert.rejects(app.confirm(),{code:'ROLLING_FUNDING_NONCE_CHANGED'});assert.equal(f.state.sends,sends);
});
test('direct ETH qualification/nonce wave does not bypass quote-final fork or final wallet guard',async()=>{
 for(const failure of ['fork','wallet']){
  const f=fixture(),send=f.options.provider.send;let numbered=0;
  if(failure==='fork')f.options.provider.send=async(method,params)=>{const result=await send(method,params);if(method==='eth_getBlockByNumber'&&params[0]!=='latest'&&params[0]!=='pending'&&++numbered===1)return {...result,hash:h(999)};return result;};
  else f.wallet.guard=async()=>{throw Error('wallet replaced');};
  const app=await f.open();await assert.rejects(app.prepare(f.allocation));assert.equal(f.records.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
 }
});

function bokRecoveryWaveFixture(){
 const f=claimProgressFixture();f.input.funding.inspect=async()=>({paymentSaved:true,privateFeeCap:'10',claim:null,claimAction:'claim-bok',phase:'deposit'});return f;
}
for(const first of ['recover','account-status'])test(`Bok recovery wave overlaps independent journals; ${first} completes first`,async()=>{
 const f=bokRecoveryWaveFixture(),gates={'recover':Promise.withResolvers(),'account-status':Promise.withResolvers()},entered=new Set(),both=Promise.withResolvers();
 f.input.funding.recover=async()=>{entered.add('recover');if(entered.size===2)both.resolve();await gates.recover.promise;return {receipt:{private:'SECRET_RECEIPT'}};};
 f.input.application.readFundingState=async()=>{entered.add('account-status');if(entered.size===2)both.resolve();await gates['account-status'].promise;return {status:'ready'};};
 let done=false;const result=advanceAggregateClaim(f.input).finally(()=>done=true);await both.promise;
 gates[first].resolve();await new Promise(setImmediate);assert.equal(done,false);assert(!f.calls.includes('prepare'));
 const completion=f.rows.filter(row=>row.state==='complete'&&row.step!=='inspect');assert.deepEqual(completion.map(row=>row.step),[first]);
 gates[first==='recover'?'account-status':'recover'].resolve();assert.equal((await result).state,'complete');assert(!f.rows.some(row=>row.state==='failed'));
});
for(const failure of ['recover','account-status','both'])test(`Bok recovery wave drains before ${failure} failure and reports only selected diagnostic`,async()=>{
 const f=bokRecoveryWaveFixture(),gates=[Promise.withResolvers(),Promise.withResolvers()],entered=Promise.withResolvers(),errors=[Error('Ethereum private failure'),Error('Aztec private failure')];let arrivals=0,done=false;
 const run=async(i,name,value)=>{if(++arrivals===2)entered.resolve();await gates[i].promise;if(failure===name||failure==='both')throw errors[i];return value;};
 f.input.funding.recover=()=>run(0,'recover',{receipt:{}});f.input.application.readFundingState=()=>run(1,'account-status',{status:'ready'});
 const result=advanceAggregateClaim(f.input).finally(()=>done=true),expected=failure==='account-status'?1:0,observed=assert.rejects(result,e=>e===errors[expected]);
 await entered.promise;gates[expected].resolve();await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.rows.filter(row=>row.state==='failed').length,0);assert(!f.calls.includes('prepare'));
 gates[1-expected].resolve();await observed;assert.deepEqual(f.rows.filter(row=>row.state==='failed').map(row=>row.step),[expected?'account-status':'recover']);assert(!f.calls.includes('submit'));assert(!JSON.stringify(f.rows).includes('private failure'));
});
for(const mode of ['pending','approved'])test(`Bok recovery wave retains ${mode} recovery priority after draining a failed workflow read`,async()=>{
 const f=bokRecoveryWaveFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let done=false;
 f.input.funding.recover=async()=>{if(mode==='pending')throw Object.assign(Error('pending'),{code:'ROLLING_FUNDING_PENDING'});return {approved:true};};
 f.input.application.readFundingState=async()=>{entered.resolve();await gate.promise;throw Error('unneeded workflow failure');};
 const result=advanceAggregateClaim(f.input).finally(()=>done=true);await entered.promise;await new Promise(setImmediate);assert.equal(done,false);gate.resolve();
 assert.deepEqual(await result,mode==='pending'?{state:'waiting',phase:'payment'}:{state:'review-payment'});assert(!f.calls.includes('prepare'));assert.deepEqual(f.rows.filter(row=>row.state==='failed').map(row=>row.step),mode==='pending'?['recover']:[]);
});
for(const mode of ['saved-claim','approval','private-fee','aggregate'])test(`Bok recovery wave does not apply to ${mode}`,async()=>{
 const f=bokRecoveryWaveFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let statusReads=0;
 f.input.funding.inspect=async()=>({paymentSaved:true,privateFeeCap:'10',claim:mode==='saved-claim'?{intentId:'PRIVATE_ID',attempted:false}:null,phase:mode==='approval'?'approval':'deposit',claimAction:mode==='private-fee'?'claim-private-fee':mode==='aggregate'?'claim-deposit':'claim-bok'});
 f.input.funding.recover=async()=>{entered.resolve();await gate.promise;return mode==='approval'?{approved:true}:{receipt:{}};};f.input.application.readFundingState=async()=>{statusReads++;return {status:'ready'};};
 const result=advanceAggregateClaim(f.input);await entered.promise;await new Promise(setImmediate);assert.equal(statusReads,0);gate.resolve();await result;
 assert.equal(statusReads,['saved-claim','approval'].includes(mode)?0:1);
});

for(const [asset,make] of [['ETH',fixture],['USDC',usdcWalletFixture]])test(`${asset} posting credit has one payment, no collateral signature, durable private fee claim`,async()=>{
 const f=make();Object.assign(f.allocation,{collateralWei:'0',bokAmount:'0',...(asset==='ETH'?{bokPoolFee:0}:{collateralPoolFee:0})});
 const funding=await f.open();await funding.prepare(f.allocation);await funding.confirm();const receipts=await funding.recover();
 assert.deepEqual(Object.keys(receipts),['receipt']);assert.equal(receipts.receipt.amount,'200');assert.equal(f.state.signatures,asset==='ETH'?0:1);assert.equal(f.state.sends,asset==='ETH'?1:0);if(asset==='USDC')assert.equal(f.state.posts,1);
 const saved=await funding.inspect();assert.equal(saved.claimAction,'claim-private-fee');assert.equal(saved.asset,asset);assert.equal(saved.completed,false);
 const workflow=durableClaimApplication(f,funding),result=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(result.state,'complete');assert.equal(result.intent.action.type,'claim-private-fee');assert.equal(workflow.state.sends,1);assert.equal((await funding.inspect()).completed,true);
 await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,asset==='ETH'?1:0);
});
