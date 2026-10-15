// Synthetic SimulationError fixtures, actual installed SDK and normally processed
// artifact. These test attribution, not real AVM execution or chain acceptance.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {FunctionSelector,loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {createRollingNameCollisionPlan,assertNameCollisionPending,assertNameCollisionOutcome,createNameCollisionClassifier} from './rolling-name-collision.mjs';
after(async()=>{await BarretenbergSync.destroySingleton();});
const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
const boardAddress=AztecAddress.fromBigIntUnsafe(44n),other=AztecAddress.fromBigIntUnsafe(45n);
const like=artifact.nonDispatchPublicFunctions.find(f=>f.name==='_register_name'),dispatch=artifact.functions.find(f=>f.name==='public_dispatch');
const functionSelector=await FunctionSelector.fromNameAndParameters(like);
const errorField=text=>new Fr(BigInt(Object.entries(dispatch.errorTypes).find(([,v])=>v.error_kind==='string'&&v.string===text)[0]));
const predicate=await createNameCollisionClassifier({artifact,boardAddress});
function fixture(){return new SimulationError('PRIVATE_SENTINEL',[{contractAddress:other,functionSelector:FunctionSelector.empty()},
 {contractAddress:boardAddress,functionSelector}],[errorField('Name already registered')]);}
test('accepts only actual error shape with deepest callee and ABI-decoded static assertion',()=>{
 const error=fixture();assert.equal(predicate(error),true);assert.equal(error.getOriginalMessage(),'PRIVATE_SENTINEL');assert.equal(error.revertData.length,1);
});
test('supports canonical board string and schema-reconstructed transport error',async()=>{
 const classify=await createNameCollisionClassifier({artifact,boardAddress:String(boardAddress)});
 const decoded=SimulationError.schema.parse(JSON.parse(JSON.stringify(fixture().toJSON())));assert.equal(classify(decoded),true);
});
const mutations={
 'wrong deepest contract':e=>{e.functionErrorStack.at(-1).contractAddress=other;},
 'wrong deepest selector':e=>{e.functionErrorStack.at(-1).functionSelector=FunctionSelector.empty();},
 'matching outer frame only':e=>{e.functionErrorStack.reverse();},
 'different contract guard':e=>{e.revertData=[errorField('Post removed')];},
 'empty call stack':e=>{e.functionErrorStack=[];},
 'missing selector':e=>{delete e.functionErrorStack.at(-1).functionSelector;},
 'missing revert data':e=>{delete e.revertData;},
 'empty revert data':e=>{e.revertData=[];},
 'trailing revert data':e=>{e.revertData.push(Fr.ONE);},
 'unknown assertion selector':e=>{e.revertData=[Fr.ZERO];},
 'untyped revert field':e=>{e.revertData=[{toBigInt:()=>errorField('Name already registered').toBigInt()}];},
 'untyped callee':e=>{e.functionErrorStack.at(-1).contractAddress={toString:()=>String(boardAddress)};},
 'untyped selector':e=>{e.functionErrorStack.at(-1).functionSelector={value:functionSelector.value};},
 'unbounded stack':e=>{e.functionErrorStack=Array(33).fill(e.functionErrorStack.at(-1));},
};
for(const [name,mutate]of Object.entries(mutations))test('synthetic attribution rejects '+name,()=>{const e=fixture();mutate(e);assert.equal(predicate(e),false);});
test('plain error, message-only imitation, nested cause and outage never qualify',()=>{
 for(const e of [null,undefined,Error('Name already registered'),{message:'Name already registered',functionErrorStack:fixture().functionErrorStack,revertData:fixture().revertData},new Error('outage',{cause:fixture()})])assert.equal(predicate(e),false);
});
for(const target of ['stack','data','leaf','address','selector','field'])test('malicious accessor is rejected without invocation: '+target,()=>{
 const error=fixture();let accesses=0;const getter=()=>{accesses++;throw Error('PRIVATE_SENTINEL');};
 if(target==='stack')Object.defineProperty(error,'functionErrorStack',{get:getter});
 if(target==='data')Object.defineProperty(error,'revertData',{get:getter});
 if(target==='leaf')Object.defineProperty(error.functionErrorStack,'1',{get:getter});
 if(target==='address')Object.defineProperty(error.functionErrorStack.at(-1),'contractAddress',{get:getter});
 if(target==='selector'){const value=FunctionSelector.fromString(functionSelector.toString());Object.defineProperty(value,'value',{get:getter});error.functionErrorStack.at(-1).functionSelector=value;}
 if(target==='field')Object.defineProperty(error.revertData[0],'asBigInt',{get:getter});
 assert.equal(predicate(error),false);assert.equal(accesses,0);
});
test('error-owned getCallStack and rendered message are never used as evidence',()=>{
 const error=fixture();let accesses=0;Object.defineProperty(error,'getCallStack',{get(){accesses++;throw Error('PRIVATE_SENTINEL');}});
 error.originalMessage='Name already registered';assert.equal(predicate(error),true);assert.equal(accesses,0);
});
test('revoked proxy fails closed without propagating its exception',()=>{const {proxy,revoke}=Proxy.revocable(fixture(),{});revoke();assert.equal(predicate(proxy),false);});
for(const mutate of [a=>{a.nonDispatchPublicFunctions=[];},a=>{a.functions=a.functions.filter(f=>f.name!=='public_dispatch');},a=>{a.nonDispatchPublicFunctions.find(f=>f.name==='_register_name').isOnlySelf=false;},a=>{a.functions.find(f=>f.name==='public_dispatch').errorTypes={};}])
 test('incomplete artifact rejects classifier setup with fixed message',async()=>{const a=structuredClone(artifact);mutate(a);await assert.rejects(createNameCollisionClassifier({artifact:a,boardAddress}),{message:'Name-collision classifier configuration is invalid.'});});
