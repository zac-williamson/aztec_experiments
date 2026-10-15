import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = (value, bytes = 32) => {
 const text = String(value); assert(new RegExp('^0x[0-9a-f]{' + bytes * 2 + '}$').test(text), 'Invalid public identifier'); return text;
};
const integer = (value, bits) => {
 assert(typeof value==='bigint'||(typeof value==='number'&&Number.isSafeInteger(value))||(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)), 'Invalid integer input');
 const n = BigInt(value); assert(n >= 0n && n < 2n ** BigInt(bits), 'Invalid unsigned value'); return n; };
const amount = value => { assert(typeof value === 'bigint', 'Amount must be bigint'); return integer(value, 128); };
const sequence = value => { assert(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff, 'Invalid call sequence'); return value; };
const statuses = ['pending', 'proposed', 'checkpointed', 'proven', 'finalized', 'dropped'];
const methods = ['reserve','settle','close_uncertain','reconcile','finish','publish_reply'];
const requestFields = ['state','invocation_hash','sequence','deadline','budget','available','reserved','charged','refunded','primary_refund','secondary_refund','primary_done','secondary_done','receipt'];

/** Existing pinned V6 SDK only; no wallet/node/service lifecycle is created here. */
export async function createPrivateBokEscrow(options) {
 const [{Contract}, {Fr}, {AztecAddress}, {TxHash}, {getContractClassFromArtifact}, {deriveStorageSlotInMap}, {getFunctionReturnType}, {BBBundlePrivateKernelProver}, {BBLazyPrivateKernelProver}] = await Promise.all([
  import('@aztec-labs/aztec.js/contracts'), import('@aztec-labs/foundation/curves/bn254'),
  import('@aztec-labs/stdlib/aztec-address'), import('@aztec-labs/stdlib/tx'),
  import('@aztec-labs/stdlib/contract'), import('@aztec-labs/stdlib/hash'), import('@aztec-labs/stdlib/abi'),
  import('@aztec-labs/bb-prover/client/bundle'), import('@aztec-labs/bb-prover/client/lazy'),
 ]);
 return createPrivateBokEscrowFactory({Contract, Fr, AztecAddress, TxHash, getContractClassFromArtifact, deriveStorageSlotInMap, getFunctionReturnType,
  isTrustedProver: prover => prover instanceof BBBundlePrivateKernelProver || prover instanceof BBLazyPrivateKernelProver})(options);
}

/** Dependency seam for labelled unit fakes. Production callers use createPrivateBokEscrow.
 * artifact is a normal processed, trusted release artifact, NOT user-supplied code.
 * store is durable operations.fileState; lease.assertHeld() belongs to its exclusive
 * parent owner. Both must survive/reconcile an unknown write outcome before reuse.
 * Only public transaction hashes, arguments and observations are persisted here.
 * V6 derived Packable assigns one field/member (types/src/traits/packable.nr),
 * PublicMutable stores consecutive slots, PublicImmutable puts the value first,
 * and Map uses the installed deriveStorageSlotInMap. A changed contract needs a
 * reviewed adapter: no latest-state simulation is called a finalized read.
 */
