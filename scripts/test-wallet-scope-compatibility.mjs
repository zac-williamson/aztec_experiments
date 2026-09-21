// Actual application adapters and pinned SDK scope/tag methods; no proving or RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { BaseWallet } from '@aztec/wallet-sdk/base-wallet';
import { NO_FROM } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { Fr } from '@aztec/foundation/curves/bn254';

const owner=new AztecAddress(new Fr(1));
const additional=new AztecAddress(new Fr(2));
const tagSender=new AztecAddress(new Fr(3));
const stopped=new Error('TEST_STOP_BEFORE_CRYPTO');
function fixture(consumer,mutate=false){
 let observed;
 const gas={l2Gas:100,daGas:10,mul(){return this;},computeFee(){return {toBigInt:()=>1n};}};
 class ControlledWallet extends BaseWallet {
  async completeFeeOptions(){return {gasSettings:{maxFeesPerGas:{},maxPriorityFeesPerGas:{}}};}
  async simulateViaEntrypoint(){return {publicInputs:{forPublic:{}},publicOutput:{},gasUsed:{totalGas:gas,teardownGas:gas}};}
  async createTxExecutionRequestFromPayloadAndFee(){return {};}
 }
 // Scope and sender methods are inherited unchanged from the actual pinned SDK.
 assert.equal(ControlledWallet.prototype.scopesFrom,BaseWallet.prototype.scopesFrom);
 const pxe={proveTx:async(_request,options)=>{observed=options;throw stopped;}};
 const sdk={BaseWallet:ControlledWallet,GasSettings:{from:value=>value}};
 const context=vm.createContext({performance,window:{__aztec:sdk},log(){},toAztec:String,setTimeout,clearTimeout});
 const path=consumer==='shared'?'../shared/aztec-lib.js':`../apps/src/billboard/${consumer}/engine.js`;
 let source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 if(mutate){
  const original=source;
  source=source.replace(/this\.scopesFrom\(opts\.from, opts\.additionalScopes \?\? \[\], opts\.sendMessagesAs\)/g,'this.scopesFrom(opts.from, opts.additionalScopes)');
  assert.notEqual(source,original,'mutation must restore the old faulty adapter call');
 }
 let wallet;
 if(consumer==='shared'){
  vm.runInContext(source,context);wallet=context.createAztecWallet(pxe,{}, {},'test');
 }else{
  assert.match(source,/\}\)\(\);\s*$/);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,'g.testWalletFactory=createAztecWallet;})();'),context);
  wallet=consumer==='deploy' ? context.testWalletFactory(sdk,pxe,{}, {},()=>{},{}) : context.testWalletFactory(sdk,pxe,{}, {},()=>{},null);
 }
 return {send:options=>wallet.sendTx({},options),observed:()=>observed};
}
const cases=[
 ['default scopes',{from:owner},[owner],owner],
 ['explicit additional scopes',{from:owner,additionalScopes:[additional,owner]},[owner,additional],owner],
 ['separate tag sender',{from:owner,sendMessagesAs:tagSender},[owner,tagSender],tagSender],
 ['combined scopes and tag sender',{from:owner,additionalScopes:[additional],sendMessagesAs:tagSender},[owner,additional,tagSender],tagSender],
 ['accountless deployment tag sender',{from:NO_FROM,sendMessagesAs:tagSender},[tagSender],tagSender],
 ['accountless without tag sender',{from:NO_FROM},[],undefined],
];
for(const consumer of ['shared','deploy','user']){
 for(const [name,options,expected,sender] of cases)test(`${consumer}: ${name}`,async()=>{
  const f=fixture(consumer);await assert.rejects(f.send(options),error=>error===stopped);
  assert.deepEqual(Array.from(f.observed().scopes,address=>address.toString()),expected.map(address=>address.toString()));
  assert.equal(f.observed().senderForTags?.toString(),sender?.toString());
 });
 test(`${consumer}: regression detects the previous undefined-scope call`,async()=>{
  const f=fixture(consumer,true);await assert.rejects(f.send({from:owner}),/additionalScopes is not iterable/);assert.equal(f.observed(),undefined);
 });
}
