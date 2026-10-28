import {provingEnabledForNode} from '../shared/proving-policy.mjs';
// Complete deploy engine and real encrypted L2 journal; inert SDK/chain fixtures.
// Tests orchestration and interruption boundaries, not cryptographic proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as ethers from 'ethers';
import {loadContractArtifact,encodeArguments,getInitializer} from '@aztec-labs/stdlib/abi';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {TxHash,PendingTxReceipt,DroppedTxReceipt,MinedTxReceipt} from '@aztec-labs/stdlib/tx';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
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
 getTxHash(){return field(BigInt(ethers.sha256(this.toBuffer()))>>8n);}
 static fromBuffer(bytes){return new FixtureTx(...JSON.parse(bytes.toString()));}
}
const rollingRaw=JSON.parse(await readFile(new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8'));
const rollingArtifact=loadContractArtifact(rollingRaw);
function packPolicy(text){const bytes=Buffer.alloc(48*31);Buffer.from(text).copy(bytes);return {fields:Array.from({length:48},(_,i)=>BigInt('0x'+bytes.subarray(i*31,(i+1)*31).toString('hex'))),len:Buffer.byteLength(text)};}
function fixture({rolling=true,lostBinding=false,lostDeploy=false,existing=true,staleDeploy=false,staleBinding=false}={}) {
 const actor=AztecAddress.fromFieldUnsafe(new Fr(1)),board=AztecAddress.fromFieldUnsafe(new Fr(2)),privateFee=AztecAddress.fromFieldUnsafe(new Fr(13));
 const privateFeeArtifact={fixture:'trusted release FPC'};
 const inbox='0x'+'6'.repeat(40),outbox='0x'+'7'.repeat(40);
 const rollup='0x'+'3'.repeat(40),sender='0x'+'4'.repeat(40),blockHash=field(5);
 const instance={address:actor,currentContractClassId:field(12),originalContractClassId:field(12)};
 const boardInstance={...instance,address:board,deployer:actor},deploymentCalls=[];
 const policy=packPolicy('Be kind.'),policyDigest=rolling?poseidon2HashWithSeparator([BigInt(policy.len),...policy.fields.slice(0,32)],0x52435431):null;
 const storage=createBrowserJournalStorage(new IDBFactory()),receipts=new Map(),invalids=new Set();let proofId=0;
 let bound=null,stops=0,deploys=0,bindings=0,activations=0,enabled=false;
 const ethereumTransactions=new Map(),ethereumReceipts=new Map();
 const wordHash=(label,words)=>'0x'+(BigInt(ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32',...words.map(()=> 'uint256')],[ethers.encodeBytes32String(label),...words])))>>8n).toString(16).padStart(64,'0');
 const configHash=wordHash('AZTEC_BB_CONFIG_V1',[1n,31337n,BigInt(rollup),2n,5n,1n,100n,10n,64n,10n,16n]);
 const node={getNodeInfo:async()=>({realProofs:false,l1ChainId:31337,rollupVersion:5}),getL1ContractAddresses:async()=>({rollupAddress:rollup,inboxAddress:inbox,outboxAddress:outbox}),
  getBlockNumber:async()=>1,getPublicStorageAt:async()=>new Fr(0),getContract:async()=>existing?(rolling?boardInstance:instance):undefined,
  getTxReceipt:async hash=>{const value=receipts.get(String(hash));if(!value)return value;const txHash=TxHash.fromString(String(value.txHash));return value.status==='pending'?new PendingTxReceipt(txHash):value.status==='dropped'?new DroppedTxReceipt(txHash):new MinedTxReceipt(txHash,value.status,value.executionResult,0n,BlockHash.fromString(value.blockHash),value.blockNumber,1,0,1);},getBlock:async()=>({hash:blockHash}),getL2ToL1MembershipWitness:async()=>assert.fail('Testnet activation must not request an Outbox witness'),
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
  poseidon2HashWithSeparator,computeContractAddressFromInstance:async()=>board,
  derivePrivateFeeInstance:async artifact=>{assert.equal(artifact,privateFeeArtifact);return {address:privateFee};},
  deriveSigningKey:()=>({}),deriveKeys:async()=>({publicKeys:{}}),computePartialAddress:async()=>new Fr(1),
  getContractClassFromArtifact:async()=>({id:field(12)}),getContractInstanceFromInstantiationParams:async()=>instance,deriveStorageSlotInMap:async()=>new Fr(1),
  SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>field(0);getSigningPublicKey=async()=>({});},
  createAztecNodeClient:()=>node,createPXE:async()=>pxe,AccountManager:{create:async()=>({})},loadContractArtifact:x=>x===rollingRaw?rollingArtifact:x,createEthereumJournal,
  sha256ToField:()=>new Fr(7),Contract:{
   deploy:(wallet,artifact,args,initializer,options)=>{deploymentCalls.push({artifact,args,initializer,options});return {getAddress:async()=>board,getInstance:async()=>rolling?boardInstance:instance,send:async()=>{deploys++;return submit(wallet,'deploy',lostDeploy);}};},
   at:async(_address,_artifact,wallet)=>({methods:{
    get_censor:()=>({simulate:async()=>BigInt(actor.toString())}),get_policy_version:()=>({simulate:async()=>BigInt(await deploymentPolicyVersion(board.toString(),'Be kind.'))}),
    get_portal:()=>({simulate:async()=>BigInt(bound||0)}),is_portal_set:()=>({simulate:async()=>bound!==null}),get_config_hash:()=>({simulate:async()=>BigInt(configHash)}),
    update_portal:address=>({send:async()=>{bindings++;return submit(wallet,'bind:'+address.toString().toLowerCase(),lostBinding);}}),
   }}),
  }};
 const runtimeValues={L2_CONTRACT:board.toString(),ROLLUP:rollup,VERSION:5n,L1_CHAIN_ID:31337n,MIN_DEPOSIT:1n,MAX_DEPOSIT:100n,CONFIG_HASH:configHash,INBOX:inbox,OUTBOX:outbox,DEPLOYMENT_OPERATOR:sender};
 let destroyed=0;const provider={destroy(){destroyed++;},getBlock:async number=>({number:number==='latest'?1+activations:number,hash:blockHash}),getBlockNumber:async()=>1+activations,getTransactionCount:async()=>activations,getTransaction:async hash=>ethereumTransactions.get(hash)??null,getTransactionReceipt:async hash=>ethereumReceipts.get(hash)??null,getNetwork:async()=>({chainId:31337n}),getCode:async address=>address.toLowerCase()===create2Proxy?create2Runtime:[rollup,inbox,outbox].includes(address.toLowerCase())?'0x6000':expectedPortalRuntime(runtimeMetadata,runtimeValues)};
 const portal={getInbox:async()=>inbox,getOutbox:async()=>outbox,INBOX:async()=>inbox,OUTBOX:async()=>outbox,L2_CONTRACT:async()=>board.toString(),ROLLUP:async()=>rollup,VERSION:async()=>5n,L1_CHAIN_ID:async()=>31337n,MIN_DEPOSIT:async()=>1n,MAX_DEPOSIT:async()=>100n,CONFIG_HASH:async()=>configHash,DEPLOYMENT_OPERATOR:async()=>sender,depositsEnabled:async()=>enabled};
 const activationInterface=new ethers.Interface(['function activate()','event Activated(bytes32 indexed configHash)']);
 portal.activate={staticCall:async(...args)=>{assert.equal(args.length,1);assert.equal(args[0].from,sender);assert.notEqual(bound,null);assert.equal(enabled,false);}};
 const signer={provider,getAddress:async()=>sender,sendTransaction:async request=>{
  assert.equal(request.to,bound);assert.equal(request.data,activationInterface.encodeFunctionData('activate'));assert.equal(BigInt(request.value),0n);assert.equal(request.nonce,activations);assert.equal(enabled,false);
  const hash=field(1000+activations),event=activationInterface.encodeEventLog(activationInterface.getEvent('Activated'),[configHash]);
  ethereumTransactions.set(hash,{...request,hash,from:sender,chainId:31337n});
  ethereumReceipts.set(hash,{hash,from:sender,to:request.to,status:1,blockNumber:2+activations,blockHash,logs:[{address:request.to,topics:event.topics,data:event.data}]});
  activations++;enabled=true;return {hash};
 }};
 const env={aztec:a,ethers:{...ethers,JsonRpcProvider:class{constructor(){return provider;}},Contract:class{constructor(){return portal;}}},log(){},pause(){throw new Error('unexpected pause');},initCRS:async()=>{},createStore:async()=>({}),artifact:rolling?rollingRaw:{},privateFeeArtifact,portalBytecode:'0x6000',
  getBrowserSigner:async()=>signer,createJournalStorage:()=>storage,
  createTransactionJournal:options=>createL2Journal({...options,storage,waitOptions:{timeoutMs:20,intervalMs:1}})};
 const hash=o=>ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(o)));
 const manifest={schemaVersion:1,profile:'local-test',network:{nodeUrl:'http://localhost:8080/',ethRpcUrl:'http://localhost:8545/',chainId:'31337',rollupVersion:'5',rollup,inbox,outbox},actors:{aztecDeployer:actor.toString(),ethereumDeployer:sender},board:{salt:'1',minDeposit:'1',maxDeposit:'100',baseCooldown:'10',kMultiplier:'64',censorWindow:'10',maxSaveUp:'16',censor:actor.toString(),policy:'Be kind.'},artifacts:{boardJsonSha256:hash(env.artifact),boardClassId:field(12),portalCreationSha256:ethers.sha256(env.portalBytecode),portalRuntimeMetadataSha256:hash(runtimeMetadata)}};
 if(rolling){manifest.schemaVersion=2;delete manifest.board.censor;manifest.board.kind='rolling';
  node.getBlockData=async()=>({blockHash,header:{globalVariables:{blockNumber:1}}});
  node.getPublicStorageAt=async(reference,_board,slot)=>{if(reference==='latest')return Fr.ZERO;assert.equal(reference.hash,blockHash);const n=BigInt(slot.toString()),layout=rollingArtifact.storageLayout;
   if(n===BigInt(layout.portal_address.slot))return new Fr(BigInt(bound||0));
   const cfg=[31337n,BigInt(rollup),5n,1n,100n,10n,64n,10n,16n,BigInt(actor.toString())],base=BigInt(layout.config.slot);
   if(n>=base&&n<base+10n)return new Fr(cfg[Number(n-base)]);
   if(n===BigInt(layout.moderator.slot))return new Fr(BigInt(actor.toString()));
   if(n===BigInt(layout.main_version.slot))return new Fr(1);
   if(n===BigInt(layout.private_fee.slot))return privateFee.toField();
   if(n===BigInt(layout.main_rules.slot))return await policyDigest;throw Error('Unexpected storage read');};
  const previous=a.Contract.at;a.Contract.at=async(...args)=>{const c=await previous(...args);for(const key of Object.keys(c.methods))if(key!=='update_portal')delete c.methods[key];return c;};
 }
 const config={...deploymentManifestConfig(manifest),aztecWallet:{secretKey:field(8),salt:field(9)}};
 function run(extra={}){const context=vm.createContext({setTimeout,clearTimeout,Buffer,packStringToFields:()=>rolling?packPolicy('Be kind.'):{fields:Array(48).fill(0n),len:0}});vm.runInContext(source,context);return context.runDeploy(env,{...config,...extra});}
 return {run,env,node,provider,portal,manifest,config,runtimeValues,receipts,deploymentCalls,get destroyed(){return destroyed;},setBound:value=>bound=value,get stops(){return stops;},get deploys(){return deploys;},get bindings(){return bindings;},get activations(){return activations;},clearLoss(){lostBinding=false;lostDeploy=false;staleDeploy=false;staleBinding=false;}};
}
test('lost binding response resumes from encrypted transaction without supplied hash or another binding',async()=>{
 const f=fixture({lostBinding:true});await assert.rejects(f.run(),/synthetic lost/);assert.equal(f.stops,1);f.clearLoss();
 const result=await f.run();assert.equal(result.status,'active');assert.equal(f.activations,1);assert.match(result.readyTxHash,/^0x[0-9a-f]{64}$/);assert.equal(f.bindings,1);assert.equal(f.deploys,0);assert.equal(f.stops,2);
 assert.equal((await f.run()).readyTxHash,result.readyTxHash);assert.equal(f.bindings,1);assert.equal(f.activations,1);
 await assert.rejects(f.run({readyTxHash:field(999)}),/differs from the saved/);assert.equal(f.bindings,1);
});
test('lost board deployment response resumes original transaction and deploys the board only once',async()=>{
 const f=fixture({existing:false,lostDeploy:true});await assert.rejects(f.run(),/synthetic lost/);assert.equal(f.deploys,1);f.clearLoss();
 const result=await f.run();assert.equal(result.status,'active');assert.equal(f.activations,1);assert.equal(f.deploys,1);assert.equal(f.bindings,1);assert.equal(f.stops,2);
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

for(const kind of ['deploy','binding'])test(`definitively stale ${kind} proof cannot silently regenerate a Rolling operation`,async()=>{
 const f=fixture(kind==='deploy'?{existing:false,staleDeploy:true}:{staleBinding:true});
 await assert.rejects(f.run(),/synthetic stale proof/);const original=[...f.receipts.keys()][0];f.clearLoss();
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});
 assert.equal(f.deploys,kind==='deploy'?1:0);assert.equal(f.bindings,kind==='binding'?1:0);
 assert.equal(f.receipts.get(original).status,'dropped');assert.equal(f.receipts.size,1);
});
test('stale binding cannot silently accept another binding that appeared meanwhile',async()=>{
 const f=fixture({staleBinding:true});await assert.rejects(f.run(),/synthetic stale proof/);f.clearLoss();f.setBound('0x'+'a'.repeat(40));
 await assert.rejects(f.run(),/Portal awaits checkpointed binding/);assert.equal(f.bindings,1);assert.equal(f.deploys,0);
});
test('stale binding cannot redeploy a missing original Ethereum portal',async()=>{
 const f=fixture({staleBinding:true});await assert.rejects(f.run(),/synthetic stale proof/);f.clearLoss();const previous=f.provider.getCode;f.provider.getCode=async address=>[create2Proxy,f.manifest.network.rollup,f.manifest.network.inbox,f.manifest.network.outbox].includes(address.toLowerCase())?previous(address):'0x';
 let creationAttempts=0;const open=f.env.aztec.createEthereumJournal;
 f.env.aztec.createEthereumJournal=async options=>{const journal=await open(options);return {...journal,send(){creationAttempts++;assert.fail('Saved unresolved binding must be checked before a new Ethereum creation');}};};
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.bindings,1);assert.equal(f.deploys,0);assert.equal(creationAttempts,0);
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
 if(kind==='artifact')f.env.artifact={...f.env.artifact,changed:true};
 if(kind.endsWith('actor'))extra.deploymentManifest=f.manifest;
 const expected={'missing manifest':{code:'BB_DEPLOYMENT_UNSUPPORTED'},'Aztec actor':/Aztec deployer differs/,'Ethereum actor':/Ethereum deployer differs/,chain:/network identity mismatch/,bridge:/bridge\/code mismatch/,artifact:/artifact identity mismatch/}[kind];
 await assert.rejects(f.run(extra),expected);assert.equal(f.deploys,0);assert.equal(f.bindings,0);assert.equal(f.stops,0);
});
for(const kind of ['runtime','inbox','outbox','deployment operator','policy','moderator'])test(`existing deployment rejects ${kind} mismatch before binding`,async()=>{
 const f=fixture();
 if(kind==='runtime'){const original=f.provider.getCode;f.provider.getCode=async address=>{const code=await original(address);return address.toLowerCase()===create2Proxy||code==='0x6000'?code:code+'00';};}
 if(kind==='inbox')f.portal.INBOX=async()=> '0x'+'a'.repeat(40);
 if(kind==='outbox')f.portal.OUTBOX=async()=> '0x'+'a'.repeat(40);
 if(kind==='deployment operator')f.portal.DEPLOYMENT_OPERATOR=async()=> '0x'+'a'.repeat(40);
 if(kind==='policy'||kind==='moderator'){const original=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout[kind==='policy'?'main_rules':'moderator'].slot);f.node.getPublicStorageAt=async(reference,board,slot)=>reference!=='latest'&&BigInt(slot.toString())===target?new Fr(99):original(reference,board,slot);}
 await assert.rejects(f.run(),kind==='runtime'?/runtime does not match/:['policy','moderator'].includes(kind)?/Rolling deployment state differs/:/Portal configuration mismatch/);assert.equal(f.deploys,0);assert.equal(f.bindings,0);assert.equal(f.stops,1);
});

