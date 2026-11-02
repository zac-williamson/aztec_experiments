import test from 'node:test';
import assert from 'node:assert/strict';
import {createProvingPreference,readRemoteProvingPreference} from './proving-preference.mjs';
function storage(initial){let value=initial;return {getItem:()=>value,setItem:(key,next)=>{assert.equal(key,'rolling.remote-proving.v1');value=next;}};}
test('proving preference defaults remote and retains explicitly selected local across visits',async()=>{
 const saved=storage(),calls=[];const p=createProvingPreference({storage:saved,apply:async value=>{calls.push(value);return value;}});
 assert.equal(p.state().remote,true);await p.setRemote(false);assert.equal(p.state().remote,false);assert.equal(readRemoteProvingPreference(saved),false);
 const next=createProvingPreference({storage:saved,apply:async value=>value});assert.equal(next.state().remote,false);await next.setRemote(true);assert.equal(readRemoteProvingPreference(saved),true);assert.deepEqual(calls,[false]);
});
test('proving mode commits only after worker acknowledgement and serializes rapid changes',async()=>{
 let resolve;const saved=storage('remote'),calls=[];const p=createProvingPreference({storage:saved,apply:value=>{calls.push(value);return new Promise(r=>{resolve=r;});}});
 const pending=p.setRemote(false);assert.deepEqual(p.state(),{remote:true,busy:true,error:''});assert.equal(readRemoteProvingPreference(saved),true);
 await p.setRemote(false);assert.equal(calls.length,1);resolve(false);await pending;assert.equal(p.state().remote,false);assert.equal(p.state().busy,false);
});
test('busy or failed local setup retains previous route preference; explicit retry works',async()=>{
 const saved=storage('remote');let failure='ROLLING_BUSY';const p=createProvingPreference({storage:saved,apply:async value=>{if(failure)throw Object.assign(Error(),{code:failure});return value;}});
 await p.setRemote(false);assert.equal(p.state().remote,true);assert.match(p.state().error,/Finish your current action/);assert.equal(readRemoteProvingPreference(saved),true);
 failure='BB_BROWSER_PROVER_CONFIGURATION';await p.setRemote(false);assert.equal(p.state().remote,true);assert.match(p.state().error,/previous setting/);
 failure=null;await p.setRemote(false);assert.equal(p.state().remote,false);assert.equal(p.state().error,'');
});
test('storage denial leaves an applied in-memory choice usable and visible',async()=>{
 const saved={getItem(){throw Error();},setItem(){throw Error();}};assert.equal(readRemoteProvingPreference(saved),true);
 const p=createProvingPreference({storage:saved,apply:async value=>value});await p.setRemote(false);assert.equal(p.state().remote,false);assert.match(p.state().error,/could not be saved/);
});
