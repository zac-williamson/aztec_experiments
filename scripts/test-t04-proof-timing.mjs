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
