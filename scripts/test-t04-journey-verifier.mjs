import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Fr} from '@aztec/foundation/curves/bn254';
import {Interface} from 'ethers';
import {parseAbi} from 'viem';
import {journeyExitLeaf,assertJourneyExit,verifyJourneyRefund} from './t04-browser-journey-verify.mjs';

const vectors=JSON.parse(await readFile(new URL('../execution/interface-fixtures/commitments-v1.json',import.meta.url),'utf8'));
const vector=vectors.cases.find(v=>v.name==='exit');
const input={scope:vector.input.scope,...vector.input.receipt};
const fieldHash=bytes=>'0x00'+createHash('sha256').update(bytes).digest('hex').slice(0,62);
const word=value=>Buffer.from(BigInt(value).toString(16).padStart(64,'0'),'hex');

test('actual journey exit helper matches frozen Solidity commitment and independently serialized message leaf',async()=>{
 const solidity=await readFile(new URL('../billboard/portal/test/PortalCodecVectors.t.sol',import.meta.url),'utf8');
 assert(solidity.includes(vector.commitment),'Frozen expected commitment must remain exercised by Solidity');
 const result=journeyExitLeaf(input);
 assert(result.content instanceof Fr);assert(result.leaf instanceof Fr);
 assert.equal(result.content.toString(),vector.commitment);
 assert.equal(result.content.toString(),fieldHash(Buffer.from(vector.preimage.slice(2),'hex')));
 // Pinned message hash uses packed sender32/version32/recipient20/chain32/content32.
 const packed=Buffer.concat([word(input.scope.boardAddress),word(input.scope.rollupVersion),Buffer.from(input.scope.portalAddress.slice(2),'hex'),word(input.scope.l1ChainId),Buffer.from(vector.commitment.slice(2),'hex')]);
 assert.equal(packed.length,148);assert.equal(result.leaf.toString(),fieldHash(packed));
});

test('exit helper binds receipt and domain inputs and rejects malformed/out-of-range shapes',()=>{
 const baseline=journeyExitLeaf(input).leaf;
 for(const changed of [{...input,depositNonce:'2'},{...input,amount:'1000000000000001'},{...input,scope:{...input.scope,l1ChainId:'31338'}},{...input,scope:{...input.scope,rollupVersion:'2'}}])assert(!journeyExitLeaf(changed).leaf.equals(baseline));
 for(const changed of [{...input,depositNonce:'0'},{...input,amount:'0'},{...input,depositNonce:String(1n<<64n)},{...input,scope:{...input.scope,boardAddress:'0x02'}}])assert.throws(()=>journeyExitLeaf(changed));
});

test('actual exit assertion rejects duplicate/missing leaves, wrong spent note and premature anchor',()=>{
 const {leaf}=journeyExitLeaf(input),spent=new Fr(9);
 const args={effect:{l2ToL1Msgs:[leaf],nullifiers:[spent]},leaf,consumedNullifier:spent,anchorTimestamp:10n,nextAllowedTime:10n};
 assert.doesNotThrow(()=>assertJourneyExit(args));
 for(const effect of [{l2ToL1Msgs:[],nullifiers:[spent]},{l2ToL1Msgs:[leaf,leaf],nullifiers:[spent]},{l2ToL1Msgs:[leaf],nullifiers:[new Fr(10)]},{l2ToL1Msgs:[leaf],nullifiers:[spent,spent]}])assert.throws(()=>assertJourneyExit({...args,effect}));
 assert.throws(()=>assertJourneyExit({...args,anchorTimestamp:9n}));
});

test('actual refund verifier decodes a real ABI event and rejects wrong receipt identity/accounting',async()=>{
 const declaration='event Withdrawn(address indexed depositor,uint64 nonce,uint128 amount)';
 const portalAbi=parseAbi([declaration,'function getDeposit(address) view returns (uint64,uint128)','function totalDeposited() view returns (uint256)']);
 const iface=new Interface([declaration]),portalAddress=input.scope.portalAddress,depositor=input.depositor;
 const txHash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32),amount=BigInt(input.amount),depositNonce=1n;
 const before={liability:amount*3n,portalBalance:amount*3n,depositorBalance:amount*5n};
 async function run(mutation={}){
  const event=iface.encodeEventLog(iface.getEvent('Withdrawn'),[depositor,mutation.nonce??depositNonce,mutation.amount??amount]);
  const l1Client={
   getTransactionReceipt:async args=>{assert.deepEqual(args,{hash:txHash});return{status:'success',to:portalAddress,from:depositor,blockNumber:12n,blockHash,logs:[{address:portalAddress,...event}],gasUsed:21000n,effectiveGasPrice:2n};},
   getBlock:async args=>{assert.deepEqual(args,{blockNumber:12n});return{hash:mutation.blockHash??blockHash};},
   readContract:async args=>{assert.equal(args.address,portalAddress);assert.equal(args.abi,portalAbi);if(args.functionName==='getDeposit'){assert.deepEqual(args.args,[depositor]);return[0n,0n];}assert.equal(args.functionName,'totalDeposited');assert.deepEqual(args.args,[]);return before.liability-amount;},
   getBalance:async({address})=>{assert([portalAddress,depositor].includes(address));return address===portalAddress?before.portalBalance-amount:before.depositorBalance+amount-42000n;},
  };
  return verifyJourneyRefund({l1Client,portalAbi,portalAddress,depositor,depositNonce,amount,txHash,before});
 }
 assert.deepEqual(await run(),{passed:true,txHash,amount:String(amount),nonce:'1',gasWei:'42000'});
 for(const mutation of [{nonce:2n},{amount:amount+1n},{blockHash:'0x'+'ef'.repeat(32)}])await assert.rejects(run(mutation));
});
