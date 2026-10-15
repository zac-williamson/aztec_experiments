// Trusted harness attribution only. artifact must be the parent-authenticated,
// processed RollingBoard artifact. Never persist the error, stack or revert data.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
import {FunctionSelector} from '@aztec-labs/stdlib/abi';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {resolveAssertionMessageFromRevertData} from '@aztec-labs/simulator/client';
const invalid=()=>Error('Name-collision classifier configuration is invalid.');
function data(object,key){const d=Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;}
// Capture pinned SDK primitive storage without invoking methods/getters supplied
// by the error. Reconstruct clean SDK values before invoking its ABI decoder.
function field(value){if(Object.getPrototypeOf(value)!==Fr.prototype)throw invalid();const n=data(value,'asBigInt');if(typeof n!=='bigint'||n<0n||n>=Fr.MODULUS)throw invalid();return new Fr(n);}
function address(value){if(Object.getPrototypeOf(value)!==AztecAddress.prototype)throw invalid();return field(data(value,'xCoord')).toString();}
function selector(value){if(Object.getPrototypeOf(value)!==FunctionSelector.prototype)throw invalid();const n=data(value,'value');if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw invalid();return n;}

export async function createNameCollisionClassifier({artifact,boardAddress}){
 let expectedAddress,expectedSelector,assertionSelector,dispatch;
 try{
  expectedAddress=typeof boardAddress==='string'?boardAddress:address(boardAddress);
  if(!/^0x[0-9a-f]{64}$/.test(expectedAddress)||new Fr(BigInt(expectedAddress)).toString()!==expectedAddress||BigInt(expectedAddress)===0n)throw invalid();
  const functions=artifact.nonDispatchPublicFunctions?.filter(fn=>fn.name==='_register_name');
  const dispatchers=artifact.functions?.filter(fn=>fn.name==='public_dispatch');
  if(functions?.length!==1||dispatchers?.length!==1||functions[0].functionType!=='public'||functions[0].isOnlySelf!==true)throw invalid();
  dispatch={errorTypes:structuredClone(dispatchers[0].errorTypes)};
  const guards=Object.entries(dispatch.errorTypes).filter(([,v])=>v.error_kind==='string'&&v.string==='Name already registered');if(guards.length!==1)throw invalid();
  if(!/^(?:0|[1-9][0-9]*)$/.test(guards[0][0]))throw invalid();
  assertionSelector=new Fr(BigInt(guards[0][0])).toBigInt();
  expectedSelector=selector(await FunctionSelector.fromNameAndParameters(functions[0]));
 }catch{throw invalid();}
 return error=>{
  try{
   if(!(error instanceof SimulationError))return false;
   // SDK getCallStack returns its own data field. Reject accessor replacement
   // before calling the installed prototype; never call an error-owned method.
   const stored=data(error,'functionErrorStack');
   const stack=SimulationError.prototype.getCallStack.call(error);
   if(stack!==stored||!Array.isArray(stack)||stack.length<1||stack.length>32)return false;
   const leaf=data(stack,String(stack.length-1));
   if(address(data(leaf,'contractAddress'))!==expectedAddress||selector(data(leaf,'functionSelector'))!==expectedSelector)return false;
   const raw=data(error,'revertData');
   // The required assertion is a static Noir string: exactly its selector, no
   // variable payload. Missing/trailing data cannot qualify the guard.
   if(!Array.isArray(raw)||raw.length!==1)return false;
   const revertData=[field(data(raw,'0'))];
   // Unknown selectors can make the Noir WASM decoder print a panic before
   // throwing. Only the artifact-bound static guard may reach that decoder.
   if(revertData[0].toBigInt()!==assertionSelector)return false;
   return resolveAssertionMessageFromRevertData(revertData,dispatch)==='Name already registered';
  }catch{return false;}
 };
}

// All records below are supplied by the trusted parent after canonical receipt,
// effect and log authentication. These assertions do not authenticate an RPC or
// confer a production brand. Plans/bindings/ownership remain in parent memory;
// persist only the returned aggregate result, never actor-to-owner associations.
const hex=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n;
const exact=(value,keys)=>assert(value&&typeof value==='object'&&Object.keys(value).sort().join(',')===keys.slice().sort().join(','),'Unexpected collision record');
const same=(a,b)=>assert(isDeepStrictEqual(a,b),'Collision record mismatch');
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function packed(bytes){let first=0n;for(const b of bytes.slice(0,31))first=(first<<8n)|BigInt(b);return [String(first),String(BigInt(bytes[31])<<240n)];}

export async function createRollingNameCollisionPlan(){
 const actions=[{type:'name',first:'River',last:'Stone'},{type:'name',first:' river ',last:' STONE '}];
 const registrations=actions.map(({first,last})=>nameRegistration(first,last));
 same(registrations[0].preimage.map(String),registrations[1].preimage.map(String));
 assert.notEqual(JSON.stringify(registrations[0].arguments),JSON.stringify(registrations[1].arguments),'Distinct display inputs required');
 const ids=[];for(const r of registrations)ids.push((await poseidon2HashWithSeparator(r.preimage.map(n=>new Fr(n)),NAME_DOMAIN)).toString());
 assert(hex(ids[0])&&ids[0]===ids[1],'Normalized names must collide');
 const expected=registrations.map(r=>{const [first,firstLength,last,lastLength]=r.arguments;return {
  identity:{id:ids[0],first:r.name.first,last:r.name.last},
  payload:{schema:'1',name_id:String(BigInt(ids[0])),first_length:String(firstLength),first:packed(first),last_length:String(lastLength),last:packed(last)},
 };});
 return freeze({nameId:ids[0],actions,expected});
}

