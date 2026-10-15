// Labelled synthetic state machine: validates acceptance failures, not chain proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {exerciseRollingProfileActions} from './rolling-profile-acceptance.mjs';
function fixture(fault){
 const state={bio:null,avatar:null},calls=[];
 const application={readProfile:async()=>({name:'0x'+'1'.padStart(64,'0'),bioVersion:state.bio?.version??'0',avatarVersion:fault==='stale-version'?'0':state.avatar?.version??'0'})};
 const projection={profile:()=>({identity:{id:'1',profile:structuredClone(state)}})};
 async function action(input,label){
  calls.push(label);
  if(input.type==='bio')state.bio={version:'1',text:input.content,length:String(Buffer.byteLength(input.content))};
  else state.avatar={version:String(BigInt(input.expectedVersion)+1n),length:String(Buffer.from(input.data,'base64').length),width:String(input.width),height:String(input.height),data:input.data,digest:'123',removal:null};
  if(fault==='wrong-bytes'&&label==='avatar-maximum')state.avatar.data=Buffer.from('bad').toString('base64');
  if(fault==='lost-bio'&&label==='avatar-clear')state.bio.text='';
  return [{type:fault==='wrong-event'?'PostPublished':input.type==='bio'?'BioPublished':'AvatarPublished'}];
 }
 async function moderate({reason}){
  state.avatar.removal={avatarVersion:'1',avatarDigest:'123',reason};
  if(fault!=='unredacted')state.avatar.data=null;
  return [{type:'AvatarRemoved'}];
 }
 return {nameId:'1',application,projection,action,moderate,calls};
}
test('synthetic oracle traverses maximum raster, removal, clear and replacement',async()=>{
 const f=fixture(),result=await exerciseRollingProfileActions(f);
 assert.deepEqual(f.calls,['bio','avatar-maximum','avatar-clear','avatar-replacement']);
 assert.equal(result.maximum.bytes,8192);assert.equal(result.bio.bytes,992);
 assert.equal(result.expectedIdentity.profile.avatar.version,'3');
});
for(const fault of ['stale-version','wrong-bytes','lost-bio','wrong-event','unredacted'])
 test('synthetic oracle rejects '+fault,async()=>assert.rejects(exerciseRollingProfileActions(fixture(fault)),{name:'AssertionError'}));
