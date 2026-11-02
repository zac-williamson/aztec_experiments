import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {FunctionSelector} from '@aztec-labs/stdlib/abi';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {siloNoteHash,computeUniqueNoteHash} from '@aztec-labs/stdlib/hash';
import {allToCompletion} from '@aztec-labs/foundation/promise';
import {Note} from '@aztec-labs/stdlib/note';
import {UtilityExecutionOracle} from '../node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js';
import {Option} from '../node_modules/@aztec-labs/pxe/dest/contract_function_simulator/noir-structs/option.js';
import {selectedNoteWitnesses,SELECTED_NOTE_PINS} from './selected-note-witnesses.mjs';
const source=Object.fromEntries(Object.keys(SELECTED_NOTE_PINS).map(name=>[name,fs.readFileSync(new URL('../'+name,import.meta.url),'utf8')]));
const [simulatorPath,interactionPath]=Object.keys(source),simulator=selectedNoteWitnesses(source[simulatorPath],simulatorPath),interaction=selectedNoteWitnesses(source[interactionPath],interactionPath);
const capture=vm.runInNewContext(simulator.slice(simulator.indexOf('async function rollingSelectedNoteCapture'))+';rollingSelectedNoteCapture',{Fr,FunctionSelector,allToCompletion,siloNoteHash,computeUniqueNoteHash});
async function fixture({wrongClass=false,wrongOwner=false,wrongName=false,currentArtifact,currentClassId}={}){
 const owner=AztecAddress.fromFieldUnsafe(new Fr(7)),board=AztecAddress.fromFieldUnsafe(new Fr(8)),hash=BlockHash.random(),postSlot=new Fr(BigInt(currentArtifact?.storageLayout.posts.slot??12)),depositSlot=new Fr(BigInt(currentArtifact?.storageLayout.deposits.slot??13));
 const artifact={name:wrongName?'other':'get_screen_hints',parameters:[]},call={to:board,selector:await FunctionSelector.fromNameAndParameters(artifact.name,artifact.parameters),args:[owner.toField(),new Fr(9)]};
 const posts=[1,2].map(i=>({contractAddress:board,owner,storageSlot:postSlot,note:new Note([new Fr(9),new Fr(i-1)]),noteHash:new Fr(40+i),noteNonce:new Fr(50+i),randomness:new Fr(60+i),siloedNullifier:new Fr(70+i)}));
 const deposit={...posts[0],storageSlot:depositSlot,noteHash:new Fr(99)};
 let reads=0;
 const oracle=Object.create(UtilityExecutionOracle.prototype);Object.assign(oracle,{callContext:{contractAddress:board},scopes:[owner],anchorBlockHeader:{},changeSetId:42,aztecNode:{},noteStore:{getNotes:async(filter,id)=>{reads++;assert.equal(id,42);assert(filter.contractAddress.equals(board));assert(filter.owner.equals(owner));assert.equal(filter.scopes[0],owner);return [deposit,...posts].filter(note=>note.storageSlot.equals(filter.storageSlot));}}});
 const finish=await capture(oracle,call,artifact,[wrongOwner?AztecAddress.ZERO:owner],{getCurrentClassId:async()=>currentClassId??new Fr(42)},{getContractArtifact:async id=>{assert(id.equals(currentClassId??new Fr(42)));return wrongClass?undefined:currentArtifact??{name:'RollingBoard',storageLayout:{posts:{slot:12},deposits:{slot:13}}};}},{hash:async()=>hash});
 const select=(slot,count,previous)=>oracle.getNotes(Option.some(owner),slot,count,[0,1],[0,0],[32,32],[new Fr(9),new Fr(previous)], [1,1],[],[],[],[],2,0,0,2,9);
 return {owner,board,hash,posts,deposit,finish,oracle,select,postSlot,depositSlot,reads:()=>reads};
}
for(const count of [0,1,2])test(`capture ${count} native-selected PostNotes and the exact selected deposit without another query`,async()=>{
 const f=await fixture();await f.select(f.depositSlot,1,0);
 for(let i=0;i<count;i++){const selected=await f.select(f.postSlot,2,i);assert.equal(selected.data.length,1);assert(selected.data[0].noteHash.equals(f.posts[i].noteHash));}
 const meta=await f.finish();assert.equal(meta.board,f.board.toString());assert.equal(meta.owner,f.owner.toString());assert.equal(meta.anchorHash,f.hash.toString());
 assert.deepEqual([...meta.hashes],await Promise.all(f.posts.slice(0,count).map(async n=>(await computeUniqueNoteHash(n.noteNonce,await siloNoteHash(n.contractAddress,n.noteHash))).toString())));
 assert.equal(meta.depositHash,(await computeUniqueNoteHash(f.deposit.noteNonce,await siloNoteHash(f.deposit.contractAddress,f.deposit.noteHash))).toString());
 assert.equal(f.reads(),count+1,'no second native note query');
});
test('current deployed Board class captures deposit and history without an obsolete gas-profile gate',async()=>{
 const currentArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
 const currentClassId=(await getContractClassFromArtifact(currentArtifact)).id;
 const f=await fixture({currentArtifact,currentClassId});await f.select(f.depositSlot,1,0);await f.select(f.postSlot,2,0);
 const meta=await f.finish();assert(meta);assert.equal(meta.hashes.length,1);assert.equal(typeof meta.depositHash,'string');assert.equal(f.reads(),2);
});
for(const config of [{wrongClass:true},{wrongOwner:true},{wrongName:true}])test('unqualified utility capture absent '+JSON.stringify(config),async()=>{
 const f=await fixture(config);await f.select(f.postSlot,2,0);assert.equal(await f.finish(),undefined);assert.equal(f.reads(),1);
});
test('ambiguous or excess selection cannot expose witness hints',async()=>{
 const f=await fixture();await f.select(f.postSlot,0,0);assert.equal(await f.finish(),undefined);
 const g=await fixture();await g.select(g.postSlot,2,0);await g.select(g.postSlot,2,1);await g.select(g.postSlot,2,0);assert.equal(await g.finish(),undefined);
});
test('per-utility captures are independent and preserve native note-selection failures',async()=>{
 const a=await fixture(),b=await fixture();await a.select(a.postSlot,2,0);assert.equal((await b.finish()).hashes.length,0);
 const failure=Error('native selection failed');b.oracle.noteStore.getNotes=async()=>{throw failure;};await assert.rejects(b.select(b.postSlot,2,0),e=>e===failure);
 assert.equal((await a.finish()).hashes.length,1);
});
test('source pins, optional explicit metadata, success-only capture and log ownership remain intact',()=>{
 for(const [name,text]of Object.entries(source))assert.throws(()=>selectedNoteWitnesses(text+' ',name),/source mismatch/);
 assert.match(simulator,/const log = new PrivateLog\(\[\.\.\.metadata\.log\.fields\]/);
 assert.equal(simulator.match(/noteHashWitnessHints:await finishNoteWitnessHints\(\)/g).length,1);
 assert(simulator.indexOf('noteHashWitnessHints:await finishNoteWitnessHints()')>simulator.indexOf('acirExecutionResult.returnWitness'));
 assert.equal(interaction.match(/noteHashWitnessHints:utilityResult.noteHashWitnessHints/g).length,2);
 assert.match(simulator,/offchainEffects: oracle.getOffchainEffects\(\)/);
});

import {validatedPxeProve} from './pxe-validated-prove.mjs';
import {FunctionType,decodeFromAbi,getFunctionReturnType} from '@aztec-labs/stdlib/abi';
import {extractOffchainOutput} from '../node_modules/@aztec-labs/aztec.js/dest/contract/interaction_options.js';
const pxe=validatedPxeProve(fs.readFileSync(new URL('../node_modules/@aztec-labs/pxe/dest/pxe.js',import.meta.url),'utf8'));
function method(text,start){const a=text.indexOf(start),b=text.indexOf('\n    /**',a);assert(a>=0&&b>a);return text.slice(a,b);}
const timings=vm.runInNewContext(pxe.slice(0,pxe.indexOf('import '))+';({beginRollingProofSpan,measureRollingProofPhase})',{performance});
for(const includeMetadata of [false,true])for(const present of [false,true])test(`actual native PXE and interaction forward optional hints metadata=${includeMetadata} present=${present}`,async()=>{
 const hint={board:'board',owner:'owner',anchorHash:'hash',hashes:[]},result={result:[new Fr(123)],offchainEffects:[],...(present?{noteHashWitnessHints:hint}:{})};
 let executions=0;
 const Pxe=vm.runInNewContext(`(class {
 #getSimulatorForTx(){return {runUtility:async()=>{executions.next();return result;}};}
 operationQueue={runSynced:operation=>operation({changeSetId:7,syncTime:0,anchorBlockHeader:{globalVariables:{timestamp:0n}},recording:{stats:()=>({})},totalMs:()=>0})};
 contractSyncService={ensureContractSynced:async()=>{}};
 ${method(pxe,'async #executeUtility(')}
 ${method(pxe,'executeUtility(call, { authwits, scopes }')}
 })`,{...timings,result,executions:{next:()=>executions++},Timer:class{ms(){return 0;}},SimulationError:class extends Error{}});
 const NativeInteraction=vm.runInNewContext(`(class {${method(interaction,'async simulate(options = {}) {')}})`,{FunctionType,decodeFromAbi,getFunctionReturnType,extractOffchainOutput,NO_FROM:Symbol('no-from')});
 const native=new NativeInteraction();native.functionDao={functionType:FunctionType.UTILITY,returnTypes:[{kind:'field'}]};native.wallet=new Pxe();native.getFunctionCall=async()=>({to:AztecAddress.ZERO,args:[],selector:new Fr(1),name:'test'});
 const output=await native.simulate({from:AztecAddress.ZERO,includeMetadata});
 assert.equal(output.result,123n);assert.equal(executions,1);assert.equal(Object.hasOwn(output,'noteHashWitnessHints'),present);if(present)assert.equal(output.noteHashWitnessHints,hint);
 assert.equal(Object.hasOwn(output,'stats'),includeMetadata);assert.deepEqual(result.offchainEffects,[]);
});
