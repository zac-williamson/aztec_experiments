import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Supervisor,describeFailure} from './supervisor.mjs';
import {getScenario} from './scenarios.mjs';

const options={cwd:process.cwd(),env:{PATH:'/usr/bin:/bin'}};
test('one owner preserves child outcome and verifies cleanup',{timeout:10000},async()=>{
  const report={},records=[];const owner=new Supervisor({report,deadlineMs:5000});
  try{
    const exit=await owner.start('fixture',process.execPath,['-e',"console.log(JSON.stringify({stage:'ready'}))"],{...options,onRecord:record=>records.push(record)});
    assert.equal(exit.code,0);assert.deepEqual(records,[{stage:'ready'}]);
  }finally{await owner.close();}
  assert.deepEqual(report.failures,[]);assert.equal(report.ownedTreeAbsent,true);
  assert.equal(report.children[0].code,0);assert.equal(report.children[0].cleanupComplete,true);
});
test('failed child is reported and does not lose its result during cleanup',{timeout:10000},async()=>{
  const report={},owner=new Supervisor({report,deadlineMs:5000});
  try{
    await owner.start('fixture',process.execPath,['-e','process.exit(7)'],options);
  }finally{await owner.close();}
  assert.equal(report.children[0].code,7);assert.equal(report.children[0].cleanupComplete,true);
  assert(report.failures.some(f=>f.stage==='fixture-exit'));
});
test('deadline terminates and reaps a real hanging process',{timeout:10000},async()=>{
  const report={},owner=new Supervisor({report,deadlineMs:250});
  try{await owner.start('fixture',process.execPath,['-e','setInterval(()=>{},1000)'],options);}
  finally{await owner.close();}
  assert(report.failures.some(f=>f.stage==='deadline'));assert.equal(report.ownedTreeAbsent,true);
  assert.equal(report.children[0].signal,'SIGKILL');
});
test('malformed worker output is a harness failure, not discarded',{timeout:10000},async()=>{
  const report={},owner=new Supervisor({report,deadlineMs:5000});
  try{await owner.start('fixture',process.execPath,['-e',"console.log('not-json');setInterval(()=>{},1000)"],options);}
  finally{await owner.close();}
  assert(report.failures.some(f=>f.stage==='fixture-output'));assert.equal(report.ownedTreeAbsent,true);
});
test('cleanup failure preserves the completed command and fails overall',{timeout:10000},async()=>{
  const report={},owner=new Supervisor({report,deadlineMs:5000});
  await owner.start('fixture',process.execPath,['-e','process.exit(0)'],options);
  owner.children[0].tree.cleanup=async()=>{throw Object.assign(Error('PRIVATE'),{name:'PRIVATE',code:'PRIVATE'});};
  await owner.close();assert.equal(report.children[0].code,0);assert.equal(report.ownedTreeAbsent,false);
  assert.equal(report.failures[0].stage,'fixture-cleanup');assert(!JSON.stringify(report).includes('PRIVATE'));
});
test('scenario selection is explicit and has no legacy/default route',()=>{
  for(const name of [undefined,'--bridge','bridge','--node','posting-diagnostic'])assert.throws(()=>getScenario(name));
  for(const name of ['node','included-board','activated-board','censor-commands','private-fees','private-fee-post','flagged-journey','unflagged-journey','redeposit','proof-recovery','note-attribution','contention','screening','browser-post','browser-journey','browser-post-recovery']){
    const scenario=getScenario(name);assert(Object.isFrozen(scenario));assert.equal(scenario.name,name);assert.equal(typeof scenario.run,'function');
  }
  assert.equal(getScenario('contention').authors,10);
  assert.equal(getScenario('censor-commands').fixture,'included-board');
});

test('first malformed record prevents subsequent stage callbacks',{timeout:10000},async()=>{
  const report={},records=[],owner=new Supervisor({report,deadlineMs:5000});
  try{await owner.start('fixture',process.execPath,['-e',`process.stdout.write('invalid\\n{"stage":"must-not-run"}\\n');setInterval(()=>{},1000)`],{...options,onRecord:record=>records.push(record)});}
  finally{await owner.close();}
  assert.deepEqual(records,[]);assert.equal(report.failures.length,1);
  assert.equal(report.failures[0].stage,'fixture-output');assert.equal(report.ownedTreeAbsent,true);
});
