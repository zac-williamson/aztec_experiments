// Browser durable encrypted storage. CLI must supply a genuinely durable adapter, not fake IndexedDB.
export class CouponStoreError extends Error { constructor(){super('SPONSOR_COUPON_STORE_UNAVAILABLE');this.code='SPONSOR_COUPON_STORE_UNAVAILABLE';} }
const validHex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const validTime=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&x.length<=20&&BigInt(x)<1n<<64n;
const requireValue=x=>{if(!x)throw new CouponStoreError();};
const aad=row=>new TextEncoder().encode(JSON.stringify(['AZTEC_BB_SPONSOR_COUPON_V1',row.id,row.partition,row.expiresAt,row.attempted]));
export async function createIndexedDBSponsorCouponStore({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto,encryptionKey,databaseName='aztec-bb-sponsor-coupons-v1',maxRecords=64}={}) {
  requireValue(indexedDB?.open&&crypto?.subtle&&crypto?.getRandomValues&&encryptionKey?.algorithm?.name==='AES-GCM'&&encryptionKey.usages?.includes('encrypt')&&encryptionKey.usages?.includes('decrypt'));
  requireValue(typeof databaseName==='string'&&databaseName.length>0&&databaseName.length<=128&&Number.isInteger(maxRecords)&&maxRecords>0&&maxRecords<=64);
  const db=await new Promise((resolve,reject)=>{
    let rejected=false;
    const fail=()=>{rejected=true;reject(new CouponStoreError());};
    try {const request=indexedDB.open(databaseName,1);
      request.onupgradeneeded=()=>{if(rejected){request.transaction.abort();return;}request.result.createObjectStore('records',{keyPath:'id'});};
      request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};request.onerror=fail;request.onblocked=fail;
    }catch{fail();}
  });
  let closed=false;
  const transact=fn=>new Promise((resolve,reject)=>{
    if(closed){reject(new CouponStoreError());return;}
    let tx,result;
    try {
      tx=db.transaction('records','readwrite',{durability:'strict'});const store=tx.objectStore('records');
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new CouponStoreError());tx.onerror=()=>{};
      const count=store.count();count.onsuccess=()=>{
        if(count.result>maxRecords){tx.abort();return;}
        const get=store.getAll();get.onsuccess=()=>{
          try {result=fn(store,get.result);}catch{tx.abort();}
        };
      };
    } catch {if(tx)try{tx.abort();}catch{}reject(new CouponStoreError());}
  });
  function clean(store,rows,nowSeconds) {
    requireValue(validTime(String(nowSeconds)));const now=BigInt(nowSeconds);
    const retained=[];
    for(const row of rows){requireValue(row.schemaVersion===1&&validHex(row.id)&&validHex(row.partition)&&validTime(row.expiresAt)&&typeof row.attempted==='boolean');if(BigInt(row.expiresAt)<now)store.delete(row.id);else retained.push(row);}
    return retained;
  }
  async function encrypt(record,attempted=false) {
    requireValue(record.schemaVersion===1&&validHex(record.id)&&validHex(record.partition)&&validTime(record.expiresAt));
    const bytes=new TextEncoder().encode(JSON.stringify(record));requireValue(bytes.length<=8192);
    const row={schemaVersion:1,id:record.id,partition:record.partition,expiresAt:record.expiresAt,attempted,iv:crypto.getRandomValues(new Uint8Array(12))};
    row.ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:row.iv,additionalData:aad(row)},encryptionKey,bytes));return row;
  }
  async function decrypt(row) {
    requireValue(row.iv instanceof Uint8Array&&row.iv.length===12&&row.ciphertext instanceof Uint8Array&&row.ciphertext.length<=8208);
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad(row)},encryptionKey,row.ciphertext);
    const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    requireValue(record.id===row.id&&record.partition===row.partition&&record.expiresAt===row.expiresAt&&record.schemaVersion===1);return record;
  }
  const safe=fn=>async(...args)=>{try{return await fn(...args);}catch{throw new CouponStoreError();}};
  return Object.freeze({
    pending:safe(async({partition,nowSeconds})=>{requireValue(validHex(partition));const rows=await transact((store,rows)=>{const retained=clean(store,rows,nowSeconds),pending=retained.filter(row=>row.partition===partition&&!row.attempted);requireValue(pending.length>0||retained.length<maxRecords);return pending;});return Promise.all(rows.map(decrypt));}),
    put:safe(async(record,{nowSeconds})=>{const row=await encrypt(record);return transact((store,rows)=>{const retained=clean(store,rows,nowSeconds);requireValue(!retained.some(item=>item.id===row.id)&&retained.length<maxRecords&&BigInt(row.expiresAt)>=BigInt(nowSeconds));store.add(row);return true;});}),
    markAttempted:safe(async(id)=>{
      requireValue(validHex(id));
      const before=await transact((_store,rows)=>rows.find(item=>item.id===id));
      if(!before)return false;
      const record=await decrypt(before);if(before.attempted)return false;
      const after=await encrypt(record,true);
      const fingerprint=row=>JSON.stringify([row.schemaVersion,row.id,row.partition,row.expiresAt,row.attempted,Array.from(row.iv),Array.from(row.ciphertext)]);
      return transact((store,rows)=>{const current=rows.find(item=>item.id===id);if(!current||fingerprint(current)!==fingerprint(before))return false;store.put(after);return true;});
    }),
    close:()=>{if(!closed){db.close();closed=true;}},
  });
}
