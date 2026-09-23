import test from 'node:test';import assert from 'node:assert/strict';import {noirTestBatches} from './noir-test-batches.mjs';
test('all compiler-discovered tests execute exactly once within their package',()=>{
 const lines=Array.from({length:43},(_,i)=>`board mod::test_${i}`).concat(['plugin test_0','plugin test_1']);
 const batches=noirTestBatches(lines.join('\n'));assert.deepEqual(batches.map(x=>x.names.length),[20,20,3,2]);
 assert.deepEqual(batches.flatMap(x=>x.names.map(name=>x.packageName+' '+name)),lines);
});
test('missing, malformed and duplicate listings fail instead of skipping coverage',()=>{
 for(const value of ['', 'warning: incomplete list','board test\nboard test','board test extra'])assert.throws(()=>noirTestBatches(value),/Invalid/);
});
