import {jsonStringify,jsonParseWithSchema} from '@aztec/foundation/json-rpc';
import {BlockResponseSchema} from '@aztec/stdlib/interfaces/client';
import {BlockHeader} from '@aztec/stdlib/tx';
import {BlockHash} from '@aztec/stdlib/block';
import {AppendOnlyTreeSnapshot} from '@aztec/stdlib/trees';
import {createHistoryCursor} from '../shared/history-cursor.mjs';
import {Tx,TxHash} from '@aztec/stdlib/tx';
import {createL2Journal} from '../shared/l2-journal.mjs';
import * as transactionOutcomes from '../shared/transaction-outcomes.mjs';
// Actual application routing, with explicit node/proof/payment-preparer doubles.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {SiblingPath} from '@aztec/foundation/trees';
import {L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
import {Fr} from '@aztec/foundation/curves/bn254';
import {Gas,GasFees,GasSettings} from '@aztec/stdlib/gas';
import {NO_FROM} from '@aztec/aztec.js/account';
const source=await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const policySource=await readFile(new URL('../shared/moderation-policy.js',import.meta.url),'utf8');
function context(){const c=vm.createContext({console,Buffer,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(policySource,c);vm.runInContext(source,c);return c;}
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
 for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','BB_BROWSER_PROOF_FAILED','UNTRUSTED']){
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
import {NoteStatus} from '@aztec/stdlib/note';
import {sha256ToField} from '@aztec/foundation/crypto/sha256';
function mainHarness(action,isDummy=false) {
  let c=context();const requests=[],logs=[],operations=[];let actionReceipt={status:'checkpointed',executionResult:'success',blockNumber:1,txHash:new Fr(99)},sent=false,authorBalanceReads=0,postExists=!['post','recover'].includes(action),missingNote=false,noteOverrides={},actionHook=null,readHook=null,censorValue=null;
  // Timers only represent UI yields in this inert test; no network/proof work is performed.
  c.setTimeout=callback=>setTimeout(callback,0);
  const addr=AztecAddress.fromFieldUnsafe(new Fr(12));
  const board=AztecAddress.fromFieldUnsafe(new Fr(11));
  const portal='0x3333333333333333333333333333333333333333',rollup='0x1111111111111111111111111111111111111111';
  const depositor='0x0000000000000000000000000000000000000004';
  const secret=new Fr(8),secretHash=new Fr(9),amount=1000000000000000n;
  const iface=new ethers.Interface(['event Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
  const event=iface.encodeEventLog(iface.getEvent('Deposited'),[depositor,7n,amount,secretHash.toString(),new Fr(77).toString(),42n]);
  const provider={getCode:async()=> '0x01',getNetwork:async()=>({chainId:31337n}),destroy(){},getBlock:async()=>({hash:'canonical-eth'}),getTransactionReceipt:async hash=>({hash,status:1,blockNumber:1,blockHash:'canonical-eth',logs:[{address:portal,...event}]})};
  class Portal {L2_CONTRACT=async()=>board.toString();L1_CHAIN_ID=async()=>31337n;ROLLUP=async()=>rollup;VERSION=async()=>1n;getDeposit=async()=>({nonce:7n,amount});}
  const node={getL1ToL2MessageMembershipWitness:async()=>[42n,new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},()=>Fr.ONE.toBuffer()))],getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),getBlockNumber:async()=>1,
    getBlock:async number=>({number,hash:'block',header:{globalVariables:{timestamp:100n}},body:{txEffects:[]}}),getBlocks:async(from,count)=>Array.from({length:count},(_,i)=>({number:Number(from)+i,hash:'block',body:{txEffects:[]}})),getContract:async()=>({address:board}),getPublicStorageAt:async()=>{authorBalanceReads++;throw new Error('Author fee lookup forbidden');}};
  const note=()=>({schemaVersion:1n,depositChainId:5n,depositNonce:7n,amount:missingNote||(action==='claim'&&!sent)?0n:amount,nextAllowedTime:0n,lastRealPostIndex:0n,lastScreenedIndex:0n,headSequence:0n,...noteOverrides});
  c.readBillboardDepositInfo=async()=>note();
  const methods=new Proxy({}, {get:(_target,name)=>{
    if(['post','withdraw','claim_deposit','transfer_censor','declare_immoral','set_moderation_policy'].includes(name)) return (...args)=>({send:async opts=>{assert.equal(opts.from,addr);assert.equal(opts.fee.paymentMethod,'private-method');if(actionHook)await actionHook(name,args);sent=true;requests.at(-1).action={kind:action,args};return {receipt:actionReceipt};}});
    return ()=>({simulate:async()=>{if(readHook)await readHook(name);return name==='get_censor'?(censorValue??addr.toField()):name==='get_post_exists'?postExists:name==='get_screen_hints'?[null,null]:1n;}});
  }});
  class BaseWallet {constructor(pxe){this.pxe=pxe;}}
  const a={...transactionOutcomes,NoteStatus,Fr,AztecAddress,EthAddress,NO_FROM,GasSettings,BaseWallet,sha256ToField,Buffer,
    deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
    SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>Fr.ZERO;getSigningPublicKey=async()=>({x:Fr.ONE,y:Fr.ONE});},
    getContractInstanceFromInstantiationParams:async()=>({address:addr}),computePartialAddress:async()=>Fr.ZERO,
    createAztecNodeClient:()=>node,loadContractArtifact:x=>x,
    createPXE:async()=>({debug:{getNotes:async filter=>{assert.equal(filter.status,NoteStatus.ACTIVE);const n=note();return [{owner:addr,contractAddress:board,storageSlot:Fr.ONE,siloedNullifier:new Fr(7),note:{items:[1n+(n.depositNonce<<32n),5n,amount,BigInt(depositor),0n,0n,n.headSequence+(n.lastScreenedIndex<<64n)+(n.lastRealPostIndex<<128n),n.nextAllowedTime].map(v=>new Fr(v))}}];}},registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},getSyncedBlockHeader:async()=>({hash:async()=>new Fr(78)})}),AccountManager:{create:async()=>({address:addr})},Contract:{at:async()=>({methods})},
    computeSecretHash:async()=>secretHash,poseidon2HashWithSeparator:async()=>new Fr(5),
    preparePrivateFeePayment:async input=>{requests.push(input);return {paymentMethod:'private-method',gasSettings:gas()};},
  };
  const cursorRecords=new Map();
  const env={createHistoryCursor:options=>createHistoryCursor({...options,storage:{read:async key=>cursorRecords.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(cursorRecords.get(key)??null,previous);cursorRecords.set(key,next);}}}),createEthereumJournal:async()=>({assertCanStart:async()=>{},send:async()=>{throw Object.assign(new Error('Unknown Ethereum submission'),{code:'BB_ETH_SUBMISSION_UNKNOWN'});}}),createTransactionJournal:async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},setOperation:value=>operations.push(value)}),aztec:a,ethers:{...ethers,Contract:Portal,JsonRpcProvider:class{constructor(){return provider;}}},artifact:{storageLayout:{deposits:{slot:Fr.ONE}}},privateFeeArtifact:{},
    initCRS:async()=>{},createStore:async()=>({}),log:text=>logs.push(text),getBrowserSigner:async()=>({getAddress:async()=>depositor,provider})};
  const config={action,isDummy,message:'text',depositChainId:'5',portalAddress:portal,ethRpcUrl:'http://fixture.invalid',aztecNodeUrl:'http://fixture.invalid',aztecWallet:{secretKey:new Fr(1).toString(),salt:0},
    reuseTxHash:new Fr(3).toString(),claimSecretStore:{save:async()=>{},load:async()=>({schemaVersion:1,secret:secret.toString(),secretHash:secretHash.toString()})},
    privateFee:{contractAddress:'private-fee',gasSettings:gas()}};
  config.censorWalletJson={...config.aztecWallet};config.newCensor=new Fr(44).toString();config.postId=new Fr(55).toString();config.moderationPolicy='No threats';
  function setWithdrawalHistory(executionResult='success') {
    const leaf=c.BillboardUserCodec.computeWithdrawMessageLeaf(a,ethers,board,portal,depositor,amount,7n,1,31337);
    const txHash=new Fr(88);
    node.getBlocks=async()=>[{number:1,hash:'block',body:{txEffects:[{txHash,l2ToL1Msgs:[leaf]}]}}];
    node.getTxReceipt=async()=>({txHash,status:'checkpointed',executionResult,blockNumber:1,blockHash:'block'});
  }
  return {restartEngine:()=>{c=context();c.setTimeout=callback=>setTimeout(callback,0);c.readBillboardDepositInfo=async()=>note();},setActionReceipt:value=>actionReceipt=value,setTimer:fn=>{c.setTimeout=fn;},run:()=>c.runBillboardUser(env,config),setWithdrawalHistory,env,config,node,provider,Portal,requests,logs,operations,setCensor:value=>censorValue=value,setMissingNote:value=>missingNote=value,setNoteState:value=>noteOverrides=value,onAction:value=>actionHook=value,onRead:value=>readHook=value,setPostExists:value=>postExists=value,authorBalanceReads:()=>authorBalanceReads,secret};
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

