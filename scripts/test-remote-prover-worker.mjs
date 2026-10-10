import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {abiEncode,serializeWitness} from '@aztec-foundation/noir-noirc_abi';
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
test('standalone fee funding is limited to the configured fee contract and network',async()=>{
 const catalog=await loadCircuitCatalog(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'prover-fee-test-')),file=path.join(directory,'job');
 const address='0x'+'2'.padStart(64,'0');
 try{for(const [name,configured,chain,valid] of [['mint_and_pay_fee',address,'31337',true],['mint_and_pay_fee',undefined,'31337',false],['mint_and_pay_fee','0x'+'3'.padStart(64,'0'),'31337',false],['mint_and_pay_fee',address,'1',false],['mint',address,'31337',false]]){
  const [id,c]=[...catalog].find(([,c])=>c.functionName==='PrivateFPC:'+name),inputs=Object.fromEntries(c.abi.parameters.map(p=>[p.name,zero(p.type)]));
  inputs.inputs.call_context.contract_address.inner='2';inputs.inputs.tx_context.chain_id=chain;inputs.inputs.tx_context.version='1';
  const witness=serializeWitness(abiEncode(c.abi,inputs,zero(c.abi.return_type.abi_type)));
  await fs.writeFile(file,encodeJob({board:'0x'+'1'.padStart(64,'0'),chainId:'31337',rollupVersion:'1',mode:'disabled',circuits:[id]},[witness]));
  const worker=createProcessWorker({proofsEnabled:false,privateFeeAddress:configured});
  try{if(valid)assert.deepEqual(await worker.prove(file),{mode:'disabled'});else await assert.rejects(worker.prove(file),e=>e.code==='board-binding');}finally{await worker.close();}
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('plugin-only proofs require configured receivers, exact entrypoint calls and network',async()=>{
 const {pluginSelectors}=await import('../prover/plugin-policy.mjs');
 const selectors=await pluginSelectors(),catalog=await loadCircuitCatalog();
 const [id,circuit]=[...catalog].find(([,c])=>c.functionName==='SchnorrInitializerlessAccount:entrypoint');
 assert([...catalog.values()].some(c=>c.functionName==='PluginAdapter:claim'&&c.abi));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'plugin-worker-test-')),file=path.join(directory,'job');
 const address='0x'+'3'.padStart(64,'0'),fee='0x'+'2'.padStart(64,'0');
 const base={board:'0x'+'1'.padStart(64,'0'),chainId:'31337',rollupVersion:'1',mode:'disabled',circuits:[id]};
 try {for(const scenario of ['valid','no-allowlist','wrong-target','wrong-network','wrong-selector','hidden-sender','static','private-public-mismatch','unrelated-call','fee-only','bad-padding']){
  const inputs=Object.fromEntries(circuit.abi.parameters.map(p=>[p.name,zero(p.type)]));
  inputs.inputs.tx_context.chain_id=scenario==='wrong-network'?'1':'31337';inputs.inputs.tx_context.version='1';
  for(const call of inputs.app_payload.function_calls){call.is_public=true;call.args_hash=String(selectors.paddingHash);}
  const call=inputs.app_payload.function_calls[0];call.target_address.inner=scenario==='wrong-target'?'4':'3';call.function_selector.inner=String([...selectors.public][0]);
  if(scenario==='wrong-selector')call.function_selector.inner='999';if(scenario==='hidden-sender')call.hide_msg_sender=true;if(scenario==='static')call.is_static=true;if(scenario==='private-public-mismatch')call.is_public=false;
  if(scenario==='unrelated-call')inputs.app_payload.function_calls[1].target_address.inner='99';
  if(scenario==='bad-padding')inputs.app_payload.function_calls[1].args_hash='0';
  if(scenario==='fee-only'){call.target_address.inner='2';call.function_selector.inner=String([...selectors.fee][0]);call.is_public=false;}
  const witness=serializeWitness(abiEncode(circuit.abi,inputs,zero(circuit.abi.return_type.abi_type)));
  await fs.writeFile(file,encodeJob(base,[witness]));
  const worker=createProcessWorker({proofsEnabled:false,privateFeeAddress:fee,pluginAddresses:scenario==='no-allowlist'?[]:[address]});
  try{if(scenario==='valid')assert.deepEqual(await worker.prove(file),{mode:'disabled'});else await assert.rejects(worker.prove(file),e=>e.code==='board-binding',scenario);}finally{await worker.close();}
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('board and fee calls cannot bypass a private plugin claim binding',async()=>{
 const catalog=await loadCircuitCatalog(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'plugin-mixed-worker-')),file=path.join(directory,'job');
 const address=n=>'0x'+String(n).padStart(64,'0');
 const circuitWitness=(name,target,chain)=>{const [id,c]=[...catalog].find(([,c])=>c.functionName===name),input=Object.fromEntries(c.abi.parameters.map(p=>[p.name,zero(p.type)]));input.inputs.call_context.contract_address.inner=target;input.inputs.tx_context.chain_id=chain;input.inputs.tx_context.version='1';return [id,serializeWitness(abiEncode(c.abi,input,zero(c.abi.return_type.abi_type)))];};
 try{for(const kind of ['board','fee'])for(const [target,chain,valid] of [['3','31337',true],['4','31337',false],['3','1',false]]){
  const base=circuitWitness(kind==='board'?'Billboard:post':'PrivateFPC:mint_and_pay_fee',kind==='board'?'1':'2','31337'),plugin=circuitWitness('PluginAdapter:claim',target,chain);
  await fs.writeFile(file,encodeJob({board:address(1),chainId:'31337',rollupVersion:'1',mode:'disabled',circuits:[base[0],plugin[0]]},[base[1],plugin[1]]));
  const worker=createProcessWorker({proofsEnabled:false,privateFeeAddress:address(2),pluginAddresses:[address(3)]});
  try{if(valid)assert.deepEqual(await worker.prove(file),{mode:'disabled'});else await assert.rejects(worker.prove(file),e=>e.code==='board-binding');}finally{await worker.close();}
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('actual fee payloads and plugin calls encode into the accepted account policy',async()=>{
 const {validatePluginPayload,pluginSelectors}=await import('../prover/plugin-policy.mjs');
 const {PrivateFeePaymentMethod,PrivateMintAndPayFeePaymentMethod}=await import('../shared/private-fee-payment.mjs');
 const {EncodedAppEntrypointCalls}=await import('@aztec-labs/entrypoints/encoding');
 const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
 const {FunctionCall,FunctionSelector,FunctionType}=await import('@aztec-labs/stdlib/abi');
 const address=AztecAddress.fromFieldUnsafe(new Fr(3)),fee=AztecAddress.fromFieldUnsafe(new Fr(2)),selectors=await pluginSelectors();
 const plugin=FunctionCall.from({name:'withdraw',to:address,selector:FunctionSelector.fromString('0x'+[...selectors.public][0].toString(16).padStart(8,'0')),type:FunctionType.PUBLIC,hideMsgSender:false,isStatic:false,args:[]});
 for(const mint of [false,true]){
  const payment=mint?new PrivateMintAndPayFeePaymentMethod(fee,{amount:100n,secret:Fr.ONE,salt:Fr.ONE,leafIndex:Fr.ONE},10n):new PrivateFeePaymentMethod(fee,10n);
  const payload=await payment.getExecutionPayload(),encoded=await EncodedAppEntrypointCalls.create([...payload.calls,plugin]);
  const input={inputs:{tx_context:{chain_id:'31337',version:'1'}},app_payload:{function_calls:encoded.function_calls.map(c=>({...c,args_hash:c.args_hash.toString(),target_address:{inner:c.target_address.toString()},function_selector:{inner:c.function_selector.toString()}}))}};
  const options={metadata:{chainId:'31337',rollupVersion:'1'},pluginAddresses:[address.toString()],privateFeeAddress:fee.toString(),selectors,allowFeeOnly:mint};
  assert.equal(validatePluginPayload(input,options),1);
  if(mint)assert.throws(()=>validatePluginPayload(input,{...options,allowFeeOnly:false}),/Unapproved/);
 }
});

test('catalog pins V6 circuit kinds with both hiding variants and application verification keys',async()=>{
 const {CircuitKind}=await import('@aztec-foundation/bb.js');
 const {ClientCircuitArtifacts,BundleArtifactProvider}=await import('@aztec-labs/noir-protocol-circuits-types/client/bundle');
 const {circuitId}=await import('../shared/remote-prover-wire.mjs');
 const provider=new BundleArtifactProvider();
 const catalog=await loadCircuitCatalog(),byName=new Map([...catalog.values()].map(c=>[c.functionName,c]));
 for(const [name,artifact] of Object.entries(ClientCircuitArtifacts)){
  const vk=(await provider.getCircuitVkByName(name)).keyAsBytes;
  const circuit=catalog.get(await circuitId(Buffer.from(artifact.bytecode,'base64'),vk));assert(circuit,name);assert(circuit.vk.byteLength>0);assert.deepEqual(circuit.vk,vk);
  assert.equal(circuit.kind,['HidingKernelToRollup','HidingKernelToPublic'].includes(name)?CircuitKind.HidingKernel:CircuitKind.Kernel,name);
 }
 assert.equal([...catalog.values()].filter(c=>c.kind===CircuitKind.HidingKernel).length,2);
 for(const name of ['Billboard:post','PrivateFPC:mint_and_pay_fee','PluginAdapter:claim','SchnorrInitializerlessAccount:entrypoint','MultiCallEntrypoint:entrypoint'])assert.equal(byName.get(name)?.kind,CircuitKind.App,name);
 const {AuthRegistryArtifact,HandshakeRegistryArtifact,MultiCallEntrypointArtifact,PublicChecksArtifact}=await import('@aztec-labs/standard-contracts');
 for(const artifact of [AuthRegistryArtifact,HandshakeRegistryArtifact,MultiCallEntrypointArtifact,PublicChecksArtifact])for(const fn of artifact.functions)if(fn.verificationKey)assert.equal(catalog.get(await circuitId(fn.bytecode,Buffer.from(fn.verificationKey,'base64')))?.kind,CircuitKind.App,artifact.name+':'+fn.name);
 for(const circuit of catalog.values())if(circuit.functionName.includes(':'))assert.equal(circuit.kind,CircuitKind.App,circuit.functionName);
});
