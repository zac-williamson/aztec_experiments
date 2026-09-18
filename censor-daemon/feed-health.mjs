// Read-only, node-relative feed progress. No signer or store mutation.
const unavailable=()=>({type:'billboard-feed-lag-v1',severity:'warning',code:'FEED_LAG_UNKNOWN',action:'Check node identity and canonical feed progress; unknown is not zero lag.'});
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
function block(value){
 const number=Number(typeof value?.header?.getBlockNumber==='function'?value.header.getBlockNumber():value?.header?.globalVariables?.blockNumber),id=value?.blockHash?.toString();
 if(!Number.isSafeInteger(number)||number<1||!hash(id))throw Error();return {number,hash:id};
}
export async function observeFeedLag({node,scope,checkpoint}={}){
 try{
  if(!Number.isSafeInteger(checkpoint?.number)||checkpoint.number<1||!hash(checkpoint.hash))throw Error();
  // The caller supplies the existing aborting publicNode transport with its own
  // short request timeout. No outer race leaves requests running in the background.
  const results=await Promise.allSettled([node.getNodeInfo(),node.getBlockData('checkpointed'),node.getBlockData(checkpoint.number)]);
  if(results.some(r=>r.status!=='fulfilled'))throw Error();
  const [info,headValue,savedValue]=results.map(r=>r.value);
  if(String(info.l1ChainId)!==scope.l1ChainId||String(info.rollupVersion)!==scope.rollupVersion||info.l1ContractAddresses?.rollupAddress?.toString().toLowerCase()!==scope.rollupAddress)throw Error();
  const head=block(headValue),saved=block(savedValue);
  if(saved.number!==checkpoint.number||saved.hash!==checkpoint.hash||head.number<saved.number||(head.number===saved.number&&head.hash!==saved.hash))throw Error();
  const lag=head.number-saved.number;
  return {type:'billboard-feed-lag-v1',severity:lag?'warning':'ok',code:lag?'FEED_BEHIND_CHECKPOINTED_TIP':'FEED_AT_CHECKPOINTED_TIP',feedBlockHeight:saved.number,nodeCheckpointedBlockHeight:head.number,lagL2Blocks:lag,scope:'L2 blocks behind the configured node checkpointed tip; not elapsed time or independently verified global freshness',action:lag?'Check feed catch-up and moderation deadlines; positive lag alone does not establish a missed obligation.':'No measured checkpointed feed lag at this observation.'};
 }catch{return unavailable();}
}
