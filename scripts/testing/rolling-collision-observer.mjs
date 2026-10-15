// TEST ONLY. Parent installs after the genuine two-pending-transaction barrier,
// before sequencer resume. Parent authenticates the canonical receipt/effect and
// supplies that exact tuple to match. No simulation result alone proves inclusion.
import {createHash} from 'node:crypto';
import {PublicProcessor} from '@aztec-labs/simulator/server';
import {Tx,TxHash,TxEffect,GlobalVariables} from '@aztec-labs/stdlib/tx';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {RevertCode,PublicSimulatorConfig} from '@aztec-labs/stdlib/avm';
import {SimulationError} from '@aztec-labs/stdlib/errors';
const key='processTxWithPublicCalls',limit=128;
let active=false;
const invalid=()=>Error('Collision observer configuration or observation is invalid.');
function data(value,name){const d=Object.getOwnPropertyDescriptor(value,name);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;}
function hash(value){
 if(Object.getPrototypeOf(value)!==TxHash.prototype)throw invalid();
 const field=data(value,'hash');if(Object.getPrototypeOf(field)!==Fr.prototype)throw invalid();
 const n=data(field,'asBigInt');if(typeof n!=='bigint'||n<=0n||n>=Fr.MODULUS)throw invalid();
 return '0x'+n.toString(16).padStart(64,'0');
}
function block(value){if(!Number.isSafeInteger(value)||value<0)throw invalid();return value;}
function code(value){if(Object.getPrototypeOf(value)!==RevertCode.prototype)throw invalid();const n=data(value,'code');if(n!==0&&n!==1)throw invalid();return n;}
function tuple(value){
 if(!value||Object.keys(value).sort().join(',')!=='blockNumber,effectSha256,txHash')throw invalid();
 const txHash=data(value,'txHash'),effectSha256=data(value,'effectSha256'),blockNumber=block(data(value,'blockNumber'));
 if(typeof txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(txHash)||BigInt(txHash)<=0n||BigInt(txHash)>=Fr.MODULUS||typeof effectSha256!=='string'||!/^[0-9a-f]{64}$/.test(effectSha256))throw invalid();
 return {txHash,effectSha256,blockNumber};
}
export function installRollingCollisionObserver({classify}={}){
 if(active||typeof classify!=='function')throw invalid();
 const proto=PublicProcessor.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,key);
 if(!descriptor||typeof descriptor.value!=='function'||!descriptor.configurable||!descriptor.writable)throw invalid();
 const original=descriptor.value,records=new Map(),metadataLeases=new WeakSet();let closed=false,restored=false;
 const counts={calls:0,pending:0,observations:0,classified:0,rejected:0,duplicates:0,conflicts:0,errors:0,truncated:0,ownershipLost:0,metadataEnabled:0,metadataRestored:0,reasonAbsent:0,reasonNotSimulationError:0,classifierRejected:0};
 function owns(){const d=Object.getOwnPropertyDescriptor(proto,key);return !!d&&d.value===wrapped&&d.writable===descriptor.writable&&d.configurable===descriptor.configurable&&d.enumerable===descriptor.enumerable;}
 function checkOwner(){if(!closed&&!owns()){counts.ownershipLost=1;return false;}return counts.ownershipLost===0;}
 // Block building normally disables call metadata. Enable only that diagnostic
 // bit on the SAME simulator for its one execution, then restore its descriptor.
 // No fee, gas, proof, hints, debug logs or state behavior is changed.
 function collectMetadata(receiver){
  const simulator=data(receiver,'publicTxSimulator'),config=data(simulator,'config');
  if(Object.getPrototypeOf(config)!==PublicSimulatorConfig.prototype||metadataLeases.has(config))throw invalid();
  const prior=Object.getOwnPropertyDescriptor(config,'collectCallMetadata');
  if(!prior||!Object.hasOwn(prior,'value')||typeof prior.value!=='boolean'||!prior.writable||!prior.configurable)throw invalid();
  if(data(config,'skipFeeEnforcement')!==false)throw invalid();
  const all=Object.getOwnPropertyDescriptors(config);
  metadataLeases.add(config);Object.defineProperty(config,'collectCallMetadata',{...prior,value:true});counts.metadataEnabled++;
  return ()=>{
   metadataLeases.delete(config);
   const current=Object.getOwnPropertyDescriptors(config);
   const untouched=Object.keys(all).length===Object.keys(current).length&&Object.keys(all).every(k=>{
    const a=all[k],b=current[k];return b&&a.writable===b.writable&&a.configurable===b.configurable&&a.enumerable===b.enumerable&&a.get===b.get&&a.set===b.set&&(k==='collectCallMetadata'?b.value===true:a.value===b.value);
   });
   if(data(receiver,'publicTxSimulator')!==simulator||data(simulator,'config')!==config||!untouched){counts.ownershipLost++;throw invalid();}
   Object.defineProperty(config,'collectCallMetadata',prior);counts.metadataRestored++;
  };
 }
 function observe(inputHash,inputBlock,result){
  if(!Array.isArray(result)||result.length!==3)throw invalid();
  const processed=data(result,'0'),effect=data(processed,'txEffect'),globals=data(processed,'globalVariables');
  if(Object.getPrototypeOf(effect)!==TxEffect.prototype||Object.getPrototypeOf(globals)!==GlobalVariables.prototype)throw invalid();
  if(hash(data(processed,'hash'))!==inputHash||hash(data(effect,'txHash'))!==inputHash||block(data(globals,'blockNumber'))!==inputBlock)throw invalid();
  const reverted=code(data(processed,'revertCode'));if(code(data(effect,'revertCode'))!==reverted)throw invalid();
  // Invoke the installed encoder, never an effect-owned replacement method.
  const bytes=TxEffect.prototype.toBuffer.call(effect);
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>1024*1024)throw invalid();
  const effectSha256=createHash('sha256').update(bytes).digest('hex');
  let matched=false;
  if(reverted===1){
   const reason=data(processed,'revertReason');
   if(reason instanceof SimulationError){
    const answer=classify(reason);
    if(typeof answer!=='boolean'){
     // Async classifiers are unsupported. Drain genuine Promise rejection only
     // to keep a defective callback from creating an unhandled rejection.
     if(answer instanceof Promise)try{Promise.prototype.then.call(answer,()=>{},()=>{});}catch{}
     throw invalid();
    }
    matched=answer;if(!answer)counts.classifierRejected++;
   }else if(reason===undefined)counts.reasonAbsent++;else counts.reasonNotSimulationError++;
  }
  const entry={effectSha256,blockNumber:inputBlock,matched,reverted};
  const old=records.get(inputHash);
  if(old){if(Object.keys(entry).some(k=>old[k]!==entry[k]))counts.conflicts++;else counts.duplicates++;}
  else records.set(inputHash,entry);
  counts.observations++;if(matched)counts.classified++;
 }
 function wrapped(...args){
  counts.calls++;counts.pending++;let inputHash,inputBlock,restoreMetadata,valid=false,done=false;
  try{
   if(!checkOwner())throw invalid();
   if(counts.calls>limit)counts.truncated++;
   else{
    const tx=args[0];if(Object.getPrototypeOf(tx)!==Tx.prototype)throw invalid();
    // Installed Tx.getTxHash is its own txHash data field; reject accessors first.
    const stored=data(tx,'txHash');if(Tx.prototype.getTxHash.call(tx)!==stored)throw invalid();inputHash=hash(stored);
    const globals=data(this,'globalVariables');if(Object.getPrototypeOf(globals)!==GlobalVariables.prototype)throw invalid();inputBlock=block(data(globals,'blockNumber'));restoreMetadata=collectMetadata(this);valid=true;
   }
  }catch{counts.errors++;}
  const finish=(result,rejected)=>{
   if(done)return;done=true;counts.pending--;
   try{restoreMetadata?.();}catch{counts.errors++;}
   try{if(!checkOwner())throw invalid();if(rejected){counts.rejected++;counts.errors++;}else if(valid)observe(inputHash,inputBlock,result);}catch{counts.errors++;}
  };
  let result;try{result=Reflect.apply(original,this,args);}catch(error){finish(undefined,true);throw error;}
  try{
   if(result instanceof Promise)Promise.prototype.then.call(result,value=>finish(value,false),()=>finish(undefined,true));
   else{counts.errors++;finish(undefined,false);}
  }catch{counts.errors++;} // Attachment failure must never replace original promise.
  return result;
 }
 Object.defineProperty(proto,key,{...descriptor,value:wrapped});active=true;
 return Object.freeze({
  match(value){
   let expected;try{expected=tuple(value);}catch{return false;}
   if(!checkOwner()||counts.pending||counts.errors||counts.truncated||counts.conflicts)return false;
   const found=records.get(expected.txHash);return !!found&&found.matched&&found.effectSha256===expected.effectSha256&&found.blockNumber===expected.blockNumber;
  },
  snapshot(){checkOwner();return {schemaVersion:1,scope:'Test-only processor observation; canonical inclusion authenticated by parent',...counts,closed,restored};},
  close(){
   if(closed)return {restored};
   if(owns()){Object.defineProperty(proto,key,descriptor);restored=true;}else counts.ownershipLost=1;
   closed=true;active=false;return {restored};
  }
 });
}
