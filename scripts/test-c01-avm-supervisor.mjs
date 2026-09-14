// Real disposable process topology, no compiler/prover/network. Uses the actual build supervisor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {OwnedBuildTree} from './build-c01-avm.mjs';
import {assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();

const leafCode=`
globalThis.memory=Buffer.alloc(64*1024*1024,91);
process.on('SIGTERM',()=>{});
setInterval(()=>{globalThis.memory[0]^=1;},1000);
process.send({ready:true,pid:process.pid});
`;
const rootCode=`
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(leafCode)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
child.on('message',message=>process.send(message));
process.on('message',message=>{if(message==='exit-root'){child.disconnect();child.unref();process.exit(0);}});
setInterval(()=>{},1000);
`;
async function fixture(){
  const child=spawn(process.execPath,['-e',rootCode],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
  const tree=new OwnedBuildTree(child.pid);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  let watchdog,leafPid;
  const started=new Promise((resolve,reject)=>{
    watchdog=setTimeout(()=>reject(new Error('Fixture readiness exceeded 10 seconds')),10000);
    child.once('error',reject);child.once('message',message=>{leafPid=message.pid;resolve(message);});
  });
  async function cleanup(){
    clearTimeout(watchdog);
    try{await tree.cleanup();}finally{
      // Explicit fixture identities only; backup if an assertion failed before descendant discovery.
      for(const pid of [leafPid,child.pid].filter(Boolean))try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    }
    await exited;
  }
  try{await started;clearTimeout(watchdog);return {child,tree,exited,get leafPid(){return leafPid;},cleanup};}
  catch(error){await cleanup();throw error;}
}
function assertCompilerIncluded(snapshot,rootPid,leafPid){
  const root=snapshot.members.find(row=>row.pid===rootPid),leaf=snapshot.members.find(row=>row.pid===leafPid);
  assert(root&&leaf,'PPID traversal must include the compiler-like detached child');
  assert.equal(leaf.ppid,rootPid);assert.notEqual(leaf.group,root.group);
  assert.equal(leaf.group,leafPid,'Fixture really created a separate process group');
  assert(leaf.rssKiB>32768,'Committed fixture memory must be observed');
  assert.equal(snapshot.rssKiB,snapshot.members.reduce((sum,row)=>sum+row.rssKiB,0));
  assert(snapshot.rssKiB>=root.rssKiB+leaf.rssKiB);
}
test('actual descendant accounting includes memory in a child-created process group and cleans it', {timeout:20000},async()=>{
  const f=await fixture();
  try{
    const snapshot=await f.tree.sample();assertCompilerIncluded(snapshot,f.child.pid,f.leafPid);
    await f.tree.cleanup();await f.exited;
    assert.equal((await f.tree.sample()).members.length,0);
    assert.throws(()=>process.kill(f.leafPid,0),{code:'ESRCH'});
  }finally{await f.cleanup();}
});
test('remembered descendant identity survives parent exit and remains counted and terminated',{timeout:20000},async()=>{
  const f=await fixture();
  try{
    assertCompilerIncluded(await f.tree.sample(),f.child.pid,f.leafPid);
    f.child.send('exit-root');assert.equal((await f.exited).code,0);
    const orphan=await f.tree.sample();
    assert(!orphan.members.some(row=>row.pid===f.child.pid));
    assert(orphan.members.some(row=>row.pid===f.leafPid));assert(orphan.rssKiB>32768);
    // The same freeze-before-cleanup path is used by build deadline/SIGINT/SIGTERM handlers.
    f.tree.signalRemembered('SIGSTOP');await f.tree.cleanup();
    assert.equal((await f.tree.sample()).members.length,0);
    assert.throws(()=>process.kill(f.leafPid,0),{code:'ESRCH'});
  }finally{await f.cleanup();}
});
