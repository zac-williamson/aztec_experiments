// IndexedDB completion (not just request success) is the durability boundary.
export function createBrowserJournalStorage(indexedDB=globalThis.indexedDB) {
  async function open() {
    return new Promise((resolve,reject)=>{let rejected=false;const req=indexedDB.open('aztec-billboard-transaction-journal-v1',2);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('records'))req.result.createObjectStore('records');if(!req.result.objectStoreNames.contains('recovery-metadata'))req.result.createObjectStore('recovery-metadata');};req.onsuccess=()=>{if(rejected)req.result.close();else resolve(req.result);};req.onerror=()=>{rejected=true;reject(new Error('Cannot open transaction journal'));};req.onblocked=()=>{rejected=true;reject(new Error('Transaction journal upgrade blocked'));};});
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
  // This local epoch is never enumerated/exported with portable financial records.
  // Reading an existing attempt never initializes missing metadata into authority.
  async function recoveryEpoch(mode='read') {
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      const write=mode!=='read',tx=db.transaction('recovery-metadata',write?'readwrite':'readonly',write?{durability:'strict'}:undefined),store=tx.objectStore('recovery-metadata');
      let value=null;const req=store.get('epoch');
      req.onsuccess=()=>{try{value=req.result??null;
        if(value!==null&&(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))){tx.abort();return;}
        if(mode==='rotate'||mode==='ensure'&&value===null){value=Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');store.put(value,'epoch');}
      }catch{tx.abort();}};
      tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(new Error('Recovery provenance update failed'));
    });}finally{db.close();}
  }
  return {keys,read:key=>access(key,false),compareAndSwap:(key,previous,next)=>access(key,true,previous,next),
    readRecoveryEpoch:()=>recoveryEpoch(),ensureRecoveryEpoch:()=>recoveryEpoch('ensure'),rotateRecoveryEpoch:()=>recoveryEpoch('rotate')};
}
