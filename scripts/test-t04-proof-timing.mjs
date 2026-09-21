import test from 'node:test';
import assert from 'node:assert/strict';
import {readProofIntervals,clearProofIntervals} from './t04-browser-performance.mjs';
const names=['crs','pxe','proveTx','toTx'];
const clean=()=>{for(const name of names){performance.clearMeasures('billboard.'+name);performance.clearMarks('billboard.'+name);}};
const complete=name=>performance.measure('billboard.'+name,{start:0,end:10});
test('warm sample cannot reuse cold proof intervals, but initialization remains distinct',()=>{
 clean();try{
  names.forEach(complete);assert.deepEqual(readProofIntervals(),{crs:10,pxe:10,proveTx:10,toTx:10});
  clearProofIntervals();assert.throws(readProofIntervals,/Incomplete/);
  complete('proveTx');assert.throws(readProofIntervals,/Incomplete/);
  complete('toTx');assert.deepEqual(readProofIntervals(),{crs:10,pxe:10,proveTx:10,toTx:10});
 }finally{clean();}
});
test('pending or duplicate proof intervals cannot masquerade as a completed sample',()=>{
 clean();try{
  names.forEach(complete);performance.mark('billboard.proveTx');assert.throws(readProofIntervals,/Incomplete/);
  performance.clearMarks('billboard.proveTx');complete('proveTx');assert.throws(readProofIntervals,/Incomplete/);
 }finally{clean();}
});

test('benchmark gas is repeatable and independently mutable per run',async()=>{
 const {performanceGasSettings}=await import('./t04-browser-performance.mjs');
 const first=performanceGasSettings(),second=performanceGasSettings();
 assert.equal(first.getFeeLimit().toBigInt(),4375854878671200n);
 first.maxFeesPerGas.feePerL2Gas=1n;assert.equal(second.maxFeesPerGas.feePerL2Gas,669090960n);
});
test('phase observer forwards only fixed boundaries, never arbitrary performance entries',async()=>{
 const {observeProofPhases}=await import('./t04-browser-performance.mjs');
 const saved={location:globalThis.location,PerformanceObserver:globalThis.PerformanceObserver,recordProofPhase:globalThis.recordProofPhase};let callback,options;const records=[];
 try{
  globalThis.location={protocol:'https:'};globalThis.recordProofPhase=value=>records.push(value);
  globalThis.PerformanceObserver=class{constructor(cb){callback=cb;}observe(value){options=value;}};
  observeProofPhases();assert.deepEqual(options,{entryTypes:['mark','measure']});
  callback({getEntries:()=>[{name:'billboard.proveTx',entryType:'mark'},{name:'billboard.proveTx',entryType:'measure'},{name:'SECRET',entryType:'mark',detail:'SECRET'}]});
  assert.deepEqual(records,['proof-proveTx-start','proof-proveTx-complete']);
 }finally{Object.assign(globalThis,saved);}
});
