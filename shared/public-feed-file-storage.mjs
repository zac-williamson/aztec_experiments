import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readFeedSnapshot} from './public-feed-storage.mjs';

// Public cache only. SQLite supplies atomic range/head updates and snapshot reads.
export function publicFeedFileStorage(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid public cache directory');
 const filename=path.join(directory,'public-feed-v2.sqlite');
 function open(){
  if(fs.existsSync(filename)&&(!fs.lstatSync(filename).isFile()||fs.lstatSync(filename).isSymbolicLink()))throw Error('Invalid public cache database');
  const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY,value TEXT NOT NULL)');return db;
 }
 return {
  async load(key,maxRanges){const db=open();try{db.exec('BEGIN');const read=db.prepare('SELECT value FROM records WHERE key=?');const result=await readFeedSnapshot(k=>read.get(k)?.value??null,key,maxRanges);db.exec('COMMIT');return result;}finally{db.close();}},
  async commit(key,previous,next,range,removed){const db=open();try{
   db.exec('BEGIN IMMEDIATE');const current=db.prepare('SELECT value FROM records WHERE key=?').get(key)?.value??null;
   if(current!==previous)throw Error('Concurrent public cache update; reopen to reconcile.');
   if(range)db.prepare('INSERT INTO records VALUES (?,?)').run(`${key}:range:${range.id}`,range.value);
   db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,next);
   const remove=db.prepare('DELETE FROM records WHERE key=?');for(const id of removed)remove.run(`${key}:range:${id}`);
   db.exec('COMMIT');
  }finally{db.close();}},
 };
}
