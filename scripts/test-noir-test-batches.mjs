import test from 'node:test';import assert from 'node:assert/strict';import {noirTestBatches,noirTestRuntime} from './noir-test-batches.mjs';
test('all compiler-discovered tests execute exactly once within their package',()=>{
 const lines=Array.from({length:43},(_,i)=>`board mod::test_${i}`).concat(['plugin test_0','plugin test_1']);
 const batches=noirTestBatches(lines.join('\n'));assert.deepEqual(batches.map(x=>x.names.length),[20,20,3,2]);
 assert.deepEqual(batches.flatMap(x=>x.names.map(name=>x.packageName+' '+name)),lines);
});
test('missing, malformed and duplicate listings fail instead of skipping coverage',()=>{
 for(const value of ['', 'warning: incomplete list','board test\nboard test','board test extra'])assert.throws(()=>noirTestBatches(value),/Invalid/);
});

test('owner contract fixture uses its existing assertion oracles and processed test artifact only',()=>{
 assert.deepEqual(noirTestRuntime('owner_delivery_test'),{serviceArgs:['--preserve-symlinks','experiments/owner-state/txe-service.mjs'],artifact:'owner_delivery_test-OwnerPostingAccount.json',contract:'OwnerPostingAccount',threads:'1'});
 for(const name of ['rolling_contract','private_fee_test','plugin_adapter','another_test'])assert.deepEqual(noirTestRuntime(name),{serviceArgs:['scripts/txe-c01-service.mjs']});
 assert.throws(()=>noirTestRuntime('../owner_delivery_test'));
});
