import {createHistoryCursor} from '../shared/history-cursor.mjs';
import {TxHash} from '@aztec/stdlib/tx';
import * as transactionOutcomes from '../shared/transaction-outcomes.mjs';
// Actual application routing, with explicit node/proof/payment-preparer doubles.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {Fr} from '@aztec/foundation/curves/bn254';
import {Gas,GasFees,GasSettings} from '@aztec/stdlib/gas';
import {NO_FROM} from '@aztec/aztec.js/account';
const source=await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
function context(){const c=vm.createContext({console,Buffer,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(source,c);return c;}
const gas=()=>new GasSettings(new Gas(100,200),new Gas(1,2),new GasFees(3n,4n),new GasFees(0n,0n));
function fixture(failure){
 const c=context(),prepared=[],sends=[],owner={toString:()=> 'owner'};
 const paymentMethod={getExecutionPayload(){}};
 const a={GasSettings,preparePrivateFeePayment:async input=>{prepared.push(input);return {paymentMethod,gasSettings:gas()};}};
 const config={privateFee:{contractAddress:'fee',gasSettings:gas()},privateFeeClaim:{amount:'100',salt:'secret-salt',leafIndex:'2'}};
 const contract={methods:new Proxy({},{get:(_,method)=>(...args)=>({send:async opts=>{sends.push({method,args,opts});if(failure)throw failure;return {receipt:{status:'checkpointed'}};}})})};
 const sender=c.BillboardPrivateFeeRouting.createPrivateFeeSender({a,config,privateFeeArtifact:{},contract,wallet:{},node:{},owner,scope:{l1ChainId:'31337',rollupVersion:'1'}});
 return {sender,prepared,sends,owner,paymentMethod};
}
test('normal author calls carry only private payment method and bootstrap claim is consumed once',async()=>{
 const h=fixture();await h.sender('claim',['deposit']);await h.sender('post',['message']);await h.sender('withdraw',['chain']);
 assert.deepEqual(h.sends.map(x=>x.method),['claim_deposit','post','withdraw']);
 for(const send of h.sends){assert.equal(send.opts.from,h.owner);assert.equal(send.opts.fee.paymentMethod,h.paymentMethod);assert(!('authWitnesses' in send.opts));}
 assert.equal(h.prepared[0].claim.salt,'secret-salt');assert.equal(h.prepared[1].claim,undefined);assert.equal(h.prepared[2].claim,undefined);
});
test('unknown submission is preserved without retry and private errors are redacted',async()=>{
 for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','UNTRUSTED']){
  const failure=Object.assign(new Error('secret input details'),{code,stateReasons:['Block header not found']});const h=fixture(failure);
  await assert.rejects(h.sender('post',['message']),e=>e.code===(code==='UNTRUSTED'?'BB_PRIVATE_FEE_ACTION_FAILED':code)&&!e.message.includes('secret'));
  assert.equal(h.sends.length,1);assert.equal(h.prepared.length,1);
 }
});
test('missing private fee configuration fails before account work for every private action',async()=>{
 for(const action of ['claim','post','withdraw','auto']){
  const c=context();await assert.rejects(c.runBillboardUser({aztec:{},log(){},artifact:{}},{action,aztecWallet:{secretKey:'private'}}),e=>e.code==='BB_PRIVATE_FEE_UNAVAILABLE');
 }
});
const owner={toString:()=> 'owner'};
test('actual wallet keeps configured gas and normal account scope/tag through simulation and proof',async()=>{
  const c=context(),calls=[],settings=gas(),expectedSettings=gas(),txHash={toString:()=>new Fr(4).toString()},payload={authWitnesses:['exact-auth']};
  const receipt={txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
  const node={sendTx:async()=>calls.push('submit'),getTxReceipt:async()=>receipt,getBlock:async()=>({hash:'block'})};
  class BaseWallet {
    constructor(pxe){this.pxe=pxe;}
    async completeFeeOptions(opts){calls.push(['fees',opts]);return {gasSettings:opts.gasSettings};}
    async simulateViaEntrypoint(value,opts){calls.push(['simulate',value,opts]);return {gasUsed:{totalGas:new Gas(90,190),teardownGas:new Gas(0,1)}};}
    async createTxExecutionRequestFromPayloadAndFee(value,from,fees){calls.push(['request',value,from,fees]);return 'request';}
    scopesFrom(from,additional){assert.equal(from,owner);return additional;}
    senderForTagsFrom(from,sender){assert.equal(from,owner);return sender;}
  }
  const pxe={proveTx:async(request,opts)=>{calls.push(['prove',request,opts]);return {toTx:async()=>({getTxHash:()=>txHash})};}};
  const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({...transactionOutcomes,BaseWallet,owner,GasSettings},pxe,node,node,()=>{},Fr.ONE,{preProveHook:async ({gasLimits,feeOptions})=>{gasLimits.l2Gas=999999;feeOptions.gasSettings.maxFeesPerGas.feePerL2Gas=999999n;}});
  const result=await wallet.sendTx(payload,{from:owner,additionalScopes:[owner],sendMessagesAs:owner,fee:{gasSettings:settings}});
  assert.equal(result.receipt,receipt);assert.equal(calls.filter(c=>c==='submit').length,1);
  const fees=calls.filter(c=>c[0]==='fees');assert.equal(fees[0][1].forEstimation,false);
  assert.deepEqual(fees[1][1].gasSettings.toBuffer(),expectedSettings.toBuffer());
  const request=calls.find(c=>c[0]==='request');assert.equal(request[1],payload);assert.equal(request[2],owner);
  const proof=calls.find(c=>c[0]==='prove');assert.equal(proof[2].senderForTags,owner);assert.equal(proof[2].scopes[0],owner);
  wallet._contextGuard=async()=>{throw new Error('context changed during proof');};
  await assert.rejects(wallet.sendTx(payload,{from:owner,additionalScopes:[owner],sendMessagesAs:owner,fee:{gasSettings:settings}}),/context changed during proof/);
  assert.equal(calls.filter(c=>c==='submit').length,1,'changed context must not submit a second proof');
});
// Exercise the actual top-level dispatch, not just the exported routing seam.
import * as ethers from 'ethers';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {EthAddress} from '@aztec/foundation/eth-address';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
function mainHarness(action,isDummy=false) {
  const c=context(),requests=[],logs=[];let sent=false,authorBalanceReads=0;
  // Timers only represent UI yields in this inert test; no network/proof work is performed.
  c.setTimeout=callback=>setTimeout(callback,0);
  const addr=AztecAddress.fromFieldUnsafe(new Fr(12));
  const board=AztecAddress.fromFieldUnsafe(new Fr(11));
  const portal='0x3333333333333333333333333333333333333333',rollup='0x1111111111111111111111111111111111111111';
  const depositor='0x0000000000000000000000000000000000000004';
  const secret=new Fr(8),secretHash=new Fr(9),amount=1000000000000000n;
  const iface=new ethers.Interface(['event Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
  const event=iface.encodeEventLog(iface.getEvent('Deposited'),[depositor,7n,amount,secretHash.toString(),ethers.ZeroHash,42n]);
  const provider={getCode:async()=> '0x01',getNetwork:async()=>({chainId:31337n}),destroy(){},getTransactionReceipt:async()=>({status:1,logs:[{address:portal,...event}]})};
  class Portal {L2_CONTRACT=async()=>board.toString();L1_CHAIN_ID=async()=>31337n;ROLLUP=async()=>rollup;VERSION=async()=>1n;getDeposit=async()=>({nonce:7n,amount});}
  const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),getBlockNumber:async()=>1,
    getBlock:async number=>({number,hash:'block',timestamp:100,body:{txEffects:[]}}),getBlocks:async(from,count)=>Array.from({length:count},(_,i)=>({number:Number(from)+i,hash:'block',body:{txEffects:[]}})),getContract:async()=>({address:board}),getPublicStorageAt:async()=>{authorBalanceReads++;throw new Error('Author fee lookup forbidden');}};
  const note=()=>({schemaVersion:1n,depositChainId:5n,depositNonce:7n,amount:action==='claim'&&!sent?0n:amount,nextAllowedTime:0n,lastRealPostIndex:0n,lastScreenedIndex:0n,headSequence:0n});
  c.readBillboardDepositInfo=async()=>note();
  const methods=new Proxy({}, {get:(_target,name)=>{
    if(['post','withdraw','claim_deposit'].includes(name)) return (...args)=>({send:async opts=>{assert.equal(opts.from,addr);assert.equal(opts.fee.paymentMethod,'private-method');sent=true;requests.at(-1).action={kind:action,args};return {receipt:{status:'checkpointed',executionResult:'success',blockNumber:1,txHash:new Fr(99)}};}});
    return ()=>({simulate:async()=>name==='get_screen_hints'?[null,null]:1n});
  }});
  class BaseWallet {constructor(pxe){this.pxe=pxe;}}
  const a={Fr,AztecAddress,EthAddress,NO_FROM,GasSettings,BaseWallet,sha256ToField,Buffer,
    deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
    SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>Fr.ZERO;getSigningPublicKey=async()=>({x:Fr.ONE,y:Fr.ONE});},
    getContractInstanceFromInstantiationParams:async()=>({address:addr}),computePartialAddress:async()=>Fr.ZERO,
    createAztecNodeClient:()=>node,loadContractArtifact:x=>x,
    createPXE:async()=>({registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{}}),AccountManager:{create:async()=>({address:addr})},Contract:{at:async()=>({methods})},
    computeSecretHash:async()=>secretHash,poseidon2HashWithSeparator:async()=>new Fr(5),
    preparePrivateFeePayment:async input=>{requests.push(input);return {paymentMethod:'private-method',gasSettings:gas()};},
  };
  const cursorRecords=new Map();
  const env={createHistoryCursor:options=>createHistoryCursor({...options,storage:{read:async key=>cursorRecords.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(cursorRecords.get(key)??null,previous);cursorRecords.set(key,next);}}}),createEthereumJournal:async()=>({assertCanStart:async()=>{},send:async()=>{throw Object.assign(new Error('Unknown Ethereum submission'),{code:'BB_ETH_SUBMISSION_UNKNOWN'});}}),createTransactionJournal:async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{}}),aztec:a,ethers:{...ethers,Contract:Portal,JsonRpcProvider:class{constructor(){return provider;}}},artifact:{},privateFeeArtifact:{},
    initCRS:async()=>{},createStore:async()=>({}),log:text=>logs.push(text),getBrowserSigner:async()=>({getAddress:async()=>depositor,provider})};
  const config={action,isDummy,message:'text',depositChainId:'5',portalAddress:portal,ethRpcUrl:'http://fixture.invalid',aztecNodeUrl:'http://fixture.invalid',aztecWallet:{secretKey:new Fr(1).toString(),salt:0},
    reuseTxHash:new Fr(3).toString(),claimSecretStore:{save:async()=>{},load:async()=>({schemaVersion:1,secret:secret.toString(),secretHash:secretHash.toString()})},
    privateFee:{contractAddress:'private-fee',gasSettings:gas()}};
  return {run:()=>c.runBillboardUser(env,config),env,config,node,Portal,requests,logs,authorBalanceReads:()=>authorBalanceReads,secret};
}
for(const [action,dummy] of [['claim',false],['post',false],['post',true],['withdraw',false]]) {
  test(`actual main ${action}${dummy?' dummy':''} uses standard author call with private fee payment`,async()=>{
    const h=mainHarness(action,dummy);await h.run();assert.equal(h.requests.length,1);assert.equal(h.authorBalanceReads(),0);
    const r=h.requests[0];assert.equal(r.action.kind,action);assert.equal(r.expectedChainId,'31337');assert.equal(r.expectedVersion,'1');
    if(action==='claim'){assert.equal(r.action.args[2],7n);assert.equal(r.action.args[3].toString(),h.secret.toString());}
    if(action==='post'){assert.equal(r.action.args[3],dummy?0:4);assert.equal(r.action.args[4],dummy);assert.equal(r.action.args[1].isZero(),dummy);}
    assert(!h.logs.some(text=>text.includes('fund your account')||text.includes('You need some to pay')));
  });
}


