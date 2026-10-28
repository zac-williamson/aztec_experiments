// Policy unit tests only: fabricated decoded fields are not valid proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bindRollingCircuit, validateRollingPayload, validateRollingJob, rollingSelectors} from './application-policy.mjs';
import {ARTIFACTS, COMMON_INPUTS, loadRollingArtifacts, permittedInput, sha} from './rolling-artifacts.mjs';
import {pluginSelectors} from './plugin-policy.mjs';
import {FunctionSelector, FunctionType, loadContractArtifact} from '@aztec-labs/stdlib/abi';

const metadata = {board: '1', chainId: '31337', rollupVersion: '1'};
const selectors = {RollingBoard: {private: new Set([11n]), public: new Set([12n])},
  PrivateBok: {private: new Set([21n]), public: new Set([22n])},
  feeLike:33n,fee: {fee: new Set([31n]), feeClaim: 32n, paddingHash: 99n}};
const options = {metadata, privateBokAddress: '2', privateFeeAddress: '3', selectors};
const context = (address='2', sender='4') => ({tx_context: {chain_id:'31337',version:'1'},call_context:{contract_address:{inner:address},msg_sender:{inner:sender}}});
const call = (target, id, isPublic=false) => ({target_address:{inner:String(target)},function_selector:{inner:String(id)},args_hash:'0',is_public:isPublic,hide_msg_sender:false,is_static:false});
const payload = () => ({inputs:context('4'),app_payload:{function_calls:[call(1,11),call(2,21),call(3,31)]}});

test('rolling mixed payload permits only its exact board/Bok/private fee calls', () => {
  assert.deepEqual(validateRollingPayload(payload(), options), {applications:2,fees:1});
  const publicOnly = payload(); publicOnly.app_payload.function_calls=[call(2,22,true),call(3,31)];
  assert.deepEqual(validateRollingPayload(publicOnly, options), {applications:1,fees:1});
  for (const extra of [call(77,11),call(1,999),call(2,999),call(2,21,true),call(2,22,false),{...call(2,22,true),hide_msg_sender:true},{...call(2,22,true),is_static:true}]) {
    const input=payload();input.app_payload.function_calls.push(extra);
    assert.throws(()=>validateRollingPayload(input, options), /Unapproved|Invalid/);
  }
});
test('all padding and fee/network conditions fail closed', () => {
  const input=payload(), padding={...call(0,0,true),args_hash:'99'};
  input.app_payload.function_calls.push(padding);validateRollingPayload(input,options);
  padding.args_hash='0';assert.throws(()=>validateRollingPayload(input,options),/Unapproved/);
  for(const modify of [p=>p.app_payload.function_calls.pop(),p=>p.inputs.tx_context.chain_id='1',p=>p.inputs.tx_context.version='2']) {
    const p=payload();modify(p);assert.throws(()=>validateRollingPayload(p,options),/Private fee|network/);
  }
  const feeOnly=payload();feeOnly.app_payload.function_calls=[call(3,31)];
  assert.throws(()=>validateRollingPayload(feeOnly,options),/operation required/);
  assert.deepEqual(validateRollingPayload(feeOnly,{...options,allowFeeClaim:true}),{applications:0,fees:1});
});
test('every private application circuit is address/network/function bound, including continuations', () => {
  for(const [fn,address] of [['RollingBoard:post','1'],['RollingBoard:cancel_deposit','1'],['PrivateBok:claim','2'],['PrivateFPC:pay_fee','3']]) {
    bindRollingCircuit(fn,{inputs:context(address)},options);
    assert.throws(()=>bindRollingCircuit(fn,{inputs:context('99')},options),/contract/);
    const input={inputs:context(address)};input.inputs.tx_context.version='2';assert.throws(()=>bindRollingCircuit(fn,input,options),/network/);
  }
  bindRollingCircuit('PrivateBok:subtract_more',{inputs:context('2','2')},options);
  assert.throws(()=>bindRollingCircuit('PrivateBok:subtract_more',{inputs:context('2','4')},options),/self-called/);
  for(const fn of ['PrivateBok:_open_escrow','RollingBoard:update_portal','PrivateFPC:mint'])assert.throws(()=>bindRollingCircuit(fn,{inputs:context(fn.startsWith('Rolling')?'1':fn.startsWith('PrivateFPC')?'3':'2')},options),/Unapproved/);
  for(const fn of ['Billboard:post','PluginAdapter:claim','MultiCallEntrypoint:entrypoint'])assert.throws(()=>bindRollingCircuit(fn,undefined,options),/Foreign/);
  bindRollingCircuit('PrivateKernelInitArtifact',undefined,options);
});