test('owned preflight provider is disposed even before wallet/PXE startup',async()=>{const f=fixture();f.node.getNodeInfo=async()=>{throw Error('offline');};await assert.rejects(f.run(),/offline/);assert.equal(f.destroyed,1);assert.equal(f.stops,0);});
test('external browser provider is not disposed',async()=>{const f=fixture();let owned=0;f.env.ethers.JsonRpcProvider=class{constructor(){return {...f.provider,destroy(){owned++;}};}};await f.run();assert.equal(owned,1);assert.equal(f.destroyed,0);});
for(const key of ['originalContractClassId','currentContractClassId'])test('deployed '+key+' mismatch blocks binding',async()=>{const f=fixture();const previous=f.node.getContract;f.node.getContract=async()=>({...await previous(),[key]:field(99)});await assert.rejects(f.run(),/class|Class|Rolling deployment state differs/);assert.equal(f.bindings,0);assert.equal(f.destroyed,1);});
for(const read of ['checkpoint','config','portal_address'])test('critical Rolling '+read+' read is bounded',async()=>{
 const f=fixture();
 if(read==='checkpoint')f.node.getBlockData=()=>new Promise(()=>{});
 else {const previous=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout[read].slot);f.node.getPublicStorageAt=(reference,board,slot)=>reference!=='latest'&&BigInt(slot.toString())===target?new Promise(()=>{}):previous(reference,board,slot);}
 f.env.aztec.boundedTransactionRead=fn=>boundedTransactionRead(fn,20);
 await assert.rejects(f.run(),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(f.bindings,0);assert.equal(f.destroyed,1);
});
for(const value of [null,undefined,'false',{},1n<<160n])test('malformed Rolling portal storage '+String(value)+' fails closed',async()=>{
 const f=fixture(),previous=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout.portal_address.slot);
 f.node.getPublicStorageAt=(reference,board,slot)=>reference!=='latest'&&BigInt(slot.toString())===target?value:previous(reference,board,slot);
 await assert.rejects(f.run());assert.equal(f.bindings,0);assert.equal(f.deploys,0);assert.equal(f.destroyed,1);
});
test('preactivation deposit state is bounded and malformed value fails',async()=>{const f=fixture();f.env.aztec.boundedTransactionRead=fn=>boundedTransactionRead(fn,20);f.portal.depositsEnabled=()=>new Promise(()=>{});await assert.rejects(f.run(),{code:'BB_SUBMISSION_UNKNOWN'});f.portal.depositsEnabled=async()=> 'false';await assert.rejects(f.run(),/Malformed portal deposit/);});