test('moderator calls use their normal account with private fee payment',async()=>{
 const h=fixture();
 for(const method of ['set_moderation_policy','declare_immoral','transfer_censor'])await h.sender(method,['argument']);
 assert.deepEqual(h.sends.map(x=>x.method),['set_moderation_policy','declare_immoral','transfer_censor']);
 for(const send of h.sends){assert.equal(send.opts.from,h.owner);assert.equal(send.opts.fee.paymentMethod,h.paymentMethod);}
 for(const action of ['set-moderation-policy','declare-immoral','transfer-censor']){
  const c=context();await assert.rejects(c.runBillboardUser({aztec:{},log(){},artifact:{}},{action,aztecWallet:{secretKey:'private'}}),e=>e.code==='BB_PRIVATE_FEE_UNAVAILABLE');
 }
});

test('inherited object names never select an application method',async()=>{
 const h=fixture();for(const kind of ['constructor','__proto__','toString'])await assert.rejects(h.sender(kind,[]),e=>e.code==='BB_PRIVATE_FEE_UNSUPPORTED_ACTION');
 assert.equal(h.prepared.length,0);assert.equal(h.sends.length,0);
});

// L2 operations must not acquire an unrelated Ethereum signing authority.
test('actual main private post works with no Ethereum signer',async()=>{
 const h=mainHarness('post');h.env.getBrowserSigner=null;h.config.hasEthSigner=false;
 await h.run();assert.equal(h.requests.length,1);assert.equal(h.requests[0].action.kind,'post');
});
test('actual main fails before PXE when RPC identity changed after CLI preflight',async()=>{
 const h=mainHarness('post');h.config.expectedNetworkScope={chainId:'1',rollup:'0x'+'11'.repeat(20),version:'1'};
 await assert.rejects(h.run(),/Network changed since CLI preflight/);assert.equal(h.requests.length,0);
});

