import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureOnboardingFees} from '../shared/fee-onboarding.mjs';
function fixture(){
 const calls=[];const claim={messageKey:'validated-key'};
 const ports={checkBalance:async()=>{calls.push('balance');throw {code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'};},
 recoverFunding:async()=>{calls.push('recover');throw {code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'};},
 fund:async ack=>{calls.push(['fund',ack]);return 'record';},recoverClaim:async record=>{calls.push(['claim',record]);return claim;},
 isConsumed:async()=>{calls.push('consumed');return false;},waitForMessage:async()=>{calls.push('wait');}};
 return {ports,calls,claim};
}
test('existing credit performs no Ethereum work',async()=>{const f=fixture();f.ports.checkBalance=async()=>{};assert.equal(await ensureOnboardingFees(f.ports),undefined);assert.deepEqual(f.calls,[]);});
test('new wallet funds and waits automatically',async()=>{const f=fixture();assert.equal(await ensureOnboardingFees(f.ports),f.claim);assert.deepEqual(f.calls,['balance','recover',['fund',undefined],['claim','record'],'wait']);});
test('confirmed prior funding is reused without a second payment',async()=>{const f=fixture();f.ports.recoverFunding=async()=>({outcome:'funded',record:'saved',lastEthereumTxHash:'fee-hash'});await ensureOnboardingFees(f.ports);assert.deepEqual(f.calls,['balance',['claim','saved'],'consumed','wait']);});
test('consumed credit may be replaced using only its fee acknowledgement',async()=>{const f=fixture();f.ports.recoverFunding=async()=>({outcome:'funded',record:'old',lastEthereumTxHash:'fee-hash'});f.ports.isConsumed=async()=>true;await ensureOnboardingFees(f.ports);assert.deepEqual(f.calls,['balance',['claim','old'],['fund','fee-hash'],['claim','record'],'wait']);});
test('recovered token approval continues funding with its own acknowledgement',async()=>{const f=fixture();f.ports.recoverFunding=async()=>({outcome:'approved',lastEthereumTxHash:'approval'});await ensureOnboardingFees(f.ports);assert.deepEqual(f.calls,['balance',['fund','approval'],['claim','record'],'wait']);});
for(const code of ['BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_RECOVERY_REQUIRED','NETWORK_ERROR'])test('uncertain recovery never creates another payment: '+code,async()=>{const f=fixture();f.ports.recoverFunding=async()=>{throw {code};};await assert.rejects(ensureOnboardingFees(f.ports),e=>e.code===code);assert.deepEqual(f.calls,['balance']);});
test('unavailable bridge keeps confirmed funding for next attempt',async()=>{const f=fixture();f.ports.recoverFunding=async()=>({outcome:'funded',record:'saved'});f.ports.waitForMessage=async()=>{throw {code:'BB_DEPOSIT_MESSAGE_PENDING'};};await assert.rejects(ensureOnboardingFees(f.ports),e=>e.code==='BB_DEPOSIT_MESSAGE_PENDING');assert(!f.calls.some(x=>Array.isArray(x)&&x[0]==='fund'));});
test('configuration or identity failure does not start funding',async()=>{const f=fixture();f.ports.checkBalance=async()=>{throw {code:'PRIVATE_FEE_CHAIN_MISMATCH'};};await assert.rejects(ensureOnboardingFees(f.ports),e=>e.code==='PRIVATE_FEE_CHAIN_MISMATCH');assert.deepEqual(f.calls,[]);});
