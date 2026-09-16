import {publicNode,publicRpc} from './public-feed-rpc.mjs';
import {createPublicFeedSource} from './public-feed-source.mjs';
import {createPublicFeed} from './public-feed.mjs';
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const word=v=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(v))throw Error('Invalid public deployment data.');return BigInt(v);};
const address=n=>{if(n<=0n||n>=1n<<160n)throw Error('Invalid public deployment address.');return '0x'+n.toString(16).padStart(40,'0');};
export async function connectPublicFeed({nodeUrl,ethereumUrl,portalAddress,metadata,storage,fetchImpl}){
  if(!/^0x[0-9a-fA-F]{40}$/.test(portalAddress)||BigInt(portalAddress)===0n)throw Error('Enter a valid portal address.');
  portalAddress=portalAddress.toLowerCase();
  const node=publicNode(nodeUrl,{fetchImpl}),eth=publicRpc(ethereumUrl,{fetchImpl});
  const call=async name=>word(await eth('eth_call',[{to:portalAddress,data:metadata.portalSelectors[name]},'latest']));
  const [board,rollup,version,l1ChainId,chain]=await Promise.all([call('L2_CONTRACT'),call('ROLLUP'),call('VERSION'),call('L1_CHAIN_ID'),eth('eth_chainId')]);
  if(typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||BigInt(chain)!==l1ChainId)throw Error('Ethereum endpoint does not match this board.');
  const scope={l1ChainId:String(l1ChainId),rollupVersion:String(version),rollupAddress:address(rollup),boardAddress:field(board),portalAddress};
  const instance=await node.getContract(scope.boardAddress);
  if(!metadata.classId||instance?.currentContractClassId!==metadata.classId||instance?.originalContractClassId!==metadata.classId)throw Error('Board contract does not match this application release.');
  const head=await node.getBlockData('checkpointed');if(!head?.blockHash)throw Error('No checkpointed board state is available.');
  // Pinned PublicImmutable stores Packable fields at consecutive slots, followed
  // by their hash. Config consists of ten scalar fields in declaration order.
  const read=async slot=>word(await node.getPublicStorageAt({hash:head.blockHash},scope.boardAddress,field(slot)));
  const base=BigInt(metadata.storage.config);
  const [boundPortal,configChain,configRollup,configVersion,censorWindow]=await Promise.all([read(metadata.storage.portal),read(base),read(base+1n),read(base+2n),read(base+7n)]);
  if(address(boundPortal)!==portalAddress||configChain!==l1ChainId||configRollup!==rollup||configVersion!==version)throw Error('Board and portal configuration do not agree.');
  const source=await createPublicFeedSource({node,scope,artifact:metadata.artifact,eventTags:metadata.eventTags,censorWindow:String(censorWindow)});
  const feed=createPublicFeed({scope,source,storage});
  return Object.freeze({feed,scope,censorWindow:String(censorWindow)});
}
let publicDatabase;
export function browserPublicFeedStorage(){
  const db=()=>publicDatabase??=new Promise((resolve,reject)=>{const r=indexedDB.open('aztec-billboard-public-feed-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('public');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Public feed storage unavailable.'));});
  return {async get(key){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('public').objectStore('public').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Public cache read failed.'));});},async set(key,value){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('public','readwrite');tx.objectStore('public').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('Public cache save failed.'));});}};
}
