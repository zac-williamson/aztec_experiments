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
const source=await readFile(new URL('../apps/src/billboard/deploy/engine.js',import.meta.url),'utf8');
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
class FixtureTx {
 constructor(kind){this.kind=kind;}
 toBuffer(){return Buffer.from(this.kind);}
 getTxHash(){return ethers.sha256(this.toBuffer());}
 static fromBuffer(bytes){return new FixtureTx(bytes.toString());}
}
function fixture({lostBinding=false,lostDeploy=false,existing=true}={}) {
 const actor=AztecAddress.fromFieldUnsafe(new Fr(1)),board=AztecAddress.fromFieldUnsafe(new Fr(2));
 const rollup='0x'+'3'.repeat(40),sender='0x'+'4'.repeat(40),blockHash=field(5);
 const instance={address:actor,currentContractClassId:'class'};
 const storage=createBrowserJournalStorage(new IDBFactory()),receipts=new Map();
 let bound=null,stops=0,deploys=0,bindings=0,finalized=0;
 const wordHash=(label,words)=>'0x'+(BigInt(ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32',...words.map(()=> 'uint256')],[ethers.encodeBytes32String(label),...words])))>>8n).toString(16).padStart(64,'0');
 const configHash=wordHash('AZTEC_BB_CONFIG_V1',[1n,31337n,BigInt(rollup),2n,5n,1n,100n,10n,64n,10n,16n]);
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),
  getBlockNumber:async()=>1,getPublicStorageAt:async()=>new Fr(0),getContract:async()=>existing?instance:undefined,
  getTxReceipt:async hash=>receipts.get(String(hash)),getBlock:async()=>({hash:blockHash}),getChainTips:async()=>({finalized:{block:{number:finalized}}}),
  sendTx:async tx=>{if(tx.kind==='deploy'){existing=true;}else {bound=tx.kind.slice(5);}
   receipts.set(tx.getTxHash(),{txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash});},
  isValidTx:async()=>({result:'valid'})};
 const pxe={registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},stop:async()=>{stops++;}};
 async function submit(wallet,kind,lose){
  const journal=wallet._transactionJournal,previous=await journal.assertCanStart(),tx=new FixtureTx(kind);
  await journal.prepare(tx,previous);await node.sendTx(tx);
  if(lose)throw new Error('synthetic lost response');
  const receipt=await node.getTxReceipt(tx.getTxHash());journal.confirmed(receipt);return{receipt};
 }
 const a={Fr,AztecAddress,EthAddress,Tx:FixtureTx,TxHash:{fromString:x=>x},BaseWallet:class{},
  deriveSigningKey:()=>({}),deriveKeys:async()=>({publicKeys:{}}),computePartialAddress:async()=>new Fr(1),
  getContractInstanceFromInstantiationParams:async()=>instance,deriveStorageSlotInMap:async()=>new Fr(1),
  SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>field(0);getSigningPublicKey=async()=>({});},
  createAztecNodeClient:()=>node,createPXE:async()=>pxe,AccountManager:{create:async()=>({})},loadContractArtifact:x=>x,createEthereumJournal,
  sha256ToField:()=>new Fr(7),Contract:{
   deploy:wallet=>({getAddress:async()=>board,getInstance:async()=>instance,send:async()=>{deploys++;return submit(wallet,'deploy',lostDeploy);}}),
   at:async(_address,_artifact,wallet)=>({methods:{
    get_portal:()=>({simulate:async()=>BigInt(bound||0)}),is_portal_set:()=>({simulate:async()=>bound!==null}),get_config_hash:()=>({simulate:async()=>BigInt(configHash)}),
    update_portal:address=>({send:async()=>{bindings++;return submit(wallet,'bind:'+address.toString().toLowerCase(),lostBinding);}}),
   }}),
  }};
 const provider={getNetwork:async()=>({chainId:31337n}),getCode:async()=> '0x6000'};
 const portal={L2_CONTRACT:async()=>board.toString(),ROLLUP:async()=>rollup,VERSION:async()=>5n,L1_CHAIN_ID:async()=>31337n,MIN_DEPOSIT:async()=>1n,MAX_DEPOSIT:async()=>100n,CONFIG_HASH:async()=>configHash,depositsEnabled:async()=>false};
 const env={aztec:a,ethers:{...ethers,Contract:class{constructor(){return portal;}}},log(){},pause(){throw new Error('unexpected pause');},initCRS:async()=>{},createStore:async()=>({}),artifact:{},portalBytecode:'0x6000',
  getBrowserSigner:async()=>({provider,getAddress:async()=>sender}),createJournalStorage:()=>storage,
  createTransactionJournal:options=>createL2Journal({...options,storage,waitOptions:{timeoutMs:20,intervalMs:1}})};
 const config={aztecWallet:{secretKey:field(8),salt:field(9)},contractSalt:1,censor:actor.toString(),minDepositWei:1n,maxDepositWei:100n,baseCooldown:10,censorWindow:10,moderationPolicy:''};
 function run(extra={}){const context=vm.createContext({setTimeout,clearTimeout,Buffer,packStringToFields:()=>({fields:Array(48).fill(0n),len:0})});vm.runInContext(source,context);return context.runDeploy(env,{...config,...extra});}
 return {run,env,node,receipts,get stops(){return stops;},get deploys(){return deploys;},get bindings(){return bindings;},clearLoss(){lostBinding=false;lostDeploy=false;}};
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