test('deployment initialization exposes typed preparation and synchronization progress',async()=>{
 const f=fixture(),stages=[];f.env.progress=stage=>stages.push(stage);await f.run();assert.deepEqual(stages,['preparing','syncing']);
});

for(const loss of ['none','binding','deployment'])test('Rolling actual ABI profile and encrypted recovery: '+loss,async()=>{
 const f=fixture({rolling:true,existing:loss!=='deployment',lostBinding:loss==='binding',lostDeploy:loss==='deployment'});
 if(loss!=='none'){await assert.rejects(f.run(),/synthetic lost/);f.clearLoss();}
 const r=await f.run();assert.equal(r.status,'active');assert.equal(f.activations,1);assert.equal(f.bindings,1);assert.equal(f.deploys,loss==='deployment'?1:0);
 const call=f.deploymentCalls[0];assert.equal(call.initializer,'init');assert.equal(call.args.length,12);assert.equal(call.args[11].toString(),field(13));assert.equal(call.args[0].length,32);assert.equal(call.options.deployer.toString(),f.manifest.actors.aztecDeployer);assert.equal(call.options.universalDeploy,undefined);
 const abi=getInitializer(rollingArtifact,'init');assert.equal(encodeArguments(abi,call.args).length,43);
 const again=await f.run();assert.equal(again.readyTxHash,r.readyTxHash);assert.equal(f.bindings,1);
});
for(const fieldName of ['moderator','main_rules','main_version','config','portal_address','private_fee'])test('Rolling canonical '+fieldName+' mismatch blocks portal binding',async()=>{
 const f=fixture({rolling:true}),before=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout[fieldName].slot);
 f.node.getPublicStorageAt=async(reference,board,slot)=>reference!=='latest'&&BigInt(slot.toString())===target?new Fr(fieldName==='portal_address'?1n<<160n:99n):before(reference,board,slot);
 await assert.rejects(f.run(),/Rolling deployment state differs/);assert.equal(f.bindings,0);
});
for(const kind of ['deployer','address','canonical-hash','checkpoint-height'])test('Rolling '+kind+' mismatch cannot authorize portal binding',async()=>{
 const f=fixture({rolling:true}),original=f.node.getContract;
 if(kind==='deployer'||kind==='address')f.node.getContract=async(...args)=>({...await original(...args),[kind]:AztecAddress.fromFieldUnsafe(new Fr(99))});
 else if(kind==='canonical-hash')f.node.getBlockData=async reference=>({blockHash:field(reference==='checkpointed'?5:6),header:{globalVariables:{blockNumber:1}}});
 else f.node.getBlockData=async()=>({blockHash:field(5),header:{globalVariables:{blockNumber:0}}});
 await assert.rejects(f.run(),/Rolling deployment state differs/);assert.equal(f.bindings,0);
});

