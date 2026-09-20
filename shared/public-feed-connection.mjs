import {readFeedSnapshot,publicFeedConflict} from './public-feed-storage.mjs';
import {publicNode,publicRpc} from './public-feed-rpc.mjs';
import {createPublicFeedSource} from './public-feed-source.mjs';
import {createPublicFeed} from './public-feed.mjs';
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const word=v=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(v))throw Error('Invalid public deployment data.');return BigInt(v);};
const address=n=>{if(n<=0n||n>=1n<<160n)throw Error('Invalid public deployment address.');return '0x'+n.toString(16).padStart(40,'0');};
// A board link identifies the contract; its portal comes from verified on-chain state.
export async function connectPublicBoard({network,boardAddress,metadata,storage,fetchImpl}){
  if(typeof boardAddress!=='string'||!/^0x[0-9a-f]{64}$/.test(boardAddress)||word(boardAddress)===0n)throw Error('Invalid board link.');
  const node=publicNode(network.nodeUrl,{fetchImpl});
  const [instance,head]=await Promise.all([node.getContract(boardAddress),node.getBlockData('checkpointed')]);
  if(!metadata.classId||instance?.currentContractClassId!==metadata.classId||instance?.originalContractClassId!==metadata.classId)throw Error('Board contract does not match this application release.');
  if(!head?.blockHash)throw Error('No checkpointed board state is available.');
  const portalAddress=address(word(await node.getPublicStorageAt({hash:head.blockHash},boardAddress,field(metadata.storage.portal))));
  const config={schemaVersion:1,network,board:{contractAddress:boardAddress,portalAddress},privateFee:null};
  const connection=await connectPublicFeed({nodeUrl:network.nodeUrl,ethereumUrl:network.ethRpcUrl,portalAddress,metadata,storage,fetchImpl,expectedConfig:config});
  return Object.freeze({...connection,config});
}
export async function connectPublicFeed({nodeUrl,ethereumUrl,portalAddress,metadata,storage,fetchImpl,expectedConfig}){
  if(!/^0x[0-9a-fA-F]{40}$/.test(portalAddress)||BigInt(portalAddress)===0n)throw Error('Enter a valid portal address.');
  portalAddress=portalAddress.toLowerCase();
  const node=publicNode(nodeUrl,{fetchImpl}),eth=publicRpc(ethereumUrl,{fetchImpl});
  const call=async name=>word(await eth('eth_call',[{to:portalAddress,data:metadata.portalSelectors[name]},'latest']));
  const [board,rollup,version,l1ChainId,chain]=await Promise.all([call('L2_CONTRACT'),call('ROLLUP'),call('VERSION'),call('L1_CHAIN_ID'),eth('eth_chainId')]);
  if(typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||BigInt(chain)!==l1ChainId)throw Error('Ethereum endpoint does not match this board.');
  const scope={l1ChainId:String(l1ChainId),rollupVersion:String(version),rollupAddress:address(rollup),boardAddress:field(board),portalAddress};
  if(expectedConfig) {
    const n=expectedConfig.network,b=expectedConfig.board;
    if(!n||!b||nodeUrl!==n.nodeUrl||ethereumUrl!==n.ethRpcUrl||scope.l1ChainId!==n.chainId||
      scope.rollupVersion!==n.rollupVersion||scope.rollupAddress!==n.rollupAddress||
      scope.boardAddress!==b.contractAddress||scope.portalAddress!==b.portalAddress) throw Error('Live board does not match the imported configuration.');
  }
  const [instance,head]=await Promise.all([node.getContract(scope.boardAddress),node.getBlockData('checkpointed')]);
  if(!metadata.classId||instance?.currentContractClassId!==metadata.classId||instance?.originalContractClassId!==metadata.classId)throw Error('Board contract does not match this application release.');
  if(!head?.blockHash)throw Error('No checkpointed board state is available.');
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
  const db=()=>publicDatabase??=new Promise((resolve,reject)=>{const r=indexedDB.open('aztec-billboard-public-feed-v2',1);r.onupgradeneeded=()=>r.result.createObjectStore('public');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Public feed storage unavailable.'));});
  return {
    async load(key,maxRanges){const d=await db();return new Promise((resolve,reject)=>{
      const tx=d.transaction('public'),store=tx.objectStore('public');let result,failure;
      const read=k=>new Promise((yes,no)=>{const r=store.get(k);r.onsuccess=()=>yes(r.result??null);r.onerror=()=>no(r.error);});
      readFeedSnapshot(read,key,maxRanges).then(value=>{result=value;},error=>{failure=error;tx.abort();});
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(failure??Error('Public cache read failed.'));
    });},
    async commit(key,previous,next,range,removed){const d=await db();return new Promise((resolve,reject)=>{
      const tx=d.transaction('public','readwrite',{durability:'strict'}),store=tx.objectStore('public'),r=store.get(key);let failure;
      r.onsuccess=()=>{if((r.result??null)!==previous){failure=publicFeedConflict();tx.abort();return;}
        if(range)store.add(range.value,`${key}:range:${range.id}`);
        store.put(next,key);for(const id of removed)store.delete(`${key}:range:${id}`);
      };
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure??Error('Public cache commit failed.'));
    });},
  };
}
