// Native6 note preimages. All secrets remain in the wallet; network reads use
// uniform deployment tags, never owner/source-post tags. See docs/PRIVATE_PAID_LIKES.md.
import {DomainSeparator} from '@aztec-labs/constants';
import {Fr,Fq} from '@aztec-labs/foundation/curves/bn254';
import {Point} from '@aztec-labs/foundation/curves/grumpkin';
import {Grumpkin} from '@aztec-labs/foundation/crypto/grumpkin';
import {poseidon2HashWithSeparator as hash} from '@aztec-labs/foundation/crypto/poseidon';
import {computeNoteHashNonce,computeUniqueNoteHash,siloNoteHash,siloNullifier} from '@aztec-labs/stdlib/hash';
import {Capsule} from '@aztec-labs/stdlib/tx';
import {Tag,SiloedTag,LogCursor} from '@aztec-labs/stdlib/logs';
import {Contract} from '@aztec-labs/aztec.js/contracts';

export const PAID_LIKE_VALUE=20n*10n**18n;
export const CREDIT_SLOT=0x5243544950435245n,INPUT_CAPSULE_SLOT=0x5243544950494e50n;
export const CREDIT_OUTPUT_TAG=0x52435449504f5554n,TIP_TAG=0x5243544950544950n,MAX_CREDIT_INPUTS=8;
const f=v=>v instanceof Fr?v:new Fr(BigInt(v));
const fail=code=>Object.assign(Error(code),{code});
const check=(ok,code='PRIVATE_CREDIT_INVALID')=>{if(!ok)throw fail(code);};
const eq=(a,b)=>a.toString()===b.toString();
export function validateTipPoint(value){
 const p=value instanceof Point?value:new Point(f(value.x),f(value.y));
 const x=p.x.toBigInt(),y=p.y.toBigInt(),q=Fr.MODULUS;
 check(!p.isInfinite&&(y*y-x*x*x+17n)%q===0n);return p;
}
export async function tipSpendingScalar(secret){
 check(f(secret).toBigInt()>0n);const scalar=await hash([f(secret)],0x52435458);check(!scalar.isZero());return new Fq(scalar.toBigInt());
}
export async function tipSpendingKey(secret){return validateTipPoint(await Grumpkin.mul(Grumpkin.generator,await tipSpendingScalar(secret)));}
export async function postTipSecret({root,chainId,version,board,post}){
 return hash([f(root),f(chainId),f(version),board.toField(),f(post)],0x52435453);
}
export async function selfCreditSecret({root,chainId,version,fpc,reference,role,index}){
 check([1,2,3].includes(role)&&Number.isSafeInteger(index)&&index>=0&&index<=0xffffffff);
 return hash([f(root),f(chainId),f(version),fpc.toField(),f(reference),f(role),f(index)],0x52435353);
}
const commitment=(key,blind)=>hash([key.x,key.y,blind],0x5243434d);
const innerHash=(partial,value)=>hash([f(CREDIT_SLOT),partial,f(value)],DomainSeparator.NOTE_HASH);
export async function recoverTip({root,chainId,version,board,fpc,post,key,ephemeral}){
 key=validateTipPoint(key);ephemeral=validateTipPoint(ephemeral);
 const secret=await postTipSecret({root,chainId,version,board,post});
 if(!eq(await tipSpendingKey(secret),key))return null;
 const shared=validateTipPoint(await Grumpkin.mul(ephemeral,await tipSpendingScalar(secret)));
 const blinding=await hash([shared.x,shared.y,fpc.toField()],0x52435442);
 return {secret,key,blinding,value:PAID_LIKE_VALUE,partial:await commitment(key,blinding)};
}
export async function recoverSelfCredit(scope,{reference,role,index,value,partial}){
 const secret=await selfCreditSecret({...scope,reference,role,index}),key=await tipSpendingKey(secret);
 const blinding=await hash([secret],0x52435342),expected=await commitment(key,blinding);
 if(!eq(expected,partial))return null;
 return {secret,key,blinding,value,partial};
}
export async function creditNullifier(fpc,unique,secret){
 return siloNullifier(fpc,await hash([unique,secret],DomainSeparator.NOTE_NULLIFIER));
}
export function creditInputCapsule(fpc,owner,notes){
 check(notes.length>0&&notes.length<=MAX_CREDIT_INPUTS,'PRIVATE_CREDIT_INPUT_LIMIT');
 const data=[f(notes.length)];
 for(let i=0;i<MAX_CREDIT_INPUTS;i++){
  const n=notes[i];data.push(...(n?[n.secret,n.key.x,n.key.y,n.blinding,f(n.value),n.nonce]:Array(6).fill(Fr.ZERO)));
 }
 return new Capsule(fpc,f(INPUT_CAPSULE_SLOT),data,owner);
}
export function selectCreditInputs(notes,required){
 required=BigInt(required);check(required>0n);
 const selected=[];let total=0n;
 for(const note of [...notes].sort((a,b)=>a.value>b.value?-1:a.value<b.value?1:0)){
  if(total>=required)break;
  if(selected.length===MAX_CREDIT_INPUTS)throw fail('PRIVATE_CREDIT_INPUT_LIMIT');
  selected.push(note);total+=note.value;
 }
 check(total>=required,'PRIVATE_FEE_BALANCE_INSUFFICIENT');return selected;
}

