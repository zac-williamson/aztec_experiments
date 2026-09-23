// Versioned binary API: JSON metadata followed by gzip witnesses. No circuit code.
export const PROVER_API_VERSION=1;
export const MAX_REQUEST_BYTES=8*1024*1024;
export const MAX_STEPS=32;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function encodeJob(metadata,witnesses){
  const header=encoder.encode(JSON.stringify({...metadata,version:PROVER_API_VERSION,lengths:witnesses.map(w=>w.byteLength)}));
  if(header.length>32768)throw Error('Prover metadata too large');
  const size=4+header.length+witnesses.reduce((n,w)=>n+w.byteLength,0);
  if(size>MAX_REQUEST_BYTES)throw Error('Prover request too large');
  const out=new Uint8Array(size);new DataView(out.buffer).setUint32(0,header.length);out.set(header,4);
  let offset=4+header.length;for(const witness of witnesses){out.set(witness,offset);offset+=witness.byteLength;}return out;
}
export function decodeJob(bytes){
  if(bytes.length<4||bytes.length>MAX_REQUEST_BYTES)throw Error('Invalid job size');
  const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
  if(n>32768||n+4>bytes.length)throw Error('Invalid metadata size');
  const metadata=JSON.parse(decoder.decode(bytes.subarray(4,4+n)));
  if(metadata.version!==PROVER_API_VERSION||!Array.isArray(metadata.circuits)||metadata.circuits.length<1||metadata.circuits.length>MAX_STEPS||!Array.isArray(metadata.lengths)||metadata.lengths.length!==metadata.circuits.length)throw Error('Invalid job');
  let offset=4+n;const witnesses=metadata.lengths.map(length=>{if(!Number.isSafeInteger(length)||length<1||offset+length>bytes.length)throw Error('Invalid witness length');const b=bytes.subarray(offset,offset+length);offset+=length;return b;});
  if(offset!==bytes.length||metadata.circuits.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Error('Invalid circuits');
  return {metadata,witnesses};
}
export async function circuitId(bytecode,vk,cryptoApi=globalThis.crypto){
  const data=new Uint8Array(4+bytecode.length+vk.length);new DataView(data.buffer).setUint32(0,bytecode.length);data.set(bytecode,4);data.set(vk,4+bytecode.length);
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
}
