import {encodeConfigCommitment} from '../protocol-commitments.mjs';

// Fixed diagnostic vocabulary only. Never inspect exception text or invoke a
// code getter. Observation is not readiness authority and owns no SDK work.
export const ROLLING_DEPLOYMENT_STAGES=Object.freeze(['config','node-readiness','artifact-layout','board-class','checkpoint','board-instance','public-config','config-commitment','fee-instance','l1-context','portal-code-and-immutables','canonical-recheck','final-readiness-and-context']);
export const ROLLING_SETUP_ERROR_CODES=Object.freeze(['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE','BB_BROWSER_PROVER_CONFIGURATION','ROLLING_SESSION_CONFIG','ROLLING_OTHER_TAB','ROLLING_CONTEXT_CHANGED','ROLLING_ACCOUNT_MISMATCH','ROLLING_PRIVATE_ROUTE','ROLLING_DEPLOYMENT_INVALID']);
export function rollingSetupErrorCode(error){
 try{const descriptor=error!=null?Object.getOwnPropertyDescriptor(error,'code'):null;return descriptor&&Object.hasOwn(descriptor,'value')&&ROLLING_SETUP_ERROR_CODES.includes(descriptor.value)?descriptor.value:'unknown';}catch{return 'unknown';}
}
export function observeRollingSetup(observer,record){
 try{if(typeof observer==='function')Promise.resolve(observer(Object.freeze(record))).catch(()=>{});}catch{/* Diagnostics never change operation or failure semantics. */}
}
const failure=()=>Object.assign(Error('Rolling deployment could not be verified.'),{code:'ROLLING_DEPLOYMENT_INVALID'});
const check=value=>{if(!value)throw failure();};
const number=value=>BigInt(value.toString());
const same=(a,b)=>number(a)===number(b);
const canonical=(value,length)=>typeof value==='string'&&new RegExp(`^0x[0-9a-f]{${length}}$`).test(value)&&BigInt(value)>0n;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const immutableNames=['MIN_DEPOSIT','MAX_DEPOSIT','L2_CONTRACT','ROLLUP','INBOX','OUTBOX','VERSION','L1_CHAIN_ID','CONFIG_HASH'];
const abi=[...immutableNames.map(name=>`function ${name}() view returns (${['ROLLUP','INBOX','OUTBOX'].includes(name)?'address':name==='L2_CONTRACT'||name==='CONFIG_HASH'?'bytes32':'uint256'})`),'function depositsEnabled() view returns (bool)'];
// Detached SDK values retain their prototype methods. Freeze plain containers;
// typed byte arrays and SDK value objects are copied, not shared with inputs.
function detach(value){
 if(value===null||typeof value!=='object')return value;
 if(ArrayBuffer.isView(value))return value.constructor.from(value);
 if(value instanceof ArrayBuffer)return value.slice(0);
 const copy=Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));
 for(const key of Object.keys(value))copy[key]=detach(value[key]);
 return Array.isArray(copy)||Object.getPrototypeOf(copy)===Object.prototype?Object.freeze(copy):copy;
}
/** Trusted-wallet preflight, not a public-reader connection. sdk and processed
 * artifacts are supplied by the authenticated application build, never config/RPC.
 * Requires sdk.computeContractAddressFromInstance (installed stdlib/contract).
 * The fixed layout is RollingBoard admission::Config, ten Packable scalar slots:
 * chain,rollup,version,min,max,base,k,window,saveup,deployer. Pinned v6 PublicImmutable
 * reserves one additional hash slot; artifact slot gaps are checked explicitly.
 * No wallet/account queries, funding, publication or fallback node are performed.
 * Canonical RPC consistency is checked; this does not establish operator identity.
 * Caller owns node/PXE lifecycle; this function owns and disposes its L1 provider.
 */
