// Labelled unit fakes only: no network, wallet signatures, token funding or real proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPrivateBokEscrowFactory} from '../private-bok-escrow.mjs';
const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
class Field {
 constructor(v){this.v=BigInt(v);} toBigInt(){return this.v;} toString(){return H(this.v);} toField(){return this;}
 static fromString(v){return new Field(v);} static fromStringUnsafe(v){return new Field(v);}
}
const names=['state','invocation_hash','sequence','deadline','budget','available','reserved','charged','refunded','primary_refund','secondary_refund','primary_done','secondary_done','receipt'];
async function fixture(overrides={}){
 let saved={operations:{}},proofs=0,sends=0,held=true,sendLost=false,proofFailed=false,wrongCall=false,writeFailure=false;
 const id=H(50),target=H(51),address=H(52),operator=H(53),board=H(54),classId=H(55),txHash=H(56),blockHash=H(57),rollup='0x'+'12'.repeat(20);
 const real=overrides.development===false;
 let nodeProofs=real;
 let chainId='31337',actualClass=classId,actualOperator=operator,blockMismatch=false;
 const row={state:2n,invocation_hash:BigInt(target),sequence:0n,deadline:BigInt(Math.floor(Date.now()/1000)+86400),budget:1000n,available:1000n,reserved:0n,charged:0n,refunded:0n,primary_refund:70n,secondary_refund:71n,primary_done:0n,secondary_done:0n,receipt:0n};
 const block={number:10,hash:new Field(blockHash),header:{globalVariables:{timestamp:BigInt(Math.floor(Date.now()/1000))}}};
 const receipt={txHash:new Field(txHash),status:'checkpointed',executionResult:'success',transactionFee:7n,blockNumber:10,blockHash:new Field(blockHash)};
 const effect={l2BlockHash:new Field(blockHash),l2BlockNumber:10,data:{txHash:new Field(txHash),transactionFee:new Field(7),revertCode:{isOK:()=>receipt.executionResult==='success'},toBuffer:()=>Buffer.from('unit fake canonical effect')}};
 const readAnchors=[];
 const artifact={name:'PrivateBok',storageLayout:Object.fromEntries(['operator','board','l1_chain','version','requests'].map((n,i)=>[n,{slot:new Field(i+1)}])),functions:[],nonDispatchPublicFunctions:[{name:'request',returnType:{kind:'struct',fields:names.map(name=>({name,type:({state:8,sequence:32,deadline:64,budget:128,available:128,reserved:128,charged:128,refunded:128})[name]?{kind:'integer',sign:'unsigned',width:({state:8,sequence:32,deadline:64,budget:128,available:128,reserved:128,charged:128,refunded:128})[name]}:{kind:name.endsWith('_done')?'boolean':'field'}}))}}]};
 let lastCall;
 const methods=new Proxy({}, {get:(_,name)=>(...args)=>({request:async()=>{
  lastCall={name,to:new Field(address),selector:new Field(9),type:'public',isStatic:false,args:args.flat().map(x=>new Field(x instanceof Field?x.toBigInt():x))};
  return {calls:[lastCall]};
 }})});
 const sdk={Fr:Field,AztecAddress:Field,TxHash:Field,Contract:{at:async()=>({methods})},getContractClassFromArtifact:async()=>({id:new Field(classId)}),deriveStorageSlotInMap:async()=>new Field(100),getFunctionReturnType:fn=>fn.returnType,isTrustedProver:p=>p?.trusted===true};
 const node={getNodeInfo:async()=>({l1ChainId:chainId,realProofs:nodeProofs,rollupVersion:1,l1ContractAddresses:{rollupAddress:rollup}}),
  getBlock:async tag=>typeof tag==='number'&&blockMismatch?{...block,hash:new Field(99)}:block,
  getContract:async()=>({currentContractClassId:new Field(actualClass)}),
  getPublicStorageAt:async(anchor,addr,slot)=>{readAnchors.push(anchor);const n=Number(slot.toBigInt());return new Field(n>=100?row[names[n-100]]:[0,BigInt(actualOperator),BigInt(board),BigInt(chainId),1n][n]);},
  sendTx:async()=>{assert(Object.values(saved.privateBokEscrow.operations).some(r=>r.txHash===txHash&&r.phase==='submission-unknown'),'exact durable hash before send');sends++;if(sendLost)throw Error('Secret raw transport error');},
  getTxReceipt:async()=>receipt,getTxEffect:async()=>effect};
 const tx={data:{feePayer:new Field(operator),constants:{txContext:{get chainId(){return new Field(chainId);},version:new Field(1)}}},getTxHash:()=>new Field(txHash),toBuffer:()=>Buffer.from('unit fake transaction'),
  getPublicCallRequestsWithCalldata:()=>[{request:{contractAddress:new Field(wrongCall?99:address),msgSender:new Field(operator)},functionSelector:lastCall.selector,args:lastCall.args}]};
 const wallet={registerContract:async()=>{},completeFeeOptions:async()=>({}),createTxExecutionRequestFromPayloadAndFee:async()=>({}),scopesFrom:()=>[],senderForTagsFrom:()=>new Field(operator),
  pxe:{proverEnabled:real,proofCreator:{trusted:true},proveTx:async()=>{assert(Object.values(saved.privateBokEscrow.operations).some(r=>r.phase==='preparing'),'intent before proof');proofs++;if(proofFailed)throw Error('private witness must not escape');return {chonkProof:{isEmpty:()=>false},toTx:async()=>tx};}}};
 const store={read:()=>saved,write:async next=>{if(writeFailure)throw Error('disk secret');saved=structuredClone(next);}};
 const lease={assertHeld:async()=>assert(held,'lost lease')};
 const options={node,wallet,artifact,address,operator,board,network:{chainId:real?11155111:31337,rollupVersion:1,rollupAddress:rollup},requestId:id,target,store,lease,development:true,proofMode:real?'real':'disabled',timeoutMs:3,pollMs:1,...overrides};
 if(overrides.development===false)chainId='11155111';
 const create=()=>createPrivateBokEscrowFactory(sdk)(options),port=await create();
 const op=(method,args,key=0)=>({operationId:digest([method,key]),argsDigest:digest(args.map(x=>typeof x==='bigint'?String(x):x))});
 return {port,create,id,target,row,receipt,effect,tx,block,readAnchors,op,store,options,counts:()=>({proofs,sends}),
  journal:()=>saved.privateBokEscrow,set:(key,value)=>{
   if(key==='nodeProofs')nodeProofs=value;if(key==='pxeEnabled')wallet.pxe.proverEnabled=value;if(key==='proverMode')wallet.pxe.proofCreator.proofsEnabled=value;if(key==='proverTrusted')wallet.pxe.proofCreator.trusted=value;
   if(key==='sendLost')sendLost=value;if(key==='proofFailed')proofFailed=value;if(key==='wrongCall')wrongCall=value;if(key==='held')held=value;
   if(key==='chainId')chainId=value;if(key==='class')actualClass=value;if(key==='operator')actualOperator=value;if(key==='blockMismatch')blockMismatch=value;if(key==='writeFailure')writeFailure=value;
  }};
}

