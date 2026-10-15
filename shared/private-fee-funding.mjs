import {validateAggregateFundingIntent} from './rolling/aggregate-recovery.mjs';
import {createEthereumJournal,verifyEthereumIntentReceipt} from './ethereum-journal.mjs';
// User-funded Fee Juice bridge. Public recovery metadata never contains custody.
// Direct/ETH secrets derive from the wallet key; USDC uses an encrypted retained random salt.
import { Interface, getAddress } from 'ethers';
import { computeFeeJuiceMessageNullifier } from '@aztec-labs/stdlib/messaging';
import { siloNullifier } from '@aztec-labs/stdlib/hash';
import { MerkleTreeId } from '@aztec-labs/stdlib/trees';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
import { derivePrivateFeeInstance, requirePublishedPrivateFee, derivePrivateFeeBridgeSecret, derivePrivateFeeBridgeSecretHash } from './private-fee-client.mjs';

const portalAbi=new Interface([
  'function ROLLUP() view returns (address)', 'function UNDERLYING() view returns (address)',
  'function VERSION() view returns (uint256)', 'function L2_TOKEN_ADDRESS() view returns (bytes32)',
  'function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash) returns (bytes32 key,uint256 index)',
  'event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)',
]);
const tokenAbi=new Interface(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
const SCHEMA='private-fee-funding-v1';
export class PrivateFeeFundingError extends Error {
  constructor(code,record){super(code);this.name='PrivateFeeFundingError';this.code=code;if(record)this.recoveryRecord=Object.freeze({...record});}
}
const check=(ok,code)=>{if(!ok)throw new PrivateFeeFundingError(code);};
function uint(value,bits=128){
  if(value?.toBigInt)value=value.toBigInt();
  if(typeof value==='number'){check(Number.isSafeInteger(value),'PRIVATE_FEE_FUNDING_INVALID');value=BigInt(value);}
  if(typeof value==='string'){check(/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=78,'PRIVATE_FEE_FUNDING_INVALID');value=BigInt(value);}
  check(typeof value==='bigint'&&value>=0n&&value<(1n<<BigInt(bits)),'PRIVATE_FEE_FUNDING_INVALID');return value;
}
function address(value){const result=getAddress(value?.toString());check(result!=='0x0000000000000000000000000000000000000000','PRIVATE_FEE_FUNDING_INVALID');return result;}
function secretField(value){
  const text=value instanceof Fr?value.toString():value;
  check(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text),'PRIVATE_FEE_FUNDING_INVALID');
  const result=Fr.fromString(text);check(!result.isZero(),'PRIVATE_FEE_FUNDING_INVALID');return result;
}
const eq=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const copy=record=>Object.freeze({...record});
async function read(provider,to,abi,name,args=[]){return abi.decodeFunctionResult(name,await provider.call({to,data:abi.encodeFunctionData(name,args)}))[0];}
async function verifyScope({node,ethProvider,privateFeeArtifact,privateFeeAddress,expectedChainId,expectedVersion}){
  check(node?.getNodeInfo&&ethProvider?.getNetwork,'PRIVATE_FEE_FUNDING_PROVIDER_REQUIRED');
  const chainId=uint(expectedChainId,64),version=uint(expectedVersion,32);
  const [info,network,canonical]=await Promise.all([node.getNodeInfo(),ethProvider.getNetwork(),derivePrivateFeeInstance(privateFeeArtifact)]);
  check(uint(network.chainId,64)===chainId&&uint(info.l1ChainId,64)===chainId&&uint(info.rollupVersion,32)===version,'PRIVATE_FEE_FUNDING_CHAIN_MISMATCH');
  check(eq(canonical.address,privateFeeAddress),'PRIVATE_FEE_FUNDING_ADDRESS_MISMATCH');
  await requirePublishedPrivateFee(node,canonical);
  const scope={chainId:chainId.toString(),version:version.toString(),rollupAddress:address(info.l1ContractAddresses?.rollupAddress),
    portalAddress:address(info.l1ContractAddresses?.feeJuicePortalAddress),tokenAddress:address(info.l1ContractAddresses?.feeJuiceAddress),privateFeeAddress:canonical.address.toString()};
  const [rollup,token,portalVersion,l2Token]=await Promise.all([
    read(ethProvider,scope.portalAddress,portalAbi,'ROLLUP'),read(ethProvider,scope.portalAddress,portalAbi,'UNDERLYING'),
    read(ethProvider,scope.portalAddress,portalAbi,'VERSION'),read(ethProvider,scope.portalAddress,portalAbi,'L2_TOKEN_ADDRESS'),
  ]);
  check(eq(rollup,scope.rollupAddress)&&eq(token,scope.tokenAddress)&&uint(portalVersion,32)===version&&eq(l2Token,ProtocolContractAddress.FeeJuice),'PRIVATE_FEE_FUNDING_PORTAL_MISMATCH');
  return scope;
}
export async function claimSecrets({walletSecret,owner,record}){
  // Public sender+nonce identifies one Ethereum deposit; the wallet key keeps this salt private.
  const salt=await poseidon2HashWithSeparator([secretField(walletSecret),new Fr(uint(record.chainId,64)),new Fr(uint(record.version,32)),
    Fr.fromString(record.privateFeeAddress),new Fr(BigInt(record.sender)),new Fr(uint(record.nonce,64))],0x42424601);
  const secret=await derivePrivateFeeBridgeSecret({salt,owner});
  const secretHash=await derivePrivateFeeBridgeSecretHash({salt,owner});
  return {salt,secret,secretHash};
}
/** Trusted private workflow only: snapshot the original encrypted journal intent,
 * never a receipt-import field. Expected code hash/scope originate in authenticated deployment.
 * Extra journal cursor fields are ignored; no field/getter survives into asynchronous checks. */
