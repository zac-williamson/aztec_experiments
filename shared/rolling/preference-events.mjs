// Decode only rows obtained from the official, account-scoped PXE event API.
// This is a schema boundary, NOT proof of encrypted-log authenticity or canonical
// inclusion. The reader must check each block hash and its fixed final anchor.
import {FIELD_MODULUS} from './invocation.mjs';
const invalid=()=>Object.assign(Error('Private preference events are invalid or unavailable.'),{code:'ROLLING_PREFERENCE_EVENT_INVALID'});
const check=v=>{if(!v)throw invalid();};
const names=['schema','revision','kind','target','value','read_block','read_hash','previous_digest'];
const types=[{kind:'integer',sign:'unsigned',width:32},{kind:'integer',sign:'unsigned',width:64},{kind:'integer',sign:'unsigned',width:8},{kind:'field'},{kind:'boolean'},{kind:'integer',sign:'unsigned',width:32},{kind:'field'},{kind:'field'}];
const natural=v=>Number.isSafeInteger(v)&&v>=1&&v<=0xffffffff;
const scalar=value=>{const n=value?.toBigInt();check(typeof n==='bigint'&&n>=0n&&n<FIELD_MODULUS);return n;};
const hash=value=>{const text=value?.toString();check(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text));return text;};
function equalType(actual,expected){check(actual&&Object.keys(actual).sort().join()===Object.keys(expected).sort().join());for(const key of Object.keys(expected))check(actual[key]===expected[key]);}
export async function createPreferenceEventDecoder(input){
 try{
  const {sdk,artifact}=input;
  check(artifact?.name==='RollingBoard');
  const candidates=artifact.outputs?.structs?.events?.filter(e=>e.path==='RollingBoard::PreferenceChanged');
  check(candidates?.length===1);const abi=structuredClone(candidates[0]);
  check(abi.kind==='struct'&&Array.isArray(abi.fields)&&abi.fields.length===8);
  abi.fields.forEach((f,i)=>{check(f.name===names[i]);equalType(f.type,types[i]);});
  const selector=await sdk.EventSelector.fromSignature(sdk.decodeFunctionSignature('PreferenceChanged',abi.fields));
  const selectorText=selector.toString();check(/^0x[0-9a-f]{8}$/.test(selectorText));
  const decode=(row,{fromBlock,toBlock})=>{
   try{
    check(natural(fromBlock)&&Number.isSafeInteger(toBlock)&&toBlock>fromBlock&&toBlock<=0x100000000);
    check(row&&row.eventSelector?.toString()===selectorText&&Array.isArray(row.packedEvent)&&row.packedEvent.length===8);
    check(natural(row.l2BlockNumber)&&row.l2BlockNumber>=fromBlock&&row.l2BlockNumber<toBlock);
    const blockHash=hash(row.l2BlockHash),txHash=hash(row.txHash);check(BigInt(blockHash)>0n&&BigInt(blockHash)<FIELD_MODULUS&&BigInt(txHash)>0n);
    const fields=row.packedEvent.map(scalar),[schema,revision,kind,target,value,readBlock,readHash,previousDigest]=fields;
    check(schema===1n&&revision>0n&&revision<=0xffffffffffffffffn&&kind>=1n&&kind<=6n&&value<=1n&&readBlock<=0xffffffffn);
    if(kind===6n)check(target>0n&&value===1n&&readHash>0n&&readBlock<=BigInt(row.l2BlockNumber));
    else{check(readBlock===0n&&readHash===0n);if(kind===5n)check(target===0n);else if(kind!==2n)check(target>0n);}
    return Object.freeze({event:Object.freeze({schema:1,revision:String(revision),kind:Number(kind),target:String(target),value:value===1n,read_block:Number(readBlock),read_hash:String(readHash),previous_digest:String(previousDigest)}),blockNumber:row.l2BlockNumber,blockHash,txHash});
   }catch{throw invalid();}
  };
  return Object.freeze({selector,decode});
 }catch{throw invalid();}
}
