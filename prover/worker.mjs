// Single disposable worker: never log witnesses or SDK exceptions.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {decompressWitness} from '@aztec/noir-acvm_js';
import {abiDecode} from '@aztec/noir-noirc_abi';
import {Barretenberg,BackendType,AztecClientBackend} from '@aztec/bb.js';
import {loadCircuitCatalog} from './catalog.mjs';
import {decodeJob} from '../shared/remote-prover-wire.mjs';
let stage="read";
try{
 const {metadata,witnesses}=decodeJob(await fs.readFile(process.argv[2]));
 stage="catalog";
 const catalog=await loadCircuitCatalog(),circuits=metadata.circuits.map(id=>{const c=catalog.get(id);if(!c)throw Error('Unknown circuit');return c;});
 stage="decompress";
 let total=0;const raw=witnesses.map(w=>{const r=gunzipSync(w,{maxOutputLength:16*1024*1024});total+=r.length;if(total>64*1024*1024)throw Error('Witness limit');return r;});
 stage="board-binding";
 let boardCalls=0;
 for(let i=0;i<circuits.length;i++)if(circuits[i].functionName.startsWith('Billboard:')){
  const inputs=abiDecode(circuits[i].abi,decompressWitness(witnesses[i])).inputs;
  if(BigInt(inputs.inputs.call_context.contract_address.inner)!==BigInt(metadata.board))throw Error('Wrong board');
  if(BigInt(inputs.inputs.tx_context.chain_id)!==BigInt(metadata.chainId)||BigInt(inputs.inputs.tx_context.version)!==BigInt(metadata.rollupVersion))throw Error('Wrong network');boardCalls++;
 }
 if(!boardCalls)throw Error('Board operation required');
 stage='prove';
 if(metadata.mode==='disabled'){
  if(process.env.PROVER_PROOFS!=='disabled')throw Error('Mode mismatch');
  process.send({mode:'disabled'});
 }else{
  if(process.env.PROVER_PROOFS!=='real')throw Error('Mode mismatch');
  const api=await Barretenberg.initSingleton({backend:BackendType.NativeUnixSocket,bbPath:process.env.PROVER_BB,threads:Number(process.env.PROVER_THREADS),logger:()=>{}});
  const backend=new AztecClientBackend(circuits.map(c=>gunzipSync(c.bytecode)),api,circuits.map(c=>c.functionName));
  const result=await backend.prove(raw,circuits.map(c=>c.vk),{compress:true});
  process.send({mode:'real',compressedProof:Buffer.from(result.compressedProof).toString('base64')});
  await Barretenberg.destroySingleton();
 }
}catch{process.send?.({errorStage:stage});process.exitCode=1;}finally{process.disconnect?.();}