test('Rolling bound deployment resumes after an authorized main policy update without another transaction',async()=>{
 const f=fixture({rolling:true});const first=await f.run(),before=f.node.getPublicStorageAt;
 const version=BigInt(rollingArtifact.storageLayout.main_version.slot),rules=BigInt(rollingArtifact.storageLayout.main_rules.slot);
 f.node.getPublicStorageAt=async(reference,board,slot)=>{
  const n=BigInt(slot.toString());return n===version?new Fr(2):n===rules?new Fr(99):before(reference,board,slot);
 };
 f.node.sendTx=async()=>assert.fail('A policy update cannot authorize another deployment or binding');
 const resumed=await f.run();assert.equal(resumed.readyTxHash,first.readyTxHash);assert.equal(f.deploys,0);assert.equal(f.bindings,1);
});
for(const value of [0n,1n<<32n])test('Rolling bound deployment rejects invalid main policy version '+value,async()=>{
 const f=fixture({rolling:true});await f.run();const before=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout.main_version.slot);
 f.node.getPublicStorageAt=async(reference,board,slot)=>BigInt(slot.toString())===target?new Fr(value):before(reference,board,slot);
 f.node.sendTx=async()=>assert.fail('Invalid state cannot send');
 await assert.rejects(f.run(),/Rolling deployment state differs/);assert.equal(f.bindings,1);
});
test('Rolling bound initial policy still must match the deployment manifest',async()=>{
 const f=fixture({rolling:true});await f.run();const before=f.node.getPublicStorageAt,target=BigInt(rollingArtifact.storageLayout.main_rules.slot);
 f.node.getPublicStorageAt=async(reference,board,slot)=>BigInt(slot.toString())===target?new Fr(99):before(reference,board,slot);
 await assert.rejects(f.run(),/Rolling deployment state differs/);assert.equal(f.bindings,1);
});

