import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProofQueue} from './queue.mjs';

test('health separates pending work from retained results without revealing clients or jobs',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rolling-queue-health-'));
 const started=[Promise.withResolvers(),Promise.withResolvers()],release=[Promise.withResolvers(),Promise.withResolvers()];let i=0;
 const worker={async prove(){const index=i++;started[index].resolve();await release[index].promise;return {proof:'private'};},async close(){for(const item of release)item.resolve();}};
 const queue=await createProofQueue({directory,worker});t.after(async()=>{await queue.close();await rm(directory,{recursive:true,force:true});});
 const first=await queue.submit(Buffer.from('PRIVATE_BODY'),'PRIVATE_CLIENT');await started[0].promise;
 const second=await queue.submit(Buffer.from('PRIVATE_BODY'),'PRIVATE_CLIENT');
 let stats=queue.stats();assert.equal(stats.jobs,2);assert.equal(stats.queued,1);assert.equal(stats.active,1);assert(stats.oldestJobAgeSeconds>=0);assert.equal(stats.lastWorkerMs,null);
 assert(!JSON.stringify(stats).includes('PRIVATE'));assert(!JSON.stringify(stats).includes(first));assert(!JSON.stringify(stats).includes(second));
 release[0].resolve();await started[1].promise;stats=queue.stats();
 assert.equal(stats.jobs,2);assert.equal(stats.queued,0);assert.equal(stats.active,1);assert.equal(stats.completed,1);assert.equal(stats.oldestJobAgeSeconds,0);assert(stats.lastWorkerMs>=0);assert(stats.lastQueueWaitMs>=0);
 release[1].resolve();await queue.waitForResult(second);stats=queue.stats();
 assert.equal(stats.jobs,2);assert.equal(stats.queued,0);assert.equal(stats.active,0);assert.equal(stats.completed,2);assert.equal(stats.oldestActiveAgeSeconds,0);
 await queue.acknowledge(first);await queue.acknowledge(second);assert.equal(queue.stats().jobs,0);
});

test('early result publication still counts the draining worker as active',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rolling-queue-health-')),published=Promise.withResolvers(),finish=Promise.withResolvers();
 const worker={async prove(_path,{onResult}){onResult({proof:'private'});published.resolve();await finish.promise;return {proof:'private'};},async close(){finish.resolve();}};
 const queue=await createProofQueue({directory,worker});t.after(async()=>{await queue.close();await rm(directory,{recursive:true,force:true});});
 const id=await queue.submit(Buffer.from('PRIVATE'),'PRIVATE');await published.promise;
 assert.equal(queue.get(id).state,'complete');assert.equal(queue.stats().queued,0);assert.equal(queue.stats().active,1);assert.equal(queue.stats().lastWorkerMs,null);
 finish.resolve();
});
