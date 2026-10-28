import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sha256} from './release/bundle.mjs';
import {assertBaselineTestIsolation,retainBaselineTestInputs} from './release/prepare.mjs';

// The full pinned build installs the locked TOML parser before these tests.
// Keep the untrusted PR focused lane dependency-free.
async function testInputFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-test-input-')),candidate=root+'-candidate';t.after(()=>Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(candidate,{recursive:true,force:true})]));
 const input='billboard/private_fee_test/src/lib.nr',files={
  'billboard/Nargo.toml':'[workspace]\nmembers=["private_fee_test","rolling_contract"]\n',
  'billboard/private_fee_test/Nargo.toml':'[package]\nname="private_fee_test"\ntype="lib"\n[dependencies]\nprivate_fee_contract={path="../private_fee_contract"}\n',
  'billboard/rolling_contract/Nargo.toml':'[package]\nname="rolling_contract"\ntype="contract"\n[dependencies]\nowner_delivery={path="../owner_delivery"}\n',
  'billboard/owner_delivery/Nargo.toml':'[package]\nname="owner_delivery"\ntype="lib"\n',
  [input]:'original test input',
  '.build/contracts-manifest.json':JSON.stringify({inputs:{[input]:sha256('original test input')},rollingBoard:'retained-artifact-hash'}),
  '.build/sdk/sdk-manifest.json':JSON.stringify({inputs:{'shared/sdk-entry.mjs':'retained-sdk-input'}}),
 };
 for(const name of ['billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','plugins/adapter_artifact.json','experiments/private-bok/target/private_bok-PrivateBok.json'])files[name]=JSON.stringify({file_map:{0:{path:'billboard/production/src/main.nr',source:'original production source'}}});
 for(const [name,bytes]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);}
 await fs.mkdir(path.dirname(path.join(candidate,input)),{recursive:true});await fs.writeFile(path.join(candidate,input),'updated candidate test input');
 return {root,candidate,input,manifest:{files:Object.fromEntries(Object.keys(files).map(name=>[name,{}]))},write:async(name,bytes)=>fs.writeFile(path.join(root,name),bytes)};
}
test('the single non-runtime test input is copied from baseline without rewriting provenance',async t=>{
 const f=await testInputFixture(t),before=await fs.readFile(path.join(f.root,'.build/contracts-manifest.json'));
 await retainBaselineTestInputs(f.root,f.candidate,f.manifest,[f.input]);
 assert.equal(await fs.readFile(path.join(f.candidate,f.input),'utf8'),'original test input');
 assert.deepEqual(await fs.readFile(path.join(f.root,'.build/contracts-manifest.json')),before);
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