for(const action of ['declare-immoral','set-moderation-policy','transfer-censor']) {
 test(`actual moderator ${action} uses the active wallet's durable journal`,async()=>{
  const h=mainHarness(action);let journal;
  h.env.createTransactionJournal=async options=>{assert.equal(options.walletSecret,h.config.aztecWallet.secretKey);journal={assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},setOperation:()=>{}};return journal;};
  h.env.getBrowserSigner=null;h.config.hasEthSigner=false;await h.run();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].wallet._transactionJournal,journal);
 });
 test(`actual moderator ${action} refuses an unresolved previous transaction before preparing a fee`,async()=>{
  const h=mainHarness(action);h.env.createTransactionJournal=async()=>({assertCanStart:async()=>{throw Object.assign(new Error('recovery required'),{code:'BB_RECOVERY_REQUIRED'});},prepare:async()=>{},confirmed:()=>{},setOperation:()=>{}});
  await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
 });
}
test('moderator wallet cannot bypass journal ownership by supplying a second key',async()=>{
 const h=mainHarness('transfer-censor');h.config.censorWalletJson={secretKey:new Fr(33).toString(),salt:0};
 await assert.rejects(h.run(),/Load the moderator wallet as the active wallet/);assert.equal(h.requests.length,0);
});

for(const outcome of ['success','reverted'])test(`moderator recovery ${outcome} distinguishes an already completed identical transfer from a failed one`,async()=>{
 const h=mainHarness('transfer-censor');h.config.reconcilePrevious=true;let operations=[],reads=0;
 const receipt={executionResult:outcome,txHash:new Fr(99),blockNumber:1,status:'checkpointed',blockHash:'canonical'};
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},setOperation:operation=>operations.push(operation),reconcilePrevious:async()=>{reads++;return {receipt,operation:JSON.stringify(['transfer_censor',[h.config.newCensor]])};}});
 await h.run();assert.equal(h.requests.length,outcome==='success'?0:1);assert.equal(operations.length,outcome==='success'?0:1);assert.equal(reads,outcome==='success'?2:1);
});
test('moderator recovery with unknown outcome cannot prepare another private fee payment',async()=>{
 const h=mainHarness('transfer-censor');h.config.reconcilePrevious=true;
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},reconcilePrevious:async()=>{throw Object.assign(new Error('unknown'),{code:'BB_SUBMISSION_UNKNOWN'});}});
 await assert.rejects(h.run(),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(h.requests.length,0);
});

