// Pure browser/Node verifier. Metadata must come from the authenticated application
// build, never the RPC or deployment manifest being checked.
export const PORTAL_IMMUTABLES = Object.freeze(['MIN_DEPOSIT','MAX_DEPOSIT','L2_CONTRACT','ROLLUP','INBOX','OUTBOX','VERSION','L1_CHAIN_ID','CONFIG_HASH']);
const hex = value => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
const fail = () => { throw new Error('Invalid portal runtime metadata or immutable values'); };
export function expectedPortalRuntime(metadata, values) {
  if (!metadata || metadata.schemaVersion !== 1 || !hex(metadata.runtimeTemplate) || !metadata.immutables || !values) fail();
  const names = Object.keys(metadata.immutables).sort();
  if (JSON.stringify(names) !== JSON.stringify([...PORTAL_IMMUTABLES].sort()) || JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(names)) fail();
  const bytes = metadata.runtimeTemplate.slice(2).toLowerCase().match(/../g), occupied = new Set();
  for (const name of names) {
    const raw = values[name];
    if (!(typeof raw === 'bigint' || (typeof raw === 'string' && /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(raw)))) fail();
    const value = BigInt(raw), width = ['ROLLUP','INBOX','OUTBOX'].includes(name) ? 160n : 256n;
    if (value < 0n || value >= 1n << width) fail();
    const word = value.toString(16).padStart(64,'0').match(/../g), refs = metadata.immutables[name];
    if (!Array.isArray(refs) || !refs.length) fail();
    for (const ref of refs) {
      if (!ref || Object.keys(ref).sort().join(',') !== 'length,start' || ref.length !== 32 || !Number.isSafeInteger(ref.start) || ref.start < 0 || ref.start + 32 > bytes.length) fail();
      for (let i=0;i<32;i++) {
        const offset=ref.start+i;
        if (occupied.has(offset) || bytes[offset] !== '00') fail();
        occupied.add(offset); bytes[offset]=word[i];
      }
    }
  }
  return '0x'+bytes.join('');
}
export function verifyPortalRuntime(actual, metadata, values) {
  const expected=expectedPortalRuntime(metadata,values);
  if (!hex(actual) || actual.toLowerCase() !== expected) throw new Error('Deployed portal runtime does not match the verified build and configuration');
  return true;
}
