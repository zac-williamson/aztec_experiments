import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
const source=await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const policy=await readFile(new URL('../shared/moderation-policy.js',import.meta.url),'utf8');
function fixture(saved){
 const c=vm.createContext({performance,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(policy,c);vm.runInContext(source,c);
 const address=AztecAddress.fromFieldUnsafe(new Fr(1)),board=new Fr(2).toString(),rollup='0x'+'11'.repeat(20),portal='0x'+'22'.repeat(20);
 const fail=()=>assert.fail('Read-only inspection reached a mutating/proving/PXE operation');let inspected=0;
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1}),getL1ContractAddresses:async()=>({rollupAddress:rollup}),getBlockNumber:async()=>1};
 const a={Fr,AztecAddress,deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({});getImmutablesHash=async()=>Fr.ZERO;},getContractInstanceFromInstantiationParams:async()=>({address}),computePartialAddress:async()=>Fr.ZERO,createAztecNodeClient:()=>node,loadContractArtifact:x=>x,createPXE:fail,preparePrivateFeePayment:fail};
 const ethers={getAddress:x=>x,JsonRpcProvider:class{getCode=async()=>'0x01';getNetwork=async()=>({chainId:31337n});destroy(){}},Contract:class{L2_CONTRACT=async()=>board;L1_CHAIN_ID=async()=>31337n;ROLLUP=async()=>rollup;VERSION=async()=>1n;}};
 const config={action:'declare-immoral',inspectOnly:true,postId:new Fr(3).toString(),expectedPolicyVersion:new Fr(4).toString(),censorResponse:'Spam',aztecWallet:{secretKey:Fr.ONE.toString(),salt:0},portalAddress:portal};
 const packed=c.BillboardModerationCodec.packModerationReason('Spam');
 const operation=JSON.stringify(['declare_immoral',[config.postId,config.expectedPolicyVersion,packed.fields.map(v=>new Fr(v).toString()),String(packed.byteLength)]]);
 const journal={inspect:async()=>{inspected++;return typeof saved==='function'?saved(operation):saved;},assertCanStart:fail,prepare:fail,confirmed:fail,recover:fail,reconcilePrevious:fail,allowReplacement:fail,setOperation:fail};
 const env={aztec:a,ethers,artifact:{},log(){},initCRS:fail,createStore:fail,createTransactionJournal:async()=>journal};
 return {run:()=>c.runBillboardUser(env,config),config,inspected:()=>inspected};
}
test('empty journal returns read-only absent outcome without fee configuration',async()=>{const h=fixture(null),r=await h.run();assert.equal(r.type,'billboard-moderation-journal-v1');assert.equal(r.txHash,null);assert.equal(r.predecessorTxHashes.length,0);assert.equal(h.inspected(),1);});
test('matching exact saved intent returns transaction and predecessors without submission',async()=>{const h=fixture(operation=>({operation,txHash:new Fr(10).toString(),predecessorTxHashes:[new Fr(9).toString()]}));const r=await h.run();assert.equal(r.txHash,new Fr(10).toString());assert.equal(r.predecessorTxHashes[0],new Fr(9).toString());});
for(const change of [op=>op.replace('declare_immoral','withdraw'),op=>op.replace(new Fr(3).toString(),new Fr(5).toString()),op=>op.replace(new Fr(4).toString(),new Fr(5).toString()),op=>op.replace('"4"]','"3"]')])test('different saved operation fails closed',async()=>{const h=fixture(operation=>({operation:change(operation),txHash:new Fr(10).toString()}));await assert.rejects(h.run(),e=>e.code==='BB_RECOVERY_REQUIRED');});
for(const field of ['postId','expectedPolicyVersion','censorResponse'])test('inspection requires exact original '+field,async()=>{const h=fixture(null);delete h.config[field];await assert.rejects(h.run());assert.equal(h.inspected(),0);});
test('CLI inspection branches before PXE cache creation and bypasses fee input reads',async()=>{const cli=await readFile(new URL('../apps/src/billboard/user/cli.mjs',import.meta.url),'utf8');const start=cli.indexOf('  if(config.inspectOnly) {');assert(start>0&&start<cli.indexOf('  let cache;'));assert.match(cli.slice(start,cli.indexOf('  let cache;')),/console.log\(JSON.stringify\(await globalThis.runBillboardUser\(env,config\)\)\);\s+return;/);assert.match(cli,/const privateFee = !args\['inspect-only'\]/);});