test('unit fake: public request is hash-pinned and configuration-bound',async()=>{
 const f=await fixture(),r=await f.port.request(f.id);assert.equal(r.request.budget,1000n);assert.equal(r.canonical,true);assert.equal(r.anchor.finality,'checkpointed');
 assert(f.readAnchors.every(a=>a.number===10&&String(a.hash)===H(57)));assert.equal(f.port.mode.controlledSettlement,true);
 await assert.rejects(f.port.request(H(100)),/request mismatch/);
});
test('unit fake: exact canonical success records fee and only one submission across restart',async()=>{
 const f=await fixture(),op=f.op('reserve',[f.id,0,400n]);
 assert.equal((await f.port.reserve(f.id,0,400n,op)).status,'succeeded');
 assert.equal(f.journal().operations[op.operationId].observation.transactionFee,'7');
 const next=await f.create();assert.equal((await next.reserve(f.id,0,400n,op)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('unit fake: accepted send with lost response reconciles without another send',async()=>{
 const f=await fixture();f.set('sendLost',true);const op=f.op('finish',[f.id]);
 assert.equal((await f.port.finish(f.id,op)).status,'succeeded');assert.equal(f.journal().operations[op.operationId].submissionError,true);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('unit fake: pending outcome remains pending after restart and never reproves',async()=>{
 const f=await fixture();f.receipt.status='pending';const op=f.op('reserve',[f.id,0,400n]);
 assert.equal((await f.port.reserve(f.id,0,400n,op)).status,'pending');
 const next=await f.create();assert.equal((await next.reserve(f.id,0,400n,op)).status,'pending');assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('unit fake: pending finish reopens original hash and records canonical fee without resubmission',async()=>{
 const f=await fixture(),op=f.op('finish',[f.id]);f.receipt.status='pending';
 const pending=await f.port.finish(f.id,op);assert.equal(pending.status,'pending');assert.equal(pending.canonical,false);
 const original=structuredClone(f.journal().operations[op.operationId]);
 assert.equal(original.method,'finish');assert.equal(original.txHash,String(f.tx.getTxHash()));assert.equal(original.transactionSha256,digestBytes(f.tx.toBuffer()));
 const reopened=await f.create();assert.equal((await reopened.finish(f.id,op)).status,'pending');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 f.receipt.status='checkpointed';
 const result=await reopened.inspectOperation(op.operationId);assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);
 assert.equal(result.txHash,original.txHash);assert.equal(result.argsDigest,original.argsDigest);assert.equal(result.transactionFee,'7');
 const recorded=f.journal().operations[op.operationId];assert.equal(recorded.transactionSha256,original.transactionSha256);
 assert.equal(recorded.observation.transactionFee,'7');assert.equal(recorded.observation.effectSha256,digestBytes(f.effect.data.toBuffer()));
 assert.equal(recorded.includedHistory.length,1);assert.equal(recorded.includedHistory[0].txHash,original.txHash);
 assert.deepEqual(await (await f.create()).finish(f.id,op),result);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 function digestBytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
});
test('unit fake: failure before send consumes intent without leaking error or reproving',async()=>{
 const f=await fixture();f.set('proofFailed',true);const op=f.op('finish',[f.id]);
 await assert.rejects(f.port.finish(f.id,op),/operation unresolved/);const next=await f.create();
 assert.equal((await next.finish(f.id,op)).status,'pending');assert.deepEqual(f.counts(),{proofs:1,sends:0});
 assert(!JSON.stringify(f.journal()).includes('witness'));
});
test('unit fake: actual reverted receipt records charged fee before returning failure',async()=>{
 const f=await fixture();f.receipt.executionResult='reverted';const op=f.op('settle',[f.id,0,120n,H(88)]);
 const result=await f.port.settle(f.id,0,120n,H(88),op);assert.equal(result.status,'failed');assert.equal(result.canonical,true);
 assert.equal(f.journal().operations[op.operationId].observation.transactionFee,'7');
});
test('unit fake: mismatched receipt hash retains fee evidence but cannot pass',async()=>{
 const f=await fixture();f.receipt.txHash=new Field(999);const op=f.op('finish',[f.id]);
 await assert.rejects(f.port.finish(f.id,op),/unresolved/);assert.equal(f.journal().operations[op.operationId].observation.transactionFee,'7');
 assert.equal(f.counts().sends,1);await assert.rejects(f.port.inspectOperation(op.operationId),/hash mismatch/);assert.equal(f.counts().sends,1);
});
test('unit fake: mismatched effect or reorg cannot qualify canonical inclusion',async()=>{
 for(const kind of ['effect','reorg']){const f=await fixture();const op=f.op('finish',[f.id]);await f.port.finish(f.id,op);
  if(kind==='effect')f.effect.data.txHash=new Field(999);else f.set('blockMismatch',true);
  await assert.rejects(f.port.inspectOperation(op.operationId),/mismatch/);assert.equal(f.counts().sends,1);
 }
});
test('unit fake: changed network, class or operator denies subsequent action',async()=>{
 for(const [key,value]of [['chainId','2'],['class',H(99)],['operator',H(99)]]){
  const f=await fixture();f.set(key,value);await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])));assert.deepEqual(f.counts(),{proofs:0,sends:0});
 }
});
test('unit fake: wrong proven public target is never submitted',async()=>{
 const f=await fixture();f.set('wrongCall',true);await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])));assert.equal(f.counts().sends,0);
});
test('unit fake: lost lease or failed durable write prevents proving and sending',async()=>{
 for(const key of ['held','writeFailure']){const f=await fixture();f.set(key,key==='writeFailure');await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])));assert.deepEqual(f.counts(),{proofs:0,sends:0});}
});
test('unit fake: finalized production policy does not accept checkpointed receipts',async()=>{
 const f=await fixture({development:false});const op=f.op('reserve',[f.id,0,400n]);
 assert.equal((await f.port.reserve(f.id,0,400n,op)).status,'pending');f.receipt.status='finalized';assert.equal((await f.port.inspectOperation(op.operationId)).status,'succeeded');
 assert.equal(f.port.mode.finality,'finalized');assert.equal(f.port.mode.controlledSettlement,false);
});
test('unit fake: reservation, canonical receipt and 180-second margin required before inference',async()=>{
 const f=await fixture();const op=f.op('reserve',[f.id,0,400n]);await f.port.reserve(f.id,0,400n,op);f.row.available=600n;f.row.reserved=400n;
 assert.equal((await f.port.assertUsable(f.id,0,400n)).canonical,true);
 f.row.deadline=BigInt(Math.floor(Date.now()/1000)+180);await assert.rejects(f.port.assertUsable(f.id,0,400n),/expiry/);
 f.row.deadline+=1000n;f.receipt.status='pending';await assert.rejects(f.port.assertUsable(f.id,0,400n),/finalized/);
});
test('unit fake: conservation, target and operation digest mismatches fail closed',async()=>{
 const f=await fixture();const op=f.op('finish',[H(80)]);await assert.rejects(f.port.finish(f.id,op),/arguments mismatch/);
 f.row.available=1n;await assert.rejects(f.port.request(f.id),/conservation/);f.row.available=1000n;f.row.invocation_hash=10n;
 await assert.rejects(f.port.request(f.id),/target mismatch/);assert.equal(f.counts().sends,0);
});
test('unit fake: explicit local restriction and proof labels cannot be silently changed',async()=>{
 await assert.rejects(fixture({development:false,proofMode:'disabled'}),/Native proof policy/);
 const f=await fixture();f.options.network={...f.options.network,chainId:2};await assert.rejects(f.create());
});


