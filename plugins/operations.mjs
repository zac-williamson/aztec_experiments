// Operator lifecycle, injected chain APIs; no provider or board implementation coupling.
import fs from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
export async function fileState(file) {
 await fs.mkdir(dirname(file),{recursive:true,mode:0o700});
 let value;try{value=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;value={operations:{}};}
 return {read:()=>value,async write(next){const tmp=file+'.'+randomBytes(6).toString('hex');await fs.writeFile(tmp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,file);value=next;}};
}
/** Save before broadcast. A repeated command waits for the exact previous hash. */
export async function recordedTransaction({store,name,identity,prepare,broadcast,wait}) {
 let record=store.read().operations[name];
 if(record&&record.identity!==identity)throw Error('Saved transaction belongs to a different operation');
 if(!record){record={identity,...await prepare()};await store.write({...store.read(),operations:{...store.read().operations,[name]:record}});}
 await broadcast(record);
 const receipt=await wait(record);return {record,receipt};
}
export async function outboxArguments(node,txHash){
 const effect=await node.getTxEffect(txHash),messages=effect?.data.l2ToL1Msgs.filter(x=>!x.isZero());
 if(messages?.length!==1)throw Error('Expected one portal message');
 const witness=await node.getL2ToL1MembershipWitness(txHash,messages[0]);
 if(!witness)throw Error('Portal message awaits network settlement; run this command again later');
 return [BigInt(witness.epochNumber),BigInt(witness.numCheckpointsInEpoch),witness.leafIndex,witness.siblingPath.toBufferArray().map(b=>'0x'+Buffer.from(b).toString('hex'))];
}
