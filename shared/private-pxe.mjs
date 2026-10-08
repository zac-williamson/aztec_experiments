import {RoutedKernelProver} from './routed-kernel-prover.mjs';
import {createRemoteProverClient} from './remote-prover-client.mjs';
import { Buffer } from 'node:buffer';
import { createPXE as createSdkPXE } from '@aztec/pxe/client/lazy';
import { Barretenberg, BackendType } from '@aztec/bb.js';
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
let cliProverInitialization;
const cliFailure=()=>Object.assign(new Error('Local CLI proving setup could not be verified.'),{code:'BB_CLI_PROVER_CONFIGURATION'});
const cliOptions=Object.freeze({backend:BackendType.Wasm,threads:1,skipSrsInit:true});
export async function initializeCliProver(input) {
  if(typeof window!=='undefined'||!input||Object.keys(input).sort().join(',')!=='loadLocal,manifest,sha256'||typeof input.loadLocal!=='function'||typeof input.sha256!=='function')throw cliFailure();
  try {
    const singleton=await Barretenberg.initSingleton({...cliOptions,logger:discard});
    if(singleton.options.backend!==cliOptions.backend||singleton.options.threads!==1||singleton.options.skipSrsInit!==true)throw cliFailure();
    // Every call verifies supplied local assets; no prior success authenticates a
    // different manifest or byte source. Publish readiness only after full checks.
    cliProverInitialization=undefined;
    const crs=globalThis.BillboardCRS;if(!crs)throw cliFailure();
    await crs.initialize(singleton,{...input,bn254NumPoints:524288,fetch:async()=>{throw cliFailure();},log:discard});
    cliProverInitialization={singleton,options:cliOptions};
    return {...cliOptions};
  }catch{cliProverInitialization=undefined;throw cliFailure();}
}
const browserFailure=()=>Object.assign(new Error('Browser proving setup could not be verified. Reload this page and check the locally hosted setup files.'),{code:'BB_BROWSER_PROVER_CONFIGURATION'});
export async function initializeBrowserProver(supplied) {
  if(supplied!==undefined && (!supplied || typeof supplied!=='object' || Array.isArray(supplied) || typeof supplied.createChonkProof==='function'))throw browserFailure();
  const proverOrOptions={...supplied,backend:BackendType.WasmWorker,threads:1,skipSrsInit:true};
  try {
    // Disable the SDK's automatic NetCrs download. Both initialization policy
    // and verified SRS must belong to this exact async singleton/worker heap.
    const singleton=await Barretenberg.initSingleton({...proverOrOptions,logger:discard});
    if(singleton.options.backend!==BackendType.WasmWorker || singleton.options.threads!==1 || singleton.options.skipSrsInit!==true)throw browserFailure();
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
class BrowserPrivateKernelProver extends RoutedKernelProver {
  async createChonkProof(executionSteps) {
    if(this.transport||!this.proofsEnabled)return super.createChonkProof(executionSteps);
    const bb=await Barretenberg.initSingleton({...this.options,logger:discard});
    const result=await proveBrowserChonk(executionSteps,bb);
    const proof=ChonkProofWithPublicInputs.fromBufferArray(result.proofFields);
    proof.compressedProof=result.compressedProof?Buffer.from(result.compressedProof):undefined;
    return proof;
  }
}
export async function createPXE(node,config,options={}) {
  let selected=options;
  let remote=options.remoteProver;
  const info=await node.getNodeInfo();
  const proofsEnabled=info?.realProofs!==false;
  if(!proofsEnabled && Number(info.l1ChainId)!==31337)throw Error('Disabled proofs require local devnet');
  const transport=()=>remote?createRemoteProverClient({...remote,chainId:info.l1ChainId,rollupVersion:info.rollupVersion,proofsEnabled}):proofsEnabled?null:{prove:async()=>({mode:'disabled'})};
  const route=(simulator,proverOptions)=>new RoutedKernelProver(simulator,proverOptions,{proofsEnabled,transport:transport()});
  if(typeof window !== 'undefined') {
    const proverOrOptions=await initializeBrowserProver(options.proverOrOptions);
    const simulator=options.simulator??new WASMSimulator();
    selected={...options,simulator,proverOrOptions:new BrowserPrivateKernelProver(simulator,{...proverOrOptions,logger:privateLogger},{proofsEnabled,transport:transport()})};
  }else if(remote||!proofsEnabled){
    const simulator=options.simulator??new WASMSimulator();selected={...options,simulator,proverOrOptions:route(simulator,options.proverOrOptions??{})};
  }else if(config?.proverEnabled===true){
    if(['proverOrOptions','backend','threads','skipSrsInit','bbPath'].some(key=>options[key]!==undefined||config[key]!==undefined)||options.simulator!==undefined||!cliProverInitialization)throw cliFailure();
    const initialized=cliProverInitialization;
    const singleton=await Barretenberg.initSingleton({...initialized.options,logger:discard});
    if(singleton!==initialized.singleton) {cliProverInitialization=undefined;throw cliFailure();}
    const simulator=new WASMSimulator();
    selected={...options,simulator,proverOrOptions:new BrowserPrivateKernelProver(simulator,{...initialized.options,logger:privateLogger},{proofsEnabled:true,transport:null})};
  }
  const pxe=await createSdkPXE(node,config,{...selected,loggers:{store:privateLogger,pxe:privateLogger,prover:privateLogger}});
  if(selected.proverOrOptions instanceof RoutedKernelProver)pxe.setRemoteProver=async value=>{remote=value;selected.proverOrOptions.setTransport(transport());};
  return pxe;
}
