#!/usr/bin/env node
// One-shot, public-state-only observation. No signer or transaction submission.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ethers} from 'ethers';
import '../shared/public-app-config.js';
import {PORTAL_IMMUTABLES, verifyPortalRuntime} from '../shared/portal-runtime.mjs';

const actions = Object.freeze({
  ESCROW_BALANCED:'No escrow accounting alert; continue scheduled observations.',
  ESCROW_SURPLUS:'Investigate unsolicited or forced ETH. Do not credit it as a user deposit or assume it is recoverable.',
  ESCROW_DEFICIT:'Escalate immediately. Verify with a second trusted endpoint and suspend new deposit advertising; preserve withdrawal access.',
  OBSERVATION_UNAVAILABLE:'Check endpoint health and configuration through a trusted channel; rerun against a verified alternate endpoint. Do not infer solvency.',
  OBSERVATION_STALE:'Check chain progress and endpoint lag against a trusted alternate; do not treat this observation as current.',
  IDENTITY_UNVERIFIED:'Stop relying on this endpoint/configuration. Reconcile chain, portal runtime and board identities with the deployment record.',
  PORTAL_INACTIVE:'Do not advertise deposits. Complete or reconcile the existing activation procedure.',
  MONITOR_CONFIG_INVALID:'Use an exported public board configuration and valid monitor limits.',
});
const result=(code,details={})=>({schemaVersion:1,code,severity:code==='ESCROW_BALANCED'?'ok':code==='ESCROW_SURPLUS'?'warning':'critical',action:actions[code],...details});
const fault=()=>{throw Object.assign(Error('Identity verification failed'),{monitorIdentity:true});};
const eq=(a,b)=>BigInt(a)===BigInt(b);
const abi=PORTAL_IMMUTABLES.map(n=>`function ${n}() view returns (${['ROLLUP','INBOX','OUTBOX'].includes(n)?'address':['L2_CONTRACT','CONFIG_HASH'].includes(n)?'bytes32':'uint256'})`).concat(['function totalDeposited() view returns (uint256)','function depositsEnabled() view returns (bool)','function getInbox() view returns (address)','function getOutbox() view returns (address)','function getVersion() view returns (uint256)']);
const iface=new ethers.Interface(abi);

export async function readEscrowSnapshot({provider,config,metadata}){
  const n=config.network,b=config.board;
  const [chainId,block]=await Promise.all([provider.send('eth_chainId',[]),provider.send('eth_getBlockByNumber',['latest',false])]);
  if(!eq(chainId,n.chainId)||!block||!/^0x[0-9a-fA-F]{64}$/.test(block.hash))fault();
  const tag={blockHash:block.hash,requireCanonical:true};
  const call=async(address,name)=>iface.decodeFunctionResult(name,await provider.send('eth_call',[{to:address,data:iface.encodeFunctionData(name)},tag]))[0];
  const [values,code,liabilities,balance,active,inbox,outbox,version]=await Promise.all([
    Promise.all(PORTAL_IMMUTABLES.map(name=>call(b.portalAddress,name))),
    provider.send('eth_getCode',[b.portalAddress,tag]),call(b.portalAddress,'totalDeposited'),
    provider.send('eth_getBalance',[b.portalAddress,tag]),call(b.portalAddress,'depositsEnabled'),
    call(n.rollupAddress,'getInbox'),call(n.rollupAddress,'getOutbox'),call(n.rollupAddress,'getVersion'),
  ]);
  const immutable=Object.fromEntries(PORTAL_IMMUTABLES.map((name,i)=>[name,values[i]]));
  if(!eq(immutable.L1_CHAIN_ID,n.chainId)||!eq(immutable.ROLLUP,n.rollupAddress)||!eq(immutable.L2_CONTRACT,b.contractAddress)||
     !eq(immutable.VERSION,n.rollupVersion)||!eq(version,n.rollupVersion)||!eq(immutable.INBOX,inbox)||!eq(immutable.OUTBOX,outbox))fault();
  try{verifyPortalRuntime(code,metadata,immutable);}catch{fault();}
  return {blockNumber:BigInt(block.number),timestamp:BigInt(block.timestamp),liabilities:BigInt(liabilities),balance:BigInt(balance),active};
}

export async function observeEscrow({config,read,timeoutMs=10000,maxAgeSeconds=180,now=()=>Date.now()}){
  let selected;
  try{
    selected=globalThis.BillboardConfig.validate(config);
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||!Number.isInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>3600||typeof read!=='function')throw Error();
  }catch{return result('MONITOR_CONFIG_INVALID');}
  let timer;
  try{
    const snapshot=await Promise.race([Promise.resolve().then(()=>read(selected)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),timeoutMs);})]);
    const {blockNumber,timestamp,liabilities,balance,active}=snapshot;
    if([blockNumber,timestamp,liabilities,balance].some(v=>typeof v!=='bigint'||v<0n||v>=1n<<256n)||typeof active!=='boolean')throw Error();
    const seconds=Math.floor(now()/1000);
    if(!Number.isSafeInteger(seconds)||timestamp>BigInt(seconds+30)||timestamp<BigInt(seconds-maxAgeSeconds))return result('OBSERVATION_STALE');
    const details={blockNumber:blockNumber.toString(),blockTimestamp:timestamp.toString(),liabilitiesWei:liabilities.toString(),balanceWei:balance.toString(),differenceWei:(balance-liabilities).toString(),active};
    // A deficit must remain visible even if deposits are inactive.
    const code=balance<liabilities?'ESCROW_DEFICIT':!active?'PORTAL_INACTIVE':balance>liabilities?'ESCROW_SURPLUS':'ESCROW_BALANCED';
    return result(code,details);
  }catch(error){return result(error?.monitorIdentity===true?'IDENTITY_UNVERIFIED':'OBSERVATION_UNAVAILABLE');}
  finally{clearTimeout(timer);}
}

// One owner tracks every request controller, including concurrent RPC reads.
// Closing the observation aborts actual HTTP work, not only its awaiting promise.
export function createMonitorTransport(url,{timeoutMs=10000,fetchImpl=fetch}={}){
  const pending=new Set();let closed=false,id=0;
  return {async send(method,params){
    if(closed)throw Error();
    const controller=new AbortController();pending.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeoutMs),requestId=++id;
    try{
      const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal,redirect:'error'});
      if(!response.ok)throw Error();
      const reader=response.body.getReader();let bytes=0;const chunks=[];
      for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024*1024){controller.abort();throw Error();}chunks.push(value);}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(value?.jsonrpc!=='2.0'||value.id!==requestId||value.error||!Object.hasOwn(value,'result'))throw Error();
      return value.result;
    }finally{clearTimeout(timer);pending.delete(controller);}
  },destroy(){closed=true;for(const controller of pending)controller.abort();pending.clear();}};
}

async function main(){
  let provider;
  try{
    if(process.argv.length!==3)throw Error();
    const config=globalThis.BillboardConfig.parse(await readFile(process.argv[2],'utf8'));
    const metadata=JSON.parse(await readFile(new URL('../shared/portal-runtime.json',import.meta.url),'utf8'));
    provider=createMonitorTransport(config.network.ethRpcUrl);
    const observation=await observeEscrow({config,read:config=>readEscrowSnapshot({provider,config,metadata})});
    process.stdout.write(JSON.stringify(observation)+'\n');
    process.exitCode=observation.severity==='ok'?0:observation.severity==='warning'?1:2;
  }catch{process.stdout.write(JSON.stringify(result('MONITOR_CONFIG_INVALID'))+'\n');process.exitCode=2;}
  finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