test('Rolling raw NodeInfo without alias uses nativefalse PXE and never prepares CRS',async()=>{const f=fixture({rolling:true});let created=0;f.env.initCRS=async()=>assert.fail('Disabled development must not prepare CRS');const original=f.env.aztec.createPXE;f.env.aztec.createPXE=async(node,config,...rest)=>{created++;assert.equal(config.proverEnabled,false);return original(node,config,...rest);};await f.run();assert.equal(created,1);});
test('Rolling local native real proofs fail before PXE or deployment',async()=>{const f=fixture({rolling:true});f.node.getNodeInfo=async()=>({realProofs:true,l1ChainId:31337,rollupVersion:5});f.env.aztec.createPXE=async()=>assert.fail('No PXE');await assert.rejects(f.run(),{code:'BB_DEPLOYMENT_MANIFEST'});assert.equal(f.deploymentCalls.length,0);});
test('Rolling restart never resends dropped valid original deployment',async()=>{const f=fixture({rolling:true,existing:false,lostDeploy:true});await assert.rejects(f.run(),/synthetic lost/);f.clearLoss();for(const [hash,r]of f.receipts)f.receipts.set(hash,{...r,status:'dropped'});let sends=0;f.node.sendTx=async()=>{sends++;assert.fail('Reconciliation cannot send');};await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(sends,0);assert.equal(f.deploys,1);assert.equal(f.bindings,0);});
test('Rolling restart does not silently replace a stale rejected deployment',async()=>{const f=fixture({rolling:true,existing:false,staleDeploy:true});await assert.rejects(f.run(),/synthetic stale/);f.clearLoss();await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(f.deploys,1);assert.equal(f.bindings,0);});

