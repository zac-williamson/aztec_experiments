// Exact RollingBoard metadata encoding: timestamp:u64 | policy_identity:u64 << 64.
// Zero means absent. A present post has a nonzero main policy version, even at time zero.
const invalid=()=>Object.assign(new Error('Invalid post metadata'),{code:'ROLLING_INVALID_RESPONSE'});
const integer=value=>{if(typeof value!=='bigint'&&!(typeof value==='string'&&/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)))throw invalid();return BigInt(value);};
export function decodePostMetadata(value){
 const packed=integer(value);if(packed<0n||packed>=(1n<<128n))throw invalid();
 const published=packed&((1n<<64n)-1n),policyVersion=packed>>64n,mainVersion=policyVersion&0xffffffffn,localVersion=policyVersion>>32n;
 if(packed!==0n&&(mainVersion===0n||localVersion>1n))throw invalid();
 return {exists:packed!==0n,published,policyVersion,mainVersion,localVersion};
}
export function postMetadataDeadline(value,censorWindow){
 const metadata=decodePostMetadata(value),window=integer(censorWindow);
 if(!metadata.exists||window<0n||window>0xffffffffn||metadata.published+window>=(1n<<63n))throw invalid();
 return metadata.published+window;
}