test('actual recovery dispatcher restores the saved message and nonce before requesting a fresh post proof',async()=>{
 const h=mainHarness('recover'),nonce=new Fr(123).toString(),operations=[];
 const operation=JSON.stringify({schemaVersion:1,kind:'post',nonce,message:'original saved text',depositChain:new Fr(5).toString()});
 let allowed=0;
 h.config.message='a different new message';h.config.isDummy=true;
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),
  allowReplacement:async expected=>{assert.equal(expected,operation);allowed++;},setOperation:value=>operations.push(value)});
 await h.run();assert.equal(allowed,1);assert.deepEqual(operations,[operation]);assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].action.args[1].toString(),nonce);assert.equal(h.requests[0].action.args[4],false);
 assert.equal(context().BillboardPostCodec.decodePostMessage(h.requests[0].action.args[2].map(x=>x.toBigInt()),h.requests[0].action.args[3]),'original saved text');
});
test('already published stable identity blocks a replacement before fee preparation',async()=>{
 const h=mainHarness('post');h.setPostExists(true);
 await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
for(const kind of ['dummy','withdraw','claim'])test(`recovery cannot silently regenerate a ${kind} operation`,async()=>{
 const h=mainHarness('recover');let allowed=0;
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>{},prepare:async()=>{},confirmed:()=>{},recover:async()=>{throw Object.assign(new Error('blocked'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation:JSON.stringify({kind})}),allowReplacement:async()=>{allowed++;}});
 await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(allowed,0);assert.equal(h.requests.length,0);
});

for(const [action,dummy,kind] of [['claim',false,'claim'],['post',true,'dummy'],['withdraw',false,'withdraw']])test(`${action} ${dummy?'dummy':''} records its own operation rather than stale real-post metadata`,async()=>{
 const h=mainHarness(action,dummy);await h.run();assert.equal(JSON.parse(h.operations.at(-1)).kind,kind);
});

for (const unavailable of [false,true]) test(`missing withdrawal note never proves success when history ${unavailable?'is unavailable':'contains no exit'}`,async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);
 if(unavailable)h.node.getBlocks=async()=>{throw new Error('unavailable');};
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');
 assert.equal(h.requests.length,0);
 assert(!h.logs.some(x=>x.includes('Confirmed prior withdrawal')||x.includes('already withdrawn')));
});

test('missing withdrawal note can recover an exact successful canonical exit without paying again',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory();
 await h.run();assert.equal(h.requests.length,0);
 assert(h.logs.some(x=>x.includes('Confirmed prior withdrawal. Tx hash:')));
});
test('missing withdrawal note cannot recover a reverted exit',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory('reverted');
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');assert.equal(h.requests.length,0);
});

test('an exit for another selected deposit cannot complete withdrawal',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory();h.config.depositChainId='6';
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');assert.equal(h.requests.length,0);
 assert(!h.logs.some(x=>x.includes('Confirmed prior withdrawal.')));
});
test('withdrawal recovery without original claim custody cannot guess deposit ownership',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory();h.config.claimSecretStore.load=async()=>null;
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');assert.equal(h.requests.length,0);
});

