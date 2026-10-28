import {normalizePrivateFeeGasSettings} from '../shared/private-fee-client.mjs';
import {ensureOnboardingFees} from '../shared/fee-onboarding.mjs';
import {jsonStringify,jsonParseWithSchema} from '@aztec-labs/foundation/json-rpc';
import {BlockResponseSchema} from '@aztec-labs/stdlib/interfaces/client';
import {BlockHeader} from '@aztec-labs/stdlib/tx';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {Tx,TxHash,TxSimulationResult,MinedTxReceipt,DroppedTxReceipt} from '@aztec-labs/stdlib/tx';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';
import * as transactionOutcomes from '../shared/transaction-outcomes.mjs';
// Actual application routing, with explicit node/proof/payment-preparer doubles.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {SiblingPath} from '@aztec-labs/foundation/trees';
import {L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec-labs/constants';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {Gas,GasFees,GasSettings} from '@aztec-labs/stdlib/gas';
import {NO_FROM} from '@aztec-labs/aztec.js/account';
import {waitForL1ToL2MessageReady,isL1ToL2MessageReady} from '@aztec-labs/aztec.js/messaging';
const source=await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const policySource=await readFile(new URL('../shared/moderation-policy.js',import.meta.url),'utf8');
function context(){const c=vm.createContext({URL,performance,console,Buffer,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(policySource,c);vm.runInContext(source,c);return c;}
const canonicalBlockHash=BlockHash.ZERO;
const minedReceipt=txHash=>MinedTxReceipt.from({txHash,status:'checkpointed',executionResult:'success',transactionFee:0n,blockHash:canonicalBlockHash,blockNumber:1,slotNumber:1,txIndexInBlock:0,epochNumber:0});
const gas=()=>new GasSettings(new Gas(100,200),new Gas(1,2),new GasFees(3n,4n),new GasFees(0n,0n));
function fixture(failure,pluginHandle){
 const c=context(),prepared=[],sends=[],owner={toString:()=> 'owner'};
 const paymentMethod={getExecutionPayload(){}};
 const a={Fr,GasSettings,sendPrivateFeeTransaction:async ({interaction,prepared,from})=>interaction.send({from,fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}}),preparePrivateFeePayment:async input=>{prepared.push(input);return {paymentMethod,gasSettings:gas()};}};
 const config={pluginHandle,privateFee:{contractAddress:'fee',gasSettings:gas()},privateFeeClaim:{amount:'100',salt:'secret-salt',leafIndex:'2'}};
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
 for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_TRANSACTION_FINALITY_PENDING','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','BB_BROWSER_PROOF_FAILED','UNTRUSTED']){
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
test('actual wallet preserves a fixed fee budget and account scope/tag',async()=>{
  const c=context(),calls=[],initialLogs=[],currentLogs=[],settings=gas(),expectedSettings=gas(),txHash=TxHash.fromBigInt(4n),payload={authWitnesses:['exact-auth']};
  const receipt=minedReceipt(txHash);
  const node={sendTx:async()=>calls.push('submit'),getTxReceipt:async()=>receipt,getBlock:async()=>({hash:canonicalBlockHash})};
  class BaseWallet {
    constructor(pxe){this.pxe=pxe;}
    async completeFeeOptions(opts){calls.push(['fees',opts]);return {gasSettings:opts.gasSettings};}
    async simulateViaEntrypoint(value,opts){calls.push(['simulate',value,opts]);return {publicInputs:{forPublic:{}},publicOutput:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:{totalGas:new Gas(90,190),teardownGas:new Gas(0,1)}};}
    async createTxExecutionRequestFromPayloadAndFee(value,from,fees){calls.push(['request',value,from,fees]);return 'request';}
    scopesFrom(from,additional){assert.equal(from,owner);return additional;}
    senderForTagsFrom(from,sender){assert.equal(from,owner);return sender;}
  }
  const pxe={proveTx:async(request,opts)=>{calls.push(['prove',request,opts]);return {toTx:async()=>({getTxHash:()=>txHash})};}};
  const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({...transactionOutcomes,BaseWallet,owner,GasSettings},pxe,node,node,message=>initialLogs.push(message),Fr.ONE,{preProveHook:async ({gasLimits,feeOptions})=>{gasLimits.l2Gas=999999;feeOptions.gasSettings.maxFeesPerGas.feePerL2Gas=999999n;}});
  wallet._log=message=>currentLogs.push(message);
  const result=await wallet.sendTx(payload,{from:owner,additionalScopes:[owner],sendMessagesAs:owner,fee:{gasSettings:settings}});
  assert.equal(initialLogs.length,0);assert(currentLogs.some(message=>message.includes('Transaction hash:')));
  assert.equal(result.receipt,receipt);assert.equal(calls.filter(c=>c==='submit').length,1);
  const fees=calls.filter(c=>c[0]==='fees');assert.equal(fees[0][1].forEstimation,false);
  assert.deepEqual(fees[1][1].gasSettings.toBuffer(),expectedSettings.toBuffer());
  assert.equal(calls.filter(c=>c[0]==='simulate').length,1);
  const request=calls.find(c=>c[0]==='request');assert.equal(request[1],payload);assert.equal(request[2],owner);
  const proof=calls.find(c=>c[0]==='prove');assert.equal(proof[2].senderForTags,owner);assert.equal(proof[2].scopes[0],owner);
  wallet._contextGuard=async()=>{throw new Error('context changed during proof');};
  await assert.rejects(wallet.sendTx(payload,{from:owner,additionalScopes:[owner],sendMessagesAs:owner,fee:{gasSettings:settings}}),/context changed during proof/);
  assert.equal(calls.filter(c=>c==='submit').length,1,'changed context must not submit a second proof');
});
// Exercise the actual top-level dispatch, not just the exported routing seam.
import * as ethers from 'ethers';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {NoteStatus} from '@aztec-labs/stdlib/note';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
function mainHarness(action,isDummy=false) {
  let c=context();const requests=[],logs=[],operations=[],trustedConnections=[],readResults=new Map();let actionReceipt={status:'checkpointed',executionResult:'success',blockNumber:1,txHash:new Fr(99)},sent=false,authorBalanceReads=0,postExists=!['post','recover'].includes(action),missingNote=false,noteOverrides={},actionHook=null,readHook=null,censorValue=null;
  // Timers only represent UI yields in this inert test; no network/proof work is performed.
  c.setTimeout=callback=>setTimeout(callback,0);
  const addr=AztecAddress.fromFieldUnsafe(new Fr(12));
  const board=AztecAddress.fromFieldUnsafe(new Fr(11));
  const portal='0x3333333333333333333333333333333333333333',rollup='0x1111111111111111111111111111111111111111';
  const depositor='0x0000000000000000000000000000000000000004';
  const secret=new Fr(8),secretHash=new Fr(9),amount=1000000000000000n;
  const iface=new ethers.Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
  const event=iface.encodeEventLog(iface.getEvent('Deposited'),[depositor,amount,secretHash.toString(),new Fr(77).toString(),42n]);
  const provider={getLogs:async()=>[],getCode:async()=> '0x01',getNetwork:async()=>({chainId:31337n}),destroy(){},getBlock:async()=>({number:1,hash:'canonical-eth'}),getTransactionReceipt:async hash=>({hash,status:1,blockNumber:1,blockHash:'canonical-eth',logs:[{index:0,address:portal,...event}]})};
  class Portal {L2_CONTRACT=async()=>board.toString();L1_CHAIN_ID=async()=>31337n;ROLLUP=async()=>rollup;VERSION=async()=>1n;async getDeposit(){return amount;}async getActiveDeposit(){return {amount,secretHash:secretHash.toString(),key:new Fr(77).toString(),index:42n};}}
  const node={getL1ToL2MessageIndex:async key=>{assert.equal(key.toString(),new Fr(77).toString());return 42n;},getBlockData:async tip=>{assert.equal(tip,'checkpointed');return {header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:43}}}};},getL1ToL2MessageMembershipWitness:async()=>[42n,new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},()=>Fr.ONE.toBuffer()))],getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),getBlockNumber:async()=>1,
    getBlock:async number=>({number,hash:'block',header:{globalVariables:{timestamp:100n}},body:{txEffects:[]}}),getBlocks:async(from,count)=>Array.from({length:count},(_,i)=>({number:Number(from)+i,hash:'block',body:{txEffects:[]}})),getContract:async()=>({address:board}),getPublicStorageAt:async()=>{authorBalanceReads++;throw new Error('Author fee lookup forbidden');}};
  const note=()=>({schemaVersion:1n,depositChainId:5n,amount:missingNote||(action==='claim'&&!sent)?0n:amount,nextAllowedTime:0n,lastRealPostIndex:0n,lastScreenedIndex:0n,headSequence:0n,...noteOverrides});
  c.readBillboardDepositInfo=async()=>note();
  const methods=new Proxy({}, {get:(_target,name)=>{
    if(['post_with_plugin','post','withdraw','claim_deposit','transfer_censor','declare_immoral','set_moderation_policy'].includes(name)) return (...args)=>({send:async opts=>{assert.equal(opts.from,addr);assert.equal(opts.fee.paymentMethod,'private-method');if(actionHook)await actionHook(name,args);sent=true;requests.at(-1).action={kind:action,args};return {receipt:actionReceipt};}});
    return ()=>({simulate:async()=>{if(readHook)await readHook(name);return readResults.has(name)?readResults.get(name):name==='get_censor'?(censorValue??addr.toField()):name==='get_post_exists'?postExists:name==='get_screen_hints'?[{note:{is_dummy:true}},null]:1n;}});
  }});
  class BaseWallet {constructor(pxe){this.pxe=pxe;}}
  const a={provingEnabledForNode,waitForL1ToL2MessageReady,estimatePrivateFeeTransaction:async()=>({}),normalizePrivateFeeGasSettings,...transactionOutcomes,NoteStatus,Fr,AztecAddress,EthAddress,NO_FROM,GasSettings,BaseWallet,sha256ToField,Buffer,
    deriveBoardDepositSecret:async()=>({secret:secret.toString(),secretHash:secretHash.toString()}),
    deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
    SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>Fr.ZERO;getSigningPublicKey=async()=>({x:Fr.ONE,y:Fr.ONE});},
    getContractInstanceFromInstantiationParams:async()=>({address:addr}),computePartialAddress:async()=>Fr.ZERO,
    createAztecNodeClient:()=>assert.fail('private engine must not create ordinary RPC'),createTrustedPrivateNode:async options=>{trustedConnections.push(options);return node;},isTrustedPrivateNode:value=>value===node,inspectTrustedNode:async value=>{assert.equal(value,node);},loadContractArtifact:x=>x,
    createPXE:async()=>({debug:{getNotes:async filter=>{assert.equal(filter.status,NoteStatus.ACTIVE);const n=note();return [{owner:addr,contractAddress:board,storageSlot:Fr.ONE,siloedNullifier:new Fr(7),note:{items:[1n,5n,amount,BigInt(depositor),0n,0n,n.headSequence+(n.lastScreenedIndex<<64n)+(n.lastRealPostIndex<<128n),n.nextAllowedTime].map(v=>new Fr(v))}}];}},registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},getSyncedBlockHeader:async()=>({hash:async()=>new Fr(78)})}),AccountManager:{create:async()=>({address:addr})},Contract:{at:async()=>({methods})},
    computeSecretHash:async()=>secretHash,poseidon2HashWithSeparator:async()=>new Fr(5),
    sendPrivateFeeTransaction:async ({interaction,prepared,from})=>interaction.send({from,fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}}),preparePrivateFeePayment:async input=>{requests.push(input);return {paymentMethod:'private-method',gasSettings:gas()};},
  };
  const env={createEthereumJournal:async()=>({assertCanStart:async()=>{},send:async()=>{throw Object.assign(new Error('Unknown Ethereum submission'),{code:'BB_ETH_SUBMISSION_UNKNOWN'});}}),createTransactionJournal:async()=>({inspectOutcome:async()=>null,assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},setOperation:value=>operations.push(value)}),aztec:a,ethers:{...ethers,Contract:Portal,JsonRpcProvider:class{constructor(){return provider;}}},artifact:{storageLayout:{deposits:{slot:Fr.ONE}}},privateFeeArtifact:{},
    initCRS:async()=>{},createStore:async()=>({}),log:text=>logs.push(text),getBrowserSigner:async()=>({getAddress:async()=>depositor,provider})};
  const config={trustedProverNode:{url:'https://trusted.example/node'},expectedNetworkScope:{chainId:'31337',version:'1',rollup},action,isDummy,message:'text',depositChainId:'5',portalAddress:portal,ethRpcUrl:'http://fixture.invalid',aztecNodeUrl:'http://fixture.invalid',aztecWallet:{secretKey:new Fr(1).toString(),salt:0},
    reuseTxHash:new Fr(3).toString(),claimSecretStore:{save:async()=>{},load:async()=>({schemaVersion:1,secret:secret.toString(),secretHash:secretHash.toString()})},
    privateFee:{contractAddress:'private-fee',gasSettings:gas()}};
  config.censorWalletJson={...config.aztecWallet};config.newCensor=new Fr(44).toString();config.postId=new Fr(55).toString();config.moderationPolicy='No threats';
  function setWithdrawalHistory(executionResult='success') {
    const leaf=c.BillboardUserCodec.computeWithdrawMessageLeaf(a,ethers,board,portal,depositor,amount,1,31337);
    const txHash=new Fr(88);
    node.getBlocks=async()=>[{number:1,hash:'block',body:{txEffects:[{txHash,l2ToL1Msgs:[leaf]}]}}];
    node.getTxReceipt=async()=>({txHash,status:'checkpointed',executionResult,blockNumber:1,blockHash:'block'});
  }
  return {setReadResult:(name,value)=>readResults.set(name,value),restartEngine:()=>{c=context();c.setTimeout=callback=>setTimeout(callback,0);c.readBillboardDepositInfo=async()=>note();},setActionReceipt:value=>actionReceipt=value,setTimer:fn=>{c.setTimeout=fn;},run:()=>c.runBillboardUser(env,config),setWithdrawalHistory,env,config,node,provider,Portal,requests,logs,operations,trustedConnections,setCensor:value=>censorValue=value,setMissingNote:value=>missingNote=value,setNoteState:value=>noteOverrides=value,onAction:value=>actionHook=value,onRead:value=>readHook=value,setPostExists:value=>postExists=value,authorBalanceReads:()=>authorBalanceReads,secret};
}
for(const [action,dummy] of [['claim',false],['post',false],['post',true],['withdraw',false]]) {
  test(`actual main ${action}${dummy?' dummy':''} uses standard author call with private fee payment`,async()=>{
    const h=mainHarness(action,dummy);const result=await h.run();assert.equal(h.requests.length,1);assert.equal(h.authorBalanceReads(),0);
    const r=h.requests[0];assert.equal(r.action.kind,action);assert.equal(r.expectedChainId,'31337');assert.equal(r.expectedVersion,'1');
    if(action==='claim'){assert.equal(result.state,'postable');assert.equal(r.action.args.length,4);assert.equal(r.action.args[2].toString(),h.secret.toString());assert.equal(r.action.args[3],42n);}
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
  h.env.createTransactionJournal=async options=>{scope=options.scope;return {assertCanStart:async()=>{},prepare:async()=>{},confirmed:()=>{},inspect:async()=>({txHash:new Fr(99).toString(),operation:JSON.stringify({kind:'withdraw'})}),recover:async()=>({txHash:new Fr(99),executionResult})};};
  const result=await h.run();assert.equal(result.state,executionResult==='success'?'transaction_recovered':'transaction_reverted');assert.equal(scope.chainId,'31337');assert.equal(scope.version,'1');assert.equal(scope.portal,h.config.portalAddress);assert.equal(h.requests.length,0);
  assert.equal(h.logs.some(s=>s.includes('Saved transaction succeeded')),executionResult==='success');
  assert.equal(result.withdrawTxHash,executionResult==='success'?new Fr(99).toString():undefined);
 }
});