export async function verifyRollingDeployment({sdk,node,ethers,config,boardArtifact,privateFeeArtifact,contextGuard,proofsEnabled=true,onProgress}){
 let provider,current;
 const emit=(state,error)=>observeRollingSetup(onProgress,{stage:'deployment-initialization',step:current,state,code:state==='failed'?rollingSetupErrorCode(error):null});
 const begin=step=>{if(current)emit('complete');current=step;emit('started');};
 const deadline=Date.now()+20000;
 const read=async fn=>{const left=deadline-Date.now();check(left>0);let timeout;
  try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(failure()),left);})]);}
  finally{clearTimeout(timeout);}};
 try{
  begin('config');
  check(typeof contextGuard==='function'&&typeof proofsEnabled==='boolean');await read(contextGuard);
  check(sdk.isTrustedPrivateNode(node));
  const c=JSON.parse(JSON.stringify(config)),n=c.network,b=c.board,f=c.privateFee;
  check(n&&b&&f&&canonical(n.rollupAddress,40)&&canonical(b.portalAddress,40)&&canonical(b.contractAddress,64)&&canonical(f.contractAddress,64));
  check(typeof n.chainId==='string'&&typeof n.rollupVersion==='string'&&/^[1-9][0-9]{0,19}$/.test(n.chainId)&&/^[1-9][0-9]{0,9}$/.test(n.rollupVersion));
  const network={chainId:String(n.chainId),version:String(n.rollupVersion),rollup:n.rollupAddress};
  check(proofsEnabled||network.chainId==='31337');
  const endpoint=new URL(n.ethRpcUrl);
  check(!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&(endpoint.protocol==='https:'||network.chainId==='31337'&&endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)));
  sdk.normalizePrivateFeeGasSettings(f.gasSettings);
  begin('node-readiness');
  await read(()=>sdk.inspectTrustedNode(node,{expectedNetworkScope:network,proofsEnabled}));
  begin('artifact-layout');
  check(boardArtifact.name==='RollingBoard');
  const slot=name=>number(boardArtifact.storageLayout[name].slot);
  const base=slot('config'),portalSlot=slot('portal_address');
  check(portalSlot===1n&&base===portalSlot+2n&&slot('deposits')===base+11n);
  begin('board-class');
  const address=new sdk.AztecAddress(new sdk.Fr(BigInt(b.contractAddress))),classId=(await read(()=>sdk.getContractClassFromArtifact(boardArtifact))).id;
  begin('checkpoint');
  const head=await read(()=>node.getBlockData('checkpointed'));
  const blockNumber=Number(head?.header?.globalVariables?.blockNumber),blockHash=head?.blockHash?.toString();
  check(Number.isSafeInteger(blockNumber)&&blockNumber>0&&hash(blockHash));
  const reference={hash:blockHash};
  begin('board-instance');
  const published=await read(()=>node.getContract(address,reference));
  check(published&&same(published.address,address)&&same(published.currentContractClassId,classId)&&same(published.originalContractClassId,classId)&&same(await read(()=>sdk.computeContractAddressFromInstance(published)),address));
  begin('public-config');
  const values=await read(()=>Promise.all([portalSlot,...Array.from({length:10},(_,i)=>base+BigInt(i))].map(s=>node.getPublicStorageAt(reference,address,new sdk.Fr(s)))));
  const [portal,chain,rollup,version,min,max,baseCooldown,kMultiplier,censorWindow,maxSaveUp,deployer]=values.map(number);
  check(same(portal,b.portalAddress)&&same(chain,network.chainId)&&same(rollup,network.rollup)&&same(version,network.version)&&deployer>0n&&same(deployer,published.deployer));
  const economics=Object.fromEntries(Object.entries({minDeposit:min,maxDeposit:max,baseCooldown,kMultiplier,censorWindow,maxSaveUp}).map(([key,value])=>[key,String(value)]));
  begin('config-commitment');
  const encoded=encodeConfigCommitment({l1ChainId:network.chainId,rollupAddress:network.rollup,rollupVersion:network.version,boardAddress:b.contractAddress},economics);
  const configHash=await read(()=>sdk.sha256ToField({toBuffer:()=>encoded}));
  begin('fee-instance');
  const canonicalFee=await read(()=>sdk.derivePrivateFeeInstance(privateFeeArtifact));check(same(canonicalFee.address,f.contractAddress));
  const feeInstance=await read(()=>node.getContract(canonicalFee.address,reference));
  check(feeInstance&&same(feeInstance.address,canonicalFee.address)&&same(feeInstance.currentContractClassId,canonicalFee.currentContractClassId)&&same(feeInstance.originalContractClassId,canonicalFee.originalContractClassId)&&same(await read(()=>sdk.computeContractAddressFromInstance(feeInstance)),canonicalFee.address));
  begin('l1-context');
  provider=new ethers.JsonRpcProvider(endpoint.href);
  const [l1Network,l1Head,contracts]=await read(()=>Promise.all([provider.getNetwork(),provider.getBlock('latest'),node.getL1ContractAddresses()]));
  check(same(l1Network.chainId,network.chainId)&&Number.isSafeInteger(l1Head?.number)&&l1Head.number>=0&&hash(l1Head.hash));
  check(same(contracts.rollupAddress,network.rollup));
  begin('portal-code-and-immutables');
  const portalContract=new ethers.Contract(b.portalAddress,abi,provider);
  const [code,immutableValues,depositsEnabled]=await read(()=>Promise.all([provider.getCode(b.portalAddress,l1Head.number),Promise.all(immutableNames.map(name=>portalContract[name]({blockTag:l1Head.number}))),portalContract.depositsEnabled({blockTag:l1Head.number})]));
  check(depositsEnabled===true); // V1 Ready activation is mandatory before funding or composing.
  const expected={MIN_DEPOSIT:min,MAX_DEPOSIT:max,L2_CONTRACT:BigInt(b.contractAddress),ROLLUP:rollup,INBOX:number(contracts.inboxAddress),OUTBOX:number(contracts.outboxAddress),VERSION:version,L1_CHAIN_ID:chain,CONFIG_HASH:number(configHash)};
  check(expected.INBOX>0n&&expected.OUTBOX>0n&&immutableValues.every((value,index)=>same(value,expected[immutableNames[index]])));
  check(sdk.verifyPortalRuntime(code,sdk.portalRuntimeMetadata,expected)===true);
  begin('canonical-recheck');
  const [l1Again,l2Again]=await read(()=>Promise.all([provider.getBlock(l1Head.number),node.getBlockData(blockNumber)]));
  check(l1Again?.hash===l1Head.hash&&l2Again?.blockHash?.toString()===blockHash&&Number(l2Again?.header?.globalVariables?.blockNumber)===blockNumber);
  begin('final-readiness-and-context');
  await read(()=>sdk.inspectTrustedNode(node,{expectedNetworkScope:network,proofsEnabled}));await read(contextGuard);
  const result=detach({board:{address,artifact:boardArtifact,instance:published},network,portal:b.portalAddress,
   privateFee:{address:canonicalFee.address,artifact:privateFeeArtifact,instance:feeInstance,gasSettings:f.gasSettings},proofsEnabled,economics,
   checkpoint:{number:blockNumber,hash:blockHash},ethereumCheckpoint:{number:l1Head.number,hash:l1Head.hash},configHash:configHash.toString()});
  emit('complete');return result;
 }catch(error){emit('failed',error);throw failure();}
 finally{try{provider?.destroy();}catch{/* Disposing a read-only provider cannot authorize any action. */}}
}