test('assertion metadata is detached from later caller mutation',async()=>{
 const a=structuredClone(artifact),classify=await createNameCollisionClassifier({artifact:a,boardAddress});a.functions.find(f=>f.name==='public_dispatch').errorTypes={};assert.equal(classify(fixture()),true);
});
test('real decoder boundary emits no stdout or stderr for unknown selectors',async()=>{
 const source=`
 import fs from 'node:fs/promises';
 import assert from 'node:assert/strict';
 import {BarretenbergSync} from '@aztec-foundation/bb.js';
 import {Fr} from '@aztec-labs/foundation/curves/bn254';
 import {FunctionSelector,loadContractArtifact} from '@aztec-labs/stdlib/abi';
 import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
 import {SimulationError} from '@aztec-labs/stdlib/errors';
 import {createRollingNameCollisionPlan,assertNameCollisionPending,assertNameCollisionOutcome,createNameCollisionClassifier} from './scripts/testing/rolling-name-collision.mjs';
 try {
  const artifact=loadContractArtifact(JSON.parse(await fs.readFile(${JSON.stringify(process.env.ROLLING_TEST_ARTIFACT??fileURLToPath(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url)))},'utf8')));
  const boardAddress=AztecAddress.fromBigIntUnsafe(44n);
  const classify=await createNameCollisionClassifier({artifact,boardAddress});
  const functionSelector=await FunctionSelector.fromNameAndParameters(artifact.nonDispatchPublicFunctions.find(f=>f.name==='_register_name'));
  const error=new SimulationError('PRIVATE_SENTINEL',[{contractAddress:boardAddress,functionSelector}],[Fr.ZERO]);
  assert.equal(classify(error),false);
  const guard=Object.entries(artifact.functions.find(f=>f.name==='public_dispatch').errorTypes).find(([,v])=>v.error_kind==='string'&&v.string==='Name already registered')[0];
  error.revertData=[new Fr(BigInt(guard))];assert.equal(classify(error),true);
 } finally { await BarretenbergSync.destroySingleton(); }
 `;
 const {stdout,stderr}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{LOG_LEVEL:'silent'},timeout:10000,maxBuffer:65536});
 assert.equal(stdout,'');assert.equal(stderr,'');
});