test('Ethereum recovery handles already refunded receipts before checking active deposit',async()=>{
 for(const outcome of ['success','reverted','replaced']) {
  const h=mainHarness('recover-eth');h.Portal.prototype.getDeposit=async()=>0n;
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

for(const plugin of [false,true])test('actual recovery dispatcher restores saved message, nonce and plugin: '+plugin,async()=>{
 const h=mainHarness('recover'),nonce=new Fr(123).toString(),operations=[];
 const operation=JSON.stringify({schemaVersion:plugin?2:1,kind:'post',nonce,message:'original saved text',depositChain:new Fr(5).toString(),...(plugin?{pluginHandle:new Fr(8).toString()}:{})});
 let allowed=0;
 h.config.message='a different new message';h.config.isDummy=true;
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),
  allowReplacement:async expected=>{assert.equal(expected,operation);allowed++;},setOperation:value=>operations.push(value)});
 await h.run();assert.equal(allowed,1);assert.deepEqual(operations,[operation]);assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].action.args[1].toString(),nonce);if(plugin)assert.equal(h.requests[0].action.args.at(-1).toString(),new Fr(8).toString());else assert.equal(h.requests[0].action.args[4],false);
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

test('missing withdrawal note requires saved transaction recovery even if matching exit content exists',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);h.setWithdrawalHistory();
 await assert.rejects(h.run(),{code:'BB_RECOVERY_UNKNOWN'});assert.equal(h.requests.length,0);
 assert(!h.logs.some(x=>x.includes('Confirmed prior withdrawal. Tx hash:')));
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

