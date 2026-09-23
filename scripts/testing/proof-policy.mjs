import {BBBundlePrivateKernelProver} from '@aztec/bb-prover/client/bundle';
// Test-only policy; witness generation stays on in both modes.
import {routedKernelProverClass} from '../../shared/routed-kernel-prover.mjs';
import {createRemoteProverClient} from '../../shared/remote-prover-client.mjs';
import {WASMSimulator} from '@aztec/simulator/client';
const RoutedKernelProver=routedKernelProverClass(BBBundlePrivateKernelProver);
export function applicationProofsEnabled(){const mode=process.env.BOARD_TEST_PROOFS??'real';if(!['real','disabled'].includes(mode))throw Error('Invalid BOARD_TEST_PROOFS');return mode==='real';}
export function applicationProver(options,remote){
 if(applicationProofsEnabled()&&!remote)return options;
 return new RoutedKernelProver(new WASMSimulator(),options,{proofsEnabled:applicationProofsEnabled(),transport:remote?createRemoteProverClient({...remote,proofsEnabled:applicationProofsEnabled(),pollMs:100}):{prove:async()=>({mode:'disabled'})}});
}
