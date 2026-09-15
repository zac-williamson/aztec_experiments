// Actual engine routing/wallet methods; network, provider and prover doubles are explicit.
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
const scope={l1ChainId:'31337',rollupVersion:'1',rollupAddress:'rollup',boardAddress:'board',portalAddress:'portal'};
const owner={toString:()=> 'owner'};
function fixture(change={}) {
  const c=context(),requests=[],acquisitions=[],sends=[];
  const options={from:NO_FROM,additionalScopes:[owner],sendMessagesAs:owner,authWitnesses:['exact-auth'],fee:{gasSettings:gas()}};
  const a={NO_FROM,GasSettings,prepareSponsoredAction:async input=>{requests.push(input);return {interaction:{send:async opts=>{sends.push(opts);if(change.sendError)throw change.sendError;return {receipt:{status:'checkpointed',executionResult:'success'}};}},options};}};
  const config={sponsorship:{sponsorAddress:'sponsor',gasSettings:gas(),couponProvider:{acquire:async request=>{acquisitions.push(request);if(change.acquireError)throw change.acquireError;return change.noCoupon?null:{batchId:1,index:0,blind:'local-blind',siblings:[]};}}}};
  const inputs={a,config,sponsorArtifact:{sponsor:true},boardArtifact:{board:true},wallet:{},node:{},owner,scope};
  return {c,a,config,inputs,requests,acquisitions,sends,options,send:()=>c.BillboardSponsorRouting.createSponsoredSender(inputs)};
}
for(const [kind,args] of [['claim',['depositor',10n,1n,'claim-secret',42n]],['post',['chain','nonce',Array(32).fill(0),4,false,'child','grandchild']],['post',['chain',Fr.ZERO,Array(32).fill(Fr.ZERO),0,true,null,null]],['withdraw',['chain']]]) {
  test(`actual engine sender routes ${kind}${args[4]===true?' dummy':''} through exact sponsor options`,async()=>{
    const h=fixture();const result=await h.send()(kind,args);
    assert.equal(result.receipt.executionResult,'success');assert.equal(h.sends.length,1);
    const request=h.requests[0];assert.equal(request.action.kind,kind);assert.equal(request.action.args,args);
    assert.equal(request.expectedChainId,'31337');assert.equal(request.expectedVersion,'1');assert.equal(request.boardArtifact,h.inputs.boardArtifact);
    assert.equal(request.sponsorArtifact,h.inputs.sponsorArtifact);assert.equal(request.owner,owner);
    assert.equal(h.sends[0],h.options);assert.equal(h.sends[0].from,NO_FROM);
    const acquired=h.acquisitions[0];assert.deepEqual(Object.keys(acquired).sort(),['actionKind','owner','scope']);
    assert(!JSON.stringify(acquired).includes('claim-secret'));assert(!('args' in acquired));assert(Object.isFrozen(acquired.scope));
  });
}
test('missing configuration, artifact, SDK or provider rejects before coupon acquisition or signing',async()=>{
  for(const mutation of [h=>delete h.config.sponsorship,h=>delete h.inputs.sponsorArtifact,h=>delete h.a.prepareSponsoredAction,h=>delete h.config.sponsorship.couponProvider,h=>delete h.config.sponsorship.gasSettings.maxFeesPerGas.feePerDaGas]) {
    const h=fixture();mutation(h);assert.throws(()=>h.send(),e=>e.code==='BB_SPONSOR_UNAVAILABLE');assert.equal(h.requests.length,0);assert.equal(h.acquisitions.length,0);
  }
});
test('literal gas settings hydrate through actual SDK and incomplete bounds never default',()=>{
  const h=fixture();h.config.sponsorship.gasSettings=JSON.parse(JSON.stringify(gas(),(_k,v)=>typeof v==='bigint'?v.toString():v));
  const hydrated=h.c.BillboardSponsorRouting.requireSponsorConfiguration(h.a,h.config,{}).gasSettings;
  assert(hydrated instanceof GasSettings);assert.deepEqual(hydrated.toBuffer(),gas().toBuffer());
});
test('provider exhaustion and private errors never send, leak input text or fall back',async()=>{
  for(const change of [{noCoupon:true},{acquireError:new Error('owner secret blind private-content')},{sendError:new Error('secret private-content')}]) {
    const h=fixture(change);await assert.rejects(h.send()('withdraw',['chain']),e=>e.code.startsWith('BB_SPONSOR_')&&!e.message.includes('private-content'));
    assert.equal(h.acquisitions.length,1);assert.equal(h.sends.length,change.sendError?1:0);
  }
});
test('exact submission ambiguity and paid failure propagate without reacquiring or resending',async()=>{
  for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT']) {
    const error=Object.assign(new Error(code),{code,stateReasons:['Block header not found']});const h=fixture({sendError:error});
    await assert.rejects(h.send()('post',['chain','stable-id',[],0,false,null,null]),e=>e.code===code && e.message!==error.message);
    assert.equal(h.acquisitions.length,1);assert.equal(h.sends.length,1);
    assert.equal(h.c.BillboardPostCodec.screeningFailureCanWait(error),false);
  }
});
test('invalid author-funded or missing-auth prepared route cannot be sent',async()=>{
  for(const mutate of [opts=>opts.from=owner,opts=>opts.authWitnesses=[],opts=>opts.sendMessagesAs=null,opts=>opts.additionalScopes=[]]) {
    const h=fixture();mutate(h.options);await assert.rejects(h.send()('withdraw',['chain']),e=>e.code==='BB_SPONSOR_PREPARATION_FAILED');assert.equal(h.sends.length,0);
  }
});
test('actual main entry fails closed for every private action before account/provider work',async()=>{
  for(const action of ['claim','post','withdraw','auto']) {
    const c=context();let touched=false;
    await assert.rejects(c.runBillboardUser({aztec:{deriveSigningKey(){touched=true;}},artifact:{}},{action,aztecWallet:{secretKey:'unused'}}),e=>e.code==='BB_SPONSOR_UNAVAILABLE');
    assert.equal(touched,false);
  }
});
test('actual wallet keeps checked NO_FROM gas and owner scope/tag through simulation and proof',async()=>{
  const c=context(),calls=[],settings=gas(),expectedSettings=gas(),txHash={toString:()=>new Fr(4).toString()},payload={authWitnesses:['exact-auth']};
  const receipt={txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
  const node={sendTx:async()=>calls.push('submit'),getTxReceipt:async()=>receipt};
  class BaseWallet {
    constructor(pxe){this.pxe=pxe;}
    async completeFeeOptions(opts){calls.push(['fees',opts]);return {gasSettings:opts.gasSettings};}
    async simulateViaEntrypoint(value,opts){calls.push(['simulate',value,opts]);return {gasUsed:{totalGas:new Gas(90,190),teardownGas:new Gas(0,1)}};}
    async createTxExecutionRequestFromPayloadAndFee(value,from,fees){calls.push(['request',value,from,fees]);return 'request';}
    scopesFrom(from,additional){assert.equal(from,NO_FROM);return additional;}
    senderForTagsFrom(from,sender){assert.equal(from,NO_FROM);return sender;}
  }
  const pxe={proveTx:async(request,opts)=>{calls.push(['prove',request,opts]);return {toTx:async()=>({getTxHash:()=>txHash})};}};
  const wallet=c.BillboardSponsorRouting.createAztecWallet({BaseWallet,NO_FROM,GasSettings},pxe,node,node,()=>{},Fr.ONE,{preProveHook:async ({gasLimits,feeOptions})=>{gasLimits.l2Gas=999999;feeOptions.gasSettings.maxFeesPerGas.feePerL2Gas=999999n;}});
  const result=await wallet.sendTx(payload,{from:NO_FROM,additionalScopes:[owner],sendMessagesAs:owner,fee:{gasSettings:settings}});
  assert.equal(result.receipt,receipt);assert.equal(calls.filter(c=>c==='submit').length,1);
  const fees=calls.filter(c=>c[0]==='fees');assert.equal(fees[0][1].forEstimation,false);
  assert.deepEqual(fees[1][1].gasSettings.toBuffer(),expectedSettings.toBuffer());
  const request=calls.find(c=>c[0]==='request');assert.equal(request[1],payload);assert.equal(request[2],NO_FROM);
  const proof=calls.find(c=>c[0]==='prove');assert.equal(proof[2].senderForTags,owner);assert.equal(proof[2].scopes[0],owner);
});
test('browser config preserves only the installed local sponsorship callback',async()=>{
  const local={couponProvider:{acquire:async()=>null}};
  const c=vm.createContext({window:{walletState:null,billboardSponsorship:local},ETH_RPC_URL:'local'});
  vm.runInContext(await readFile(new URL('../shared/app-env.js',import.meta.url),'utf8'),c);
  assert.equal(c.buildConfig('post').sponsorship,local);
});

test('provider cannot smuggle private messages or retry codes into the UI',async()=>{
  for(const code of ['BB_SUBMISSION_UNKNOWN','BB_STATE_CONFLICT','BB_SPONSOR_UNAVAILABLE']) {
    const h=fixture({acquireError:Object.assign(new Error('private owner and blind'),{code})});
    await assert.rejects(h.send()('withdraw',['chain']),e=>e.code==='BB_SPONSOR_PREPARATION_FAILED' && !e.message.includes('private'));
    assert.equal(h.sends.length,0);
  }
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
    getBlock:async()=>({timestamp:100,body:{txEffects:[]}}),getContract:async()=>({address:board}),getPublicStorageAt:async()=>{authorBalanceReads++;throw new Error('Author fee lookup forbidden');}};
  const note=()=>({schemaVersion:1n,depositChainId:5n,depositNonce:7n,amount:action==='claim'&&!sent?0n:amount,nextAllowedTime:0n,lastRealPostIndex:0n,lastScreenedIndex:0n,headSequence:0n});
  c.readBillboardDepositInfo=async()=>note();
  const methods=new Proxy({}, {get:(_target,name)=>{
    if(['post','withdraw','claim_deposit'].includes(name))throw new Error('Direct author-funded method must never be selected');
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
    prepareSponsoredAction:async input=>{requests.push(input);return {interaction:{send:async opts=>{assert.equal(opts.from,NO_FROM);sent=true;return {receipt:{status:'checkpointed',executionResult:'success',blockNumber:1,txHash:new Fr(99)}};}},options:{from:NO_FROM,additionalScopes:[addr],sendMessagesAs:addr,authWitnesses:['auth'],fee:{gasSettings:gas()}}};},
  };
  const env={aztec:a,ethers:{...ethers,Contract:Portal,JsonRpcProvider:class{constructor(){return provider;}}},artifact:{},sponsorArtifact:{},
    initCRS:async()=>{},createStore:async()=>({}),log:text=>logs.push(text),getBrowserSigner:async()=>({getAddress:async()=>depositor,provider})};
  const config={action,isDummy,message:'text',depositChainId:'5',portalAddress:portal,ethRpcUrl:'http://fixture.invalid',aztecNodeUrl:'http://fixture.invalid',aztecWallet:{secretKey:new Fr(1).toString(),salt:0},
    reuseTxHash:new Fr(3).toString(),claimSecretStore:{save:async()=>{},load:async()=>({schemaVersion:1,secret:secret.toString(),secretHash:secretHash.toString()})},
    sponsorship:{sponsorAddress:'sponsor',gasSettings:gas(),couponProvider:{acquire:async()=>({batchId:1,index:0,blind:'private',siblings:[]})}}};
  return {run:()=>c.runBillboardUser(env,config),requests,logs,authorBalanceReads:()=>authorBalanceReads,secret};
}
for(const [action,dummy] of [['claim',false],['post',false],['post',true],['withdraw',false]]) {
  test(`actual main ${action}${dummy?' dummy':''} selects sponsorship and never calls the direct method`,async()=>{
    const h=mainHarness(action,dummy);await h.run();assert.equal(h.requests.length,1);assert.equal(h.authorBalanceReads(),0);
    const r=h.requests[0];assert.equal(r.action.kind,action);assert.equal(r.expectedChainId,'31337');assert.equal(r.expectedVersion,'1');
    if(action==='claim'){assert.equal(r.action.args[2],7n);assert.equal(r.action.args[3].toString(),h.secret.toString());}
    if(action==='post'){assert.equal(r.action.args[3],dummy?0:4);assert.equal(r.action.args[4],dummy);assert.equal(r.action.args[1].isZero(),dummy);}
    assert(!h.logs.some(text=>text.includes('fund your account')||text.includes('You need some to pay')));
  });
}
