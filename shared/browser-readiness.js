(function(root){
  'use strict';
  // Pinned BB uses isolated shared WASM memory and module workers. This checks
  // prerequisites only: it neither loads proving assets nor guarantees a proof fits.
  const messages={INSECURE_CONTEXT:'Wallet actions require HTTPS or localhost.',SHARED_MEMORY_UNAVAILABLE:'Wallet actions require cross-origin isolation and shared memory.',WASM_UNAVAILABLE:'This browser cannot run the required WebAssembly features.',WORKER_UNAVAILABLE:'Browser workers are unavailable or blocked.',CRYPTO_UNAVAILABLE:'Browser cryptography is unavailable.',LOCKS_UNAVAILABLE:'Browser storage locks are unavailable.',OPFS_UNAVAILABLE:'Private browser file storage is unavailable or blocked. Wallet storage cannot start.',STORAGE_UNAVAILABLE:'Browser storage is unavailable or blocked.',READINESS_TIMEOUT:'Browser capability checks timed out.'};
  function failure(code){const error=new Error(messages[code]);error.code=code;return error;}
  function createChecker(env=root,{timeoutMs=5000}={}){
    let pending,success;
    function check(){
      if(success)return Promise.resolve(success);if(pending)return pending;
      pending=run().then(value=>{success=value;return value;}).finally(()=>{pending=null;});return pending;
    }
    async function run(){
      const cleanup=[];let stopped=false,timer;
      const name='billboard-readiness-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      function guard(){if(stopped)throw failure('READINESS_TIMEOUT');}
      async function stage(code,fn){try{guard();return await fn();}catch(error){throw failure(error?.code==='READINESS_TIMEOUT'?'READINESS_TIMEOUT':code);}}
      const work=async()=>{
        if(env.isSecureContext!==true)throw failure('INSECURE_CONTEXT');
        if(env.crossOriginIsolated!==true||typeof env.SharedArrayBuffer!=='function')throw failure('SHARED_MEMORY_UNAVAILABLE');
        await stage('WASM_UNAVAILABLE',async()=>{
          await env.WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));guard();
          const memory=new env.WebAssembly.Memory({initial:1,maximum:1,shared:true});if(!(memory.buffer instanceof env.SharedArrayBuffer))throw Error();
        });
        await stage('CRYPTO_UNAVAILABLE',()=>env.crypto.subtle.digest('SHA-256',new Uint8Array([1])));
        await stage('LOCKS_UNAVAILABLE',()=>env.navigator.locks.request(name,{ifAvailable:true},lock=>{if(!lock)throw Error();}));
        await stage('WORKER_UNAVAILABLE',()=>new Promise((resolve,reject)=>{
          const url=env.URL.createObjectURL(new env.Blob(['self.onmessage=e=>self.postMessage(e.data)'],{type:'text/javascript'}));cleanup.push(()=>env.URL.revokeObjectURL(url));
          const worker=new env.Worker(url,{type:'module'});cleanup.push(()=>worker.terminate());
          worker.onmessage=event=>event.data===name?resolve():reject(Error());worker.onerror=()=>reject(Error());worker.onmessageerror=()=>reject(Error());worker.postMessage(name);
        }));
        await stage('OPFS_UNAVAILABLE',async()=>{
          const directory=await env.navigator.storage.getDirectory();guard();
          let writable;
          async function remove(){try{await directory.removeEntry(name);}catch{}}
          cleanup.push(()=>{void (async()=>{try{await writable?.abort();}catch{}await remove();})();});
          try{
            const file=await directory.getFileHandle(name,{create:true});
            if(stopped){await remove();guard();}
            writable=await file.createWritable();
            if(stopped){try{await writable.abort();}catch{}await remove();guard();}
            await writable.write(name);guard();await writable.close();writable=null;guard();
            const contents=await file.getFile();guard();if(await contents.text()!==name)throw Error();guard();
            await directory.removeEntry(name);
          }catch(error){try{await writable?.abort();}catch{}await remove();throw error;}
        });
        await stage('STORAGE_UNAVAILABLE',()=>new Promise((resolve,reject)=>{
          let db,transaction,deleted=false;
          function remove(){if(deleted)return null;deleted=true;return env.indexedDB.deleteDatabase(name);}
          cleanup.push(()=>{try{transaction?.abort();}catch{}try{db?.close();}catch{}try{remove();}catch{}});
          const request=env.indexedDB.open(name,1);
          request.onerror=()=>reject(Error());request.onblocked=()=>reject(Error());
          request.onupgradeneeded=()=>{try{request.result.createObjectStore('probe');}catch{reject(Error());}};
          request.onsuccess=()=>{
            db=request.result;if(stopped){db.close();try{env.indexedDB.deleteDatabase(name);}catch{}return;}
            try{
              transaction=db.transaction('probe','readwrite');const store=transaction.objectStore('probe');store.put(name,'key');const read=store.get('key');
              let matches=false;read.onsuccess=()=>{matches=read.result===name;};read.onerror=()=>reject(Error());
              transaction.onerror=()=>reject(Error());transaction.onabort=()=>reject(Error());transaction.oncomplete=()=>{
                db.close();if(!matches){reject(Error());return;}try{const deletion=remove();deletion.onsuccess=()=>resolve();deletion.onerror=()=>reject(Error());deletion.onblocked=()=>reject(Error());}catch{reject(Error());}
              };
            }catch{reject(Error());}
          };
        }));
        guard();return Object.freeze({ready:true,scope:'Browser prerequisites checked; proof performance and capacity are not guaranteed.'});
      };
      try{return await Promise.race([work(),new Promise((resolve,reject)=>{timer=env.setTimeout(()=>{stopped=true;reject(failure('READINESS_TIMEOUT'));},timeoutMs);})]);}
      finally{stopped=true;env.clearTimeout(timer);for(const dispose of cleanup.reverse())try{dispose();}catch{}}
    }
    return Object.freeze({check});
  }
  const checker=createChecker();root.BillboardReadiness=Object.freeze({check:checker.check,createChecker});
})(globalThis);