test('unit fake: all allowed operator ABI methods retain exact args and reject copied identities',async()=>{
 for(const [method,args]of [['reserve',[0,400n]],['settle',[0,120n,H(88)]],['close_uncertain',[]],['reconcile',[0,0n,H(89)]],['finish',[]]]){
  const f=await fixture(),op=f.op(method,[f.id,...args]);
  assert.equal((await f.port[method](f.id,...args,op)).status,'succeeded');
  assert.deepEqual(f.journal().operations[op.operationId].args,[f.id,...args].map(x=>typeof x==='bigint'?String(x):x));
  f.options.target=H(666);await assert.rejects(f.create());assert.equal(f.counts().sends,1);
 }
});
test('unit fake: absent, unreadable and dropped outcomes do not authorize submission replay',async()=>{
 const f=await fixture(),op=f.op('finish',[f.id]);assert.equal((await f.port.inspectOperation(op.operationId)).status,'absent');
 f.options.node.getTxReceipt=async()=>{throw Error('private transport diagnostics');};
 assert.equal((await f.port.finish(f.id,op)).status,'pending');
 f.options.node.getTxReceipt=async()=>({...f.receipt,status:'dropped'});
 assert.deepEqual((await f.port.inspectOperation(op.operationId)).canonical,false);
 await f.port.finish(f.id,op);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 assert(!JSON.stringify(f.journal()).includes('diagnostics'));
});
test('unit fake: changed actual fee payer or effect fee cannot pass',async()=>{
 const f=await fixture();f.tx.data.feePayer=new Field(99);
 await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])));assert.equal(f.counts().sends,0);
 const g=await fixture();g.effect.data.transactionFee=new Field(8);const op=g.op('finish',[g.id]);
 await assert.rejects(g.port.finish(g.id,op));assert.equal(g.journal().operations[op.operationId].observation.transactionFee,'7');
});
test('unit fake: malformed schema and changed proof mode reject journal reopening',async()=>{
 const f=await fixture();f.options.proofMode='real';await assert.rejects(f.create(),/Native proof policy/);
 f.options.proofMode='disabled';f.options.artifact.nonDispatchPublicFunctions[0].returnType.fields[0].type.width=32;
 await assert.rejects(f.create(),/layout changed/);
});


