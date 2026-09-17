import {flattenChonkProofFields} from '@aztec/bb.js';
import {serializeWitness} from '@aztec/noir-noirc_abi';
import {ungzip} from 'pako';

// Pinned 5.2.0 BBPrivateKernelProver/AztecClientBackend sequence, with one
// decompressed circuit/witness pair queued at a time. Original executionSteps
// remain caller-owned; this does not bound BB's intrinsic proof working set.
const activeBackends=new WeakSet(),failedBackends=new WeakSet();
const failure=()=>Object.assign(new Error('Browser transaction proof did not complete. Reload this page and check saved transactions before trying again.'),{code:'BB_BROWSER_PROOF_FAILED'});
export async function proveBrowserChonk(executionSteps,barretenberg) {
  if(!Array.isArray(executionSteps)||executionSteps.length===0||!barretenberg||activeBackends.has(barretenberg)||failedBackends.has(barretenberg))throw failure();
  activeBackends.add(barretenberg);
  try {
    await barretenberg.chonkStart({numCircuits:executionSteps.length});
    let lastBytecode;
    for(let index=0;index<executionSteps.length;index++){
      const step=executionSteps[index],bytecode=ungzip(step.bytecode);
      await barretenberg.chonkLoad({circuit:{name:step.functionName||`circuit_${index}`,bytecode,verificationKey:step.vk||new Uint8Array(0)}});
      await barretenberg.chonkAccumulate({witness:ungzip(serializeWitness(step.witness))});
      if(index===executionSteps.length-1)lastBytecode=bytecode;
    }
    const {proof}=await barretenberg.chonkProve({});
    const {bytes:vk}=await barretenberg.chonkComputeVk({circuit:{name:executionSteps.at(-1).functionName||'circuit',bytecode:lastBytecode},useZkFlavor:true});
    lastBytecode=undefined;
    const proofFields=flattenChonkProofFields(proof);
    // Same local native-structured verification performed by upstream
    // AztecClientBackend.verifyNative; never return an unchecked proof.
    const verification=await barretenberg.chonkVerify({proof,vk});
    if(verification.valid!==true)throw failure();
    const {compressedProof}=await barretenberg.chonkCompressProof({proof});
    if(!(compressedProof instanceof Uint8Array)||compressedProof.byteLength===0)throw failure();
    // Upstream PXE consumes these two fields to build ChonkProofWithPublicInputs.
    // Its unused msgpack copy of the structured proof is deliberately not made.
    return {proofFields,compressedProof};
  }catch{failedBackends.add(barretenberg);throw failure();}
  finally{activeBackends.delete(barretenberg);}
}
