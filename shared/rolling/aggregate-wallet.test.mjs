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
import {prepareAggregateFunding,aggregateFundingTransaction,prepareAggregateUsdcFunding,aggregateUsdcFundingTransaction,aggregateFundingAbi} from './aggregate-funding.mjs';
import {validateAggregateFundingIntent} from './aggregate-recovery.mjs';
import {createAggregateWallet} from './aggregate-wallet.mjs';
const a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const router=new ethers.Interface(aggregateFundingAbi),portal=new ethers.Interface(['function depositNonces(address) view returns(uint256)','function depositsEnabled() view returns(bool)','function getDeposit(address) view returns(uint128)','function MIN_DEPOSIT() view returns(uint256)','function MAX_DEPOSIT() view returns(uint256)','event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const bok=new ethers.Interface(['function active() view returns(bool)','event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
const fee=new ethers.Interface(['event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const quoter=new ethers.Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
function fixture({chainId='31337'}={}){
 const scope={chainId,router:a(1),routerCodeHash:ethers.keccak256('0x6000'),collateralPortal:a(2),feePortal:a(3),bokPortal:a(4),weth:a(5),swapRouter:a(6),feeToken:a(7),bokToken:a(8),privateFpc:h(9),quoter:a(10),quoterCodeHash:ethers.keccak256('0x6000')};
 const signer=new ethers.Wallet(h(99)),address=signer.address.toLowerCase(),records=new Map();
 const state={sends:0,signatures:0,nonce:7,clock:1000,connected:true,invalid:false,unknown:false,landed:false,reads:0};
 const allocation={asset:'ETH',collateralWei:'100',feeAmount:'200',bokAmount:'300',feePoolFee:3000,bokPoolFee:500,slippageBps:100,gasBudgetWei:'10000',privateFeeCap:'1000'};
 const storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,old,value)=>{assert.equal(records.get(key)??null,old);records.set(key,value);}};
 let tx,receipt;
 const provider={getNetwork:async()=>({chainId:BigInt(chainId)}),getTransactionCount:async()=>state.nonce,getBlockNumber:async()=>state.landed?17:16,
  getBlock:async number=>({number:number==='latest'?16:number,hash:h(number==='latest'?16:number),parentHash:h(Number(number)-1||15),prefetchedTransactions:state.landed?[tx]:[]}),
  getFeeData:async()=>({maxFeePerGas:2n,maxPriorityFeePerGas:1n}),estimateGas:async()=>100n,getCode:async()=> '0x6000',getTransaction:async()=>tx,getTransactionReceipt:async()=>state.landed?receipt:null,
  async send(method,params){state.reads++;
   if(method==='eth_chainId')return '0x'+BigInt(chainId).toString(16);
   if(method==='eth_getBlockByNumber')return {number:'0x10',hash:h(16),timestamp:'0x3e8'};
   if(method==='eth_getCode')return '0x6000';if(method==='eth_getBalance')return '0xffffff';
   assert.equal(method,'eth_call');const {to,data}=params[0];
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
    log(scope.collateralPortal,portal,'Deposited',[address,p.collateral,p.collateralSecretHash,h(30),1]),
    log(scope.feePortal,fee,'DepositToAztecPublic',[scope.privateFpc,p.fee.amount,p.feeSecretHash,h(31),2]),
    log(scope.bokPortal,bok,'Deposited',[p.bokCommitment,p.bok.amount,h(32),3])
   ]};if(state.unknown)throw Error('Lost acknowledgement');state.landed=true;return {hash:h(20)};
  }}};
 const options={sdk:{Fr,computeSecretHash,poseidon2HashWithSeparator,deriveBoardDepositSecret,claimSecrets,createEncryptedJournalSlot,createEthereumJournal,verifyEthereumIntentReceipt,prepareAggregateFunding,aggregateFundingTransaction,validateAggregateFundingIntent},ethers,scope,
  network:{chainId,version:'1',rollup:a(11)},board:h(12),bok:h(13),owner:h(14),walletSecret:h(15),walletSalt:'0',storage,provider,
  captureWallet:async()=>{if(!state.connected)throw Error('No wallet');return wallet;},contextGuard:async()=>{if(state.invalid)throw Error('Context changed');},verifyScope:async()=>{},nowSeconds:()=>state.clock};
 return {options,state,allocation,records,wallet,open:()=>createAggregateWallet(options)};
}
test('aggregate review never signs/sends; explicit confirm uses Ethereum nonce, distinct consent nonce, and authenticates three receipts',async()=>{
 const f=fixture(),app=await f.open(),review=await app.prepare(f.allocation);assert.equal(review.ethereumNonce,7);assert.equal(review.consentNonce,'2');assert.equal(f.state.sends,0);assert.equal(f.state.signatures,0);
 assert(!JSON.stringify(review).includes('recipientSalt'));assert(!JSON.stringify([...f.records.values()]).includes('recipientSalt'));
 const result=await app.confirm();assert.equal(f.state.sends,1);assert.equal(f.state.signatures,1);assert.equal(result.bokReceipt.nonce,'7');assert.equal(result.feeReceipt.amount,'200');
 f.state.connected=false;const reopened=await f.open(),context=await reopened.loadAggregate(result.receipt.txHash);assert.equal(context.intent.nonce,7);assert.equal(context.bokScope.portal,f.options.scope.bokPortal);
 assert.equal((await reopened.recover()).receipt.txHash,result.receipt.txHash);assert.equal(f.state.sends,1);await assert.rejects(reopened.confirm(),{code:'ROLLING_FUNDING_QUOTE_REQUIRED'});
 await assert.rejects(reopened.prepare(f.allocation),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
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
for(const mode of ['expired','account','signature'])test('aggregate confirmation fails closed for '+mode,async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);
 if(mode==='expired')f.state.clock=1121;if(mode==='account')f.state.invalid=true;if(mode==='signature')f.wallet.signer.signTypedData=(...args)=>new ethers.Wallet(h(98)).signTypedData(...args);
 await assert.rejects(app.confirm());assert.equal(f.state.sends,0);
});
test('unrelated tx hash cannot load retained secret context',async()=>{const f=fixture(),app=await f.open();await app.prepare(f.allocation);await app.confirm();assert.equal(await app.loadAggregate(h(21)),null);});
test('gas increase stops before the original payment intent is written',async()=>{
 const f=fixture(),app=await f.open();await app.prepare(f.allocation);f.options.provider.getFeeData=async()=>({maxFeePerGas:10000n});
 await assert.rejects(app.confirm(),{code:'ROLLING_FUNDING_GAS_CHANGED'});assert.equal(f.state.sends,0);assert.equal((await app.inspect()).paymentSaved,false);
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
test('archive is durable before a successor quote; active collateral prevents overwrite and original secrets survive later draft',async()=>{
 const f=fixture();f.options.reconcileClaim=async()=>({status:'confirmed'});const app=await f.open();await app.prepare(f.allocation);await app.confirm();
 await app.checkpointClaim({intentId:h(100),attempted:true});const original=await app.loadAggregate(h(20));
 const send=f.options.provider.send;f.options.provider.send=async(method,params)=>{
  if(method==='eth_call'&&params[0].to===f.options.scope.collateralPortal&&portal.parseTransaction({data:params[0].data}).name==='getDeposit')return portal.encodeFunctionResult('getDeposit',[100]);
  return send(method,params);
 };
 await assert.rejects(app.prepare(f.allocation),{code:'AGGREGATE_EXISTING_DEPOSIT'});
 assert.equal(f.records.size,3);assert.equal((await app.inspect()).paymentSaved,true);
 f.options.provider.send=send;const reopened=await f.open();await reopened.prepare(f.allocation);assert.equal((await reopened.inspect()).paymentSaved,false);
 assert.deepEqual(await reopened.loadAggregate(h(20)),original);assert.equal(f.state.sends,1);
 const foreign=await createAggregateWallet({...f.options,owner:h(77)});assert.equal(await foreign.loadAggregate(h(20)),null);
});

import fs from 'node:fs';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {encodeArguments,loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {createRollingApplication} from './application.mjs';
import {advanceAggregateClaim} from './aggregate-wallet.mjs';
const boardArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const bokArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url))));
function durableClaimApplication(f,funding){
 // Original application, ABIs and AES-GCM/CAS workflow; the canonical L2
 // outcome and bridge witness adapter are labelled finite SDK fixtures.
 const state={sends:0,prepares:0,outcome:null},owner=new AztecAddress(Fr.fromString(f.options.owner));
 const node={getBlockData:async()=>({header:{globalVariables:{blockNumber:3}},blockHash:h(60)}),getNodeInfo:async()=>({l1ContractAddresses:{feeJuicePortalAddress:f.options.scope.feePortal,feeJuiceAddress:f.options.scope.feeToken}})};
 const journal={assertCanStart:async()=>{},inspectOutcome:async()=>state.outcome,inspect:async()=>state.outcome,confirmed:()=>{}};
 const wallet={aztecNode:node,pxe:{getSyncedBlockHeader:async()=>({globalVariables:{blockNumber:3},hash:async()=>h(60),state:{l1ToL2MessageTree:{root:new Fr(61)}}})},getAccounts:async()=>[owner],getChainInfo:async()=>({chainId:31337,version:1}),sendTx:async(_payload,options)=>{
  state.sends++;state.outcome={operation:options.journalOperation,outcome:'success',txHash:h(70),receipt:{txHash:h(70),status:'checkpointed',blockNumber:3,blockHash:h(60),transactionFee:1n}};return {receipt:{}};
 }};
 const sdk={Fr,AztecAddress,encodeArguments,isTrustedPrivateNode:n=>n===node,isPrivateWalletForNode:(w,n)=>w===wallet&&n===node,isPrivatePXEForNode:(p,n)=>p===wallet.pxe&&n===node,inspectTrustedNode:async()=>{},
  Contract:{at:()=>({methods:new Proxy({},{get:(_,name)=>(...args)=>({name,args,simulate:async()=>({result:[0n,...Array(9).fill(0n)]})})})})},
  BatchCall:class{constructor(_wallet,interactions){this.interactions=interactions;}},
  preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async({interaction})=>{state.prepares++;return {maximumFee:10n,payload:interaction,gasSettings:{}};},
  prepareFundingClaim:async input=>({status:'claim-ready',claim:input.kind==='collateral'?{contract:f.options.board,method:'claim_deposit',args:[input.receipt.sender,input.receipt.amount,h(80),input.receipt.leafIndex]}:input.kind==='private-fee'?{contract:f.options.scope.privateFpc,kind:'private-fee-bridge',bridgeClaim:{amount:input.receipt.amount,salt:h(81),leafIndex:input.receipt.leafIndex}}:{contract:f.options.bok,method:'claim',args:[input.receipt.amount,input.secrets.recipientSalt,input.secrets.bridgeSecret,input.receipt.leafIndex]}})};
 const options={sdk,deployment:{board:{address:f.options.board,artifact:boardArtifact},network:f.options.network,portal:f.options.scope.collateralPortal,
  privateFee:{address:f.options.scope.privateFpc,artifact:{},gasSettings:{}},bok:{address:f.options.bok,operator:h(16),pluginId:h(17),artifact:bokArtifact}},
  accountSession:{owner,wallet,node,journal,walletSecret:f.options.walletSecret,walletSalt:f.options.walletSalt},privateStore:f.options.storage,contextGuard:async()=>{},funding:{provider:f.options.provider,loadAggregate:hash=>funding.loadAggregate(hash)}};
 return {state,open:()=>createRollingApplication(options)};
}
test('original encrypted application workflow relinks after prepare-before-checkpoint interruption and sends once',async()=>{
 const f=fixture(),funding=await f.open();await funding.prepare(f.allocation);const receipts=await funding.confirm();
 const workflow=durableClaimApplication(f,funding),first=workflow.open(),prepared=await first.prepare({type:'claim-deposit',...receipts});assert.equal((await funding.inspect()).claim,null);
 const next=await advanceAggregateClaim({application:workflow.open(),funding:await f.open()});assert.equal(next.state,'complete');assert.equal(next.intent.intentId,prepared.intentId);assert.equal(workflow.state.sends,1);assert.equal(f.state.sends,1);
 assert.equal((await advanceAggregateClaim({application:workflow.open(),funding:await f.open()})).state,'complete');assert.equal(workflow.state.sends,1);
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
  f.state.posts++;assert.equal(f.state.signatures,2);assert.equal(claims.size,1);assert(f.records.size>0);
  if(f.state.lost)throw Error('labelled lost relay reply');
  const p=router.parseTransaction({data}).args.p,hash=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([router.getFunction('fundUsdc').inputs[0]],[p]));
  f.state.usdcTx={hash:h(200),from:relayer,to:s.router,nonce:42,chainId:31337n,value:0n,data};
  const log=(address,iface,name,args)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
  f.state.usdcReceipt={hash:h(200),from:relayer,to:s.router,blockNumber:17,blockHash:h(17),status:1,logs:[
   log(s.router,router,'UsdcFunded',[p.beneficiary,hash,p.relayer,p.collateral.amount,p.fee.amount,p.bokAmount,p.collateral.maxUsdc,p.fee.maxUsdc,p.relayFeeUsdc,0]),
   log(s.collateralPortal,portal,'Deposited',[p.beneficiary,p.collateral.amount,p.collateralSecretHash,h(30),1]),
   log(s.feePortal,fee,'DepositToAztecPublic',[s.privateFpc,p.fee.amount,p.feeSecretHash,h(31),2]),
   log(s.bokPortal,bok,'Deposited',[p.bokCommitment,p.bokAmount,h(32),3])
  ]};return {status:'unresolved'};
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
 const f=usdcWalletFixture(),app=await f.open();await app.prepare(f.allocation);f.state.lost=true;await assert.rejects(app.confirm());
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
 for(const mode of ['reorg','replacement','unfinalized','archive']){
  const f=fixture({chainId:mode==='unfinalized'?'1':'31337'}),get=f.options.provider.getTransactionReceipt;
  f.options.provider.getTransactionReceipt=async(...args)=>{const r=await get(...args);return r?{...r,status:0,logs:[]}:r;};
  const funding=await f.open();await funding.prepare(f.allocation);await assert.rejects(funding.confirm());
  if(mode==='reorg'){const getBlock=f.options.provider.getBlock;let calls=0;f.options.provider.getBlock=async n=>({...await getBlock(n),...(n===17&&++calls>1?{hash:h(999)}:{})});}
  if(mode==='replacement'){const getTx=f.options.provider.getTransaction;f.options.provider.getTransaction=async(...a)=>({...await getTx(...a),data:'0x1234'});}
  if(mode==='unfinalized'){const getBlock=f.options.provider.getBlock;f.options.provider.getBlock=async n=>n==='finalized'?{number:16,hash:h(16)}:getBlock(n);}
  if(mode==='archive'){const cas=f.options.storage.compareAndSwap;f.options.storage.compareAndSwap=async(key,...args)=>{if(!f.records.has(key))throw Error('archive unavailable');return cas(key,...args);};}
  await assert.rejects((await f.open()).prepare(f.allocation));assert.equal(f.state.sends,1);assert.equal((await funding.inspect()).paymentSaved,true);
 }
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

import {submitWithStandaloneTopupCheckpoint} from './aggregate-wallet.mjs';
for(const kind of ['private-fee','bok'])test(`direct ${kind} manual over-cap claim checkpoints before send and retains confirmed successor`,async()=>{
 const f=topupFixture(kind);f.state.allowance=1000n;let workflow;f.options.reconcileClaim=id=>workflow.open().reconcile(id);const funding=await f.open();await funding.prepare({...f.allocation,privateFeeCap:'1'});await funding.confirm();workflow=durableClaimApplication(f,funding);
 const review=await advanceAggregateClaim({application:workflow.open(),funding});assert.equal(review.state,'review');assert.equal((await funding.inspect()).claim.attempted,false);assert.equal(workflow.state.sends,0);
 const original=workflow.open(),application={...original,submitPrepared:async id=>{assert.equal((await funding.inspect()).claim.attempted,true);return original.submitPrepared(id);}};
 const done=await submitWithStandaloneTopupCheckpoint({application,topups:{[kind]:funding},intentId:review.intent.intentId});assert.equal(done.status,'confirmed');assert.equal(workflow.state.sends,1);
 f.options.reconcileClaim=async()=>{throw Error('later unrelated workflow');};await (await f.open()).prepare(f.allocation);assert.equal(f.state.sends,1);
});

test('direct top-up manual checkpoint rejects substituted receipt and leaves unrelated imported claim alone',async()=>{
 const f=topupFixture(),funding=await f.open();f.state.allowance=1000n;await funding.prepare(f.allocation);const {receipt}=await funding.confirm();await funding.checkpointClaim({intentId:h(901),attempted:false});let sends=0;
 const app=id=>({reconcile:async()=>({intentId:id,status:'prepared',action:{type:'claim-bok',receipt:{...receipt,amount:'999'}}}),submitPrepared:async()=>{sends++;return {status:'unknown'};}});
 await assert.rejects(submitWithStandaloneTopupCheckpoint({application:app(h(901)),topups:{bok:funding},intentId:h(901)}),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(sends,0);assert.equal((await funding.inspect()).claim.attempted,false);
 await submitWithStandaloneTopupCheckpoint({application:app(h(902)),topups:{bok:funding},intentId:h(902)});assert.equal(sends,1);assert.equal((await funding.inspect()).claim.attempted,false);
});

function claimProgressFixture(failureStep,original){
 const rows=[],calls=[],run=(name,value)=>async()=>{calls.push(name);if(name===failureStep)throw original;return value;};
 const saved={paymentSaved:true,privateFeeCap:'10',claim:failureStep==='reconcile'?{intentId:'PRIVATE_ID',attempted:true}:null};
 const prepared={intentId:'PRIVATE_ID',status:'prepared',maximumFee:'10'},confirmed={...prepared,status:'confirmed'};
 return {rows,calls,input:{onProgress:row=>rows.push(row),funding:{inspect:run('inspect',saved),recover:run('recover',{receipt:{private:'SECRET_RECEIPT'}}),checkpointClaim:run('checkpoint'),recordConfirmedClaim:run('record')},application:{readAccountStatus:run('account-status',{status:'fee-ready'}),prepare:run('prepare',prepared),submitPrepared:run('submit',confirmed),reconcile:run('reconcile',confirmed)}}};
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
 for(const [step,code]of [['recover','ROLLING_FUNDING_PENDING'],['prepare','ROLLING_FUNDING_NOT_READY']]){const f=claimProgressFixture(step,Object.assign(Error('private'),{code}));assert.deepEqual(await advanceAggregateClaim(f.input),{state:'waiting'});assert.equal(f.rows.at(-1).code,code);assert(!f.calls.includes('submit'));}
});
