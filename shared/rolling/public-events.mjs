// Public-only V6 Rolling decoding. No wallet, private account or personalized RPC.
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {decodeFromAbi, decodeFunctionSignature, EventSelector} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {computeLogTag} from '@aztec-labs/stdlib/hash';
import {DomainSeparator, FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH} from '@aztec-labs/constants';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {TxHash, TxStatus, TxExecutionResult} from '@aztec-labs/stdlib/tx';
import {nameRegistration, NAME_DOMAIN} from './name-policy.mjs';
export const ROLLING_EVENTS = Object.freeze(['ModeratorTransferred','NameRegistered','MainPolicyPublished','SubboardCreated','SubboardRejected',
  'PostTipKey','PostPublished','PostRemoved','PluginConfigured','PluginInvoked','PluginReplyPublished','LikeChanged','BioPublished','AvatarPublished','AvatarRemoved']);
const verified = new WeakSet();
export const isRollingEvent = event => verified.has(event);
export const rollingError = () => Object.assign(Error('Rolling public history is invalid or unavailable.'), {code:'ROLLING_PUBLIC_INVALID'});
const check = value => {if (!value) throw rollingError();};
const hex = (value, bytes) => typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${bytes*2}}$`).test(value);
const scalar = value => {check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)); const n=BigInt(value);check(n<Fr.MODULUS);return n;};
const nonzero = value => {check(scalar(value)>0n);};
const integer = (v,bits) => {const n=scalar(v);check(n<1n<<BigInt(bits));return n;};
const exact = (object,keys) => {check(object&&Object.getPrototypeOf(object)===Object.prototype);const own=Reflect.ownKeys(object);check(own.every(k=>typeof k==='string')&&own.sort().join()===keys.slice().sort().join());for(const k of own)check(Object.hasOwn(Object.getOwnPropertyDescriptor(object,k),'value'));};
const freeze = value => {if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const hash = async (fields,domain) => (await poseidon2HashWithSeparator(fields.map(BigInt),domain)).toBigInt().toString();
export function unpackRollingText(fields,length,maximum,required=true) {
  check(Array.isArray(fields) && fields.length<=32);const count=Number(integer(length,16));check(count<=maximum && count<=fields.length*31 && (!required||count>0));
  const bytes=new Uint8Array(fields.length*31);
  fields.forEach((field,i)=>{let n=scalar(field);check(n<1n<<248n);for(let j=30;j>=0;j--){bytes[i*31+j]=Number(n&255n);n>>=8n;}});
  check(bytes.slice(count).every(v=>v===0) && bytes.slice(0,count).every(v=>v!==0));
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.slice(0,count));
}
// A separate binary boundary: never relax the 32-field text decoder or decode
// image bytes as UTF-8. Length distinguishes content zeros from canonical padding.
export function unpackRollingAvatar(fields,length) {
  check(Array.isArray(fields)&&fields.length===265);const count=Number(integer(length,16));check(count<=8192);
  const bytes=new Uint8Array(265*31);
  fields.forEach((field,i)=>{let n=scalar(field);check(n<1n<<248n);for(let j=30;j>=0;j--){bytes[i*31+j]=Number(n&255n);n>>=8n;}});
  check(bytes.subarray(count).every(v=>v===0));return bytes.slice(0,count);
}
const shapes={ModeratorTransferred:['schema','previous','successor'],NameRegistered:['schema','name_id','first_length','first','last_length','last'],MainPolicyPublished:['schema','version','digest','length','rules'],
 SubboardCreated:['schema','subboard_id','slug_length','slug','name_length','name','description_length','description','local_policy_version','rules_length','rules','rules_digest','main_policy_version','metadata_digest'],
 SubboardRejected:['schema','subboard_id','main_policy_version','local_policy_version','reason_length','reason','reason_digest'],
 PostTipKey:['schema','post','key'],
 PostPublished:['schema','id','record','timestamp','main_policy_version','local_policy_version','length','message'],
 PostRemoved:['schema','id','policy_version','penalized','reason_length','reason'],PluginConfigured:['schema','plugin_id','adapter','enabled'],
 PluginInvoked:['schema','plugin_id','post_id','request_id','target'],PluginReplyPublished:['schema','plugin_id','request_id','post_id','parent_id','target'],
 LikeChanged:['schema','post','tag','active','count'],
 BioPublished:['schema','name_id','version','length','digest','content','trailer'],
 AvatarPublished:['schema','name_id','version','width','height','length','digest','data','trailer'],
 AvatarRemoved:['schema','name_id','avatar_version','avatar_digest','main_policy_version','reason_digest','length','reason'],
 AccountingChanged:['request_id','state','sequence','budget','available','reserved','charged','refunded','trailer']};
export function validateRollingScope(scope) {
  exact(scope,['chainId','rollupVersion','rollupAddress','boardAddress','classId',...(Object.hasOwn(scope??{},'bok')?['bok']:[])]);
  check(integer(scope.chainId,64)>0n && integer(scope.rollupVersion,32)>0n && hex(scope.rollupAddress,20) && BigInt(scope.rollupAddress)>0n);
  for(const k of ['boardAddress','classId'])check(hex(scope[k],32)&&BigInt(scope[k])>0n&&BigInt(scope[k])<Fr.MODULUS);
  const result=Object.fromEntries(['chainId','rollupVersion','rollupAddress','boardAddress','classId'].map(k=>[k,scope[k]]));
  if(Object.hasOwn(scope,'bok')){
   const b=scope.bok;exact(b,['address','classId','operatorAddress','deployer','salt','deployment']);
   for(const k of ['address','classId','operatorAddress','deployer','salt'])check(hex(b[k],32)&&BigInt(b[k])<Fr.MODULUS&&(k==='salt'||BigInt(b[k])>0n));
   check(b.address!==scope.boardAddress);exact(b.deployment,['blockNumber','blockHash','txHash']);
   check(Number.isSafeInteger(b.deployment.blockNumber)&&b.deployment.blockNumber>0&&hex(b.deployment.blockHash,32)&&hex(b.deployment.txHash,32));
   result.bok=structuredClone(b);
  }
  return freeze(result);
}
// On reload the cache must revalidate every serialized event. This establishes
// schema/digest validity, NOT provenance: the cache still verifies chain anchors.
export async function validateRollingEvent(input,expectedScope) {
 try {
  exact(input,['schemaVersion','scope','type','position','payload']);check(input.schemaVersion===1&&(ROLLING_EVENTS.includes(input.type)||input.type==='AccountingChanged'&&expectedScope.bok));
  const scope=validateRollingScope(input.scope);check(JSON.stringify(scope)===JSON.stringify(validateRollingScope(expectedScope)));
  exact(input.position,['blockNumber','blockHash','txHash','txIndexWithinBlock','logIndexWithinTx']);
  const pos=input.position;check(integer(pos.blockNumber,53)>0n);integer(pos.txIndexWithinBlock,32);integer(pos.logIndexWithinTx,32);check(hex(pos.blockHash,32)&&hex(pos.txHash,32));
  const p=input.payload;exact(p,shapes[input.type]);check(input.type==='AccountingChanged'?p.trailer==='1':p.schema==='1');
  const arr=(v,size)=>{check(Array.isArray(v)&&v.length===size);v.forEach(scalar);};
  const text=async (fields,length,size,required=true)=>{arr(fields,size);const value=unpackRollingText(fields,length,size*31,required);return {value,digest:await hash([length,...fields],0x52435431)};};
  if(input.type==='AccountingChanged') {
   nonzero(p.request_id);check(integer(p.state,8)>=1n&&BigInt(p.state)<=4n);integer(p.sequence,32);
   for(const k of ['budget','available','reserved','charged','refunded'])integer(p[k],128);
   check(BigInt(p.budget)>0n&&['available','reserved','charged','refunded'].reduce((sum,k)=>sum+BigInt(p[k]),0n)===BigInt(p.budget));
  } else if(input.type==='NameRegistered') {
   arr(p.first,2);arr(p.last,2);const first=unpackRollingText(p.first,p.first_length,32),last=unpackRollingText(p.last,p.last_length,32);
   const registration=nameRegistration(first,last);check(registration.name.first===first&&registration.name.last===last);
   check(p.name_id===await hash(registration.preimage,NAME_DOMAIN));nonzero(p.name_id);
  } else if(input.type==='BioPublished') {
   nonzero(p.name_id);check(integer(p.version,32)>0n&&p.trailer==='1');await text(p.content,p.length,32,false);
   check(p.digest===await hash(['1',p.name_id,p.version,p.length,...p.content],0x52434231));
  } else if(input.type==='AvatarPublished') {
   nonzero(p.name_id);check(integer(p.version,32)>0n&&p.trailer==='1');integer(p.width,16);integer(p.height,16);
   unpackRollingAvatar(p.data,p.length);check(p.length==='0'?p.width==='0'&&p.height==='0':p.width==='100'&&p.height==='100');
   check(p.digest===await hash(['1',p.name_id,p.version,p.width,p.height,p.length,...p.data],0x52434131));
  } else if(input.type==='AvatarRemoved') {
   nonzero(p.name_id);check(integer(p.avatar_version,32)>0n&&integer(p.main_policy_version,32)>0n);scalar(p.avatar_digest);
   check(p.reason_digest===(await text(p.reason,p.length,7)).digest);
  } else if(input.type==='ModeratorTransferred') {
   nonzero(p.previous);nonzero(p.successor);check(p.previous!==p.successor);
  } else if(input.type==='MainPolicyPublished') {
   check(integer(p.version,32)>0n);check(p.digest===(await text(p.rules,p.length,32)).digest);
  } else if(input.type==='SubboardCreated') {
   arr(p.slug,2);const slug=unpackRollingText(p.slug,p.slug_length,40);check(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug)&&slug.length>=3&&!slug.includes('--'));
   check(p.subboard_id===await hash([p.slug_length,...p.slug],0x52435331));nonzero(p.subboard_id);
   const name=await text(p.name,p.name_length,3),description=await text(p.description,p.description_length,16),rules=await text(p.rules,p.rules_length,32,false);
   check(p.rules_digest===rules.digest&&p.metadata_digest===await hash([p.subboard_id,name.digest,description.digest],0x52434d31));
   check(p.local_policy_version==='1'&&integer(p.main_policy_version,32)>0n);
  } else if(input.type==='SubboardRejected') {
   nonzero(p.subboard_id);check(p.local_policy_version==='1'&&integer(p.main_policy_version,32)>0n);check(p.reason_digest===(await text(p.reason,p.reason_length,7)).digest);
  } else if(input.type==='PostPublished') {
   nonzero(p.id);integer(p.timestamp,64);check(integer(p.main_policy_version,32)>0n);integer(p.local_policy_version,32);
   exact(p.record,['subboard','parent','root','kind','name_id','reference','content_digest']);const r=p.record;Object.values(r).forEach(scalar);
   check(['1','2','3','4'].includes(r.kind));nonzero(r.root);
   check((r.parent==='0')===(r.root===p.id));check((r.subboard==='0')===(p.local_policy_version==='0'));
   check(r.kind==='2'||r.kind==='3'?r.reference!=='0':r.reference==='0');
   if(r.kind==='4')check(r.name_id==='0'&&r.parent!=='0');
   check(r.content_digest===(await text(p.message,p.length,32,r.kind!=='3')).digest);
  } else if(input.type==='PostRemoved') {
   nonzero(p.id);integer(p.policy_version,64);check(typeof p.penalized==='boolean');await text(p.reason,p.reason_length,7);
  } else if(input.type==='PluginConfigured') {nonzero(p.plugin_id);nonzero(p.adapter);check(typeof p.enabled==='boolean');}
  else if(input.type==='PostTipKey') {
   nonzero(p.post);exact(p.key,['x','y']);const x=scalar(p.key.x),y=scalar(p.key.y);
   check((x!==0n||y!==0n)&&(y*y-x*x*x+17n)%Fr.MODULUS===0n);
  }
  else if(input.type==='LikeChanged') {nonzero(p.post);nonzero(p.tag);integer(p.count,64);check(p.active===true);}
  else {for(const k of Object.keys(p).filter(k=>k!=='schema'))nonzero(p[k]);}
  const result=freeze({...structuredClone(input),scope});verified.add(result);return result;
 } catch {throw rollingError();}
}
function flattenTypes(type,eventType,path='') {
 if(type.kind==='field'||type.kind==='boolean'||type.kind==='integer')return [type];
 if(type.kind==='array'){const avatar=eventType==='AvatarPublished'&&path==='data'&&type.length===265&&type.type.kind==='field';check(Number.isInteger(type.length)&&type.length>0&&(type.length<=32||avatar));return Array.from({length:type.length},()=>flattenTypes(type.type,eventType,path+'[]')).flat();}
 if(type.kind==='struct'){check(type.fields.length<=20);return type.fields.flatMap(f=>flattenTypes(f.type,eventType,path?path+'.'+f.name:f.name));}throw rollingError();
}
const normalize = value => typeof value==='bigint'?String(value):typeof value==='boolean'?value:Array.isArray(value)?value.map(normalize):value?.toField?String(value.toField().toBigInt()):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)]));
export async function createRollingEventDecoder({artifact,scope,bokArtifact,confirmationTier='checkpointed'}) {
 check(['checkpointed','proposed'].includes(confirmationTier));
 scope=validateRollingScope(scope);check(artifact.name==='RollingBoard'&&(await getContractClassFromArtifact(artifact)).id.toString()===scope.classId);
 let bokInstance=null,bokSlots=null;
 if(scope.bok){
  check(bokArtifact?.name==='PrivateBok');
  bokSlots=Object.fromEntries(['board','operator','owner','l1_chain','version'].map(k=>[k,Fr.fromString(bokArtifact.storageLayout[k].slot.toString())]));
  bokArtifact=structuredClone(bokArtifact);
  bokInstance=await getContractInstanceFromInstantiationParams(bokArtifact,{constructorArtifact:'init',constructorArgs:[AztecAddress.fromStringUnsafe(scope.boardAddress),AztecAddress.fromStringUnsafe(scope.bok.operatorAddress),BigInt(scope.chainId),BigInt(scope.rollupVersion)],deployer:AztecAddress.fromStringUnsafe(scope.bok.deployer),salt:Fr.fromString(scope.bok.salt)});
  check(bokInstance.address.toString()===scope.bok.address&&bokInstance.originalContractClassId.toString()===scope.bok.classId);
 }
 // Only successful immutable deployment facts are reused, scoped to this
 // exact frozen descriptor, captured artifact and node object. This private
 // key cannot cross decoders; nothing survives process/reopen.
 const bokAttestations=new WeakMap(),bokAttestationKey=Object.freeze({scope,artifact:bokArtifact});
 async function verifyBok(node,read){
  if(!scope.bok)return;
  const b=scope.bok,d=b.deployment,anchor={number:d.blockNumber,hash:d.blockHash},address=bokInstance.address;
  try{
   const reused=bokAttestations.get(node)===bokAttestationKey;
   if(!reused){
    const instance=await read(()=>node.getContract(address,anchor));check(instance?.version===bokInstance.version);
    for(const k of ['deployer','salt','originalContractClassId','currentContractClassId','initializationHash','immutablesHash'])check(instance[k]?.toString()===bokInstance[k].toString());
    check((await computeContractAddressFromInstance(instance)).toString()===b.address);
    const tx=TxHash.fromString(d.txHash),receipt=await read(()=>node.getTxReceipt(tx)),effect=await read(()=>node.getTxEffect(tx));
    check(receipt.txHash.equals(tx)&&[TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)&&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.blockNumber===d.blockNumber&&receipt.blockHash.toString()===d.blockHash);
    check(effect?.l2BlockNumber===d.blockNumber&&effect.l2BlockHash.toString()===d.blockHash&&effect.data.txHash.equals(tx)&&effect.data.revertCode.isOK());
    const values={board:scope.boardAddress,operator:b.operatorAddress,owner:b.deployer,l1_chain:new Fr(BigInt(scope.chainId)).toString(),version:new Fr(BigInt(scope.rollupVersion)).toString()};
    // These five slots are PublicImmutable, initialized only by this pinned
    // class's constructor. Authenticate their values at retained canonical state;
    // the deployment receipt/instance remain anchored to the original archive.
    const retained=await read(()=>node.getBlockData('checkpointed'));
    const stateAnchor={number:retained?.header?.globalVariables?.blockNumber,hash:retained?.blockHash?.toString()};
    check(Number.isSafeInteger(stateAnchor.number)&&stateAnchor.number>=d.blockNumber&&hex(stateAnchor.hash,32));
    for(const [k,value] of Object.entries(values))check((await read(()=>node.getPublicStorageAt(stateAnchor,address,bokSlots[k]))).toString()===value);
    const finalState=await read(()=>node.getBlockData(stateAnchor.number));check(finalState?.blockHash?.toString()===stateAnchor.hash);
   }
   // These reads are fresh on EVERY verification, including the existing
   // pre/post-commit checks. A reorg or current-instance change invalidates reuse.
   const current=await read(()=>node.getContract(address));check(current?.version===bokInstance.version);
   for(const k of ['deployer','salt','originalContractClassId','currentContractClassId','initializationHash','immutablesHash'])check(current[k]?.toString()===bokInstance[k].toString());
   check((await computeContractAddressFromInstance(current)).toString()===b.address);
   const block=await read(()=>node.getBlockData(d.blockNumber));check(block?.blockHash.toString()===d.blockHash);
   bokAttestations.set(node,bokAttestationKey);
  }catch(error){bokAttestations.delete(node);throw error;}
 }

 const definitions=new Map();
 for(const type of [...ROLLING_EVENTS,...(scope.bok?['AccountingChanged']:[])]){const isBok=type==='AccountingChanged',source=isBok?bokArtifact:artifact;const abis=source.outputs.structs.events.filter(e=>e.path===`${isBok?'PrivateBok':'RollingBoard'}::${type}`);check(abis.length===1);const abi=structuredClone(abis[0]);
  const selector=await EventSelector.fromSignature(decodeFunctionSignature(type,abi.fields));const tag=await computeLogTag(selector.toField(),DomainSeparator.EVENT_LOG_TAG);
  check(!definitions.has(tag.toString()));definitions.set(tag.toString(),{type,abi,address:isBok?scope.bok.address:scope.boardAddress,types:flattenTypes(abi,type)});
 }
 async function decodeLog(log,position) {
  try {const def=definitions.get(log.fields[0]?.toString());check(def&&log.contractAddress.toString()===def.address&&log.fields.length===def.types.length+1);
   log.fields.slice(1).forEach((f,i)=>{check(f instanceof Fr);const t=def.types[i],v=f.toBigInt();if(t.kind==='boolean')check(v===0n||v===1n);if(t.kind==='integer')check(t.sign==='unsigned'&&v<1n<<BigInt(t.width));});
   return await validateRollingEvent({schemaVersion:1,scope,type:def.type,position,payload:normalize(decodeFromAbi(def.abi,log.getEmittedFieldsWithoutTag()))},scope);
  }catch{throw rollingError();}
 }
 // The caller retains range-level anchor rechecks/reorg handling. This verifies
 // one entire successful transaction against the actual SDK block/effect APIs.
 async function decodeTransaction(node,hashValue,{block:suppliedBlock}={}) {
  try {
   const read=async fn=>await fn();
   const txHash=TxHash.fromString(hashValue),address=AztecAddress.fromBigIntUnsafe(BigInt(scope.boardAddress)),info=await read(()=>node.getNodeInfo()),instance=await read(()=>node.getContract(address));
   check(String(info.l1ChainId)===scope.chainId&&String(info.rollupVersion)===scope.rollupVersion&&info.l1ContractAddresses.rollupAddress.toString()===scope.rollupAddress);
   check(instance?.currentContractClassId.toString()===scope.classId&&instance?.originalContractClassId.toString()===scope.classId);
   const receipt=await read(()=>node.getTxReceipt(txHash));check([...(confirmationTier==='proposed'?[TxStatus.PROPOSED]:[]),TxStatus.CHECKPOINTED,TxStatus.PROVEN,TxStatus.FINALIZED].includes(receipt.status)&&receipt.executionResult===TxExecutionResult.SUCCESS&&receipt.txHash.equals(txHash));
   // An ingestion caller may already own this full block. Receipt, effect and
   // block identity checks below are identical for supplied and fetched bodies.
   const block=suppliedBlock??await read(()=>node.getBlock(receipt.blockNumber,{includeTransactions:true})),found=await read(()=>node.getTxEffect(txHash));check(block&&found&&Number(block.header.globalVariables.blockNumber)===Number(receipt.blockNumber)&&block.hash.equals(receipt.blockHash)&&found.l2BlockHash.equals(receipt.blockHash)&&Number(found.l2BlockNumber)===Number(receipt.blockNumber)&&found.data.txHash.equals(txHash));
   const matches=block.body.txEffects.map((effect,index)=>({effect,index})).filter(({effect})=>effect.txHash.equals(txHash));check(matches.length===1&&matches[0].effect.toBuffer().equals(found.data.toBuffer()));
   check(found.data.publicLogs.length<=4096&&found.data.publicLogs.reduce((sum,log)=>sum+log.sizeInFields(),0)<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);const events=[];
   const completions=[];
   for(const [index,log] of found.data.publicLogs.entries())if(log.contractAddress.toString()===scope.boardAddress||log.contractAddress.toString()===scope.bok?.address){
    // The pinned PrivateBok refund also emits the standard PartialUintNote
    // completion transport: [domain-separated commitment, balances slot, value].
    // Its tag is opaque. Provenance comes from the authenticated class and full
    // canonical effect, not from treating an unknown tag as an event namespace.
    // Known event tags always take the strict ABI path, including malformed ones.
    if(log.contractAddress.toString()===scope.bok?.address&&!definitions.has(log.fields[0]?.toString())){
     check(log.fields.length===3&&log.fields.every(f=>f instanceof Fr));
     check(log.fields[1].equals(bokArtifact.storageLayout.balances.slot));
     const value=log.fields[2].toBigInt();check(value>0n&&value<1n<<128n);completions.push(value);
    }else events.push(await decodeLog(log,{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash.toString(),txHash:hashValue,txIndexWithinBlock:String(matches[0].index),logIndexWithinTx:String(index)}));
   }
   for(const value of completions)check(events.some(event=>event.type==='AccountingChanged'&&BigInt(event.payload.refunded)>=value));
   const final=await read(()=>node.getBlockData(receipt.blockNumber)),lastInstance=await read(()=>node.getContract(address));
   check(final?.blockHash.equals(receipt.blockHash)&&lastInstance?.currentContractClassId.toString()===scope.classId&&lastInstance?.originalContractClassId.toString()===scope.classId);
   await verifyBok(node,read);
   for(const event of events)if(event.type==='PostPublished')check(event.payload.timestamp===String(block.header.globalVariables.timestamp));
   return events;
  }catch{throw rollingError();}
 }
 return Object.freeze({scope,decodeLog,decodeTransaction,verifyBok});
}
