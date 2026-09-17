import { Buffer } from 'node:buffer';
import { createPXE as createSdkPXE } from '@aztec/pxe/client/lazy';
import { Barretenberg, BackendType } from '@aztec/bb.js';
import { BBLazyPrivateKernelProver } from '@aztec/bb-prover/client/lazy';
import { WASMSimulator } from '@aztec/simulator/client';
import { ChonkProofWithPublicInputs } from '@aztec/stdlib/proofs';
import { proveBrowserChonk } from './browser-chonk-stream.mjs';

// PXE/prover diagnostics may contain private execution data. The application
// reports bounded progress and public receipt identifiers through its own UI.
const discard=()=>{};
const privateLogger=Object.freeze({
  trace:discard,debug:discard,verbose:discard,info:discard,warn:discard,error:discard,fatal:discard,
  level:'silent',module:'billboard-private',isLevelEnabled:()=>false,
  createChild:()=>privateLogger,getBindings:()=>({}),
});
const browserCrsInitializations=new WeakMap();
const browserFailure=()=>Object.assign(new Error('Browser proving setup could not be verified. Reload this page and check the locally hosted setup files.'),{code:'BB_BROWSER_PROVER_CONFIGURATION'});
export async function initializeBrowserProver(supplied) {
  if(supplied!==undefined && (!supplied || typeof supplied!=='object' || Array.isArray(supplied) || typeof supplied.createChonkProof==='function'))throw browserFailure();
  const proverOrOptions={...supplied,backend:BackendType.WasmWorker,threads:2,skipSrsInit:true};
  try {
    // Disable the SDK's automatic NetCrs download. Both initialization policy
    // and verified SRS must belong to this exact async singleton/worker heap.
    const singleton=await Barretenberg.initSingleton({...proverOrOptions,logger:discard});
    if(singleton.options.backend!==BackendType.WasmWorker || singleton.options.threads!==2 || singleton.options.skipSrsInit!==true)throw browserFailure();
    let initialization=browserCrsInitializations.get(singleton);
    if(!initialization){
      initialization=(async()=>{
        const crs=globalThis.BillboardCRS;
        if(!crs)throw browserFailure();
        await crs.initialize(singleton,{
          manifest:globalThis.BILLBOARD_CRS_MANIFEST,
          // Pinned BB 5.2.0 DEFAULT_BB_CRS_SIZE for client Chonk.
          bn254NumPoints:524288,
          loadLocal:async file=>crs.readResponse(await fetch('crs/'+file.name,{signal:AbortSignal.timeout(120000),credentials:'omit',redirect:'error'}),file),
          // Browser deployment must serve the pinned local files. Never route
          // fallback downloads around the deployment's local asset boundary.
          fetch:async()=>{throw browserFailure();},
          sha256:async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join(''),
          log:discard,
        });
      })();
      browserCrsInitializations.set(singleton,initialization);
      initialization.catch(()=>{if(browserCrsInitializations.get(singleton)===initialization)browserCrsInitializations.delete(singleton);});
    }
    await initialization;
    return proverOrOptions;
  }catch{throw browserFailure();}
}
// Keep the SDK circuit simulator/artifact provider. Only the application-to-BB
// input lifetime changes: each circuit is consumed before expanding the next.
class BrowserPrivateKernelProver extends BBLazyPrivateKernelProver {
  async createChonkProof(executionSteps) {
    const bb=await Barretenberg.initSingleton({...this.options,logger:discard});
    const result=await proveBrowserChonk(executionSteps,bb);
    const proof=ChonkProofWithPublicInputs.fromBufferArray(result.proofFields);
    proof.compressedProof=result.compressedProof?Buffer.from(result.compressedProof):undefined;
    return proof;
  }
}
export async function createPXE(node,config,options={}) {
  let selected=options;
  if(typeof window !== 'undefined') {
    const proverOrOptions=await initializeBrowserProver(options.proverOrOptions);
    const simulator=options.simulator??new WASMSimulator();
    selected={...options,simulator,proverOrOptions:new BrowserPrivateKernelProver(simulator,{...proverOrOptions,logger:privateLogger})};
  }
  return createSdkPXE(node,config,{...selected,loggers:{store:privateLogger,pxe:privateLogger,prover:privateLogger}});
}
