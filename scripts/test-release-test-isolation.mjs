import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sha256} from './release/bundle.mjs';
import {assertBaselineTestIsolation,retainBaselineTestInputs,testInputsToRetain} from './release/prepare.mjs';

// The full pinned build installs the locked TOML parser before these tests.
// Keep the untrusted PR focused lane dependency-free.
const runtimeArtifacts=['billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','plugins/adapter_artifact.json','experiments/private-bok/target/private_bok-PrivateBok.json'];
const manifests=['.build/contracts-manifest.json','.build/sdk/sdk-manifest.json'];
async function testInputFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-test-input-')),candidate=root+'-candidate';t.after(()=>Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(candidate,{recursive:true,force:true})]));
 const input='billboard/private_fee_test/src/lib.nr',postingInput='billboard/rolling_contract/src/posting_tests.nr',inputs=[input,postingInput],files={
  'billboard/Nargo.toml':'[workspace]\nmembers=["private_fee_test","rolling_contract"]\n',
  'billboard/private_fee_test/Nargo.toml':'[package]\nname="private_fee_test"\ntype="lib"\n[dependencies]\nprivate_fee_contract={path="../private_fee_contract"}\n',
  'billboard/rolling_contract/Nargo.toml':'[package]\nname="rolling_contract"\ntype="contract"\n[dependencies]\nowner_delivery={path="../owner_delivery"}\n',
  'billboard/owner_delivery/Nargo.toml':'[package]\nname="owner_delivery"\ntype="lib"\n',
  [input]:'original test input',
  [postingInput]:'original posting tests',
  '.build/contracts-manifest.json':JSON.stringify({inputs:{[input]:sha256('original test input'),[postingInput]:sha256('original posting tests')},rollingBoard:'retained-artifact-hash'}),
  '.build/sdk/sdk-manifest.json':JSON.stringify({inputs:{'shared/sdk-entry.mjs':'retained-sdk-input'}}),
 };
 for(const name of runtimeArtifacts)files[name]=JSON.stringify({file_map:{0:{path:'billboard/production/src/main.nr',source:'original production source'}}});
 for(const [name,bytes]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);}
 for(const name of inputs){await fs.mkdir(path.dirname(path.join(candidate,name)),{recursive:true});await fs.writeFile(path.join(candidate,name),'updated candidate test input');}
 for(const name of [...runtimeArtifacts,...manifests]){await fs.mkdir(path.dirname(path.join(candidate,name)),{recursive:true});await fs.copyFile(path.join(root,name),path.join(candidate,name));}
 return {root,candidate,input,postingInput,inputs,manifest:{files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:sha256(bytes)}]))},write:async(name,bytes)=>fs.writeFile(path.join(root,name),bytes)};
}
test('both exact non-runtime test inputs are copied without rewriting artifacts or provenance',async t=>{
 const f=await testInputFixture(t),before=new Map();
 for(const name of [...runtimeArtifacts,...manifests])before.set(name,await fs.readFile(path.join(f.candidate,name)));
 await retainBaselineTestInputs(f.root,f.candidate,f.manifest,f.inputs);
 for(const name of f.inputs)assert.deepEqual(await fs.readFile(path.join(f.candidate,name)),await fs.readFile(path.join(f.root,name)));
 for(const [name,bytes]of before){assert.deepEqual(await fs.readFile(path.join(f.candidate,name)),bytes);assert.deepEqual(await fs.readFile(path.join(f.root,name)),bytes);}
 await assert.rejects(retainBaselineTestInputs(f.root,f.candidate,f.manifest,['billboard/private_fee_contract/src/main.nr']),{code:'RELEASE_TEST_INPUT_IS_NOT_ISOLATED'});
});
for(const defect of ['direct dependency','transitive dependency','alias dependency','contract crate','runtime file map','SDK input','changed original input'])test('test input reuse rejects '+defect,async t=>{
 const f=await testInputFixture(t);
 if(defect==='direct dependency')await f.write('billboard/rolling_contract/Nargo.toml','[dependencies]\nprivate_fee_test={path="../private_fee_test"}\n');
 if(defect==='transitive dependency')await f.write('billboard/owner_delivery/Nargo.toml','[dependencies]\nharness={path="../private_fee_test"}\n');
 if(defect==='alias dependency')await f.write('billboard/rolling_contract/Nargo.toml','[dependencies]\nharness={path="../owner_delivery/../private_fee_test"}\n');
 if(defect==='contract crate')await f.write('billboard/private_fee_test/Nargo.toml','[package]\nname="private_fee_test"\ntype="contract"\n');
 if(defect==='runtime file map')await f.write('apps/src/billboard/private_fee_artifact.json',JSON.stringify({file_map:{0:{path:f.input}}}));
 if(defect==='SDK input')await f.write('.build/sdk/sdk-manifest.json',JSON.stringify({inputs:{[f.input]:'hash'}}));
 if(defect==='changed original input')await f.write(f.input,'no longer the original compiled input');
 await assert.rejects(assertBaselineTestIsolation(f.root,f.manifest),{code:'RELEASE_TEST_INPUT_IS_NOT_ISOLATED'});
});
for(const artifact of runtimeArtifacts)test('posting test reuse rejects production file-map inclusion in '+artifact,async t=>{
 const f=await testInputFixture(t);
 await f.write(artifact,JSON.stringify({file_map:{0:{path:'/build/'+f.postingInput}}}));
 await assert.rejects(assertBaselineTestIsolation(f.root,f.manifest),{code:'RELEASE_TEST_INPUT_IS_NOT_ISOLATED'});
});
for(const defect of ['SDK exact input','SDK relocated basename','SDK Windows path','changed original posting input','missing original posting hash'])test('posting test reuse rejects '+defect,async t=>{
 const f=await testInputFixture(t);
 if(defect.startsWith('SDK')){
  const name=defect==='SDK exact input'?f.postingInput:defect==='SDK relocated basename'?'copied/posting_tests.nr':'copied\\posting_tests.nr';
  await f.write('.build/sdk/sdk-manifest.json',JSON.stringify({inputs:{[name]:'hash'}}));
 }
 if(defect==='changed original posting input')await f.write(f.postingInput,'changed posting tests');
 if(defect==='missing original posting hash')await f.write('.build/contracts-manifest.json',JSON.stringify({inputs:{[f.input]:sha256('original test input')}}));
 await assert.rejects(assertBaselineTestIsolation(f.root,f.manifest),{code:'RELEASE_TEST_INPUT_IS_NOT_ISOLATED'});
});
test('later releases still retain the baseline test bytes when the source revision already includes the test fix',async t=>{
 const f=await testInputFixture(t);f.manifest.revision='2'.repeat(40);
 assert.deepEqual(await testInputsToRetain(f.candidate,f.manifest),f.inputs);
 await retainBaselineTestInputs(f.root,f.candidate,f.manifest,f.inputs);
 assert.deepEqual(await testInputsToRetain(f.candidate,f.manifest),[]);
});
test('a later posting-only update retains only its differing sealed test input',async t=>{
 const f=await testInputFixture(t);f.manifest.revision='3'.repeat(40);
 await fs.copyFile(path.join(f.root,f.input),path.join(f.candidate,f.input));
 assert.deepEqual(await testInputsToRetain(f.candidate,f.manifest),[f.postingInput]);
 await retainBaselineTestInputs(f.root,f.candidate,f.manifest,[f.postingInput]);
 assert.deepEqual(await testInputsToRetain(f.candidate,f.manifest),[]);
});
for(const field of ['input','postingInput'])test('retained '+field+' must remain a regular candidate file',async t=>{
 const f=await testInputFixture(t),name=f[field];await fs.unlink(path.join(f.candidate,name));
 await assert.rejects(testInputsToRetain(f.candidate,f.manifest),{code:'ENOENT'});
 await fs.symlink(path.join(f.root,name),path.join(f.candidate,name));
 await assert.rejects(testInputsToRetain(f.candidate,f.manifest),{code:'RELEASE_SYMLINK'});
});