function l1RecoveryFixture() {
 const h=mainHarness('claim-l1');h.config.withdrawTxHash=new Fr(99).toString();h.env.aztec.TxHash=TxHash;
 h.node.getL1ContractAddresses=async()=>({rollupAddress:'0x'+'11'.repeat(20),outboxAddress:'0x'+'55'.repeat(20)});
 h.Portal.prototype.hasMessageBeenConsumedAtEpoch=async()=>false;
 return h;
}
test('settlement pending returns after one witness lookup, without ninety-minute polling',async()=>{
 const h=l1RecoveryFixture();let calls=0;h.node.getL2ToL1MembershipWitness=async()=>{calls++;return null;};
 await assert.rejects(h.run(),e=>e.code==='BB_SETTLEMENT_PENDING');assert.equal(calls,1);
});
test('witness RPC failure remains unknown, never a false unclaimed or paid result',async()=>{
 const h=l1RecoveryFixture();h.node.getL2ToL1MembershipWitness=async()=>{throw new Error('PRIVATE_WITNESS_ERROR');};
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');assert(!JSON.stringify(h.logs).includes('PRIVATE_WITNESS_ERROR'));
});
for(const consumed of [false,true])test(`consumed/error text is not evidence of a refund: ${consumed}`,async()=>{
 const h=l1RecoveryFixture();h.node.getL2ToL1MembershipWitness=async()=>({epochNumber:1,numCheckpointsInEpoch:1,leafIndex:0,siblingPath:{pathSize:1,toBufferArray:()=>[Buffer.alloc(32)]}});
 h.Portal.prototype.hasMessageBeenConsumedAtEpoch=async()=>consumed;
 h.Portal.prototype.withdraw=async()=>{throw new Error('already consumed PRIVATE_RPC_ERROR');};
 await assert.rejects(h.run(),e=>e.code===(consumed?'BB_RECOVERY_UNKNOWN':'BB_ETH_SUBMISSION_UNKNOWN'));
 assert(!h.logs.some(s=>s.includes('ETH claimed successfully')||s.includes('PRIVATE_RPC_ERROR')));
});