test('missing withdrawal note rejects without scanning history or looking up a claim secret',async()=>{
 const h=mainHarness('withdraw');h.setMissingNote(true);let historyReads=0,secretReads=0;
 h.node.getBlocks=async()=>{historyReads++;throw Error('History scan forbidden');};
 h.config.claimSecretStore.load=async()=>{secretReads++;throw Error('Claim secret lookup forbidden');};
 await assert.rejects(h.run(),{code:'BB_RECOVERY_UNKNOWN'});
 assert.equal(historyReads,0);assert.equal(secretReads,0);assert.equal(h.requests.length,0);
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
 const c=context(),calls=[],txHash=TxHash.fromBigInt(91n),appNullifier=new Fr(92);let tx={getTxHash:()=>txHash};
 let receipt=minedReceipt(txHash);
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(){return {publicInputs:{forPublic:{}},publicOutput:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:{totalGas:new Gas(1,1),teardownGas:new Gas(0,0)}};}
  async createTxExecutionRequestFromPayloadAndFee(){return 'request';}
  scopesFrom(){return [];} senderForTagsFrom(){return owner;}
 }
 const proven={toTx:async()=>tx},pxe={proveTx:async()=>proven};
 const node={sendTx:async()=>calls.push('submit'),getTxReceipt:async()=>receipt,getBlock:async()=>({hash:canonicalBlockHash})};
 const journal={assertCanStart:async()=>null,prepare:async(value,previous,binding)=>{assert.equal(value,tx);assert.equal(binding.applicationNullifier,appNullifier.toString());calls.push('saved');},waitForCompletion:async()=>transactionOutcomes.waitForSuccessfulReceipt(node,tx),confirmed:()=>{}};
 const a={provingEnabledForNode,...transactionOutcomes,BaseWallet,GasSettings,extractApplicationNullifier:async(result,value,board)=>{assert.equal(result,proven);assert.equal(value,tx);assert.equal(board,'board');calls.push('attributed');return appNullifier;}};
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
 tx=Tx.random({randomProof:true});receipt=minedReceipt(tx.getTxHash());
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
 const intent={schemaVersion:2,kind:'claim',depositor:'0x0000000000000000000000000000000000000004',amount:'1000000000000000',leafIndex:'42',secretHash:new Fr(9).toString(),messageKey:new Fr(77).toString(),depositChain:new Fr(5).toString(),...overrides};
 const operation=JSON.stringify(intent),operations=[];
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed:()=>{},
  recover:async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},inspect:async()=>({operation}),
  allowReplacement:async expected=>assert.equal(expected,operation),setOperation:op=>operations.push(op)});
 return {...h,intent,operation,operations};
}
test('stale claim restores exact original receipt and claim identity without depositing again',async()=>{
 const h=savedClaimHarness();h.config.reuseTxHash=new Fr(999).toString();
 h.onAction(()=>h.setMissingNote(false));
 const result=await h.run();assert.equal(result.state,'postable');assert.equal(h.requests.length,1);assert.deepEqual(h.operations,[h.operation]);
 const args=h.requests[0].action.args;
 assert.equal(args[1],1000000000000000n);assert.equal(args[2].toString(),h.secret.toString());assert.equal(args[3],42n);
});
for(const [key,value] of [['messageKey',new Fr(78).toString()],['amount','1'],['leafIndex','43'],['depositChain',new Fr(6).toString()],['secretHash',new Fr(10).toString()],['depositor','0x0000000000000000000000000000000000000005']])test(`stale claim rejects changed ${key} before another fee payment`,async()=>{
 const h=savedClaimHarness({[key]:value});await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
test('an existing note is not confirmation of an unresolved saved claim transaction',async()=>{
 const h=savedClaimHarness();h.setMissingNote(false);await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
test('failed claim does not enter the former thirty-attempt loop',async()=>{
 const h=mainHarness('claim');let sends=0;h.onAction(async()=>{sends++;throw new Error('not available');});
 await assert.rejects(h.run());assert.equal(sends,1);assert.equal(h.requests.length,1);
});

test('saved claim rejects a replaced active deposit before proving',async()=>{
 const h=savedClaimHarness(),read=h.Portal.prototype.getActiveDeposit;
 h.Portal.prototype.getActiveDeposit=async()=>({...await read(),key:new Fr(999).toString()});
 await assert.rejects(h.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(h.requests.length,0);
});
test('saved claim rejects a block changed during metadata retrieval',async()=>{
 const h=savedClaimHarness();let read=false;
 const original=h.Portal.prototype.getActiveDeposit;
 h.Portal.prototype.getActiveDeposit=async()=>{read=true;return original();};
 h.provider.getBlock=async()=>({number:1,hash:read?'changed':'original'});
 await assert.rejects(h.run(),/Ethereum changed/);assert.equal(h.requests.length,0);
});
test('saved claim metadata timeout cannot prepare fees or proofs',async()=>{
 const h=savedClaimHarness();h.Portal.prototype.getActiveDeposit=()=>new Promise(()=>{});
 h.env.aztec.boundedTransactionRead=(fn,timeout)=>{assert(timeout>0&&timeout<=20000);return transactionOutcomes.boundedTransactionRead(fn,20);};
 await assert.rejects(h.run(),{code:'BB_DEPOSIT_LOOKUP_FAILED'});assert.equal(h.requests.length,0);
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
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
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
  const read=h.node.getL1ToL2MessageMembershipWitness,error=Error('private RPC');
  h.node.getL1ToL2MessageMembershipWitness=async()=>{if(mode==='rpc')throw error;if(mode==='missing')return undefined;const w=await read();return[43n,w[1]];};
  await assert.rejects(h.run(),e=>mode==='rpc'?e===error:e.code==='BB_DEPOSIT_MESSAGE_INVALID');
  assert.equal(h.requests.length,0);assert.equal(h.operations.length,0);assert.equal(sends,0);
 }
});
test('actual claim waits for delayed exact receipt key then prepares fees and submits once',async()=>{
 const h=mainHarness('claim'),entered=Promise.withResolvers(),ready=Promise.withResolvers();let reads=0,sends=0,indexReads=0;
 const read=h.node.getL1ToL2MessageMembershipWitness;
 h.node.getL1ToL2MessageIndex=async key=>{assert.equal(key.toString(),new Fr(77).toString());indexReads++;entered.resolve();return ready.promise;};
 h.node.getL1ToL2MessageMembershipWitness=async(hash,key)=>{assert.equal(hash.toString(),new Fr(78).toString());assert.equal(key.toString(),new Fr(77).toString());reads++;return read();};
 h.onAction(()=>sends++);const pending=h.run();await entered.promise;
 assert.equal(reads,0);assert.equal(sends,0);assert.equal(h.requests.length,0);assert.equal(h.operations.length,0);
 ready.resolve(42n);await pending;assert.equal(indexReads,1);assert.equal(reads,1);assert.equal(sends,1);assert.equal(h.requests.length,1);
});
test('native message readiness rejects absent inbox entries and uninserted checkpoint leaves',async()=>{
 const h=mainHarness('claim'),key=new Fr(77);let blockReads=0;
 h.node.getBlockData=async tip=>{assert.equal(tip,'checkpointed');blockReads++;return {header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:42}}}};};
 h.node.getL1ToL2MessageIndex=async()=>undefined;
 assert.equal(await isL1ToL2MessageReady(h.node,key,'checkpointed'),false);assert.equal(blockReads,0);
 h.node.getL1ToL2MessageIndex=async()=>42n;
 assert.equal(await isL1ToL2MessageReady(h.node,key,'checkpointed'),false);assert.equal(blockReads,1);
 assert.equal(h.requests.length,0);assert.equal(h.operations.length,0);
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
 const receipt=minedReceipt(tx.getTxHash());
 const getBlock=h.node.getBlock;h.node.getBlock=async number=>({...await getBlock(number),hash:canonicalBlockHash});
 const storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(records.get(key)??null,previous);records.set(key,next);}};
 let journal,included=false,failSync=true,acceptedActions=0;
 h.env.createTransactionJournal=async options=>journal=await createL2Journal({...options,storage,Tx,node:h.node});
 h.node.getTxReceipt=async hash=>{assert.equal(hash.toString(),tx.getTxHash().toString());return included?receipt:new DroppedTxReceipt(tx.getTxHash());};
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

test('confirmed claim with missing delivered note reports synchronization pending without resubmission',async()=>{
 const h=mainHarness('claim');h.setMissingNote(true);
 await assert.rejects(h.run(),{code:'BB_WALLET_SYNC_PENDING'});
 assert.equal(h.requests.length,1);
});

for (const failure of ['total-da','total-l2','teardown-da','teardown-l2','missing-public','revert']) test(`actual wallet rejects ${failure} before proving or submitting`,async()=>{
 const c=context();let proofs=0;
 const used={totalGas:new Gas(90,190),teardownGas:new Gas(0,1)};
 if(failure==='total-da')used.totalGas.daGas=101;
 if(failure==='total-l2')used.totalGas.l2Gas=201;
 if(failure==='teardown-da')used.teardownGas.daGas=2;
 if(failure==='teardown-l2')used.teardownGas.l2Gas=3;
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(payload,opts){assert.equal(opts.skipTxValidation,false);assert.equal(opts.skipFeeEnforcement,false);return {publicInputs:{forPublic:{}},publicOutput:failure==='missing-public'?undefined:failure==='revert'?{revertReason:'reverted'}:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:used};}
 }
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},{proveTx:async()=>{proofs++;throw Error('must not prove');}},{},{},()=>{},Fr.ONE);
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),{code:failure==='missing-public'||failure==='revert'?'BB_SIMULATION_FAILED':'BB_GAS_LIMIT_EXCEEDED'});
 assert.equal(proofs,0);
});

