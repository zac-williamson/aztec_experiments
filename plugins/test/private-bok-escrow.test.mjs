// Labelled unit fakes only: no network, wallet signatures, token funding or real proofs.
import test, {after} from 'node:test';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {Grumpkin} from '@aztec-labs/foundation/crypto/grumpkin';
import {FunctionSelector} from '@aztec-labs/stdlib/abi';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Gas,GasFees,GasSettings} from '@aztec-labs/stdlib/gas';
import {createPrivateBokEscrowFactory} from '../private-bok-escrow.mjs';
const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
class Field {
 constructor(v){this.v=BigInt(v);} toBigInt(){return this.v;} toString(){return H(this.v);} toField(){return this;}
 static fromString(v){return new Field(v);} static fromStringUnsafe(v){return new Field(v);}
}
const replySelector=await FunctionSelector.fromSignature('_publish_reply(Field,Field,[Field;32],u16,u32,u32,Field,Field)');
const tipPoint=[Grumpkin.generator.x,Grumpkin.generator.y].map(value=>new Field(value.toBigInt()));
Field.MODULUS=Fr.MODULUS;
after(async()=>{await BarretenbergSync.destroySingleton();});
const names=['state','invocation_hash','sequence','deadline','budget','available','reserved','charged','refunded','primary_refund','secondary_refund','primary_done','secondary_done','receipt'];
async function fixture(overrides={}){
 let syncs=0,syncFailed=false,validations=0,feeQuotes=0,balanceReads=0,feeBalance=10000000000n;
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
 let lastCall,payloadCalls;
 const methods=new Proxy({}, {get:(_,name)=>(...args)=>({request:async()=>{
  lastCall={name,to:new Field(address),selector:new Field(9),type:name==='publish_reply'?'private':'public',isStatic:false,args:args.flat().map(x=>new Field(x instanceof Field?x.toBigInt():x))};
  return {calls:[lastCall]};
 }})});
 class BatchCall {constructor(_wallet,interactions){this.interactions=interactions;}async request(){return {calls:(await Promise.all(this.interactions.map(i=>i.request()))).flatMap(p=>p.calls)};}}
 const sdk={FunctionSelector,getFeeJuiceBalance:async(owner,client)=>{balanceReads++;assert.equal(String(owner),operator);assert.equal(client,node);return feeBalance;},BatchCall,waitForTx:async()=>receipt,Fr:Field,AztecAddress:Field,TxHash:Field,Contract:{at:async()=>({methods})},getContractClassFromArtifact:async()=>({id:new Field(classId)}),deriveStorageSlotInMap:async()=>new Field(100),getFunctionReturnType:fn=>fn.returnType,isTrustedProver:p=>p?.trusted===true};
 const node={getNodeInfo:async()=>({l1ChainId:chainId,realProofs:nodeProofs,rollupVersion:1,l1ContractAddresses:{rollupAddress:rollup}}),
  getBlock:async tag=>typeof tag==='number'&&blockMismatch?{...block,hash:new Field(99)}:block,
  getContract:async()=>({currentContractClassId:new Field(actualClass)}),
  getPublicStorageAt:async(anchor,addr,slot)=>{readAnchors.push(anchor);const n=Number(slot.toBigInt());return new Field(n>=100?row[names[n-100]]:[0,BigInt(actualOperator),BigInt(board),BigInt(chainId),1n][n]);},
  sendTx:async()=>{assert(Object.values(saved.privateBokEscrow.operations).flatMap(r=>[r,...(r.replacement?[r.replacement]:[])]).some(r=>r.txHash===txHash&&r.phase==='submission-unknown'),'exact durable hash before send');sends++;if(sendLost)throw Error('Secret raw transport error');},
  getTxReceipt:async()=>receipt,getTxEffect:async()=>effect};
 const tx={data:{feePayer:new Field(operator),constants:{txContext:{get chainId(){return new Field(chainId);},version:new Field(1)}}},getTxHash:()=>new Field(txHash),toBuffer:()=>Buffer.from('unit fake transaction'),
  getPublicCallRequestsWithCalldata:()=>(payloadCalls??[lastCall]).map(c=>({request:{contractAddress:new Field(wrongCall?99:address),msgSender:new Field(c.name==='publish_reply'?address:operator)},functionSelector:c.name==='publish_reply'?replySelector:c.selector,args:c.name==='publish_reply'?[...c.args,...tipPoint]:c.args}))};
 tx.data.getNonRevertiblePublicCallRequests=()=>[];tx.data.getRevertiblePublicCallRequests=()=>payloadCalls??[lastCall];tx.data.getTeardownPublicCallRequest=()=>undefined;
 const maxTxGasLimits=new Gas(10000,1000000);
 const wallet={registerContract:async()=>{},completeFeeOptions:async options=>{feeQuotes++;assert.equal(options.forEstimation,undefined);return {gasSettings:GasSettings.fallback({gasLimits:maxTxGasLimits,maxFeesPerGas:new GasFees(2n,3n)})};},createTxExecutionRequestFromPayloadAndFee:async(p,from,fee)=>{payloadCalls=p.calls;return {payload:p,salt:'same nonce',authWitnesses:['same authorization'],txContext:{chainId:new Field(chainId),version:new Field(1),gasSettings:fee.gasSettings}};},scopesFrom:()=>[],senderForTagsFrom:()=>new Field(operator),
  pxe:{sync:async()=>{syncs++;if(syncFailed)throw Error("private sync details");},proverEnabled:real,proofCreator:{trusted:true},simulateAndProveTx:async()=>{throw Error('Unexpected estimation path');},proveTxWithPublicValidation:async(request,options)=>{
   validations++;assert.deepEqual(options.scopes,[]);assert.equal(String(options.senderForTags),operator);
   return wallet.pxe.proveTx(request,options);
  },proveTx:async request=>{tx.data.constants.txContext.gasSettings=request.txContext.gasSettings;assert(Object.values(saved.privateBokEscrow.operations).flatMap(r=>[r,...(r.replacement?[r.replacement]:[])]).some(r=>r.phase==='preparing'),'intent before proof');proofs++;if(proofFailed)throw Error('private witness must not escape');return {chonkProof:{isEmpty:()=>false},toTx:async()=>tx};}}};
 const store={read:()=>saved,write:async next=>{if(writeFailure)throw Error('disk secret');saved=structuredClone(next);}};
 const lease={assertHeld:async()=>assert(held,'lost lease')};
 const options={node,wallet,artifact,address,operator,board,network:{chainId:real?11155111:31337,rollupVersion:1,rollupAddress:rollup},requestId:id,target,store,lease,development:true,proofMode:real?'real':'disabled',...overrides};
 if(overrides.development===false)chainId='11155111';
 const create=()=>createPrivateBokEscrowFactory(sdk)(options),port=await create();
 const op=(method,args,key=0)=>({operationId:digest([method,key]),argsDigest:digest(args.map(x=>typeof x==='bigint'?String(x):x))});
 return {port,create,id,target,row,receipt,effect,tx,block,readAnchors,op,store,options,sdk,counts:()=>({proofs,sends}),syncCount:()=>syncs,
  maxTxGasLimits,feeCounts:()=>({validations,feeQuotes,balanceReads}),journal:()=>saved.privateBokEscrow,set:(key,value)=>{
   if(key==='syncFailed')syncFailed=value;
   if(key==='feeBalance')feeBalance=value;if(key==='nodeProofs')nodeProofs=value;if(key==='pxeEnabled')wallet.pxe.proverEnabled=value;if(key==='proverMode')wallet.pxe.proofCreator.proofsEnabled=value;if(key==='proverTrusted')wallet.pxe.proofCreator.trusted=value;
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
test('unit fake: real-proof production advances at checkpoint without waiting for finalized tip',async()=>{
 const f=await fixture({development:false}),op=f.op('reserve',[f.id,0,400n]),tags=[];
 const getBlock=f.options.node.getBlock;f.options.node.getBlock=async tag=>{tags.push(tag);assert.notEqual(tag,'finalized');return getBlock(tag);};
 f.receipt.status='proposed';assert.equal((await f.port.reserve(f.id,0,400n,op)).status,'pending');
 for(const status of ['checkpointed','proven','finalized']){
  f.receipt.status=status;assert.equal((await f.port.inspectOperation(op.operationId)).status,'succeeded');
  assert.equal(f.journal().operations[op.operationId].observation.status,status);
 }
 assert(tags.includes('checkpointed'));assert.equal(f.port.mode.finality,'checkpointed');assert.equal(f.port.mode.proofMode,'real');
 assert.equal(f.port.mode.nodeVerifiesProofs,true);assert.equal(f.port.mode.controlledSettlement,false);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('unit fake: historical finalized binding reopens exact original operation without rewriting history or resending',async()=>{
 for(const status of ['pending','finalized']){
 const f=await fixture({development:false}),op=f.op('reserve',[f.id,0,400n]);f.receipt.status=status;
 await f.port.reserve(f.id,0,400n,op);
 const saved=structuredClone(f.store.read());saved.privateBokEscrow.binding.finality='finalized';await f.store.write(saved);
 const original=structuredClone(f.journal()),reopened=await f.create();assert.deepEqual(f.journal(),original);
 f.receipt.status='checkpointed';assert.equal((await reopened.reserve(f.id,0,400n,op)).status,'succeeded');
 assert.deepEqual(f.journal().binding,original.binding);
 const history=original.operations[op.operationId].includedHistory??[];assert.deepEqual((f.journal().operations[op.operationId].includedHistory??[]).slice(0,history.length),history);
 for(const key of ['txHash','transactionSha256','argsDigest','args','phase'])assert.deepEqual(f.journal().operations[op.operationId][key],original.operations[op.operationId][key]);
 assert.deepEqual(f.counts(),{proofs:1,sends:1});f.set('blockMismatch',true);
 await assert.rejects(reopened.reserve(f.id,0,400n,op),/mismatch/);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 }
});
test('unit fake: policy evolution never admits changed identity or unrecognized confirmation policy',async()=>{
 for(const [key,value] of [['operator',H(99)],['classId',H(99)],['proofMode','disabled'],['finality','latest']]){
  const f=await fixture({development:false}),saved=structuredClone(f.store.read());saved.privateBokEscrow.binding.finality='finalized';saved.privateBokEscrow.binding[key]=value;
  await f.store.write(saved);await assert.rejects(f.create(),/identity mismatch/);assert.deepEqual(f.counts(),{proofs:0,sends:0});
 }
 const f=await fixture(),saved=structuredClone(f.store.read());saved.privateBokEscrow.binding.finality='finalized';await f.store.write(saved);await assert.rejects(f.create(),/identity mismatch/);
});
test('unit fake: posting reservation and 180-second margin required before inference',async()=>{
 const f=await fixture();f.row.available=0n;f.row.reserved=1000n;
 assert.equal((await f.port.assertUsable(f.id,0,1000n)).canonical,true);
 f.row.deadline=BigInt(Math.floor(Date.now()/1000)+180);await assert.rejects(f.port.assertUsable(f.id,0,1000n),/expiry/);
 f.row.deadline+=1000n;f.row.available=1n;f.row.reserved=999n;await assert.rejects(f.port.assertUsable(f.id,0,1000n),/Reservation not canonical/);
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

test('unit fake: only first never-submitted reserve can continue once after proof preparation failure',async()=>{
 const f=await fixture(),op=f.op('reserve',[f.id,0,400n]);f.set('proofFailed',true);
 await assert.rejects(f.port.reserve(f.id,0,400n,op));
 assert.equal((await f.port.inspectOperation(op.operationId)).status,'not-submitted');
 f.set('proofFailed',false);const reopened=await f.create();
 assert.equal((await reopened.reserve(f.id,0,400n,op)).status,'succeeded');
 assert.equal(f.journal().operations[op.operationId].recoveryAttempted,true);
 await reopened.reserve(f.id,0,400n,op);assert.deepEqual(f.counts(),{proofs:2,sends:1});
 const failed=await fixture(),failedOp=failed.op('reserve',[failed.id,0,400n]);failed.set('proofFailed',true);
 await assert.rejects(failed.port.reserve(failed.id,0,400n,failedOp));
 await assert.rejects(failed.port.reserve(failed.id,0,400n,failedOp));
 assert.equal((await failed.port.reserve(failed.id,0,400n,failedOp)).status,'pending');
 assert.deepEqual(failed.counts(),{proofs:2,sends:0});
});

test('unit fake: native observer waits on original submitted hash then rechecks canonical effect without proving or sending',async()=>{
 const f=await fixture({development:false}),op=f.op('reserve',[f.id,0,400n]);
 f.receipt.status='pending';await f.port.reserve(f.id,0,400n,op);let waits=0;
 f.sdk.waitForTx=async(node,hash,options)=>{waits++;assert.equal(String(hash),String(f.receipt.txHash));assert.equal(options.waitForStatus,'checkpointed');assert.equal(options.timeout,0);f.receipt.status='finalized';return f.receipt;};
 assert.equal((await f.port.waitForOperation(op.operationId)).status,'succeeded');assert.equal(waits,1);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 assert.equal((await f.port.waitForOperation(op.operationId)).status,'succeeded');assert.equal(waits,1);
 f.set('blockMismatch',true);await assert.rejects(f.port.waitForOperation(op.operationId),/mismatch/);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});


test('unit fake: first settlement and reply remain owned until native checkpoint, then inspect exact original effect',async()=>{
 for(const development of [true,false])for(const method of ['settle','publish_reply']){
  const f=await fixture({development}),fields=Array.from({length:32},(_,i)=>H(i===0?65:0));
  const args=method==='settle'?[f.id,0,120n,H(88)]:[f.id,H(66),fields,1,1,0],op=f.op(method,args);
  f.receipt.status='pending';let release,entered,completed=false;
  const waiting=new Promise(resolve=>{entered=resolve;}),ready=new Promise(resolve=>{release=resolve;});
  f.sdk.waitForTx=async(node,hash,options)=>{
   assert.equal(node,f.options.node);assert.equal(String(hash),String(f.tx.getTxHash()));
   assert.deepEqual(options,{waitForStatus:'checkpointed',timeout:0,dontThrowOnRevert:true});
   entered();await ready;return f.receipt;
  };
  const operation=f.port[method](...args,op).then(value=>{completed=true;return value;});
  await waiting;assert.equal(completed,false);assert.deepEqual(f.counts(),{proofs:1,sends:1});
  await assert.rejects(f.port.inspectOperation(op.operationId),/already running/);
  f.receipt.status='checkpointed';release();
  const result=await operation;assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);
  assert.equal(result.transactionFee,'7');assert.equal(f.journal().operations[op.operationId].includedHistory.length,1);
  assert.equal((await (await f.create())[method](...args,op)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 }
});

test('unit fake: native observation preserves reverted or dropped outcomes and does not replay',async()=>{
 for(const status of ['finalized','dropped']){
  const f=await fixture({development:false}),op=f.op('settle',[f.id,0,120n,H(88)]);f.receipt.status='pending';
  f.sdk.waitForTx=async(_node,_hash,options)=>{
   assert.equal(options.dontThrowOnRevert,true);f.receipt.status=status;f.receipt.executionResult='reverted';
   if(status==='dropped')throw Error('native dropped reason');return f.receipt;
  };
  const result=await f.port.settle(f.id,0,120n,H(88),op);
  assert.equal(result.status,'failed');assert.equal(result.canonical,status==='finalized');
  assert.equal(f.journal().operations[op.operationId].observation.transactionFee,'7');
  assert.equal((await (await f.create()).settle(f.id,0,120n,H(88),op)).status,'failed');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 }
});

test('unit fake: lost native observation retains signed intent for state-driven continuation without another proof/send',async()=>{
 const f=await fixture({development:false}),op=f.op('finish',[f.id]);f.receipt.status='pending';
 f.sdk.waitForTx=async()=>{throw Error('secret transport detail');};
 await assert.rejects(f.port.finish(f.id,op),/operation unresolved/);
 const original=structuredClone(f.journal().operations[op.operationId]);assert.equal(original.phase,'submission-unknown');
 assert.equal(original.txHash,String(f.tx.getTxHash()));assert(!JSON.stringify(original).includes('secret'));
 f.sdk.waitForTx=async(_node,hash)=>{assert.equal(String(hash),original.txHash);f.receipt.status='finalized';return f.receipt;};
 const result=await (await f.create()).finish(f.id,op);assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);
 assert.deepEqual(f.counts(),{proofs:1,sends:1});assert.equal(f.journal().operations[op.operationId].transactionSha256,original.transactionSha256);
});

async function replacementFixture(method='settle'){
 const f=await fixture(),args=[f.id,0,'120',H(88),...(method==='finalize_reply'?[H(89),Array(32).fill(H(0)),1,0,0]:[])],operation=f.op(method,args);
 const originalHash=H(101),saved=structuredClone(f.store.read());
 saved.privateBokEscrow.operations[operation.operationId]={method,args,argsDigest:operation.argsDigest,phase:'submission-unknown',proofMode:'disabled',txHash:originalHash,transactionSha256:'ab'.repeat(32),submissionError:true};
 await f.store.write(saved);Object.assign(f.row,{state:2n,sequence:0n,reserved:1000n,available:0n});
 let originalStatus='dropped',missing=false;
 const get=f.options.node.getTxReceipt;
 f.options.node.getTxReceipt=async hash=>{
  if(String(hash)===originalHash){if(missing)throw Error('unavailable');return{...f.receipt,txHash:new Field(originalHash),status:originalStatus};}
  return get(hash);
 };
 f.options.node.getTxEffect=async hash=>({...f.effect,data:{...f.effect.data,txHash:new Field(hash)}});
 return{...f,operation,originalHash,authority:{...operation,originalTxHash:originalHash},setOriginal:(status,unavailable=false)=>{originalStatus=status;missing=unavailable;}};
}
test('explicit dropped settlement replacement retains both hashes, canonical fees and one-use lineage',async()=>{
 const f=await replacementFixture(),original=structuredClone(f.journal().operations[f.operation.operationId]);
 const result=await f.port.replaceDroppedOperation(f.authority);assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);
 let saved=f.journal().operations[f.operation.operationId];
 for(const key of ['txHash','args','argsDigest','transactionSha256','submissionError'])assert.deepEqual(saved[key],original[key]);
 assert.equal(saved.replacement.originalTxHash,f.originalHash);assert.equal(saved.replacement.txHash,H(56));
 assert.equal(saved.replacement.observation.transactionFee,'7');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 const reopened=await f.create();assert.equal((await reopened.replaceDroppedOperation(f.authority)).status,'succeeded');
 assert.equal((await reopened.settle(f.id,0,120n,H(88),f.operation)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 f.setOriginal('checkpointed');assert.equal((await reopened.inspectOperation(f.operation.operationId)).txHash,f.originalHash);
 saved=f.journal().operations[f.operation.operationId];assert.equal(saved.includedHistory[0].transactionFee,'7');assert.equal(saved.replacement.includedHistory[0].transactionFee,'7');
});
test('replacement never admits missing/pending receipts, wrong authority or changed reservation',async()=>{
 for(const kind of ['pending','unavailable','hash','digest','sequence','amount','latest','activation','proofPolicy','expired']){
  const f=await replacementFixture(),authority={...f.authority};
  if(kind==='pending')f.setOriginal('pending');if(kind==='unavailable')f.setOriginal('dropped',true);
  if(kind==='hash')authority.originalTxHash=H(999);if(kind==='digest')authority.argsDigest='ef'.repeat(32);
  if(kind==='sequence')f.row.sequence=8n;if(kind==='amount'){f.row.reserved=100n;f.row.available=900n;}
  if(kind==='latest'){const get=f.options.node.getBlock;f.options.node.getBlock=async tag=>{if(tag==='latest')f.row.receipt=999n;return get(tag);};}
  if(kind==='activation'){f.row.reserved=999n;f.row.available=1n;}
  if(kind==='proofPolicy')f.set('nodeProofs',true);if(kind==='expired')f.row.deadline=BigInt(f.block.header.globalVariables.timestamp);
  await assert.rejects(f.port.replaceDroppedOperation(authority));assert.deepEqual(f.counts(),{proofs:0,sends:0});
 }
});
test('replacement admission consumed before proof; failure and unknown send never reprove or resend',async()=>{
 for(const kind of ['proof','unknown','dropped']){
  const f=await replacementFixture();
  if(kind==='proof')f.set('proofFailed',true);
  if(kind==='unknown'){f.set('sendLost',true);f.receipt.status='pending';}
  if(kind==='dropped')f.receipt.status='dropped';
  if(kind==='proof')await assert.rejects(f.port.replaceDroppedOperation(f.authority),/unresolved/);
  else await f.port.replaceDroppedOperation(f.authority);
  const before=f.counts();await (await f.create()).replaceDroppedOperation(f.authority);assert.deepEqual(f.counts(),before);
  assert.equal(before.proofs,1);assert.equal(before.sends,kind==='proof'?0:1);
 }
});
test('replacement rechecks reservation and late original inclusion after proof before broadcasting',async()=>{
 for(const kind of ['changed','original-included','lease','expired']){
  const f=await replacementFixture(),prove=f.options.wallet.pxe.proveTx;
  f.options.wallet.pxe.proveTx=async(...args)=>{const result=await prove(...args);if(kind==='changed')f.row.receipt=999n;if(kind==='original-included')f.setOriginal('checkpointed');if(kind==='lease')f.set('held',false);if(kind==='expired')f.block.header.globalVariables.timestamp=f.row.deadline;return result;};
  if(kind==='original-included')assert.equal((await f.port.replaceDroppedOperation(f.authority)).status,'succeeded');
  else await assert.rejects(f.port.replaceDroppedOperation(f.authority));
  assert.deepEqual(f.counts(),{proofs:1,sends:0});
 }
});


// Counts logical node calls, not HTTP envelopes; no live RPC or timing claim.
function measureNode(node){
 const counts={};for(const [name,method]of Object.entries(node))if(typeof method==='function')node[name]=async(...args)=>{counts[name]=(counts[name]??0)+1;return method(...args);};
 return counts;
}
test('unit fake: one reservation observation shares identical checkpoint/latest snapshot',async()=>{
 const f=await fixture();f.row.available=0n;f.row.reserved=1000n;
 const counts=measureNode(f.options.node),r=await f.port.assertUsable(f.id,0,1000n);
 assert.equal(r.canonical,true);assert.equal(r.request.reserved,1000n);assert.equal(r.anchor.hash,H(57));
 assert.equal(counts.getNodeInfo,1);assert.equal(counts.getContract,1);assert.equal(counts.getPublicStorageAt,18);
 assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),24);
});
test('unit fake: independent pinned storage slots are read concurrently and fresh on the next guard',async()=>{
 const f=await fixture(),original=f.options.node.getPublicStorageAt;let active=0,peak=0;
 f.options.node.getPublicStorageAt=async(...args)=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));try{return await original(...args);}finally{active--;}};
 await f.port.request(f.id);assert.equal(peak,18);
 f.row.available=900n;f.row.charged=100n;assert.equal((await f.port.request(f.id)).request.charged,100n);
});
test('unit fake: distinct latest block and reorg during final guard remain authoritative',async()=>{
 const f=await fixture();f.row.available=0n;f.row.reserved=1000n;
 const originalBlock=f.options.node.getBlock,originalRead=f.options.node.getPublicStorageAt;
 f.options.node.getBlock=async tag=>tag==='latest'||tag===11?{...f.block,number:11,hash:new Field(58)}:originalBlock(tag);
 f.options.node.getPublicStorageAt=async(anchor,...rest)=>{if(anchor.number===11&&Number(rest[1].toBigInt())===100)return new Field(3);return originalRead(anchor,...rest);};
 await assert.rejects(f.port.assertUsable(f.id,0,1000n),/Reservation not canonical/);
 f.options.node.getPublicStorageAt=originalRead;
 let numbered=0;f.options.node.getBlock=async tag=>{if(typeof tag==='number'&&++numbered===2)return {...f.block,hash:new Field(99)};return originalBlock(tag);};
 await assert.rejects(f.port.assertUsable(f.id,0,1000n),/Canonical block changed during reservation guard/);
});

test('unit fake: atomic final reply proves and submits one exact ordered three-call transaction',async()=>{
 const f=await fixture(),fields=Array(32).fill(H(0)),args=[f.id,0,120n,H(88),H(89),fields,1,0,0],op=f.op('finalize_reply',args);
 const result=await f.port.finalize_reply(...args,op);assert.equal(result.status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 const requests=f.tx.getPublicCallRequestsWithCalldata();assert.deepEqual(requests.map(c=>c.args.length),[4,39,1]);
 assert.equal(f.journal().operations[op.operationId].method,'finalize_reply');
 await (await f.create()).finalize_reply(...args,op);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('private reply continuation rejects changed sender, selector, arguments and invalid tip points before broadcast',async()=>{
 for(const change of [
  call=>{call.request.msgSender=new Field(53);},
  call=>{call.functionSelector=new Field(9);},
  call=>{call.args[0]=new Field(99);},
  call=>{call.args.pop();},
  call=>{call.args.splice(-2,2,new Field(0),new Field(0));},
  call=>{call.args.splice(-2,2,new Field(1),new Field(1));},
  call=>{call.args[call.args.length-2]=new Field(Fr.MODULUS);},
 ]){
  const f=await fixture(),original=f.tx.getPublicCallRequestsWithCalldata;
  f.tx.getPublicCallRequestsWithCalldata=()=>{const calls=original();change(calls[1]);return calls;};
  const args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0];
  await assert.rejects(f.port.finalize_reply(...args,f.op('finalize_reply',args)),/unresolved/);
  assert.deepEqual(f.counts(),{proofs:1,sends:0});
 }
});
test('unit fake: atomic final reply rejects non-revertible calls before broadcast',async()=>{
 const f=await fixture();f.tx.data.getNonRevertiblePublicCallRequests=()=>[{}];
 const args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0];
 await assert.rejects(f.port.finalize_reply(...args,f.op('finalize_reply',args)),/unresolved/);assert.deepEqual(f.counts(),{proofs:1,sends:0});
});
test('unit fake: final batch pending/lost acknowledgement observes one original hash',async()=>{
 const f=await fixture();f.set('sendLost',true);f.receipt.status='pending';
 const args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
 assert.equal((await f.port.finalize_reply(...args,op)).status,'pending');const next=await f.create();f.receipt.status='checkpointed';
 assert.equal((await next.finalize_reply(...args,op)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
});

test('pinned SDK gas and transaction types: funded native ceiling preserves exact request and batch with one validated proof',async()=>{
 const {TxExecutionRequest,TxContext}=await import('@aztec-labs/stdlib/tx');
 const f=await fixture(),wallet=f.options.wallet;
 let originalRequest,preparedPayload;
 const create=wallet.createTxExecutionRequestFromPayloadAndFee;
 wallet.createTxExecutionRequestFromPayloadAndFee=async(payload,from,fee)=>{
  await create(payload,from,fee);preparedPayload=payload;
  originalRequest=TxExecutionRequest.from({...await TxExecutionRequest.random(),txContext:new TxContext(31337,1,fee.gasSettings)});
  return originalRequest;
 };
 const prove=wallet.pxe.proveTx;
 wallet.pxe.proveTx=async(request,options)=>{
  assert.equal(request,originalRequest,'the native primitive receives the exact prepared request');
  assert.deepEqual(request.toBuffer(),originalRequest.toBuffer());
  assert.deepEqual(request.txContext.gasSettings.gasLimits,f.maxTxGasLimits);
  assert(request.txContext.gasSettings.getFeeLimit().toBigInt()<10000000000n);
  return prove(request,options);
 };
 const args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],operation=f.op('finalize_reply',args);
 assert.equal((await f.port.finalize_reply(...args,operation)).status,'succeeded');
 assert.deepEqual(preparedPayload.calls.map(call=>call.name),['settle','publish_reply','finish']);
 assert.deepEqual(preparedPayload.calls.map(call=>call.args.map(arg=>arg.toBigInt())),[[BigInt(f.id),0n,120n,88n],[BigInt(f.id),89n,...Array(32).fill(0n),1n,0n,0n],[BigInt(f.id)]]);
 assert.deepEqual(f.feeCounts(),{validations:1,feeQuotes:1,balanceReads:1});assert.deepEqual(f.counts(),{proofs:1,sends:1});
 const record=f.journal().operations[operation.operationId];assert.equal(BigInt(record.maximumFee),f.tx.data.constants.txContext.gasSettings.getFeeLimit().toBigInt());
 assert.deepEqual(record.gas.gasLimits,{daGas:f.tx.data.constants.txContext.gasSettings.gasLimits.daGas,l2Gas:f.tx.data.constants.txContext.gasSettings.gasLimits.l2Gas});
});
test('funded fixed ceiling: exact balance admits; one unit short fails before private work',async()=>{
 const cap=GasSettings.fallback({gasLimits:new Gas(10000,1000000),maxFeesPerGas:new GasFees(2n,3n)}).getFeeLimit().toBigInt();
 for(const [balance,passes] of [[cap,true],[cap-1n,false]]){
  const f=await fixture();f.set('feeBalance',balance);const operation=f.op('finish',[f.id]);
  if(passes){assert.equal((await f.port.finish(f.id,operation)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});}
  else{await assert.rejects(f.port.finish(f.id,operation),error=>error.code==='BB_OPERATOR_FEE_BALANCE_INSUFFICIENT');assert.deepEqual(f.counts(),{proofs:0,sends:0});assert.equal(f.journal().operations[operation.operationId].failure,'operator-fee-balance-insufficient');}
  assert.deepEqual(f.feeCounts(),{validations:passes?1:0,feeQuotes:1,balanceReads:1});
 }
});
test('required native validation, failed validation or altered proven fees prevent broadcast',async()=>{
 for(const boundary of ['missing capability','validation','proven fee']){
  const f=await fixture(),wallet=f.options.wallet;
  if(boundary==='missing capability')delete wallet.pxe.proveTxWithPublicValidation;
  else if(boundary==='validation')wallet.pxe.proveTxWithPublicValidation=async()=>{throw Error('Native public validation failed');};
  else{const prove=wallet.pxe.proveTx;wallet.pxe.proveTx=async(...args)=>{const result=await prove(...args);f.tx.data.constants.txContext.gasSettings=GasSettings.empty();return result;};}
  await assert.rejects(f.port.finish(f.id,f.op('finish',[f.id])),/unresolved/);assert.equal(f.counts().sends,0);
  if(boundary!=='proven fee')assert.equal(f.counts().proofs,0);
 }
});
test('explicit final reply replacement binds all nine original arguments and never repeats',async()=>{
 const f=await replacementFixture('finalize_reply'),original=structuredClone(f.journal().operations[f.operation.operationId]);
 assert.equal((await f.port.replaceDroppedOperation(f.authority)).status,'succeeded');
 const record=f.journal().operations[f.operation.operationId];assert.equal(record.replacement.method,'finalize_reply');
 assert.deepEqual(record.replacement.args,original.args);assert.equal(record.argsDigest,original.argsDigest);assert.equal(record.txHash,original.txHash);
 assert.deepEqual(f.tx.getPublicCallRequestsWithCalldata().map(call=>call.args.length),[4,39,1]);
 assert.deepEqual(f.feeCounts(),{validations:1,feeQuotes:1,balanceReads:1});assert.deepEqual(f.counts(),{proofs:1,sends:1});
 assert.equal((await (await f.create()).replaceDroppedOperation(f.authority)).status,'succeeded');assert.deepEqual(f.counts(),{proofs:1,sends:1});
 f.setOriginal('checkpointed');assert.equal((await f.port.inspectOperation(f.operation.operationId)).txHash,f.originalHash);
 assert.equal(f.journal().operations[f.operation.operationId].includedHistory[0].transactionFee,'7');assert.equal(f.journal().operations[f.operation.operationId].replacement.includedHistory[0].transactionFee,'7');
});
test('explicit final reply replacement refuses altered message authority and pending original',async()=>{
 for(const kind of ['pending','plugin','fields','length','main version','local version','argument digest']){
  const f=await replacementFixture('finalize_reply'),saved=structuredClone(f.store.read()),record=saved.privateBokEscrow.operations[f.operation.operationId];
  if(kind==='pending')f.setOriginal('pending');
  if(kind==='plugin')record.args[4]='invalid';if(kind==='fields')record.args[5].pop();if(kind==='length')record.args[6]=993;if(kind==='main version')record.args[7]=-1;if(kind==='local version')record.args[8]=2**32;
  if(kind==='argument digest')record.args[5][0]=H(8);
  else{record.argsDigest=digest(record.args);f.authority.argsDigest=record.argsDigest;}
  await f.store.write(saved);await assert.rejects(f.port.replaceDroppedOperation(f.authority));assert.deepEqual(f.counts(),{proofs:0,sends:0});
 }
});
test('final reply replacement consumed before simulation/proof failure cannot be automatically retried',async()=>{
 const f=await replacementFixture('finalize_reply');f.set('proofFailed',true);
 await assert.rejects(f.port.replaceDroppedOperation(f.authority),/unresolved/);assert.deepEqual(f.counts(),{proofs:1,sends:0});
 await (await f.create()).replaceDroppedOperation(f.authority);assert.deepEqual(f.counts(),{proofs:1,sends:0});assert.equal(f.feeCounts().validations,1);
});

test('proposed reservation permits paid admission but a reorg fences it and final observation still waits checkpoint',async()=>{
 const f=await fixture({admissionTier:'proposed'}),node=f.options.node,original=node.getBlock;const selectors=[];
 node.getBlock=async tag=>{selectors.push(tag);assert.notEqual(tag,'checkpointed','Admission must not wait for checkpoint');return original(tag);};
 f.row.available=0n;f.row.reserved=f.row.budget;
 const guard=await f.port.assertUsable(f.id,0,1000n);assert.equal(guard.finality,'proposed');assert(selectors.includes('proposed'));
 f.set('blockMismatch',true);await assert.rejects(f.port.assertUsable(f.id,0,1000n),/changed/);f.set('blockMismatch',false);
 node.getBlock=original;f.receipt.status='proposed';let waited=false;
 f.sdk.waitForTx=async(_node,_hash,options)=>{assert.equal(options.waitForStatus,'checkpointed');assert.equal(options.timeout,0);waited=true;f.receipt.status='checkpointed';return f.receipt;};
 const args=[f.id,0,1n,H(91)],op=f.op('settle',args);
 const result=await f.port.settle(...args,op);assert.equal(waited,true);assert.equal(result.status,'succeeded');assert.equal(result.canonical,true);
});

test('exact unsent final batch retries on a later invocation without replaying any submission',async()=>{
 const f=await fixture(),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
 f.set('proofFailed',true);await assert.rejects(f.port.finalize_reply(...args,op),/unresolved/);
 assert.deepEqual(f.counts(),{proofs:1,sends:0});
 assert.deepEqual(await f.port.inspectOperation(op.operationId),{status:'not-submitted',canonical:false,method:'finalize_reply',argsDigest:op.argsDigest});
 const reopened=await f.create();await assert.rejects(reopened.finalize_reply(...args,op),/unresolved/);
 assert.deepEqual(f.counts(),{proofs:2,sends:0},'one attempt per explicit call, no inner retry');
 f.set('proofFailed',false);assert.equal((await reopened.finalize_reply(...args,op)).status,'succeeded');
 assert.deepEqual(f.counts(),{proofs:3,sends:1});
 await (await f.create()).finalize_reply(...args,op);assert.deepEqual(f.counts(),{proofs:3,sends:1});
 assert(!JSON.stringify(f.journal()).includes('private witness'));
});

test('unsent final batch retry rechecks lease class and exact arguments before proof',async()=>{
 for(const change of ['lease','class','args']){
  const f=await fixture(),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
  f.set('proofFailed',true);await assert.rejects(f.port.finalize_reply(...args,op));f.set('proofFailed',false);
  if(change==='lease')f.set('held',false);if(change==='class')f.set('class',H(999));if(change==='args')args[2]=121n;
  await assert.rejects(f.port.finalize_reply(...args,op));assert.deepEqual(f.counts(),{proofs:1,sends:0},change);
 }
});

test('any submission or replacement evidence prevents unsent finalization re-entry',async()=>{
 for(const key of ['txHash','transactionSha256','submissionError','replacement','recoveryAttempted']){
  const f=await fixture(),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
  f.set('proofFailed',true);await assert.rejects(f.port.finalize_reply(...args,op));f.set('proofFailed',false);
  const value=structuredClone(f.store.read());value.privateBokEscrow.operations[op.operationId][key]=key==='txHash'?H(56):key==='transactionSha256'?'a'.repeat(64):key==='replacement'?{}:true;await f.store.write(value);
  try{const result=await f.port.finalize_reply(...args,op);assert.notEqual(result.status,'not-submitted');}catch{}
  assert.deepEqual(f.counts(),{proofs:1,sends:0},key);
 }
});

test('successful proposed final reply releases at exact inclusion with receipt-block accounting',async()=>{
 const f=await fixture({admissionTier:'proposed'}),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
 f.receipt.status='proposed';f.sdk.waitForTx=async()=>assert.fail('Already included reply must not wait for checkpoint');
 const result=await f.port.finalize_reply(...args,op);
 assert.equal(result.status,'included');assert.equal(result.canonical,true);assert.equal(result.accounting.anchor.number,10);assert.equal(result.accounting.anchor.hash,H(57));assert.equal(result.accounting.anchor.finality,'proposed');
 assert.equal(result.accounting.request.budget,'1000');assert.doesNotThrow(()=>JSON.stringify(f.journal()));assert.deepEqual(f.counts(),{proofs:1,sends:1});
 const reopened=await f.create();assert.equal((await reopened.inspectOperation(op.operationId)).status,'included');
 f.receipt.status='checkpointed';const confirmed=await reopened.inspectOperation(op.operationId);assert.equal(confirmed.status,'succeeded');assert.equal(confirmed.txHash,result.txHash);assert.equal(confirmed.blockHash,result.blockHash);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('native final reply waiter selects proposed but a proposed revert still requires checkpoint',async()=>{
 for(const reverted of [false,true]){
  const f=await fixture({admissionTier:'proposed'}),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args),waits=[];
  f.receipt.status='pending';f.sdk.waitForTx=async(_node,_hash,options)=>{waits.push(options.waitForStatus);assert.equal(options.timeout,0);f.receipt.status=options.waitForStatus;f.receipt.executionResult=reverted?'reverted':'success';return f.receipt;};
  const result=await f.port.finalize_reply(...args,op);assert.equal(result.status,reverted?'failed':'included');assert.deepEqual(waits,reverted?['proposed','checkpointed']:['proposed']);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 }
});
test('proposed final receipt cannot survive changed canonical block or accounting class',async()=>{
 for(const change of ['block','class']){
  const f=await fixture({admissionTier:'proposed'}),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
  f.receipt.status='proposed';await f.port.finalize_reply(...args,op);f.set(change==='block'?'blockMismatch':'class',change==='block'?true:H(999));
  await assert.rejects(f.port.inspectOperation(op.operationId),/mismatch|changed/);assert.deepEqual(f.counts(),{proofs:1,sends:1});
 }
});

import {serializeHostedEscrow} from '../main.mjs';

for(const failure of ['none','network','block','both'])test(`operator observation wave drains held public reads: ${failure}`,{timeout:3000},async()=>{
 const f=await fixture(),network=Promise.withResolvers(),block=Promise.withResolvers(),entered=Promise.withResolvers();let netStarted=false,blockStarted=false,done=false,storage=0;
 const node=f.options.node,getInfo=node.getNodeInfo,getBlock=node.getBlock,getStorage=node.getPublicStorageAt;
 const mark=()=>{if(netStarted&&blockStarted)entered.resolve();};
 const networkFailure=Error('network observation failed'),blockFailure=Error('block observation failed');
 node.getNodeInfo=async()=>{netStarted=true;mark();await network.promise;if(['network','both'].includes(failure))throw networkFailure;return getInfo();};
 node.getBlock=async tag=>{if(typeof tag==='string'){blockStarted=true;mark();await block.promise;if(['block','both'].includes(failure))throw blockFailure;}return getBlock(tag);};
 node.getPublicStorageAt=(...args)=>{storage++;return getStorage(...args);};
 const work=f.port.request(f.id);work.then(()=>done=true,()=>done=true);await entered.promise;assert.equal(storage,0);
 await assert.rejects(f.port.request(f.id),/already running/,'raw per-request exclusion remains');
 if(failure==='block')block.resolve();else network.resolve();await new Promise(setImmediate);assert.equal(done,false);assert.equal(storage,0);
 network.resolve();block.resolve();
 if(failure==='none')assert.equal((await work).canonical,true);else await assert.rejects(work,e=>e===(failure==='block'?blockFailure:networkFailure));
 assert.deepEqual(f.counts(),{proofs:0,sends:0});
});
for(const change of ['network','class','operator','canonical','lease'])test(`operator observation wave retains ${change} authority`,async()=>{
 const f=await fixture();if(change==='network')f.set('chainId','2');if(change==='class')f.set('class',H(99));if(change==='operator')f.set('operator',H(99));if(change==='canonical')f.set('blockMismatch',true);if(change==='lease')f.set('held',false);
 await assert.rejects(f.port.request(f.id));assert.deepEqual(f.counts(),{proofs:0,sends:0});
});
for(const failure of ['none','wait','lease'])test(`hosted actual escrow ports keep request journal order while other public reads bypass held native wait: ${failure}`,{timeout:3000},async()=>{
 const a=await fixture(),b=await fixture();let tail=Promise.resolve(),queued=0;
 const lane=fn=>{queued++;const next=tail.then(fn);tail=next.catch(()=>{});return next;};
 const one=serializeHostedEscrow(a.port,lane),two=serializeHostedEscrow(b.port,lane),entered=Promise.withResolvers(),gate=Promise.withResolvers();
 a.receipt.status='pending';a.sdk.waitForTx=async()=>{entered.resolve();await gate.promise;if(failure==='wait')throw Error('native observation unavailable');return a.receipt;};
 const first=one.finish(a.id,a.op('finish',[a.id]));const observed=first.then(value=>({value}),error=>({error}));await entered.promise;
 assert.equal((await two.request(b.id)).canonical,true,'another request can read while this transaction waits');assert.equal(queued,1);
 let sameDone=false;const same=one.request(a.id).then(value=>{sameDone=true;return {value};},error=>{sameDone=true;return {error};});
 const second=two.finish(b.id,b.op('finish',[b.id]));await new Promise(setImmediate);assert.equal(sameDone,false);assert.equal(b.counts().proofs,0);assert.equal(queued,2);
 if(failure==='none')a.receipt.status='checkpointed';if(failure==='lease')a.set('held',false);gate.resolve();
 const firstResult=await observed;if(failure==='none')assert.equal(firstResult.value.status,'succeeded');else assert(firstResult.error);
 const sameResult=await same;if(failure==='lease')assert.match(sameResult.error.message,/lost lease/);else assert.equal(sameResult.value.canonical,true);
 assert.equal((await second).status,'succeeded');assert.deepEqual(a.counts(),{proofs:1,sends:1});assert.deepEqual(b.counts(),{proofs:1,sends:1});
});
test('hosted public native waiter holds its request order without occupying the shared wallet lane',{timeout:3000},async()=>{
 const a=await fixture(),b=await fixture();a.receipt.status='pending';const intent=a.op('finish',[a.id]);
 assert.equal((await a.port.finish(a.id,intent)).status,'pending');
 let tail=Promise.resolve(),queued=0;const lane=fn=>{queued++;const next=tail.then(fn);tail=next.catch(()=>{});return next;};
 const one=serializeHostedEscrow(a.port,lane),two=serializeHostedEscrow(b.port,lane),entered=Promise.withResolvers(),held=Promise.withResolvers();
 a.sdk.waitForTx=async()=>{entered.resolve();await held.promise;return a.receipt;};
 const wait=one.waitForOperation(intent.operationId);await entered.promise;assert.equal(queued,0);
 let sameDone=false;const same=one.finish(a.id,intent).then(result=>{sameDone=true;return result;});
 assert.equal((await two.finish(b.id,b.op('finish',[b.id]))).status,'succeeded');assert.equal(sameDone,false);assert.equal(queued,1);
 a.receipt.status='checkpointed';held.resolve();assert.equal((await wait).status,'succeeded');assert.equal((await same).status,'succeeded');
 assert.equal(queued,2);assert.deepEqual(a.counts(),{proofs:1,sends:1},'same original transaction was inspected, never sent again');
});

test('cold direct operator proof synchronizes before fees and proof; submitted reconciliation does not sync',async()=>{
 const f=await fixture(),args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0],op=f.op('finalize_reply',args);
 const fee=f.options.wallet.completeFeeOptions,prove=f.options.wallet.pxe.proveTxWithPublicValidation;
 f.options.wallet.completeFeeOptions=async(...values)=>{assert.equal(f.syncCount(),1,'sync before fee');return fee(...values);};
 f.options.wallet.pxe.proveTxWithPublicValidation=async(...values)=>{assert.equal(f.syncCount(),1,'native anchor before proof');return prove(...values);};
 assert.equal((await f.port.finalize_reply(...args,op)).status,'succeeded');assert.equal(f.syncCount(),1);
 await (await f.create()).finalize_reply(...args,op);assert.equal(f.syncCount(),1);assert.deepEqual(f.counts(),{proofs:1,sends:1});
});
test('failed native sync prevents fee preparation, proof and send without exposing private error',async()=>{
 const f=await fixture();f.set('syncFailed',true);const args=[f.id,0,120n,H(88),H(89),Array(32).fill(H(0)),1,0,0];
 await assert.rejects(f.port.finalize_reply(...args,f.op('finalize_reply',args)),/operation unresolved/);
 assert.deepEqual(f.counts(),{proofs:0,sends:0});assert.equal(f.feeCounts().feeQuotes,0);assert.equal(f.syncCount(),1);assert(!JSON.stringify(f.journal()).includes('private sync details'));
});
test('successive new operator actions each refresh their native anchor',async()=>{
 const f=await fixture();await f.port.reserve(f.id,0,400n,f.op('reserve',[f.id,0,400n]));
 await f.port.finish(f.id,f.op('finish',[f.id]));assert.equal(f.syncCount(),2);assert.deepEqual(f.counts(),{proofs:2,sends:2});
});
