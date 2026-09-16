// Actual browser funding engine; wallet/prover/chain are explicit doubles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Fr} from '@aztec/foundation/curves/bn254';
import {boundedTransactionRead} from '../shared/transaction-outcomes.mjs';
const source=fs.readFileSync(new URL('../apps/src/fee-juice/engine.js',import.meta.url),'utf8');
function harness(){
 const calls=[],owner={toString:()=> 'owner'},payer={toString:()=> 'shared'},wallet={},claim={amount:'100',salt:'private-salt',secret:'private-secret',leafIndex:'1'};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5}),getL1ContractAddresses:async()=>({rollupAddress:'rollup',feeJuicePortalAddress:'fee-portal'})};
 const pxe={registerAccount:async()=>{},registerContractClass:async()=>{},registerContract:async()=>{},sync:async()=>{},stop:async()=>calls.push('stop')};
 const context=vm.createContext({BillboardPrivateFeeRouting:{createAztecWallet:(...args)=>{wallet.journal=args.at(-1).transactionJournal;return wallet;}}});vm.runInContext(source,context);
 const a={Fr,boundedTransactionRead,GasSettings:{from:()=>({getFeeLimit:()=>new Fr(10)})},deriveSigningKey:()=>Fr.ONE,deriveKeys:async()=>({publicKeys:{}}),
  SchnorrInitializerlessAccountContract:class{getContractArtifact=async()=>({functions:[]});getImmutablesHash=async()=>Fr.ZERO;},
  getContractInstanceFromInstantiationParams:async()=>({address:owner}),derivePrivateFeeAddress:async()=>payer,createAztecNodeClient:()=>node,
  computePartialAddress:async()=>Fr.ONE,createPXE:async()=>pxe,AccountManager:{create:async()=>({address:owner})},
  recoverPrivateFeeClaim:async input=>{calls.push(['recover',input]);return claim;},
  preparePrivateFeePayment:async input=>{calls.push(['prepare',input]);return {paymentMethod:'private',gasSettings:{}};},
  BatchCall:class{constructor(w,actions){assert.equal(w,wallet);assert.equal(actions.length,0);}send=async opts=>{calls.push(['send',opts]);return {receipt:{status:'checkpointed'}};}}
 };
 const journal={assertCanStart:async()=>calls.push('journal-preflight'),setOperation:operation=>calls.push(['operation',operation]),lastTxHash:'saved-hash'};
 const env={createJournalStorage:()=>({}),createTransactionJournal:async input=>{calls.push(['journal',input]);return journal;},aztec:a,privateFeeArtifact:{},log:message=>calls.push(['log',message]),initCRS:async()=>{},createStore:async()=>({}),getBrowserSigner:async()=>({provider:{}}),ethers:{parseUnits:()=>100n},
 fundPrivateFees:async input=>{calls.push(['fund',input]);const record={nonce:'1'};await input.saveRecovery(record);return record;}};
 const config={aztecWallet:{secretKey:Fr.ONE.toString(),salt:0},privateFee:{contractAddress:'shared',gasSettings:{}},fundingRecord:{schema:'private-fee-funding-v1',chainId:'31337',version:'5',rollupAddress:'rollup',portalAddress:'fee-portal',tokenAddress:'token',privateFeeAddress:'shared',sender:'sender',nonce:'1',amount:'100',txHash:Fr.ONE.toString()},saveRecovery:async record=>calls.push(['save',record]),depositAmount:'0.1'};
 return {calls,owner,claim,a,env,config,wallet,journal,run:action=>context.runFeeJuiceFlow(env,{...config,action})};
}
test('funding deposits to shared address and passes mandatory recovery callback',async()=>{
 const h=harness();const result=await h.run('deposit');assert.equal(result.record.nonce,'1');
 const fund=h.calls.find(c=>c[0]==='fund')[1];assert.equal(fund.privateFeeAddress.toString(),'shared');assert.equal(fund.owner,h.owner);
 assert.equal(fund.expectedChainId,'31337');assert.equal(fund.expectedVersion,'5');assert(h.calls.some(c=>c[0]==='save'));
});
test('standalone claim uses standard author entrypoint with only private fee payload, then stops PXE',async()=>{
 const h=harness();await h.run('claim');const preparation=h.calls.find(c=>c[0]==='prepare')[1];assert.equal(preparation.claim,h.claim);
 const send=h.calls.find(c=>c[0]==='send')[1];assert.equal(send.from,h.owner);assert.equal(send.fee.paymentMethod,'private');
 assert.equal(h.calls.filter(c=>c==='stop').length,1);assert(h.wallet.journal);assert(h.calls.indexOf('journal-preflight')<h.calls.findIndex(c=>c[0]==='recover'));assert.equal(h.calls.find(c=>c[0]==='journal')[1].scope.portal,'fee-portal');assert(!h.calls.filter(c=>c[0]==='log').some(c=>c[1].includes('private-secret')));
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

test('private fee claim refuses missing or unresolved recovery storage before consuming bridge information',async()=>{
 const missing=harness();delete missing.env.createTransactionJournal;await assert.rejects(missing.run('claim'),{code:'BB_JOURNAL_INVALID'});
 const pending=harness();pending.env.createTransactionJournal=async()=>({assertCanStart:async()=>{throw Object.assign(new Error('pending'),{code:'BB_RECOVERY_REQUIRED'});}});
 await assert.rejects(pending.run('claim'),{code:'BB_RECOVERY_REQUIRED'});assert(!pending.calls.some(c=>c[0]==='recover'||c[0]==='prepare'));
});
for(const outcome of ['success','reverted'])test(`private fee ${outcome} recovery requires no Ethereum signer, bridge claim file or PXE`,async()=>{
 const h=harness();h.config.fundingRecord=null;h.env.getBrowserSigner=()=>{throw new Error('must not request signer');};h.env.initCRS=()=>{throw new Error('must not start PXE');};
 h.env.createTransactionJournal=async()=>({recover:async()=>({executionResult:outcome,txHash:Fr.ONE})});
 const result=await h.run('recover-l2');assert.equal(result.ok,outcome==='success');assert.equal(result.lastL2TxHash,Fr.ONE.toString());assert.equal(result.state,outcome==='success'?'transaction_recovered':'transaction_reverted');
 assert(!h.calls.some(c=>c[0]==='recover'||c[0]==='send'));
});

for(const outcome of ['approved','funded','reverted','replaced'])test(`fee Ethereum ${outcome} recovery is explicit and does not start an L2 proof`,async()=>{
 const h=harness();let options;
 h.a.recoverPrivateFeeFunding=async input=>{options=input;return {outcome,lastEthereumTxHash:'hash'};};
 h.config.retryEthereum=true;
 const result=await h.run('recover-eth');assert.equal(result.outcome,outcome);assert.equal(options.retry,true);assert.equal(options.walletSalt,Fr.ZERO.toString());
 assert(!h.calls.some(c=>c[0]==='prepare'||c[0]==='send'));
});
async function staleHarness(){
 const h=harness();await h.run('claim');
 const operation=h.calls.find(c=>c[0]==='operation')[1];h.calls.length=0;
 h.journal.recover=async()=>{throw Object.assign(new Error('stale'),{code:'BB_RECOVERY_REQUIRED'});};
 h.journal.inspect=async()=>({operation});
 h.journal.allowReplacement=async saved=>{assert.equal(saved,operation);h.calls.push('allow-replacement');};
 return {...h,operation};
}
test('claim persists exact public funding identity before preparation without duplicating secrets',async()=>{
 const h=harness();await h.run('claim');
 const encoded=h.calls.find(c=>c[0]==='operation')[1],intent=JSON.parse(encoded);
 assert.equal(intent.record.leafIndex,'1');assert.equal(intent.owner,'owner');
 assert(!encoded.includes('private-secret'));assert(!encoded.includes('private-salt'));
 assert(h.calls.findIndex(c=>c[0]==='operation')<h.calls.findIndex(c=>c[0]==='prepare'));
});
test('stale private fee claim restores saved funding record even when UI holds another deposit',async()=>{
 const h=await staleHarness();h.config.fundingRecord={nonce:'different'};
 await h.run('recover-l2');
 const restored=h.calls.find(c=>c[0]==='recover')[1].record;
 assert.deepEqual(JSON.parse(JSON.stringify(restored)),JSON.parse(h.operation).record);
 assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert(!h.calls.some(c=>c[0]==='fund'));
 assert.equal(h.calls.find(c=>c[0]==='operation')[1],h.operation);
});
for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED'])test(`${code} does not regenerate private fee claim`,async()=>{
 const h=await staleHarness();h.journal.recover=async()=>{throw Object.assign(new Error('blocked'),{code});};
 await assert.rejects(h.run('recover-l2'),{code});assert(!h.calls.some(c=>c[0]==='recover'||c[0]==='prepare'||c==='allow-replacement'));
});
test('live old claim cannot authorize replacement',async()=>{
 const h=await staleHarness();h.journal.allowReplacement=async()=>{throw Object.assign(new Error('live'),{code:'BB_RECOVERY_REQUIRED'});};
 await assert.rejects(h.run('recover-l2'),{code:'BB_RECOVERY_REQUIRED'});assert(!h.calls.some(c=>c[0]==='recover'||c[0]==='prepare'));
});
for(const change of ['owner','kind','unknown-record-key'])test(`saved fee claim rejects ${change}`,async()=>{
 const h=await staleHarness(),intent=JSON.parse(h.operation);
 if(change==='unknown-record-key')intent.record.secret='must-not-read';else intent[change]='different';
 h.journal.inspect=async()=>({operation:JSON.stringify(intent)});
 await assert.rejects(h.run('recover-l2'),{code:'BB_RECOVERY_REQUIRED'});assert(!h.calls.some(c=>c[0]==='prepare'||c==='allow-replacement'));
});
test('changed canonical message index blocks regenerated claim before proving',async()=>{
 const h=await staleHarness();h.claim.leafIndex='2';
 await assert.rejects(h.run('recover-l2'),{code:'BB_RECOVERY_REQUIRED'});assert(!h.calls.some(c=>c[0]==='prepare'||c[0]==='send'));
});
test('canonical funding validation failure blocks regenerated claim',async()=>{
 const h=await staleHarness();h.a.recoverPrivateFeeClaim=async()=>{throw Object.assign(new Error('reorg'),{code:'PRIVATE_FEE_RECOVERY_REORG'});};
 await assert.rejects(h.run('recover-l2'),{code:'PRIVATE_FEE_RECOVERY_REORG'});assert(!h.calls.some(c=>c[0]==='prepare'||c[0]==='send'));
});
test('private fee funding reconciliation has a bounded deadline',async()=>{
 const h=await staleHarness();h.a.recoverPrivateFeeClaim=async()=>new Promise(()=>{});
 h.a.boundedTransactionRead=(fn,timeout)=>{assert.equal(timeout,20000);return boundedTransactionRead(fn,5);};
 await assert.rejects(h.run('recover-l2'),{code:'BB_SUBMISSION_UNKNOWN'});assert(!h.calls.some(c=>c[0]==='prepare'||c[0]==='send'));
});