export function captureAggregateFundingIntent(input) {
  if(input===undefined)return undefined;
  const invalid='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH';
  const capture=(value,keys)=>{
    check(value && [Object.prototype,null].includes(Object.getPrototypeOf(value)),invalid);
    const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);check(d && 'value' in d,invalid);result[key]=d.value;}return result;
  };
  const r=capture(input,['from','to','nonce','chainId','data','value','expected']);
  check(r.expected && Reflect.ownKeys(r.expected).length===7,invalid);
  r.expected=capture(r.expected,['kind','routerCodeHash','collateralPortal','feePortal','bokPortal','privateFpc','planHash']);
  for(const key of ['from','to'])check(typeof r[key]==='string' && /^0x[0-9a-f]{40}$/.test(r[key]) && BigInt(r[key])>0n,invalid);
  check(Number.isSafeInteger(r.nonce) && r.nonce>=0 && typeof r.chainId==='string' && /^[1-9][0-9]{0,19}$/.test(r.chainId) && BigInt(r.chainId)<2n**64n,invalid);
  check(typeof r.data==='string' && /^0x(?:[0-9a-f]{2})+$/.test(r.data) && r.data.length<=16384 && typeof r.value==='string' && /^(0|[1-9][0-9]{0,77})$/.test(r.value) && (r.expected.kind==='aggregate-usdc-funding' || r.value!=='0'),invalid);
  const hash=Object.getOwnPropertyDescriptor(input,'txHash');
  if(hash){check('value' in hash && (hash.value===null || typeof hash.value==='string' && /^0x[0-9a-f]{64}$/.test(hash.value)),invalid);r.txHash=hash.value;}
  try{validateAggregateFundingIntent(r);}catch{throw new PrivateFeeFundingError(invalid);}
  Object.freeze(r.expected);return Object.freeze(r);
}
/** Captured only from the private wallet's encrypted original funding context.
 * A random retained FPC salt avoids confusing a relayer transaction nonce with
 * either a beneficiary's transaction nonce or the collateral consent nonce. */
