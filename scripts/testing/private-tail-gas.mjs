// Diagnostic only: counts surviving kernel effects; never records their values.
import assert from 'node:assert/strict';
import {AVM_EMITNOTEHASH_BASE_L2_GAS,AVM_EMITNULLIFIER_BASE_L2_GAS,AVM_SENDL2TOL1MSG_BASE_L2_GAS,L2_GAS_PER_PRIVATE_LOG,L2_GAS_PER_CONTRACT_CLASS_LOG,FIXED_AVM_STARTUP_L2_GAS,PUBLIC_TX_L2_GAS_OVERHEAD,TX_DA_GAS_OVERHEAD,DA_GAS_PER_FIELD} from '@aztec-labs/constants';
export function privateTailGasBreakdown(tx){
 const tail=tx.data,parts=tail.forPublic;assert(parts,'Expected a transaction with public execution');
 const live=items=>items.filter(item=>!item.isEmpty());
 const phases=Object.fromEntries(['nonRevertibleAccumulatedData','revertibleAccumulatedData'].map(name=>{
  const d=parts[name],logs=live(d.privateLogs),classes=live(d.contractClassLogsHashes);
  return [name,{notes:live(d.noteHashes).length,nullifiers:live(d.nullifiers).length,l2ToL1Messages:live(d.l2ToL1Msgs).length,privateLogs:logs.length,privateLogFields:logs.reduce((sum,l)=>sum+l.emittedLength+1,0),contractClassLogs:classes.length,contractClassLogFields:classes.reduce((sum,l)=>sum+l.logHash.length+1,0),publicCalls:live(d.publicCallRequests).length}];
 }));
 const counts=Object.fromEntries(Object.keys(Object.values(phases)[0]).map(key=>[key,Object.values(phases).reduce((sum,p)=>sum+p[key],0)]));
 const teardown=!parts.publicTeardownCallRequest.isEmpty(),cap=tail.constants.txContext.gasSettings.teardownGasLimits;
 const rows=[
  {name:'transaction overhead',l2Gas:PUBLIC_TX_L2_GAS_OVERHEAD,daGas:TX_DA_GAS_OVERHEAD},
  {name:'private note hashes',count:counts.notes,l2Gas:counts.notes*AVM_EMITNOTEHASH_BASE_L2_GAS,daGas:counts.notes*DA_GAS_PER_FIELD},
  {name:'private nullifiers including protocol nullifier',count:counts.nullifiers,l2Gas:counts.nullifiers*AVM_EMITNULLIFIER_BASE_L2_GAS,daGas:counts.nullifiers*DA_GAS_PER_FIELD},
  {name:'private L2-to-L1 messages',count:counts.l2ToL1Messages,l2Gas:counts.l2ToL1Messages*AVM_SENDL2TOL1MSG_BASE_L2_GAS,daGas:counts.l2ToL1Messages*DA_GAS_PER_FIELD},
  {name:'private logs',count:counts.privateLogs,fields:counts.privateLogFields,l2Gas:counts.privateLogs*L2_GAS_PER_PRIVATE_LOG,daGas:counts.privateLogFields*DA_GAS_PER_FIELD},
  {name:'contract-class logs',count:counts.contractClassLogs,fields:counts.contractClassLogFields,l2Gas:counts.contractClassLogs*L2_GAS_PER_CONTRACT_CLASS_LOG,daGas:counts.contractClassLogFields*DA_GAS_PER_FIELD},
  {name:'public call startup',count:counts.publicCalls,l2Gas:counts.publicCalls*FIXED_AVM_STARTUP_L2_GAS,daGas:0},
  {name:'refund call startup',count:Number(teardown),l2Gas:teardown?FIXED_AVM_STARTUP_L2_GAS:0,daGas:0},
  {name:'reserved refund allocation',l2Gas:teardown?cap.l2Gas:0,daGas:teardown?cap.daGas:0},
 ];
 const total={l2Gas:rows.reduce((sum,row)=>sum+row.l2Gas,0),daGas:rows.reduce((sum,row)=>sum+row.daGas,0)};
 assert.deepEqual(total,{l2Gas:tail.gasUsed.l2Gas,daGas:tail.gasUsed.daGas},'Private-tail metering must match native kernel output exactly');
 return {phases,counts,rows,total};
}
