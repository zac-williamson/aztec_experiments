// W03 regression of the original B09 reproduction. Actual SDK receipt classes;
// real shared/deploy wallet implementations; controlled prover/RPC and clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MinedTxReceipt,PendingTxReceipt,DroppedTxReceipt,TxHash} from '@aztec/stdlib/tx';
import {BlockHash} from '@aztec/stdlib/block';
import * as outcomes from '../shared/transaction-outcomes.mjs';
const hash=TxHash.zero();
const mined=(executionResult='success',status='checkpointed')=>MinedTxReceipt.from({txHash:hash,status,executionResult,transactionFee:0n,blockHash:BlockHash.ZERO,blockNumber:1,slotNumber:1,txIndexInBlock:0,epochNumber:0});
function fixture(consumer,{receipts=[mined()],submitError,proofError,blockHash=BlockHash.ZERO,validation={result:'valid'},preProveHook}={}) {
 let now=0;const logs=[],calls={proof:0,submit:0,receipt:0};
 const gas={l2Gas:100,daGas:10,mul(){return this;},computeFee(){return{toBigInt:()=>1n};}};
 class BaseWallet {
  constructor(pxe){this.pxe=pxe;}
  completeFeeOptions=async()=>({gasSettings:{maxFeesPerGas:{},maxPriorityFeesPerGas:{}}});
  simulateViaEntrypoint=async()=>({gasUsed:{totalGas:gas,teardownGas:gas}});
  createTxExecutionRequestFromPayloadAndFee=async()=>({});
  scopesFrom=()=>[];senderForTagsFrom=()=>undefined;
 }
 const sdk={...outcomes,BaseWallet,GasSettings:{from:value=>value}};
 const pxe={proveTx:async()=>{calls.proof++;if(proofError)throw proofError;return{toTx:async()=>({getTxHash:()=>hash})};}};
 const node={sendTx:async()=>{calls.submit++;if(submitError)throw submitError;},
  getTxReceipt:async()=>{const value=receipts[Math.min(calls.receipt++,receipts.length-1)];if(value instanceof Error)throw value;return value;},
  getBlock:async()=>({hash:blockHash}),isValidTx:async()=>validation};
 class Clock extends Date {static now(){return now;}}
 const log=(message,level)=>logs.push({message,level});
 const c=vm.createContext({window:{__aztec:sdk},Date:Clock,log,toAztec:String,setTimeout:(fn,ms)=>{now+=ms;queueMicrotask(fn);},clearTimeout(){}});
 let wallet;
 if(consumer==='shared') {
  vm.runInContext(fs.readFileSync(new URL('../shared/aztec-lib.js',import.meta.url),'utf8'),c);
  wallet=c.createAztecWallet(pxe,node,node,'test',{preProveHook});
 }else{
  const source=fs.readFileSync(new URL(`../apps/src/billboard/${consumer}/engine.js`,import.meta.url),'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,'g.testWalletFactory=createAztecWallet;})();'),c);
  wallet=c.testWalletFactory(sdk,pxe,node,node,log,null,{preProveHook});
 }
 return{calls,logs,send:()=>wallet.sendTx({},{from:'fixture',wait:{timeout:0.03,interval:0.01}}),confirmed:()=>logs.some(x=>x.level==='success'&&x.message.includes('Tx confirmed!'))};
}
for(const consumer of ['shared','deploy','user']) {
 test(`${consumer}: proposed success waits for canonical checkpoint`,async()=>{const f=fixture(consumer,{receipts:[mined('success','proposed'),mined()]});await f.send();assert.equal(f.calls.receipt,2);assert(f.confirmed());});
 for(const status of ['checkpointed','proven','finalized'])test(`${consumer}: ${status} application revert never confirms`,async()=>{
  const f=fixture(consumer,{receipts:[mined('reverted',status)]});await assert.rejects(f.send(),e=>e.code==='BB_TRANSACTION_FAILED');assert(!f.confirmed());assert.equal(f.calls.submit,1);
 });
 test(`${consumer}: dropped receipt with no proven conflict remains unknown`,async()=>{const f=fixture(consumer,{receipts:[DroppedTxReceipt.empty()]});await assert.rejects(f.send(),e=>e.code==='BB_SUBMISSION_UNKNOWN');assert(!f.confirmed());});
 test(`${consumer}: structured revalidated state conflict requests fresh proof without resubmitting`,async()=>{const f=fixture(consumer,{receipts:[DroppedTxReceipt.empty()],validation:{result:'invalid',reason:['Existing nullifier']}});await assert.rejects(f.send(),e=>e.code==='BB_STATE_CONFLICT');assert.equal(f.calls.proof,1);assert.equal(f.calls.submit,1);});
 for(const receipt of [null,PendingTxReceipt.empty(),{txHash:hash,status:'app_logic_reverted'},new Error('PRIVATE_RPC_SENTINEL')])test(`${consumer}: missing/pending/malformed/error receipt cannot confirm ${receipt?.status||typeof receipt}`,async()=>{
  const f=fixture(consumer,{receipts:[receipt]});await assert.rejects(f.send(),e=>e.code==='BB_SUBMISSION_UNKNOWN'&&!e.message.includes('PRIVATE_RPC_SENTINEL'));assert(!f.confirmed());
 });
 test(`${consumer}: receipt from another transaction rejects`,async()=>{const f=fixture(consumer,{receipts:[{...mined(),txHash:{toString:()=> 'another'}}]});await assert.rejects(f.send(),e=>e.code==='BB_SUBMISSION_UNKNOWN');assert(!f.confirmed());});
 test(`${consumer}: noncanonical block cannot confirm`,async()=>{const f=fixture(consumer,{blockHash:{toString:()=> 'reorganized'}});await assert.rejects(f.send(),e=>e.code==='BB_SUBMISSION_UNKNOWN');assert(!f.confirmed());});
 test(`${consumer}: reverted receipt on a reorganized block remains unknown`,async()=>{const f=fixture(consumer,{receipts:[mined('reverted')],blockHash:{toString:()=> 'reorganized'}});await assert.rejects(f.send(),e=>e.code==='BB_SUBMISSION_UNKNOWN');assert(!f.confirmed());});
 test(`${consumer}: ambiguous submission reconciles the same hash exactly once`,async()=>{const f=fixture(consumer,{submitError:new Error('transport timeout'),receipts:[PendingTxReceipt.empty(),mined()]});await f.send();assert.equal(f.calls.submit,1);assert.equal(f.calls.proof,1);assert(f.confirmed());});
 test(`${consumer}: already text cannot turn a reverted transaction into success`,async()=>{const f=fixture(consumer,{submitError:new Error('already exists PRIVATE_RPC_SENTINEL'),receipts:[mined('reverted')]});await assert.rejects(f.send(),e=>e.code==='BB_TRANSACTION_FAILED');assert(!f.confirmed());assert(!JSON.stringify(f.logs).includes('PRIVATE_RPC_SENTINEL'));});
 test(`${consumer}: proof or pre-proof failure never submits`,async()=>{for(const options of [{proofError:new Error('stop')},{preProveHook:async()=>{throw new Error('stop');}}]){const f=fixture(consumer,options);await assert.rejects(f.send(),/stop/);assert.equal(f.calls.submit,0);assert(!f.confirmed());}});
}
