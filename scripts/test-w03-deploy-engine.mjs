import {provingEnabledForNode} from '../shared/proving-policy.mjs';
// Complete deploy engine and real encrypted L2 journal; inert SDK/chain fixtures.
// Tests orchestration and interruption boundaries, not cryptographic proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as ethers from 'ethers';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {EthAddress} from '@aztec/foundation/eth-address';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
import {createL2Journal} from '../shared/l2-journal.mjs';
import {createEthereumJournal} from '../shared/ethereum-journal.mjs';
import {verifyDeploymentInputs,preflightDeploymentNetwork,deploymentPolicyVersion,deploymentManifestConfig} from '../shared/deployment-manifest.mjs';
import {expectedPortalRuntime,verifyPortalRuntime} from '../shared/portal-runtime.mjs';
const runtimeMetadata=JSON.parse(await readFile(new URL('../shared/portal-runtime.json',import.meta.url),'utf8'));
import {boundedTransactionRead} from '../shared/transaction-outcomes.mjs';
const source=await readFile(new URL('../apps/src/billboard/deploy/engine.js',import.meta.url),'utf8');
const create2Proxy='0x4e59b44847b379578588920ca78fbf26c0b4956c';
const create2Runtime='0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
class FixtureTx {
 constructor(kind,proof=0){this.kind=kind;this.proof=proof;}
 toBuffer(){return Buffer.from(JSON.stringify([this.kind,this.proof]));}
 getTxHash(){return ethers.sha256(this.toBuffer());}
 static fromBuffer(bytes){return new FixtureTx(...JSON.parse(bytes.toString()));}
}
function fixture({lostBinding=false,lostDeploy=false,existing=true,staleDeploy=false,staleBinding=false}={}) {
 const actor=AztecAddress.fromFieldUnsafe(new Fr(1)),board=AztecAddress.fromFieldUnsafe(new Fr(2));
 const inbox='0x'+'6'.repeat(40),outbox='0x'+'7'.repeat(40);
 const rollup='0x'+'3'.repeat(40),sender='0x'+'4'.repeat(40),blockHash=field(5);
 const instance={address:actor,currentContractClassId:field(12),originalContractClassId:field(12)};
 const storage=createBrowserJournalStorage(new IDBFactory()),receipts=new Map(),invalids=new Set();let proofId=0;
 let bound=null,stops=0,deploys=0,bindings=0,finalized=0;
 const wordHash=(label,words)=>'0x'+(BigInt(ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32',...words.map(()=> 'uint256')],[ethers.encodeBytes32String(label),...words])))>>8n).toString(16).padStart(64,'0');
 const configHash=wordHash('AZTEC_BB_CONFIG_V1',[1n,31337n,BigInt(rollup),2n,5n,1n,100n,10n,64n,10n,16n]);
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5}),getL1ContractAddresses:async()=>({rollupAddress:rollup,inboxAddress:inbox,outboxAddress:outbox}),
  getBlockNumber:async()=>1,getPublicStorageAt:async()=>new Fr(0),getContract:async()=>existing?instance:undefined,
  getTxReceipt:async hash=>receipts.get(String(hash)),getBlock:async()=>({hash:blockHash}),getChainTips:async()=>({finalized:{block:{number:finalized}}}),
  sendTx:async tx=>{if(tx.kind==='deploy'){existing=true;}else {bound=tx.kind.slice(5);}
   receipts.set(tx.getTxHash(),{txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash});},
  isValidTx:async tx=>invalids.has(tx.getTxHash())?{result:'invalid',reason:['Block header not found']}:{result:'valid'}};
 const pxe={registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},stop:async()=>{stops++;}};
 async function submit(wallet,kind,lose){
  const journal=wallet._transactionJournal,previous=await journal.assertCanStart(),tx=new FixtureTx(kind,++proofId);
  await journal.prepare(tx,previous);
  if((kind==='deploy'&&staleDeploy)||(kind.startsWith('bind:')&&staleBinding)){receipts.set(tx.getTxHash(),{txHash:tx.getTxHash(),status:'dropped'});invalids.add(tx.getTxHash());throw new Error('synthetic stale proof');}
  await node.sendTx(tx);
  if(lose)throw new Error('synthetic lost response');
  const receipt=await node.getTxReceipt(tx.getTxHash());journal.confirmed(receipt);return{receipt};
 }
 // These journal cases start with a published class; publication itself is covered
 // by test-c01-deploy-activation.mjs.
 const a={provingEnabledForNode,verifyDeploymentInputs,preflightDeploymentNetwork,deploymentPolicyVersion,verifyPortalRuntime,portalRuntimeMetadata:runtimeMetadata,boundedTransactionRead,Fr,AztecAddress,EthAddress,Tx:FixtureTx,TxHash:{fromString:x=>x},BaseWallet:class{async getContractClassMetadata(){return {isContractClassPubliclyRegistered:true};}},
  deriveSigningKey:()=>({}),deriveKeys:async()=>({publicKeys:{}}),computePartialAddress:async()=>new Fr(1),
  getContractClassFromArtifact:async()=>({id:field(12)}),getContractInstanceFromInstantiationParams:async()=>instance,deriveStorageSlotInMap:async()=>new Fr(1),
  SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>field(0);getSigningPublicKey=async()=>({});},
  createAztecNodeClient:()=>node,createPXE:async()=>pxe,AccountManager:{create:async()=>({})},loadContractArtifact:x=>x,createEthereumJournal,
  sha256ToField:()=>new Fr(7),Contract:{
   deploy:wallet=>({getAddress:async()=>board,getInstance:async()=>instance,send:async()=>{deploys++;return submit(wallet,'deploy',lostDeploy);}}),
   at:async(_address,_artifact,wallet)=>({methods:{
    get_censor:()=>({simulate:async()=>BigInt(actor.toString())}),get_policy_version:()=>({simulate:async()=>BigInt(await deploymentPolicyVersion(board.toString(),'Be kind.'))}),
    get_portal:()=>({simulate:async()=>BigInt(bound||0)}),is_portal_set:()=>({simulate:async()=>bound!==null}),get_config_hash:()=>({simulate:async()=>BigInt(configHash)}),
    update_portal:address=>({send:async()=>{bindings++;return submit(wallet,'bind:'+address.toString().toLowerCase(),lostBinding);}}),
   }}),
  }};
 const runtimeValues={L2_CONTRACT:board.toString(),ROLLUP:rollup,VERSION:5n,L1_CHAIN_ID:31337n,MIN_DEPOSIT:1n,MAX_DEPOSIT:100n,CONFIG_HASH:configHash,INBOX:inbox,OUTBOX:outbox};
 let destroyed=0;const provider={destroy(){destroyed++;},getNetwork:async()=>({chainId:31337n}),getCode:async address=>address.toLowerCase()===create2Proxy?create2Runtime:[rollup,inbox,outbox].includes(address.toLowerCase())?'0x6000':expectedPortalRuntime(runtimeMetadata,runtimeValues)};
 const portal={getInbox:async()=>inbox,getOutbox:async()=>outbox,INBOX:async()=>inbox,OUTBOX:async()=>outbox,L2_CONTRACT:async()=>board.toString(),ROLLUP:async()=>rollup,VERSION:async()=>5n,L1_CHAIN_ID:async()=>31337n,MIN_DEPOSIT:async()=>1n,MAX_DEPOSIT:async()=>100n,CONFIG_HASH:async()=>configHash,depositsEnabled:async()=>false};
 const env={aztec:a,ethers:{...ethers,JsonRpcProvider:class{constructor(){return provider;}},Contract:class{constructor(){return portal;}}},log(){},pause(){throw new Error('unexpected pause');},initCRS:async()=>{},createStore:async()=>({}),artifact:{},portalBytecode:'0x6000',
  getBrowserSigner:async()=>({provider,getAddress:async()=>sender}),createJournalStorage:()=>storage,
  createTransactionJournal:options=>createL2Journal({...options,storage,waitOptions:{timeoutMs:20,intervalMs:1}})};
 const hash=o=>ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(o)));
 const manifest={schemaVersion:1,profile:'local-test',network:{nodeUrl:'http://localhost:8080/',ethRpcUrl:'http://localhost:8545/',chainId:'31337',rollupVersion:'5',rollup,inbox,outbox},actors:{aztecDeployer:actor.toString(),ethereumDeployer:sender},board:{salt:'1',minDeposit:'1',maxDeposit:'100',baseCooldown:'10',kMultiplier:'64',censorWindow:'10',maxSaveUp:'16',censor:actor.toString(),policy:'Be kind.'},artifacts:{boardJsonSha256:hash(env.artifact),boardClassId:field(12),portalCreationSha256:ethers.sha256(env.portalBytecode),portalRuntimeMetadataSha256:hash(runtimeMetadata)}};
 const config={...deploymentManifestConfig(manifest),aztecWallet:{secretKey:field(8),salt:field(9)}};
 function run(extra={}){const context=vm.createContext({setTimeout,clearTimeout,Buffer,packStringToFields:()=>({fields:Array(48).fill(0n),len:0})});vm.runInContext(source,context);return context.runDeploy(env,{...config,...extra});}
 return {run,env,node,provider,portal,manifest,config,runtimeValues,receipts,get destroyed(){return destroyed;},setBound:value=>bound=value,get stops(){return stops;},get deploys(){return deploys;},get bindings(){return bindings;},clearLoss(){lostBinding=false;lostDeploy=false;staleDeploy=false;staleBinding=false;}};
}
test('lost binding response resumes from encrypted transaction without supplied hash or another binding',async()=>{
 const f=fixture({lostBinding:true});await assert.rejects(f.run(),/synthetic lost/);assert.equal(f.stops,1);f.clearLoss();
 const result=await f.run();assert.equal(result.status,'pending-settlement');assert.match(result.readyTxHash,/^0x[0-9a-f]{64}$/);assert.equal(f.bindings,1);assert.equal(f.deploys,0);assert.equal(f.stops,2);
 assert.equal((await f.run()).readyTxHash,result.readyTxHash);assert.equal(f.bindings,1);
 await assert.rejects(f.run({readyTxHash:field(999)}),/differs from the saved/);assert.equal(f.bindings,1);
});
test('lost board deployment response resumes original transaction and deploys the board only once',async()=>{
 const f=fixture({existing:false,lostDeploy:true});await assert.rejects(f.run(),/synthetic lost/);assert.equal(f.deploys,1);f.clearLoss();
 const result=await f.run();assert.equal(result.status,'pending-settlement');assert.equal(f.deploys,1);assert.equal(f.bindings,1);assert.equal(f.stops,2);
});
test('unresolved saved binding cannot start another transaction or falsely complete setup',async()=>{
 const f=fixture({lostBinding:true});await assert.rejects(f.run(),/synthetic lost/);f.clearLoss();
 for(const [hash,receipt]of f.receipts)f.receipts.set(hash,{...receipt,status:'pending'});
 await assert.rejects(f.run(),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(f.bindings,1);assert.equal(f.deploys,0);assert.equal(f.stops,2);
});
test('missing journal fails closed before any deployment signature and closes PXE',async()=>{
 const f=fixture({existing:false});delete f.env.createTransactionJournal;
 await assert.rejects(f.run(),{code:'BB_JOURNAL_INVALID'});assert.equal(f.deploys,0);assert.equal(f.bindings,0);assert.equal(f.stops,1);
});

for(const kind of ['deploy','binding'])test(`definitively stale ${kind} proof regenerates only the same deployment operation`,async()=>{
 const f=fixture(kind==='deploy'?{existing:false,staleDeploy:true}:{staleBinding:true});
 await assert.rejects(f.run(),/synthetic stale proof/);const original=[...f.receipts.keys()][0];f.clearLoss();
 const result=await f.run();assert.equal(result.status,'pending-settlement');
 assert.equal(f.deploys,kind==='deploy'?2:0);assert.equal(f.bindings,kind==='binding'?2:1);
 assert.equal(f.receipts.get(original).status,'dropped');assert.notEqual(result.readyTxHash,original);
 await f.run();assert.equal(f.deploys,kind==='deploy'?2:0);assert.equal(f.bindings,kind==='binding'?2:1);
});
test('stale binding cannot silently accept another binding that appeared meanwhile',async()=>{
 const f=fixture({staleBinding:true});await assert.rejects(f.run(),/synthetic stale proof/);f.clearLoss();f.setBound('0x'+'a'.repeat(40));
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.bindings,1);
});
test('stale binding cannot redeploy a missing original Ethereum portal',async()=>{
 const f=fixture({staleBinding:true});await assert.rejects(f.run(),/synthetic stale proof/);f.clearLoss();const previous=f.provider.getCode;f.provider.getCode=async address=>[create2Proxy,f.manifest.network.rollup,f.manifest.network.inbox,f.manifest.network.outbox].includes(address.toLowerCase())?previous(address):'0x';
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.bindings,1);
});

