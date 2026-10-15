// Real-campaign assertions only. Parent owns distinct funded private actors,
// canonical event authentication, proofs, accounting and all resource lifecycle.
// The returned evidence deliberately omits names/IDs grouped by private owner.
import assert from 'node:assert/strict';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
const exact=(v,keys)=>assert.deepEqual(Object.keys(v??{}).sort(),keys.slice().sort());
const canonical=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n&&BigInt(v)<Fr.MODULUS;
function packed(bytes){let first=0n;for(const b of bytes.slice(0,31))first=(first<<8n)|BigInt(b);return [String(first),String(BigInt(bytes[31])<<240n)];}
async function expected(first,last){const registration=nameRegistration(first,last),id=await poseidon2HashWithSeparator(registration.preimage.map(n=>new Fr(n)),NAME_DOMAIN);return {id:id.toString(),first,last,registration};}
function event(events,value){
 assert(Array.isArray(events));assert.deepEqual(events.map(e=>e.type),['NameRegistered']);
 const p=events[0].payload;exact(p,['schema','name_id','first_length','first','last_length','last']);
 const [first,firstLength,last,lastLength]=value.registration.arguments;
 assert.deepEqual(p,{schema:'1',name_id:String(BigInt(value.id)),first_length:String(firstLength),first:packed(first),last_length:String(lastLength),last:packed(last)});
}
async function owned(actor,values){
 const value=await actor.application.ownedIdentities({cursor:0});exact(value,['identities','records','nextCursor']);
 assert(Array.isArray(value.identities)&&Array.isArray(value.records));assert.equal(value.nextCursor,null);
 assert.equal(value.records.length,values.length);assert.equal(value.identities.length,values.length);
 const seen=new Set();for(let i=0;i<value.records.length;i++){
  const r=value.records[i];exact(r,['id','first','last']);assert(canonical(r.id)&&!seen.has(r.id));seen.add(r.id);assert.equal(value.identities[i],r.id);
 }
 const sorted=items=>items.map(({id,first,last})=>({id,first,last})).sort((a,b)=>a.id.localeCompare(b.id));
 assert(JSON.stringify(sorted(value.records))===JSON.stringify(sorted(values)),'Private owned names differ from the exact expected set');
 // Four names cannot fill an eight-record page. A later nonempty page is not
 // acceptable recovery or an excuse to silently omit an unexpected private name.
 const tail=await actor.application.ownedIdentities({cursor:8});
 assert.deepEqual(tail,{identities:[],records:[],nextCursor:null});
}
async function collateralPending(actor){
 const status=await actor.application.readAccountStatus();assert.equal(status.status,'collateral-pending');
 assert(typeof status.privateFeeCredit==='string'&&/^[1-9][0-9]*$/.test(status.privateFeeCredit));assert.deepEqual(status.depositIds,[]);
}
function activity(actor){const value=actor.activity();exact(value,['authWitnesses','proofJobs','walletSubmissions','transportSends']);
 for(const n of Object.values(value))assert(Number.isSafeInteger(n)&&n>=0);return structuredClone(value);}

/** Four sequential registrations; no simultaneous collision or global privacy
 * claim. Journal reopening reconstructs the application over its existing PXE;
 * it is not a device-loss, cold-PXE or seed-recovery exercise. */
export async function exerciseRollingOwnedNames({actorA,actorB,actionA,actionB,onPhase=()=>{}}){
 assert(actorA&&actorB&&actorA!==actorB&&actorA.application!==actorB.application);assert.notEqual(actionA,actionB);
 for(const action of [actionA,actionB])assert.equal(typeof action,'function');
 for(const actor of [actorA,actorB]){for(const fn of ['activity','reopenJournal'])assert.equal(typeof actor[fn],'function');
  for(const fn of ['ownedIdentities','readAccountStatus'])assert.equal(typeof actor.application?.[fn],'function');assert(actor.journal);}
 const proposals=await Promise.all([expected('River','Stone'),expected('Ellis','Moss'),expected('Juniper','Vale'),expected('Morgan','Reed')]);
 assert.equal(new Set(proposals.map(n=>n.id)).size,4);
 onPhase('setup');const a=[],b=[];await owned(actorA,a);await owned(actorB,b);await collateralPending(actorB);
 for(const [index,action,collection]of [[0,actionA,a],[1,actionA,a],[2,actionB,b],[3,actionB,b]]){
  onPhase(['a-name-1','a-name-2','b-name-1','b-name-2'][index]);const name=proposals[index];event(await action({type:'name',first:name.first,last:name.last},'owned-name-'+(index+1)),name);collection.push(name);
  await owned(actorA,a);await owned(actorB,b);
 }
 await collateralPending(actorB);
 for(const actor of [actorA,actorB]){
  onPhase(actor===actorA?'recovery-a':'recovery-b');const before=[activity(actorA),activity(actorB)],journal=actor.journal;await actor.reopenJournal();assert(actor.journal&&actor.journal!==journal,'Journal must actually be reopened');
  await owned(actorA,a);await owned(actorB,b);
  assert.deepEqual([activity(actorA),activity(actorB)],before,'Complete journal reopen and both ownership rereads must not create witnesses, proofs or submissions in either actor');
 }
 return {scenario:'private-owned-names',privateTransactions:4,registeredNames:4,privateOwnershipExact:true,readableMetadataExact:true,
  collateralFreeRegistration:true,journalReopenPreserved:true,
  scope:'Exact private owned-name sets and labels after sequential registration and application/journal reopen. Concurrent uniqueness, cold PXE recovery and broader observer privacy remain separate.'};
}