test('entirely private simulation needs no public output and still checks gas before proof',async()=>{
 const c=context(),stop=Error('reached proof');let proofs=0;
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(payload,opts){assert.equal(opts.skipTxValidation,false);assert.equal(opts.skipFeeEnforcement,false);return new TxSimulationResult(undefined,{forPublic:undefined,gasUsed:new Gas(90,190)});}
  async createTxExecutionRequestFromPayloadAndFee(){return {};}
  scopesFrom(){return [owner];}senderForTagsFrom(){return owner;}
 }
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},{proveTx:async()=>{proofs++;throw stop;}},{},{},()=>{},Fr.ONE);
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),error=>error===stop);
 assert.equal(proofs,1);
});

test('recovered withdrawal survives status without Ethereum signer and after reconnect',async()=>{
 const h=mainHarness('recover'),withdrawTxHash=new Fr(99).toString(),signer=h.env.getBrowserSigner;
 h.setMissingNote(true);
 const saved={txHash:withdrawTxHash,operation:JSON.stringify({schemaVersion:1,kind:'withdraw',depositChain:new Fr(5).toString(),headSequence:'0'}),applicationNullifier:new Fr(7).toString()};
 h.env.createTransactionJournal=async()=>({inspectOutcome:async()=>({...saved,outcome:'success'}),assertCanStart:async()=>{},prepare:async()=>{},confirmed:()=>{},inspect:async()=>saved,recover:async()=>({txHash:new Fr(99),executionResult:'success'})});
 const recovered=await h.run();assert.equal(recovered.withdrawTxHash,withdrawTxHash);
 h.config.action='status';h.config.withdrawTxHash=recovered.withdrawTxHash;h.config.hasEthSigner=false;h.env.getBrowserSigner=null;
 const disconnected=await h.run();assert.equal(disconnected.state,'withdrawal_needs_verification');assert.equal(disconnected.withdrawTxHash,withdrawTxHash);assert.equal(disconnected.handles.withdrawTxHash,withdrawTxHash);
 h.config.withdrawTxHash=disconnected.withdrawTxHash;h.config.hasEthSigner=true;h.env.getBrowserSigner=signer;
 const connected=await h.run();assert.equal(connected.state,'withdrawal_needs_verification');assert.equal(connected.withdrawTxHash,withdrawTxHash);assert.equal(h.requests.length,0);
});