test('paid like binds its Board and is exactly one signed payment operation', () => {
 const paid={inputs:context('3'),board:{inner:'1'}};
 bindRollingCircuit('PrivateFPC:pay_like_and_fee',paid,options);
 assert.throws(()=>bindRollingCircuit('PrivateFPC:pay_like_and_fee',{...paid,board:{inner:'99'}},options),/Wrong paid-like board/);
 const p=payload();p.app_payload.function_calls=[call(3,33)];
 assert.deepEqual(validateRollingPayload(p,options),{applications:1,fees:1});
 for(const extra of [call(3,33),call(3,31),call(1,11)]){
  const duplicate=structuredClone(p);duplicate.app_payload.function_calls.push(extra);
  assert.throws(()=>validateRollingPayload(duplicate,options),/single payment call/);
 }
 assert.throws(()=>validateRollingPayload(p,{...options,allowFeeClaim:true}),/single payment call/);
 validateRollingJob([{functionName:'PrivateFPC:pay_like_and_fee'},{functionName:'SchnorrInitializerlessAccount:entrypoint'}],[paid,p],options);
 assert.throws(()=>bindRollingCircuit('PrivateFPC:recurse_subtract_balance_internal',{inputs:context('3','3')},options),/Unapproved/);
 assert.throws(()=>bindRollingCircuit('RollingBoard:set_like',{inputs:context('1')},options),/Unapproved/);
});
test('Bok tip-key derivation is nested and bound to configured Bok',()=>{
 bindRollingCircuit('PrivateBok:publish_reply',{inputs:context('2')},options);
 bindRollingCircuit('RollingBoard:derive_plugin_tip_key',{inputs:context('1','2')},options);
 assert.throws(()=>bindRollingCircuit('RollingBoard:derive_plugin_tip_key',{inputs:context('1','4')},options),/configured Bok/);
 assert.throws(()=>bindRollingCircuit('RollingBoard:derive_plugin_tip_key',{inputs:context('1','2')},{...options,privateBokAddress:undefined}),/disabled/);
});

function artifactFixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rolling-artifact-policy-'));
  const write=(relative,bytes)=>{fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),bytes);};
  const inputs=Object.fromEntries(COMMON_INPUTS.map(relative=>{write(relative,'fixture');return [relative,sha('fixture')];}));
  const artifacts=Object.entries(ARTIFACTS).map(([name,relative])=>{
    const source=name==='RollingBoard'?'billboard/rolling_contract/src/main.nr':'experiments/private-bok/escrow/src/main.nr';
    write(source,'fixture');inputs[source]=sha('fixture');
    const raw={name,transpiled:true,functions:[{name:'claim',custom_attributes:['abi_private'],verification_key:'AA==',bytecode:'AA==',abi:{}}],file_map:{1:{path:source,source:'fixture'}}};
    const bytes=JSON.stringify(raw);write(relative,bytes);return {name,path:relative,sha256:sha(bytes)};
  });
  const manifest={schemaVersion:1,status:'ready',artifacts,inputs};
  const save=()=>write('prover/rolling-artifacts.json',JSON.stringify(manifest));save();
  return {root,write,manifest,save,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('owner delivery catalog binds generated native sources without allowing unrelated build files', () => {
  const f=artifactFixture();try{
    const target=f.manifest.artifacts[0],raw=JSON.parse(fs.readFileSync(path.join(f.root,target.path)));
    const paths=['billboard/owner_delivery/src/delivery.nr','.build/owner-delivery/aztec-nr/aztec/src/messages/discovery/mod.nr','.build/owner-delivery/aztec-nr/uint-note/src/uint_note.nr','.build/owner-delivery/aztec-nr/balance-set/src/balance_set.nr'];
    for(const [index,source] of paths.entries()){
      assert(permittedInput(source));f.write(source,'owner fixture');f.manifest.inputs[source]=sha('owner fixture');
      raw.file_map[index+2]={path:source,source:'owner fixture'};
    }
    const bytes=JSON.stringify(raw);f.write(target.path,bytes);target.sha256=sha(bytes);f.save();
    assert.equal(loadRollingArtifacts(f.root).length,2);
    const generated=paths[1];f.write(generated,'changed');
    assert.throws(()=>loadRollingArtifacts(f.root),/provenance/);
    f.manifest.inputs[generated]=sha('changed');f.save();
    assert.throws(()=>loadRollingArtifacts(f.root),/local source mismatch/);
    delete f.manifest.inputs[generated];f.save();
    assert.throws(()=>loadRollingArtifacts(f.root),/local source mismatch/);
    f.write(generated,'owner fixture');f.manifest.inputs[generated]=sha('owner fixture');
    const foreign='.build/owner-delivery/aztec-nr/foreign/src/other.nr';f.write(foreign,'foreign');f.manifest.inputs[foreign]=sha('foreign');f.save();
    assert.throws(()=>loadRollingArtifacts(f.root),/provenance/);
    assert.equal(permittedInput('.build/owner-delivery/aztec-nr/aztec/src/../other.nr'),false);
  }finally{f.close();}
});
test('artifact provenance rejects missing, stale, raw and symlinked release inputs', () => {
  // Deliberately synthetic bytes exercise release checks, never proving APIs.
  const f=artifactFixture();try{
    assert.equal(loadRollingArtifacts(f.root).length,2);
    f.manifest.status='pending';f.save();assert.throws(()=>loadRollingArtifacts(f.root),/pending/);f.manifest.status='ready';f.save();
    const source='billboard/rolling_contract/src/main.nr';f.write(source,'new source');f.manifest.inputs[source]=sha('new source');f.save();
    assert.throws(()=>loadRollingArtifacts(f.root),/local source mismatch/);f.write(source,'fixture');f.manifest.inputs[source]=sha('fixture');f.save();
    f.write('toolchain.json','changed');assert.throws(()=>loadRollingArtifacts(f.root),/provenance/);f.write('toolchain.json','fixture');
    const target=f.manifest.artifacts[0], original=fs.readFileSync(path.join(f.root,target.path));
    f.write(target.path,'changed');assert.throws(()=>loadRollingArtifacts(f.root),/digest/);
    const raw=JSON.parse(original);delete raw.functions[0].verification_key;const bytes=JSON.stringify(raw);f.write(target.path,bytes);target.sha256=sha(bytes);f.save();
    assert.throws(()=>loadRollingArtifacts(f.root),/private VKs/);
    f.write(target.path,original);target.sha256=sha(original);f.save();
    fs.unlinkSync(path.join(f.root,target.path));assert.throws(()=>loadRollingArtifacts(f.root),/ENOENT/);f.write(target.path,original);
    fs.unlinkSync(path.join(f.root,'toolchain.json'));fs.symlinkSync('package-lock.json',path.join(f.root,'toolchain.json'));
    assert.throws(()=>loadRollingArtifacts(f.root),/symlink/);
  }finally{f.close();}
});


test('actual private expiry is allowed but public expiry and direct callback are refused', async () => {
  const raw = [JSON.parse(fs.readFileSync(new URL('../billboard/target/rolling_contract-RollingBoard.json', import.meta.url))),
    JSON.parse(fs.readFileSync(new URL('../experiments/private-bok/target/private_bok-PrivateBok.json', import.meta.url)))];
  const actual = await rollingSelectors(raw), artifact = loadContractArtifact(raw[1]);
  const expiry = artifact.functions.find(fn => fn.name === 'expire');
  assert(expiry?.verificationKey, 'Private expiry must have a normal VK');
  const selector = BigInt((await FunctionSelector.fromNameAndParameters(expiry)).toString());
  const callback = artifact.nonDispatchPublicFunctions.find(fn => fn.name === '_expire');
  const callbackSelector = BigInt((await FunctionSelector.fromNameAndParameters(callback)).toString());
  const actualOptions = {...options, selectors: actual};
  const input = {inputs: context('4'), app_payload: {function_calls: [call(2, selector), call(3, [...actual.fee.fee][0])]}};
  assert.deepEqual(validateRollingPayload(input, actualOptions), {applications: 1, fees: 1});
  bindRollingCircuit('PrivateBok:expire', {inputs: context('2')}, actualOptions);
  const publicExpiry = structuredClone(input); publicExpiry.app_payload.function_calls[0].is_public = true;
  assert.throws(() => validateRollingPayload(publicExpiry, actualOptions), /Unapproved/);
  for (const publicCall of [false, true]) {
    const forged = structuredClone(input); forged.app_payload.function_calls[0] = call(2, callbackSelector, publicCall);
    assert.throws(() => validateRollingPayload(forged, actualOptions), /Unapproved/);
  }
});

test('actual authenticated Bok reply entrypoint requires configured escrow and private fee, never direct board callback',async()=>{
 const raw=loadRollingArtifacts(),selected=await rollingSelectors(raw);
 const selector=async(contract,name)=>{const a=loadContractArtifact(raw.find(x=>x.name===contract));const fn=[...a.functions,...a.nonDispatchPublicFunctions].find(x=>x.name===name);assert(fn);return BigInt((await FunctionSelector.fromNameAndParameters(fn)).toString());};
 const bok=loadContractArtifact(raw.find(x=>x.name==='PrivateBok')),replyFn=bok.functions.find(fn=>fn.name==='publish_reply');
 assert.equal(replyFn.functionType,FunctionType.PRIVATE);assert(replyFn.verificationKey);
 const reply=await selector('PrivateBok','publish_reply'),callback=await selector('RollingBoard','publish_plugin_reply'),continuation=await selector('PrivateBok','_publish_reply');
 const policy={...options,selectors:selected},fee=[...selected.fee.fee][0];const p=payload();p.app_payload.function_calls=[call(2,reply),call(3,fee)];
 assert.deepEqual(validateRollingPayload(p,policy),{applications:1,fees:1});
 bindRollingCircuit('PrivateBok:publish_reply',{inputs:context('2')},policy);
 for(const bad of [[call(1,callback,true),call(3,fee)],[call(1,callback),call(3,fee)],[call(99,reply),call(3,fee)],[call(2,reply,true),call(3,fee)],[call(2,continuation,true),call(3,fee)],[call(2,continuation),call(3,fee)],[call(2,reply)]]){p.app_payload.function_calls=bad;assert.throws(()=>validateRollingPayload(p,policy),/Unapproved|Private fee/);}
});


test('normal profile entrypoints are narrowly allowed, with private fees and no direct setters',async()=>{
 const raw=loadRollingArtifacts(),selected=await rollingSelectors(raw),a=loadContractArtifact(raw.find(a=>a.name==='RollingBoard'));
 const fn=name=>[...a.functions,...a.nonDispatchPublicFunctions].find(f=>f.name===name);
 const selector=async name=>BigInt((await FunctionSelector.fromNameAndParameters(fn(name))).toString());
 const policy={...options,selectors:selected},fee=call(3,[...selected.fee.fee][0]);
 for(const [name,isPublic]of [['set_bio',false],['set_avatar',false],['remove_avatar',true]]){
  const id=await selector(name),p={inputs:context('4'),app_payload:{function_calls:[call(1,id,isPublic),fee]}};
  assert.deepEqual(validateRollingPayload(p,policy),{applications:1,fees:1});
  for(const calls of [[call(99,id,isPublic),fee],[call(1,id,!isPublic),fee],[call(1,id,isPublic)]])assert.throws(()=>validateRollingPayload({...p,app_payload:{function_calls:calls}},policy),/Unapproved|Private fee/);
  if(!isPublic){assert(fn(name).verificationKey);bindRollingCircuit('RollingBoard:'+name,{inputs:context('1')},policy);assert.throws(()=>bindRollingCircuit('RollingBoard:'+name,{inputs:context('9')},policy),/contract/);}
 }
 for(const name of ['_set_bio','_set_avatar']){const id=await selector(name);for(const visibility of [false,true])assert.throws(()=>validateRollingPayload({inputs:context('4'),app_payload:{function_calls:[call(1,id,visibility),fee]}},policy),/Unapproved/);}
});


test('retired on-chain preferences are absent and rejected',()=>{
 const board=loadContractArtifact(loadRollingArtifacts().find(a=>a.name==='RollingBoard'));
 for(const name of ['set_preference','mark_thread_read','preference_head','_set_preference','_mark_thread_read']){
  assert(!board.functions.some(fn=>fn.name===name));
  assert.throws(()=>bindRollingCircuit('RollingBoard:'+name,{inputs:context('1')},options),/Unapproved/);
 }
});

test('actual artifact selectors: absent Bok admits regular board post but denies every Bok capability',async()=>{
 // Real normal ABI selectors, fabricated decoded witnesses: no proof acceptance.
 const raw=loadRollingArtifacts(),selected=await rollingSelectors(raw),policy={...options,privateBokAddress:undefined,selectors:selected};
 const artifact=name=>loadContractArtifact(raw.find(a=>a.name===name));
 const board=artifact('RollingBoard'),bok=artifact('PrivateBok');
 const selector=async fn=>BigInt((await FunctionSelector.fromNameAndParameters(fn)).toString());
 const fn=(a,name)=>[...a.functions,...a.nonDispatchPublicFunctions].find(f=>f.name===name);
 const fee=call(3,[...selected.fee.fee][0]);
 for(const name of ['post','cancel_deposit']){
  const id=await selector(fn(board,name)),p={inputs:context('4'),app_payload:{function_calls:[call(1,id),fee]}};
  assert.deepEqual(validateRollingPayload(p,policy),{applications:1,fees:1});bindRollingCircuit('RollingBoard:'+name,{inputs:context('1')},policy);
  for(const change of [p=>p.app_payload.function_calls.pop(),p=>p.inputs.tx_context.chain_id='2',p=>p.inputs.tx_context.version='2',p=>p.app_payload.function_calls[0].target_address.inner='99',p=>p.app_payload.function_calls[0].hide_msg_sender=true]){
   const bad=structuredClone(p);change(bad);assert.throws(()=>validateRollingPayload(bad,policy));
  }
 }
 assert.equal(selected.bokRequired.size,2);
 for(const name of ['post_with_bok','configure_plugin']){
  const id=await selector(fn(board,name));assert(selected.bokRequired.has(id));
  assert.throws(()=>bindRollingCircuit('RollingBoard:'+name,{inputs:context('1')},policy),/disabled/);
  for(const isPublic of [false,true])assert.throws(()=>validateRollingPayload({inputs:context('4'),app_payload:{function_calls:[call(1,id,isPublic),fee]}},policy),/disabled/);
 }
 for(const name of ['claim','authorize_request','cancel','expire','withdraw','publish_reply','reserve','settle','finish','close_uncertain','reconcile','withdraw_earnings','subtract_more']){
  const f=fn(bok,name);assert(f,'Actual Bok entrypoint '+name);const id=await selector(f);
  assert.throws(()=>bindRollingCircuit('PrivateBok:'+name,{inputs:context('2','2')},policy),/disabled/);
  for(const isPublic of [false,true])assert.throws(()=>validateRollingPayload({inputs:context('4'),app_payload:{function_calls:[call(2,id,isPublic),fee]}},policy),/Unapproved/);
 }
 bindRollingCircuit('PrivateFPC:pay_fee',{inputs:context('3')},policy);
 assert.throws(()=>bindRollingCircuit('PrivateFPC:pay_fee',{inputs:context('99')},policy),/contract/);
 assert.throws(()=>validateRollingPayload({inputs:context('4'),app_payload:{function_calls:[fee]}},policy),/operation required/);
 assert.throws(()=>validateRollingPayload({inputs:context('4'),app_payload:{function_calls:[fee]}},{...policy,selectors:{...selected,bokRequired:undefined}}),/Missing restricted/);
});


test('labelled decoded jobs: disabled Bok retains signed-account and fee requirements',()=>{
 const policy={...options,privateBokAddress:undefined,selectors:{...selectors,bokRequired:new Set([13n,14n])}};
 const signed={inputs:context('4'),app_payload:{function_calls:[call(1,11),call(3,31)]}};
 const circuits=[{functionName:'RollingBoard:post'},{functionName:'PrivateFPC:pay_fee'},{functionName:'SchnorrInitializerlessAccount:entrypoint'}];
 const decoded=[{inputs:context('1')},{inputs:context('3')},signed];
 validateRollingJob(circuits,decoded,policy);
 assert.throws(()=>validateRollingJob(circuits.slice(0,2),decoded.slice(0,2),policy),/Signed/);
 assert.throws(()=>validateRollingJob([circuits[0],circuits[2]],[decoded[0],decoded[2]],policy),/Private fee circuit/);
 assert.throws(()=>validateRollingJob([...circuits,{functionName:'PrivateBok:subtract_more'}],[...decoded,{inputs:context('2','2')}],policy),/disabled/);
});


test('funded bridge claim uses actual SDK claim mint pay payload and remains scope bound',async()=>{
 const {PrivateClaimAndPayFeePaymentMethod}=await import('../shared/private-fee-payment.mjs');
 const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
 const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
 const {encode}=await import('@aztec-labs/entrypoints/encoding');
 const raw=[JSON.parse(fs.readFileSync(new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))),JSON.parse(fs.readFileSync(new URL('../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url)))];
 const selected=await rollingSelectors(raw),feeAddress=AztecAddress.fromBigIntUnsafe(30n),policy={...options,privateFeeAddress:'30',selectors:selected};
 // Policy fixture only: a native capsule with sufficient selected credit,
 // not a claim that this fabricated preimage has proven note membership.
 const owner=AztecAddress.fromBigIntUnsafe(4n);
 const {tipSpendingKey,INPUT_CAPSULE_SLOT}=await import('../shared/private-credit.mjs');
 const secret=new Fr(10n),note={secret,key:await tipSpendingKey(secret),blinding:new Fr(11n),value:200n,nonce:new Fr(12n)};
 const payment=new PrivateClaimAndPayFeePaymentMethod(feeAddress,{amount:2n,secret:new Fr(7n),salt:new Fr(8n),leafIndex:new Fr(9n)},100n,{owner,notes:[note]});
 const execution=await payment.getExecutionPayload();
 assert.equal(execution.capsules.length,1);const [capsule]=execution.capsules;
 assert.equal(String(capsule.contractAddress),String(feeAddress));assert.equal(String(capsule.scope),String(owner));
 assert.equal(capsule.storageSlot.toBigInt(),INPUT_CAPSULE_SLOT);assert.equal(capsule.data[0].toBigInt(),1n);

 const {encodedFunctionCalls}=await encode(execution.calls);
 const signed={inputs:context('4'),app_payload:{function_calls:encodedFunctionCalls.map(x=>({target_address:{inner:x.target_address.toString()},function_selector:{inner:x.function_selector.toString()},args_hash:x.args_hash.toString(),is_public:x.is_public,hide_msg_sender:x.hide_msg_sender,is_static:x.is_static}))}};
 const names=['PrivateFPC:mint','PrivateFPC:pay_fee','SchnorrInitializerlessAccount:entrypoint'];
 const circuits=names.map(functionName=>({functionName})),decoded=[{inputs:context('30')},{inputs:context('30')},signed];
 // Installed normal artifact includes the mint circuit/VK before any proof job.
 const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url))));assert(artifact.functions.find(f=>f.name==='mint')?.verificationKey);
 validateRollingJob(circuits,decoded,policy);
 // Aggregate claim adds exactly the board collateral and Bok deposit calls to
 // the native three-call fee payload; no proof or witness fixture is needed.
 const actualSelector=async(name,fn)=>BigInt((await FunctionSelector.fromNameAndParameters(loadContractArtifact(raw.find(a=>a.name===name)).functions.find(f=>f.name===fn))).toString());
 const aggregate=structuredClone(signed);aggregate.app_payload.function_calls.push(call(1,await actualSelector('RollingBoard','claim_deposit')),call(2,await actualSelector('PrivateBok','claim')));
 assert.equal(aggregate.app_payload.function_calls.length,5);
 const fullCircuits=[...circuits,{functionName:'RollingBoard:claim_deposit'},{functionName:'PrivateBok:claim'}];
 const fullDecoded=[decoded[0],decoded[1],aggregate,{inputs:context('1')},{inputs:context('2')}];
 validateRollingJob(fullCircuits,fullDecoded,policy);
 assert.throws(()=>validateRollingJob(fullCircuits,fullDecoded,{...policy,privateBokAddress:undefined}),/disabled/);
 const bootstrap={functionName:'PrivateFPC:mint_and_pay_fee'};
 assert.throws(()=>validateRollingJob([...circuits,bootstrap],[...decoded,{inputs:context('30')}],policy),/Unapproved/);
 for(const modify of [p=>p.app_payload.function_calls[0].target_address.inner='99',p=>p.app_payload.function_calls[1].target_address.inner='99',p=>p.app_payload.function_calls[1].is_public=true,p=>p.app_payload.function_calls[1].hide_msg_sender=true,p=>p.app_payload.function_calls.splice(0,1),p=>p.app_payload.function_calls.splice(1,1),p=>p.app_payload.function_calls.splice(2,1),p=>p.app_payload.function_calls.push(p.app_payload.function_calls[1]),p=>p.app_payload.function_calls.reverse(),p=>p.inputs.tx_context.version='99']){
  const invalid=structuredClone(signed);modify(invalid);assert.throws(()=>validateRollingJob(circuits,[decoded[0],decoded[1],invalid],policy));
 }
 assert.throws(()=>validateRollingJob(circuits, [{inputs:context('99')},decoded[1],signed],policy),/contract/);
 assert.throws(()=>validateRollingJob(circuits.slice(0,2),decoded.slice(0,2),policy),/Signed/);
 assert.throws(()=>validateRollingJob([circuits[0],circuits[2]],[decoded[0],signed],policy));
 assert.throws(()=>validateRollingPayload(signed,policy),/Unapproved/);
});

