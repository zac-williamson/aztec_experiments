// Pure failure-path tests: no chain, wallet, funding or privacy acceptance claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import {capturePublicFeeRecovery,capturePublicFeeFunding,capturePublicFeeStandalone,
  capturePrivateFeeSetupFailure,createPrivateFeeRecoveryEvidence,failPrivateFeeSetup,failPrivateFeeWalletSetup} from './private-fee-evidence.mjs';
const a = byte => '0x' + byte.repeat(20), h = byte => '0x' + byte.repeat(32);
const recovery = () => ({schema:'private-fee-funding-v1',chainId:'31337',version:'6',rollupAddress:a('11'),
  portalAddress:a('22'),tokenAddress:a('33'),privateFeeAddress:h('12'),sender:a('44'),nonce:'7',amount:'1000'});
const completed = () => ({passed:true,realL1Deposit:true,independentL1Sender:true,testFaucetFunding:true,
  productionFundingHelper:true,productionRecoveryHelper:true,publicRecoveryPersistedBeforeDeposit:true,
  privateSecretsStored:false,depositSends:1,amount:'1000',l1TxHash:h('55'),recipient:h('12'),publicRecovery:{...recovery(),txHash:h('55'),leafIndex:'9'}});
const caught = async fn => {try {await fn();} catch(error) {return error;} assert.fail('Expected failure');};
function changing(record) {
  const reads={};
  for(const [key,value] of Object.entries(record))Object.defineProperty(record,key,{enumerable:true,get(){reads[key]=(reads[key]??0)+1;return reads[key]===1?value:'PRIVATE_SENTINEL';}});
  return reads;
}

test('pre-send public journal survives one uncertain send without a hash or retry', async()=>{
  const state=createPrivateFeeRecoveryEvidence(), original=Error('PRIVATE_SENTINEL send failure');let writes=0,sends=0;
  const input=recovery();input.privateAccount={secret:'PRIVATE_SENTINEL'};
  await state.save(input,async publicRecord=>{writes++;assert.deepEqual(publicRecord,recovery());});
  const error=await caught(async()=>{state.attemptDeposit();sends++;throw original;});
  assert.equal(error,original);const evidence=state.snapshot();
  assert.deepEqual(evidence.publicRecovery,recovery());assert.equal(evidence.passed,false);assert.equal(evidence.outcome,'unknown');
  assert.equal(evidence.depositSends,1);assert.equal(evidence.recoverySaves,1);assert.equal(writes,1);assert.equal(sends,1);
  assert.equal(evidence.publicRecovery.txHash,undefined);assert(!JSON.stringify(evidence).includes('PRIVATE_SENTINEL'));
});

test('failed persistence retains validated public record but never claims persisted or sent', async()=>{
  const state=createPrivateFeeRecoveryEvidence();
  await assert.rejects(state.save(recovery(),async()=>{throw Error('disk failure');}),/disk failure/);
  const result=state.snapshot();assert.equal(result.outcome,'unverified');assert.equal(result.recoverySaves,0);
  assert.equal(result.publicRecoveryPersistedBeforeDeposit,false);assert.equal(result.depositSends,0);assert.deepEqual(result.publicRecovery,recovery());
});

test('later unverified receipt fields do not erase usable sender/nonce recovery', async()=>{
  const state=createPrivateFeeRecoveryEvidence();await state.save(recovery(),async()=>{});state.attemptDeposit();
  await state.save({...recovery(),txHash:h('55'),leafIndex:'9'},async()=>{});
  assert.equal(state.snapshot().outcome,'unknown');assert.equal(state.snapshot().publicRecovery.txHash,h('55'));
  assert.equal(state.snapshot().publicRecovery.leafIndex,'9');assert.equal(state.snapshot().passed,false);
});

test('W01 finalizer preserves completed bridge and unknown standalone through cleanup failure', async()=>{
  const action=Error('PRIVATE_SENTINEL action'), cleanup=Error('PRIVATE_SENTINEL cleanup');let closes=0;
  action.privateFeeStandaloneObservation={passed:false,txHash:h('66'),payer:h('12'),nodeValidation:'valid',applicationProof:false,networkProof:false,diagnostic:'PRIVATE_SENTINEL'};
  const error=await caught(()=>failPrivateFeeSetup(action,{funding:completed(),privateAccount:'PRIVATE_SENTINEL'},async()=>{closes++;throw cleanup;}));
  assert(error instanceof AggregateError);assert.deepEqual(error.errors,[action,cleanup]);assert.equal(closes,1);
  const result=error.privateFeeObservation;assert.equal(result.walletCleanup,'failed');assert.equal(result.passed,false);
  assert.equal(result.funding.outcome,'complete');assert.equal(result.funding.l1TxHash,h('55'));
  assert.equal(result.standalone.outcome,'unknown');assert.equal(result.standalone.txHash,h('66'));assert.equal(result.standalone.passed,false);
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
});

test('W01 finalizer captures partial bridge before cleanup changes the error', async()=>{
  const action=Error('send failed'), raw={...completed(),passed:false};let closes=0;
  delete raw.l1TxHash;delete raw.publicRecovery.txHash;delete raw.publicRecovery.leafIndex;
  action.privateFeeFundingObservation=raw;
  const error=await caught(()=>failPrivateFeeSetup(action,{},async()=>{closes++;raw.publicRecovery.sender='PRIVATE_SENTINEL';}));
  assert.equal(error,action);assert.equal(closes,1);assert.equal(error.privateFeeObservation.walletCleanup,'closed');
  assert.equal(error.privateFeeObservation.funding.publicRecovery.sender,a('44'));assert.equal(error.privateFeeObservation.funding.outcome,'unknown');
});