test('withdrawal absence reconciliation has a deadline even if its receipt read stalls',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory();
 let checked=false;
 h.env.aztec.boundedTransactionRead=(fn,timeout)=>{assert.equal(timeout,20000);checked=true;return transactionOutcomes.boundedTransactionRead(fn,20);};
 // Receipt lookup for the selected claim happens within the bounded callback.
 h.config.claimSecretStore.load=()=>new Promise(()=>{});
 await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_UNKNOWN');assert(checked);assert.equal(h.requests.length,0);
});

for(const kind of ['dummy','withdraw'])for(const changed of [false,true])test(`saved ${kind} requires the same source screening sequence (${changed?'changed':'unchanged'})`,async()=>{
 const h=mainHarness('recover'),operations=[];
 const operation=JSON.stringify({schemaVersion:1,kind,depositChain:new Fr(5).toString(),headSequence:changed?'1':'0'});
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},
  inspect:async()=>({operation,applicationNullifier:new Fr(7).toString()}),allowReplacement:async()=>{},setOperation:op=>operations.push(op)});
 if(changed){await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);}
 else {await h.run();assert.equal(h.requests.length,1);assert.deepEqual(operations,[operation]);}
});

test('actual wallet passes attributed application spend to the durable journal before submission',async()=>{
 const c=context(),calls=[],txHash=new Fr(91),appNullifier=new Fr(92);let tx={getTxHash:()=>txHash};
 const receipt={txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(){return {gasUsed:{totalGas:new Gas(1,1),teardownGas:new Gas(0,0)}};}
  async createTxExecutionRequestFromPayloadAndFee(){return 'request';}
  scopesFrom(){return [];} senderForTagsFrom(){return owner;}
 }
 const proven={toTx:async()=>tx},pxe={proveTx:async()=>proven};
 const node={sendTx:async()=>calls.push('submit'),getTxReceipt:async()=>receipt,getBlock:async()=>({hash:'block'})};
 const journal={assertCanStart:async()=>null,prepare:async(value,previous,binding)=>{assert.equal(value,tx);assert.equal(binding.applicationNullifier,appNullifier.toString());calls.push('saved');},confirmed:()=>{}};
 const a={...transactionOutcomes,BaseWallet,GasSettings,extractApplicationNullifier:async(result,value,board)=>{assert.equal(result,proven);assert.equal(value,tx);assert.equal(board,'board');calls.push('attributed');return appNullifier;}};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet(a,pxe,node,node,()=>{},Fr.ONE,{transactionJournal:journal});wallet._applicationNullifierBoard='board';
 await wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}});
 assert.deepEqual(calls,['attributed','saved','submit']);
 a.extractApplicationNullifier=async()=>{throw Object.assign(new Error('unsupported'),{code:'BB_APPLICATION_ATTRIBUTION_UNSUPPORTED'});};
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),{code:'BB_APPLICATION_ATTRIBUTION_UNSUPPORTED'});
 assert.equal(calls.filter(x=>x==='submit').length,1);
 a.extractApplicationNullifier=async()=>appNullifier;
 journal.prepare=async()=>{throw Object.assign(Error('storage unavailable'),{code:'BB_JOURNAL_INVALID'});};
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),{code:'BB_JOURNAL_INVALID'});
 assert.equal(calls.filter(x=>x==='submit').length,1);
 // Exercise the actual encrypted journal at the wallet's confirmation boundary.
 // The SDK transaction/prover and chain responses remain explicit fixtures.
 tx=Tx.random({randomProof:true});receipt.txHash=tx.getTxHash();
 const nullifier=tx.data.getNonEmptyNullifiers()[0].toString(),records=new Map();
 const storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(records.get(key)??null,previous);records.set(key,next);}};
 const options={storage,walletSecret:Fr.ONE.toString(),walletSalt:Fr.ZERO.toString(),Tx,node,
  scope:{account:Fr.ONE.toString(),chainId:'31337',rollup:'0x'+'01'.repeat(20),version:'5',board:new Fr(2).toString(),portal:'0x'+'02'.repeat(20)}};
 const durable=await createL2Journal(options),operation=JSON.stringify({schemaVersion:1,kind:'withdraw',depositChain:new Fr(5).toString(),headSequence:'0'});
 durable.setOperation(operation);durable.confirmed=()=>{throw Error('interrupted at local confirmation');};wallet._transactionJournal=durable;
 a.extractApplicationNullifier=async()=>Fr.fromString(nullifier);
 let proofs=0;pxe.proveTx=async()=>{proofs++;return proven;};
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),/interrupted at local confirmation/);
 assert.equal(proofs,1);assert.equal(calls.filter(x=>x==='submit').length,2);
 const reopened=await createL2Journal(options),saved=await reopened.inspect();
 assert.equal(saved.operation,operation);assert.equal(saved.applicationNullifier,nullifier);assert.equal(saved.txHash,tx.getTxHash().toString());
 assert.equal((await reopened.recover()).txHash.toString(),saved.txHash);
 assert.equal(proofs,1);assert.equal(calls.filter(x=>x==='submit').length,2);
});

