// Ethers ABI and actual Aztec hashes with explicit Ethereum/node doubles. No real funds or proofs.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Interface } from 'ethers';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { BarretenbergSync } from '@aztec/bb.js';
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
import { derivePrivateFeeAddress } from '../shared/private-fee-client.mjs';
import { fundPrivateFees,recoverPrivateFeeClaim } from '../shared/private-fee-funding.mjs';
const portal=new Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)',
  'function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash) returns(bytes32 key,uint256 index)','event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const token=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
const sender='0x0000000000000000000000000000000000000011',rollup='0x0000000000000000000000000000000000000012',portalAddress='0x0000000000000000000000000000000000000013',tokenAddress='0x0000000000000000000000000000000000000014';
const txHash='0x'+'55'.repeat(32),blockHash='0x'+'66'.repeat(32);
let artifact,privateFeeAddress;
before(async()=>{artifact=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url)));privateFeeAddress=await derivePrivateFeeAddress(artifact);});
after(async()=>{await BarretenbergSync.destroySingleton();});
function fixture(){
  const state={calls:[],saved:[],balance:5000n,allowance:0n,chain:1n,portalVersion:2n,nonce:7,receipt:null,transaction:null,sendError:false,saveError:false,blockHash};
  const provider={getNetwork:async()=>({chainId:state.chain}),getTransactionCount:async(_sender,tag)=>{assert.equal(tag,'pending');return state.staleNonce?state.nonce-1:state.nonce;},
    call:async({to,data})=>{const abi=to.toLowerCase()===tokenAddress?token:portal,parsed=abi.parseTransaction({data});
      const result={ROLLUP:rollup,UNDERLYING:tokenAddress,VERSION:state.portalVersion,L2_TOKEN_ADDRESS:ProtocolContractAddress.FeeJuice.toString(),balanceOf:state.balance,allowance:state.allowance}[parsed.name];
      return abi.encodeFunctionResult(parsed.name,[result]);},
    getTransactionReceipt:async()=>state.receipt,getTransaction:async()=>state.transaction,getBlock:async()=>({hash:state.blockHash})};
  const signer={provider,getAddress:async()=>sender,sendTransaction:async request=>{
    const abi=request.to.toLowerCase()===tokenAddress?token:portal,parsed=abi.parseTransaction(request);state.calls.push(parsed.name);
    if(parsed.name==='approve'){state.allowance=parsed.args[1];state.nonce++;return {nonce:state.nonce-1,wait:async()=>({status:1})};}
    assert.equal(state.saved.length,1,'public recovery must persist before deposit');assert.equal(request.nonce,state.nonce);
    if(state.sendError)throw Error('private RPC diagnostic');
    state.transaction={...request,hash:txHash,from:sender,chainId:state.chain};
    const event=portal.encodeEventLog(portal.getEvent('DepositToAztecPublic'),[parsed.args[0],parsed.args[1],parsed.args[2],'0x'+'77'.repeat(32),9n]);
    state.receipt={hash:txHash,status:1,blockNumber:30,blockHash,logs:[{address:portalAddress,...event}]};
    return {hash:txHash,wait:async()=>state.receipt};}};
  const node={getNodeInfo:async()=>({l1ChainId:1,rollupVersion:2,l1ContractAddresses:{rollupAddress:rollup,feeJuicePortalAddress:portalAddress,feeJuiceAddress:tokenAddress}})};
  const input={node,ethSigner:signer,owner:AztecAddress.fromFieldUnsafe(new Fr(42)),walletSecret:new Fr(123),privateFeeAddress,privateFeeArtifact:artifact,amount:'4000',expectedChainId:'1',expectedVersion:'2',saveRecovery:async record=>{if(state.saveError)throw Error('disk full');state.saved.push(record);}};
  const recover=(record)=>recoverPrivateFeeClaim({node,ethProvider:provider,owner:input.owner,walletSecret:input.walletSecret,privateFeeArtifact:artifact,record,expectedChainId:'1',expectedVersion:'2'});
  return {state,input,recover};
}
test('approve then persist nonce-bound public recovery before deposit; recover exact private claim',async()=>{
  const {state,input,recover}=fixture();const record=await fundPrivateFees(input);
  assert.deepEqual(state.calls,['approve','depositToAztecPublic']);assert.equal(record.nonce,'8');assert.equal(record.leafIndex,'9');assert.equal(state.saved.length,3);
  assert.equal(state.saved[0].txHash,undefined);assert.equal(state.saved[1].txHash,txHash);
  const serialized=JSON.stringify(record);assert(!serialized.includes('salt')&&!serialized.includes('secret')&&!serialized.includes(input.owner.toString()));
  const claim=await recover(record);assert.equal(claim.amount,4000n);assert.equal(claim.leafIndex.toBigInt(),9n);assert(!claim.salt.isZero()&&!claim.secret.isZero());
});
test('existing allowance avoids approval and uses pending sender nonce',async()=>{const f=fixture();f.state.allowance=5000n;const record=await fundPrivateFees(f.input);assert.equal(record.nonce,'7');assert.deepEqual(f.state.calls,['depositToAztecPublic']);});
test('save failure prevents deposit',async()=>{const f=fixture();f.state.saveError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_FAILED');assert.deepEqual(f.state.calls,['approve']);});
test('ambiguous send retains public recovery, never retries or leaks raw error',async()=>{const f=fixture();f.state.sendError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN'&&e.recoveryRecord.nonce==='8'&&!e.message.includes('diagnostic'));assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);});
test('rejects inadequate user token balance before approval',async()=>{const f=fixture();f.state.balance=2n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_TOKEN_BALANCE');assert.equal(f.state.calls.length,0);});
test('rejects wrong L1 network before any transaction',async()=>{const f=fixture();f.state.chain=9n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_CHAIN_MISMATCH');assert.equal(f.state.calls.length,0);});
test('rejects wrong portal version before any transaction',async()=>{const f=fixture();f.state.portalVersion=9n;await assert.rejects(()=>fundPrivateFees(f.input),e=>e.code==='PRIVATE_FEE_FUNDING_PORTAL_MISMATCH');assert.equal(f.state.calls.length,0);});
for(const [label,mutate,code] of [
  ['reorg',f=>{f.state.blockHash='0x'+'99'.repeat(32);},'PRIVATE_FEE_RECOVERY_REORG'],
  ['reverted',f=>{f.state.receipt.status=0;},'PRIVATE_FEE_RECOVERY_REVERTED'],
  ['wrong nonce',f=>{f.state.transaction.nonce++;},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['wrong sender',f=>{f.state.transaction.from=rollup;},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['wrong calldata',f=>{f.state.transaction.data='0x';},'PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH'],
  ['missing event',f=>{f.state.receipt.logs=[];},'PRIVATE_FEE_RECOVERY_EVENT_MISMATCH'],
  ['duplicate event',f=>{f.state.receipt.logs.push(f.state.receipt.logs[0]);},'PRIVATE_FEE_RECOVERY_EVENT_MISMATCH'],
])test(`recovery rejects ${label}`,async()=>{const f=fixture(),record=await fundPrivateFees(f.input);mutate(f);await assert.rejects(()=>f.recover(record),e=>e.code===code);assert.equal(f.state.calls.length,2);});
test('public record from another wallet cannot recover credit',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);f.input.walletSecret=new Fr(124);await assert.rejects(()=>f.recover(record),e=>e.code==='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');});
test('public record from another owner cannot recover credit',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);f.input.owner=AztecAddress.fromFieldUnsafe(new Fr(43));await assert.rejects(()=>f.recover(record),e=>e.code==='PRIVATE_FEE_RECOVERY_TRANSACTION_MISMATCH');});
test('recovery requires hash and trusted deployment scope',async()=>{const f=fixture(),record=await fundPrivateFees(f.input);await assert.rejects(()=>f.recover({...record,txHash:undefined}),e=>e.code==='PRIVATE_FEE_RECOVERY_HASH_REQUIRED');await assert.rejects(()=>f.recover({...record,rollupAddress:sender}),e=>e.code==='PRIVATE_FEE_RECOVERY_SCOPE_MISMATCH');});

test('confirmed approval nonce overrides stale Ethers pending cache',async()=>{const f=fixture();f.state.staleNonce=true;const record=await fundPrivateFees(f.input);assert.equal(record.nonce,'8');assert.deepEqual(f.state.calls,['approve','depositToAztecPublic']);});
test('failure diagnostics expose only finite phase and safe codes',async()=>{const f=fixture();f.state.sendError=true;await assert.rejects(()=>fundPrivateFees(f.input),e=>{assert.deepEqual(e.diagnostic,{phase:'submit-deposit',errorName:'Error',errorCode:null});assert(!JSON.stringify(e.diagnostic).includes('private'));return true;});});