test('unit fake: included fee/effect history survives unavailable, pending, dropped and reorg observations',async()=>{
 const f=await fixture(),op=f.op('reserve',[f.id,0,400n]);await f.port.reserve(f.id,0,400n,op);
 const original=structuredClone(f.journal().operations[op.operationId].includedHistory);assert.equal(original.length,1);
 assert.equal(original[0].transactionFee,'7');assert.equal(original[0].canonicalAtObservation,true);
 const getter=f.options.node.getTxReceipt;
 f.options.node.getTxReceipt=async()=>{throw Error('unavailable');};
 assert.equal((await f.port.inspectOperation(op.operationId)).status,'pending');
 assert.deepEqual(f.journal().operations[op.operationId].includedHistory,original);
 assert.equal(f.journal().operations[op.operationId].result.canonical,false);
 f.options.node.getTxReceipt=getter;
 for(const status of ['pending','dropped']){
  f.receipt.status=status;await f.port.inspectOperation(op.operationId);
  assert.deepEqual(f.journal().operations[op.operationId].includedHistory,original);
  assert.equal(f.journal().operations[op.operationId].result.canonical,false);
 }
 f.receipt.status='checkpointed';f.set('blockMismatch',true);
 await assert.rejects(f.port.inspectOperation(op.operationId),/mismatch/);
 assert.deepEqual(f.journal().operations[op.operationId].includedHistory,original);
 assert.equal(f.journal().operations[op.operationId].result.canonical,false);
 f.set('blockMismatch',false);f.receipt.status='finalized';
 assert.equal((await f.port.inspectOperation(op.operationId)).status,'succeeded');
 assert.equal(f.journal().operations[op.operationId].includedHistory.length,2);
 assert.deepEqual(f.journal().operations[op.operationId].includedHistory[0],original[0]);
 await f.port.inspectOperation(op.operationId);assert.equal(f.journal().operations[op.operationId].includedHistory.length,2);
 assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('unit fake: requested real rejects disabled node or disabled/unknown PXE before proof/send',async()=>{
 for(const [key,value]of [['nodeProofs',false],['pxeEnabled',false],['proverMode',false],['proverTrusted',false]]){
  const f=await fixture({development:false});f.set(key,value);await assert.rejects(f.create());
  await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])));assert.deepEqual(f.counts(),{proofs:0,sends:0});
 }
});
test('unit fake: disabled requires matching actual node and native PXE false',async()=>{
 const f=await fixture({proofMode:'disabled'});assert.equal(f.port.mode.nodeVerifiesProofs,false);assert.equal(f.port.mode.pxeProofMode,'disabled');
 const op=f.op('finish',[f.id]);assert.equal((await f.port.finish(f.id,op)).status,'succeeded');
 const g=await fixture({proofMode:'disabled'});g.set('pxeEnabled',true);await assert.rejects(g.create(),/PXE native proof policy/);
 const h=await fixture({proofMode:'disabled'});h.set('nodeProofs',true);await assert.rejects(h.create(),/Node proof verification/);
});