test('successful retried screening releases its step guard before the following withdrawal',async()=>{
 const h=mainHarness('auto');h.config.message='';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});
 let operation,dummyCalls=0,withdrawals=0;
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  setOperation:value=>operation=value,inspect:async()=>({operation,applicationNullifier:new Fr(7).toString()}),allowReplacement:async()=>{}});
 h.onAction(async name=>{
  if(name==='post') {dummyCalls++;if(dummyCalls===1)throw Object.assign(new Error('expired anchor'),{code:'BB_STATE_CONFLICT',stateReasons:['Block header not found']});
   h.setNoteState({headSequence:2n,lastRealPostIndex:1n,lastScreenedIndex:1n});}
  if(name==='withdraw')withdrawals++;
 });
 // L1 settlement is intentionally absent from this action-routing fixture.
 await assert.rejects(h.run());
 assert.equal(dummyCalls,2);assert.equal(withdrawals,1);
 assert.equal(JSON.parse(operation).kind,'withdraw');
});

function savedClaimHarness(overrides={}) {
 const h=mainHarness('recover');h.setMissingNote(true);
 const intent={schemaVersion:1,kind:'claim',depositor:'0x0000000000000000000000000000000000000004',amount:'1000000000000000',depositNonce:'7',leafIndex:'42',secretHash:new Fr(9).toString(),transactionHash:new Fr(3).toString(),depositChain:new Fr(5).toString(),...overrides};
 const operation=JSON.stringify(intent),operations=[];
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),
  allowReplacement:async expected=>assert.equal(expected,operation),setOperation:op=>operations.push(op)});
 return {...h,intent,operation,operations};
}
test('stale claim restores exact original receipt and claim identity without depositing again',async()=>{
 const h=savedClaimHarness();h.config.reuseTxHash=new Fr(999).toString();
 await h.run();assert.equal(h.requests.length,1);assert.deepEqual(h.operations,[h.operation]);
 const args=h.requests[0].action.args;
 assert.equal(args[1],1000000000000000n);assert.equal(args[2],7n);assert.equal(args[3].toString(),h.secret.toString());assert.equal(args[4],42n);
});
for(const [key,value] of [['amount','1'],['depositNonce','8'],['leafIndex','43'],['depositChain',new Fr(6).toString()],['secretHash',new Fr(10).toString()],['depositor','0x0000000000000000000000000000000000000005']])test(`stale claim rejects changed ${key} before another fee payment`,async()=>{
 const h=savedClaimHarness({[key]:value});await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
test('an existing note is not confirmation of an unresolved saved claim transaction',async()=>{
 const h=savedClaimHarness();h.setMissingNote(false);await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
test('failed claim does not enter the former thirty-attempt loop',async()=>{
 const h=mainHarness('claim');let sends=0;h.onAction(async()=>{sends++;throw new Error('not available');});
 await assert.rejects(h.run());assert.equal(sends,1);assert.equal(h.requests.length,1);
});

test('saved claim rejects a receipt returned for another transaction',async()=>{
 const h=savedClaimHarness(),read=h.provider.getTransactionReceipt;
 h.provider.getTransactionReceipt=async hash=>({...await read(hash),hash:new Fr(999).toString()});
 await assert.rejects(h.run(),{code:'BB_RECOVERY_UNKNOWN'});assert.equal(h.requests.length,0);
});
test('saved claim rejects a reorged Ethereum receipt',async()=>{
 const h=savedClaimHarness();h.provider.getBlock=async()=>({hash:'different block'});
 await assert.rejects(h.run(),{code:'BB_RECOVERY_UNKNOWN'});assert.equal(h.requests.length,0);
});
test('saved claim receipt reads time out before any proof or fee preparation',async()=>{
 const h=savedClaimHarness();h.provider.getTransactionReceipt=()=>new Promise(()=>{});
 h.env.aztec.boundedTransactionRead=(fn,timeout)=>{assert.equal(timeout,20000);return transactionOutcomes.boundedTransactionRead(fn,20);};
 await assert.rejects(h.run(),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(h.requests.length,0);
});

for(const action of ['transfer-censor','set-moderation-policy','declare-immoral'])test(`explicit recovery restores exact saved ${action} arguments`,async()=>{
 const original=mainHarness(action);await original.run();const operation=original.operations.at(-1);
 const h=mainHarness('recover');h.setPostExists(true);h.config.newCensor=new Fr(999).toString();h.config.moderationPolicy='different';h.config.censorResponse='different';
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),
  allowReplacement:async value=>assert.equal(value,operation),setOperation:value=>h.operations.push(value)});
 await h.run();assert.equal(h.requests.length,1);assert.deepEqual(h.operations,[operation]);
});
for(const changed of [false,true])test(`daemon stale transaction reconciliation ${changed?'rejects another job':'regenerates the same job'}`,async()=>{
 const original=mainHarness('transfer-censor');await original.run();const operation=original.operations.at(-1);
 const h=mainHarness('transfer-censor');h.config.reconcilePrevious=true;if(changed)h.config.newCensor=new Fr(999).toString();
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  reconcilePrevious:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),allowReplacement:async()=>{},setOperation:()=>{}});
 if(changed){await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);}
 else {await h.run();assert.equal(h.requests.length,1);}
});
test('saved moderator request cannot spend fees after authority transfers away',async()=>{
 const original=mainHarness('transfer-censor');await original.run();const operation=original.operations.at(-1);
 const h=mainHarness('recover');h.setCensor(new Fr(999));
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),allowReplacement:async()=>{},setOperation:()=>{}});
 await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});