test('old SDK preflight without explicit native proof mode fails before wallet or PXE',async()=>{const f=fixture({rolling:true}),original=f.env.aztec.preflightDeploymentNetwork;f.env.aztec.preflightDeploymentNetwork=async(...args)=>{const result=await original(...args);delete result.proofsEnabled;return result;};f.env.aztec.createPXE=async()=>assert.fail('No PXE');await assert.rejects(f.run(),/Verified native proof configuration/);assert.equal(f.deploymentCalls.length,0);});

test('Rolling creation anchor survives distinct portal journal and repeat deployment command',async()=>{
 const f=fixture({rolling:true,existing:false});const first=await f.run();assert.equal(first.status,'active');assert.equal(f.activations,1);
 const creation=[...f.receipts].find(([hash])=>hash!==first.readyTxHash);assert(creation);
 assert.deepEqual(JSON.parse(JSON.stringify(first.boardDeployment)),{txHash:creation[0],blockNumber:creation[1].blockNumber,blockHash:creation[1].blockHash});
 const second=await f.run();assert.deepEqual(JSON.parse(JSON.stringify(second.boardDeployment)),JSON.parse(JSON.stringify(first.boardDeployment)));assert.equal(second.readyTxHash,first.readyTxHash);assert.equal(f.deploys,1);assert.equal(f.bindings,1);assert.equal(f.activations,1);
});
test('Rolling missing historical creation receipt remains explicit and never inferred from binding',async()=>{
 const f=fixture({rolling:true});const first=await f.run();assert.equal(first.boardDeployment,null);const second=await f.run();assert.equal(second.boardDeployment,null);assert.equal(f.deploys,0);assert.equal(f.bindings,1);
});
test('Rolling recovered original creation reorg refuses before another binding',async()=>{
 const f=fixture({rolling:true,existing:false});const first=await f.run();const r=f.receipts.get(first.boardDeployment.txHash);f.receipts.set(first.boardDeployment.txHash,{...r,blockHash:field(900)});
 await assert.rejects(f.run());assert.equal(f.deploys,1);assert.equal(f.bindings,1);
});
test('Rolling anchor reader guards original receipt twice and rejects terminal failure',async()=>{
 const context=vm.createContext({});vm.runInContext(source,context);const readAnchor=context.BillboardDeployRolling.readBoardDeploymentAnchor;
 const receipt={txHash:field(1),blockNumber:1,blockHash:field(2),status:'checkpointed',executionResult:'success'};let guards=0,reads=0;
 const node={getTxReceipt:async()=>{reads++;return receipt;},getBlock:async()=>({hash:field(2)})};
 await readAnchor({node,receipt,read:fn=>fn(),contextGuard:async()=>{guards++;}});assert.equal(guards,2);assert.equal(reads,2);
 node.getTxReceipt=async()=>({...receipt,executionResult:'reverted'});await assert.rejects(readAnchor({node,receipt,read:fn=>fn()}),/unavailable/);
});

