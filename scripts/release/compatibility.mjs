import {sha256,failure} from './bundle.mjs';
export function runtimeIdentity(runtime){
 const c=runtime?.config,n=c?.network;
 if(runtime?.proofsEnabled!==true||runtime.remoteProver?.proofsEnabled!==true||n?.chainId!=='11155111'||!c.board||!c.privateFee||!c.bok||!c.aggregateFunding)throw failure('RELEASE_REAL_PROOFS_REQUIRED');
 // Endpoint hostnames differ between stage/live. Contract identities and gas
 // policy must remain identical; sort recursively to ignore JSON key ordering.
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 return sha256(JSON.stringify(sort({board:c.board,privateFee:c.privateFee,bok:c.bok,aggregateFunding:c.aggregateFunding,network:{chainId:n.chainId,rollupAddress:n.rollupAddress,rollupVersion:n.rollupVersion}})));
}
