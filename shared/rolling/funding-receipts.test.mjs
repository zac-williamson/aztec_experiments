// Labelled RPC doubles; actual pinned ABI decoding, SDK hashes, 36-level Merkle
// paths, deterministic FPC artifact and custody helpers. No funds, proofs or services.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AbiCoder,Interface,encodeBytes32String,getBytes,keccak256} from 'ethers';
import {BlockHeader} from '@aztec-labs/stdlib/tx';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {L1ContractsNames} from '@aztec-labs/ethereum/l1-contract-addresses';
import {createTrustedPrivateNode,isTrustedPrivateNode} from '../trusted-private-node.mjs';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {BlockHash,BlockParameterSchema} from '@aztec-labs/stdlib/block';
import {L1Actor,L2Actor,L1ToL2Message} from '@aztec-labs/stdlib/messaging';
import {SiblingPath} from '@aztec-labs/foundation/trees';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {computeSecretHash} from '@aztec-labs/stdlib/hash';
import {DomainSeparator,L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec-labs/constants';
import {ProtocolContractAddress} from '@aztec-labs/protocol-contracts';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {deriveBoardDepositSecret} from '../deposit-custody.mjs';
import {derivePrivateFeeInstance,derivePrivateFeeBridgeSecret} from '../private-fee-client.mjs';
import {sha256Field} from '../protocol-commitments.mjs';
import {aggregateFundingAbi} from './aggregate-funding.mjs';
import {prepareFundingClaim} from './funding-receipts.mjs';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const common=['function ROLLUP() view returns(address)','function VERSION() view returns(uint256)'];
const boardAbi=new Interface([...common,'function L1_CHAIN_ID() view returns(uint256)','function L2_CONTRACT() view returns(bytes32)','function deposit(bytes32 secretHash) payable','event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const feeAbi=new Interface([...common,'function UNDERLYING() view returns(address)','function L2_TOKEN_ADDRESS() view returns(bytes32)','function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash)','event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
const bokAbi=new Interface(['function token() view returns(address)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function deposit(bytes32 account,uint128 amount,bytes32 secretHash)','event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
const rollupAbi=new Interface(['function getInbox() view returns(address)','function getOutbox() view returns(address)']);
let artifact,canonical,originalFetch;
const transports=new Map();let transportId=0;
before(()=>{originalFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{
 const transport=transports.get(String(url));assert(transport,'Only labelled fixture transport is permitted');
 const result=await Promise.all(JSON.parse(init.body).map(async request=>{
  const name=request.method.replace(/^aztec_/,'');let params=request.params;
  if(name==='getL1ToL2MessageMembershipWitness')params=[BlockParameterSchema.parse(params[0]),Fr.fromString(params[1])];
  return {id:request.id,jsonrpc:'2.0',result:await transport[name](...params)};
 }));return new Response(jsonStringify(result),{headers:{'content-type':'application/json'}});
};});
after(()=>{globalThis.fetch=originalFetch;});
before(async()=>{artifact=JSON.parse(fs.readFileSync(new URL('../../apps/src/billboard/private_fee_artifact.json',import.meta.url)));canonical=await derivePrivateFeeInstance(artifact);});
after(async()=>{await BarretenbergSync.destroySingleton();});
async function fixture(kind='collateral',retainedFeeSalt=null,feeMessageMode='canonical') {
 const s={chainId:'31337',version:'2',rollup:addr(10),portal:addr(11),recipient:kind==='private-fee'?canonical.address.toString():h(12),...(kind==='collateral'?{}:{token:addr(13)})};
 const r={txHash:h(100),blockHash:h(101),blockNumber:6,sender:addr(14),nonce:'3',amount:'5000',leafIndex:'9',messageKey:null,secretHash:null};
 const owner=h(20),walletSecret=h(21),walletSalt=h(22),salt=h(23);let secret,content,account,secrets;
 if(kind==='collateral') {
  secrets={walletSecret,walletSalt};const derived=await deriveBoardDepositSecret({...secrets,owner,nonce:r.nonce,scope:{l1ChainId:s.chainId,rollupVersion:s.version,rollupAddress:s.rollup,boardAddress:s.recipient,portalAddress:s.portal,depositor:r.sender}});secret=derived.secret;
  content=await sha256Field(getBytes(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','uint256','address','bytes32','uint256','address','uint256'],[encodeBytes32String('AZTEC_BB_CLAIM_V1'),1,s.chainId,s.portal,s.recipient,s.version,r.sender,r.amount])));
 } else if(kind==='private-fee') {
  secrets={walletSecret};const derivedSalt=retainedFeeSalt ? Fr.fromString(retainedFeeSalt) : await poseidon2HashWithSeparator([Fr.fromString(walletSecret),new Fr(BigInt(s.chainId)),new Fr(BigInt(s.version)),Fr.fromString(s.recipient),new Fr(BigInt(r.sender)),new Fr(BigInt(r.nonce))],0x42424601);
  secret=(await derivePrivateFeeBridgeSecret({salt:derivedSalt,owner})).toString();
  content=await sha256Field(getBytes(new Interface(['function claim(bytes32,uint256)']).encodeFunctionData('claim',[s.recipient,r.amount])));
 } else {
  secrets={recipientSalt:salt,bridgeSecret:h(24)};secret=secrets.bridgeSecret;
  account=(await poseidon2HashWithSeparator([new Fr(BigInt(s.chainId)),new Fr(BigInt(s.portal)),Fr.fromString(s.recipient),new Fr(BigInt(s.version)),Fr.fromString(owner),Fr.fromString(salt)],0x424b4301)).toString();
  content=await sha256Field(getBytes(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32','uint256','bytes32','uint128'],[encodeBytes32String('PLUGIN_CREDIT_V1'),s.chainId,s.portal,s.recipient,s.version,account,r.amount])));
 }
 r.secretHash=(await computeSecretHash(Fr.fromString(secret))).toString();
 // Installed Inbox.sol maps only the authenticated fee asset portal to L1 sender 0x03.
 if(kind==='private-fee'&&feeMessageMode==='wrong-content')content=h(404);
 const messageSender=kind==='private-fee'&&feeMessageMode!=='portal-sender'?addr(3):s.portal;
 const message=new L1ToL2Message(new L1Actor(EthAddress.fromString(messageSender),Number(s.chainId)),new L2Actor(new AztecAddress(Fr.fromString(kind==='private-fee'?ProtocolContractAddress.FeeJuice.toString():s.recipient)),Number(s.version)),Fr.fromString(content),Fr.fromString(r.secretHash),new Fr(BigInt(r.leafIndex)));
 r.messageKey=message.hash().toString();
 const siblings=Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},(_,i)=>new Fr(BigInt(200+i)));
 let root=message.hash(),cursor=BigInt(r.leafIndex);
 for(const sibling of siblings){root=await poseidon2HashWithSeparator(cursor&1n?[sibling,root]:[root,sibling],DomainSeparator.MERKLE_HASH);cursor>>=1n;}
 const anchor={number:3,hash:h(300),root:root.toString()};
 const abi=kind==='collateral'?boardAbi:kind==='private-fee'?feeAbi:bokAbi;
 const args=kind==='collateral'?[r.secretHash]:kind==='private-fee'?[s.recipient,r.amount,r.secretHash]:[account,r.amount,r.secretHash];
 const eventArgs=kind==='collateral'?[r.sender,r.amount,r.secretHash,r.messageKey,r.leafIndex]:kind==='private-fee'?[s.recipient,r.amount,r.secretHash,r.messageKey,r.leafIndex]:[account,r.amount,r.messageKey,r.leafIndex];
 const eventName=kind==='private-fee'?'DepositToAztecPublic':'Deposited';
 const event=abi.encodeEventLog(abi.getEvent(eventName),eventArgs);
 const state={reads:[],guardCalls:0,receipt:{hash:r.txHash,blockHash:r.blockHash,blockNumber:r.blockNumber,from:r.sender,to:s.portal,status:1,logs:[{address:s.portal,...event}]},
  tx:{hash:r.txHash,from:r.sender,to:s.portal,chainId:BigInt(s.chainId),nonce:Number(r.nonce),value:kind==='collateral'?BigInt(r.amount):0n,data:abi.encodeFunctionData(kind==='private-fee'?'depositToAztecPublic':'deposit',args)},
  blockHash:r.blockHash,finalized:{number:8,hash:h(102)},l2Hash:anchor.hash,root:anchor.root,witness:[BigInt(r.leafIndex),new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,siblings.map(x=>x.toBuffer()))],
  bindings:{ROLLUP:s.rollup,VERSION:2n,L1_CHAIN_ID:31337n,L2_CONTRACT:s.recipient,UNDERLYING:s.token,L2_TOKEN_ADDRESS:ProtocolContractAddress.FeeJuice.toString(),token:s.token,escrow:s.recipient,version:2n,chainId:31337n,inbox:addr(40),outbox:addr(41),getInbox:addr(40),getOutbox:addr(41)}};
 const node={getNodeInfo:async()=>({nodeVersion:'6.0.0-rc.1',l1ChainId:31337,rollupVersion:2,realProofs:true,
  l1ContractAddresses:{...Object.fromEntries(L1ContractsNames.map(name=>[name,s.rollup])),rollupAddress:s.rollup,feeJuicePortalAddress:s.portal,feeJuiceAddress:s.token??addr(13)},
  protocolContractAddresses:Object.fromEntries(['classRegistry','feeJuice','instanceRegistry','multiCallEntrypoint'].map(name=>[name,h(1)])),txsLimits:{gas:{daGas:100,l2Gas:100}}}),
  getChainTips:async()=>{const block={number:3,hash:anchor.hash},tip={block,checkpoint:{number:1,hash:h(300)}};return {proposed:block,checkpointed:tip,proven:tip,finalized:tip};},
  getWorldStateSyncStatus:async()=>({latestBlockNumber:3,latestBlockHash:anchor.hash,finalizedBlockNumber:3,oldestHistoricBlockNumber:0,treesAreSynched:true}),
  getSyncedL1Timestamp:async()=>BigInt(Math.floor(Date.now()/1000)),
  getContract:async()=>canonical,
  getBlockData:async parameter=>{assert.equal(parameter,anchor.number,'Canonical lookup must be by height, not orphan hash');state.reads.push('l2');const header=BlockHeader.empty();header.globalVariables.blockNumber=3;header.state.l1ToL2MessageTree.root=Fr.fromString(state.root);return {blockHash:BlockHash.fromString(state.l2Hash),header,archive:AppendOnlyTreeSnapshot.empty(),checkpointNumber:1,indexWithinCheckpoint:0};},
  getL1ToL2MessageMembershipWitness:async(parameter,key)=>{BlockParameterSchema.parse(JSON.parse(jsonStringify(parameter)));assert(parameter.hash instanceof BlockHash);assert.equal(key.toString(),r.messageKey);state.reads.push('witness');return state.witness;}};
 const provider={getNetwork:async()=>({chainId:31337n}),getTransactionReceipt:async()=>state.receipt,getTransaction:async()=>state.tx,
  getBlock:async number=>{state.reads.push('l1');return number==='finalized'||number===8?state.finalized:{number,hash:state.blockHash};},
  call:async request=>{const contract=request.to===s.rollup?rollupAbi:abi;const name=contract.parseTransaction(request).name;state.reads.push([name,request.blockTag]);return contract.encodeFunctionResult(name,[state.bindings[name]]);}};
 const url='https://funding-fixture.example/'+(++transportId);transports.set(url,node);
 const trusted=await createTrustedPrivateNode({url,expectedNetworkScope:{chainId:s.chainId,version:s.version,rollup:s.rollup}});assert(isTrustedPrivateNode(trusted));
 const input={kind,scope:s,receipt:r,anchor,owner,secrets,privateFeeArtifact:artifact,node:trusted,ethProvider:provider,contextGuard:async()=>{state.guardCalls++;if(state.guardError)throw Error('PRIVATE_SENTINEL');}};
 return {input,state,backend:node,abi,eventArgs,eventName,secret,content};
}
for(const kind of ['collateral','private-fee','bok'])test(`labelled RPC ${kind}: real ABI/hash/witness produces private immutable claim and public evidence`,async()=>{
 const f=await fixture(kind),result=await prepareFundingClaim(f.input);assert.equal(result.status,'claim-ready');assert.equal(result.evidence.content,f.content);
 assert(Object.isFrozen(result.claim));assert(Object.isFrozen(result.evidence.l1));assert(!JSON.stringify(result.evidence).includes(f.secret));assert(!JSON.stringify(result.evidence).includes(f.input.owner));
 if(kind==='collateral'){assert.equal(result.claim.method,'claim_deposit');assert.deepEqual(result.claim.args,[f.input.receipt.sender,'5000',f.secret,'9']);}
 if(kind==='bok')assert.deepEqual(result.claim.args,['5000',f.input.secrets.recipientSalt,f.secret,'9']);
 if(kind==='private-fee'){assert.equal(result.claim.kind,'private-fee-bridge');assert.equal(result.claim.bridgeClaim.amount,'5000');assert.equal(result.claim.bridgeClaim.leafIndex,'9');}
 assert(f.state.guardCalls>10);assert(f.state.reads.filter(x=>Array.isArray(x)&&x[1]===6).length>=4);
});
test('custody-store record is verified against public secret commitment',async()=>{const f=await fixture();let count=0;f.input.claimStore={load:async(scope,hash)=>{count++;assert.equal(scope.depositor,f.input.receipt.sender);return {schemaVersion:1,secret:f.secret,secretHash:hash};}};assert.equal((await prepareFundingClaim(f.input)).status,'claim-ready');assert.equal(count,1);f.input.claimStore.load=async()=>({secret:h(7),secretHash:f.input.receipt.secretHash});await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_MISMATCH'});});
test('absence and not-yet-finalized never prepare or retry claims',async()=>{const f=await fixture();f.state.receipt=null;assert.deepEqual(await prepareFundingClaim(f.input),{status:'absent'});const g=await fixture();g.state.finalized.number=5;assert.deepEqual(await prepareFundingClaim(g.input),{status:'waiting',reason:'l1-finality'});assert(!g.state.reads.includes('witness'));});
test('L2 delivery pending differs from reverted L1',async()=>{const f=await fixture();f.state.witness=undefined;assert.deepEqual(await prepareFundingClaim(f.input),{status:'waiting',reason:'l2-delivery'});const g=await fixture();g.state.receipt.status=0;assert.deepEqual(await prepareFundingClaim(g.input),{status:'reverted'});});
for(const [label,change,code] of [
 ['L1 reorg',f=>{f.state.blockHash=h(500);},'REORG'],
 ['L2 orphan still addressable by hash',f=>{f.state.l2Hash=h(501);},'REORG'],
 ['wrong portal',f=>{f.state.bindings.ROLLUP=addr(99);},'MISMATCH'],
 ['wrong sender',f=>{f.state.tx.from=addr(99);},'MISMATCH'],
 ['wrong nonce',f=>{f.state.tx.nonce=9;},'MISMATCH'],
 ['wrong leaf',f=>{f.state.witness[0]=10n;},'MISMATCH'],
 ['wrong path',f=>{f.state.witness[1]=new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array(L1_TO_L2_MSG_TREE_HEIGHT).fill(Fr.ZERO.toBuffer()));},'MISMATCH'],
 ['wrong secret account',f=>{f.input.owner=h(77);},'MISMATCH'],
 ['duplicate receipt event',f=>{f.state.receipt.logs.push(f.state.receipt.logs[0]);},'MISMATCH'],
 ['RPC private error',f=>{f.backend.getNodeInfo=async()=>{throw Error('PRIVATE_SENTINEL');};},'UNKNOWN'],
 ['context changed',f=>{f.state.guardError=true;},'UNKNOWN'],
])test(`reject ${label} without raw diagnostic or claim`,async()=>{const f=await fixture();change(f);await assert.rejects(()=>prepareFundingClaim(f.input),error=>{assert.equal(error.code,'ROLLING_FUNDING_'+code);assert(!JSON.stringify(error).includes('PRIVATE_SENTINEL'));return true;});});
test('Bok binds recipient commitment, token and exact hidden-secret calldata',async()=>{
 for(const mutate of [f=>{f.input.owner=h(25);},f=>{f.state.bindings.token=addr(99);},f=>{f.state.tx.data=f.abi.encodeFunctionData('deposit',[f.eventArgs[0],'5000',h(9)]);}]){const f=await fixture('bok');mutate(f);await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_MISMATCH'});}
});
for(const mode of ['portal-sender','wrong-content'])test(`FPC rejects self-consistent ${mode} message despite canonical payment`,async()=>{
 const f=await fixture('private-fee',null,mode);await assert.rejects(prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_MISMATCH'});assert(!f.state.reads.includes('witness'));
});
test('FPC recovery rejects foreign owner, token and altered public amount',async()=>{
 for(const mutate of [f=>{f.input.owner=h(25);},f=>{f.state.bindings.UNDERLYING=addr(99);},f=>{f.input.receipt.amount='5001';}]){const f=await fixture('private-fee');mutate(f);await assert.rejects(()=>prepareFundingClaim(f.input));}
});
test('reorg after witness invalidates ready result',async()=>{const f=await fixture();const original=f.backend.getL1ToL2MessageMembershipWitness;f.backend.getL1ToL2MessageMembershipWitness=async(...args)=>{const result=await original(...args);f.state.blockHash=h(999);return result;};await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_REORG'});});
test('input descriptors reject accessors and snapshots resist changes during awaits',async()=>{const f=await fixture();Object.defineProperty(f.input.receipt,'amount',{get:()=>{throw Error('PRIVATE_SENTINEL');},enumerable:true});await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_INVALID'});
 const g=await fixture();const old=g.input.ethProvider.getNetwork;g.input.ethProvider.getNetwork=async()=>{g.input.receipt.amount='1';g.input.secrets.walletSecret=h(99);return old();};assert.equal((await prepareFundingClaim(g.input)).claim.args[1],'5000');});
test('canonical finalized block changing during verification is not accepted',async()=>{const f=await fixture();const original=f.input.ethProvider.getBlock;f.input.ethProvider.getBlock=async n=>n===8?{number:8,hash:h(400)}:original(n);await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_REORG'});});

test('unknown provider error with hostile getters is safely projected',async()=>{const f=await fixture();const error=new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE_SENTINEL');},get(){throw Error('PRIVATE_SENTINEL');}});f.input.ethProvider.getBlock=async()=>{throw error;};await assert.rejects(()=>prepareFundingClaim(f.input),e=>e.code==='ROLLING_FUNDING_UNKNOWN'&&!e.message.includes('PRIVATE_SENTINEL'));});
test('missing token and changed network are rejected',async()=>{const f=await fixture('bok');f.input.scope.token=undefined;await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_INVALID'});const g=await fixture();g.input.ethProvider.getNetwork=async()=>({chainId:1n});await assert.rejects(()=>prepareFundingClaim(g.input),{code:'ROLLING_FUNDING_MISMATCH'});});
test('malformed event, amount, content/key or leaf never reaches claim preparation',async()=>{for(const mutate of [f=>{f.state.receipt.logs[0].data='0x1234';},f=>{f.eventArgs[1]='5001';f.state.receipt.logs[0]={address:f.input.scope.portal,...f.abi.encodeEventLog(f.abi.getEvent(f.eventName),f.eventArgs)};},f=>{f.input.receipt.messageKey=h(2);},f=>{f.input.receipt.leafIndex='8';}]){const f=await fixture();mutate(f);await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_MISMATCH'});}});

test('20-second whole-operation deadline prevents a delayed guard starting an RPC afterwards',async t=>{
 const f=await fixture();let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});f.input.contextGuard=()=>gate;f.backend.getNodeInfo=async()=>{calls++;throw Error('Should not run');};
 t.mock.timers.enable({apis:['setTimeout','Date']});const pending=prepareFundingClaim(f.input);const rejected=assert.rejects(pending,{code:'ROLLING_FUNDING_UNKNOWN'});t.mock.timers.tick(20001);await rejected;release();await Promise.resolve();await Promise.resolve();assert.equal(calls,0);t.mock.timers.reset();
});
test('FPC helper RPC uncertainty is not relabelled a receipt mismatch',async()=>{
 const f=await fixture('private-fee');let calls=0;const original=f.input.ethProvider.getTransaction;f.input.ethProvider.getTransaction=async(...args)=>{if(++calls>1)throw Error('PRIVATE_SENTINEL');return original(...args);};await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_UNKNOWN'});
});

test('unbranded node is rejected before guard or membership, even if it copies trusted methods',async()=>{
 const f=await fixture();let guards=0,membership=0;
 f.input.node={...f.input.node,getL1ToL2MessageMembershipWitness:async()=>{membership++;}};
 f.input.contextGuard=async()=>{guards++;};
 await assert.rejects(()=>prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_UNTRUSTED_NODE'});
 assert.equal(guards,0);assert.equal(membership,0);
});
test('mutation during guard await cannot replace captured trusted route, L1 reads, guard or artifact',async()=>{
 const f=await fixture('private-fee');let release,entered,guards=0,ordinary=0,replacement=0;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.input.contextGuard=async()=>{guards++;if(guards===1){entered();await gate;}};
 const provider=f.input.ethProvider;
 const pending=prepareFundingClaim(f.input);await started;
 f.input.node={getL1ToL2MessageMembershipWitness:async()=>{ordinary++;throw Error('Wrong route');}};
 f.input.contextGuard=async()=>{replacement++;throw Error('Replaced guard');};
 f.input.ethProvider={getNetwork:async()=>{replacement++;throw Error('Replaced provider');}};
 provider.getTransactionReceipt=async()=>{replacement++;throw Error('Replaced method');};
 f.input.privateFeeArtifact={};release();
 assert.equal((await pending).status,'claim-ready');assert.equal(ordinary,0);assert.equal(replacement,0);assert(guards>10);
});
test('mutation during guard await cannot replace captured custody-store capability',async()=>{
 const f=await fixture();let release,entered,calls=0,wrong=0,first=true;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const store={load:async()=>{calls++;return {secret:f.secret,secretHash:f.input.receipt.secretHash};}};f.input.claimStore=store;
 f.input.contextGuard=async()=>{if(first){first=false;entered();await gate;}};
 const pending=prepareFundingClaim(f.input);await started;
 store.load=async()=>{wrong++;throw Error('Replaced store method');};f.input.claimStore={load:async()=>{wrong++;throw Error('Replaced store');}};
 release();assert.equal((await pending).status,'claim-ready');assert.equal(calls,1);assert.equal(wrong,0);
});

// Aggregate route uses the same real SDK hash/Merkle fixtures and an exact original
// journal intent. Other legs have labelled public event fixtures; no payment occurs.
async function aggregateFixture(kind='collateral') {
 const f=await fixture(kind),r=f.input.receipt,s=f.input.scope,abi=new Interface(aggregateFundingAbi);
 const portals={collateralPortal:kind==='collateral'?s.portal:addr(60),feePortal:kind==='private-fee'?s.portal:addr(61),bokPortal:kind==='bok'?s.portal:addr(62)};
 const plan={beneficiary:r.sender,collateral:'5000',collateralSecretHash:kind==='collateral'?r.secretHash:h(30),
  fee:{amount:'5000',maxEth:'100',poolFee:3000},feeSecretHash:kind==='private-fee'?r.secretHash:h(31),
  bok:{amount:'5000',maxEth:'200',poolFee:500},bokCommitment:kind==='bok'?f.eventArgs[0]:h(32),bokSecretHash:kind==='bok'?r.secretHash:h(33),nonce:'99',deadline:'2000000000'};
 const hash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fund').inputs[0]],[plan]));
 const log=(address,contract,name,args)=>({address,...contract.encodeEventLog(contract.getEvent(name),args)});
 const selected=f.state.receipt.logs[0];
 f.state.receipt.logs=[log(addr(63),abi,'Funded',[r.sender,hash,5000,5000,5000,50,100,150]),
  kind==='collateral'?selected:log(portals.collateralPortal,boardAbi,'Deposited',[r.sender,5000,plan.collateralSecretHash,h(34),4]),
  kind==='private-fee'?selected:log(portals.feePortal,feeAbi,'DepositToAztecPublic',[canonical.address.toString(),5000,plan.feeSecretHash,h(35),5]),
  kind==='bok'?selected:log(portals.bokPortal,bokAbi,'Deposited',[plan.bokCommitment,5000,h(36),6])];
 f.state.tx={...f.state.tx,to:addr(63),value:5300n,data:abi.encodeFunctionData('fund',[plan,'0x1234']).toLowerCase()};f.state.receipt.to=addr(63);
 f.input.ethProvider.getCode=async(address,block)=>{assert.equal(address,addr(63));assert.equal(block,6);return '0x6000';};
 f.input.aggregateIntent={from:r.sender,to:addr(63),nonce:Number(r.nonce),chainId:s.chainId,data:f.state.tx.data,value:'5300',txHash:r.txHash,
  expected:{kind:'aggregate-funding',routerCodeHash:keccak256('0x6000'),...portals,privateFpc:canonical.address.toString(),planHash:hash}};
 return {...f,plan,routerAbi:abi};
}
for(const kind of ['collateral','private-fee','bok'])test(`aggregate ${kind} prepares only canonical exact funded private claim`,async()=>{
 const f=await aggregateFixture(kind),result=await prepareFundingClaim(f.input);assert.equal(result.status,'claim-ready');assert.equal(result.evidence.txHash,f.input.receipt.txHash);
 assert(!JSON.stringify(result.evidence).includes(f.secret));assert(!JSON.stringify(result.evidence).includes('aggregateIntent'));
 if(kind==='collateral')assert.equal(result.claim.args[2],f.secret);
 if(kind==='private-fee')assert.equal(result.claim.bridgeClaim.amount,'5000');
 if(kind==='bok')assert.equal(result.claim.args[2],f.secret);
});
for(const [label,mutate] of [
 ['missing other allocation event',f=>f.state.receipt.logs.splice(2,1)],
 ['wrong router bytecode',f=>{f.input.ethProvider.getCode=async()=> '0x6001';}],
 ['changed original calldata',f=>{f.state.tx.data=f.routerAbi.encodeFunctionData('fund',[{...f.plan,bokSecretHash:h(99)},'0x1234']);}],
 ['changed retained hash',f=>{f.input.aggregateIntent.txHash=h(99);}],
 ['wrong consent versus Ethereum nonce',f=>{f.input.aggregateIntent.nonce=99;}],
 ['wrong scoped portal',f=>{f.input.aggregateIntent.expected.collateralPortal=addr(99);}],
 ['duplicate event',f=>f.state.receipt.logs.push(f.state.receipt.logs[3])],
 ['wrong total accounting',f=>{f.state.receipt.logs[0]={address:addr(63),...f.routerAbi.encodeEventLog(f.routerAbi.getEvent('Funded'),[f.input.receipt.sender,f.input.aggregateIntent.expected.planHash,5000,5000,5000,50,100,151])};}],
])test(`aggregate rejects ${label} before claim`,async()=>{const f=await aggregateFixture();mutate(f);await assert.rejects(prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_MISMATCH'});assert(!f.state.reads.includes('witness'));});
test('aggregate context cannot be imported through public receipt',async()=>{const f=await aggregateFixture('bok');f.input.receipt.aggregateIntent=f.input.aggregateIntent;delete f.input.aggregateIntent;await assert.rejects(prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_INVALID'});});
test('aggregate expected getters are not invoked and captured intent survives await mutation',async()=>{
 const f=await aggregateFixture();let touched=0;Object.defineProperty(f.input.aggregateIntent.expected,'routerCodeHash',{get(){touched++;return keccak256('0x6000');}});await assert.rejects(prepareFundingClaim(f.input));assert.equal(touched,0);
 const g=await aggregateFixture('private-fee'),original=g.input.contextGuard;g.input.contextGuard=async()=>{g.input.aggregateIntent.expected.feePortal=addr(99);g.input.aggregateIntent.data='0x';await original();};assert.equal((await prepareFundingClaim(g.input)).status,'claim-ready');
});
test('aggregate Bok preserves private recipient binding and FPC preserves deterministic owner binding',async()=>{for(const kind of ['bok','private-fee']){const f=await aggregateFixture(kind);f.input.owner=h(99);await assert.rejects(prepareFundingClaim(f.input));}});
test('aggregate claim still rejects post-witness reorg and waits for L1 finality',async()=>{const f=await aggregateFixture('bok');f.state.finalized.number=5;assert.deepEqual(await prepareFundingClaim(f.input),{status:'waiting',reason:'l1-finality'});const g=await aggregateFixture('private-fee'),original=g.backend.getL1ToL2MessageMembershipWitness;g.backend.getL1ToL2MessageMembershipWitness=async(...a)=>{const value=await original(...a);g.state.blockHash=h(999);return value;};await assert.rejects(prepareFundingClaim(g.input),{code:'ROLLING_FUNDING_REORG'});});

test('aggregate context property accessor cannot execute during claim preparation',async()=>{const f=await aggregateFixture();let touched=0;Object.defineProperty(f.input,'aggregateIntent',{get(){touched++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(prepareFundingClaim(f.input),{code:'ROLLING_FUNDING_INVALID'});assert.equal(touched,0);});

// USDC relayer identity is deliberately distinct from all beneficiary custody.
async function usdcAggregateFixture(kind='collateral') {
 const privateFeeSalt=h(701),f=await fixture(kind,privateFeeSalt),r=f.input.receipt,s=f.input.scope,abi=new Interface(aggregateFundingAbi),beneficiary=r.sender,relayer=addr(70);
 const portals={collateralPortal:kind==='collateral'?s.portal:addr(60),feePortal:kind==='private-fee'?s.portal:addr(61),bokPortal:kind==='bok'?s.portal:addr(62)};
 const plan={beneficiary,relayer,collateral:{amount:'5000',maxUsdc:'100',poolFee:500},collateralSecretHash:kind==='collateral'?r.secretHash:h(30),
  fee:{amount:'5000',maxUsdc:'200',poolFee:3000},feeSecretHash:kind==='private-fee'?r.secretHash:h(31),
  bokAmount:'5000',bokCommitment:kind==='bok'?f.eventArgs[0]:h(32),bokSecretHash:kind==='bok'?r.secretHash:h(33),nonce:'99',validAfter:'0',deadline:'2000000000',relayFeeUsdc:'10',authorizationSalt:h(702)};
 const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fundUsdc').inputs[0]],[plan]));
 const log=(address,contract,name,args)=>({address,...contract.encodeEventLog(contract.getEvent(name),args)}),selected=f.state.receipt.logs[0];
 f.state.receipt.logs=[log(addr(63),abi,'UsdcFunded',[beneficiary,planHash,relayer,5000,5000,5000,50,100,10,150]),
  kind==='collateral'?selected:log(portals.collateralPortal,boardAbi,'Deposited',[beneficiary,5000,plan.collateralSecretHash,h(34),4]),
  kind==='private-fee'?selected:log(portals.feePortal,feeAbi,'DepositToAztecPublic',[canonical.address.toString(),5000,plan.feeSecretHash,h(35),5]),
  kind==='bok'?selected:log(portals.bokPortal,bokAbi,'Deposited',[plan.bokCommitment,5000,h(36),6])];
 r.sender=relayer;r.nonce='71';f.state.tx={...f.state.tx,from:relayer,nonce:71,to:addr(63),value:0n,data:abi.encodeFunctionData('fundUsdc',[plan,'0x1234','0x5678']).toLowerCase()};f.state.receipt.to=addr(63);f.state.receipt.from=relayer;
 f.input.ethProvider.getCode=async()=> '0x6000';
 f.input.aggregateIntent={from:relayer,to:addr(63),nonce:71,chainId:s.chainId,data:f.state.tx.data,value:'0',txHash:r.txHash,
  expected:{kind:'aggregate-usdc-funding',routerCodeHash:keccak256('0x6000'),...portals,privateFpc:canonical.address.toString(),planHash}};
 f.input.aggregateCustody={kind:'aggregate-usdc-custody-v1',planHash,beneficiary,privateFeeSalt};
 f.input.claimStore={load:async(scope,hash)=>{assert.equal(scope.depositor,beneficiary);assert.equal(hash,plan.collateralSecretHash);return {secret:f.secret,secretHash:hash};}};
 return {...f,plan,routerAbi:abi};
}
for(const kind of ['collateral','private-fee','bok'])test(`USDC aggregate ${kind} keeps relayer receipt and beneficiary private custody distinct`,async()=>{
 const f=await usdcAggregateFixture(kind),result=await prepareFundingClaim(f.input);assert.equal(result.status,'claim-ready');assert.equal(f.input.receipt.sender,addr(70));assert.equal(f.input.receipt.nonce,'71');
 assert.equal(result.evidence.content,f.content);assert(!JSON.stringify(result.evidence).includes(f.input.aggregateCustody.privateFeeSalt));assert(!JSON.stringify(result.evidence).includes('aggregateCustody'));
 if(kind==='collateral')assert.deepEqual(result.claim.args,[f.plan.beneficiary,'5000',f.secret,'9']);
 if(kind==='private-fee')assert.equal(result.claim.bridgeClaim.salt,h(701));
});
for(const [label,kind,mutate] of [
 ['missing private context','bok',f=>delete f.input.aggregateCustody],
 ['wrong retained plan hash','bok',f=>{f.input.aggregateCustody.planHash=h(999);}],
 ['wrong beneficiary','collateral',f=>{f.input.aggregateCustody.beneficiary=addr(99);}],
 ['missing claim store','collateral',f=>delete f.input.claimStore],
 ['absent saved board secret','collateral',f=>{f.input.claimStore.load=async()=>null;}],
 ['wrong saved board secret','collateral',f=>{f.input.claimStore.load=async()=>({secret:h(999),secretHash:f.input.receipt.secretHash});}],
 ['wrong retained FPC salt','private-fee',f=>{f.input.aggregateCustody.privateFeeSalt=h(999);}],
 ['wrong FPC owner','private-fee',f=>{f.input.owner=h(999);}],
 ['wrong Bok owner','bok',f=>{f.input.owner=h(999);}],
 ['fake user transaction sender','collateral',f=>{f.input.receipt.sender=f.plan.beneficiary;}],
 ['missing third allocation','private-fee',f=>f.state.receipt.logs.pop()],
])test(`USDC aggregate rejects ${label} before witness`,async()=>{const f=await usdcAggregateFixture(kind);mutate(f);await assert.rejects(prepareFundingClaim(f.input));assert(!f.state.reads.includes('witness'));});
test('USDC custody rejects getters/imported public context and snapshots before awaits',async()=>{
 const f=await usdcAggregateFixture();let calls=0;Object.defineProperty(f.input.aggregateCustody,'privateFeeSalt',{get(){calls++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(prepareFundingClaim(f.input));assert.equal(calls,0);
 const g=await usdcAggregateFixture('private-fee');g.input.contextGuard=async()=>{g.input.aggregateCustody.privateFeeSalt=h(999);g.input.aggregateCustody.beneficiary=addr(99);};assert.equal((await prepareFundingClaim(g.input)).status,'claim-ready');
 const k=await usdcAggregateFixture('bok');k.input.receipt.aggregateCustody=k.input.aggregateCustody;await assert.rejects(prepareFundingClaim(k.input),{code:'ROLLING_FUNDING_INVALID'});
});
test('USDC claims retain finality and post-witness canonical checks',async()=>{
 const f=await usdcAggregateFixture('private-fee');f.state.finalized.number=5;assert.deepEqual(await prepareFundingClaim(f.input),{status:'waiting',reason:'l1-finality'});
 const g=await usdcAggregateFixture('bok'),original=g.backend.getL1ToL2MessageMembershipWitness;g.backend.getL1ToL2MessageMembershipWitness=async(...args)=>{const value=await original(...args);g.state.blockHash=h(999);return value;};await assert.rejects(prepareFundingClaim(g.input),{code:'ROLLING_FUNDING_REORG'});
});