test('deployment provider observes changed code immediately without weakening runtime verification',async()=>{
 const f=fixture();let options;
 f.env.ethers.JsonRpcProvider=class{constructor(_url,_network,value){options=value;return f.provider;}};
 const stop=Error('focused provider construction');f.env.aztec.preflightDeploymentNetwork=async()=>{throw stop;};
 await assert.rejects(f.run(),error=>error===stop);assert.equal(options.cacheTimeout,-1);
 // Actual installed Ethers cache; only its transport result is a labelled fixture.
 class CodeProvider extends ethers.JsonRpcProvider {
  code='0x';reads=0;
  async _perform(request){assert.equal(request.method,'getCode');this.reads++;return this.code;}
 }
 const address='0x'+'1'.repeat(40),runtime=expectedPortalRuntime(runtimeMetadata,f.runtimeValues);
 for(const [cacheTimeout,expectedReads]of [[250,1],[options.cacheTimeout,2]]){
  const provider=new CodeProvider('http://127.0.0.1:1',31337,{staticNetwork:true,cacheTimeout});
  try{assert.equal(await provider.getCode(address),'0x');provider.code=runtime;const observed=await provider.getCode(address);
   assert.equal(provider.reads,expectedReads);
   if(cacheTimeout===250)assert.throws(()=>verifyPortalRuntime(observed,runtimeMetadata,f.runtimeValues),/does not match/);
   else assert.equal(verifyPortalRuntime(observed,runtimeMetadata,f.runtimeValues),true);
  }finally{provider.destroy();}
 }
});


