import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
// Ciphertext-only adapter. Each update is serialized by an exclusive lock;
// stale locks require inspection, never automatic takeover after a crash.
export function createFileJournalStorage(directory) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const dir=fs.lstatSync(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077))throw new Error('Transaction journal requires a private directory');
  function target(key){if(!/^[0-9a-f]{64}$/.test(key))throw new Error('Invalid journal key');return path.join(directory,key+'.json');}
  function read(key) {
    let fd;try {fd=fs.openSync(target(key),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
    try {const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o077)||st.size>32*1024*1024+16384)throw new Error('Invalid journal record');return fs.readFileSync(fd,'utf8');}finally {fs.closeSync(fd);}
  }
  return {async keys(){const entries=fs.readdirSync(directory).filter(name=>/^[0-9a-f]{64}\.json$/.test(name));if(entries.length>10000)throw new Error('Transaction journal is too large');return entries.map(name=>name.slice(0,-5));},async read(key){return read(key);},async compareAndSwap(key,previous,next){
    const file=target(key),lock=file+'.lock',temporary=file+'.'+randomBytes(12).toString('hex')+'.tmp';
    const lockFd=fs.openSync(lock,'wx',0o600);let fd;
    try {
      if(read(key)!==previous)throw new Error('Concurrent journal update');
      if(typeof next!=='string'||Buffer.byteLength(next)>32*1024*1024+16384)throw new Error('Invalid journal update');
      fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,next);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.renameSync(temporary,file);
      const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
      if(read(key)!==next)throw new Error('Journal read-back failed');
    }finally {if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});fs.closeSync(lockFd);fs.unlinkSync(lock);}
  }};
}
