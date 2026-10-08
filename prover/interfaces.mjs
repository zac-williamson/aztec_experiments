/**
 * API contracts shared by adapters. Implementations are supplied at composition roots.
 *
 * @typedef {{mode:'disabled'} | {mode:'real', compressedProof:string}} ProofResult
 * @typedef {{prove: (file:string) => Promise<ProofResult>, close: () => Promise<void>}} ProofWorker
 * @typedef {{state:'queued'|'running'|'complete'|'failed', result?:ProofResult, code?:string}} JobStatus
 * @typedef {{submit:(body:Uint8Array, client:string)=>Promise<string>, get:(id:string)=>JobStatus|null, stats:()=>{jobs:number,bytes:number,running:boolean,submitted:number,completed:number,failed:number}, close:()=>Promise<void>}} ProofQueue
 * @typedef {{prove:(steps:Array<{bytecode:Uint8Array,vk:Uint8Array,witness:Map<number,string>}>)=>Promise<ProofResult>}} ProofTransport
 */
export {};
