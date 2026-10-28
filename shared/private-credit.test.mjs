import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';import {Grumpkin} from '@aztec-labs/foundation/crypto/grumpkin';
import {poseidon2HashWithSeparator as hash} from '@aztec-labs/foundation/crypto/poseidon';import {DomainSeparator} from '@aztec-labs/constants';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';import {computeNoteHashNonce,computeUniqueNoteHash,siloNoteHash} from '@aztec-labs/stdlib/hash';
import {Contract} from '@aztec-labs/aztec.js/contracts';import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {createPrivateCreditReader,selfCreditSecret,tipSpendingKey,creditNullifier,CREDIT_SLOT,CREDIT_OUTPUT_TAG,PAID_LIKE_VALUE,selectCreditInputs} from './private-credit.mjs';
import {PrivatePaidLikePaymentMethod} from './private-fee-payment.mjs';import {capturePaidLikeAction} from './rolling/application.mjs';
import {createEncryptedJournalSlot} from './journal-record.mjs';
const f=n=>new Fr(BigInt(n)),fpc=new AztecAddress(f(20)),board=new AztecAddress(f(21)),owner=new AztecAddress(f(22)),root=f(23),hex=n=>f(n).toString();
after(()=>BarretenbergSync.destroySingleton());
const originalAt=Contract.at;Contract.at=()=>({methods:{credit_root:()=>({simulate:async()=>({result:root})}),tip_root:()=>({simulate:async()=>({result:f(24)})})}});after(()=>{Contract.at=originalAt;});
async function output({tx,block=1,index=0,value=100n,role=3,completion=value,nullifiers}){
 const reference=f(1000+tx),secret=await selfCreditSecret({root,chainId:31337,version:1,fpc,reference,role,index});const key=await tipSpendingKey(secret),blind=await hash([secret],0x52435342),partial=await hash([key.x,key.y,blind],0x5243434d);
 const inner=await hash([f(CREDIT_SLOT),partial,f(value)],DomainSeparator.NOTE_HASH),siloed=await siloNoteHash(fpc,inner),nonce=await computeNoteHashNonce(reference,0),unique=await computeUniqueNoteHash(nonce,siloed),nullifier=await creditNullifier(fpc,unique,secret);
 return {note:{secret,key,blinding:blind,partial,nonce,unique,nullifier,value},log:{blockNumber:block,blockHash:hex(block),txHash:hex(5000+tx),txIndexWithinBlock:tx,logIndexWithinTx:0,nullifiers:[reference,...(nullifiers??[])],noteHashes:[unique],logData:[await hash([fpc.toField(),f(CREDIT_OUTPUT_TAG)],DomainSeparator.PRIVATE_LOG_FIRST_FIELD),f(1),f(role),f(index),partial,f(completion),f(1)]}};
}
function env(){let height=1,hashValue=hex(1),privateLogs=[],publicLogs=[],calls=[];const values=new Map();
 const storage={read:async k=>values.get(k)??null,compareAndSwap:async(k,p,v)=>{assert.equal(values.get(k)??null,p);values.set(k,v);}};
 const cache=()=>createEncryptedJournalSlot({storage,walletSecret:hex(33),walletSalt:'0',scopeText:'test-private-credit-scope',keyDomain:'test-credit'});
 const compare=(a,b)=>a.blockNumber-b.blockNumber||a.txIndexWithinBlock-b.txIndexWithinBlock||a.logIndexWithinTx-b.logIndexWithinTx;
 const read=(kind,q)=>{calls.push({kind,q});assert.equal(q.includeEffects,true);assert.equal(q.referenceBlock.hash,hashValue);const t=q.tags[0],tag=t.tag??t,after=t.afterLog;return [((kind==='private'?privateLogs:publicLogs).filter(r=>r.blockNumber>=q.fromBlock&&r.blockNumber<q.toBlock&&r.logData[0].toString()===tag.toString()&&(!after||compare(r,after)>0))).slice(0,q.limitPerTag)];};
 const wallet={pxe:{getSyncedBlockHeader:async()=>({getBlockNumber:()=>height,toBlockParameter:async()=>({number:height,hash:hashValue})})}};
 const node={getBlockData:async n=>({blockHash:typeof n==='number'&&n<height?hex(n):hashValue,header:{globalVariables:{blockNumber:typeof n==='number'?n:height}}}),getPrivateLogsByTags:async q=>read('private',q),getPublicLogsByTags:async q=>read('public',q)};
 const make=()=>createPrivateCreditReader({wallet,node,owner,fpc,board,chainId:31337,version:1,cache});
 return {make,node,calls,values,privateLogs,publicLogs,setHead:(n,h=hex(n))=>{height=n;hashValue=h;}};
}
test('20-credit paid payload selects principal plus network fee; tip capture is detached and rejects invalid point',async()=>{
 assert.equal(PAID_LIKE_VALUE,20n*10n**18n);const key=Grumpkin.generator,input={type:'like',post:'7',tipKey:{x:String(key.x),y:String(key.y)}};const captured=capturePaidLikeAction(input);input.tipKey.x='0';assert.equal(captured.tipKey.x,String(key.x));assert.throws(()=>capturePaidLikeAction({...captured,tipKey:{x:'0',y:'0'}}));assert.throws(()=>capturePaidLikeAction({...captured,type:'unlike'}));
 const n=(await output({tx:90,value:PAID_LIKE_VALUE+5n})).note;
 const method=new PrivatePaidLikePaymentMethod(fpc,{board,post:f(7),key,ephemeral:f(9)},5n,{owner,notes:[n]});const payload=await method.getExecutionPayload();assert.equal(payload.calls.length,1);assert.equal(payload.calls[0].name,'pay_like_and_fee');assert.equal(payload.capsules.length,1);assert.equal(method.withReservation(4n).reservation,4n);assert.throws(()=>selectCreditInputs([n],PAID_LIKE_VALUE+6n),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});
});
test('native shared-tag pagination, encrypted reopen, incremental spend and zero-refund completion',async()=>{
 const e=env();for(let i=0;i<21;i++)e.privateLogs.push((await output({tx:i})).log);const reader=e.make(),first=await reader.read();assert.equal(first.availableCredit,2100n);assert.equal(e.calls.filter(c=>c.kind==='private').length,2);assert(e.calls.every(c=>c.q.tags.length===1));
 const before=e.calls.length;assert.equal((await e.make().read()).availableCredit,2100n);assert.equal(e.calls.length,before);const encoded=[...e.values.values()][0];assert(!encoded.includes(String(first.notes[0].secret)));assert(!encoded.includes('"notes"'));
 const change=await output({tx:22,block:2,role:1,value:150n,completion:50n,nullifiers:first.notes.slice(0,2).map(n=>n.nullifier)});e.privateLogs.push(change.log);e.setHead(2);assert.equal((await reader.read()).availableCredit,2050n);assert(e.calls.slice(before).every(c=>c.q.fromBlock===2));
 const zero={...change.log,blockNumber:3,blockHash:hex(3),txHash:hex(6000),txIndexWithinBlock:0,nullifiers:[f(6001),change.note.nullifier],noteHashes:[],logData:[f(CREDIT_OUTPUT_TAG),f(1),f(2),f(0),f(12),f(0),f(1)]};e.publicLogs.push(zero);e.setHead(3);assert.equal((await reader.read()).availableCredit,1900n);assert.equal((await e.make().read()).availableCredit,1900n);
});
test('unmatched public completion creates no credit and reorg resets persisted discovery',async()=>{
 const e=env(),mint=await output({tx:1});e.privateLogs.push(mint.log);const reader=e.make();assert.equal((await reader.read()).availableCredit,100n);
 e.publicLogs.push({...mint.log,blockNumber:2,blockHash:hex(2),txHash:hex(7000),logData:[f(CREDIT_OUTPUT_TAG),f(1),f(2),f(0),f(12),f(40),f(1)]});e.setHead(2);assert.equal((await reader.read()).availableCredit,100n);
 e.privateLogs.splice(0);e.publicLogs.splice(0);e.setHead(2,hex(999));assert.equal((await e.make().read()).availableCredit,0n);
});