test('zero portal balance preserves the exact withdrawal until verified refund recovery',async()=>{
 const h=mainHarness('status'),withdrawTxHash=new Fr(99).toString();h.setMissingNote(true);h.config.withdrawTxHash=withdrawTxHash;
 h.Portal.prototype.getDeposit=async()=>0n;
 const status=await h.run();assert.equal(status.portalL1Balance,'0');assert.equal(status.state,'withdrawal_needs_verification');assert.equal(status.withdrawTxHash,withdrawTxHash);
 h.config.action='recover-eth';
 for(const [outcome,kind,clears] of [['reverted','withdraw',false],['success','deposit',false]]){
  h.env.createEthereumJournal=async()=>({assertCanStart:async()=>{},send:async()=>{},recover:async()=>({outcome,txHash:new Fr(100).toString(),request:{expected:{kind}}})});
  const result=await h.run();assert.equal(Object.hasOwn(result,'withdrawTxHash'),clears);if(clears)assert.equal(result.withdrawTxHash,null);
 }
 assert.equal(h.requests.length,0);
});

for(const scenario of ['matching','older-refund','missing-witness','rpc-error'])test(`Ethereum refund recovery binds the saved L2 withdrawal: ${scenario}`,async()=>{
 const h=mainHarness('recover-eth'),hash=new Fr(99).toString();h.config.withdrawTxHash=hash;h.env.aztec.TxHash=TxHash;
 const witness={epochNumber:1,numCheckpointsInEpoch:1,leafIndex:2,siblingPath:{toBufferArray:()=>[Buffer.alloc(32)]}};
 let reads=0;h.node.getL2ToL1MembershipWitness=async tx=>{reads++;assert.equal(tx.toString(),hash);if(scenario==='rpc-error')throw Error('private provider error');return scenario==='missing-witness'?null:witness;};
 const data=new ethers.Interface(['function withdraw(uint256,uint256,uint256,bytes32[])']).encodeFunctionData('withdraw',[1,1,scenario==='older-refund'?3:2,['0x'+'00'.repeat(32)]]);
 h.env.createEthereumJournal=async()=>({assertCanStart:async()=>{},send:async()=>{throw Error('Recovery must not send');},recover:async()=>({outcome:'success',txHash:new Fr(100).toString(),request:{data,expected:{kind:'withdraw',amount:'1000000000000000'}}})});
 if(scenario==='rpc-error')await assert.rejects(h.run(),{code:'BB_RECOVERY_UNKNOWN'});
 else{const result=await h.run();assert.equal(Object.hasOwn(result,'withdrawTxHash'),scenario==='matching');if(scenario==='matching'){assert.equal(result.withdrawTxHash,null);assert.equal(result.refundAmount,'1000000000000000');assert.match(result.refundRecipient,/^0x[0-9a-fA-F]{40}$/);}else assert.equal(result.refundAmount,undefined);}
 assert.equal(reads,1);assert.equal(h.requests.length,0);assert(!h.logs.some(text=>text.includes('private provider error')));
});

test('fee preparation preserves only the recognized low-cap diagnostic',async()=>{
 const c=context();let sends=0;
 const sender=c.BillboardPrivateFeeRouting.createPrivateFeeSender({a:{GasSettings,preparePrivateFeePayment:async()=>{throw Object.assign(Error('private detail'),{code:'PRIVATE_FEE_CAP_TOO_LOW'});}},config:{privateFee:{contractAddress:'fee',gasSettings:gas()}},privateFeeArtifact:{},contract:{methods:{claim_deposit:()=>({send:()=>{sends++;}})}},wallet:{},node:{},owner:{},scope:{l1ChainId:'31337',rollupVersion:'1'}});
 await assert.rejects(sender('claim',[]),e=>e.code==='PRIVATE_FEE_CAP_TOO_LOW'&&!e.message.includes('private detail'));assert.equal(sends,0);
});

for (const failure of ['revert','gas-change']) test(`fixed fee reservation is validated once: ${failure} stops before proof`,async()=>{
 const c=context();let simulations=0,proofs=0;
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(_payload,opts){
   simulations++;
   if(simulations===1){
    assert.equal(opts.skipTxValidation,false);assert.equal(opts.skipFeeEnforcement,false);
    assert.equal(opts.feeOptions.gasSettings.gasLimits.l2Gas,200);
   }
   return {publicInputs:{forPublic:{}},publicOutput:simulations===1&&failure==='revert'?{revertReason:'reservation changed'}:{txEffect:{revertCode:{isOK:()=>true}}},
    gasUsed:{totalGas:new Gas(50,simulations===1&&failure==='gas-change'?201:100),teardownGas:new Gas(0,1)}};
  }
 }
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},{proveTx:async()=>{proofs++;throw Error('must not prove');}},{},{},()=>{},Fr.ONE);
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),{code:failure==='revert'?'BB_SIMULATION_FAILED':'BB_GAS_LIMIT_EXCEEDED'});
 assert.equal(simulations,1);assert.equal(proofs,0);
});

test('claim retrieves active metadata after reload without receipts or log scans',async()=>{
 const h=mainHarness('claim');h.env.aztec.boundedTransactionRead=transactionOutcomes.boundedTransactionRead;delete h.config.reuseTxHash;
 h.provider.getTransactionReceipt=async()=>{throw Error('receipt lookup forbidden');};
 h.provider.getLogs=async()=>{throw Error('historical scan forbidden');};
 await h.run();assert.equal(h.requests.length,1);assert.equal(JSON.parse(h.operations[0]).messageKey,new Fr(77).toString());
});

for(const code of ['PRIVATE_FEE_BALANCE_INSUFFICIENT','PRIVATE_FEE_CLAIM_INSUFFICIENT','UNTRUSTED'])test(`fee readiness preserves only safe classification: ${code}`,async()=>{
 const c=context();let sends=0;
 const sender=c.BillboardPrivateFeeRouting.createPrivateFeeSender({a:{GasSettings,preparePrivateFeePayment:async()=>{throw Object.assign(Error('private secret'),{code});}},config:{privateFee:{contractAddress:'fee',gasSettings:gas()}},privateFeeArtifact:{},contract:{methods:{claim_deposit:()=>({send:()=>{sends++;}})}},wallet:{},node:{},owner:{},scope:{l1ChainId:'31337',rollupVersion:'1'}});
 await assert.rejects(sender('claim',[]),e=>e.code===(code==='UNTRUSTED'?'BB_PRIVATE_FEE_PREPARATION_FAILED':code)&&!e.message.includes('secret'));assert.equal(sends,0);
});