// Real production preparer composed with real routing; only wallet/node state is a fixture.
import {preparePrivateFeePayment,derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {BarretenbergSync} from '@aztec/bb.js';
import {after} from 'node:test';
after(async()=>{await BarretenbergSync.destroySingleton();});
test('real preparer failures stop every routed action before proof/send/funding and preserve bootstrap input',async()=>{
 const artifact=loadContractArtifact(JSON.parse(await readFile(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url),'utf8')));
 const instance=await derivePrivateFeeInstance(artifact),author=AztecAddress.fromFieldUnsafe(new Fr(42));
 for(const kind of ['claim','post','withdraw','declare_immoral','set_moderation_policy','transfer_censor'])for(const mode of ['shortfall','balance-error','bootstrap-error']){
  const c=context();let calls=0;const forbidden=async()=>{calls++;throw Error('Should never prove, fund or send');};
  const wallet={getChainInfo:async()=>({chainId:new Fr(1),version:new Fr(2)}),registerContract:async()=>{},executeUtility:async()=>{if(mode==='balance-error')throw Error('PRIVATE_INPUT_MARKER');return {result:[new Fr(1099)],offchainEffects:[],anchorBlockTimestamp:1n};},sendTx:forbidden,proveTx:forbidden};
  const node={getNodeInfo:async()=>({l1ChainId:1,rollupVersion:2}),getContract:async()=>instance,sendTx:forbidden,getPublicStorageAt:forbidden};
  const config={privateFee:{contractAddress:instance.address.toString(),gasSettings:gas()}};
  if(mode==='bootstrap-error')config.privateFeeClaim={amount:'1099',salt:new Fr(5),leafIndex:new Fr(6)};
  const before=JSON.stringify(config.privateFeeClaim??null);
  const contract={methods:new Proxy({},{get:()=>()=>({send:forbidden})})};
  const sender=c.BillboardPrivateFeeRouting.createPrivateFeeSender({a:{GasSettings,preparePrivateFeePayment},config,privateFeeArtifact:artifact,contract,wallet,node,owner:author,scope:{l1ChainId:'1',rollupVersion:'2'}});
  await assert.rejects(sender(kind,[]),e=>e.code==='BB_PRIVATE_FEE_PREPARATION_FAILED'&&!e.message.includes('PRIVATE_INPUT_MARKER'));
  assert.equal(calls,0);assert.equal(JSON.stringify(config.privateFeeClaim??null),before);
 }
});

test('actual claim readiness rejects absent, failed and wrong-index membership before fees or submission',async()=>{
 for(const mode of ['missing','rpc','wrong-index']){
  const h=mainHarness('claim');let sends=0;h.onAction(()=>sends++);
  const read=h.node.getL1ToL2MessageMembershipWitness;let reads=0;
  h.node.getL1ToL2MessageMembershipWitness=async()=>{reads++;if(mode==='rpc')throw Error('private RPC');if(mode==='missing'){if(reads===1)return undefined;return new Promise(()=>{});}const w=await read();return[43n,w[1]];};
  await assert.rejects(h.run(),e=>e.code===(mode==='wrong-index'?'BB_DEPOSIT_MESSAGE_INVALID':'BB_DEPOSIT_MESSAGE_UNAVAILABLE'));
  assert.equal(h.requests.length,0);assert.equal(h.operations.length,0);assert.equal(sends,0);
 }
});
test('actual claim waits for delayed exact receipt key then prepares fees and submits once',async()=>{
 const h=mainHarness('claim');let reads=0,sends=0;const read=h.node.getL1ToL2MessageMembershipWitness;
 h.node.getL1ToL2MessageMembershipWitness=async(hash,key)=>{assert.equal(hash.toString(),new Fr(78).toString());assert.equal(key.toString(),new Fr(77).toString());return ++reads===1?undefined:read();};
 h.onAction(()=>sends++);await h.run();assert.equal(reads,2);assert.equal(sends,1);assert.equal(h.requests.length,1);
});