test('failed final anchor check discards partially reconstructed notes and preserves persisted checkpoint',async()=>{
 const e=env(),mint=await output({tx:1});e.privateLogs.push(mint.log);
 const reader=e.make();assert.equal((await reader.read()).availableCredit,100n);
 const persisted=[...e.values.entries()];
 const orphan=await output({tx:2,block:2,value:200n});e.privateLogs.push(orphan.log);e.setHead(2);
 const original=e.node.getBlockData;let rejected=false;
 e.node.getBlockData=async value=>{
  const result=await original(value);
  // Number 2 is the final canonical read, after the new note was reconstructed.
  if(value===2&&!rejected){rejected=true;return {...result,blockHash:hex(999)};}
  return result;
 };
 await assert.rejects(reader.read(),{code:'PRIVATE_CREDIT_ANCHOR_CHANGED'});
 assert.equal(rejected,true);assert.deepEqual([...e.values.entries()],persisted);
 // The old checkpoint remains canonical, but its later orphaned output is gone.
 // A retry must not retain that output merely because the prior checkpoint matches.
 e.privateLogs.splice(1);e.setHead(2,hex(998));
 const retried=await reader.read();assert.equal(retried.availableCredit,100n);
 assert.equal(retried.notes.some(n=>n.unique.equals(orphan.note.unique)),false);
 assert.equal((await e.make().read()).availableCredit,100n);
});

test('cache contention reloads the latest authenticated snapshot on the next read',async()=>{
 const e=env();e.privateLogs.push((await output({tx:1})).log);
 const stale=e.make();assert.equal((await stale.read()).availableCredit,100n);
 e.privateLogs.push((await output({tx:2,block:2,value:200n})).log);e.setHead(2);
 // A different wallet tab legitimately advances the same encrypted cache.
 assert.equal((await e.make().read()).availableCredit,300n);
 await assert.rejects(stale.read(),{code:'BB_JOURNAL_INVALID'});
 const before=e.calls.length;
 assert.equal((await stale.read()).availableCredit,300n);
 assert.equal(e.calls.length,before);
});
