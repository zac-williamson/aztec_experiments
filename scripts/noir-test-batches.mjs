// Use compiler-discovered exact names so partitioning cannot omit new tests.
export function noirTestBatches(listing,size=20){
 if(!Number.isSafeInteger(size)||size<1)throw Error('Invalid Noir test batch size');
 const packages=new Map(),seen=new Set();
 for(const line of listing.trim().split('\n')){
  const match=/^([A-Za-z0-9_]+) ([A-Za-z0-9_:]+)$/.exec(line.trim());
  if(!match||seen.has(line.trim()))throw Error('Invalid or duplicate compiler test listing');
  seen.add(line.trim());const [,name,test]=match;
  if(!packages.has(name))packages.set(name,[]);packages.get(name).push(test);
 }
 const batches=[];
 for(const [packageName,names] of packages)for(let i=0;i<names.length;i+=size)batches.push({packageName,names:names.slice(i,i+size)});
 return batches;
}