export function createPrivateBokEscrowFactory(sdk) {
 return async function({node,wallet,artifact,address,operator,board,network,requestId,target,store,lease,
  development=false,proofMode='real',timeoutMs=60000,pollMs=1000}) {
  const {Contract,Fr,AztecAddress,TxHash,getContractClassFromArtifact,deriveStorageSlotInMap,getFunctionReturnType,isTrustedProver} = sdk;
  assert.equal(typeof lease?.assertHeld, 'function'); assert.equal(typeof store?.read, 'function'); assert.equal(typeof store?.write, 'function');
  assert.equal(typeof development, 'boolean'); assert(['real','disabled'].includes(proofMode));
  assert(proofMode === (development ? 'disabled' : 'real'), 'Native proof policy requires disabled development and real testnet');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000);
  assert(Number.isSafeInteger(pollMs) && pollMs > 0 && pollMs <= timeoutMs);
  const chainId = String(integer(network.chainId, 64)), version = String(integer(network.rollupVersion, 64));
  assert(BigInt(chainId) > 0n && BigInt(version) > 0n); assert.equal(chainId, development ? '31337' : '11155111');
  const rollup = hex(String(network.rollupAddress).toLowerCase(),20); assert(BigInt(rollup)>0n,'Zero rollup address');
  const addr = AztecAddress.fromStringUnsafe(hex(address)), op = AztecAddress.fromStringUnsafe(hex(operator));
  const boardAddress = hex(board), id = hex(requestId), invocation = hex(target);
  for (const value of [address,operator,boardAddress,id,invocation]) assert(BigInt(String(value)) > 0n);
  const idField = Fr.fromString(id); Fr.fromString(invocation);
  assert.equal(artifact.name,'PrivateBok');
  const classId = (await getContractClassFromArtifact(artifact)).id.toString();
  const finality = development ? 'checkpointed' : 'finalized';
  const identity = Object.freeze({network:`eip155-${chainId}:aztec-${version}:${rollup}`,escrow:addr.toString()});
  const binding = {...identity,requestId:id,target:invocation,operator:op.toString(),board:boardAddress,classId,finality,proofMode};
  for (const name of ['operator','board','l1_chain','version','requests']) assert(artifact.storageLayout[name]?.slot, 'Missing pinned storage layout');
  const layout = getFunctionReturnType(artifact.nonDispatchPublicFunctions.find(fn => fn.name === 'request'));
  // Match the exact source-backed, unpacked Request ABI before reading storage.
  assert.equal(layout?.kind,'struct'); assert.deepEqual(layout.fields.map(f=>f.name),requestFields);
  const widths={state:8,sequence:32,deadline:64,budget:128,available:128,reserved:128,charged:128,refunded:128};
  for(const {name,type} of layout.fields){
   if(widths[name])assert.deepEqual(type,{kind:'integer',sign:'unsigned',width:widths[name]},'Request integer layout changed');
   else assert.equal(type.kind,name.endsWith('_done')?'boolean':'field','Request field layout changed');
  }
  const requestSlot = await deriveStorageSlotInMap(artifact.storageLayout.requests.slot,idField);
  let busy=false,poisoned=false;
  const held = async()=>{assert(!poisoned,'Store write outcome unresolved'); await lease.assertHeld();};
  const journal=()=>{
   const value=store.read().privateBokEscrow;
   if(value){assert.equal(value.schemaVersion,1); assert.deepEqual(value.binding,binding,'Escrow journal identity mismatch');}
   return value ?? {schemaVersion:1,binding,operations:{}};
  };
  const save=async next=>{await held();try{await store.write({...store.read(),privateBokEscrow:next});}catch{poisoned=true;throw Error('Escrow journal persistence unresolved');}};
  const update=async(key,changes)=>{const j=journal();await save({...j,operations:{...j.operations,[key]:{...j.operations[key],...changes}}});};
  const exclusive=fn=>async(...args)=>{assert(!busy,'Escrow operation already running');busy=true;try{await held();return await fn(...args);}finally{busy=false;}};
  const scope=value=>assert.equal(String(value),id,'Escrow request mismatch');
  const checkNetwork=async()=>{
   await held();const info=await node.getNodeInfo();
   // Pinned PXE private-in-TypeScript fields remain ordinary JS properties. Do not
   // accept an unknown/custom prover or mistake a nonempty development blob for a proof.
   assert.equal(wallet.pxe?.proverEnabled,!development,'PXE native proof policy mismatch');
   if(!development){
    const prover=wallet.pxe.proofCreator;
    assert(isTrustedProver(prover),'Unsupported local proof creator');
    assert(prover.proofsEnabled===undefined||prover.proofsEnabled===true,'PXE proof mode mismatch');
   }
   assert.equal(info.realProofs,proofMode==='real','Node proof verification mode mismatch');
   assert.equal(String(info.l1ChainId),chainId,'Chain changed'); assert.equal(String(info.rollupVersion),version,'Rollup version changed');
   assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),rollup,'Rollup changed');
  };
  const anchored=async(tag=finality)=>{
   await checkNetwork(); const b=await node.getBlock(tag); assert(b?.header && Number.isSafeInteger(Number(b.number)),'Canonical block unavailable');
   const anchor={number:b.number,hash:b.hash}; hex(b.hash); const instance=await node.getContract(addr,anchor);
   assert.equal(String(instance?.currentContractClassId),classId,'Escrow class mismatch');
   const read=slot=>node.getPublicStorageAt(anchor,addr,slot);
   for(const [name,expected] of [['operator',BigInt(op.toString())],['board',BigInt(boardAddress)],['l1_chain',BigInt(chainId)],['version',BigInt(version)]])
    assert.equal((await read(artifact.storageLayout[name].slot)).toBigInt(),expected,'Escrow configuration mismatch');
   const fields=[];for(let i=0;i<requestFields.length;i++) fields.push((await read(new Fr(requestSlot.toBigInt()+BigInt(i)))).toBigInt());
   const r=Object.fromEntries(requestFields.map((name,i)=>[name,fields[i]]));
   r.state=Number(integer(r.state,8)); r.sequence=Number(integer(r.sequence,32)); r.deadline=integer(r.deadline,64);
   for(const name of ['budget','available','reserved','charged','refunded']) r[name]=integer(r[name],128);
   for(const name of ['primary_done','secondary_done']){assert(r[name]===0n||r[name]===1n);r[name]=r[name]===1n;}
   for(const name of ['invocation_hash','primary_refund','secondary_refund','receipt'])r[name]=new Fr(r[name]).toString();
   assert([1,2,3,4].includes(r.state),'Request unavailable'); assert.equal(r.invocation_hash,invocation,'Invocation target mismatch');
   assert(r.budget>0n && r.available+r.reserved+r.charged+r.refunded===r.budget,'Request conservation failure');
   assert.equal(String((await node.getBlock(b.number))?.hash),String(b.hash),'Canonical block changed');
   return {canonical:true,request:r,anchor:{number:Number(b.number),hash:String(b.hash),timestamp:String(integer(b.header.globalVariables.timestamp,64)),finality},instance};
  };
  const initial=await anchored();await wallet.registerContract(initial.instance,artifact);
  const contract=await Contract.at(addr,artifact,wallet); if(!store.read().privateBokEscrow)await save(journal());else journal();
  const inspect=async operationId=>{
   assert(/^[0-9a-f]{64}$/.test(operationId));await held();
   const record=journal().operations[operationId];if(!record){await checkNetwork();return {status:'absent'};}
   assert(methods.includes(record.method) && record.args?.[0]===id,'Invalid recorded operation');
   assert.equal(digest(record.args),record.argsDigest,'Recorded arguments changed');
   // Current authority expires before the new read. Historical rows are evidence,
   // never a substitute for receipt availability, canonicality or finality now.
   await update(operationId,{result:{status:'pending',canonical:false},observation:{status:'inspecting'}});
   await checkNetwork();
   if(!record.txHash)return {status:'pending',method:record.method,argsDigest:record.argsDigest,canonical:false};
   let receipt;
   try{receipt=await node.getTxReceipt(TxHash.fromString(record.txHash));}
   catch{await update(operationId,{observation:{status:'unavailable'}});return {status:'pending',canonical:false};}
   const observation={status:statuses.includes(receipt?.status)?receipt.status:'invalid',
    ...(typeof receipt?.transactionFee==='bigint'?{transactionFee:String(receipt.transactionFee)}:{}),
    ...(['success','reverted'].includes(receipt?.executionResult)?{executionResult:receipt.executionResult}:{})};
   // Preserve consumed fees and failure category before hash/finality assertions.
   await update(operationId,{observation});
   assert.equal(String(receipt.txHash),record.txHash,'Receipt hash mismatch');assert(statuses.includes(receipt.status),'Invalid receipt status');
   if(['pending','dropped'].includes(receipt.status))return {status:receipt.status==='dropped'?'failed':'pending',canonical:false,method:record.method,argsDigest:record.argsDigest};
   const block=await node.getBlock(receipt.blockNumber),effect=await node.getTxEffect(TxHash.fromString(record.txHash));
   if(!block||!effect)return {status:'pending',canonical:false};
   observation.blockNumber=Number(receipt.blockNumber);observation.blockHash=String(receipt.blockHash);
   observation.effectSha256=bytesHash(effect.data.toBuffer());await update(operationId,{observation});
   assert.equal(String(block.hash),String(receipt.blockHash),'Receipt block mismatch');
   assert.equal(String(effect.l2BlockHash),String(block.hash),'Effect block mismatch'); assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
   assert.equal(String(effect.data.txHash),record.txHash,'Effect hash mismatch');
   assert(typeof receipt.transactionFee==='bigint'&&receipt.transactionFee>=0n,'Missing actual fee');
   assert.equal(effect.data.transactionFee.toBigInt(),receipt.transactionFee,'Effect fee mismatch');
   assert(['success','reverted'].includes(receipt.executionResult));assert.equal(effect.data.revertCode.isOK(),receipt.executionResult==='success','Effect result mismatch');
   assert.equal(String((await node.getBlock(receipt.blockNumber))?.hash),String(receipt.blockHash),'Receipt block changed during inspection');
   const included={...observation,txHash:record.txHash,canonicalAtObservation:true};
   const history=journal().operations[operationId].includedHistory??[];
   if(!history.some(row=>digest(row)===digest(included))){
    // Stop on excessive distinct observations instead of silently dropping fees.
    assert(history.length<8,'Included receipt history limit; retain journal for reconciliation');
    await update(operationId,{includedHistory:[...history,included]});
   }
   if(finality==='finalized'?receipt.status!=='finalized':!['checkpointed','proven','finalized'].includes(receipt.status))return {status:'pending',canonical:false,method:record.method,argsDigest:record.argsDigest};
   const tip=await node.getBlock(finality);assert(tip&&Number(tip.number)>=Number(receipt.blockNumber),'Finality unavailable');
   // Recheck the configured class and state against the same required finality.
   await anchored();
   assert.equal(String((await node.getBlock(receipt.blockNumber))?.hash),String(receipt.blockHash),'Receipt block changed during inspection');
   const result={status:receipt.executionResult==='success'?'succeeded':'failed',canonical:true,method:record.method,argsDigest:record.argsDigest,
    txHash:record.txHash,transactionFee:String(receipt.transactionFee),blockNumber:observation.blockNumber,blockHash:observation.blockHash};
   await update(operationId,{observation:{...observation,canonical:true},result});return result;
  };
  const usable=async(request,callId,maximum)=>{
   scope(request);sequence(callId);amount(maximum);
   // A finalized read alone is insufficient: require the exact recorded reserve transaction.
   const reservation=Object.entries(journal().operations).find(([,r])=>r.method==='reserve'&&r.argsDigest===digest([id,callId,String(maximum)]));
   assert(reservation,'Reservation intent missing');assert.equal((await inspect(reservation[0])).status,'succeeded','Reservation not finalized');
   const r=await anchored(),latest=await anchored('latest');
   for(const row of [r,latest])assert(row.request.state===2&&row.request.sequence===callId&&row.request.reserved===maximum&&maximum>0n,'Reservation not canonical');
   await held();const now=BigInt(Math.floor(Date.now()/1000)),chainTime=BigInt(latest.anchor.timestamp);
   assert((now>chainTime?now:chainTime)+180n<latest.request.deadline,'Reservation too close to expiry');
   return {canonical:true,deadline:String(latest.request.deadline),finality,controlledSettlement:development};
  };
  const send=async(method,args,operation)=>{
   scope(args[0]);const operationId=operation?.operationId,argsDigest=digest(args.map(v=>typeof v==='bigint'?String(v):v));
   assert(/^[0-9a-f]{64}$/.test(operationId));assert.equal(operation.argsDigest,argsDigest,'Operation arguments mismatch');
   const old=journal().operations[operationId];
   if(old){assert.equal(old.method,method);assert.equal(old.argsDigest,argsDigest);return inspect(operationId);}
   assert(Object.keys(journal().operations).length<256,'Escrow operation limit');
   await anchored();
   await update(operationId,{method,argsDigest,args:args.map(v=>typeof v==='bigint'?String(v):v),phase:'preparing',proofMode});
   try{
    const encoded=args.map((v,i)=>Array.isArray(v)?v.map(value=>Fr.fromString(value)):i===0||(method==='publish_reply'&&i===1)||((method==='settle'||method==='reconcile')&&i===3)?Fr.fromString(v):v);
    const interaction=contract.methods[method](...encoded),payload=await interaction.request({from:op,additionalScopes:[]});
    assert.equal(payload.calls.length,1);const call=payload.calls[0];
    assert.equal(call.name,method);assert.equal(String(call.to),String(addr));assert.equal(call.type,'public');assert.equal(call.isStatic,false);
    assert.deepEqual(call.args.map(x=>x.toBigInt()),args.flat().map(x=>BigInt(x)),'Payload arguments changed');
    const fee=await wallet.completeFeeOptions({from:op,feePayer:payload.feePayer});
    const txRequest=await wallet.createTxExecutionRequestFromPayloadAndFee(payload,op,fee);
    const proven=await wallet.pxe.proveTx(txRequest,{scopes:wallet.scopesFrom(op,[]),senderForTags:wallet.senderForTagsFrom(op)});
    assert(!proven.chonkProof.isEmpty(),'Missing proof');const tx=await proven.toTx();
    assert.equal(String(tx.data.feePayer),String(op),'Operator fee payer changed');
    assert.equal(tx.data.constants.txContext.chainId.toBigInt(),BigInt(chainId),'Proven chain mismatch');
    assert.equal(tx.data.constants.txContext.version.toBigInt(),BigInt(version),'Proven version mismatch');
    const calls=tx.getPublicCallRequestsWithCalldata();assert.equal(calls.length,1,'Unexpected public calls');
    assert.equal(String(calls[0].request.contractAddress),String(addr));assert.equal(String(calls[0].request.msgSender),String(op));
    assert.equal(String(calls[0].functionSelector),String(call.selector));assert.deepEqual(calls[0].args.map(x=>x.toBigInt()),call.args.map(x=>x.toBigInt()));
    const hash=hex(tx.getTxHash());
    await anchored();await lease.assertHeld();
    await update(operationId,{phase:'submission-unknown',txHash:hash,transactionSha256:bytesHash(tx.toBuffer())});
    await held();
    // An exception may mean accepted-but-response-lost. Never send this action again.
    try{await node.sendTx(tx);}catch{await update(operationId,{submissionError:true});}
    const end=Date.now()+timeoutMs;
    do{const result=await inspect(operationId);if(result.status==='succeeded'||result.status==='failed')return result;
     if(Date.now()>=end)break;await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,end-Date.now())));
    }while(Date.now()<end);
    return {status:'pending',canonical:false,method,argsDigest,txHash:hash};
   }catch{if(!poisoned)await update(operationId,{failure:'operation-unresolved'});throw Error('Escrow operation unresolved; inspect original intent');}
  };
  const port={identity,mode:Object.freeze({proofMode,nodeVerifiesProofs:proofMode==='real',pxeProofMode:proofMode,finality,controlledSettlement:development}),
   request:exclusive(async value=>{scope(value);const {instance,...result}=await anchored();return result;}),
   assertUsable:exclusive(usable),inspectOperation:exclusive(inspect),
   reserve:exclusive((request,callId,maximum,operation)=>send('reserve',[request,sequence(callId),amount(maximum)],operation)),
   settle:exclusive((request,callId,actual,receipt,operation)=>send('settle',[request,sequence(callId),amount(actual),hex(receipt)],operation)),
   close_uncertain:exclusive((request,operation)=>send('close_uncertain',[request],operation)),
   reconcile:exclusive((request,callId,actual,receipt,operation)=>send('reconcile',[request,sequence(callId),amount(actual),hex(receipt)],operation)),
   finish:exclusive((request,operation)=>send('finish',[request],operation)),
   publish_reply:exclusive((request,pluginId,fields,length,mainVersion,localVersion,operation)=>{
    assert(Array.isArray(fields)&&fields.length===32);const message=fields.map(value=>hex(value));
    assert(Number.isSafeInteger(length)&&length>0&&length<=992);
    return send('publish_reply',[request,hex(pluginId),message,Number(integer(length,16)),sequence(mainVersion),sequence(localVersion)],operation);
   }),
  };
  return Object.freeze(port);
 };
}