test('actual main refuses a private send when durable journal is unavailable',async()=>{
 const h=mainHarness('post');delete h.env.createTransactionJournal;
 await assert.rejects(h.run(),{code:'BB_JOURNAL_INVALID'});assert.equal(h.requests.length,0);
});
test('actual main recovery avoids proving and Ethereum signing and reports revert distinctly',async()=>{
 for(const executionResult of ['success','reverted']) {
  const h=mainHarness('recover');let scope;
  h.env.initCRS=async()=>{throw new Error('Recovery must not prove');};h.env.getBrowserSigner=async()=>{throw new Error('Recovery must not acquire Ethereum signer');};
  h.env.createTransactionJournal=async options=>{scope=options.scope;return {assertCanStart:async()=>{},prepare:async()=>{},confirmed:()=>{},recover:async()=>({txHash:new Fr(99),executionResult})};};
  const result=await h.run();assert.equal(result.state,executionResult==='success'?'transaction_recovered':'transaction_reverted');assert.equal(scope.chainId,'31337');assert.equal(scope.version,'1');assert.equal(scope.portal,h.config.portalAddress);assert.equal(h.requests.length,0);
  assert.equal(h.logs.some(s=>s.includes('Saved transaction succeeded')),executionResult==='success');
 }
});

test('Ethereum recovery handles already refunded receipts before checking active deposit',async()=>{
 for(const outcome of ['success','reverted','replaced']) {
  const h=mainHarness('recover-eth');h.Portal.prototype.getDeposit=async()=>({nonce:0n,amount:0n});
  h.env.initCRS=async()=>{throw new Error('Recovery must not prove');};
  h.env.createEthereumJournal=async options=>{assert.equal(options.scope.depositor,'0x0000000000000000000000000000000000000004');return {assertCanStart:async()=>{},send:async()=>{},recover:async()=>({outcome,txHash:new Fr(99).toString()})};};
  const result=await h.run();assert.equal(result.state,outcome==='success'?'ethereum_recovered':'ethereum_'+outcome);assert.equal(h.requests.length,0);assert.equal(h.logs.some(s=>s.includes('portal event verified')),outcome==='success');
 }
});
