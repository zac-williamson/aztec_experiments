import test from 'node:test';
import assert from 'node:assert/strict';
import {pricePrivateFeeGasSettings} from './network-fee-pricing.mjs';
const settings={gasLimits:{daGas:'117624',l2Gas:'6540000'},teardownGasLimits:{daGas:'512',l2Gas:'40000'},maxFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'18981708800000'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}};
test('current network price above deployed ceiling still produces a funded quote',()=>{
 const before=structuredClone(settings),p=pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:26836513600000n});
 assert.equal(p.maximumFee,351021597888000000000n);assert.equal(p.gasSettings.maxFeesPerGas.feePerL2Gas,'53673027200000');
 assert.deepEqual(settings,before);assert.deepEqual(p.gasSettings.gasLimits,settings.gasLimits);assert.deepEqual(p.gasSettings.teardownGasLimits,settings.teardownGasLimits);
});
test('prices follow decreases as well as increases without retaining an operator floor',()=>{
 const p=pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:100n});assert.equal(p.maximumFee,1308000000n);
});
test('an approved claim can use remaining buffer without increasing its spending approval',()=>{
 const quote=pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:100n});
 const claim=pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:150n},{maximumFee:quote.maximumFee});
 assert.equal(claim.maximumFee,981000000n);assert(claim.maximumFee<=quote.maximumFee);
 assert.throws(()=>pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:201n},{maximumFee:quote.maximumFee}),{code:'ROLLING_FEE_CHANGED'});
});
test('DA fees and priority fees count toward the maximum, including exact approval boundary',()=>{
 const s={...settings,gasLimits:{daGas:'100',l2Gas:'1000'},teardownGasLimits:{daGas:'10',l2Gas:'100'},maxPriorityFeesPerGas:{feePerDaGas:'3',feePerL2Gas:'5'}};
 const p=pricePrivateFeeGasSettings(s,{feePerDaGas:7n,feePerL2Gas:11n},{maximumFee:'17000'});assert.equal(p.maximumFee,17000n);
 assert.throws(()=>pricePrivateFeeGasSettings(s,{feePerDaGas:7n,feePerL2Gas:11n},{maximumFee:'16999'}),{code:'ROLLING_FEE_CHANGED'});
});
test('malformed prices, zero total and arithmetic overflow cannot authorize spending',()=>{
 for(const fee of [-1n,'1.5',Number.MAX_VALUE,undefined,1n<<128n,(1n<<127n)])assert.throws(()=>pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:fee}));
 assert.throws(()=>pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:0n}));
 assert.throws(()=>pricePrivateFeeGasSettings(settings,{feePerDaGas:0n,feePerL2Gas:1n<<120n}));
});
