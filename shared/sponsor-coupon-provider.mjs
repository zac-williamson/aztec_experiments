// LOCAL provider. Only window/token/opaque leaf cross the issuer transport boundary.
import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {computeSponsorCouponRoot} from './sponsor-client.mjs';
export class SponsorCouponError extends Error {constructor(code='SPONSOR_COUPON_UNAVAILABLE'){super(code);this.code=code;}}
const need=(condition,code='SPONSOR_COUPON_INVALID')=>{if(!condition)throw new SponsorCouponError(code);};
function uint(value,bits){if(value?.toBigInt)value=value.toBigInt();if(typeof value==='number'){need(Number.isSafeInteger(value));value=BigInt(value);}need(typeof value==='bigint'||typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=78);const n=BigInt(value);need(n>=0n&&n<1n<<BigInt(bits));return n;}
function field(value,nonzero=false){const text=typeof value==='string'?value:value?.toString();need(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text));const f=Fr.fromString(text);need(f.toString()===text&&(!nonzero||!f.isZero()));return text;}
function canonicalScope(scope){need(scope&&typeof scope==='object');const l1ChainId=String(uint(scope.l1ChainId,64)),rollupVersion=String(uint(scope.rollupVersion,32));const eth=v=>{need(typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v));return v.toLowerCase();};return {l1ChainId,rollupVersion,rollupAddress:eth(scope.rollupAddress),boardAddress:field(scope.boardAddress,true),portalAddress:eth(scope.portalAddress)};}
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
const opaqueId=async value=>hex(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))));
const tokenShape=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const sameScope=(left,right)=>JSON.stringify(canonicalScope(left))===JSON.stringify(right);
const recoverable=new Set(['SPONSOR_ISSUER_UNAVAILABLE','SPONSOR_ISSUER_RATE_LIMITED','SPONSOR_TRANSPORT_TIMEOUT','SPONSOR_TRANSPORT_FAILED','ISSUER_NOT_SEALED']);
export function createSponsorCouponProvider(options) {
  try{return initializeProvider(options);}catch{throw new SponsorCouponError('SPONSOR_COUPON_CONFIGURATION_REQUIRED');}
}
function initializeProvider({transport,sponsorAddress,windowDuration,store,nowSeconds=()=>BigInt(Math.floor(Date.now()/1000)),maxPolls=10,pollIntervalMs=1000,deadlineMs=30000}={}) {
  need(transport?.reserve&&transport?.submit&&transport?.retrieve&&store?.pending&&store?.put&&store?.markAttempted,'SPONSOR_COUPON_CONFIGURATION_REQUIRED');
  const sponsor=field(sponsorAddress,true),duration=uint(windowDuration,64);need(duration>0n&&duration<=86400n);
  need(Number.isInteger(maxPolls)&&maxPolls>=1&&maxPolls<=30&&Number.isInteger(pollIntervalMs)&&pollIntervalMs>=0&&pollIntervalMs<=5000&&Number.isInteger(deadlineMs)&&deadlineMs>=50&&deadlineMs<=60000);
  const now=()=>uint(nowSeconds(),64);
  const bounds=window=>{const start=uint(window,64)*duration,end=start+duration-1n;need(end<1n<<64n);return {start,end};};
  const matchPublic=(value,record,sealed)=>{
    need(value&&String(uint(value.chainId,64))===record.scope.l1ChainId&&String(uint(value.version,32))===record.scope.rollupVersion&&field(value.sponsorAddress,true)===sponsor);
    need(String(uint(value.window,64))===record.reservation.window&&String(uint(value.batchId,64))===record.reservation.batchId&&Number(uint(value.index,32))===record.reservation.index);
    const count=uint(value.ticketCount,32);need(count>0n&&count<=1024n&&BigInt(record.reservation.index)<count&&String(uint(value.expiresAt,64))===record.expiresAt);
    need(value.status===(sealed?'sealed':'open'));
  };
  async function makeLeaf(record){const r=record.reservation;return (await poseidon2HashWithSeparator([new Fr(BigInt(record.scope.l1ChainId)),new Fr(BigInt(record.scope.rollupVersion)),Fr.fromString(sponsor),new Fr(BigInt(r.window)),new Fr(BigInt(r.batchId)),new Fr(r.index),Fr.fromString(record.owner),Fr.fromString(record.blind)],0x42420104)).toString();}
  return Object.freeze({acquire:async({scope,owner,actionKind,readRegisteredBatch}={})=>{
    let timer,expired=false;const controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(new SponsorCouponError('SPONSOR_COUPON_TIMEOUT'));},deadlineMs);});
    const wait=operation=>Promise.race([operation,deadline]);
    const live=()=>{need(!expired,'SPONSOR_COUPON_TIMEOUT');};
    try {
      need(['claim','post','withdraw'].includes(actionKind)&&typeof readRegisteredBatch==='function','SPONSOR_COUPON_CONFIGURATION_REQUIRED');
      const checkedScope=canonicalScope(scope),author=field(owner,true);
      // Opaque local index, not a remote identifier. Known-owner dictionary probing remains a local metadata limit.
      const partition=await wait(opaqueId(['AZTEC_BB_COUPON_PARTITION_V1',checkedScope,author,sponsor]));
      const records=await wait(store.pending({partition,nowSeconds:String(now())}));need(Array.isArray(records)&&records.length<=64);
      let record=records[0],fresh=false;
      if(!record) {
        const window=String(now()/duration),reservation=await wait(transport.reserve({window}));live();
        need(tokenShape(reservation?.token));const batchId=String(uint(reservation.batchId,64)),index=Number(uint(reservation.index,32));need(BigInt(batchId)>0n&&index<1024);
        let blind;do{blind=Fr.random();}while(blind.isZero());
        record={schemaVersion:1,id:await wait(opaqueId(['AZTEC_BB_COUPON_RECORD_V1',partition,reservation.token])),partition,
          expiresAt:String(bounds(window).end),scope:checkedScope,owner:author,sponsorAddress:sponsor,windowDuration:String(duration),
          reservation:{window,batchId,index,token:reservation.token},blind:blind.toString()};
        matchPublic(reservation,record,false);need(reservation.root===null);
        record.leaf=await wait(makeLeaf(record));need(record.leaf!==Fr.ZERO.toString());live();
        // Await durable completion BEFORE the first opaque submission.
        need(await wait(store.put(record,{nowSeconds:String(now())}))===true,'SPONSOR_COUPON_STORE_UNAVAILABLE');fresh=true;
      }
      need(record.schemaVersion===1&&record.partition===partition&&sameScope(record.scope,checkedScope)&&record.owner===author&&record.sponsorAddress===sponsor&&record.windowDuration===String(duration));
      need(tokenShape(record.reservation?.token)&&Number.isInteger(record.reservation.index)&&record.reservation.index>=0&&record.reservation.index<1024&&uint(record.reservation.batchId,64)>0n);
      need(record.id===await wait(opaqueId(['AZTEC_BB_COUPON_RECORD_V1',partition,record.reservation.token])));
      const {start,end}=bounds(record.reservation.window);need(record.expiresAt===String(end)&&now()>=start&&now()<=end,'SPONSOR_COUPON_EXPIRED');
      field(record.blind,true);need(field(record.leaf,true)===await wait(makeLeaf(record)));
      let retrieved;
      if(!fresh) {
        try{retrieved=await wait(transport.retrieve({token:record.reservation.token}));}
        catch(error){if(!recoverable.has(error?.code))throw error;}
      }
      if(!retrieved) {
        live();const accepted=await wait(transport.submit({token:record.reservation.token,leaf:record.leaf}));
        need(accepted?.accepted===true&&String(uint(accepted.batchId,64))===record.reservation.batchId&&Number(uint(accepted.index,32))===record.reservation.index);
      }
      for(let poll=0;poll<maxPolls;poll++) {
        live();need(now()<=end,'SPONSOR_COUPON_EXPIRED');
        if(!retrieved) {
          try{retrieved=await wait(transport.retrieve({token:record.reservation.token}));}
          catch(error){if(!recoverable.has(error?.code))throw error;}
        }
        if(retrieved) {
          matchPublic(retrieved,record,true);need(field(retrieved.leaf,true)===record.leaf&&Array.isArray(retrieved.siblings)&&retrieved.siblings.length===10);
          const siblings=retrieved.siblings.map(value=>field(value));
          const root=(await wait(computeSponsorCouponRoot({chainId:checkedScope.l1ChainId,version:checkedScope.rollupVersion,sponsorAddress:sponsor,window:record.reservation.window,batchId:record.reservation.batchId,index:record.reservation.index,owner:author,blind:record.blind,siblings}))).toString();
          need(root===field(retrieved.root,true));
          let registered;try{registered=await wait(readRegisteredBatch({batchId:record.reservation.batchId,signal:controller.signal}));}catch(error){if(expired)throw error;}
          if(registered) {
            need(field(registered.root,true)===root&&String(uint(registered.window,64))===record.reservation.window&&uint(registered.ticket_count,32)===uint(retrieved.ticketCount,32));
            const timestamp=uint(registered.timestamp,64);need(timestamp>=start&&timestamp<=end,'SPONSOR_COUPON_EXPIRED');live();
            // Commit the attempted state before returning. A lost return deliberately consumes local availability.
            need(await wait(store.markAttempted(record.id))===true,'SPONSOR_COUPON_ALREADY_ATTEMPTED');live();need(now()<=end,'SPONSOR_COUPON_EXPIRED');
            return {batchId:record.reservation.batchId,index:record.reservation.index,blind:record.blind,siblings};
          }
        }
        if(poll+1<maxPolls)await wait(new Promise(resolve=>setTimeout(resolve,pollIntervalMs)));
      }
      throw new SponsorCouponError('SPONSOR_COUPON_NOT_REGISTERED');
    } catch(error) {
      const safeCodes=['SPONSOR_COUPON_INVALID','SPONSOR_COUPON_CONFIGURATION_REQUIRED','SPONSOR_COUPON_TIMEOUT','SPONSOR_COUPON_EXPIRED','SPONSOR_COUPON_STORE_UNAVAILABLE','SPONSOR_COUPON_ALREADY_ATTEMPTED','SPONSOR_COUPON_NOT_REGISTERED'];
      throw new SponsorCouponError(error instanceof SponsorCouponError&&safeCodes.includes(error.code)?error.code:'SPONSOR_COUPON_UNAVAILABLE');
    }
    finally{clearTimeout(timer);controller.abort();}
  }});
}
