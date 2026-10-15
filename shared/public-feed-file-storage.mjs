import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readFeedSnapshot,publicFeedConflict} from './public-feed-storage.mjs';

// Public cache only. SQLite supplies atomic range/head updates and snapshot reads.
export function publicFeedFileStorage(directory,{maxRecordBytes=16*1024*1024,maxSnapshotBytes=256*1024*1024}={}){
 if(!Number.isSafeInteger(maxRecordBytes)||maxRecordBytes<1||maxRecordBytes>256*1024*1024||!Number.isSafeInteger(maxSnapshotBytes)||maxSnapshotBytes<maxRecordBytes||maxSnapshotBytes>1024*1024*1024)throw Error('Invalid public cache byte limits');
 const capacity=()=>Object.assign(Error('Public cache exceeds configured byte limits.'),{code:'PUBLIC_FEED_CAPACITY'});
 const checkText=value=>{if(typeof value!=='string'||Buffer.byteLength(value)>maxRecordBytes)throw capacity();};
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid public cache directory');
 const filename=path.join(directory,'public-feed-v2.sqlite');
 function open(){
  if(fs.existsSync(filename)&&(!fs.lstatSync(filename).isFile()||fs.lstatSync(filename).isSymbolicLink()))throw Error('Invalid public cache database');
  const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY,value TEXT NOT NULL)');return db;
 }
 return {
  async load(key,maxRanges){const db=open();try{
   db.exec('BEGIN');const size=db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM records WHERE key=?'),read=db.prepare('SELECT value FROM records WHERE key=?');let bytes=0;
   const result=await readFeedSnapshot(k=>{
    // Check inside the same SQLite snapshot before materializing or parsing text.
    const row=size.get(k);if(!row)return null;
    if(!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>maxRecordBytes||bytes+row.bytes>maxSnapshotBytes)throw capacity();
    bytes+=row.bytes;return read.get(k).value;
   },key,maxRanges);db.exec('COMMIT');return result;
  }finally{db.close();}},
  async commit(key,previous,next,range,removed){const db=open();try{
   checkText(next);if(range)checkText(range.value);
   db.exec('BEGIN IMMEDIATE');const size=db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM records WHERE key=?').get(key);
   if(size&&(!Number.isSafeInteger(size.bytes)||size.bytes<0||size.bytes>maxRecordBytes))throw capacity();
   const current=db.prepare('SELECT value FROM records WHERE key=?').get(key)?.value??null;
   if(current!==previous)throw publicFeedConflict();
   if(range)db.prepare('INSERT INTO records VALUES (?,?)').run(`${key}:range:${range.id}`,range.value);
   db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,next);
   const remove=db.prepare('DELETE FROM records WHERE key=?');for(const id of removed)remove.run(`${key}:range:${id}`);
   db.exec('COMMIT');
  }finally{db.close();}},
 };
}
