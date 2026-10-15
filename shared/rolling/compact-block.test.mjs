import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockNumber,CheckpointNumber,IndexWithinCheckpoint} from '@aztec-labs/foundation/branded-types';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {BlockHeader,GlobalVariables,TxEffect,TxHash} from '@aztec-labs/stdlib/tx';
import {Body,L2Block} from '@aztec-labs/stdlib/block';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {RevertCode,PublicDataWrite} from '@aztec-labs/stdlib/avm';
import {PrivateLog,PublicLog,ContractClassLog,ContractClassLogFields} from '@aztec-labs/stdlib/logs';
import {encodeBlockEndMarker,encodeTxStartMarker,getNumTxBlobFields} from '@aztec-labs/blob-lib/encoding';
import {authenticateCompactBlock,isAuthenticatedCompactBlock,COMPACT_BLOCK_LIMITS} from './compact-block.mjs';

after(async()=>{await BarretenbergSync.destroySingleton();});
// Labelled synthetic block contents and canonical-lease doubles; hashing,
// serialization, tree shape, header and TxEffect handling use the pinned SDK.
// These checks establish neither genuine chain inclusion nor private recovery.
const hex=n=>new Fr(n).toString();
const global=()=>GlobalVariables.empty({chainId:new Fr(31337),version:new Fr(1),blockNumber:BlockNumber(7),timestamp:100n});
const block=(header,effects)=>new L2Block(AppendOnlyTreeSnapshot.empty(),header,new Body(effects),CheckpointNumber(1),IndexWithinCheckpoint(0));
const header=root=>BlockHeader.empty({globalVariables:global(),txEffectsTreeRoot:root});
function bareInput() {
  const h=header(Fr.ZERO);
  return {fields:block(h,[]).toBlobFields().map(x=>x.toString()),headerFields:h.toFields().map(x=>x.toString()),
    expectedBlockHash:hex(0),assertCanonical:()=>false};
}
function tx(id,{privateLogs=[],publicLogs=[],classFields=[],reverted=false}={}) {
  return new TxEffect(reverted?RevertCode.REVERTED:RevertCode.OK,new TxHash(new Fr(id)),new Fr(3),
    [new Fr(id+100)],[new Fr(id+200)],[new Fr(id+300)],[new PublicDataWrite(new Fr(id+400),new Fr(1))],
    privateLogs.map(fields=>PrivateLog.fromBlobFields(fields.length,fields.map(x=>new Fr(x)))),
    publicLogs.map(fields=>new PublicLog(AztecAddress.fromFieldUnsafe(new Fr(5)),fields.map(x=>new Fr(x)))),
    classFields.length?[new ContractClassLog(AztecAddress.fromFieldUnsafe(new Fr(6)),ContractClassLogFields.fromEmittedFields(classFields.map(x=>new Fr(x))),classFields.length)]:[]);
}
async function fixture(effects=[tx(10,{privateLogs:[[7,8,9],[10]],publicLogs:[[11,12]],classFields:[13,14]})]) {
  const body=new Body(effects),h=header(await body.computeTxEffectsTreeRoot());
  return {fields:block(h,effects).toBlobFields().map(x=>x.toString()),headerFields:h.toFields().map(x=>x.toString()),
    expectedBlockHash:(await h.hash()).toString(),assertCanonical:()=>true};
}
const rejected=promise=>assert.rejects(promise,e=>{
  assert.equal(e.code,'ROLLING_COMPACT_BLOCK_INVALID');
  assert.equal(e.message,'Compact block is invalid or unavailable.');assert.equal(e.cause,undefined);return true;
});
function markerInput(change,tail=[]) {
  const input=bareInput(),m={numNoteHashes:0,numNullifiers:1,numL2ToL1Msgs:0,numPublicDataWrites:0,
    numPrivateLogs:0,privateLogsLength:0,publicLogsLength:0,contractClassLogLength:0,revertCode:0,...change};
  m.numBlobFields=change.numBlobFields??getNumTxBlobFields(m);
  const scalarCount=Math.min(8500,m.numNoteHashes+m.numNullifiers+m.numL2ToL1Msgs+2*m.numPublicDataWrites);
  const data=[encodeTxStartMarker(m).toString(),hex(1),hex(0),...Array(scalarCount).fill(hex(2)),...tail];
  // Supply enough bytes to reach category checks rather than always rejecting
  // an independently short fixture; extreme declared sizes remain bounded here.
  while(data.length<m.numBlobFields && data.length<8500)data.push(hex(1));
  input.fields[0]=encodeBlockEndMarker({numTxs:1,timestamp:100n,blockNumber:BlockNumber(7)}).toString();
  input.fields=[...data,...input.fields];return input;
}

