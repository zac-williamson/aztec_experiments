// TEST ONLY: classify already-public SDK transaction/effect fields in memory.
// Never supply wallet notes, execution witnesses or decrypted delivery contents.
import assert from 'node:assert/strict';
import {Tx,TxEffect} from '@aztec/stdlib/tx';

const ROLES=['author','otherAuthor','sharedPayer','board','moderator','funder'];
function scalar(value){
 const text=value?.toString();
 assert(typeof text==='string'&&/^0x[0-9a-fA-F]{1,64}$/.test(text),'Expected public field/address');
 return BigInt(text);
}

/** Exact field equality is a leak smoke check, not an anonymity proof. A match
 * in commitments/ciphertext is NOT interpreted as a decoded identity. Roles may
 * be Aztec/Ethereum address objects or hex strings; omitted roles remain null.
 * effect is the TxEffect itself (node.getTxEffect(...).data), not its wrapper.
 */
export function classifyT03PublicFootprint({tx,effect,roles}){
 assert(tx instanceof Tx&&effect instanceof TxEffect,'Pinned SDK Tx and TxEffect required');
 assert(tx.getTxHash().equals(effect.txHash),'Effect does not belong to transaction');
 assert(roles&&typeof roles==='object'&&!Array.isArray(roles));
 assert(Object.keys(roles).every(key=>ROLES.includes(key)),'Unknown role');
 assert(roles.author!=null&&roles.sharedPayer!=null,'Author and shared payer required');
 const known=Object.fromEntries(ROLES.map(role=>{const value=roles[role]==null?null:scalar(roles[role]);assert(value===null||value!==0n,'Zero role is ambiguous padding');return[role,value];}));
 assert(known.author!==known.sharedPayer,'Author cannot also be shared payer');
 const calls=tx.getPublicCallRequestsWithCalldata();
 const privateLogs=effect.privateLogs;
 const fields={
  feePayer:[tx.data.feePayer],
  publicCallSenders:calls.map(call=>call.request.msgSender),
  publicCallTargets:calls.map(call=>call.request.contractAddress),
  publicCallCalldata:tx.publicFunctionCalldata.flatMap(call=>call.values),
  publicWriteSlots:effect.publicDataWrites.map(write=>write.leafSlot),
  publicWriteValues:effect.publicDataWrites.map(write=>write.value),
  publicLogContracts:effect.publicLogs.map(log=>log.contractAddress),
  publicLogFields:effect.publicLogs.flatMap(log=>log.fields),
  noteCommitments:effect.noteHashes,
  nullifiers:effect.nullifiers,
  l2ToL1MessageHashes:effect.l2ToL1Msgs,
  privateDeliveryTags:privateLogs.flatMap(log=>log.getEmittedFields().slice(0,1)),
  privateDeliveryPayloadFields:privateLogs.flatMap(log=>log.getEmittedFieldsWithoutTag()),
 };
 const rolePresence=Object.fromEntries(Object.entries(fields).map(([category,values])=>{
  const observed=new Set(values.map(scalar));
  return[category,Object.fromEntries(ROLES.map(role=>[role,known[role]===null?null:observed.has(known[role])]))];
 }));
 return {
  schemaVersion:1,
  scope:'Exact known-role equality in named public transaction/effect fields; no witness or decrypted-note inspection',
  matching:'Whole field numeric equality; no substring scan; commitments and delivery matches do not decode identities',
  sharedFeePayer:rolePresence.feePayer.sharedPayer,
  authorIsPublicFeePayer:rolePresence.feePayer.author,
  counts:{publicCalls:calls.length,publicCalldataFields:fields.publicCallCalldata.length,publicDataWrites:effect.publicDataWrites.length,publicLogs:effect.publicLogs.length,noteCommitments:effect.noteHashes.length,nullifiers:effect.nullifiers.length,l2ToL1MessageHashes:effect.l2ToL1Msgs.length,privateDeliveryLogs:privateLogs.length,privateDeliveryEmittedFields:privateLogs.reduce((sum,log)=>sum+log.emittedLength,0),contractClassLogs:effect.contractClassLogs.length},
  rolePresence,
  limits:'Does not test derived identifiers, linkability across transactions, funding timing, RPC metadata, proof bytes, protocol constants or contract-class contents. Private delivery tags/payload are public serialized fields, not decrypted private data. Absence of exact matches is not proof of anonymity.',
 };
}
