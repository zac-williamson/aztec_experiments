import test from 'node:test';
import assert from 'node:assert/strict';
import {runAccountOperation} from '../application.mjs';
function fixture(){
 const calls=[],records=new Map(),hash='proof-hash';
 const journal={assertCanStart:async()=>{calls.push('journal-ready');},setOperation(){}};
 const handles={address:'account',l2Addr:'board',nodeInfo:{l1ChainId:31337,l1ContractAddresses:{rollupAddress:'rollup'}},version:5,pxe:{sync:async()=>calls.push('sync')},aztecNode:{},rawNode:{},wallet:{sendTx:async(payload,options)=>{calls.push('send');assert.equal(payload,'estimated-payload');assert.equal(options.fee.gasSettings,'measured-gas');assert.equal(options.transactionJournal,journal);assert.equal(JSON.parse(options.journalOperation).kind,'extension');await options.beforeSubmit?.(hash);return {receipt:{txHash:hash}};}}};
 const config={action:'plugin-account',pluginAction:'claim',pluginInput:{handle:'bok'},portalAddress:'portal',privateFee:{contractAddress:'fee',gasSettings:'ceiling'},aztecWallet:{secretKey:'secret',salt:'salt'},remoteProver:{url:'remote'},contextGuard:async()=>calls.push('guard')};
 const env={log(){},privateFeeArtifact:{},getBrowserSigner:async()=>({}),createTransactionJournal:async opts=>{assert.equal(opts.scope.board,'board');assert.equal(opts.walletSecret,'secret');return journal;},aztec:{preparePrivateFeePayment:async()=>{calls.push('prepare');return {availableCredit:10n};},estimatePrivateFeeTransaction:async opts=>{calls.push('estimate');assert.equal(opts.prepared.availableCredit,10n);assert.equal(opts.guard,config.contextGuard);return {payload:'estimated-payload',gasSettings:'measured-gas'};}}};
 const args={env,config,storage:{getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)},connect:async(_env,connectedConfig)=>{calls.push('connect');assert.equal(connectedConfig.action,'status');assert.equal(connectedConfig.remoteProver,config.remoteProver);return {handles};},resolveInvocation:async()=>({descriptor:{scope:{receiver:'plugin'}}}),executeAccount:async({send})=>send({},async()=>calls.push('saved-plugin-record'))};
 return {args,calls,journal,env,handles,config};
}
test('plugin mutations initialize the scoped wallet and send only the measured fee payload',async()=>{
 const f=fixture(),result=await runAccountOperation(f.args);assert.equal(result.lastL2TxHash,'proof-hash');assert.equal(result.handles,f.handles);
 assert.deepEqual(f.calls,['connect','guard','guard','sync','prepare','estimate','send','saved-plugin-record','guard']);
});
test('failed plugin estimation cannot prepare a journal or send a transaction',async()=>{
 const f=fixture();f.env.aztec.estimatePrivateFeeTransaction=async()=>{throw {code:'BB_SIMULATION_FAILED'};};await assert.rejects(runAccountOperation(f.args),{code:'BB_SIMULATION_FAILED'});assert(!f.calls.includes('send'));
});
for(const action of ['deposit','withdraw','cancel','release'])test(`pending journal blocks plugin ${action} before any external payment`,async()=>{
 const f=fixture();f.config.pluginAction=action;f.journal.assertCanStart=async()=>{throw {code:'BB_RECOVERY_REQUIRED'};};f.args.executeAccount=()=>assert.fail('Must not call payment protocol');await assert.rejects(runAccountOperation(f.args),{code:'BB_RECOVERY_REQUIRED'});
});
test('reconciled plugin hash crosses the application boundary for acknowledgment',async()=>{
 const f=fixture();f.args.executeAccount=async()=>({balance:'1',lastL2TxHash:'recovered-hash'});const result=await runAccountOperation(f.args);assert.equal(result.lastL2TxHash,'recovered-hash');assert(!f.calls.includes('send'));
});
test('changed account stops plugin resolution before requesting a signer',async()=>{
 const f=fixture();f.config.contextGuard=async()=>{throw {code:'BB_WALLET_NOT_READY'};};f.env.getBrowserSigner=()=>assert.fail('Must not obtain signer');await assert.rejects(runAccountOperation(f.args),{code:'BB_WALLET_NOT_READY'});
});
