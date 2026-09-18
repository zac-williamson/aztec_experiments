// TEST ONLY: aggregate classifications, never retain request arguments or responses.
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
const roleNames=new Set(['author','payer','board','moderator','funder']);
const ethereumMethods=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode','eth_getStorageAt','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_sendTransaction','eth_sendRawTransaction','eth_accounts','eth_requestAccounts']);
const sizeBucket=n=>n===0?'empty':n<=256?'1-256':n<=4096?'257-4096':n<=65536?'4097-65536':n<=1048576?'65537-1048576':'over-1048576';
export function createT03RpcObserver({roles={},maxObservations=2000,now=()=>Date.now()}={}){
 if(!Number.isSafeInteger(maxObservations)||maxObservations<1||maxObservations>10000||typeof now!=='function')throw Error('Invalid observer limits');
 const allowedNode=new Set(Object.keys(AztecNodeApiSchema));
 const known=[];for(const [role,value]of Object.entries(roles)){if(!roleNames.has(role)||typeof value!=='string'||!/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value))throw Error('Invalid observer role');known.push([role,value.toLowerCase()]);}
 const started=now();let observed=0,unknownMethods=0,truncated=0,classificationTruncatedObservations=0;const rows=new Map();
 function begin(channel,method,args){
  if(!['aztec','ethereum'].includes(channel))throw Error('Invalid observer channel');
  if(!(channel==='aztec'?allowedNode:ethereumMethods).has(method)){unknownMethods++;return ()=>{};}
  if(observed++>=maxObservations){truncated++;return ()=>{};}
  // Only exact address/field leaves are classified. Encoded blobs and substring
  // matches are deliberately excluded. Traversal is bounded and retains no input.
  const found=new Set();let visited=0,bytes=0,limited=false;const seen=new Set();
  function walk(value,depth=0){if(++visited>4096||depth>16){limited=true;return;}if(value===null||value===undefined)return;
   if(typeof value==='string'){bytes+=Buffer.byteLength(value);if(/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value))for(const [role,address]of known)if(value.toLowerCase()===address)found.add(role);return;}
   if(typeof value==='bigint'||typeof value==='number'||typeof value==='boolean'){bytes+=String(value).length;return;}
   if(typeof value!=='object'||seen.has(value))return;seen.add(value);
   if(Buffer.isBuffer(value)||value instanceof Uint8Array){bytes+=value.byteLength;return;}
   // SDK address/field types expose a canonical string; ordinary object methods
   // are not invoked. Their nested own data properties remain traversable.
   const name=value.constructor?.name;if(['AztecAddress','EthAddress','Fr'].includes(name)){const text=value.toString();walk(text,depth+1);return;}
   for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){if(visited>4096){limited=true;break;}if('value'in descriptor)walk(descriptor.value,depth+1);}
  }
  walk(args);const elapsed=now()-started,timeBucket=Math.max(0,Math.floor(elapsed/1000));let finished=false;
  return success=>{if(finished)return;finished=true;if(limited)classificationTruncatedObservations++;const row={channel,method,timeBucketSeconds:timeBucket,argumentSizeBucket:sizeBucket(bytes),sizeScope:'sum of argument scalar bytes; not wire size',roles:[...found].sort(),classificationTruncated:limited,outcome:success===true?'success':'failure'};const key=JSON.stringify(row);const old=rows.get(key);if(old)old.count++;else rows.set(key,{...row,count:1});};
 }
 return {begin,snapshot:()=>({schema:'t03-rpc-footprint-v1',scope:'fixture RPC arguments only; exact address/field occurrences, not anonymity proof or wire-byte capture',excluded:'Requests rejected before fixture dispatch, including Aztec schema/auth failures; response contents' ,observations:Math.min(observed,maxObservations),unknownMethods,truncated,classificationTruncatedObservations,truncationOccurred:truncated>0||classificationTruncatedObservations>0,rows:[...rows.values()].map(r=>({...r,roles:[...r.roles]}))})};
}
