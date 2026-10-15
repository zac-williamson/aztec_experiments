import assert from 'node:assert/strict';
import test from 'node:test';
import {ARTIFACT,BOARD_ARTIFACT,MANIFEST,sha} from '../../experiments/private-bok/build.mjs';
import {verifyPrivateBokBuild} from './private-bok-build-preflight.mjs';

function fixture(){
  const inputs={'noir-dependencies.json':'current-inventory','escrow/src/main.nr':'current-source'};
  const bytes=object=>Buffer.from(JSON.stringify(object));
  const files=new Map([[ARTIFACT,bytes({name:'PrivateBok',transpiled:true,functions:[{custom_attributes:['abi_private'],verification_key:'fixture-key'}]})],
    [BOARD_ARTIFACT,bytes({name:'InvocationProbeBoard',transpiled:true,functions:[{custom_attributes:['abi_public']}]})]]);
  const updateManifest=()=>files.set(MANIFEST,bytes({inputs,artifactSha256:sha(files.get(ARTIFACT)),boardArtifactSha256:sha(files.get(BOARD_ARTIFACT))}));updateManifest();
  const readFile=async name=>{if(!files.has(name))throw Object.assign(Error('missing fixture file'),{code:'ENOENT'});return files.get(name);};
  return {inputs,files,readFile,updateManifest};
}
test('checks both outputs and source inventory without writing or rebuilding',async()=>{
  const f=fixture(),before=[...f.files].map(([k,v])=>[k,sha(v)]);const result=await verifyPrivateBokBuild(f);
  assert.deepEqual(result,{manifestSha256:sha(f.files.get(MANIFEST)),artifactSha256:sha(f.files.get(ARTIFACT)),boardArtifactSha256:sha(f.files.get(BOARD_ARTIFACT)),inputCount:2});
  assert.deepEqual([...f.files].map(([k,v])=>[k,sha(v)]),before);
});
test('rejects stale inventory before reading any generated artifact',async()=>{
  const f=fixture();f.inputs['noir-dependencies.json']='changed-inventory';const reads=[];
  await assert.rejects(verifyPrivateBokBuild({...f,readFile:async name=>{reads.push(name);return f.readFile(name);}}),/inputs are stale/);
  assert.deepEqual(reads,[MANIFEST]);
});
for(const filename of [MANIFEST,ARTIFACT,BOARD_ARTIFACT])test('rejects missing '+filename.split('/').at(-1),async()=>{
  const f=fixture();f.files.delete(filename);await assert.rejects(verifyPrivateBokBuild(f),{code:'ENOENT'});
});
for(const filename of [ARTIFACT,BOARD_ARTIFACT])test('rejects altered '+filename.split('/').at(-1),async()=>{
  const f=fixture();f.files.set(filename,Buffer.from('{}'));await assert.rejects(verifyPrivateBokBuild(f),/differs from its manifest/);
});
test('rejects an unprocessed artifact even when its manifest hash agrees',async()=>{
  const f=fixture();const a=JSON.parse(f.files.get(ARTIFACT));a.transpiled=false;f.files.set(ARTIFACT,Buffer.from(JSON.stringify(a)));f.updateManifest();await assert.rejects(verifyPrivateBokBuild(f));
});
test('rejects missing private VK even when its manifest hash agrees',async()=>{
  const f=fixture();const a=JSON.parse(f.files.get(ARTIFACT));delete a.functions[0].verification_key;f.files.set(ARTIFACT,Buffer.from(JSON.stringify(a)));f.updateManifest();await assert.rejects(verifyPrivateBokBuild(f),/verification keys/);
});
test('rejects malformed manifest',async()=>{
  const f=fixture();f.files.set(MANIFEST,Buffer.from('{'));await assert.rejects(verifyPrivateBokBuild(f),SyntaxError);
});
