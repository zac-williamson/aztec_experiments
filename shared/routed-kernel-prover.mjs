import {Buffer} from 'node:buffer';
import {BBLazyPrivateKernelProver} from '@aztec-labs/bb-prover/client/lazy';
import {ChonkProof,ChonkProofWithPublicInputs} from '@aztec-labs/stdlib/proofs';
import {Barretenberg,CircuitKind,flattenChonkProofFields} from '@aztec-foundation/bb.js';
/** Keeps SDK witness generation; swaps only the proof transport interface. */
export function routedKernelProverClass(Base){return class extends Base {
 constructor(simulator,options,{transport,proofsEnabled=true}){super(simulator,options);this.transport=transport;this.proofsEnabled=proofsEnabled;}
 setTransport(transport){this.transport=transport;}
 async generateResetTailOutput(inputs){const result=await super.generateResetTailOutput(inputs);this.tailInputs=result.publicInputs.publicInputs().toFields();return result;}
 async createChonkProof(steps){
  if(this.proofsEnabled&&!this.transport)return super.createChonkProof(steps);
  const result=await this.transport.prove(steps,this.tailInputs);
  if(!this.proofsEnabled){if(result.mode!=='disabled')throw Error('Development proof mode mismatch');return ChonkProof.random().attachPublicInputs(this.tailInputs);}
  if(result.mode!=='real'||typeof result.compressedProof!=='string'||result.compressedProof.length>200000)throw Error('Invalid remote proof');
  const compressedProof=Buffer.from(result.compressedProof,'base64');
  const bb=await Barretenberg.initSingleton({...this.options,logger:()=>{}});
  const {proof}=await bb.chonkDecompressProof({compressedProof});
  const finalStep=steps.at(-1),vk=finalStep?.vk;
  if(finalStep?.kind!==CircuitKind.HidingKernel||!(vk instanceof Uint8Array)||vk.length===0)throw Error('Missing pinned hiding-kernel verification key');
  if((await bb.chonkVerify({proof,vk})).valid!==true)throw Error('Remote proof verification failed');
  const output=ChonkProofWithPublicInputs.fromBufferArray(flattenChonkProofFields(proof));output.compressedProof=compressedProof;return output;
 }
};}
export const RoutedKernelProver=routedKernelProverClass(BBLazyPrivateKernelProver);
