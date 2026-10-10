// Test preflight: every recorded author post must be reconciled before exit.
import assert from 'node:assert/strict';
export function hostedAuthorPostDeadlines({onboarding,reports,posts}){
 const own=[{label:'onboarding',passed:onboarding.passed,postId:onboarding.publication?.payload.postId,receipt:{...onboarding.post,hash:onboarding.post?.txHash}},
  ...reports.map(r=>({label:r.phase,passed:r.passed,postId:r.postId,receipt:r.post,deadline:r.flagDeadline}))];
 return own.map(({label,passed,postId,receipt,deadline})=>{
  assert.equal(passed,true,'Reconcile the recorded author phase before withdrawal: '+label);
  assert.match(postId,/^0x[0-9a-f]{64}$/);assert.match(receipt?.hash,/^0x[0-9a-f]{64}$/);
  const matches=posts.filter(p=>p.postId===postId);assert.equal(matches.length,1,'Recorded author post missing or duplicated: '+label);
  const post=matches[0];assert.equal(post.publication.txHash,receipt.hash);
  assert.equal(post.publication.blockHash,receipt.blockHash);assert.equal(String(post.publication.blockNumber),String(receipt.blockNumber));
  const flagDeadline=Number(post.flagDeadline);assert(Number.isSafeInteger(flagDeadline)&&flagDeadline>0);
  if(deadline!==undefined)assert.equal(flagDeadline,deadline);
  return {label,postId,txHash:receipt.hash,flagDeadline};
 });
}
