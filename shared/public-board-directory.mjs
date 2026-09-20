import {publicNode,publicRpc} from './public-feed-rpc.mjs';
import {connectPublicBoard} from './public-feed-connection.mjs';
const field=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const position=log=>{const keys=['blockNumber','txIndexWithinBlock','logIndexWithinTx'];if(!keys.every(k=>Number.isSafeInteger(log[k])&&log[k]>=0))throw Error('Invalid publication position');return Object.fromEntries(keys.map(k=>[k,log[k]]));};
const compare=(a,b)=>a.blockNumber-b.blockNumber||a.txIndexWithinBlock-b.txIndexWithinBlock||a.logIndexWithinTx-b.logIndexWithinTx;
// Pinned ContractInstancePublishedEvent fields: tag, address, version, salt, class.
// The SDK parity test guards these offsets; contract identity is checked separately.
export function publishedBoard(log,metadata){
 const f=log.logData;
 if(!Array.isArray(f)||f.length<7||!f.every(field)||f[0]!==metadata.instancePublicationTag)throw Error('Invalid contract publication');
 if(BigInt(f[2])!==2n||f[4]!==metadata.classId)return null;
 if(BigInt(f[1])===0n)throw Error('Invalid published address');
 return f[1];
}
export function createBoardDirectory({network,metadata,fetchImpl}){
 const node=publicNode(network.nodeUrl,{fetchImpl}),eth=publicRpc(network.ethRpcUrl,{fetchImpl}),seen=new Set();let reference=null,startBlock=null,cursor=null,complete=false,busy=false,scanned=0,invalidated=false;
 return {async next(){
  if(invalidated)throw Object.assign(Error('Directory checkpoint changed'),{code:'BB_DIRECTORY_REORG'});
  if(busy)throw Error('Directory scan already running');
  if(complete)return {boards:[],complete,scanned,block:reference.number};
  busy=true;
  try{
   if(!reference){
    const [info,head]=await Promise.all([node.getNodeInfo(),node.getBlockData('checkpointed')]);
    if(String(info.l1ChainId)!==network.chainId||String(info.rollupVersion)!==network.rollupVersion||info.l1ContractAddresses?.rollupAddress!==network.rollupAddress)throw Error('Directory network mismatch');
    const number=head?.header?.globalVariables?.blockNumber;
    if(!Number.isSafeInteger(number)||number<1||!field(head.blockHash))throw Error('Invalid directory checkpoint');
    reference={number,hash:head.blockHash};
    // Instance publication requires this class-registration nullifier to exist.
    // Start inclusively: registration and instance publication can share a block.
    const registration=await node.findLeavesIndexes(reference.hash,0,[metadata.registrationNullifier]);
    if(!Array.isArray(registration)||registration.length!==1)throw Error('Invalid class registration lookup');
    if(registration[0]==null){
     if((await node.getBlockData(reference.number))?.blockHash!==reference.hash){invalidated=true;throw Object.assign(Error('Directory checkpoint changed'),{code:'BB_DIRECTORY_REORG'});}
     complete=true;return {boards:[],complete,scanned,block:reference.number};
    }
    startBlock=registration[0].l2BlockNumber;
    if(!Number.isSafeInteger(startBlock)||startBlock<1||startBlock>number||!field(registration[0].l2BlockHash))throw Error('Invalid class registration block');
   }
   const result=await node.getPrivateLogsByTags({tags:[{tag:metadata.instancePublicationTag,...(cursor?{afterLog:cursor}:{})}],fromBlock:startBlock,toBlock:reference.number+1,referenceBlock:reference.hash,limitPerTag:20,includeEffects:false});
   if(!Array.isArray(result)||result.length!==1||!Array.isArray(result[0])||result[0].length>20)throw Error('Invalid publication page');
   const boards=[],addresses=new Set();let last=cursor;
   for(const log of result[0]){
    const next=position(log);if(next.blockNumber<startBlock||next.blockNumber>reference.number||(last&&compare(next,last)<=0))throw Error('Publication cursor did not advance');last=next;
    const address=publishedBoard(log,metadata);if(!address||seen.has(address)||addresses.has(address))continue;
    const instance=await node.getContract(address);
    if(instance==null)continue;
    if(!field(instance.currentContractClassId)||!field(instance.originalContractClassId))throw Error('Invalid published instance');
    if(instance.currentContractClassId!==metadata.classId||instance.originalContractClassId!==metadata.classId)continue;
    const portal=await node.getPublicStorageAt({hash:reference.hash},address,'0x'+BigInt(metadata.storage.portal).toString(16).padStart(64,'0'));
    if(!field(portal))throw Error('Invalid portal binding');
    let ready=false,unavailable=false;
    if(BigInt(portal)!==0n){
     try{const verified=await connectPublicBoard({network,boardAddress:address,metadata,storage:null,fetchImpl});
     const enabled=await eth('eth_call',[{to:verified.scope.portalAddress,data:metadata.portalSelectors.depositsEnabled},'latest']);
     if(typeof enabled!=='string'||!/^0x[0-9a-fA-F]*$/.test(enabled))throw Error('Invalid portal readiness response');
     if(enabled.length!==66||![0n,1n].includes(BigInt(enabled)))throw Object.assign(Error('Incompatible portal readiness'),{code:'BB_BOARD_INCOMPATIBLE'});
     ready=BigInt(enabled)===1n;
     }catch(error){if(!['BB_BOARD_INCOMPATIBLE','BB_PUBLIC_CALL_REVERTED'].includes(error.code))throw error;unavailable=true;}
    }
    addresses.add(address);boards.push({address,publishedAtBlock:log.blockNumber,ready,unavailable});
   }
   const canonical=await node.getBlockData(reference.number);
   if(canonical?.blockHash!==reference.hash){invalidated=true;throw Object.assign(Error('Directory checkpoint changed'),{code:'BB_DIRECTORY_REORG'});}
   // Advance only after the whole page is valid. Errors never skip publications.
   for(const address of addresses)seen.add(address);cursor=last;scanned+=result[0].length;complete=result[0].length<20;
   return {boards,complete,scanned,block:reference.number};
  }finally{busy=false;}
 }};
}
