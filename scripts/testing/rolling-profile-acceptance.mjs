// Actual profile campaign assertions. The existing application fixture owns all
// wallets, proofs, transaction journals, mining, adapters, deadlines and cleanup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createExactLimitRaster,createRasterFixture,decodeFixturePng} from '../../experiments/avatar/raster-fixture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function exerciseRollingProfileActions({nameId,application,action,moderate,projection}){
 const identity=()=>projection.profile(nameId,{limit:1}).identity;
 const versions=async(bioVersion,avatarVersion)=>assert.deepEqual(await application.readProfile({name:nameId}),{
  name:'0x'+BigInt(nameId).toString(16).padStart(64,'0'),bioVersion,avatarVersion});
 const bio='A public profile with private ownership. '+ 'x'.repeat(951);
 assert.equal(Buffer.byteLength(bio),992);
 await versions('0','0');
 const bioEvents=await action({type:'bio',name:nameId,expectedVersion:'0',content:bio},'bio');
 assert.deepEqual(bioEvents.map(e=>e.type),['BioPublished']);
 assert.equal(identity().profile.bio.text,bio);assert.equal(identity().profile.bio.length,'992');
 await versions('1','0');
 const maximum=createExactLimitRaster();assert.equal(maximum.png.length,8192);
 assert.deepEqual(decodeFixturePng(maximum.png),maximum.rgb);
 const events=await action({type:'avatar',name:nameId,expectedVersion:'0',width:100,height:100,data:maximum.png.toString('base64')},'avatar-maximum');
 assert.deepEqual(events.map(e=>e.type),['AvatarPublished']);
 let avatar=identity().profile.avatar;
 assert.equal(avatar.version,'1');assert.equal(avatar.length,'8192');assert.equal(avatar.width,'100');assert.equal(avatar.height,'100');
 assert.deepEqual(Buffer.from(avatar.data,'base64'),maximum.png);assert.notEqual(avatar.digest,'0');
 const maximumObservation={bytes:8192,pngSha256:sha(maximum.png),digest:avatar.digest,version:avatar.version};
 await versions('1','1');
 const removal=await moderate({nameId,avatarVersion:1,mainVersion:1,reason:'Avatar violates the main board rules.'});
 assert.deepEqual(removal.map(e=>e.type),['AvatarRemoved']);
 avatar=identity().profile.avatar;
 assert.equal(avatar.data,null);assert.equal(avatar.removal.avatarVersion,'1');
 assert.equal(avatar.removal.avatarDigest,maximumObservation.digest);
 assert.equal(avatar.removal.reason,'Avatar violates the main board rules.');
 assert.equal(identity().profile.bio.text,bio);await versions('1','1');
 const cleared=await action({type:'avatar',name:nameId,expectedVersion:'1',width:0,height:0,data:''},'avatar-clear');
 assert.deepEqual(cleared.map(e=>e.type),['AvatarPublished']);
 avatar=identity().profile.avatar;
 assert.equal(avatar.version,'2');assert.equal(avatar.length,'0');assert.equal(avatar.width,'0');assert.equal(avatar.height,'0');assert.equal(avatar.data,'');assert.equal(avatar.removal,null);
 await versions('1','2');
 const replacement=createRasterFixture();assert.deepEqual(decodeFixturePng(replacement.png),replacement.rgb);
 const replaced=await action({type:'avatar',name:nameId,expectedVersion:'2',width:100,height:100,data:replacement.png.toString('base64')},'avatar-replacement');
 assert.deepEqual(replaced.map(e=>e.type),['AvatarPublished']);
 const expectedIdentity=identity();avatar=expectedIdentity.profile.avatar;
 assert.equal(avatar.version,'3');assert.equal(avatar.removal,null);assert.deepEqual(Buffer.from(avatar.data,'base64'),replacement.png);
 assert.equal(expectedIdentity.profile.bio.text,bio);await versions('1','3');
 return {expectedIdentity,maximum:maximumObservation,replacement:{bytes:replacement.png.length,pngSha256:sha(replacement.png),digest:avatar.digest,version:'3'},
  removal:{version:'1',redacted:true},clear:{version:'2',bytes:0},bio:{bytes:992,version:'1'},
  scope:'Genuine profile publication, moderator transaction and reconstruction. Fixed test moderation decision; no model image-policy qualification.'};
}
