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
 for(const name of ['browser-firefox-post','browser-webkit-post','browser-post','browser-journey','browser-post-recovery','private-fees','censor-commands'])assert.equal(getScenario(name).applicationThreads,1);
});

test('local timing has an SDK-valid build window and Inbox readiness headroom',async()=>{
 const {LOCAL_TIMING}=await import('./testing/fixture-worker.mjs');
 const {buildProposerTimetable}=await import('@aztec/stdlib/timetable');
 const timetable=buildProposerTimetable(LOCAL_TIMING,{slotDuration:LOCAL_TIMING.aztecSlotDuration,ethereumSlotDuration:LOCAL_TIMING.ethereumSlotDuration,l1GenesisTime:0n});
 assert(timetable.getMaxBlocksPerCheckpoint()>=1);
 assert.equal(LOCAL_TIMING.inboxLag,2);
 const nominalBridgeSeconds=(LOCAL_TIMING.inboxLag+1)*LOCAL_TIMING.aztecSlotDuration+LOCAL_TIMING.blockDurationMs/1000+LOCAL_TIMING.ethereumSlotDuration;
 assert(nominalBridgeSeconds<20,'Local protocol delay must fit the unchanged browser readiness bound');
});