test('cancelled deposit proof uses the actual board ABI, signed account and private fee without Bok',async()=>{
 const raw=loadRollingArtifacts(),selected=await rollingSelectors(raw),policy={...options,privateBokAddress:undefined,selectors:selected};
 const board=loadContractArtifact(raw.find(a=>a.name==='RollingBoard'));const fn=board.functions.find(f=>f.name==='cancel_deposit');assert(fn?.verificationKey);
 const id=BigInt((await FunctionSelector.fromNameAndParameters(fn)).toString());
 const signed={inputs:context('4'),app_payload:{function_calls:[call(1,id),call(3,[...selected.fee.fee][0])]}};
 const circuits=[{functionName:'RollingBoard:cancel_deposit'},{functionName:'PrivateFPC:pay_fee'},{functionName:'SchnorrInitializerlessAccount:entrypoint'}],decoded=[{inputs:context('1')},{inputs:context('3')},signed];
 validateRollingJob(circuits,decoded,policy);
 assert.throws(()=>validateRollingJob(circuits.slice(0,2),decoded.slice(0,2),policy),/Signed/);
 assert.throws(()=>validateRollingJob([circuits[0],circuits[2]],[decoded[0],decoded[2]],policy),/Private fee/);
 const publicCall=structuredClone(signed);publicCall.app_payload.function_calls[0].is_public=true;assert.throws(()=>validateRollingPayload(publicCall,policy),/Unapproved/);
});

