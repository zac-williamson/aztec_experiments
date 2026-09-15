// Local assembly only. The wallet secret is consumed by HKDF, never passed to issuer transport.
import { Fr } from '@aztec/foundation/curves/bn254';
import { createSponsorTransport } from './sponsor-transport.mjs';
import { createSponsorCouponProvider } from './sponsor-coupon-provider.mjs';
export class LocalSponsorProviderError extends Error {
  constructor(){super('SPONSOR_LOCAL_PROVIDER_UNAVAILABLE');this.code='SPONSOR_LOCAL_PROVIDER_UNAVAILABLE';}
}
const need=ok=>{if(!ok)throw new LocalSponsorProviderError();};
function scalar(value){
  need(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value));
  const f=Fr.fromString(value);need(!f.isZero()&&f.toString()===value);return value;
}
const bounded=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
/** createStore is a trusted local adapter factory receiving only {encryptionKey}.
 * HKDF binds the sponsor; chain/board identity remains in authenticated encrypted record scope.
 */
export async function createLocalSponsorCouponProvider(options={}) {
  let store;
  try {
    const keys=['walletSecret','sponsorAddress','windowDuration','issuerUrl','createStore','allowLoopbackHttp','maxPolls','pollIntervalMs','deadlineMs','transportTimeoutMs','nowSeconds'];
    need(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>keys.includes(k)));
    const {walletSecret,sponsorAddress,windowDuration,issuerUrl,createStore,allowLoopbackHttp=false,maxPolls=30,pollIntervalMs=1000,deadlineMs=30000,transportTimeoutMs=5000,nowSeconds}=options;
    const secret=scalar(walletSecret),sponsor=scalar(sponsorAddress);
    need(typeof windowDuration==='string'&&/^[1-9][0-9]{0,4}$/.test(windowDuration)&&BigInt(windowDuration)<=86400n);
    need(typeof createStore==='function'&&typeof allowLoopbackHttp==='boolean'&&bounded(maxPolls,1,30)&&bounded(pollIntervalMs,0,5000)&&bounded(deadlineMs,50,60000)&&bounded(transportTimeoutMs,50,30000)&&(nowSeconds===undefined||typeof nowSeconds==='function'));
    need(globalThis.crypto?.subtle&&globalThis.crypto?.getRandomValues);
    const transport=createSponsorTransport({url:issuerUrl,allowLoopbackHttp,timeoutMs:transportTimeoutMs});
    const input=new Uint8Array(32);for(let i=0;i<32;i++)input[i]=parseInt(secret.slice(2+2*i,4+2*i),16);
    let material;
    try {material=await globalThis.crypto.subtle.importKey('raw',input,'HKDF',false,['deriveKey']);}finally{input.fill(0);}
    const text=new TextEncoder();
    const encryptionKey=await globalThis.crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',
      salt:text.encode('AZTEC_BB_LOCAL_COUPON_STORE_HKDF_SALT_V1'),
      info:text.encode(JSON.stringify(['AZTEC_BB_LOCAL_COUPON_STORE_AES_GCM_V1',sponsor]))},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    store=await createStore({encryptionKey});
    need(store&&['pending','put','markAttempted','close'].every(name=>typeof store[name]==='function'));
    const provider=createSponsorCouponProvider({transport,sponsorAddress:sponsor,windowDuration,store,maxPolls,pollIntervalMs,deadlineMs,...(nowSeconds?{nowSeconds}:{})});
    let closed=false;
    return Object.freeze({
      acquire:async input=>{need(!closed);return provider.acquire(input);},
      close:async()=>{if(closed)return;closed=true;try{await store.close();}catch{throw new LocalSponsorProviderError();}},
    });
  } catch {
    try{if(store&&typeof store.close==='function')await store.close();}catch{}
    throw new LocalSponsorProviderError();
  }
}