test('node failures are surfaced after one request, before private fee work',async()=>{
 const h=mainHarness('post');let calls=0;
 h.node.getNodeInfo=async()=>{calls++;throw Error('network unavailable');};
 await assert.rejects(h.run(),/network unavailable/);
 assert.equal(calls,1);assert.equal(h.requests.length,0);
});
test('contract registration failures are surfaced after one attempt',async()=>{
 const h=mainHarness('post'),create=h.env.aztec.createPXE;let calls=0;
 h.env.aztec.createPXE=async(...args)=>({...await create(...args),registerContractClass:async()=>{calls++;throw Error('temporary internal error');}});
 await assert.rejects(h.run(),/temporary internal error/);
 assert.equal(calls,1);assert.equal(h.requests.length,0);
});
test('cached wallet sync failure stops the next operation before fee preparation',async()=>{
 const h=mainHarness('post'),create=h.env.aztec.createPXE;let fail=false,creates=0;
 h.env.aztec.createPXE=async(...args)=>{creates++;return {...await create(...args),sync:async()=>{if(fail)throw Error('sync unavailable');}};};
 await h.run();const count=h.requests.length;fail=true;
 await assert.rejects(h.run(),/sync unavailable/);
 assert.equal(h.requests.length,count);assert.equal(creates,1);
});
test('simulation failure is not retried and cannot start proving',async()=>{
 const c=context();c.setTimeout=callback=>setTimeout(callback,0);let simulations=0,proofs=0;
 class BaseWallet{constructor(pxe){this.pxe=pxe;}async completeFeeOptions(){return {};}async simulateViaEntrypoint(){simulations++;throw Error('temporary internal error');}}
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings}, {proveTx:async()=>{proofs++;}}, {},{},()=>{},Fr.ONE,{});
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{}}),/temporary internal error/);
 assert.equal(simulations,1);assert.equal(proofs,0);
});

for(const method of ['get_censor','get_k_multiplier','get_censor_window','get_max_save_up'])test(`list rejects failed ${method} instead of inventing configuration`,async()=>{
 const h=mainHarness('list');h.onRead(name=>{if(name===method)throw Error('configuration unavailable');});
 await assert.rejects(h.run(),/configuration unavailable/);
 assert(!h.logs.some(text=>text.includes('posts loaded')));
});
test('failed board lookup is not classified as an absent deployment',async()=>{
 const h=mainHarness('post');h.node.getContract=async()=>{throw Error('lookup unavailable');};
 await assert.rejects(h.run(),/lookup unavailable/);assert.equal(h.requests.length,0);
});
test('failed portal binding read prevents application actions',async()=>{
 const h=mainHarness('post');let calls=0;h.env.ethers.Contract=class extends h.Portal {L2_CONTRACT=async()=>{if(++calls===1)return new Fr(11).toString();throw Error('binding unavailable');};};
 await assert.rejects(h.run(),/Could not verify the L1 wallet and receipt/);assert.equal(h.requests.length,0);
});
test('automatic screening propagates a failed state refresh without another attempt',async()=>{
 const h=mainHarness('auto');h.config.message='';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});
 let operation,attempts=0,syncs=0;const create=h.env.aztec.createPXE;
 h.env.aztec.createPXE=async(...args)=>({...await create(...args),sync:async()=>{if(++syncs>1)throw new TypeError('refresh failed');}});
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},setOperation:value=>operation=value,inspect:async()=>({operation,applicationNullifier:new Fr(7).toString()}),allowReplacement:async()=>{}});
 h.onAction(async()=>{attempts++;throw Object.assign(Error('expired anchor'),{code:'BB_STATE_CONFLICT',stateReasons:['Block header not found']});});
 await assert.rejects(h.run(),/refresh failed/);assert.equal(attempts,1);assert.equal(syncs,2);
});
test('list cannot report an unreadable flag as an unflagged post',async()=>{
 const h=mainHarness('list'),at=h.env.aztec.Contract.at;let flagReads=0;
 const textFields=Array(32).fill(0n);textFields[0]=120n << 240n;
 const policyFields=Array(48).fill(0n);policyFields[0]=120n << 240n;
 const replies={get_moderation_policy_snapshot:[policyFields,1,new Fr(1)],get_post:textFields,get_post_length:1};
 h.env.aztec.Contract.at=async(...args)=>{const contract=await at(...args);return {methods:new Proxy(contract.methods,{get(target,name){
  if(name==='is_post_flagged')return ()=>({simulate:async()=>{flagReads++;throw Error('flag unavailable');}});
  if(Object.hasOwn(replies,name))return ()=>({simulate:async()=>replies[name]});
  return target[name];
 }})};};
 await assert.rejects(h.run(),/flag unavailable/);assert.equal(flagReads,1);assert(!h.logs.some(text=>text.includes('posts loaded')));
});
for(const hash of [undefined,'0x123','not-a-hash'])test(`deposit recovery rejects ${String(hash)} without scanning or payment`,async()=>{
 const h=mainHarness('claim');h.config.reuseTxHash=hash;let scans=0;
 h.provider.getLogs=async()=>{scans++;throw Error('forbidden discovery');};
 await assert.rejects(h.run(),/deposit transaction hash/);assert.equal(scans,0);assert.equal(h.requests.length,0);
});
test('bare reuse cannot turn recovery into a new deposit',async()=>{
 const h=mainHarness('deposit');h.config.reuse=true;delete h.config.reuseTxHash;
 await assert.rejects(h.run(),/--reuse-tx/);assert.equal(h.requests.length,0);
});
test('confirmed claim with failed sync reports confirmation and prevents further actions',async()=>{
 const h=mainHarness('claim'),create=h.env.aztec.createPXE;let confirmed=false,postClaimSyncs=0;
 h.onAction(()=>{confirmed=true;});
 h.env.aztec.createPXE=async(...args)=>({...await create(...args),sync:async()=>{if(confirmed){postClaimSyncs++;throw Error('sync failed');}}});
 h.env.aztec.boundedTransactionRead=operation=>operation();
 await assert.rejects(h.run(),error=>error.code==='BB_WALLET_SYNC_PENDING'&&error.message.includes('Claim confirmed'));
 assert.equal(h.requests.length,1);assert.equal(postClaimSyncs,1);
});

 test('post reads time from the pinned RPC BlockResponse schema',async()=>{
 const h=mainHarness('post'),header=BlockHeader.empty();header.globalVariables.timestamp=100n;
 const block=jsonParseWithSchema(jsonStringify({header,archive:AppendOnlyTreeSnapshot.empty(),hash:BlockHash.ZERO,checkpointNumber:1,indexWithinCheckpoint:0,number:1}),BlockResponseSchema);
 assert.equal(block.timestamp,undefined);
 h.node.getBlock=async()=>block;
 await h.run();assert.equal(h.requests.length,1);
 });
 for(const advance of [true,false])test(`automatic screening rechecks chain cooldown (advancing=${advance})`,async()=>{
 const h=mainHarness('auto');h.config.message='';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n,nextAllowedTime:230n});
 let now=100n,waits=0,actions=0;
 h.node.getBlock=async()=>({header:{globalVariables:{timestamp:now}}});
 h.setTimer((callback,ms)=>{if(ms>=15000){waits++;if(advance)now+=BigInt(ms/1000);}return setTimeout(callback,0);});
 h.onAction(()=>{actions++;assert(now>=230n,'screening submitted before chain eligibility');throw Error('stop after eligibility');});
 await assert.rejects(h.run());
 assert.equal(actions,advance?1:0);assert.equal(waits,advance?3:20);
 });

