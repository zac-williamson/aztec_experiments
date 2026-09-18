import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {applicationNativeProfile} from './c01-native-profile.mjs';
test('private prover profile defaults to one and explicitly supports two',()=>{
  assert.deepEqual(applicationNativeProfile('/private/tmp/test',{}),{threads:1,bbPath:'/private/tmp/test/bb-one-thread'});
  for(const threads of ['1','2']) assert.deepEqual(applicationNativeProfile('/private/tmp/test',{C01_APPLICATION_BB_THREADS:threads}),{threads:Number(threads),bbPath:`/private/tmp/test/bb-${threads==='1'?'one-thread':'two-threads'}`});
});
test('invalid counts and relative directories fail before singleton initialization',()=>{
  for(const value of ['',0,1,2,'0','3','02',' 2','2\n','auto',null]) assert.throws(()=>applicationNativeProfile('/private/tmp/test',{C01_APPLICATION_BB_THREADS:value}));
  for(const directory of ['', 'relative',undefined,1])assert.throws(()=>applicationNativeProfile(directory,{}));
});
test('scenario resource choices retain established native budgets',async()=>{
 const {getScenario}=await import('./testing/scenarios.mjs');
 assert.equal(getScenario('contention').applicationThreads,2);
 for(const name of ['browser-post','browser-journey','browser-post-recovery','private-fees','censor-commands'])assert.equal(getScenario(name).applicationThreads,1);
});
