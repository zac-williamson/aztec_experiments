// Portable plugin protocol. No board SDK, model SDK or service implementation.
import {AbiCoder, keccak256, sha256, toUtf8Bytes} from 'ethers';
import {Buffer} from 'buffer';

export const API_VERSION = 'billboard-plugin/v2';
export const MESSAGE_BYTES = 992;
const fieldMax=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export function field(value) {
  if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/.test(value)||BigInt(value)===0n||BigInt(value)>=fieldMax)throw Error('Invalid plugin field');
  return value;
}
export function handleField(handle) {
  if(typeof handle!=='string'||!/^[a-z][a-z0-9_]{0,30}$/.test(handle))throw Error('Invalid plugin handle');
  return '0x'+Buffer.from(handle,'ascii').toString('hex').padStart(64,'0');
}
export function mentions(text) {
  return [...new Set([...text.matchAll(/(?:^|\s)@([a-z][a-z0-9_]{0,30})(?![a-z0-9_])/g)].map(m=>m[1]))];
}
export function messageHash(text) {
  if(typeof text!=='string'||!text.isWellFormed()||text.includes('\0')||toUtf8Bytes(text).length<1||toUtf8Bytes(text).length>MESSAGE_BYTES)throw Error('Invalid plugin message');
  return keccak256(toUtf8Bytes(text));
}
export function scopeHash(scope) {
  if(!/^\d+$/.test(scope.chainId)||!/^\d+$/.test(scope.rollupVersion)||!/^0x[0-9a-f]{40}$/.test(scope.rollupAddress))throw Error('Invalid plugin network');
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['string','uint256','address','uint256','bytes32','bytes32'],
    [API_VERSION,scope.chainId,scope.rollupAddress,scope.rollupVersion,field(scope.boardAddress),field(scope.receiver)]));
}
export function validateDescriptor(value, expected) {
  if(value?.protocol!==API_VERSION)throw Error('Unsupported plugin protocol');
  const {scope,funding}=value;
  if(scopeHash(scope)!==scopeHash(expected))throw Error('Plugin scope mismatch');
  if(funding?.protocol!=='aztec-escrow-usdc/v1'||!/^0x[0-9a-fA-F]{40}$/.test(funding.portalAddress)||!/^0x[0-9a-fA-F]{40}$/.test(funding.tokenAddress))throw Error('Invalid plugin funding');
  if(typeof value.description!=='string'||value.description.length>1000)throw Error('Invalid plugin description');
  return Object.freeze({protocol:API_VERSION,scope:Object.freeze({...scope}),description:value.description,funding:Object.freeze({...funding})});
}
export async function fetchDescriptor(url, expected, {fetchImpl=fetch}={}) {
  const u=new URL(url);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid plugin descriptor URL');
  if(u.protocol==='http:'&&expected.chainId!=='31337')throw Error('Plugin descriptor requires HTTPS');
  const pin=u.hash.slice(1);
  if(!/^sha256=0x[0-9a-f]{64}$/.test(pin))throw Error('Plugin descriptor must be pinned by the board deployer');
  u.hash='';
  const response=await fetchImpl(u,{signal:AbortSignal.timeout(10000),credentials:'omit',redirect:'error'});
  if(!response.ok)throw Error('Plugin unavailable');
  const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw Error('Plugin descriptor too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  finally{await reader.cancel();}
  if(sha256(toUtf8Bytes(text))!==pin.slice(7))throw Error('Plugin descriptor integrity mismatch');
  return validateDescriptor(JSON.parse(text),expected);
}
export function packText(text,count=32) {
  const bytes=toUtf8Bytes(text);if(bytes.length>count*31)throw Error('Text too long');
  const padded=new Uint8Array(count*31);padded.set(bytes);
  return {fields:Array.from({length:count},(_,i)=>'0x'+Buffer.from(padded.slice(i*31,(i+1)*31)).toString('hex').padStart(64,'0')),length:bytes.length};
}
export function unpackText(fields,length) {
  const bytes=Buffer.concat(fields.map(f=>Buffer.from(BigInt(f).toString(16).padStart(62,'0'),'hex')));
  if(!Number.isInteger(length)||length<0||length>bytes.length||bytes.subarray(length).some(x=>x!==0))throw Error('Invalid packed text');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
}