// Uses the actual published ABI and policy boundary; decoded fields are fixtures,
// not proof acceptance. The browser release check supplies the real proof.
test('atomic thread is admitted with exact scope and optional Bok capability',async()=>{
 const raw=loadRollingArtifacts(),selected=await rollingSelectors(raw),policy={...options,selectors:selected};
 const board=loadContractArtifact(raw.find(a=>a.name==='RollingBoard'));
 const fn=board.functions.find(f=>f.name==='post_thread');assert(fn?.verificationKey);
 const id=BigInt((await FunctionSelector.fromNameAndParameters(fn)).toString());
 const account={inputs:context('4'),app_payload:{function_calls:[call(1,id),call(3,[...selected.fee.fee][0])]}};
 const thread={inputs:context('1'),plugin_ids:['0','0','0','0'],request_ids:['0','0','0','0']};
 const circuits=[{functionName:'RollingBoard:post_thread'},{functionName:'PrivateFPC:pay_fee'},{functionName:'SchnorrInitializerlessAccount:entrypoint'}];
 const decoded=[thread,{inputs:context('3')},account];
 for(const configured of [policy,{...policy,privateBokAddress:undefined}]){
  validateRollingJob(circuits,decoded,configured);
  assert.throws(()=>validateRollingJob(circuits.slice(0,2),decoded.slice(0,2),configured),/Signed/);
  assert.throws(()=>validateRollingJob([circuits[0],circuits[2]],[thread,account],configured),/Private fee circuit/);
  assert.throws(()=>bindRollingCircuit('RollingBoard:post_thread',{...thread,inputs:context('99')},configured),/contract/);
  const bad=structuredClone(thread);bad.inputs.tx_context.version='2';assert.throws(()=>bindRollingCircuit('RollingBoard:post_thread',bad,configured),/network/);
  const publicCall=structuredClone(account);publicCall.app_payload.function_calls[0].is_public=true;assert.throws(()=>validateRollingPayload(publicCall,configured),/Unapproved/);
 }
 for(const key of ['plugin_ids','request_ids'])for(const value of [undefined,[],['0','0','0','1']]){
  assert.throws(()=>bindRollingCircuit('RollingBoard:post_thread',{...thread,[key]:value},{...policy,privateBokAddress:undefined}));
 }
 const bok=loadContractArtifact(raw.find(a=>a.name==='PrivateBok'));
 const authorization=BigInt((await FunctionSelector.fromNameAndParameters(bok.functions.find(f=>f.name==='authorize_request'))).toString());
 const invoked={...thread,plugin_ids:['7','0','0','0'],request_ids:['8','0','0','0']};
 const signed=structuredClone(account);signed.app_payload.function_calls.splice(1,0,call(2,authorization));
 const combined=[circuits[0],{functionName:'PrivateBok:authorize_request'},...circuits.slice(1)];
 validateRollingJob(combined,[invoked,{inputs:context('2')},decoded[1],signed],policy);
 assert.throws(()=>validateRollingJob(combined,[invoked,{inputs:context('99')},decoded[1],signed],policy),/contract/);
 assert.throws(()=>validateRollingJob(combined,[invoked,{inputs:context('2')},decoded[1],signed],{...policy,privateBokAddress:undefined}),/disabled/);
});
