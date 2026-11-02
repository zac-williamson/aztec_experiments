// No SDK imports: native class transforms also consume this provenance store.
// Headers belong only to this readiness result, never to a node-wide cache.
// The caller may reuse its final canonical reads during the same request; a
// later inspection always performs fresh reads and gets a different snapshot.
const canonicalBlocks = new WeakMap();
export function getTrustedNodeCanonicalBlock(snapshot, number, hash) {
  if(number === undefined && hash === undefined)return undefined;
  return canonicalBlocks.get(snapshot)?.blocks.find(record =>
    (number === undefined || record.number === number) &&
    (hash === undefined || record.hash === hash))?.data;
}
// Only a successful inspection's exact node can supply construction metadata.
// Return detached native values: callers cannot mutate the recorded identity.
export function detachedInfo(value){
 if(value===null||typeof value!=='object')return value;
 if(ArrayBuffer.isView(value))return value.constructor.from(value);
 if(value instanceof ArrayBuffer)return value.slice(0);
 const result=Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));
 for(const key of Object.keys(value))result[key]=detachedInfo(value[key]);return result;
}
export function getTrustedNodeSnapshotInfo(snapshot,node){
 const record=canonicalBlocks.get(snapshot);if(!record||record.node!==node)throw Object.assign(new Error('Trusted private node network or proof policy does not match.'),{code:'BB_TRUSTED_NODE_IDENTITY'});
 return detachedInfo(record.info);
}
export function recordTrustedNodeSnapshot(snapshot,record){canonicalBlocks.set(snapshot,record);}

// Authority belongs to this exact successful inspection, never to wall-clock age.
export function canTrustedNodeSnapshotReadProposed(snapshot) {
  return canonicalBlocks.get(snapshot)?.proposedReady === true;
}
