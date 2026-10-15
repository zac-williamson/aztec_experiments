import {createJournalBackup} from '../shared/journal-backup.mjs';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserJournalStorage} from '../shared/journal-indexeddb.mjs';
// Ethers ABI and actual Aztec hashes with explicit Ethereum/node doubles. No real funds or proofs.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Interface, AbiCoder, keccak256 } from 'ethers';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { BarretenbergSync } from '@aztec-foundation/bb.js';
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
import { derivePrivateFeeAddress,derivePrivateFeeInstance,derivePrivateFeeBridgeSecret,derivePrivateFeeBridgeSecretHash } from '../shared/private-fee-client.mjs';
import { fundPrivateFees,recoverPrivateFeeClaim,recoverPrivateFeeFunding,claimSecrets,captureAggregateFundingIntent,captureAggregateFundingCustody } from '../shared/private-fee-funding.mjs';
import {aggregateFundingAbi} from '../shared/rolling/aggregate-funding.mjs';
const portal=new Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)',
  'function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash) returns(bytes32 key,uint256 index)','event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const token=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
const sender='0x0000000000000000000000000000000000000011',rollup='0x0000000000000000000000000000000000000012',portalAddress='0x0000000000000000000000000000000000000013',tokenAddress='0x0000000000000000000000000000000000000014';
const txHash='0x'+'55'.repeat(32),blockHash='0x'+'66'.repeat(32);
let artifact,privateFeeAddress;
before(async()=>{artifact=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url)));privateFeeAddress=await derivePrivateFeeAddress(artifact);});
after(async()=>{await BarretenbergSync.destroySingleton();});
function fixture(){
  const state={calls:[],estimates:[],saved:[],balance:5000n,allowance:0n,chain:1n,portalVersion:2n,nonce:7,receipt:null,transaction:null,sendError:false,saveError:false,blockHash,height:10,blocks:new Map(),approvalReceipt:null,approvalTransaction:null};
  const approvalHash='0x'+'44'.repeat(32);
  const provider={getNetwork:async()=>({chainId:state.chain}),getTransactionCount:async(_sender,tag)=>{if(tag==='pending')return state.staleNonce&&state.approvalReceipt?state.nonce-1:state.nonce;assert(Number.isSafeInteger(tag)&&tag<=state.height);return 7+[...state.blocks].filter(([block])=>block<=tag).reduce((sum,[,txs])=>sum+txs.length,0);},
    estimateGas:async request=>{state.estimates.push({...request});return 100000n;},
    call:async({to,data})=>{const abi=to.toLowerCase()===tokenAddress?token:portal,parsed=abi.parseTransaction({data});
      const result={ROLLUP:rollup,UNDERLYING:tokenAddress,VERSION:state.portalVersion,L2_TOKEN_ADDRESS:ProtocolContractAddress.FeeJuice.toString(),balanceOf:state.balance,allowance:state.allowance}[parsed.name];
      return abi.encodeFunctionResult(parsed.name,[result]);},
    getBlockNumber:async()=>state.height,getTransactionReceipt:async hash=>hash===approvalHash?state.approvalReceipt:state.receipt,getTransaction:async hash=>hash===approvalHash?state.approvalTransaction:state.transaction,getBlock:async number=>({number:number==='latest'?state.height:number,hash:state.blockHash,parentHash:state.blockHash,prefetchedTransactions:state.blocks.get(number)||[]})};
  const signer={provider,getAddress:async()=>sender,sendTransaction:async request=>{
    const abi=request.to.toLowerCase()===tokenAddress?token:portal,parsed=abi.parseTransaction(request);state.calls.push(parsed.name);
    assert.equal(request.nonce,state.nonce,'signer must use the next unconsumed nonce');
    if(parsed.name==='approve'){
      assert.equal(request.gasLimit,undefined);
      state.allowance=parsed.args[1];state.nonce++;state.height++;
      state.approvalTransaction={...request,hash:approvalHash};state.blocks.set(state.height,[state.approvalTransaction]);
      const event=token.encodeEventLog(token.getEvent('Approval'),[sender,parsed.args[0],parsed.args[1]]);
      state.approvalReceipt={hash:approvalHash,from:sender,to:tokenAddress,status:1,blockNumber:state.height,blockHash,logs:[{address:tokenAddress,...event}]};
      if(state.lostApproval)throw Error('lost approval response');return state.approvalTransaction;
    }
    assert.equal(request.gasLimit,200000n,'V6 fee deposit must cover changing Inbox state');
    const {gasLimit,...estimatedIntent}=request;assert.deepEqual(estimatedIntent,state.estimates.at(-1));
    assert(state.saved.length>=1,'public recovery must persist before deposit');assert.equal(state.saved.at(-1).nonce,String(request.nonce));assert.equal(request.nonce,state.nonce);
    if(state.sendError)throw Error('private RPC diagnostic');
    state.transaction={...request,hash:txHash,from:sender,chainId:state.chain};
    const event=portal.encodeEventLog(portal.getEvent('DepositToAztecPublic'),[parsed.args[0],parsed.args[1],parsed.args[2],'0x'+'77'.repeat(32),9n]);
    state.height++;state.nonce++;state.blocks.set(state.height,[state.transaction]);
    state.receipt={hash:txHash,from:sender,to:portalAddress,status:1,blockNumber:state.height,blockHash,logs:[{address:portalAddress,...event}]};
    if(state.lostDeposit)throw Error('lost deposit response');return state.transaction;}};
  const node={getContract:async()=>derivePrivateFeeInstance(artifact),getNodeInfo:async()=>({l1ChainId:1,rollupVersion:2,l1ContractAddresses:{rollupAddress:rollup,feeJuicePortalAddress:portalAddress,feeJuiceAddress:tokenAddress}})};
  const input={journalStorage:createBrowserJournalStorage(new IDBFactory()),walletSalt:Fr.ZERO.toString(),node,ethProvider:provider,ethSigner:signer,owner:AztecAddress.fromFieldUnsafe(new Fr(42)),walletSecret:new Fr(123),privateFeeAddress,privateFeeArtifact:artifact,amount:'4000',expectedChainId:'1',expectedVersion:'2',saveRecovery:async record=>{if(state.saveError)throw Error('disk full');state.saved.push(record);}};
  const recover=(record)=>recoverPrivateFeeClaim({node,ethProvider:provider,owner:input.owner,walletSecret:input.walletSecret,privateFeeArtifact:artifact,record,expectedChainId:'1',expectedVersion:'2'});
  return {state,input,recover};
}
test('approve then persist nonce-bound public recovery before deposit; recover exact private claim',async()=>{
  const {state,input,recover}=fixture();const record=await fundPrivateFees(input);
  assert.deepEqual(state.calls,['approve','depositToAztecPublic']);assert.equal(record.nonce,'8');assert.equal(record.leafIndex,'9');assert.equal(state.saved.length,3);
  assert.equal(state.estimates.length,1);assert.equal(portal.parseTransaction(state.estimates[0]).name,'depositToAztecPublic');
  assert.equal(state.saved[0].txHash,undefined);assert.equal(state.saved[1].txHash,txHash);
  const serialized=JSON.stringify(record);assert(!serialized.includes('salt')&&!serialized.includes('secret')&&!serialized.includes(input.owner.toString()));
  const claim=await recover(record);assert.equal(claim.amount,4000n);assert.equal(claim.leafIndex.toBigInt(),9n);assert(!claim.salt.isZero()&&!claim.secret.isZero());
});
test('existing allowance avoids approval and uses pending sender nonce',async()=>{const f=fixture();f.state.allowance=5000n;const record=await fundPrivateFees(f.input);assert.equal(record.nonce,'7');assert.deepEqual(f.state.calls,['depositToAztecPublic']);});
test('save failure prevents deposit',async()=>{const f=fixture();f.state.saveError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_FAILED');assert.deepEqual(f.state.calls,['approve']);});
test('ambiguous send retains public recovery, never retries or leaks raw error',async()=>{const f=fixture();f.state.sendError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='BB_ETH_SUBMISSION_UNKNOWN'&&e.recoveryRecord.nonce==='8'&&!e.message.includes('diagnostic'));assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);});
test('rejects inadequate user token balance before approval',async()=>{const f=fixture();f.state.balance=2n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_TOKEN_BALANCE');assert.equal(f.state.calls.length,0);});
test('rejects wrong L1 network before any transaction',async()=>{const f=fixture();f.state.chain=9n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_CHAIN_MISMATCH');assert.equal(f.state.calls.length,0);});
test('rejects wrong portal version before any transaction',async()=>{const f=fixture();f.state.portalVersion=9n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_PORTAL_MISMATCH');assert.equal(f.state.calls.length,0);});
for(const [label,mutate,code] of [
  ['reorg',f=>{f.state.blockHash='0x'+'99'.repeat(32);},'PRIVATE_FEE_RECOVERY_REORG'],
  ['reverted',f=>{f.state.receipt.status=0;},'PRIVATE_FEE_RECOVERY_REVERTED'],
  ['wrong nonce',f=>{f.state.transaction.nonce++;},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['wrong sender',f=>{f.state.transaction.from=rollup;},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['wrong calldata without effect',f=>{f.state.transaction.data='0x';f.state.receipt.logs=[];},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['missing event',f=>{f.state.receipt.logs=[];},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['duplicate event',f=>{f.state.receipt.logs.push(f.state.receipt.logs[0]);},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
])test(`recovery rejects ${label}`,async()=>{const f=fixture(),record=await fundPrivateFees(f.input);mutate(f);await assert.rejects(()=>f.recover(record),e=>e.code===code);assert.equal(f.state.calls.length,2);});
test('public record from another wallet cannot recover credit',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);f.input.walletSecret=new Fr(124);await assert.rejects(()=>f.recover(record),e=>e.code==='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');});
test('public record from another owner cannot recover credit',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);f.input.owner=AztecAddress.fromFieldUnsafe(new Fr(43));await assert.rejects(()=>f.recover(record),e=>e.code==='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');});
test('recovery requires hash and trusted deployment scope',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);await assert.rejects(()=>f.recover({...record,txHash:undefined}),e=>e.code==='PRIVATE_FEE_RECOVERY_HASH_REQUIRED');await assert.rejects(()=>f.recover({...record,rollupAddress:sender}),e=>e.code==='PRIVATE_FEE_RECOVERY_SCOPE_MISMATCH');});

test('confirmed approval nonce overrides stale Ethers pending cache',async()=>{const f=fixture();f.state.staleNonce=true;const record=await fundPrivateFees(f.input);assert.equal(record.nonce,'8');assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);});
test('failure diagnostics expose only finite phase and safe codes',async()=>{const f=fixture();f.state.sendError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>{assert.deepEqual(e.diagnostic,{phase:'submit-deposit',errorName:'Error',errorCode:null});assert(!JSON.stringify(e.diagnostic).includes('private'));return true;});});

test('lost approval response is recovered by sender nonce and never silently approved twice',async()=>{
 const f=fixture();f.state.lostApproval=true;
 await assert.rejects(fundPrivateFees(f.input),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.deepEqual(f.state.calls,['approve']);
 await assert.rejects(fundPrivateFees(f.input),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(f.state.calls.length,1);
 const recovered=await recoverPrivateFeeFunding(f.input);assert.equal(recovered.outcome,'approved');assert.equal(f.state.calls.length,1);
 f.input.acknowledgeEthereumTx=recovered.lastEthereumTxHash;f.state.lostApproval=false;
 assert.equal((await fundPrivateFees(f.input)).nonce,'8');assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);
});
test('lost bridge-deposit response recovers exact funding provenance without an unstored hash or another payment',async()=>{
 const f=fixture();f.state.lostDeposit=true;
 await assert.rejects(fundPrivateFees(f.input),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.equal(f.state.saved.at(-1).txHash,undefined);
 const recovered=await recoverPrivateFeeFunding(f.input);assert.equal(recovered.outcome,'funded');assert.equal(recovered.record.txHash,txHash);assert.equal(recovered.record.nonce,'8');assert.equal(recovered.record.leafIndex,'9');
 const again=await recoverPrivateFeeFunding({...f.input,retry:true});assert.deepEqual(again,recovered);assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);
});
test('missing durable fee journal prevents token approval',async()=>{
 const f=fixture();delete f.input.journalStorage;await assert.rejects(fundPrivateFees(f.input),{code:'BB_JOURNAL_INVALID'});assert.equal(f.state.calls.length,0);
});

test('portable journal alone restores private-fee funding provenance in a fresh store',async()=>{
 const f=fixture(),funded=await fundPrivateFees(f.input);
 const credentials={walletSecret:f.input.walletSecret.toString(),walletSalt:f.input.walletSalt};
 const records=await (await createJournalBackup({...credentials,storage:f.input.journalStorage})).exportRecords();
 const fresh=createBrowserJournalStorage(new IDBFactory());await (await createJournalBackup({...credentials,storage:fresh})).restoreRecords(records);
 const result=await recoverPrivateFeeFunding({...f.input,journalStorage:fresh});assert.equal(result.outcome,'funded');assert.deepEqual(result.record,funded);assert.equal(f.state.calls.length,2);
});

test('wallet acknowledgement without chain metadata is verified against configured RPC',async()=>{
 const f=fixture(),send=f.input.ethSigner.sendTransaction;
 f.input.ethProvider=f.input.ethSigner.provider;
 f.input.ethSigner.sendTransaction=async request=>({...await send(request),chainId:null});
 const record=await fundPrivateFees(f.input);assert.equal(record.nonce,'8');assert.equal((await f.recover(record)).amount,4000n);
});

test('configured RPC owns reads; signer provider only verifies signing network',async()=>{
 const f=fixture();f.input.ethSigner.provider={getNetwork:async()=>({chainId:1n}),call:async()=>{throw Error('Wallet reads forbidden');},getTransaction:async()=>{throw Error('Wallet reads forbidden');}};
 const record=await fundPrivateFees(f.input);assert.equal((await f.recover(record)).amount,4000n);
});
test('explicit read provider is required instead of wallet-provider fallback',async()=>{
 const f=fixture();delete f.input.ethProvider;await assert.rejects(fundPrivateFees(f.input),{code:'PRIVATE_FEE_FUNDING_PROVIDER_REQUIRED'});assert.equal(f.state.calls.length,0);
});
test('wrong signer network cannot approve on an otherwise correct read network',async()=>{
 const f=fixture();f.input.ethSigner.provider={getNetwork:async()=>({chainId:2n})};await assert.rejects(fundPrivateFees(f.input),{code:'PRIVATE_FEE_FUNDING_CHAIN_MISMATCH'});assert.equal(f.state.calls.length,0);
});

test('unpublished fee contract prevents approvals and deposits',async()=>{
 const f=fixture();f.input.node.getContract=async()=>undefined;
 await assert.rejects(fundPrivateFees(f.input));assert.deepEqual(f.state.calls,[]);assert.deepEqual(f.state.saved,[]);
});

for(const lost of [false,true])test(`wallet execution envelope funds and recovers exact fee credit (lost response: ${lost})`,async()=>{
 const f=fixture(),send=f.input.ethSigner.sendTransaction;
 f.input.ethSigner.sendTransaction=async request=>{
  const tx=await send(request),receipt=request.to===tokenAddress?f.state.approvalReceipt:f.state.receipt;
  tx.to=rollup;tx.data='0xcef6d209';receipt.to=tx.to;
  if(lost&&request.to===portalAddress)throw Error('lost response');
  return tx;
 };
 let record;
 if(lost){await assert.rejects(fundPrivateFees(f.input),{code:'BB_ETH_SUBMISSION_UNKNOWN'});record=(await recoverPrivateFeeFunding(f.input)).record;}
 else record=await fundPrivateFees(f.input);
 assert.equal((await f.recover(record)).amount,4000n);
 assert.equal((await recoverPrivateFeeFunding(f.input)).outcome,'funded');
 assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);
});
for(const change of ['emitter','recipient','amount','secret','duplicate','sender','nonce','chain','reverted','reorg'])test(`wrapped fee deposit rejects ${change}`,async()=>{
 const f=fixture(),record=await fundPrivateFees(f.input),tx=f.state.transaction,receipt=f.state.receipt;
 tx.to=rollup;tx.data='0xcef6d209';receipt.to=tx.to;
 if(change==='emitter')receipt.logs[0].address=tokenAddress;
 if(change==='duplicate')receipt.logs.push(receipt.logs[0]);
 if(change==='sender')tx.from=rollup;
 if(change==='nonce')tx.nonce++;
 if(change==='chain')tx.chainId=2n;
 if(change==='reverted')receipt.status=0;
 if(change==='reorg')f.state.blockHash='0x'+'99'.repeat(32);
 if(['recipient','amount','secret'].includes(change)){
  const a=portal.parseLog(receipt.logs[0]).args;
  receipt.logs=[{address:portalAddress,...portal.encodeEventLog(portal.getEvent('DepositToAztecPublic'),[change==='recipient'?Fr.ZERO.toString():a.to,change==='amount'?4001:a.amount,change==='secret'?Fr.ZERO.toString():a.secretHash,a.key,a.index])}];
 }
 await assert.rejects(f.recover(record));assert.equal(f.state.calls.length,2);
});

async function aggregateClaimFixture(){
 const f=fixture(),record={schema:'private-fee-funding-v1',chainId:'1',version:'2',rollupAddress:rollup,portalAddress,tokenAddress,privateFeeAddress:privateFeeAddress.toString(),sender,nonce:'7',amount:'4000',txHash,leafIndex:'9'};
 const secrets=await claimSecrets({walletSecret:f.input.walletSecret,owner:f.input.owner,record});
 const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
 const router=new Interface(aggregateFundingAbi),board=new Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']),bok=new Interface(['event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
 const plan={beneficiary:sender,collateral:100n,collateralSecretHash:h(101),fee:{amount:4000n,maxEth:200n,poolFee:3000},feeSecretHash:secrets.secretHash.toString(),bok:{amount:300n,maxEth:300n,poolFee:500},bokCommitment:h(102),bokSecretHash:h(103),nonce:99n,deadline:2000000000n};
 const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([router.getFunction('fund').inputs[0]],[plan]));
 const intent={from:sender,to:a(80),nonce:7,chainId:'1',data:router.encodeFunctionData('fund',[plan,'0x1234']).toLowerCase(),value:'600',txHash,
  expected:{kind:'aggregate-funding',routerCodeHash:keccak256('0x6000'),collateralPortal:a(81),feePortal:portalAddress,bokPortal:a(82),privateFpc:privateFeeAddress.toString(),planHash}};
 const log=(address,abi,name,args)=>({address,...abi.encodeEventLog(abi.getEvent(name),args)});
 f.state.transaction={...intent,hash:txHash,value:600n};f.state.receipt={hash:txHash,from:sender,to:a(80),status:1,blockNumber:10,blockHash,logs:[
 log(a(80),router,'Funded',[sender,planHash,100,4000,300,150,200,150]),log(a(81),board,'Deposited',[sender,100,h(101),h(111),8]),
 log(portalAddress,portal,'DepositToAztecPublic',[privateFeeAddress.toString(),4000,secrets.secretHash.toString(),h(112),9]),log(a(82),bok,'Deposited',[h(102),300,h(113),10]) ]};
 f.input.ethProvider.getCode=async()=> '0x6000';
 const recover=()=>recoverPrivateFeeClaim({node:f.input.node,ethProvider:f.input.ethProvider,owner:f.input.owner,walletSecret:f.input.walletSecret,privateFeeArtifact:artifact,record,aggregateIntent:intent,expectedChainId:'1',expectedVersion:'2'});
 return {...f,record,intent,recover,secrets};
}
test('aggregate FPC recovers original deterministic secrets without approval or deposit calls',async()=>{const f=await aggregateClaimFixture(),claim=await f.recover();assert.equal(claim.secret.toString(),f.secrets.secret.toString());assert.equal(claim.salt.toString(),f.secrets.salt.toString());assert.equal(claim.amount,4000n);assert.equal(claim.leafIndex.toBigInt(),9n);assert.equal(f.state.calls.length,0);const changed=await claimSecrets({walletSecret:f.input.walletSecret,owner:f.input.owner,record:{...f.record,nonce:'99'}});assert.notEqual(changed.secretHash.toString(),f.secrets.secretHash.toString(),'L1 nonce must not be confused with portal consent nonce');});
for(const [name,mutate] of [
 ['another owner',f=>{f.input.owner=AztecAddress.fromFieldUnsafe(new Fr(99));}],
 ['changed router code',f=>{f.input.ethProvider.getCode=async()=> '0x6001';}],
 ['missing other allocation',f=>{f.state.receipt.logs.pop();}],
 ['mismatched public amount',f=>{f.record.amount='4001';}],
 ['changed retained tx hash',f=>{f.intent.txHash='0x'+'88'.repeat(32);}],
 ['wrong scoped FPC',f=>{f.intent.expected.privateFpc=new Fr(99).toString();}],
 ['wrong Ethereum nonce',f=>{f.intent.nonce=99;}],
])test(`aggregate FPC rejects ${name} without sending`,async()=>{const f=await aggregateClaimFixture();mutate(f);await assert.rejects(f.recover());assert.equal(f.state.calls.length,0);});
test('aggregate original intent descriptor capture never calls hostile getters',()=>{let calls=0;const intent={};Object.defineProperty(intent,'from',{get(){calls++;throw Error('PRIVATE_SENTINEL');}});assert.throws(()=>captureAggregateFundingIntent(intent),{code:'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'});assert.equal(calls,0);});

async function usdcPrivateFeeFixture(){
 const f=await aggregateClaimFixture(),router=new Interface(aggregateFundingAbi),h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
 const old=router.parseTransaction({data:f.intent.data}).args[0],salt=new Fr(703),owner=f.input.owner;
 const secret=await derivePrivateFeeBridgeSecret({salt,owner}),secretHash=await derivePrivateFeeBridgeSecretHash({salt,owner});
 const plan={beneficiary:sender,relayer:a(70),collateral:{amount:100n,maxUsdc:200n,poolFee:500},collateralSecretHash:old.collateralSecretHash,
  fee:{amount:4000n,maxUsdc:300n,poolFee:3000},feeSecretHash:secretHash.toString(),bokAmount:300n,bokCommitment:old.bokCommitment,bokSecretHash:old.bokSecretHash,
  nonce:99n,validAfter:0n,deadline:2000000000n,relayFeeUsdc:10n,authorizationSalt:h(704)};
 const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([router.getFunction('fundUsdc').inputs[0]],[plan]));
 Object.assign(f.intent,{from:a(70),nonce:71,value:'0',data:router.encodeFunctionData('fundUsdc',[plan,'0x1234','0x5678']).toLowerCase()});Object.assign(f.intent.expected,{kind:'aggregate-usdc-funding',planHash});
 Object.assign(f.record,{sender:a(70),nonce:'71'});Object.assign(f.state.transaction,{...f.intent,value:0n});f.state.receipt.from=a(70);
 f.state.receipt.logs[0]={address:f.intent.to,...router.encodeEventLog(router.getEvent('UsdcFunded'),[sender,planHash,a(70),100,4000,300,150,200,10,150])};
 f.state.receipt.logs[2]={address:portalAddress,...portal.encodeEventLog(portal.getEvent('DepositToAztecPublic'),[privateFeeAddress.toString(),4000,secretHash.toString(),h(112),9])};
 const input={node:f.input.node,ethProvider:f.input.ethProvider,owner,walletSecret:f.input.walletSecret,privateFeeArtifact:artifact,record:f.record,aggregateIntent:f.intent,
  aggregateCustody:{kind:'aggregate-usdc-custody-v1',planHash,beneficiary:sender,privateFeeSalt:salt.toString()},expectedChainId:'1',expectedVersion:'2'};
 return {...f,input,salt,secret,secretHash,recover:()=>recoverPrivateFeeClaim(input)};
}
test('USDC FPC recovers saved random salt independently of relayer or consent nonce',async()=>{
 const f=await usdcPrivateFeeFixture(),claim=await f.recover();assert.equal(claim.salt.toString(),f.salt.toString());assert.equal(claim.secret.toString(),f.secret.toString());assert.equal(f.record.sender,'0x0000000000000000000000000000000000000046');assert.equal(f.record.nonce,'71');assert.equal(f.state.calls.length,0);
 const deterministic=await claimSecrets({walletSecret:f.input.walletSecret,owner:f.input.owner,record:f.record});assert.notEqual(deterministic.secretHash.toString(),f.secretHash.toString());
});
for(const [label,mutate] of [
 ['missing custody',f=>delete f.input.aggregateCustody],
 ['changed salt',f=>{f.input.aggregateCustody.privateFeeSalt=new Fr(999).toString();}],
 ['changed beneficiary',f=>{f.input.aggregateCustody.beneficiary=f.record.sender;}],
 ['changed plan binding',f=>{f.input.aggregateCustody.planHash='0x'+'88'.repeat(32);}],
 ['changed owner',f=>{f.input.owner=AztecAddress.fromFieldUnsafe(new Fr(999));}],
 ['changed actual transaction nonce',f=>{f.record.nonce='99';}],
 ['unpublished FPC',f=>{f.input.node.getContract=async()=>null;}],
])test(`USDC FPC rejects ${label} without any send`,async()=>{const f=await usdcPrivateFeeFixture();mutate(f);await assert.rejects(f.recover());assert.equal(f.state.calls.length,0);});
test('USDC private custody descriptor grammar is closed and does not invoke getters',async()=>{
 const f=await usdcPrivateFeeFixture();let touched=0;Object.defineProperty(f.input.aggregateCustody,'privateFeeSalt',{get(){touched++;throw Error('PRIVATE_SENTINEL');}});assert.throws(()=>captureAggregateFundingCustody(f.input.aggregateCustody,captureAggregateFundingIntent(f.intent)));assert.equal(touched,0);
 const g=await usdcPrivateFeeFixture();g.input.aggregateCustody.extra='PRIVATE_SENTINEL';await assert.rejects(g.recover());
 const e=await aggregateClaimFixture();assert.throws(()=>captureAggregateFundingCustody({kind:'aggregate-usdc-custody-v1'},captureAggregateFundingIntent(e.intent)));
});