const plan=await createRollingNameCollisionPlan();
const intentIds=['0x'+'01'.repeat(32),'0x'+'02'.repeat(32)],txHashes=['0x'+'03'.repeat(32),'0x'+'04'.repeat(32)];
function pendingFixture(){return {intentIds:[...intentIds],journals:txHashes.map((txHash,i)=>({operation:'ROLLING_WORKFLOW_V1:'+intentIds[i],txHash})),receipts:txHashes.map(txHash=>({txHash,status:'pending',executionResult:null}))};}
const empty=()=>({identities:[],records:[],nextCursor:null});
function outcomeFixture(winner=0){
 const loser=1-winner,binding=assertNameCollisionPending(pendingFixture());
 const receipts=txHashes.map((txHash,i)=>({txHash,status:'checkpointed',executionResult:i===winner?'success':'reverted'}));
 const events=[[],[]];events[winner]=[{type:'NameRegistered',payload:structuredClone(plan.expected[winner].payload)}];
 const boardLogs=[[],[]];boardLogs[winner]=[{}];
 const ownership=[0,1].map(i=>({head:i===winner?{identities:[plan.nameId],records:[structuredClone(plan.expected[i].identity)],nextCursor:null}:empty(),tail:empty()}));
 return {plan:structuredClone(plan),binding:structuredClone(binding),receipts,events,boardLogs,ownership,collision:{txHash:txHashes[loser],matched:true}};
}
test('synthetic collision plan uses actual canonical packing/hash for distinct normalized inputs',async()=>{
 assert.notDeepEqual(plan.actions[0],plan.actions[1]);assert.equal(plan.expected[0].identity.id,plan.expected[1].identity.id);
 assert.equal(plan.expected[0].identity.first,'River');assert.equal(plan.expected[1].identity.first,'river');
 assert.equal(plan.expected[0].identity.last,'Stone');assert.equal(plan.expected[1].identity.last,'STONE');
 assert.notDeepEqual(plan.expected[0].payload,plan.expected[1].payload);
 assert(Object.isFrozen(plan)&&Object.isFrozen(plan.actions)&&Object.isFrozen(plan.expected[0].payload.first));
 const {nameRegistration,NAME_DOMAIN}=await import('../../shared/rolling/name-policy.mjs');const {poseidon2HashWithSeparator}=await import('@aztec-labs/foundation/crypto/poseidon');
 for(const action of plan.actions){const registration=nameRegistration(action.first,action.last);const id=await poseidon2HashWithSeparator(registration.preimage.map(n=>new Fr(n)),NAME_DOMAIN);assert.equal(id.toString(),plan.nameId);}
});
test('synthetic exact two-pending barrier returns detached immutable binding',()=>{
 const f=pendingFixture(),binding=assertNameCollisionPending(f);f.journals[0].txHash=txHashes[1];f.intentIds[0]=intentIds[1];
 assert.deepEqual(binding,{intentIds,txHashes});assert(Object.isFrozen(binding.txHashes));
});
const badPending={
 'duplicate intent':f=>{f.intentIds[1]=f.intentIds[0];},
 'wrong operation':f=>{f.journals[0].operation='ROLLING_WORKFLOW_V1:'+intentIds[1];},
 'missing operation':f=>{delete f.journals[0].operation;},
 'duplicate hash':f=>{f.journals[1].txHash=f.journals[0].txHash;f.receipts[1].txHash=f.receipts[0].txHash;},
 'receipt hash differs':f=>{f.receipts[0].txHash=txHashes[1];},
 'already proposed':f=>{f.receipts[0].status='proposed';},
 'already checkpointed':f=>{f.receipts[0].status='checkpointed';},
 'dropped':f=>{f.receipts[0].status='dropped';},
 'unknown':f=>{f.receipts[0].status='unknown';},
 'execution result before inclusion':f=>{f.receipts[0].executionResult='success';},
 'missing actor':f=>{f.receipts.pop();},
 'noncanonical hash':f=>{f.journals[0].txHash='0x3';f.receipts[0].txHash='0x3';},
};
for(const [name,mutate]of Object.entries(badPending))test('synthetic pending barrier rejects '+name,()=>{const f=pendingFixture();mutate(f);assert.throws(()=>assertNameCollisionPending(f));});
for(const winner of [0,1])test('synthetic winner '+winner+' requires exact event, canonical-name ownership and loser rollback',()=>{
 const f=outcomeFixture(winner),report=assertNameCollisionOutcome(f);assert.equal(report.successfulRegistrations,1);assert.equal(report.revertedRegistrations,1);assert.equal(report.privateTransactions,2);
 assert.equal(report.structuredCollisionReason,true);assert.equal(report.loserOwnershipRolledBack,true);
 for(const privateValue of [plan.nameId,...intentIds,...txHashes,'River','Stone','river','STONE'])assert(!JSON.stringify(report).includes(privateValue));
});
const badOutcomes={
 'both succeed':f=>{f.receipts[1].executionResult='success';},
 'both revert':f=>{f.receipts[0].executionResult='reverted';},
 'loser dropped':f=>{f.receipts[1].status='dropped';},
 'winner only proposed':f=>{f.receipts[0].status='proposed';},
 'unknown result':f=>{f.receipts[1].executionResult=undefined;},
 'wrong receipt hash':f=>{f.receipts[1].txHash=txHashes[0];},
 'missing structured attribution':f=>{delete f.collision;},
 'outage is not collision':f=>{f.collision.matched=false;},
 'classification bound to winner':f=>{f.collision.txHash=txHashes[0];},
 'missing winner event':f=>{f.events[0]=[];},
 'extra winner event':f=>{f.events[0].push(structuredClone(f.events[0][0]));},
 'wrong winner event kind':f=>{f.events[0][0].type='PostPublished';},
 'wrong readable metadata':f=>{f.events[0][0].payload.first_length='1';},
 'loser display metadata on winner':f=>{f.events[0][0].payload=structuredClone(plan.expected[1].payload);},
 'wrong canonical id':f=>{f.events[0][0].payload.name_id='123';},
 'unexpected payload member':f=>{f.events[0][0].payload.owner='PRIVATE_SENTINEL';},
 'loser public event':f=>{f.events[1]=structuredClone(f.events[0]);},
 'loser unknown Board log':f=>{f.boardLogs[1]=[{}];},
 'winner Board log missing':f=>{f.boardLogs[0]=[];},
 'winner extra Board log':f=>{f.boardLogs[0].push({});},
 'winner private name missing':f=>{f.ownership[0].head=empty();},
 'loser privately owns name':f=>{f.ownership[1].head=structuredClone(f.ownership[0].head);},
 'swapped private ownership':f=>{f.ownership.reverse();},
 'extra private name':f=>{f.ownership[0].head.records.push(structuredClone(f.ownership[0].head.records[0]));},
 'wrong private label':f=>{f.ownership[0].head.records[0].first='OTHER';},
 'inconsistent private id array':f=>{f.ownership[0].head.identities=[];},
 'unexpected private continuation':f=>{f.ownership[0].head.nextCursor=8;},
 'hidden private tail':f=>{f.ownership[1].tail=structuredClone(f.ownership[0].head);},
 'duplicate binding intents':f=>{f.binding.intentIds[1]=f.binding.intentIds[0];},
};
for(const [name,mutate]of Object.entries(badOutcomes))test('synthetic outcome rejects '+name,()=>{const f=outcomeFixture();mutate(f);assert.throws(()=>assertNameCollisionOutcome(f));});
test('synthetic payload property order is irrelevant but its actual fields remain exact',()=>{
 const f=outcomeFixture();f.events[0][0].payload=Object.fromEntries(Object.entries(f.events[0][0].payload).reverse());assert.equal(assertNameCollisionOutcome(f).privateOwnershipExact,true);
});

