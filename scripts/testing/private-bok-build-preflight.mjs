import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ARTIFACT,BOARD_ARTIFACT,MANIFEST,buildInputs,sha} from '../../experiments/private-bok/build.mjs';

// Read-only early rejection. The fixture still verifies its own inputs before use.
export async function verifyPrivateBokBuild({readFile=fs.readFile,inputs=buildInputs()}={}) {
  const manifestBytes=await readFile(MANIFEST);
  const manifest=JSON.parse(manifestBytes);
  assert.deepEqual(manifest.inputs,inputs,'PrivateBok build inputs are stale; run its normal build');
  for(const [filename,key,name] of [[ARTIFACT,'artifactSha256','PrivateBok'],[BOARD_ARTIFACT,'boardArtifactSha256','InvocationProbeBoard']]) {
    const bytes=await readFile(filename);
    assert.equal(sha(bytes),manifest[key],'PrivateBok build output differs from its manifest');
    const artifact=JSON.parse(bytes);
    assert.equal(artifact.name,name);assert.equal(artifact.transpiled,true);
    assert(Array.isArray(artifact.functions)&&artifact.functions.length>0);
    const privateFunctions=artifact.functions.filter(fn=>fn.custom_attributes?.includes('abi_private'));
    if(name==='PrivateBok')assert(privateFunctions.length>0);
    assert(privateFunctions.every(fn=>typeof fn.verification_key==='string'&&fn.verification_key.length>0),'Private verification keys are missing');
  }
  return {manifestSha256:sha(manifestBytes),artifactSha256:manifest.artifactSha256,boardArtifactSha256:manifest.boardArtifactSha256,inputCount:Object.keys(inputs).length};
}