export function captureAggregateFundingCustody(input,intent) {
  const invalid='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH';
  const usdc=intent?.expected.kind==='aggregate-usdc-funding';
  if(!usdc){check(input===undefined,invalid);return undefined;}
  const keys=['kind','planHash','beneficiary','privateFeeSalt'];
  check(input && [Object.prototype,null].includes(Object.getPrototypeOf(input)) && Reflect.ownKeys(input).length===keys.length,invalid);
  const r={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);check(d && 'value' in d,invalid);r[key]=d.value;}
  check(r.kind==='aggregate-usdc-custody-v1' && r.planHash===intent.expected.planHash && typeof r.beneficiary==='string'
    && /^0x[0-9a-f]{40}$/.test(r.beneficiary) && BigInt(r.beneficiary)>0n && typeof r.privateFeeSalt==='string'
    && /^0x[0-9a-f]{64}$/.test(r.privateFeeSalt) && BigInt(r.privateFeeSalt)>0n && BigInt(r.privateFeeSalt)<21888242871839275222246405745257275088548364400416034343698204186575808495617n,invalid);
  let plan;try{plan=validateAggregateFundingIntent(intent);}catch{throw new PrivateFeeFundingError(invalid);}
  check(plan.beneficiary.toLowerCase()===r.beneficiary,invalid);
  return Object.freeze(r);
}
function validRecord(record){
  check(record&&record.schema===SCHEMA,'PRIVATE_FEE_RECOVERY_INVALID');
  const allowed=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
  check(Object.keys(record).every(key=>allowed.includes(key)),'PRIVATE_FEE_RECOVERY_INVALID');
  check(uint(record.amount)>0n,'PRIVATE_FEE_RECOVERY_INVALID');uint(record.nonce,64);
  address(record.sender);
  if(record.txHash!==undefined)check(typeof record.txHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(record.txHash),'PRIVATE_FEE_RECOVERY_INVALID');
}
async function fundingJournal(input,scope,sender) {
  check(input.journalStorage?.read&&input.journalStorage?.compareAndSwap&&input.walletSalt!==undefined,'BB_JOURNAL_INVALID');
  return createEthereumJournal({storage:input.journalStorage,walletSecret:secretField(input.walletSecret).toString(),walletSalt:input.walletSalt,
    scope:{account:input.owner.toString().toLowerCase(),chainId:scope.chainId,version:scope.version,rollup:scope.rollupAddress.toLowerCase(),board:scope.privateFeeAddress.toLowerCase(),portal:scope.portalAddress.toLowerCase(),token:scope.tokenAddress.toLowerCase(),depositor:sender.toLowerCase()},
    provider:input.ethProvider,signer:input.ethSigner,acknowledgeTx:input.acknowledgeEthereumTx,contextGuard:input.contextGuard});
}
export async function recoverPrivateFeeFunding(input) {
  const ethProvider=input.ethProvider;
  const scope=await verifyScope({...input,ethProvider});
  if(input.ethSigner)check(uint((await input.ethSigner.provider.getNetwork()).chainId,64)===uint(scope.chainId,64),'PRIVATE_FEE_FUNDING_CHAIN_MISMATCH');
  const sender=address(input.sender??await input.ethSigner?.getAddress());
  const journal=await fundingJournal({...input,ethProvider},scope,sender);
  const result=await journal.recover({retry:input.retry===true});
  if(result.outcome!=='success')return {outcome:result.outcome,lastEthereumTxHash:result.txHash};
  if(result.request.expected.kind==='approve')return {outcome:'approved',amount:result.request.expected.amount,lastEthereumTxHash:result.txHash};
  const record={schema:SCHEMA,...scope,sender,nonce:String(result.request.nonce),amount:result.request.expected.amount,txHash:result.txHash,leafIndex:String(result.event.index)};
  const {secretHash}=await claimSecrets({...input,record});
  check(eq(secretHash,result.request.expected.secretHash),'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');
  if(input.saveRecovery)await input.saveRecovery(copy(record));
  return {outcome:'funded',lastEthereumTxHash:result.txHash,record:copy(record)};
}
/** Saves public recovery data before submission. No automatic resend after an uncertain send. */
export async function fundPrivateFees(input){
  let record,depositAttempted=false,phase='validate-input';
  try{
    const {node,ethSigner,ethProvider,owner,walletSecret,privateFeeAddress,privateFeeArtifact,amount,saveRecovery,expectedChainId,expectedVersion}=input??{};
    check(ethProvider?.getNetwork&&ethSigner?.provider&&ethSigner?.sendTransaction&&typeof saveRecovery==='function','PRIVATE_FEE_FUNDING_PROVIDER_REQUIRED');
    // Validate private input before an approval transaction can be requested.
    secretField(walletSecret);secretField(owner?.toString());
    const quantity=uint(amount);check(quantity>0n,'PRIVATE_FEE_FUNDING_INVALID');
    phase='verify-scope';
    const scope=await verifyScope({node,ethProvider,privateFeeArtifact,privateFeeAddress,expectedChainId,expectedVersion});
    check(uint((await ethSigner.provider.getNetwork()).chainId,64)===uint(scope.chainId,64),'PRIVATE_FEE_FUNDING_CHAIN_MISMATCH');
    const sender=address(await ethSigner.getAddress());
    phase='journal-preflight';const journal=await fundingJournal(input,scope,sender);await journal.assertCanStart();
    phase='read-token-funding';
    const [balance,allowance]=await Promise.all([read(ethProvider,scope.tokenAddress,tokenAbi,'balanceOf',[sender]),read(ethProvider,scope.tokenAddress,tokenAbi,'allowance',[sender,scope.portalAddress])]);
    check(balance>=quantity,'PRIVATE_FEE_FUNDING_TOKEN_BALANCE');
    if(allowance<quantity){
      phase='submit-approval';
      await journal.send({data:tokenAbi.encodeFunctionData('approve',[scope.portalAddress,quantity]),value:'0',expected:{kind:'approve',amount:quantity.toString(),spender:scope.portalAddress.toLowerCase()}});
      phase='verify-allowance';
      check(await read(ethProvider,scope.tokenAddress,tokenAbi,'allowance',[sender,scope.portalAddress])>=quantity,'PRIVATE_FEE_FUNDING_APPROVAL_FAILED');
    }
    check(eq(await ethSigner.getAddress(),sender),'PRIVATE_FEE_FUNDING_ACCOUNT_CHANGED');
    phase='select-deposit-nonce';
    const deposited=await journal.send(async nonce=>{
      record={schema:SCHEMA,...scope,sender,nonce:nonce.toString(),amount:quantity.toString()};
      const {secretHash}=await claimSecrets({walletSecret,owner,record});
      phase='save-before-deposit';await saveRecovery(copy(record));
      check(uint((await ethProvider.getNetwork()).chainId,64)===uint(scope.chainId,64)&&eq(await ethSigner.getAddress(),sender),'PRIVATE_FEE_FUNDING_ACCOUNT_CHANGED');
      phase='submit-deposit';depositAttempted=true;
      return {data:portalAbi.encodeFunctionData('depositToAztecPublic',[scope.privateFeeAddress,quantity,secretHash.toString()]),value:'0',expected:{kind:'fee-deposit',amount:quantity.toString(),secretHash:secretHash.toString(),recipient:scope.privateFeeAddress.toLowerCase()}};
    });
    record={...record,txHash:deposited.txHash};phase='save-deposit-hash';await saveRecovery(copy(record));
    phase='recover-confirmed-claim';
    const claim=await recoverPrivateFeeClaim({node,ethProvider,owner,walletSecret,privateFeeArtifact,record,expectedChainId,expectedVersion});
    record={...record,leafIndex:claim.leafIndex.toBigInt().toString()};phase='save-confirmed-claim';await saveRecovery(copy(record));
    return copy(record);
  }catch(error){
    const journalCode=['BB_ETH_REQUEST_CANCELLED','BB_ETH_INSUFFICIENT_FUNDS','BB_JOURNAL_INVALID','BB_ETH_RECOVERY_REQUIRED','BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_TRANSACTION_FAILED'].includes(error?.code);
    const wrapped=journalCode?new PrivateFeeFundingError(error.code,record):depositAttempted?new PrivateFeeFundingError('PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN',record):
      error instanceof PrivateFeeFundingError?error:new PrivateFeeFundingError('PRIVATE_FEE_FUNDING_FAILED');
    // Finite codes only: never copy provider messages, payloads, transaction arguments or stacks.
    const names=new Set(['Error','TypeError','RangeError','AssertionError','PrivateFeeFundingError']);
    const codes=new Set(['NONCE_EXPIRED','REPLACEMENT_UNDERPRICED','TRANSACTION_REPLACED','INSUFFICIENT_FUNDS','ACTION_REJECTED','CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','UNKNOWN_ERROR','INVALID_ARGUMENT','ERR_ASSERTION',
      'PRIVATE_FEE_RECOVERY_INVALID','PRIVATE_FEE_RECOVERY_HASH_REQUIRED','PRIVATE_FEE_RECOVERY_SCOPE_MISMATCH','PRIVATE_FEE_RECOVERY_PENDING','PRIVATE_FEE_RECOVERY_REVERTED','PRIVATE_FEE_RECOVERY_REORG','PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH','PRIVATE_FEE_RECOVERY_EVENT_MISMATCH','PRIVATE_FEE_RECOVERY_FAILED']);
    wrapped.diagnostic=Object.freeze({phase,errorName:names.has(error?.name)?error.name:'UnknownError',errorCode:codes.has(error?.code)?error.code:null});
    throw wrapped;
  }
}
/** Read-only recovery. A consumed bridge credit cannot be reused: the protocol and FPC nullifiers enforce this. */
export async function recoverPrivateFeeClaim(input){
  try{
    const {node,ethProvider,owner,walletSecret,privateFeeArtifact,expectedChainId,expectedVersion}=input??{};
    check(input.record && [Object.prototype,null].includes(Object.getPrototypeOf(input.record)),'PRIVATE_FEE_RECOVERY_INVALID');
    const recordData={};for(const key of Reflect.ownKeys(input.record)){const d=Object.getOwnPropertyDescriptor(input.record,key);check(typeof key==='string' && d && 'value' in d,'PRIVATE_FEE_RECOVERY_INVALID');recordData[key]=d.value;}
    validRecord(recordData);check(recordData.txHash,'PRIVATE_FEE_RECOVERY_HASH_REQUIRED');
    const aggregateDescriptor=Object.getOwnPropertyDescriptor(input,'aggregateIntent');check(!aggregateDescriptor || 'value' in aggregateDescriptor,'PRIVATE_FEE_RECOVERY_INVALID');
    const record=Object.freeze({...recordData,chainId:uint(recordData.chainId,64).toString(),version:uint(recordData.version,32).toString(),
      rollupAddress:address(recordData.rollupAddress),portalAddress:address(recordData.portalAddress),tokenAddress:address(recordData.tokenAddress),
      privateFeeAddress:secretField(recordData.privateFeeAddress).toString(),sender:address(recordData.sender),nonce:uint(recordData.nonce,64).toString(),amount:uint(recordData.amount).toString(),
      ...(recordData.leafIndex===undefined?{}:{leafIndex:uint(recordData.leafIndex,254).toString()})}), aggregateIntent=captureAggregateFundingIntent(aggregateDescriptor?.value);
    const custodyDescriptor=Object.getOwnPropertyDescriptor(input,'aggregateCustody');check(!custodyDescriptor || 'value' in custodyDescriptor,'PRIVATE_FEE_RECOVERY_INVALID');
    const aggregateCustody=captureAggregateFundingCustody(custodyDescriptor?.value,aggregateIntent);
    const scope=await verifyScope({node,ethProvider,privateFeeArtifact,privateFeeAddress:record.privateFeeAddress,expectedChainId,expectedVersion});
    check(Object.entries(scope).every(([key,value])=>eq(value,record[key])),'PRIVATE_FEE_RECOVERY_SCOPE_MISMATCH');
    const retainedSalt=aggregateCustody ? Fr.fromString(aggregateCustody.privateFeeSalt) : null;
    const {salt,secret,secretHash}=aggregateCustody ? {salt:retainedSalt,secret:await derivePrivateFeeBridgeSecret({salt:retainedSalt,owner}),secretHash:await derivePrivateFeeBridgeSecretHash({salt:retainedSalt,owner})} : await claimSecrets({walletSecret,owner,record});
    const [receipt,transaction]=await Promise.all([ethProvider.getTransactionReceipt(record.txHash),ethProvider.getTransaction(record.txHash)]);
    check(receipt&&transaction,'PRIVATE_FEE_RECOVERY_PENDING');
    check(receipt.status===1,'PRIVATE_FEE_RECOVERY_REVERTED');
    const block=await ethProvider.getBlock(receipt.blockNumber);
    check(block&&eq(block.hash,receipt.blockHash),'PRIVATE_FEE_RECOVERY_REORG');
    const expectedData=portalAbi.encodeFunctionData('depositToAztecPublic',[scope.privateFeeAddress,uint(record.amount),secretHash.toString()]);
    const intent=aggregateIntent ?? {from:record.sender.toLowerCase(),to:scope.portalAddress.toLowerCase(),nonce:Number(uint(record.nonce,64)),
      chainId:scope.chainId,data:expectedData.toLowerCase(),value:'0',
      expected:{kind:'fee-deposit',recipient:scope.privateFeeAddress.toLowerCase(),amount:String(record.amount),secretHash:secretHash.toString().toLowerCase()}};
    if(aggregateIntent)check(aggregateIntent.from===record.sender.toLowerCase() && aggregateIntent.nonce===Number(uint(record.nonce,64)) && aggregateIntent.chainId===scope.chainId
      && aggregateIntent.expected.feePortal===scope.portalAddress.toLowerCase() && aggregateIntent.expected.privateFpc===scope.privateFeeAddress.toLowerCase()
      && (!aggregateIntent.txHash || aggregateIntent.txHash===record.txHash.toLowerCase()),'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');
    let verified;
    try { verified=await verifyEthereumIntentReceipt(ethProvider,intent,record.txHash.toLowerCase()); }
    catch { throw new PrivateFeeFundingError('PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'); }
    check(verified?.outcome==='success','PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');
    if(aggregateCustody)check(verified.event.beneficiary===aggregateCustody.beneficiary,'PRIVATE_FEE_RECOVERY_EVENT_MISMATCH');
    const event=aggregateIntent ? {key:verified.event.privateFee.messageKey,index:verified.event.privateFee.leafIndex} : verified.event;
    if(aggregateIntent)check(verified.event.privateFee.amount===String(record.amount) && verified.event.privateFee.secretHash===secretHash.toString(),'PRIVATE_FEE_RECOVERY_EVENT_MISMATCH');
    const leafIndex=new Fr(uint(event.index,254));
    check(record.leafIndex===undefined||uint(record.leafIndex,254)===leafIndex.toBigInt(),'PRIVATE_FEE_RECOVERY_EVENT_MISMATCH');
    return {amount:uint(record.amount),salt,secret,leafIndex,messageKey:event.key};
  }catch(error){if(error instanceof PrivateFeeFundingError)throw error;throw new PrivateFeeFundingError('PRIVATE_FEE_RECOVERY_FAILED');}
}

/** Check the protocol Fee Juice nullifier locally; never disclose the bridge secret. */
export async function isPrivateFeeClaimConsumed({node,claim}) {
  const inner=await computeFeeJuiceMessageNullifier(Fr.fromString(claim.messageKey),claim.secret);
  const nullifier=await siloNullifier(ProtocolContractAddress.FeeJuice,inner);
  const indices=await node.findLeavesIndexes('latest',MerkleTreeId.NULLIFIER_TREE,[nullifier]);
  check(Array.isArray(indices)&&indices.length===1,'PRIVATE_FEE_RECOVERY_FAILED');
  return indices[0]!==undefined;
}