test('legacy engine deployment rejects before environment, wallet, or proving access',async()=>{
 const context=vm.createContext({});vm.runInContext(source,context);
 const forbidden=new Proxy({}, {get(){assert.fail('Unsupported deployment must not read environment or keys');}});
 for(const deploymentManifest of [{schemaVersion:1,board:{}},{schemaVersion:2,board:{kind:'billboard'}}])
  await assert.rejects(context.runDeploy(forbidden,{deploymentManifest}),{code:'BB_DEPLOYMENT_UNSUPPORTED'});
});


test('saved canonical binding cannot authorize recreation of a missing portal',async()=>{
 const f=fixture();await f.run();f.setBound(null);
 const previous=f.provider.getCode;f.provider.getCode=async address=>[create2Proxy,f.manifest.network.rollup,f.manifest.network.inbox,f.manifest.network.outbox].includes(address.toLowerCase())?previous(address):'0x';
 let creationAttempts=0;const open=f.env.aztec.createEthereumJournal;
 f.env.aztec.createEthereumJournal=async options=>{const journal=await open(options);return {...journal,send(){creationAttempts++;assert.fail('Saved canonical binding cannot authorize a second portal creation');}};};
 await assert.rejects(f.run(),{code:'BB_RECOVERY_REQUIRED'});assert.equal(creationAttempts,0);assert.equal(f.bindings,1);assert.equal(f.deploys,0);
});

test('canonical FPC derivation failure stops before wallet registration or deployment',async()=>{
 const f=fixture();f.env.aztec.derivePrivateFeeInstance=async()=>{throw Error('Invalid release FPC');};
 f.env.aztec.createPXE=async()=>assert.fail('No PXE for rejected FPC');
 await assert.rejects(f.run(),/Invalid release FPC/);assert.equal(f.deploymentCalls.length,0);assert.equal(f.bindings,0);assert.equal(f.activations,0);
});
