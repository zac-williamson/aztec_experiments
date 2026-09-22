// Single disposable worker: never log witnesses or SDK exceptions.
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {decompressWitness} from '@aztec/noir-acvm_js';
import {abiDecode} from '@aztec/noir-noirc_abi';
import {Barretenberg,BackendType,AztecClientBackend} from '@aztec/bb.js';
import {loadCircuitCatalog} from './catalog.mjs';
import {decodeJob} from '../shared/remote-prover-wire.mjs';
// Native BB unrefs its process/socket between requests. Keep the job owner
// alive until its result has been sent and the backend has been destroyed.
process.channel?.ref();
const send=value=>new Promise((resolve,reject)=>process.send(value,error=>error?reject(error):resolve()));
let stage="read";
const setStage=value=>{stage=value;process.send?.({progress:stage});};
try{
 const {metadata,witnesses}=decodeJob(await fs.readFile(process.argv[2]));
 setStage("catalog");
 const catalog=await loadCircuitCatalog(),circuits=metadata.circuits.map(id=>{const c=catalog.get(id);if(!c)throw Error('Unknown circuit');return c;});
 setStage("decompress");
 let total=0;const raw=witnesses.map(w=>{const r=gunzipSync(w,{maxOutputLength:16*1024*1024});total+=r.length;if(total>64*1024*1024)throw Error('Witness limit');return r;});
 setStage("board-binding");
 let boardCalls=0,feeClaims=0;
 for(let i=0;i<circuits.length;i++)if(circuits[i].functionName.startsWith('Billboard:')){
  const inputs=abiDecode(circuits[i].abi,decompressWitness(witnesses[i])).inputs;
  if(BigInt(inputs.inputs.call_context.contract_address.inner)!==BigInt(metadata.board))throw Error('Wrong board');
  if(BigInt(inputs.inputs.tx_context.chain_id)!==BigInt(metadata.chainId)||BigInt(inputs.inputs.tx_context.version)!==BigInt(metadata.rollupVersion))throw Error('Wrong network');boardCalls++;
 }
 if(process.env.PROVER_PRIVATE_FEE)for(let i=0;i<circuits.length;i++)if(circuits[i].functionName.startsWith('PrivateFPC:')){
  const inputs=abiDecode(circuits[i].abi,decompressWitness(witnesses[i])).inputs;
  if(BigInt(inputs.inputs.call_context.contract_address.inner)!==BigInt(process.env.PROVER_PRIVATE_FEE))throw Error('Wrong fee contract');
  if(BigInt(inputs.inputs.tx_context.chain_id)!==BigInt(metadata.chainId)||BigInt(inputs.inputs.tx_context.version)!==BigInt(metadata.rollupVersion))throw Error('Wrong fee network');
  if(circuits[i].functionName==='PrivateFPC:mint_and_pay_fee')feeClaims++;
 }
 if(!boardCalls&&!feeClaims)throw Error('Board operation or authorized fee claim required');
 setStage('prove');
 if(metadata.mode==='disabled'){
  if(process.env.PROVER_PROOFS!=='disabled')throw Error('Mode mismatch');
  await send({mode:'disabled'});
 }else{
  if(process.env.PROVER_PROOFS!=='real')throw Error('Mode mismatch');
  setStage("native-init");
  const api=await Barretenberg.initSingleton({backend:BackendType.NativeUnixSocket,bbPath:process.env.PROVER_BB,threads:Number(process.env.PROVER_THREADS),logger:()=>{}});
  // The SDK pipelines these calls without awaiting their promises. Observe
  // rejected calls so one invalid job cannot crash before the final error handler.
  let firstFailure;
  for(const name of ['chonkStart','chonkLoad','chonkAccumulate']){const call=api[name].bind(api);api[name]=(...args)=>{const result=call(...args);result.catch(error=>{firstFailure??=error;});return result;};}
  const backend=new AztecClientBackend(circuits.map(c=>gunzipSync(c.bytecode)),api,circuits.map(c=>c.functionName));
  setStage("native-prove");
  let result;try{result=await backend.prove(raw,circuits.map(c=>c.vk),{compress:true});}catch(error){throw firstFailure??error;}
  await send({mode:'real',compressedProof:Buffer.from(result.compressedProof).toString('base64')});
  await Barretenberg.destroySingleton();
 }
}catch(error){
 const message=String(error?.message??'');
 if(stage==='native-prove'){if(/srs|crs|grumpkin g1/i.test(message))stage='native-srs';else if(/assertion|constraint/i.test(message))stage='native-constraint';else if(/verification|verify/i.test(message))stage='native-verification';else if(/socket|process exited|signal/i.test(message))stage='native-process';}
 await send({errorStage:stage});process.exitCode=1;}finally{await Barretenberg.destroySingleton();process.disconnect?.();}