test('public claim failures keep useful safe classifications across repeated formatting',async()=>{
 const env=await readFile(new URL('../shared/app-env.js',import.meta.url),'utf8');
 const format=new Function(env.slice(env.indexOf('function publicOperationFailure('),env.indexOf('function makeCallEngine('))+';return publicOperationFailure;')();
 for(const code of ['BB_DEPOSIT_READ','PRIVATE_FEE_BALANCE_INSUFFICIENT','PRIVATE_FEE_CLAIM_INSUFFICIENT','BB_PRIVATE_FEE_PREPARATION_FAILED','BB_PRIVATE_FEE_ACTION_FAILED']){
  const result=format(format(Object.assign(Error('SECRET_RPC_PAYLOAD'),{code})));assert.equal(result.code,code);assert(!result.message.includes('SECRET'));assert(!result.message.includes('Wallet operation did not complete'));
 }
 assert.equal(format(Object.assign(Error('SECRET_RPC_PAYLOAD'),{code:'SECRET_CODE'})).code,'BB_OPERATION_FAILED');
});

for(const ready of [false,true])test(`new Ethereum deposit checks fee readiness before secret storage or payment: ${ready}`,async()=>{
 const h=mainHarness('deposit');delete h.config.reuseTxHash;h.config.depositAmount='0.001';h.setMissingNote(true);
 h.Portal.prototype.getDeposit=async()=>0n;h.Portal.prototype.depositsEnabled=async()=>true;h.Portal.prototype.MIN_DEPOSIT=async()=>1n;h.Portal.prototype.MAX_DEPOSIT=async()=>10n**18n;
 let checks=0,saves=0,payments=0;
 h.env.aztec.preparePrivateFeePayment=async()=>{checks++;if(!ready)throw Object.assign(Error('private balance detail'),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});return {paymentMethod:'private',gasSettings:gas()};};
 h.config.claimSecretStore.save=async()=>{saves++;throw Object.assign(Error('Stop at storage boundary'),{code:'TEST_STORAGE'});};
 h.env.createEthereumJournal=async()=>({assertCanStart:async()=>{},send:async build=>{await build(7);payments++;throw Error('must not pay');}});
 await assert.rejects(h.run(),{code:ready?'TEST_STORAGE':'PRIVATE_FEE_BALANCE_INSUFFICIENT'});
 assert.equal(checks,1);assert.equal(saves,ready?1:0);assert.equal(payments,0);assert.equal(h.requests.length,0);
});

for(const recovered of [false,true])test(`automatic fee funding reaches board claim with recovered=${recovered}`,async()=>{
 const h=mainHarness('claim'),calls=[];
 h.config.automaticFeeFunding=true;h.config.saveRecovery=async()=>{};
 h.env.createJournalStorage=()=>({});
 const a=h.env.aztec,prepare=a.preparePrivateFeePayment;
 a.preparePrivateFeePayment=async input=>{if(!input.claim)throw {code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'};return prepare(input);};
 a.ensureOnboardingFees=ensureOnboardingFees;
 a.normalizePrivateFeeGasSettings=()=>({maximumFee:100n});
 a.recoverPrivateFeeFunding=async input=>{assert.equal(input.acknowledgeEthereumTx,undefined);calls.push('recover');if(!recovered)throw {code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'};return {outcome:'funded',record:'saved'};};
 a.fundPrivateFees=async input=>{assert.equal(input.amount,200n);calls.push('fund');return 'new';};
 const claim={amount:200n,salt:Fr.ONE,secret:Fr.ONE,leafIndex:new Fr(42),messageKey:new Fr(77).toString()};
 a.recoverPrivateFeeClaim=async()=>claim;
 a.isPrivateFeeClaimConsumed=async()=>false;
 h.onAction(()=>calls.push('board-claim'));
 const result=await h.run();assert.equal(result.state,'postable');
 assert.deepEqual(calls,recovered?['recover','board-claim']:['recover','fund','board-claim']);
 assert.equal(h.requests.at(-1).claim,claim);assert.equal(h.requests.at(-1).action.kind,'claim');
});
test('withdrawal preparation cannot start a proof beyond the reviewed step budget',async()=>{const h=mainHarness('withdraw');h.config.prepareWithdrawal=true;h.config.maxScreeningSteps=0;h.config.maximumCreditSpend='100000';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});await assert.rejects(h.run(),{code:'BB_WITHDRAWAL_BUDGET'});assert.equal(h.requests.length,0);});
test('withdrawal stops spending when screening does not advance',async()=>{const h=mainHarness('withdraw');h.config.prepareWithdrawal=true;h.config.maxScreeningSteps=2;h.config.maximumCreditSpend='100000';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});await assert.rejects(h.run(),{code:'BB_SCREENING_NO_PROGRESS'});assert.equal(h.requests.length,1);});
test('withdrawal waits through the actual moderation deadline before any proof',async()=>{const h=mainHarness('withdraw');h.config.prepareWithdrawal=true;h.config.maxScreeningSteps=2;h.config.maximumCreditSpend='100000';h.setNoteState({headSequence:1n,lastRealPostIndex:1n,lastScreenedIndex:0n});h.setReadResult('get_screen_hints',[{note:{is_dummy:false,post_id:new Fr(3)}},null]);h.setReadResult('get_post_flag_deadline',1000n);let waits=0;h.setTimer((callback,ms)=>{assert(ms<=30000);waits++;return setTimeout(callback,0);});h.config.contextGuard=async()=>{if(waits)throw Object.assign(Error('Paused'),{code:'BB_OPERATION_PAUSED'});};await assert.rejects(h.run(),{code:'BB_OPERATION_PAUSED'});assert.equal(h.requests.length,0);assert.equal(waits,1);});

for (const mode of ['confirmed','stale','approved','changed'])test(`reviewed moderator recovery: ${mode}`,async()=>{
 const original=mainHarness('transfer-censor');await original.run();const operation=original.operations.at(-1),txHash=new Fr(99).toString(),h=mainHarness('recover');let recoveries=0,replacements=0;
 h.config.moderatorRecovery={txHash,operation,policyVersion:new Fr(1).toString(),allowReplacement:mode==='approved'};
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>null,prepare:async()=>{},confirmed(){},inspect:async()=>({operation,txHash:mode==='changed'?new Fr(100).toString():txHash}),recover:async()=>{recoveries++;if(mode==='confirmed')return {txHash:new Fr(99),executionResult:'success'};throw Object.assign(Error('stale'),{code:'BB_RECOVERY_REQUIRED'});},allowReplacement:async value=>{replacements++;assert.equal(value,operation);},setOperation:value=>h.operations.push(value)});
 if(mode==='changed'){await assert.rejects(h.run(),{code:'BB_MODERATOR_REVIEW_CHANGED'});assert.equal(recoveries,0);}else if(mode==='stale')await assert.rejects(h.run(),{code:'BB_MODERATOR_REVIEW_REQUIRED'});else {const result=await h.run();if(mode==='confirmed')assert.equal(result.state,'transaction_recovered');}
 assert.equal(replacements,mode==='approved'?1:0);assert.equal(h.requests.length,mode==='approved'?1:0);if(mode==='approved')assert.deepEqual(h.operations,[operation]);
});

test('post returns its public message identity and actual fee to the application',async()=>{const h=mainHarness('post');h.setActionReceipt({status:'checkpointed',blockNumber:1,transactionFee:123n});const result=await h.run();assert.equal(result.postId,new Fr(5).toString());assert.equal(result.feePaid,'123');});

