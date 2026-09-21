import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {abiEncode,serializeWitness} from '@aztec/noir-noirc_abi';
import {loadCircuitCatalog} from '../prover/catalog.mjs';
import {createProcessWorker} from '../prover/process-worker.mjs';
import {encodeJob} from '../shared/remote-prover-wire.mjs';
function zero(type){switch(type.kind){case 'field':case 'integer':return '0';case 'boolean':return false;case 'array':return Array.from({length:type.length},()=>zero(type.type));case 'struct':return Object.fromEntries(type.fields.map(f=>[f.name,zero(f.type)]));default:throw Error('Unsupported fixture ABI '+type.kind);}}
test('actual isolated worker accepts configured board and rejects forged board/network metadata',async()=>{
 const catalog=await loadCircuitCatalog();const [id,circuit]=[...catalog].find(([,c])=>c.functionName==='Billboard:post');
 const abi=circuit.abi,inputs=Object.fromEntries(abi.parameters.map(p=>[p.name,zero(p.type)]));
 inputs.inputs.call_context.contract_address.inner='1';inputs.inputs.tx_context.chain_id='31337';inputs.inputs.tx_context.version='1';
 const witness=serializeWitness(abiEncode(abi,inputs,zero(abi.return_type.abi_type)));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'prover-worker-test-')),file=path.join(directory,'job');
 const worker=createProcessWorker({proofsEnabled:false});
 const base={board:'0x'+'1'.padStart(64,'0'),chainId:'31337',rollupVersion:'1',mode:'disabled',circuits:[id]};
 try{
  for(const [patch,valid] of [[{},true],[{board:'0x'+'2'.padStart(64,'0')},false],[{chainId:'1'},false],[{rollupVersion:'2'},false]]){
   await fs.writeFile(file,encodeJob({...base,...patch},[witness]));
   if(valid)assert.deepEqual(await worker.prove(file),{mode:'disabled'});else await assert.rejects(worker.prove(file),e=>e.code==='board-binding');
  }
 }finally{await worker.close();await fs.rm(directory,{recursive:true,force:true});}
});
test('native route switched to local delegates to its SDK implementation',async()=>{
 const {routedKernelProverClass}=await import('../shared/routed-kernel-prover.mjs');
 let calls=0;class Local{async createChonkProof(steps){calls++;return steps;}}
 const Prover=routedKernelProverClass(Local),p=new Prover({}, {},{proofsEnabled:true,transport:null}),steps=[];
 assert.equal(await p.createChonkProof(steps),steps);assert.equal(calls,1);
});