/** Parent invokes only while ordinary sequencing remains paused, after both
 * genuine submissions reached the actual node. Receipt fields are primitive
 * extracts, not assumptions about SDK receipt own-property layout. */
export function assertNameCollisionPending({intentIds,journals,receipts}){
 for(const list of [intentIds,journals,receipts])assert(Array.isArray(list)&&list.length===2,'Two actors required');
 assert(intentIds.every(id=>hex(id)&&BigInt(id)<Fr.MODULUS)&&intentIds[0]!==intentIds[1],'Distinct canonical intents required');
 const txHashes=journals.map((journal,i)=>{
  assert(journal&&journal.operation==='ROLLING_WORKFLOW_V1:'+intentIds[i]&&hex(journal.txHash),'Pending journal binding differs');
  const receipt=receipts[i];assert(receipt&&receipt.txHash===journal.txHash&&receipt.status==='pending'&&receipt.executionResult==null,'Both transactions must be pending');
  return journal.txHash;
 });
 assert.notEqual(txHashes[0],txHashes[1],'Distinct transactions required');
 return freeze({intentIds:[...intentIds],txHashes});
}
function ownership(value,expected){
 exact(value,['head','tail']);const {head,tail}=value;
 exact(head,['identities','records','nextCursor']);assert(head.nextCursor===null,'Unexpected continuation');
 same(head.identities,expected.map(record=>record.id));
 assert(Array.isArray(head.records)&&head.records.length===expected.length,'Incorrect private ownership count');
 for(let i=0;i<expected.length;i++){exact(head.records[i],['id','first','last']);same(head.records[i],expected[i]);}
 same(tail,{identities:[],records:[],nextCursor:null});
}
/** collision is the parent's exact structured classifier observation, matched
 * to the canonical reverted hash. No message-only or inferred rejection passes.
 * The parent separately owns fees, journal reconciliation and canonical anchors. */
export function assertNameCollisionOutcome({plan,binding,receipts,events,boardLogs,ownership:owned,collision}){
 assert(plan&&hex(plan.nameId)&&Array.isArray(plan.expected)&&plan.expected.length===2,'Collision plan required');
 exact(binding,['intentIds','txHashes']);assert(Array.isArray(binding.intentIds)&&binding.intentIds.length===2&&binding.intentIds.every(id=>hex(id)&&BigInt(id)<Fr.MODULUS)&&binding.intentIds[0]!==binding.intentIds[1]&&Array.isArray(binding.txHashes)&&binding.txHashes.length===2&&binding.txHashes.every(hex)&&binding.txHashes[0]!==binding.txHashes[1],'Pending binding required');
 for(const list of [receipts,events,boardLogs,owned])assert(Array.isArray(list)&&list.length===2,'Two actor outcomes required');
 for(let i=0;i<2;i++)assert(receipts[i]?.txHash===binding.txHashes[i]&&['checkpointed','proven','finalized'].includes(receipts[i]?.status),'Canonical mined receipt required');
 const winner=receipts.findIndex(r=>r.executionResult==='success'),loser=receipts.findIndex(r=>r.executionResult==='reverted');
 assert(winner>=0&&loser>=0&&winner!==loser,'Exactly one success and one revert required');
 exact(collision,['txHash','matched']);assert(collision.matched===true&&collision.txHash===binding.txHashes[loser],'Exact structured collision attribution required');
 assert(events.every(Array.isArray)&&boardLogs.every(Array.isArray),'Authenticated event/log arrays required');
 assert(events[winner].length===1&&events[winner][0].type==='NameRegistered'&&boardLogs[winner].length===1,'Exactly one registration required');
 exact(events[winner][0].payload,['schema','name_id','first_length','first','last_length','last']);
 same(events[winner][0].payload,plan.expected[winner].payload);
 assert(plan.expected[winner].identity.id===plan.nameId&&plan.expected[winner].payload.name_id===String(BigInt(plan.nameId)),'Name identity differs');
 assert(events[loser].length===0&&boardLogs[loser].length===0,'Reverted registration leaked public state');
 ownership(owned[winner],[plan.expected[winner].identity]);ownership(owned[loser],[]);
 return {scenario:'normalized-name-collision',privateTransactions:2,successfulRegistrations:1,revertedRegistrations:1,
  structuredCollisionReason:true,privateOwnershipExact:true,loserOwnershipRolledBack:true,
  scope:'Assertions over parent-authenticated pending barrier, canonical receipts/effects and private ownership. Parent owns real proofs, canonicality, fees, journal recovery and lifecycle.'};
}
