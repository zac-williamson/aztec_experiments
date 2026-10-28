// Installed alongside a root-owned copy of the existing application decoder.
// Never import a verifier from the candidate being tested.
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {failure} from './bundle.mjs';

export const SUBMISSION_BODY_LIMIT=8*1024*1024;
const decompress=promisify(gunzip);
export async function readSubmissionHashes(request){
 try{
  let bytes=request.postDataBuffer();
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>SUBMISSION_BODY_LIMIT)throw failure('RELEASE_SUBMISSION_INVALID');
  const header=request.headers()['content-encoding'];
  if(header!==undefined&&typeof header!=='string')throw failure('RELEASE_SUBMISSION_INVALID');
  const encoding=(header??'identity').trim().toLowerCase();
  // The production wallet compresses large native RPC payloads. Bound both
  // wire bytes and expanded JSON before applying the unchanged native schema.
  if(encoding==='gzip')bytes=await decompress(bytes,{maxOutputLength:SUBMISSION_BODY_LIMIT});
  else if(encoding!=='identity')throw failure('RELEASE_SUBMISSION_INVALID');
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const items=Array.isArray(body)?body:[body],hashes=[];
  if(!items.length||items.length>8||items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw failure('RELEASE_SUBMISSION_INVALID');
  for(const item of items)if(['node_sendTx','aztec_sendTx'].includes(item.method)){
   if(!Array.isArray(item.params)||item.params.length!==1)throw failure('RELEASE_SUBMISSION_INVALID');
   const {Tx}=await import('@aztec-labs/stdlib/tx');
   const tx=await Tx.schema.parseAsync(item.params[0]);hashes.push(tx.getTxHash().toString());
  }
  return hashes;
 }catch{throw failure('RELEASE_SUBMISSION_INVALID');}
}

export async function openChainEvidence(publicFile,compatibility,remaining=()=>20000){
 const stat=await fs.lstat(publicFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768||(stat.mode&0o022))throw failure('RELEASE_CONFIG_PERMISSIONS');
 const config=JSON.parse(await fs.readFile(publicFile,'utf8')),s=config.scope;
 if(s?.boardAddress!==compatibility.board||s.chainId!==compatibility.chainId||s.rollupAddress!==compatibility.rollup||s.rollupVersion!==compatibility.rollupVersion)throw failure('RELEASE_RUNTIME_CHANGED');
 const [{createRollingEventDecoder,unpackRollingText},{createAztecNodeClient},{loadContractArtifact},{jsonStringify}]=await Promise.all([
  import('../../shared/rolling/public-events.mjs'),import('../../shared/aztec-node-client.mjs'),import('@aztec-labs/stdlib/abi'),import('@aztec-labs/foundation/json-rpc')]);
 const node=createAztecNodeClient(config.nodeUrl,{maxBatchSize:1,fetch:async(host,body)=>{
  if(remaining()<=1)throw failure('RELEASE_JOURNEY_TIMEOUT');
  const response=await fetch(host,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify(body),redirect:'error',signal:AbortSignal.timeout(Math.min(20000,remaining()))});
  if(!response.ok)throw failure('RELEASE_CHAIN_UNAVAILABLE');let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>33554432)throw failure('RELEASE_CHAIN_UNAVAILABLE');chunks.push(chunk);}
  return {response:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers:response.headers};
 }});
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(config.artifactPath,'utf8'))),bokArtifact=loadContractArtifact(JSON.parse(await fs.readFile(config.bokArtifactPath,'utf8')));
 const decoder=await createRollingEventDecoder({artifact,bokArtifact,scope:s,confirmationTier:'proposed'}),verified=new Set();
 return {
  // Only ephemeral test traffic is observed, never persisted. The native SDK
  // reconstructs the hash from the submitted transaction, not from DOM text.
  submission:readSubmissionHashes,
  async require(hashes,predicate,remaining){
   if(!hashes.length)throw failure('RELEASE_INCLUSION');
   const until=Date.now()+Math.min(60000,remaining());
   do{for(const hash of hashes){try{const events=await decoder.decodeTransaction(node,hash);if(predicate(events)){verified.add(hash);return events;}}catch{}}
    if(Date.now()>=until)break;await delay(Math.min(1000,Math.max(1,until-Date.now())));
   }while(Date.now()<until);throw failure('RELEASE_INCLUSION');
  },
  text:payload=>unpackRollingText(payload.message,payload.length,992),
  async recheck(){for(const hash of verified)await decoder.decodeTransaction(node,hash);},
 };
}