for(const kind of ['claim','dummy'])test(`accepted ${kind} survives engine restart and changed UI intent through the real encrypted journal`,async()=>{
 const h=mainHarness(kind==='claim'?'claim':'post',kind==='dummy'),tx=Tx.random({randomProof:true}),records=new Map();
 const receipt={txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
 const storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(records.get(key)??null,previous);records.set(key,next);}};
 let journal,included=false,failSync=true,acceptedActions=0;
 h.env.createTransactionJournal=async options=>journal=await createL2Journal({...options,storage,Tx,node:h.node});
 h.node.getTxReceipt=async hash=>{assert.equal(hash.toString(),tx.getTxHash().toString());return {...receipt,status:included?'checkpointed':'dropped'};};
 h.node.sendTx=async()=>assert.fail('Accepted operation must not be resubmitted');
 h.setActionReceipt(receipt);
 if(kind==='dummy')h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});
 const create=h.env.aztec.createPXE;
 h.env.aztec.createPXE=async(...args)=>({...await create(...args),sync:async()=>{if(kind==='claim'&&included&&failSync)throw Error('confirmed claim sync interrupted');}});
 h.env.aztec.boundedTransactionRead=fn=>fn();
 h.onAction(async()=>{
  const binding=kind==='dummy'?{applicationNullifier:tx.data.getNonEmptyNullifiers()[0].toString()}:{};
  await journal.prepare(tx,await journal.assertCanStart(),binding);included=true;acceptedActions++;
  if(kind==='dummy'){
   h.setNoteState({headSequence:2n,lastRealPostIndex:1n,lastScreenedIndex:1n});
   throw Object.assign(Error('accepted screening response lost'),{code:'BB_SUBMISSION_UNKNOWN'});
  }
  journal.confirmed(receipt);
 });
 await assert.rejects(h.run(),{code:kind==='claim'?'BB_WALLET_SYNC_PENDING':'BB_SUBMISSION_UNKNOWN'});
 const original=await journal.inspect();assert.equal(JSON.parse(original.operation).kind,kind);assert.equal(original.txHash,tx.getTxHash().toString());
 if(kind==='dummy')assert.equal(original.applicationNullifier,tx.data.getNonEmptyNullifiers()[0].toString());
 // A new engine invocation must reconcile persisted intent, not current controls.
 h.config.action='recover';h.config.message='different UI text';h.config.isDummy=false;h.config.reuseTxHash=new Fr(999).toString();
 h.restartEngine();const started=performance.now(),recovered=await h.run();
 assert.equal(recovered.state,'transaction_recovered');assert.equal(recovered.lastL2TxHash,original.txHash);
 assert.equal((await journal.inspect()).operation,original.operation);assert.equal(acceptedActions,1);assert.equal(h.requests.length,1);
 failSync=false;h.config.action='status';const refreshed=await h.run();assert.equal(refreshed.state,'postable');
 assert.equal(acceptedActions,1);assert.equal(h.requests.length,1);assert(performance.now()-started<60000);
});