for(const scenario of ['current','old-cycle','pending','reverted','malformed'])test('read-only startup withdrawal reconciliation: '+scenario,async()=>{
 const h=mainHarness('status');h.setMissingNote(true);if(scenario==='old-cycle')h.config.withdrawTxHash=new Fr(99).toString();let writes=0;
 const create=h.env.createTransactionJournal;
 h.env.createTransactionJournal=async()=>({...await create(),inspectOutcome:async()=>({outcome:scenario==='pending'?'pending':scenario==='reverted'?'reverted':'success',operation:JSON.stringify({schemaVersion:1,kind:'withdraw',depositChain:new Fr(scenario==='old-cycle'?6:5).toString(),headSequence:'0'}),txHash:new Fr(99).toString(),applicationNullifier:scenario==='malformed'?null:new Fr(7).toString()}),recover:async()=>{writes++;throw Error('No recovery during startup');},assertCanStart:async()=>{writes++;throw Error('No write preflight during startup');}});
 if(scenario==='malformed')await assert.rejects(h.run(),{code:'BB_JOURNAL_INVALID'});
 else {const result=await h.run();assert.equal(result.state,scenario==='current'?'withdrawal_needs_verification':scenario==='old-cycle'?'deposited_l1_not_claimed_l2':'transaction_needs_recovery');assert.equal(result.withdrawTxHash,scenario==='current'?new Fr(99).toString():null);}
 assert.equal(writes,0);assert.equal(h.requests.length,0);
});

test('plugin posting preserves private fee routing and leaves dummy posts unchanged',async()=>{
 const h=fixture(undefined,'123');const args=[1,2,['text'],4,false,6,7];
 await h.sender('post',args);await h.sender('post',[...args.slice(0,4),true,6,7]);
 assert.equal(h.sends[0].method,'post_with_plugin');assert.deepEqual(Array.from(h.sends[0].args.slice(0,6)),[1,2,['text'],4,6,7]);assert.equal(h.sends[0].args[6].toBigInt(),123n);
 assert.equal(h.sends[1].method,'post');assert.equal(h.sends[1].args[4],true);
 for(const send of h.sends){assert.equal(send.opts.from,h.owner);assert.equal(send.opts.fee.paymentMethod,h.paymentMethod);}
});

test('plugin metadata persists after the proof journal and context changes stop broadcast',async()=>{
 const c=context(),calls=[],hash=TxHash.fromBigInt(90n),tx={getTxHash:()=>hash},receipt=minedReceipt(hash);let changed=false;
 class BaseWallet {constructor(pxe){this.pxe=pxe;}async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}async simulateViaEntrypoint(){return {publicInputs:{forPublic:{}},publicOutput:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:{totalGas:new Gas(1,1),teardownGas:new Gas(0,0)}};}async createTxExecutionRequestFromPayloadAndFee(){return 'request';}scopesFrom(){return [];}senderForTagsFrom(){return owner;}}
 const a={...transactionOutcomes,BaseWallet,GasSettings},pxe={proveTx:async()=>({toTx:async()=>tx})},node={sendTx:async()=>calls.push('send'),getTxReceipt:async()=>receipt,getBlock:async()=>({hash:canonicalBlockHash})};
 const journal={setOperation:()=>calls.push('intent'),assertCanStart:async()=>null,prepare:async()=>calls.push('proof-saved'),waitForCompletion:async()=>transactionOutcomes.waitForSuccessfulReceipt(node,tx),confirmed:()=>calls.push('confirmed')};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet(a,pxe,node,node,()=>{},Fr.ONE,{contextGuard:async()=>{if(changed)throw {code:'BB_WALLET_NOT_READY'};}});
 const opts={from:owner,fee:{gasSettings:gas()},transactionJournal:journal,journalOperation:JSON.stringify({kind:'extension'}),beforeSubmit:async()=>calls.push('plugin-saved')};
 await wallet.sendTx({},opts);assert.deepEqual(calls,['intent','proof-saved','plugin-saved','send','confirmed']);
 calls.length=0;opts.beforeSubmit=async()=>{calls.push('plugin-saved');changed=true;};await assert.rejects(wallet.sendTx({},opts),{code:'BB_WALLET_NOT_READY'});assert.deepEqual(calls,['intent','proof-saved','plugin-saved']);
});

test('development doubles: private actions require trusted configuration and never ordinary RPC',async()=>{
 for(const action of ['post','status','recover','claim','withdraw']){const h=mainHarness(action);delete h.config.trustedProverNode;await assert.rejects(h.run(),{code:'BB_TRUSTED_NODE_CONFIG'});assert.equal(h.requests.length,0);assert.equal(h.trustedConnections.length,0);}
});
test('development doubles: cached node is re-inspected across proof toggle and rejected on outage',async()=>{
 const h=mainHarness('post');let inspections=0,pxes=0,offline=false;const create=h.env.aztec.createPXE,journal=h.env.createTransactionJournal;h.env.createTransactionJournal=async input=>{assert.equal(input.node,h.node);return journal(input);};
 h.env.aztec.createPXE=async(node,...args)=>{assert.equal(node,h.node);pxes++;return {...await create(node,...args),setRemoteProver:async value=>{h.logs.push(value?'remote-proof':'local-proof');}};};
 h.env.aztec.inspectTrustedNode=async(node,options)=>{assert.equal(node,h.node);assert.equal(options.url,'https://trusted.example/node');inspections++;if(offline)throw Object.assign(Error('Trusted unavailable'),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});};
 await h.run();h.config.remoteProver={url:'https://proof.example'};await h.run();h.config.remoteProver=undefined;await h.run();
 assert(h.requests.every(input=>input.node===h.node));assert.equal(h.trustedConnections.length,1);assert.equal(pxes,1);assert.equal(inspections,2);assert(h.logs.includes('remote-proof'));assert(h.logs.includes('local-proof'));
 const before=h.requests.length;offline=true;await assert.rejects(h.run(),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});assert.equal(h.requests.length,before);
 h.config.trustedProverNode={url:'https://second-trusted.example/node'};offline=false;await h.run();assert.equal(pxes,2);assert.equal(h.trustedConnections.length,2);assert.equal(h.trustedConnections[1].url,'https://second-trusted.example/node');
});
test('development doubles: new private connection outage never creates journal or prepares fees',async()=>{
 const h=mainHarness('post');h.env.createTransactionJournal=()=>assert.fail('journal must not start');let calls=0;h.env.aztec.createTrustedPrivateNode=async()=>{calls++;throw Object.assign(Error('Unavailable'),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});};
 await assert.rejects(h.run(),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});assert.equal(calls,1);assert.equal(h.requests.length,0);
});

