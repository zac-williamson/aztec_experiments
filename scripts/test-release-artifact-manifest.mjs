import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {noirInventory,solidityInventory,assertManifestMatches,binaryDigest} from './release-artifact-manifest.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const board=read('apps/src/billboard/billboard_artifact.json');
const portal=read('billboard/portal/out/BillboardPortal.sol/BillboardPortal.json');
test('actual raw Noir inventory survives JSON round trip including absent optional metadata',()=>{
 const inventory=noirInventory(board);assertManifestMatches(JSON.parse(JSON.stringify(inventory)),inventory);
 const privateFns=board.functions.filter(f=>f.custom_attributes.includes('abi_private'));
 assert(privateFns.length>0);
 for(const f of privateFns)assert.match(inventory.functions[f.name].verificationKeySha256,/^[0-9a-f]{64}$/);
});
test('missing VK, duplicate functions and malformed encoded bytecode are rejected',()=>{
 let changed=structuredClone(board);delete changed.functions.find(f=>f.custom_attributes.includes('abi_private')).verification_key;
 assert.throws(()=>noirInventory(changed),/Missing private verification key/);
 changed=structuredClone(board);changed.functions.push(changed.functions[0]);assert.throws(()=>noirInventory(changed),/Duplicate/);
 for(const malformed of ['', 'not base64', 'AAAA!', 'A'])assert.throws(()=>binaryDigest(malformed,'fixture'));
});
test('runtime is labeled a template with immutable references and byte changes invalidate inventory',()=>{
 const inventory=solidityInventory(portal);assert.match(inventory.runtimeMeaning,/template.*immutables/);
 assert.deepEqual(inventory.immutableReferences,portal.deployedBytecode.immutableReferences);
 const changed=structuredClone(portal),before=changed.deployedBytecode.object;
 changed.deployedBytecode.object=(before.startsWith('0x00')?'0x01':'0x00')+before.slice(4);
 assert.notEqual(solidityInventory(changed).runtimeTemplateSha256,inventory.runtimeTemplateSha256);
 assert.throws(()=>assertManifestMatches(solidityInventory(changed),inventory),/differs/);
});
test('removed assets, source drift and changed verification keys fail complete inventory comparison',()=>{
 const inventory={files:{'worker.js':'a','proof.wasm':'b'},inputs:{'app.js':'c'},contracts:{billboard:noirInventory(board)}};
 for(const mutate of [m=>delete m.files['worker.js'],m=>m.inputs['app.js']='stale',m=>m.contracts.billboard.functions.post.verificationKeySha256='altered']){
  const altered=structuredClone(inventory);mutate(altered);assert.throws(()=>assertManifestMatches(altered,inventory),/differs/);
 }
});
