// Incremental public-event projection. A staged range changes nothing until apply().
// Undo retains only entries touched by that range and the previous current policy.
export function createFeedProjection(fail) {
 const posts=[],ids=new Map(),policies=new Map();let currentPolicy=null;
 function stage(events){
  const postChanges=new Map(),policyChanges=new Map(),postBefore=new Map(),policyBefore=new Map();
  const originalLength=posts.length,oldCurrent=currentPolicy;
  let length=originalLength,nextCurrent=currentPolicy;
  const newIds=new Map();
  const getPost=i=>postChanges.has(i)?postChanges.get(i):posts[i];
  const getPolicy=id=>policyChanges.has(id)?policyChanges.get(id):policies.get(id);
  function putPost(i,value){if(!postBefore.has(i))postBefore.set(i,posts[i]);postChanges.set(i,value);}
  function putPolicy(id,value){if(!policyBefore.has(id))policyBefore.set(id,policies.get(id));policyChanges.set(id,value);}
  for(const e of events){const p=e.payload;
   if(e.type==='PolicyPublished'){
    const old=getPolicy(p.policyVersion);
    if(old&&JSON.stringify(old)!==JSON.stringify(p))throw fail('Conflicting public policy.');
    putPolicy(p.policyVersion,p);nextCurrent=p.policyVersion;
   }else if(e.type==='PostPublished'){
    if(!getPolicy(p.policyVersion))throw fail('Public post policy is missing from history.');
    if(BigInt(p.orderIndex)!==BigInt(length))throw fail('Public post history has a gap.');
    if(ids.has(p.postId)||newIds.has(p.postId))throw fail('Duplicate public post identity.');
    newIds.set(p.postId,length);putPost(length++,{...p,publication:e.position,flagged:false,flag:null});
   }else{
    const i=newIds.has(p.postId)?newIds.get(p.postId):ids.get(p.postId),post=getPost(i);
    if(!post||post.policyVersion!==p.policyVersion||post.flagged)throw fail('Invalid public flag history.');
    putPost(i,{...post,flagged:true,flag:{...p,position:e.position}});
   }
  }
  return {
   apply(){for(const [i,p] of postChanges)posts[i]=p;for(const [id,i] of newIds)ids.set(id,i);for(const [id,p] of policyChanges)policies.set(id,p);currentPolicy=nextCurrent;},
   undo(){for(const [i,p] of postBefore)if(i<originalLength)posts[i]=p;posts.length=originalLength;for(const id of newIds.keys())ids.delete(id);for(const [id,p] of policyBefore){if(p===undefined)policies.delete(id);else policies.set(id,p);}currentPolicy=oldCurrent;},
  };
 }
 function page(limit,upper,before){
  let highest=BigInt(posts.length)-1n;
  if(upper!==null&&BigInt(upper)<highest)highest=BigInt(upper);
  if(before!==null&&BigInt(before)-1n<highest)highest=BigInt(before)-1n;
  const end=Number(highest)+1,start=Math.max(0,end-limit),selected=posts.slice(start,end).reverse();
  const needed=new Set(selected.map(post=>post.policyVersion));if(currentPolicy!==null){needed.delete(currentPolicy);needed.add(currentPolicy);}
  const orderedPolicies=[...needed].map(id=>policies.get(id));
  return {posts:selected,policies:orderedPolicies,hasMore:start>0};
 }
 return {stage,page,get postCount(){return posts.length;}};
}
