// Labelled projection fixtures; no chain, proof or HTTP runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {assertCanonicalSocialViews,assertSocialHTTPView} from './rolling-public-acceptance.mjs';
function fixture(){
 const event={type:'PostPublished',payload:{schema:'1',id:'4',record:{name_id:'0',subboard:'0',parent:'0',root:'4',kind:'1',reference:'0',content_digest:'1'},main_policy_version:'1',local_policy_version:'0',message:['0x'+Buffer.from('A').toString('hex').padEnd(62,'0'),...Array(31).fill('0')],length:'1',timestamp:'1'},position:{blockNumber:'1',blockHash:'mock-block',txHash:'mock-tx',txIndexWithinBlock:'0',logIndexWithinTx:'0'}};
 const policy={type:'MainPolicyPublished',payload:{version:'1',rules:Array(32).fill('0'),length:'0'},position:{...event.position,blockNumber:'0'}};
 const projection=createRollingProjection({isValidatedEvent:e=>e===event||e===policy});projection.stage([policy,event]).apply();
 const expected={posts:[projection.post('4')],nextCursor:null,names:{},boards:{}};
 return {projection,rows:[{route:'feed',parameters:{limit:100},expected:structuredClone(expected)},{route:'thread',parameters:{root:'4',limit:100},expected:structuredClone(expected)},{route:'post',parameters:{id:'4'},expected:{post:projection.post('4'),names:{},boards:{}}}]};
}
test('real projection feed/thread shape is distinct from enriched HTTP shape',()=>{
 const {projection,rows}=fixture();assert.equal(projection.feed({limit:100}).names,undefined);
 assertCanonicalSocialViews(projection,rows);
});
test('canonical reconstruction rejects altered post or continuation cursor',()=>{
 for(const change of [rows=>rows[0].expected.posts[0].text='changed',rows=>rows[1].expected.nextCursor='unexpected',rows=>rows[2].expected.post.record.reference='9']){
  const {projection,rows}=fixture();change(rows);assert.throws(()=>assertCanonicalSocialViews(projection,rows));
 }
});
test('full HTTP acceptance still requires every name and board enrichment field',()=>{
 const {rows}=fixture();for(const {expected}of rows){
  assertSocialHTTPView({...structuredClone(expected),checkpoint:{number:1}},expected);
  for(const key of ['names','boards']){
   const missing=structuredClone(expected);delete missing[key];assert.throws(()=>assertSocialHTTPView(missing,expected));
   const altered=structuredClone(expected);altered[key]={unexpected:{id:'9'}};assert.throws(()=>assertSocialHTTPView(altered,expected));
  }
 }
});

// Actual pure projection with explicitly unauthenticated test events.
import {assertCanonicalOwnedNameProfiles} from './rolling-public-acceptance.mjs';
function namesFixture(){
 const words=text=>[String(BigInt('0x'+Buffer.from(text).toString('hex').padEnd(62,'0'))),'0'];
 const projection=createRollingProjection({isValidatedEvent:()=>true});
 for(const [index,[first,last]]of [['River','Stone'],['Ellis','Moss'],['Juniper','Vale'],['Morgan','Reed']].entries())projection.stage([{type:'NameRegistered',payload:{schema:'1',name_id:String(index+1),first_length:String(first.length),first:words(first),last_length:String(last.length),last:words(last)},position:{blockNumber:String(index+1),blockHash:'mock-block-'+index,txHash:'mock-tx-'+index,txIndexWithinBlock:'0',logIndexWithinTx:'0'}}]).apply();
 return {projection,profiles:['1','2','3','4'].map(id=>projection.profile(id,{limit:100}))};
}
test('owned-name canonical profiles retain all four full public identities without posts',()=>{
 const {projection,profiles}=namesFixture();assertCanonicalOwnedNameProfiles(projection,profiles);
 for(const expected of profiles)assertSocialHTTPView({...expected,names:{},boards:{},checkpoint:{number:1}},{...expected,names:{},boards:{}});
});
test('owned-name profile reconstruction rejects missing duplicate altered and unexpected content',()=>{
 for(const change of [p=>p.pop(),p=>p[2]=structuredClone(p[0]),p=>p[0].identity.first='Changed',p=>p[0].identity.bio='Changed',p=>p[0].posts.push({id:'8'}),p=>p[1].nextCursor='stale']){
  const {projection,profiles}=namesFixture();change(profiles);assert.throws(()=>assertCanonicalOwnedNameProfiles(projection,profiles));
 }
});

test('social canonical profile checks identity posts and cursors independently of index metadata',()=>{
 const make=()=>{const {projection,profiles}=namesFixture();return {projection,rows:profiles.map(expected=>({route:'profile',parameters:{nameId:expected.identity.id,limit:100},expected:{...structuredClone(expected),names:{},boards:{},checkpoint:{number:8}}}))};};
 const {projection,rows}=make();assertCanonicalSocialViews(projection,rows);
 for(const change of [row=>row.expected.identity.first='Changed',row=>row.expected.posts.push({id:'9'}),row=>row.expected.nextCursor='unexpected',row=>delete row.expected.identity]){
  const {projection,rows}=make();change(rows[0]);assert.throws(()=>assertCanonicalSocialViews(projection,rows));
 }
});