test('stale board deployment cannot silently accept a board that appeared meanwhile',async()=>{
 const f=fixture({existing:false,staleDeploy:true});await assert.rejects(f.run(),/synthetic stale proof/);f.clearLoss();
 f.node.getContract=async()=>({currentContractClassId:field(12)});
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.deploys,1);assert.equal(f.bindings,0);
});

for(const kind of ['missing manifest','Aztec actor','Ethereum actor','chain','bridge','artifact'])test(`deployment preflight rejects ${kind} before any transaction`,async()=>{
 const f=fixture({existing:false});let extra={};
 if(kind==='missing manifest')extra.deploymentManifest=undefined;
 if(kind==='Aztec actor')f.manifest.actors.aztecDeployer=field(99);
 if(kind==='Ethereum actor')f.manifest.actors.ethereumDeployer='0x'+'9'.repeat(40);
 if(kind==='chain')f.provider.getNetwork=async()=>({chainId:1n});
 if(kind==='bridge')f.portal.getInbox=async()=> '0x'+'a'.repeat(40);
 if(kind==='artifact')f.env.artifact={changed:true};
 if(kind.endsWith('actor'))extra.deploymentManifest=f.manifest;
 const expected={'missing manifest':/Invalid deployment manifest/,'Aztec actor':/Aztec deployer differs/,'Ethereum actor':/Ethereum deployer differs/,chain:/network identity mismatch/,bridge:/bridge\/code mismatch/,artifact:/artifact identity mismatch/}[kind];
 await assert.rejects(f.run(extra),expected);assert.equal(f.deploys,0);assert.equal(f.bindings,0);assert.equal(f.stops,0);
});
for(const kind of ['runtime','inbox','outbox','policy','censor'])test(`existing deployment rejects ${kind} mismatch before binding`,async()=>{
 const f=fixture();
 if(kind==='runtime'){const original=f.provider.getCode;f.provider.getCode=async address=>{const code=await original(address);return address.toLowerCase()===create2Proxy||code==='0x6000'?code:code+'00';};}
 if(kind==='inbox')f.portal.INBOX=async()=> '0x'+'a'.repeat(40);
 if(kind==='outbox')f.portal.OUTBOX=async()=> '0x'+'a'.repeat(40);
 if(kind==='policy'||kind==='censor'){const original=f.env.aztec.Contract.at;f.env.aztec.Contract.at=async(...args)=>{const contract=await original(...args);contract.methods[kind==='policy'?'get_policy_version':'get_censor']=()=>({simulate:async()=>99n});return contract;};}
 await assert.rejects(f.run(),kind==='runtime'?/runtime does not match/:['policy','censor'].includes(kind)?/censor or policy differs/:/Portal configuration mismatch/);assert.equal(f.deploys,0);assert.equal(f.bindings,0);assert.equal(f.stops,1);
});