test('every allowed recovery field is captured once; unknown getters are untouched',()=>{
  const input={...recovery(),txHash:h('55'),leafIndex:'9'}, expected=structuredClone(input),reads=changing(input);
  Object.defineProperty(input,'secret',{get(){throw Error('PRIVATE_SENTINEL');}});
  assert.deepEqual(capturePublicFeeRecovery(input),expected);assert(Object.values(reads).every(n=>n===1));
});

test('changing nested error and standalone getters cannot publish second values',()=>{
  const funding=completed(), rReads=changing(funding.publicRecovery), fReads=changing(funding);
  const standalone={passed:false,canonicalCheckpoint:false,applicationProof:false,networkProof:false,
    txHash:h('66'),payer:h('12'),transactionFee:'7',status:'pending',nodeValidation:'valid',executionResult:'reverted'};
  const sReads=changing(standalone), record={funding,standalone,walletCleanup:'failed'}, recordReads=changing(record);
  const error={privateFeeObservation:record},errorReads=changing(error);
  const result=capturePrivateFeeSetupFailure(error);
  assert.equal(result.funding.l1TxHash,h('55'));assert.equal(result.standalone.txHash,h('66'));assert.equal(result.walletCleanup,'failed');
  for(const reads of [rReads,fReads,sReads,recordReads,errorReads])assert(Object.values(reads).every(n=>n===1));
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));structuredClone(result);
});

test('malformed, throwing and noncloneable values fail closed with bounded JSON',()=>{
  const input={...completed(),amount:'1'.repeat(100000),l1TxHash:()=>{},recipient:'PRIVATE_SENTINEL',depositSends:Infinity};
  Object.defineProperty(input,'publicRecovery',{get(){throw Error('PRIVATE_SENTINEL');}});
  const result=capturePublicFeeFunding(input);assert.equal(result.passed,false);assert.equal(result.amount,undefined);assert.equal(result.publicRecovery,undefined);
  assert(JSON.stringify(result).length<1024);structuredClone(result);assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  assert.equal(capturePublicFeeRecovery({...recovery(),nonce:'-1'}),undefined);
  const partial=capturePublicFeeStandalone({passed:true,txHash:h('66'),transactionFee:()=>{},status:'PRIVATE_SENTINEL'});
  assert.equal(partial.passed,false);assert.equal(partial.outcome,'unknown');assert.equal(partial.transactionFee,undefined);
});

test('no receipt data invents success and unknown cleanup stays explicit',()=>{
  const result=capturePrivateFeeSetupFailure({privateFeeObservation:{funding:{passed:true},standalone:{passed:true},walletCleanup:'PRIVATE_SENTINEL'}});
  assert.equal(result.funding.passed,false);assert.equal(result.funding.outcome,'unverified');
  assert.equal(result.standalone.passed,false);assert.equal(result.standalone.outcome,'unverified');assert.equal(result.walletCleanup,'unknown');
});


test('injected inner boundary: created wallet registration/publication failure and failed close survive outer setup',async()=>{
  for(const stage of ['registration','publication']) {
    const action=Error(stage+' failed'),cleanup=Error('close failed');let creates=0,closes=0;
    const inner=async()=>{
      let wallet;
      try {wallet=await (async()=>{creates++;return {};})();throw action;}
      catch(error){return failPrivateFeeWalletSetup(error,async()=>{closes++;throw cleanup;},wallet?'created':'unknown');}
    };
    const innerError=await caught(inner);
    assert(innerError instanceof AggregateError);assert.deepEqual(innerError.errors,[action,cleanup]);
    assert.equal(innerError.privateFeeWalletCleanup,'failed');
    const outer=await caught(()=>failPrivateFeeSetup(innerError,{},undefined));
    assert.equal(outer,innerError);assert.equal(outer.privateFeeObservation.walletCleanup,'failed');
    assert.equal(capturePrivateFeeSetupFailure(outer).walletCleanup,'failed');assert.equal(creates,1);assert.equal(closes,1);
  }
});

test('injected inner boundary: explicit closed/not-created survive; missing creation result remains unknown',async()=>{
  for(const state of ['created','not-created','unknown']){
    let closes=0;const action=Error('setup failed');
    const inner=await caught(()=>failPrivateFeeWalletSetup(action,async()=>{closes++;},state));
    const outer=await caught(()=>failPrivateFeeSetup(inner,{},undefined));
    assert.equal(outer.privateFeeObservation.walletCleanup,state==='created'?'closed':state);
    assert.equal(closes,state==='created'?1:0);
  }
  const missing=await caught(()=>failPrivateFeeSetup(Error('open failed without owner evidence'),{},undefined));
  assert.equal(missing.privateFeeObservation.walletCleanup,'unknown');
});

test('inner cleanup evidence getter is captured once and invalid values stay unknown',async()=>{
  for(const value of ['failed','PRIVATE_SENTINEL',()=>{}]){
    let reads=0;const action=Error('failure');
    Object.defineProperty(action,'privateFeeWalletCleanup',{get(){return ++reads===1?value:'PRIVATE_SENTINEL';}});
    const outer=await caught(()=>failPrivateFeeSetup(action,{},undefined));
    assert.equal(reads,1);assert.equal(outer.privateFeeObservation.walletCleanup,value==='failed'?'failed':'unknown');
    assert(!JSON.stringify(outer.privateFeeObservation).includes('PRIVATE_SENTINEL'));
  }
});
