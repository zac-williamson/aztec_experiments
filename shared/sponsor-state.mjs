// Read-only deployment-scoped state. This does not authorize, prove, send, or attest an untrusted provider.
import { Contract } from '@aztec/aztec.js/contracts';
import { NO_FROM } from '@aztec/aztec.js/account';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { loadContractArtifact, getAllFunctionAbis } from '@aztec/stdlib/abi';
import { getContractClassFromArtifact, computeContractAddressFromInstance } from '@aztec/stdlib/contract';

export class SponsorStateError extends Error {
  constructor(code) { super(code); this.name='SponsorStateError'; this.code=code; }
}
const requireValue=(ok,code)=>{if(!ok)throw new SponsorStateError(code);};
function uint(value,bits,code='SPONSOR_STATE_INVALID_VALUE') {
  if(value instanceof Fr)value=value.toBigInt();
  if(typeof value==='number'){requireValue(Number.isSafeInteger(value),code);value=BigInt(value);}
  if(typeof value==='string'){requireValue(/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=39,code);value=BigInt(value);}
  requireValue(typeof value==='bigint'&&value>=0n&&value<(1n<<BigInt(bits)),code);return value;
}
function field(value,code='SPONSOR_STATE_INVALID_VALUE') {
  if(value instanceof Fr)return new Fr(value.toBigInt());
  if(typeof value==='bigint'){try{return new Fr(value);}catch{throw new SponsorStateError(code);}}
  requireValue(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),code);
  try{return Fr.fromString(value);}catch{throw new SponsorStateError(code);}
}
function address(value) {
  const result=field(value instanceof AztecAddress?value.toString():value,'SPONSOR_STATE_INVALID_ADDRESS');
  requireValue(!result.isZero(),'SPONSOR_STATE_INVALID_ADDRESS');return new AztecAddress(result);
}
const equal=(a,b)=>a?.toString()===b?.toString();

/** Returns canonical strings {root,window,ticket_count,timestamp} from checked public reads.
 * The caller supplies the trusted bundled artifact and deployment scope. A positive result is
 * provider-backed availability, not a consensus proof or an authorization to spend a coupon.
 */
export async function readRegisteredSponsorBatch(input) {
  try{return await read(input);}catch(error){
    if(error instanceof SponsorStateError)throw error;
    throw new SponsorStateError('SPONSOR_STATE_UNAVAILABLE'); // No provider messages, stacks or values copied.
  }
}
async function read(input) {
  const keys=['wallet','node','sponsorAddress','sponsorArtifact','boardAddress','expectedChainId','expectedVersion','batchId'];
  requireValue(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===keys.length&&keys.every(k=>Object.hasOwn(input,k)),'SPONSOR_STATE_INVALID_INPUT');
  const {wallet,node,sponsorArtifact}=input;
  requireValue(wallet&&node&&['getChainInfo','registerContract','simulateTx'].every(k=>typeof wallet[k]==='function')&&
    ['getNodeInfo','getContract','getBlock'].every(k=>typeof node[k]==='function'),'SPONSOR_STATE_PROVIDER_REQUIRED');
  const sponsorAddress=address(input.sponsorAddress),boardAddress=address(input.boardAddress);
  const chainId=uint(input.expectedChainId,64),version=uint(input.expectedVersion,32),batchId=uint(input.batchId,64,'SPONSOR_STATE_INVALID_BATCH');
  requireValue(batchId>0n,'SPONSOR_STATE_INVALID_BATCH');
  const [walletChain,nodeInfo]=await Promise.all([wallet.getChainInfo(),node.getNodeInfo()]);
  requireValue(walletChain&&nodeInfo&&uint(walletChain.chainId,64)===chainId&&uint(walletChain.version,32)===version&&
    uint(nodeInfo.l1ChainId,64)===chainId&&uint(nodeInfo.rollupVersion,32)===version,'SPONSOR_STATE_CHAIN_MISMATCH');
  const artifact=loadContractArtifact(sponsorArtifact);
  const roots=artifact.functions.filter(f=>f.functionType==='private').map(f=>f.name).sort();
  const abis=getAllFunctionAbis(artifact);
  requireValue(artifact.name==='BillboardSponsor'&&JSON.stringify(roots)===JSON.stringify(['sponsor_claim','sponsor_post','sponsor_withdraw'])&&
    ['get_config','get_batch'].every(name=>abis.filter(f=>f.name===name&&f.functionType==='public'&&f.isStatic).length===1),'SPONSOR_STATE_ARTIFACT_INVALID');
  const localClass=await getContractClassFromArtifact(artifact);
  const instance=await node.getContract(sponsorAddress,'latest');
  requireValue(instance&&equal(instance.address,sponsorAddress),'SPONSOR_STATE_NOT_DEPLOYED');
  requireValue(equal(instance.currentContractClassId,localClass.id)&&equal(instance.originalContractClassId,localClass.id)&&
    equal(await computeContractAddressFromInstance(instance),sponsorAddress),'SPONSOR_STATE_CLASS_MISMATCH');
  await wallet.registerContract(instance,artifact);
  const sponsor=Contract.at(sponsorAddress,artifact,wallet);
  const readOptions={from:NO_FROM,skipFeeEnforcement:true};
  const [{result:config},{result:batch},latest]=await Promise.all([
    sponsor.methods.get_config().simulate(readOptions),sponsor.methods.get_batch(batchId).simulate(readOptions),node.getBlock('latest'),
  ]);
  requireValue(config&&batch&&latest?.header?.globalVariables,'SPONSOR_STATE_UNAVAILABLE');
  requireValue(equal(address(config.board),boardAddress),'SPONSOR_STATE_BOARD_MISMATCH');
  const duration=uint(config.window_duration,64),budget=uint(config.window_budget,128),fee=uint(config.max_fee_per_ticket,128);
  requireValue(duration>0n&&duration<=86400n&&fee>0n&&fee<=budget,'SPONSOR_STATE_POLICY_INVALID');
  const root=field(batch.root),window=uint(batch.window,64),count=uint(batch.ticket_count,32);
  requireValue(!root.isZero()&&count>0n&&count<=1024n,'SPONSOR_BATCH_UNAVAILABLE');
  requireValue(window*duration+duration-1n<(1n<<64n),'SPONSOR_STATE_INVALID_BATCH');
  const timestamp=uint(latest.header.globalVariables.timestamp,64);
  return Object.freeze({root:root.toString(),window:window.toString(),ticket_count:count.toString(),timestamp:timestamp.toString()});
}
