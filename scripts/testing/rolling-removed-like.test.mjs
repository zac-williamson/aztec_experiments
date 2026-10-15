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
import {createRemovedLikeClassifier} from './rolling-removed-like.mjs';
after(async()=>{await BarretenbergSync.destroySingleton();});
const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
const boardAddress=AztecAddress.fromBigIntUnsafe(44n),other=AztecAddress.fromBigIntUnsafe(45n);
const like=artifact.nonDispatchPublicFunctions.find(f=>f.name==='_set_like'),dispatch=artifact.functions.find(f=>f.name==='public_dispatch');
const functionSelector=await FunctionSelector.fromNameAndParameters(like);
const errorField=text=>new Fr(BigInt(Object.entries(dispatch.errorTypes).find(([,v])=>v.error_kind==='string'&&v.string===text)[0]));
const predicate=await createRemovedLikeClassifier({artifact,boardAddress});
function fixture(){return new SimulationError('PRIVATE_SENTINEL',[{contractAddress:other,functionSelector:FunctionSelector.empty()},
 {contractAddress:boardAddress,functionSelector}],[errorField('Post removed')]);}
test('accepts only actual error shape with deepest callee and ABI-decoded static assertion',()=>{
 const error=fixture();assert.equal(predicate(error),true);assert.equal(error.getOriginalMessage(),'PRIVATE_SENTINEL');assert.equal(error.revertData.length,1);
});
test('supports canonical board string and schema-reconstructed transport error',async()=>{
 const classify=await createRemovedLikeClassifier({artifact,boardAddress:String(boardAddress)});
 const decoded=SimulationError.schema.parse(JSON.parse(JSON.stringify(fixture().toJSON())));assert.equal(classify(decoded),true);
});
const mutations={
 'wrong deepest contract':e=>{e.functionErrorStack.at(-1).contractAddress=other;},
 'wrong deepest selector':e=>{e.functionErrorStack.at(-1).functionSelector=FunctionSelector.empty();},
 'matching outer frame only':e=>{e.functionErrorStack.reverse();},
 'different contract guard':e=>{e.revertData=[errorField('Unknown post')];},
 'empty call stack':e=>{e.functionErrorStack=[];},
 'missing selector':e=>{delete e.functionErrorStack.at(-1).functionSelector;},
 'missing revert data':e=>{delete e.revertData;},
 'empty revert data':e=>{e.revertData=[];},
 'trailing revert data':e=>{e.revertData.push(Fr.ONE);},
 'unknown assertion selector':e=>{e.revertData=[Fr.ZERO];},
 'untyped revert field':e=>{e.revertData=[{toBigInt:()=>errorField('Post removed').toBigInt()}];},
 'untyped callee':e=>{e.functionErrorStack.at(-1).contractAddress={toString:()=>String(boardAddress)};},
 'untyped selector':e=>{e.functionErrorStack.at(-1).functionSelector={value:functionSelector.value};},
 'unbounded stack':e=>{e.functionErrorStack=Array(33).fill(e.functionErrorStack.at(-1));},
};
for(const [name,mutate]of Object.entries(mutations))test('synthetic attribution rejects '+name,()=>{const e=fixture();mutate(e);assert.equal(predicate(e),false);});
test('plain error, message-only imitation, nested cause and outage never qualify',()=>{
 for(const e of [null,undefined,Error('Post removed'),{message:'Post removed',functionErrorStack:fixture().functionErrorStack,revertData:fixture().revertData},new Error('outage',{cause:fixture()})])assert.equal(predicate(e),false);
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
 error.originalMessage='Post removed';assert.equal(predicate(error),true);assert.equal(accesses,0);
});
test('revoked proxy fails closed without propagating its exception',()=>{const {proxy,revoke}=Proxy.revocable(fixture(),{});revoke();assert.equal(predicate(proxy),false);});
for(const mutate of [a=>{a.nonDispatchPublicFunctions=[];},a=>{a.functions=a.functions.filter(f=>f.name!=='public_dispatch');},a=>{a.nonDispatchPublicFunctions.find(f=>f.name==='_set_like').isOnlySelf=false;},a=>{a.functions.find(f=>f.name==='public_dispatch').errorTypes={};}])
 test('incomplete artifact rejects classifier setup with fixed message',async()=>{const a=structuredClone(artifact);mutate(a);await assert.rejects(createRemovedLikeClassifier({artifact:a,boardAddress}),{message:'Removed-like classifier configuration is invalid.'});});
test('assertion metadata is detached from later caller mutation',async()=>{
 const a=structuredClone(artifact),classify=await createRemovedLikeClassifier({artifact:a,boardAddress});a.functions.find(f=>f.name==='public_dispatch').errorTypes={};assert.equal(classify(fixture()),true);
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
 import {createRemovedLikeClassifier} from './scripts/testing/rolling-removed-like.mjs';
 try {
  const artifact=loadContractArtifact(JSON.parse(await fs.readFile(${JSON.stringify(process.env.ROLLING_TEST_ARTIFACT??fileURLToPath(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url)))},'utf8')));
  const boardAddress=AztecAddress.fromBigIntUnsafe(44n);
  const classify=await createRemovedLikeClassifier({artifact,boardAddress});
  const functionSelector=await FunctionSelector.fromNameAndParameters(artifact.nonDispatchPublicFunctions.find(f=>f.name==='_set_like'));
  const error=new SimulationError('PRIVATE_SENTINEL',[{contractAddress:boardAddress,functionSelector}],[Fr.ZERO]);
  assert.equal(classify(error),false);
  const guard=Object.entries(artifact.functions.find(f=>f.name==='public_dispatch').errorTypes).find(([,v])=>v.error_kind==='string'&&v.string==='Post removed')[0];
  error.revertData=[new Fr(BigInt(guard))];assert.equal(classify(error),true);
 } finally { await BarretenbergSync.destroySingleton(); }
 `;
 const {stdout,stderr}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{LOG_LEVEL:'silent'},timeout:10000,maxBuffer:65536});
 assert.equal(stdout,'');assert.equal(stderr,'');
});
