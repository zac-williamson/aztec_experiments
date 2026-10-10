import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedAuthorPostDeadlines} from './hosted-post-deadlines.mjs';
const hash=n=>'0x'+String(n).repeat(64);
function fixture(){
 const posts=[1,2,3,4,5].map(n=>({postId:hash(n),flagDeadline:String(n*100),publication:{txHash:hash(n),blockNumber:String(n),blockHash:hash(n)}}));
 const receipt=n=>({hash:hash(n),blockNumber:n,blockHash:hash(n)});
 return {onboarding:{passed:true,publication:{payload:{postId:hash(1)}},post:{...receipt(1),txHash:hash(1)}},
  reports:[{phase:'moderation-post',passed:true,postId:hash(2),post:receipt(2),flagDeadline:200},{phase:'plugin-claim-post',passed:true,postId:hash(3),post:receipt(3)},{phase:'plugin-request',passed:true,postId:hash(4),post:receipt(4)}],posts};
}
test('new own plugin request controls the deadline while unrelated posts do not',()=>{
 const f=fixture(),result=hostedAuthorPostDeadlines(f);assert.equal(result.length,4);assert.equal(Math.max(...result.map(p=>p.flagDeadline)),400);
 assert.equal(result.at(-1).label,'plugin-request');assert.deepEqual(f,fixture());
});
for(const [label,change]of [
 ['unfinished author phase',f=>f.reports[2].passed=false],
 ['missing own post',f=>f.posts.splice(3,1)],
 ['wrong receipt',f=>f.posts[3].publication.txHash=hash(5)],
 ['changed canonical block',f=>f.posts[3].publication.blockHash=hash(5)],
 ['wrong height',f=>f.posts[3].publication.blockNumber='9'],
 ['invalid deadline',f=>f.posts[3].flagDeadline='NaN'],
 ['changed fixture deadline',f=>f.posts[1].flagDeadline='300'],
 ['duplicate post',f=>f.posts.push(f.posts[3])],
])test('withdrawal preflight rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>hostedAuthorPostDeadlines(f));});
