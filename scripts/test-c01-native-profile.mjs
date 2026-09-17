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
test('parent bounds only contention private proving; node and world state remain at one',async()=>{
  const parent=await fs.readFile(new URL('./test-c01-application.mjs',import.meta.url),'utf8');
  const node=await fs.readFile(new URL('./c01-real-node.mjs',import.meta.url),'utf8');
  assert(parent.includes("const contention=postingDiagnostic||process.argv[2]==='--contention'"));
  assert(parent.includes('const applicationThreads=contention?2:1'));
  assert(parent.includes("HARDWARE_CONCURRENCY:'1',C01_APPLICATION_BB_THREADS:String(applicationThreads)"));
  assert(parent.includes('const DEADLINE_MS = 540000'));
  assert(parent.includes('const RSS_LIMIT_KIB = 2 * 1024 * 1024'));
  assert(node.includes("bbBinaryPath:path.join(directory,'bb-one-thread')"));
  assert(node.includes('bbChonkVerifyMaxBatch:1,bbChonkVerifyConcurrency:1,bbIVCConcurrency:1,numConcurrentIVCVerifiers:1'));
});
