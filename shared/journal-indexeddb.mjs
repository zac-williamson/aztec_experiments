// IndexedDB completion (not just request success) is the durability boundary.
export function createBrowserJournalStorage(indexedDB=globalThis.indexedDB) {
  async function open() {
    return new Promise((resolve,reject)=>{const req=indexedDB.open('aztec-billboard-transaction-journal-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('records');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Cannot open transaction journal'));req.onblocked=()=>reject(new Error('Transaction journal upgrade blocked'));});
  }
  async function access(key,write,previous,next) {
    if(!/^[0-9a-f]{64}$/.test(key))throw new Error('Invalid journal key');
    const db=await open();
    try {return await new Promise((resolve,reject)=>{
      const tx=db.transaction('records',write?'readwrite':'readonly',write?{durability:'strict'}:undefined),store=tx.objectStore('records');
      let value=null;const request=store.get(key);
      request.onsuccess=()=>{value=request.result??null;if(write){if(value!==previous){tx.abort();return;}store.put(next,key);}};
      tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(new Error('Transaction journal update failed'));
    });}finally {db.close();}
  }
  async function keys() {
    const db=await open();try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readonly'),req=tx.objectStore('records').getAllKeys(null,10001);
      tx.oncomplete=()=>req.result.length>10000?reject(new Error('Transaction journal is too large')):resolve(req.result);
      tx.onabort=tx.onerror=()=>reject(new Error('Cannot enumerate transaction journal'));
    });}finally{db.close();}
  }
  return {keys,read:key=>access(key,false),compareAndSwap:(key,previous,next)=>access(key,true,previous,next)};
}