for(const action of ['post','claim','withdraw','auto']) test(`pending reverted finality blocks ${action} before wallet or payment work`,async()=>{
 const h=mainHarness(action),code='BB_TRANSACTION_FINALITY_PENDING';
 for(const name of ['initCRS','createStore','getBrowserSigner'])h.env[name]=async()=>assert.fail(name+' must not run before finality');
 h.env.createTransactionJournal=async()=>({assertCanStart:async()=>{throw Object.assign(Error('Awaiting finality'),{code});},prepare:async()=>{throw Error('must not prepare');},confirmed(){}});
 await assert.rejects(h.run(),{code});assert.equal(h.requests.length,0);assert.equal(h.operations.length,0);
});
test('wallet rechecks pending reverted finality before simulation, proof or submission',async()=>{
 const c=context(),calls=[];class BaseWallet{constructor(pxe){this.pxe=pxe;}async completeFeeOptions(){calls.push('fees');}async simulateViaEntrypoint(){calls.push('simulate');}}
 const journal={assertCanStart:async()=>{throw Object.assign(Error('Awaiting finality'),{code:'BB_TRANSACTION_FINALITY_PENDING'});}};
 const node={sendTx:async()=>calls.push('send')},pxe={proveTx:async()=>calls.push('prove')};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},pxe,node,node,()=>{},Fr.ONE,{transactionJournal:journal});
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()}}),{code:'BB_TRANSACTION_FINALITY_PENDING'});assert.deepEqual(calls,[]);
});
for(const failure of [null,'revert','gas'])test('atomic private simulation and proof: '+failure,async()=>{
 const c=context(),calls=[],txHash=TxHash.fromBigInt(42n),receipt=minedReceipt(txHash),request={signed:'request'},stats={timings:{total:123}};
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  async completeFeeOptions(options){return {gasSettings:options.gasSettings};}
  async simulateViaEntrypoint(){throw Error('duplicate simulation');}
  async createTxExecutionRequestFromPayloadAndFee(){return request;}
  scopesFrom(){return [owner];}senderForTagsFrom(){return owner;}
 }
 const pxe={async proveTxWithPublicValidation(value,options){
  assert.equal(value,request);assert.equal(options.senderForTags,owner);calls.push('validate');
  if(failure)throw Object.assign(Error('native validation failed'),{code:failure==='gas'?'BB_GAS_LIMIT_EXCEEDED':'BB_SIMULATION_FAILED'});
  calls.push('prove');return {stats,toTx:async()=>({getTxHash:()=>txHash})};
 },async proveTx(){throw Error('duplicate proving');}};
 const node={async sendTx(){calls.push('send');},async getTxReceipt(){return receipt;},async getBlock(){return {hash:canonicalBlockHash};}};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({...transactionOutcomes,BaseWallet,GasSettings,recordProofTimings(value){assert.equal(value,stats);calls.push('timings');throw Error('diagnostic sink unavailable');}},pxe,node,node,()=>{},Fr.ONE);
 const pending=wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()},atomicSimulation:true});
 if(failure){await assert.rejects(pending,{code:failure==='gas'?'BB_GAS_LIMIT_EXCEEDED':'BB_SIMULATION_FAILED'});assert.deepEqual(calls,['validate']);}
 else{await pending;assert.deepEqual(calls,['validate','prove','timings','send']);}
});

test('atomic proving failure callback runs before transaction conversion, journaling or submission',async()=>{
 const c=context(),calls=[],native=Error('native private credit assertion');
 class BaseWallet{constructor(pxe){this.pxe=pxe;}async completeFeeOptions(options){return {gasSettings:options.gasSettings};}async createTxExecutionRequestFromPayloadAndFee(){return {};}scopesFrom(){return [owner];}senderForTagsFrom(){return owner;}}
 const pxe={async proveTxWithPublicValidation(){calls.push('private-validation');throw native;}},node={sendTx(){assert.fail('No broadcast');}};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},pxe,node,node,()=>{},Fr.ONE);
 await assert.rejects(wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()},atomicSimulation:true,onProvingFailure:async error=>{assert.equal(error,native);calls.push('unsigned-failure');throw Object.assign(Error('Add credit'),{code:'BB_POST_FEE_CREDIT_REQUIRED'});}}),{code:'BB_POST_FEE_CREDIT_REQUIRED'});
 assert.deepEqual(calls,['private-validation','unsigned-failure']);
});

for(const application of ['post','post_with_bok'])test('generic validated proof preserves fee capsules without class-qualified pre-sync: '+application,async()=>{
 const c=context(),stop=Error('inspection complete'),calls=[{name:'pay_fee'},{name:application}],capsules=[{contractAddress:new Fr(17),storageSlot:new Fr(18),data:[new Fr(19)]}];
 const payload={calls,capsules};
 class BaseWallet{constructor(pxe){this.pxe=pxe;}async completeFeeOptions(options){return {gasSettings:options.gasSettings};}async createTxExecutionRequestFromPayloadAndFee(value){assert.equal(value,payload);assert.equal(value.capsules,capsules);return {capsules:value.capsules};}scopesFrom(){return [owner];}senderForTagsFrom(){return owner;}}
 const pxe={async proveTxWithPublicValidation(request,opts){assert.equal(request.capsules,capsules);assert.equal(opts.preSyncCalls,undefined);throw stop;}};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet,GasSettings},pxe,{}, {},()=>{},Fr.ONE);
 await assert.rejects(wallet.sendTx(payload, {from:owner,fee:{gasSettings:gas()},atomicSimulation:true}),error=>error===stop);
});

for(const tier of ['proposed','checkpointed'])test('actual wallet delegates '+tier+' completion to exact encrypted journal native waiter',async()=>{
 const c=context(),tx=Tx.random({randomProof:true}),receipt=MinedTxReceipt.from({...minedReceipt(tx.getTxHash()),status:tier}),records=new Map(),scope={};let receipts=0,blocks=0,sends=0,included=0;
 class BaseWallet{constructor(pxe){this.pxe=pxe;}async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}async simulateViaEntrypoint(){return {publicInputs:{forPublic:{}},publicOutput:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:{totalGas:new Gas(1,1),teardownGas:new Gas(0,0)}};}async createTxExecutionRequestFromPayloadAndFee(){return 'request';}scopesFrom(){return [];}senderForTagsFrom(){return owner;}}
 const node={sendTx:async()=>sends++,getTxReceipt:async()=>{receipts++;return receipt;},getBlock:async()=>{blocks++;return {hash:canonicalBlockHash};}},pxe={proveTx:async()=>({toTx:async()=>tx})};
 const journal=await createL2Journal({storage:{read:async k=>records.get(k)??null,compareAndSwap:async(k,p,n)=>{assert.equal(records.get(k)??null,p);records.set(k,n);}},walletSecret:Fr.ONE.toString(),walletSalt:Fr.ZERO.toString(),Tx,node,operationScope:()=>scope,confirmationTier:tier,...(tier==='proposed'?{predecessorAnchor:()=>assert.fail('not a successor proof')}:{}),scope:{account:Fr.ONE.toString(),chainId:'31337',rollup:'0x'+'01'.repeat(20),version:'5',board:new Fr(2).toString(),portal:'0x'+'02'.repeat(20)}});
 const a={...transactionOutcomes,BaseWallet,GasSettings,waitForSuccessfulReceipt:()=>assert.fail('must not start a second wallet waiter')};
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet(a,pxe,node,node,()=>{},Fr.ONE,{transactionJournal:journal,progress:stage=>{if(stage==='included')included++;}});
 const result=await wallet.sendTx({}, {from:owner,fee:{gasSettings:gas()},journalOperation:'exact-completion',confirmationTier:tier});assert.equal(result.receipt,receipt);
 assert.deepEqual({receipts,blocks,sends,included},{receipts:1,blocks:1,sends:1,included:1});
 const found=await journal.inspectOutcome({completion:true});assert.equal(found.operation,'exact-completion');assert.equal(found.outcome,'success');assert.equal(found.receipt.status,tier);assert.deepEqual({receipts,blocks},{receipts:1,blocks:1});
 await journal.inspectOutcome();assert.deepEqual({receipts,blocks},{receipts:2,blocks:2});
});