test('shape: limits are protocol-derived and no full Body expansion is imported',()=>{
 assert.deepEqual(COMPACT_BLOCK_LIMITS,{fields:24575,transactions:6142,headerFields:23});
 const source=fs.readFileSync(new URL('./compact-block.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/import\s*\{[^}]*\bBody\b|Body\.fromTxBlobData|Promise\.all/);
 assert.match(source,/await effect\.computeTxEffectsTreeLeaf/);
});
test('shape: oversized declared array rejects before touching any element or lease',async()=>{
 const input=bareInput();let reads=0,calls=0;
 input.fields=new Array(24576);Object.defineProperty(input.fields,'0',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 input.assertCanonical=()=>{calls++;return true;};await rejected(authenticateCompactBlock(input));assert.equal(reads,0);assert.equal(calls,0);
});
test('shape: sparse arrays, getters and malformed field widths reject without getter invocation',async()=>{
 for(const replacement of [new Array(7),['0x1',...bareInput().fields.slice(1)],['0x'+'f'.repeat(64),...bareInput().fields.slice(1)]]) {
  await rejected(authenticateCompactBlock({...bareInput(),fields:replacement}));
 }
 const input=bareInput();let reads=0;Object.defineProperty(input.fields,'2',{get(){reads++;return hex(0);}});
 await rejected(authenticateCompactBlock(input));assert.equal(reads,0);
});
test('shape: required capabilities are own data, not inherited/accessor/optional',async()=>{
 const input=bareInput();let reads=0;Object.defineProperty(input,'assertCanonical',{get(){reads++;return()=>true;}});
 await rejected(authenticateCompactBlock(input));assert.equal(reads,0);
 await rejected(authenticateCompactBlock(Object.create(bareInput())));
 await rejected(authenticateCompactBlock({...bareInput(),assertCanonical:undefined}));
});
test('shape: exact header width and canonical lowercase field encoding',async()=>{
 for(const headerFields of [[],bareInput().headerFields.concat(hex(0)),new Array(24)])await rejected(authenticateCompactBlock({...bareInput(),headerFields}));
 await rejected(authenticateCompactBlock({...bareInput(),expectedBlockHash:'0x'+'A'.repeat(64)}));
});
for(const [name,change] of Object.entries({
 'oversized declared tx':{numBlobFields:8476},'zero progress':{numBlobFields:0},
 'notes':{numNoteHashes:65},'nullifiers':{numNullifiers:65},'missing first nullifier':{numNullifiers:0},
 'messages':{numL2ToL1Msgs:9},'writes':{numPublicDataWrites:65},'private count':{numPrivateLogs:65},
 'private sum':{privateLogsLength:1025},'public size':{publicLogsLength:4097},
 'class size':{contractClassLogLength:3024},'revert code':{revertCode:2},
}))test('shape: rejects '+name+' before lease',async()=>{
 const input=markerInput(change);let calls=0;input.assertCanonical=()=>{calls++;return false;};
 await rejected(authenticateCompactBlock(input));assert.equal(calls,0);
});
test('shape: valid minimal transaction passes structure and reaches lease without hashing',async()=>{
 const input=markerInput({});let calls=0;input.assertCanonical=()=>{calls++;return false;};
 await rejected(authenticateCompactBlock(input));assert.equal(calls,1);
});
test('shape: zero note/nullifier and empty writes reject before lease',async()=>{
 for(const [change,indices] of [[{numNoteHashes:1},[3]],[{},[3]],[{numPublicDataWrites:1},[4,5]]]) {
  const input=markerInput(change);for(const index of indices)input.fields[index]=hex(0);
  let calls=0;input.assertCanonical=()=>{calls++;return false;};await rejected(authenticateCompactBlock(input));assert.equal(calls,0);
 }
});
test('shape: malicious count cannot allocate SDK arrays, errors omit sentinel',async()=>{
 const input=markerInput({numBlobFields:0xffffffff,numNullifiers:65535});let calls=0;
 input.assertCanonical=()=>{calls++;throw Error('PRIVATE_SENTINEL');};
 await rejected(authenticateCompactBlock(input));assert.equal(calls,0);
});
test('shape: private log length zero/17 and false sum reject',async()=>{
 for(const [length,sum] of [[0,0],[17,17],[1,2]]) {
  const fields=Array(Math.min(length,17)).fill(hex(1));
  await rejected(authenticateCompactBlock(markerInput({numPrivateLogs:1,privateLogsLength:sum},[hex(length),...fields])));
 }
});
test('shape: public log payload length beyond declared region rejects before expansion',async()=>{
 await rejected(authenticateCompactBlock(markerInput({publicLogsLength:2},[hex(4095),hex(1)])));
});
test('shape: truncated/trailing/missing end marker rejected',async()=>{
 const input=bareInput();for(const fields of [input.fields.slice(1),input.fields.slice(0,-1),input.fields.concat(hex(0)),Array(7).fill(hex(0))]) {
  await rejected(authenticateCompactBlock({...input,fields}));
 }
});
test('shape: changed state root or end marker requires exact header match before lease',async()=>{
 for(const index of [0,1,2,3,4,5,6]) {
  const input=bareInput();input.fields[index]=hex(BigInt(input.fields[index])+1n);let calls=0;
  input.assertCanonical=()=>{calls++;return true;};await rejected(authenticateCompactBlock(input));assert.equal(calls,0);
 }
});

test('SDK differential: empty block is authenticated only under two canonical lease checks',async()=>{
 const input=await fixture([]),seen=[];input.assertCanonical=b=>{seen.push(b);return true;};
 const result=await authenticateCompactBlock(input);
 assert.equal(result.txCount,0);assert.deepEqual(result.ciphertexts,[]);assert.equal(seen.length,2);
 assert.deepEqual(seen[0],{blockNumber:7,blockHash:input.expectedBlockHash});assert(Object.isFrozen(seen[0]));
 assert(isAuthenticatedCompactBlock(result));assert(!isAuthenticatedCompactBlock({...result}));
});
test('SDK differential: one mixed-category effect retains emitted ciphertext fields and exact ordering',async()=>{
 const input=await fixture(),result=await authenticateCompactBlock(input);
 assert.equal(result.txCount,1);
 assert.deepEqual(result.ciphertexts,[{txHash:hex(10),txIndex:0,logIndex:0,fields:[7,8,9].map(hex)},
  {txHash:hex(10),txIndex:0,logIndex:1,fields:[hex(10)]}]);
 assert(Object.isFrozen(result));assert(Object.isFrozen(result.ciphertexts));assert(Object.isFrozen(result.ciphertexts[0].fields));
});
for(const count of [2,3,5,6,7,8,9])test('SDK differential: ordered unbalanced tree with '+count+' effects',async()=>{
 const result=await authenticateCompactBlock(await fixture(Array.from({length:count},(_,i)=>tx(i+1,{privateLogs:[[i+1,99]],reverted:i%2===1}))));
 assert.equal(result.txCount,count);assert.deepEqual(result.ciphertexts.map(row=>row.txIndex),Array.from({length:count},(_,i)=>i));
});
test('SDK differential: maximum-width private log preserved without padded extra values',async()=>{
 const result=await authenticateCompactBlock(await fixture([tx(8,{privateLogs:[Array.from({length:16},(_,i)=>i+1)]})]));
 assert.equal(result.ciphertexts[0].fields.length,16);
});
test('SDK differential: omitted/reordered/substituted tx or ciphertext fails root',async()=>{
 const effects=[tx(1,{privateLogs:[[5,6]]}),tx(2,{privateLogs:[[7,8]]})],original=await fixture(effects);
 for(const changed of [[effects[1],effects[0]],[effects[0]],[effects[0],effects[0]],[effects[0],tx(2,{privateLogs:[[7,9]]})]]) {
  const other=await fixture(changed);await rejected(authenticateCompactBlock({...other,headerFields:original.headerFields,expectedBlockHash:original.expectedBlockHash}));
 }
});
test('SDK differential: wrong expected hash and noncanonical final lease expose no result',async()=>{
 const input=await fixture();await rejected(authenticateCompactBlock({...input,expectedBlockHash:hex(4)}));
 for(const response of [false,undefined,1,'true']) {
  let calls=0;await rejected(authenticateCompactBlock({...input,assertCanonical:()=>++calls===1?true:response}));assert.equal(calls,2);
 }
});
test('SDK differential: lease errors are sanitized and first failure starts no effect expansion',async()=>{
 const input=await fixture();let expansions=0;
 const original=TxEffect.fromTxBlobData;
 TxEffect.fromTxBlobData=function(...args){expansions++;return original.apply(this,args);};
 try {await rejected(authenticateCompactBlock({...input,assertCanonical:()=>{throw Error('PRIVATE_SENTINEL');}}));assert.equal(expansions,0);}
 finally {TxEffect.fromTxBlobData=original;}
});
test('SDK differential: captures every input before first asynchronous lease; detached output',async()=>{
 const input=await fixture(),savedHash=input.expectedBlockHash;let calls=0;
 input.assertCanonical=async()=>{if(++calls===1){input.fields.fill(hex(0));input.headerFields.fill(hex(0));input.expectedBlockHash=hex(0);input.assertCanonical=()=>false;}return true;};
 const result=await authenticateCompactBlock(input);assert.equal(result.blockHash,savedHash);assert.equal(calls,2);
 assert.deepEqual(result.ciphertexts[0].fields,[7,8,9].map(hex));
});
test('SDK differential: only one expanded effect is alive across leaf awaits',async()=>{
 const input=await fixture([tx(1),tx(2),tx(3)]),original=TxEffect.fromTxBlobData;
 let pending=0,peak=0,total=0;
 TxEffect.fromTxBlobData=function(...args){assert.equal(pending,0);const effect=original.apply(this,args),leaf=effect.computeTxEffectsTreeLeaf;
  effect.computeTxEffectsTreeLeaf=async function(...values){pending++;peak=Math.max(peak,pending);total++;try{return await leaf.apply(this,values);}finally{pending--;}};return effect;};
 try {await authenticateCompactBlock(input);assert.equal(peak,1);assert.equal(total,3);assert.equal(pending,0);}
 finally {TxEffect.fromTxBlobData=original;}
});
test('SDK differential: hash failure releases no partial descriptors',async()=>{
 const input=await fixture([tx(1,{privateLogs:[[1,2]]}),tx(2,{privateLogs:[[3,4]]})]);
 const original=TxEffect.prototype.computeTxEffectsTreeLeaf;let calls=0;
 TxEffect.prototype.computeTxEffectsTreeLeaf=function(...args){if(++calls===2)throw Error('PRIVATE_SENTINEL');return original.apply(this,args);};
 try {await rejected(authenticateCompactBlock(input));assert.equal(calls,2);}finally{TxEffect.prototype.computeTxEffectsTreeLeaf=original;}
});
