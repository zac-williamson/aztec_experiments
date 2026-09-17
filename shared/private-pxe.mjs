import { createPXE as createSdkPXE } from '@aztec/pxe/client/bundle';
import { Barretenberg, BackendType } from '@aztec/bb.js';

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
export async function createPXE(node,config,options={}) {
  let selected=options;
  if(typeof window !== 'undefined') {
    const proverOrOptions=await initializeBrowserProver(options.proverOrOptions);
    selected={...options,proverOrOptions};
  }
  return createSdkPXE(node,config,{...selected,loggers:{store:privateLogger,pxe:privateLogger,prover:privateLogger}});
}
