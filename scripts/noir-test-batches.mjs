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

// This contract fixture declares assertion/state-reset oracles supplied by its
// existing dedicated TXE service. Production packages keep the generic service.
export function noirTestRuntime(packageName){
 if(!/^[A-Za-z0-9_]+$/.test(packageName))throw Error('Invalid Noir test package');
 return packageName==='owner_delivery_test'
  ? {serviceArgs:['--preserve-symlinks','experiments/owner-state/txe-service.mjs'],artifact:'owner_delivery_test-OwnerPostingAccount.json',contract:'OwnerPostingAccount',threads:'1'}
  : {serviceArgs:['scripts/txe-c01-service.mjs']};
}