test('unit fake: loss of network verification invalidates current pass while retaining inclusion history',async()=>{
 const f=await fixture(),op=f.op('finish',[f.id]);await f.port.finish(f.id,op);
 const prior=structuredClone(f.journal().operations[op.operationId].includedHistory);
 f.options.node.getNodeInfo=async()=>{throw Error('offline');};await assert.rejects(f.port.inspectOperation(op.operationId));
 assert.equal(f.journal().operations[op.operationId].result.canonical,false);
 assert.deepEqual(f.journal().operations[op.operationId].includedHistory,prior);assert.equal(f.counts().sends,1);
});

test('unit fake: authenticated reply uses exact flattened ABI and cannot replay after restart',async()=>{
 const f=await fixture(),fields=Array.from({length:32},(_,i)=>H(i===0?65:0)),args=[f.id,H(66),fields,1,1,0],op=f.op('publish_reply',args);
 assert.equal((await f.port.publish_reply(...args,op)).status,'succeeded');
 assert.equal((await (await f.create()).publish_reply(...args,op)).status,'succeeded');assert.equal(f.counts().sends,1);
 await assert.rejects(f.port.publish_reply(f.id,H(66),fields.slice(1),1,1,0,op));
 await assert.rejects(fixture({development:true,proofMode:'real'}),/Native proof policy/);
});