test('installed block factory omits reasons until real SDK metadata conversion receives the exact leaf and guard',async()=>{
 const {createPublicTxSimulatorForBlockBuilding}=await import('@aztec-labs/simulator/server');
 const {CallStackMetadata,PublicTxResult,RevertCode}=await import('@aztec-labs/stdlib/avm');
 const {GlobalVariables,TxExecutionPhase}=await import('@aztec-labs/stdlib/tx');
 const {Gas}=await import('@aztec-labs/stdlib/gas');
 const simulator=createPublicTxSimulatorForBlockBuilding({},GlobalVariables.empty(),{},1);
 assert.equal(simulator.config.collectCallMetadata,false);assert.equal(simulator.config.skipFeeEnforcement,false);
 const result=PublicTxResult.empty();result.revertCode=RevertCode.REVERTED;
 assert.equal(result.findRevertReason(),undefined);assert.equal(predicate(result.findRevertReason()),false);
 // Metadata below is labelled synthetic, converted by the actual pinned SDK.
 // The separate observer regression tests toggling on the installed factory;
 // only a genuine race can qualify AVM metadata and canonical inclusion.
 for(const disposition of ['exact','wrong-contract','wrong-selector','wrong-guard']){
  const metadata=new CallStackMetadata(TxExecutionPhase.APP_LOGIC,
   (disposition==='wrong-contract'?other:boardAddress).toField(),0,
   [new Fr(disposition==='wrong-selector'?0n:BigInt(functionSelector.value))],false,Gas.empty(),
   [errorField(disposition==='wrong-guard'?'Post removed':'Name already registered')],[],undefined,true,[],0);
  result.callStackMetadata=[metadata];const reason=result.findRevertReason();
  assert(reason instanceof SimulationError);assert.equal(predicate(reason),disposition==='exact');
 }
});
