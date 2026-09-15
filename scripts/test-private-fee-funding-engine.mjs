// Actual browser funding engine; wallet/prover/chain are explicit doubles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Fr} from '@aztec/foundation/curves/bn254';
const source=fs.readFileSync(new URL('../apps/src/fee-juice/engine.js',import.meta.url),'utf8');
function harness(){
 const calls=[],owner={toString:()=> 'owner'},payer={toString:()=> 'shared'},wallet={},claim={amount:'100',salt:'private-salt',secret:'private-secret',leafIndex:'1'};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5}),getL1ContractAddresses:async()=>({rollupAddress:'rollup'})};
 const pxe={registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},stop:async()=>calls.push('stop')};
 const context=vm.createContext({BillboardPrivateFeeRouting:{createAztecWallet:()=>wallet}});vm.runInContext(source,context);
 const a={Fr,GasSettings:{from:()=>({getFeeLimit:()=>new Fr(10)})},deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
  SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>Fr.ZERO;},
  getContractInstanceFromInstantiationParams:async()=>({address:owner}),derivePrivateFeeAddress:async()=>payer,createAztecNodeClient:()=>node,
  computePartialAddress:async()=>Fr.ONE,createPXE:async()=>pxe,AccountManager:{create:async()=>({address:owner})},
  recoverPrivateFeeClaim:async input=>{calls.push(['recover',input]);return claim;},
  preparePrivateFeePayment:async input=>{calls.push(['prepare',input]);return {paymentMethod:'private',gasSettings:{}};},
  BatchCall:class{constructor(w,actions){assert.equal(w,wallet);assert.equal(actions.length,0);}send=async opts=>{calls.push(['send',opts]);return {receipt:{status:'checkpointed'}};}}
 };
 const env={aztec:a,privateFeeArtifact:{},log:message=>calls.push(['log',message]),initCRS:async()=>{},createStore:async()=>({}),getBrowserSigner:async()=>({provider:{}}),ethers:{parseUnits:()=>100n},
 fundPrivateFees:async input=>{calls.push(['fund',input]);const record={nonce:'1'};await input.saveRecovery(record);return record;}};
 const config={aztecWallet:{secretKey:Fr.ONE.toString(),salt:0},privateFee:{contractAddress:'shared',gasSettings:{}},fundingRecord:{nonce:'1'},saveRecovery:async record=>calls.push(['save',record]),depositAmount:'0.1'};
 return {calls,owner,claim,a,run:action=>context.runFeeJuiceFlow(env,{...config,action})};
}
test('funding deposits to shared address and passes mandatory recovery callback',async()=>{
 const h=harness();const result=await h.run('deposit');assert.equal(result.record.nonce,'1');
 const fund=h.calls.find(c=>c[0]==='fund')[1];assert.equal(fund.privateFeeAddress.toString(),'shared');assert.equal(fund.owner,h.owner);
 assert.equal(fund.expectedChainId,'31337');assert.equal(fund.expectedVersion,'5');assert(h.calls.some(c=>c[0]==='save'));
});
test('standalone claim uses standard author entrypoint with only private fee payload, then stops PXE',async()=>{
 const h=harness();await h.run('claim');const preparation=h.calls.find(c=>c[0]==='prepare')[1];assert.equal(preparation.claim,h.claim);
 const send=h.calls.find(c=>c[0]==='send')[1];assert.equal(send.from,h.owner);assert.equal(send.fee.paymentMethod,'private');
 assert.equal(h.calls.filter(c=>c==='stop').length,1);assert(!h.calls.filter(c=>c[0]==='log').some(c=>c[1].includes('private-secret')));
});

test('browser recovery storage preserves earlier deposits and refuses conflicting replacements or secrets',()=>{
 const app=fs.readFileSync(new URL('../apps/src/fee-juice/app.js',import.meta.url),'utf8');
 const map=new Map(),c=vm.createContext({localStorage:{getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)}});
 vm.runInContext('let fundingRecord=null;'+app.slice(app.indexOf('function saveFundingRecord('),app.indexOf('function downloadRecovery(')),c);
 const record={schema:'private-fee-funding-v1',chainId:'1',version:'1',rollupAddress:'rollup',portalAddress:'portal',tokenAddress:'token',privateFeeAddress:'shared',sender:'sender',nonce:'1',amount:'100'};
 c.saveFundingRecord(record);c.saveFundingRecord({...record,txHash:'hash'});
 assert.throws(()=>c.saveFundingRecord({...record,amount:'200'}),/conflicts/);
 assert.throws(()=>c.saveFundingRecord({...record,secret:'private'}),/Invalid/);
 c.saveFundingRecord({...record,nonce:'2'});assert.equal([...map.keys()].filter(k=>k.includes('recovery:')).length,2);
});

test('deposit below claim fee is rejected before requesting L1 funding',async()=>{
 const h=harness();h.a.GasSettings.from=()=>({getFeeLimit:()=>new Fr(101)});
 await assert.rejects(h.run('deposit'),/must exceed/);assert(!h.calls.some(c=>c[0]==='fund'));
});