test('owned preflight provider is disposed even before wallet/PXE startup',async()=>{const f=fixture();f.node.getNodeInfo=async()=>{throw Error('offline');};await assert.rejects(f.run(),/offline/);assert.equal(f.destroyed,1);assert.equal(f.stops,0);});
test('external browser provider is not disposed',async()=>{const f=fixture();let owned=0;f.env.ethers.JsonRpcProvider=class{constructor(){return {...f.provider,destroy(){owned++;}};}};await f.run();assert.equal(owned,1);assert.equal(f.destroyed,0);});
for(const key of ['originalContractClassId','currentContractClassId'])test('deployed '+key+' mismatch blocks binding',async()=>{const f=fixture();const previous=f.node.getContract;f.node.getContract=async()=>({...await previous(),[key]:field(99)});await assert.rejects(f.run(),/class|Class/);assert.equal(f.bindings,0);assert.equal(f.destroyed,1);});
for(const method of ['is_portal_set','get_config_hash','get_portal'])test('critical '+method+' read is bounded',async()=>{
 const f=fixture();if(method==='get_portal')f.setBound('0x'+'7'.repeat(40));
 const previous=f.env.aztec.Contract.at;f.env.aztec.Contract.at=async(...args)=>{const contract=await previous(...args);contract.methods[method]=()=>({simulate:()=>new Promise(()=>{})});return contract;};
 f.env.aztec.boundedTransactionRead=(fn)=>boundedTransactionRead(fn,20);
 await assert.rejects(f.run(),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(f.bindings,0);assert.equal(f.destroyed,1);
});
for(const value of [null,undefined,0,'false',{}])test('malformed portal binding boolean '+JSON.stringify(value)+' fails closed',async()=>{const f=fixture(),previous=f.env.aztec.Contract.at;f.env.aztec.Contract.at=async(...args)=>{const contract=await previous(...args);contract.methods.is_portal_set=()=>({simulate:async()=>value});return contract;};await assert.rejects(f.run(),/Malformed portal binding/);assert.equal(f.bindings,0);});
test('preactivation deposit state is bounded and malformed value fails',async()=>{const f=fixture();f.env.aztec.boundedTransactionRead=fn=>boundedTransactionRead(fn,20);f.portal.depositsEnabled=()=>new Promise(()=>{});await assert.rejects(f.run(),{code:'BB_SUBMISSION_UNKNOWN'});f.portal.depositsEnabled=async()=> 'false';await assert.rejects(f.run(),/Malformed portal deposit/);});
