// Development-only adversarial projection checks; no provider or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {getVeniceDiagnostic,veniceDiagnosticError} from '../venice-diagnostics.mjs';
const expected={category:'http-rejection',httpStatus:400,code:'INVALID_REQUEST',param:'max_completion_tokens',billingStage:null};
test('only exact documented code/param survive; arbitrary text, details, ids and headers never do',()=>{
 const error=veniceDiagnosticError('http-rejection',{httpStatus:400,body:{error:{code:'INVALID_REQUEST',param:'max_completion_tokens',message:'PRIVATE_SENTINEL',details:{private:'PRIVATE_SENTINEL'}},id:'PRIVATE_SENTINEL',headers:{authorization:'PRIVATE_SENTINEL'}}});
 assert.deepEqual(getVeniceDiagnostic(error),expected);assert(Object.isFrozen(getVeniceDiagnostic(error)));assert(!JSON.stringify(error).includes('PRIVATE_SENTINEL'));assert(!error.stack.includes('PRIVATE_SENTINEL'));assert.equal(error.cause,undefined);
});
test('unknown huge values project null, never truncated provider strings',()=>{
 const result=getVeniceDiagnostic(veniceDiagnosticError('http-rejection',{httpStatus:999,body:{error:{code:'PRIVATE_SENTINEL'.repeat(10000),param:'messages.PRIVATE_SENTINEL'}}}));
 assert.deepEqual(result,{...expected,httpStatus:null,code:null,param:null});
});
test('throwing/changing getters are not executed during projection',()=>{
 let reads=0;const body={error:{}};
 for(const key of ['code','param'])Object.defineProperty(body.error,key,{get(){reads++;if(reads===1)return 'INVALID_REQUEST';throw Error('PRIVATE_SENTINEL');}});
 const result=getVeniceDiagnostic(veniceDiagnosticError('http-rejection',{httpStatus:400,body}));assert.equal(reads,0);assert.equal(result.code,null);assert.equal(result.param,null);
 const hostile=new Proxy({}, {getOwnPropertyDescriptor(){throw Error('PRIVATE_SENTINEL');}});
 assert.equal(getVeniceDiagnostic(veniceDiagnosticError('http-rejection',hostile)).httpStatus,null);
});
test('ordinary errors, forged records and arbitrary error getters are never traversed',()=>{
 const error=new Proxy({}, {get(){throw Error('PRIVATE_SENTINEL');},getOwnPropertyDescriptor(){throw Error('PRIVATE_SENTINEL');}});
 for(const value of [null,undefined,'error',error,{providerDiagnostic:expected},new Error('PRIVATE_SENTINEL')])assert.equal(getVeniceDiagnostic(value),null);
});
test('billing stages and categories are fixed values',()=>{
 for(const stage of ['missing-result/usage','cap','cached-billing','final-receipt-validation'])assert.equal(getVeniceDiagnostic(veniceDiagnosticError('billing-validation',{billingStage:stage,httpStatus:200})).billingStage,stage);
 assert.equal(getVeniceDiagnostic(veniceDiagnosticError('billing-validation',{billingStage:'PRIVATE_SENTINEL'})).billingStage,null);
 assert.equal(getVeniceDiagnostic(veniceDiagnosticError('PRIVATE_SENTINEL')).category,'transport-unknown');
});
