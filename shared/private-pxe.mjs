import { createPXE as createSdkPXE } from '@aztec/pxe/client/bundle';

// PXE/prover diagnostics may contain private execution data. The application
// reports bounded progress and public receipt identifiers through its own UI.
const discard=()=>{};
const privateLogger=Object.freeze({
  trace:discard,debug:discard,verbose:discard,info:discard,warn:discard,error:discard,fatal:discard,
  level:'silent',module:'billboard-private',isLevelEnabled:()=>false,
  createChild:()=>privateLogger,getBindings:()=>({}),
});
export function createPXE(node,config,options={}) {
  return createSdkPXE(node,config,{...options,loggers:{store:privateLogger,pxe:privateLogger,prover:privateLogger}});
}