// One reader per native wallet, board and FPC. The cache contains wallet secrets
// in the encrypted wallet store. Canonical checks invalidate a reorged cache.
export function createPrivateCreditReader({wallet,node,owner,fpc,fpcArtifact,board,boardArtifact,chainId,version,fromBlock=1,cache}){
 let last=fromBlock-1,lastHash=null,notes=new Map(),seenNullifiers=new Set(),roots,reading,cacheSlot,cacheState,loaded=false;
 const getRoots=async()=>{
  if(roots)return roots;
  // Drain both native utility reads before releasing the account operation.
  // Cache only successful key values; a transient failure must not poison the
  // reader for the lifetime of this PXE.
  const observed=await Promise.allSettled([
   ()=>Contract.at(fpc,fpcArtifact,wallet).methods.credit_root(owner).simulate({from:owner}),
   ()=>Contract.at(board,boardArtifact,wallet).methods.tip_root(owner).simulate({from:owner}),
  ].map(read=>Promise.resolve().then(read)));
  const failure=observed.find(item=>item.status==='rejected');if(failure)throw failure.reason;
  roots=Object.freeze(observed.map(item=>f(item.value.result)));return roots;
 };
 async function register(effect,candidate){
  if(!candidate)return;
  check(candidate.value>0n&&candidate.value<1n<<128n);
  const siloed=await siloNoteHash(fpc,await innerHash(candidate.partial,candidate.value));
  // Native effects carry final unique note hashes. Find the exact native nonce,
  // rather than trusting a log-provided note index or commitment.
  for(let index=0;index<effect.noteHashes.length;index++){
   const nonce=await computeNoteHashNonce(effect.nullifiers[0],index);
   const unique=await computeUniqueNoteHash(nonce,siloed);
   if(eq(unique,effect.noteHashes[index])){
    const nullifier=await creditNullifier(fpc,unique,candidate.secret);
    notes.set(unique.toString(),{...candidate,nonce,unique,nullifier});return;
   }
  }
  // A public log alone never creates credit. Ignore forged/nonmatching records.
 }
 const coordinate=log=>[Number(log.blockNumber),log.txIndexWithinBlock,log.logIndexWithinTx];
 const compare=(a,b)=>{const x=coordinate(a),y=coordinate(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];};
 async function load(){
  if(loaded)return;
  if(cache){
   cacheSlot=await cache();cacheState=await cacheSlot.read();const saved=cacheState.value;
   if(saved){
    check(saved.version===1&&Number.isSafeInteger(saved.last)&&saved.last>=fromBlock-1&&typeof saved.lastHash==='string'&&Array.isArray(saved.notes));
    last=saved.last;lastHash=saved.lastHash;
    notes=new Map(saved.notes.map(n=>{
     const note={...n,secret:f(n.secret),key:validateTipPoint(n.key),blinding:f(n.blinding),partial:f(n.partial),nonce:f(n.nonce),unique:f(n.unique),nullifier:f(n.nullifier),value:BigInt(n.value)};
     check(note.value>0n&&note.value<1n<<128n);return [note.unique.toString(),note];
    }));
   }
  }
  loaded=true;
 }
 async function logs(kind,tag,anchor,head){
  const result=[];let cursor;
  for(;;){
   const query={tags:[cursor?{tag,afterLog:cursor}:tag],fromBlock:last+1,toBlock:head+1,referenceBlock:anchor,includeEffects:true,limitPerTag:20};
   const pages=kind==='private'?await node.getPrivateLogsByTags(query):await node.getPublicLogsByTags({...query,contractAddress:fpc});
   check(Array.isArray(pages)&&pages.length===1&&Array.isArray(pages[0])&&pages[0].length<=20,'PRIVATE_CREDIT_HISTORY_UNAVAILABLE');
   const page=pages[0];
   for(const log of page){
    check(coordinate(log).every(Number.isSafeInteger)&&Number(log.blockNumber)>last&&Number(log.blockNumber)<=head&&log.txIndexWithinBlock>=0&&log.logIndexWithinTx>=0&&(!cursor||compare(log,cursor)>0),'PRIVATE_CREDIT_HISTORY_UNAVAILABLE');
    check(Array.isArray(log.nullifiers)&&log.nullifiers.length>0&&Array.isArray(log.noteHashes)&&Array.isArray(log.logData),'PRIVATE_CREDIT_HISTORY_UNAVAILABLE');
    result.push({...log,kind});cursor=LogCursor.fromLog(log);
   }
   if(page.length<20)return result;
  }
 }
 async function scan(){
  await load();
  const header=await wallet.pxe.getSyncedBlockHeader(),anchor=await header.toBlockParameter();
  const head=Number(header.getBlockNumber()),current=await node.getBlockData(anchor);
  check(current&&Number(current.header.globalVariables.blockNumber)===head,'PRIVATE_CREDIT_ANCHOR_CHANGED');
  const anchorHash=current.blockHash.toString();
  if(last>=fromBlock){
   const prior=await node.getBlockData(last);
   if(last>head||prior?.blockHash.toString()!==lastHash){last=fromBlock-1;lastHash=null;notes=new Map();seenNullifiers=new Set();}
  }
  const [creditRoot,tipRoot]=await getRoots();
  const privateTag=await hash([fpc.toField(),f(CREDIT_OUTPUT_TAG)],DomainSeparator.PRIVATE_LOG_FIRST_FIELD);
  if(last<head){
   // Uniform deployment-wide tags: no account, source post or spent-note query.
   // Include all effect nullifiers; even zero refunds have a completion marker.
   const reads=await Promise.allSettled([
    logs('private',new SiloedTag(privateTag),anchor,head),
    logs('public',new Tag(f(CREDIT_OUTPUT_TAG)),anchor,head),
    logs('public',new Tag(f(TIP_TAG)),anchor,head),
   ]);
   const failure=reads.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   const rows=reads.flatMap(r=>r.value).sort(compare);
   for(let offset=0;offset<rows.length;){
    const first=rows[offset],group=[];
    while(offset<rows.length&&rows[offset].txHash.toString()===first.txHash.toString())group.push(rows[offset++]);
    const effect={noteHashes:first.noteHashes,nullifiers:first.nullifiers};
    const spent=new Set(effect.nullifiers.map(n=>n.toString()));
    const inputValue=[...notes.values()].filter(n=>spent.has(n.nullifier.toString())).reduce((sum,n)=>sum+n.value,0n);
    for(const nullifier of effect.nullifiers)seenNullifiers.add(nullifier.toString());
    for(const log of group){
     check(log.blockHash.toString()===first.blockHash.toString()&&Number(log.blockNumber)===Number(first.blockNumber)&&log.txIndexWithinBlock===first.txIndexWithinBlock&&
      JSON.stringify(log.noteHashes.map(String))===JSON.stringify(effect.noteHashes.map(String))&&JSON.stringify(log.nullifiers.map(String))===JSON.stringify(effect.nullifiers.map(String)),'PRIVATE_CREDIT_HISTORY_UNAVAILABLE');
     const fields=log.logData;
     if(log.kind==='private'){
      // Native private logs may carry right padding; the trailing sentinel binds
      // the seven-field record and all remaining fields must be zero.
      if(fields.length<7||!eq(fields[0],privateTag)||fields[1].toBigInt()!==1n||fields[6].toBigInt()!==1n||fields.slice(7).some(v=>!v.isZero()))continue;
      const role=Number(fields[2].toBigInt()),index=Number(fields[3].toBigInt());
      if(![1,3].includes(role)||!Number.isSafeInteger(index)||index<0||index>0xffffffff)continue;
      const value=role===1?inputValue-fields[5].toBigInt():fields[5].toBigInt();
      if(value<=0n)continue;
      await register(effect,await recoverSelfCredit({root:creditRoot,chainId,version,fpc},
       {reference:effect.nullifiers[0],role,index,partial:fields[4],value}));
     }else if(fields.length===7&&fields[0].toBigInt()===CREDIT_OUTPUT_TAG&&fields[1].toBigInt()===1n&&fields[2].toBigInt()===2n&&fields[6].toBigInt()===1n){
      const index=Number(fields[3].toBigInt());if(!Number.isSafeInteger(index)||index<0||index>0xffffffff||fields[5].isZero())continue;
      await register(effect,await recoverSelfCredit({root:creditRoot,chainId,version,fpc},
       {reference:effect.nullifiers[0],role:2,index,partial:fields[4],value:fields[5].toBigInt()}));
     }else if(fields.length===11&&fields[0].toBigInt()===TIP_TAG&&fields[1].toBigInt()===1n&&eq(fields[2],board.toField())&&fields[9].toBigInt()===PAID_LIKE_VALUE&&fields[10].toBigInt()===1n){
      const candidate=await recoverTip({root:tipRoot,chainId,version,board,fpc,post:fields[3],key:{x:fields[4],y:fields[5]},ephemeral:{x:fields[6],y:fields[7]}});
      if(candidate&&eq(candidate.partial,fields[8]))await register(effect,candidate);
     }
    }
   }
  }
  const final=await node.getBlockData(head),newAnchor=await (await wallet.pxe.getSyncedBlockHeader()).toBlockParameter();
  check(final?.blockHash.toString()===anchorHash&&JSON.stringify(newAnchor)===JSON.stringify(anchor),'PRIVATE_CREDIT_ANCHOR_CHANGED');
  const active=[...notes.values()].filter(n=>!seenNullifiers.has(n.nullifier.toString()));
  notes=new Map(active.map(n=>[n.unique.toString(),n]));seenNullifiers=new Set();last=head;lastHash=anchorHash;
  if(cacheSlot){
   const saved={version:1,last,lastHash,notes:active.map(n=>({secret:String(n.secret),key:{x:String(n.key.x),y:String(n.key.y)},blinding:String(n.blinding),partial:String(n.partial),nonce:String(n.nonce),unique:String(n.unique),nullifier:String(n.nullifier),value:String(n.value)}))};
   if(JSON.stringify(cacheState.value)!==JSON.stringify(saved))cacheState=await cacheSlot.write(cacheState,saved);
  }
  return {notes:active,availableCredit:active.reduce((v,n)=>v+n.value,0n),anchor};
 }
 return Object.freeze({read(){
  if(!reading)reading=scan().catch(error=>{
   // Never retain a partially read fork or a candidate from an unverified
   // anchor. This is disposable in-memory state, not a migration/recovery log.
   last=fromBlock-1;lastHash=null;notes=new Map();seenNullifiers=new Set();
   // Another owned reader may have advanced the encrypted snapshot. Retry from
   // authenticated storage instead of repeating a compare-and-swap with stale bytes.
   loaded=false;cacheSlot=undefined;cacheState=undefined;throw error;
  }).finally(()=>{reading=null;});
  return reading;
 }});
}

const readers=new WeakMap();
export function privateCreditReader(input){
 const identity=input.wallet.pxe;
 let cache=readers.get(identity);if(!cache)readers.set(identity,cache=new Map());
 const key=[input.owner,input.fpc,input.board,input.chainId,input.version].map(String).join(':');
 let reader=cache.get(key);if(!reader){reader=createPrivateCreditReader(input);cache.set(key,reader);}return reader;
}
export async function readPrivateFeeCredit(input){return (await privateCreditReader(input).read()).availableCredit;}