test('bounded catchup rejects stalled pages and never retries an index error',async()=>{
 const {synchronizeRollingPublicReader}=await import('./rolling-public-acceptance.mjs');let calls=0;
 const error=Error('labelled upstream failure');
 await assert.rejects(()=>synchronizeRollingPublicReader({status:()=>({state:'authenticating'}),sync:async()=>{calls++;throw error;}},Date.now()+30000),e=>e===error);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>synchronizeRollingPublicReader({status:()=>({state:'syncing'}),sync:async()=>{calls++;return {state:'syncing',pages:0};}},Date.now()+30000));assert.equal(calls,1);
 calls=0;await assert.rejects(()=>synchronizeRollingPublicReader({status:()=>({state:'syncing'}),sync:async()=>{calls++;}},Date.now()+21000));assert.equal(calls,0);
});

test('canonical directory oracle rejects invented boards and cursors while omitting only index metadata',()=>{
 const {projection}=fixture();const row={route:'directory',parameters:{query:'',limit:100},expected:{boards:[],nextCursor:null}};
 assertCanonicalSocialViews(projection,[row]);
 for(const mutate of [r=>r.expected.boards.push({id:'7'}),r=>r.expected.nextCursor='stale',r=>delete r.expected.boards]){const changed=structuredClone(row);mutate(changed);assert.throws(()=>assertCanonicalSocialViews(projection,[changed]));}
});

test('canonical board oracle requires content, policies, identity and continuation independently of HTTP metadata',()=>{
 const {projection}=fixture();const {revision,...expected}=projection.boardFeed('0',{limit:100});
 const row={route:'board',parameters:{id:'0',limit:100},expected:{...expected,names:{},boards:{}}};assertCanonicalSocialViews(projection,[row]);
 for(const mutate of [r=>r.expected.posts=[],r=>r.expected.boardId='9',r=>r.expected.board={id:'0'},r=>r.expected.mainPolicy.text='changed',r=>r.expected.policies=[],r=>r.expected.nextCursor='unexpected',r=>delete r.expected.mainPolicy]){
  const changed=structuredClone(row);mutate(changed);assert.throws(()=>assertCanonicalSocialViews(projection,[changed]));
 }
});

test('saved preference public acceptance requires the same full canonical post views',async()=>{
 const {rows,projection}=fixture();assertCanonicalSocialViews(projection,rows);for(const row of rows)assertSocialHTTPView(structuredClone(row.expected),row.expected);
 const fs=await import('node:fs/promises'),source=await fs.readFile(new URL('./rolling-public-acceptance.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/'preference-saved'/g)||[]).length,2); // Both scenario admission and mandatory expectedHTTP branch.
 const leaked=structuredClone(rows[0].expected);leaked.posts.push({type:'PreferenceChanged'});assert.throws(()=>assertSocialHTTPView(leaked,rows[0].expected));
});

import {synchronizeRollingPublicReader,assertRollingHTTPMetadata} from './rolling-public-acceptance.mjs';
test('persistent catchup counts bounded steps and completion without invented ranges or pages',async()=>{
 let calls=0;const states=[{schemaVersion:1,state:'authenticating',complete:false,revision:null,cursor:null},
  {schemaVersion:1,state:'syncing',complete:false,revision:'epoch:1:1',cursor:{blockNumber:'1',nextTxIndex:'0'}},
  {schemaVersion:1,state:'syncing',complete:false,revision:'epoch:1:2',cursor:{blockNumber:'1',nextTxIndex:'1'}},
  {schemaVersion:1,state:'ready',complete:true,revision:'epoch:1:2',cursor:{blockNumber:'1',nextTxIndex:'1'}}];
 const index={storageKind:'sqlite-v3',status:()=>states[calls],sync:async()=>states[++calls]};
 assert.deepEqual(await synchronizeRollingPublicReader(index,Date.now()+30000),{passes:3,steps:3});assert.equal(calls,3);
});
for(const defect of ['stalled','incomplete-ready','missing-revision','wrong-schema','error'])test('persistent catchup rejects '+defect+' without retry',async()=>{
 let calls=0;const original={schemaVersion:1,state:'syncing',complete:false,revision:'epoch:1:1',cursor:{blockNumber:'1',nextTxIndex:'0'}},error=Error('upstream');
 const result={...original};if(defect==='incomplete-ready')result.state='ready';if(defect==='missing-revision')result.revision=null;if(defect==='wrong-schema')result.schemaVersion=3;
 const index={storageKind:'sqlite-v3',status:()=>original,sync:async()=>{calls++;if(defect==='error')throw error;return result;}};
 await assert.rejects(synchronizeRollingPublicReader(index,Date.now()+30000),defect==='error'?e=>e===error:undefined);assert.equal(calls,1);
});
test('persistent HTTP metadata preserves generation revision and numeric checkpoint without widening legacy grammar',()=>{
 const epoch='12345678-1234-4234-8234-123456789abc',status={state:'ready',complete:true,scope:{boardAddress:'public'},checkpoint:{number:3,hash:'0x'+'1'.repeat(64)},revision:epoch+':2:9'},body={...status,schemaVersion:1};
 assertRollingHTTPMetadata(body,status,'sqlite-v3');assert.throws(()=>assertRollingHTTPMetadata(body,status));
 for(const change of [b=>b.revision=epoch+':0:9',b=>b.revision=epoch+':9',b=>b.checkpoint.number='3',b=>b.scope.boardAddress='different',b=>b.complete=false]){
  const altered=structuredClone(body);change(altered);assert.throws(()=>assertRollingHTTPMetadata(altered,status,'sqlite-v3'));
 }
 const old={...status,revision:epoch+':9'};assertRollingHTTPMetadata({...old,schemaVersion:1},old);
});
