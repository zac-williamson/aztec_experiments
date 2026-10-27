// Default stores are untrusted caches and require full canonical authentication.
// An explicit service-owned store may resume its own validated publication;
// it is local server state, not an imported cache or independent chain authority.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH} from '@aztec-labs/constants';
import {isRollingEvent,validateRollingScope} from './public-events.mjs';
import {ROLLING_PROJECTION_TABLES,stageRollingPublicReduction,normalizeHomeSubboards,normalizeLikePosts} from './public-projection.mjs';

const error=code=>Object.assign(Error('Rolling public storage is unavailable.'),{code});
const requireThat=(v,code='ROLLING_PUBLIC_STORAGE_INVALID')=>{if(!v)throw error(code);};
const conflict=()=>error('ROLLING_PUBLIC_STORAGE_CONFLICT');
const capacity=()=>error('ROLLING_PUBLIC_STORAGE_CAPACITY');
const tables=new Set(ROLLING_PROJECTION_TABLES);
// Bump when decoder/reducer semantics or the durable projection format change.
const OWNED_RESUME_VERSION=2;
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const uint=(v,bits=256)=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=78&&BigInt(v)<(1n<<BigInt(bits));
const key=v=>{requireThat(uint(v));return BigInt(v).toString(16).padStart(64,'0');};
const increment=v=>{const n=String(BigInt(v)+1n);requireThat(uint(n));return n;};
const bounded=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const plain=(v,keys)=>{requireThat(v&&Object.getPrototypeOf(v)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(v);
 requireThat(Object.keys(descriptors).sort().join()===keys.slice().sort().join());for(const d of Object.values(descriptors))requireThat(Object.hasOwn(d,'value'));return v;};
const clone=v=>structuredClone(v);
const emptyScalars=()=>({version:'0',last:null,scope:null,eventCount:'0',postCount:'0'});
const positionKey=p=>key(p.blockNumber)+key(p.txIndexWithinBlock)+key(p.logIndexWithinTx);
const limitsDefault=Object.freeze({maxRowBytes:1024*1024,maxTransactionBytes:32*1024*1024,maxReadBytes:8*1024*1024,cacheKiB:32768});

// Closed indexed seeks shared with EXPLAIN regression checks. Every range has a
// LIMIT; no OFFSET, unbounded LIKE, history sort, or caller-supplied SQL.
const columns="CASE WHEN length(k)<=78 THEN k END AS k,"+['ord','likes','stamp','idnum'].map(c=>`CASE WHEN length(${c})=64 THEN ${c} END AS ${c}`).join(',')+",CASE WHEN length(slug)<=62 THEN slug END AS slug,length(CAST(value AS BLOB)) AS bytes";
const seek=(index,where,order)=>`SELECT ${columns} FROM projection INDEXED BY ${index} WHERE g=? AND kind=? AND ${where} ORDER BY ${order.replace(/\b(ord|likes|stamp|idnum|slug|k)\b/g,'projection.$1')} LIMIT ?`;
export const ROLLING_PUBLIC_QUERY_SQL=Object.freeze({
 accounting:seek('projection_accounting','idnum>?','idnum ASC'),
 predecessor:seek('projection_pending_thread',"kind='posts' AND json_extract(value,'$.invocation') IS NOT NULL AND json_extract(value,'$.invocation.reply') IS NULL AND root=? AND json_extract(value,'$.invocation.pluginId')=? AND json_extract(value,'$.invocation.adapter')=? AND ord<? AND ord>?",'ord ASC'),
 feed:seek('projection_order','ord<?','ord DESC'),
 chronological:seek('projection_order','ord>?','ord ASC'),
 pending:seek('projection_pending',"kind='posts' AND json_extract(value,'$.invocation') IS NOT NULL AND json_extract(value,'$.invocation.reply') IS NULL AND ord>?",'ord ASC'),
 board:seek('projection_board','board=? AND ord<?','ord DESC'),
 profile:seek('projection_name','name=? AND ord<?','ord DESC'),
 thread:seek('projection_root','root=? AND ord>?','ord ASC'),
 directory:seek('projection_slug','(slug,k)>(?,?)','slug,k'),
 // Three disjoint lexicographic ranges keep each mixed-direction ranking seek
 // indexed, rather than an OR filter walking all earlier rows on deep pages.
 rankFirst:seek('projection_rank','board=?','likes DESC,stamp DESC,idnum'),
 rankLikes:seek('projection_rank','board=? AND likes<?','likes DESC,stamp DESC,idnum'),
 rankStamp:seek('projection_rank','board=? AND likes=? AND stamp<?','stamp DESC,idnum'),
 rankId:seek('projection_rank','board=? AND likes=? AND stamp=? AND idnum>?','idnum'),
});

// One physical owning directory and one immutable scope per database. A new
// generation is an explicit rebuild, never an inferred trusted cache restore.
export function createRollingPublicSqliteStore(directory,{scope,serviceOwned=false,...options}={}){
 requireThat(typeof directory==='string'&&path.isAbsolute(directory));
 requireThat(typeof serviceOwned==='boolean');
 requireThat(Object.keys(options).every(k=>Object.hasOwn(limitsDefault,k)));
 const limits={...limitsDefault,...options};
 requireThat(bounded(limits.maxRowBytes,65536,4*1024*1024)&&bounded(limits.maxTransactionBytes,limits.maxRowBytes,128*1024*1024)&&bounded(limits.maxReadBytes,limits.maxRowBytes,32*1024*1024)&&bounded(limits.cacheKiB,1024,65536));
 const capturedScope=validateRollingScope(scope),scopeText=JSON.stringify(capturedScope);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 requireThat(fs.realpathSync(directory)===path.resolve(directory)&&fs.lstatSync(directory).isDirectory());
 const filename=path.join(directory,'rolling-public-v3.sqlite');
 const assertPrivateOwner=()=>{
  if(!serviceOwned)return;
  requireThat(typeof process.geteuid==='function');const uid=process.geteuid(),dir=fs.lstatSync(directory);
  requireThat(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===uid&&(dir.mode&0o777)===0o700);
  for(const suffix of ['', '-wal', '-shm']){const file=filename+suffix;if(fs.existsSync(file)){const stat=fs.lstatSync(file);
   requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.uid===uid&&(stat.mode&0o777)===0o600);
  }}
 };
 assertPrivateOwner();
 if(serviceOwned&&!fs.existsSync(filename)){const fd=fs.openSync(filename,'wx',0o600);fs.closeSync(fd);}
 for(const suffix of ['', '-wal', '-shm']){const file=filename+suffix;if(fs.existsSync(file)){const s=fs.lstatSync(file);requireThat(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);}}
 const db=new DatabaseSync(filename);let closed=false,active=false;
 // Authentication epoch is RAM-only, distinct from durable generation/revision.
 const authenticationEpoch=randomBytes(16).toString('hex');
 try{db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
 PRAGMA cache_size=-${limits.cacheKiB}; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
 PRAGMA busy_timeout=0;
 CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owned_resume(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS projection(g TEXT NOT NULL,kind TEXT NOT NULL,k TEXT NOT NULL,value TEXT NOT NULL,
 ord TEXT,board TEXT,name TEXT,root TEXT,likes TEXT,stamp TEXT,slug TEXT,idnum TEXT,PRIMARY KEY(g,kind,k)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS projection_active_likes ON projection(g,kind,board,idnum) WHERE kind='likes' AND value='true';
 CREATE INDEX IF NOT EXISTS projection_accounting ON projection(g,kind,idnum,k);
 CREATE INDEX IF NOT EXISTS projection_order ON projection(g,kind,ord,k);
 CREATE INDEX IF NOT EXISTS projection_pending ON projection(g,kind,ord,k) WHERE kind='posts' AND json_extract(value,'$.invocation') IS NOT NULL AND json_extract(value,'$.invocation.reply') IS NULL;
 CREATE INDEX IF NOT EXISTS projection_pending_thread ON projection(g,kind,root,json_extract(value,'$.invocation.pluginId'),json_extract(value,'$.invocation.adapter'),ord,k) WHERE kind='posts' AND json_extract(value,'$.invocation') IS NOT NULL AND json_extract(value,'$.invocation.reply') IS NULL;
 CREATE INDEX IF NOT EXISTS projection_board ON projection(g,kind,board,ord,k);
 CREATE INDEX IF NOT EXISTS projection_name ON projection(g,kind,name,ord,k);
 CREATE INDEX IF NOT EXISTS projection_root ON projection(g,kind,root,ord,k);
 CREATE INDEX IF NOT EXISTS projection_rank ON projection(g,kind,board,likes DESC,stamp DESC,idnum);
 CREATE INDEX IF NOT EXISTS projection_slug ON projection(g,kind,slug,k);
 CREATE TABLE IF NOT EXISTS events(g TEXT NOT NULL,pos TEXT NOT NULL,segment TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(g,pos)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS events_segment ON events(g,segment,pos);
 CREATE INDEX IF NOT EXISTS events_accounting ON events(g,json_extract(value,'$.type'),json_extract(value,'$.payload.request_id'),pos) WHERE length(CAST(value AS BLOB))<=1048576 AND json_valid(value);
 CREATE TABLE IF NOT EXISTS segments(g TEXT NOT NULL,seq TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(g,seq)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS inverse(g TEXT NOT NULL,seq TEXT NOT NULL,kind TEXT NOT NULL,k TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(g,seq,kind,k)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS blocks(g TEXT NOT NULL,n TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(g,n)) WITHOUT ROWID;`);
 fs.chmodSync(filename,0o600);
 }catch(e){db.close();throw e;}
 // SQLite's connection-local change counter detects *any* other connection's
 // commit, including projection-only edits that leave the control CAS intact.
 // Reopening captures a new counter but grants no authentication authority.
 const dataVersion=()=>db.prepare('PRAGMA data_version').get().data_version;
 const capturedDataVersion=dataVersion();
 const checkDataVersion=()=>{if(dataVersion()!==capturedDataVersion)throw conflict();};
 const statements=new Map();const prepare=sql=>{if(!statements.has(sql))statements.set(sql,db.prepare(sql));return statements.get(sql);};
 const encode=value=>{const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>limits.maxRowBytes)throw capacity();return text;};
 const readSized=(select,args,budget)=>{
  // SELECT length first inside the SAME transaction; do not materialize a
  // corrupt oversized value and only then check its JSON length.
  const meta=prepare(select.replace('SELECT value','SELECT length(CAST(value AS BLOB)) AS bytes')).get(...args);
  if(!meta)return undefined;
  if(!bounded(meta.bytes,0,limits.maxRowBytes)||budget.bytes+meta.bytes>budget.max)throw capacity();
  budget.bytes+=meta.bytes;return JSON.parse(prepare(select).get(...args).value);
 };
 const readControl=budget=>readSized('SELECT value FROM control WHERE id=1',[],budget)??null;
 const checkControl=c=>{if(c){requireThat(c.schema===3&&c.scope===scopeText&&uint(c.generation)&&uint(c.revision)&&uint(c.segmentCount));}return c;};
 const transaction=(write,fn)=>{
  requireThat(!closed&&!active);active=true;let begun=false;
  try{db.exec(write?'BEGIN IMMEDIATE':'BEGIN');begun=true;
   // Establish the deferred read snapshot before checking its version. Writes
   // hold IMMEDIATE's writer lease. No network/await occurs in this transaction.
   prepare('SELECT id FROM control WHERE id=1').get();checkDataVersion();assertPrivateOwner();
   const result=fn();checkDataVersion();db.exec('COMMIT');begun=false;
   // An external WAL commit during a read snapshot must invalidate its result
   // before publication as well; do not silently adopt the newer data_version.
   checkDataVersion();return result;}
  catch(e){if(begun){try{db.exec('ROLLBACK');}catch(rollback){throw new AggregateError([e,rollback],'Rolling public storage rollback failed.');}}throw e;}
  finally{active=false;}
 };
 const budget=max=>({bytes:0,max});
 const current=(expected,b)=>{const c=checkControl(readControl(b));if(JSON.stringify(c)!==JSON.stringify(expected))throw conflict();return c;};
 const save=c=>prepare('INSERT INTO control VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(encode(c));
 const projectionRead=(g,kind,k,b)=>readSized('SELECT value FROM projection WHERE g=? AND kind=? AND k=?',[g,kind,k],b);
 const projectionWrite=(g,kind,k,value)=>{
  requireThat(tables.has(kind)&&typeof k==='string'&&k.length<=160);
  const p=kind==='posts'?value:null,like=kind==='likes'?k.split(':'):null;
  if(like)requireThat(like.length===2&&like.every(v=>uint(v))&&typeof value==='boolean');
  prepare(`INSERT INTO projection VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(g,kind,k) DO UPDATE SET
   value=excluded.value,ord=excluded.ord,board=excluded.board,name=excluded.name,root=excluded.root,likes=excluded.likes,stamp=excluded.stamp,slug=excluded.slug,idnum=excluded.idnum`)
   .run(g,kind,k,encode(value),p?key(p.order):null,p?key(p.record.subboard):like?key(like[0]):null,p?key(p.record.name_id):null,p?key(p.record.root):null,p?key(p.likes):null,p?key(p.timestamp):null,kind==='boards'?value.slug:null,p?key(p.id):like?key(like[1]):kind==='bok'?key(k):null);
 };
 const writeSegment=(c,next,changes,events,blockCompleted,b)=>{
  const seq=key(next.segmentCount),g=c.generation;
  const inverse=[];let bytes=0;
  for(const change of changes){const value=encode({existed:change.existed,before:change.existed?change.before:null});bytes+=Buffer.byteLength(value)+Buffer.byteLength(encode(change.value));inverse.push([change,value]);}
  const raw=events.map(e=>{const value=encode(e);bytes+=Buffer.byteLength(value);return value;});
  const segment=encode({before:c,eventCount:events.length,blockCompleted});bytes+=Buffer.byteLength(segment)+Buffer.byteLength(encode(next));
  if(bytes+b.bytes>limits.maxTransactionBytes)throw capacity();
  for(const [change,value] of inverse){prepare('INSERT INTO inverse VALUES(?,?,?,?,?)').run(g,seq,change.table,change.key,value);projectionWrite(g,change.table,change.key,change.value);}
  for(let i=0;i<events.length;i++)prepare('INSERT INTO events VALUES(?,?,?,?)').run(g,positionKey(events[i].position),seq,raw[i]);
  prepare('INSERT INTO segments VALUES(?,?,?)').run(g,seq,segment);save(next);
 };
 const blockInput=block=>{plain(block,['number','hash','parentHash','transactionCount']);requireThat(uint(block.number,53)&&block.number!=='0'&&hash(block.hash)&&hash(block.parentHash)&&uint(block.transactionCount,32));return clone(block);};
 const checkBlock=(c,block)=>{
  requireThat(block.number===c.cursor.blockNumber&&block.parentHash===c.checkpoint.hash);
  if(c.cursor.block!==null)requireThat(JSON.stringify(c.cursor.block)===JSON.stringify(block));
 };
 const captureExpected=expected=>{
  let nodes=0;const capture=(v,depth=0)=>{requireThat(depth<16&&++nodes<50000);
   if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
   if(typeof v==='string'){requireThat(v.length<=limits.maxRowBytes);return v;}
   requireThat(v&&typeof v==='object'&&(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype));
   const out=Array.isArray(v)?[]:{};if(Array.isArray(v))requireThat(v.length<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
   for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(Array.isArray(v)&&k==='length')continue;requireThat(Object.hasOwn(d,'value'));out[k]=capture(d.value,depth+1);}return out;
  };return capture(expected);
 };
 function inspect(){return transaction(false,()=>({authenticationEpoch,trusted:false,control:clone(checkControl(readControl(budget(limits.maxReadBytes))))}));}
 function resumeBinding(c,deployment){
  plain(deployment,['blockNumber','blockHash','txHash']);requireThat(Number.isSafeInteger(deployment.blockNumber)&&deployment.blockNumber>0&&hash(deployment.blockHash)&&hash(deployment.txHash));
  return {version:OWNED_RESUME_VERSION,schema:3,scope:scopeText,deployment:clone(deployment),generation:c.generation};
 }
 function canResumeOwned({expectedControl,deployment}){
  if(!serviceOwned)return false;const expected=captureExpected(expectedControl);
  return transaction(false,()=>{const b=budget(limits.maxReadBytes),c=current(expected,b);if(!c)return false;
   let saved;try{saved=readSized('SELECT value FROM owned_resume WHERE id=1',[],b);}catch(error){if(error instanceof SyntaxError)return false;throw error;}
   return JSON.stringify(saved)===JSON.stringify(resumeBinding(c,deployment));
  });
 }
 function recordOwnedPublication({expectedControl,deployment}){
  if(!serviceOwned)return;const expected=captureExpected(expectedControl);
  return transaction(true,()=>{const c=current(expected,budget(limits.maxTransactionBytes));requireThat(c&&c.cursor.block===null&&c.scalars.version!=='0');
   const value=encode(resumeBinding(c,deployment));prepare('INSERT INTO owned_resume VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE value!=excluded.value').run(value);
  });
 }
 function startGeneration({expectedControl,origin}){
  const expected=captureExpected(expectedControl);plain(origin,['number','hash']);requireThat(uint(origin.number,53)&&hash(origin.hash));const base=clone(origin);
  return transaction(true,()=>{const old=current(expected,budget(limits.maxTransactionBytes));
   const next={schema:3,scope:scopeText,generation:old?increment(old.generation):'1',revision:old?increment(old.revision):'1',segmentCount:'0',checkpoint:base,cursor:{blockNumber:increment(base.number),nextTxIndex:'0',block:null},scalars:emptyScalars()};save(next);return clone(next);});
 }
 function commitTransaction({expectedControl,block,txIndex,txHash,events}){
  const expected=captureExpected(expectedControl),captured=blockInput(block);
  requireThat(uint(txIndex,32)&&hash(txHash)&&Array.isArray(events)&&events.length<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
  // Check the original decoder's process-local brand before reading properties
  // or serializing. No caller predicate can turn plaintext into authority.
  const input=[];for(let i=0;i<events.length;i++){const d=Object.getOwnPropertyDescriptor(events,String(i));requireThat(d&&Object.hasOwn(d,'value'));input.push(d.value);}for(const e of input){requireThat(isRollingEvent(e));requireThat(JSON.stringify(e.scope)===scopeText&&e.position.blockNumber===captured.number&&e.position.blockHash===captured.hash&&e.position.txIndexWithinBlock===txIndex&&e.position.txHash===txHash);}
  return transaction(true,()=>{const b=budget(limits.maxTransactionBytes),c=current(expected,b);requireThat(c);checkBlock(c,captured);
   requireThat(txIndex===c.cursor.nextTxIndex&&BigInt(txIndex)<BigInt(captured.transactionCount));
   const reduction=stageRollingPublicReduction(input,{isValidatedEvent:isRollingEvent,read:(table,k)=>projectionRead(c.generation,table,k,b),scalars:c.scalars});
   const next={...c,revision:increment(c.revision),segmentCount:increment(c.segmentCount),cursor:{...c.cursor,nextTxIndex:increment(txIndex),block:captured},scalars:reduction.scalars};
   writeSegment(c,next,reduction.changes,input,null,b);return clone(next);
  });
 }
 function completeBlock({expectedControl,block}){
  const expected=captureExpected(expectedControl),captured=blockInput(block);
  return transaction(true,()=>{const b=budget(limits.maxTransactionBytes),c=current(expected,b);requireThat(c);checkBlock(c,captured);requireThat(c.cursor.nextTxIndex===captured.transactionCount);
   const next={...c,revision:increment(c.revision),segmentCount:increment(c.segmentCount),checkpoint:{number:captured.number,hash:captured.hash},cursor:{blockNumber:increment(captured.number),nextTxIndex:'0',block:null}};
   prepare('INSERT INTO blocks VALUES(?,?,?)').run(c.generation,key(captured.number),encode(captured));
   writeSegment(c,next,[],[],captured.number,b);return clone(next);
  });
 }
 // One segment per call, independent of total history or rollback depth. Caller
 // persists/owns reorg discovery and MUST withhold publication while reconciling.
 function rollbackOne({expectedControl}){
  const expected=captureExpected(expectedControl);
  return transaction(true,()=>{const b=budget(limits.maxTransactionBytes),c=current(expected,b);requireThat(c&&c.segmentCount!=='0');const seq=key(c.segmentCount),g=c.generation;
   const segment=readSized('SELECT value FROM segments WHERE g=? AND seq=?',[g,seq],b);requireThat(segment);
   const rows=prepare('SELECT CASE WHEN length(kind)<=8 THEN kind ELSE NULL END AS kind,CASE WHEN length(k)<=160 THEN k ELSE NULL END AS k,length(CAST(value AS BLOB)) AS bytes FROM inverse WHERE g=? AND seq=? ORDER BY kind,k LIMIT ?').all(g,seq,FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH*4+1);
   requireThat(rows.length<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH*4);
   // The reducer touches at most three keyed rows per event. Keep a conservative
   // four-row bound, not a history-size cap; lengths are checked before values.
   for(const row of rows){requireThat(tables.has(row.kind)&&typeof row.k==='string');const prior=readSized('SELECT value FROM inverse WHERE g=? AND seq=? AND kind=? AND k=?',[g,seq,row.kind,row.k],b);requireThat(prior&&typeof prior.existed==='boolean');
    if(prior.existed)projectionWrite(g,row.kind,row.k,prior.before);else prepare('DELETE FROM projection WHERE g=? AND kind=? AND k=?').run(g,row.kind,row.k);
    prepare('DELETE FROM inverse WHERE g=? AND seq=? AND kind=? AND k=?').run(g,seq,row.kind,row.k);
   }
   const eventRows=prepare('SELECT CASE WHEN length(pos)=192 THEN pos ELSE NULL END AS pos FROM events WHERE g=? AND segment=? ORDER BY pos LIMIT ?').all(g,seq,FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH+1);requireThat(eventRows.length===segment.eventCount&&eventRows.length<=FLAT_PUBLIC_LOGS_PAYLOAD_LENGTH);
   for(const row of eventRows){requireThat(typeof row.pos==='string'&&/^[0-9a-f]{192}$/.test(row.pos));prepare('DELETE FROM events WHERE g=? AND pos=?').run(g,row.pos);}
   if(segment.blockCompleted!==null)prepare('DELETE FROM blocks WHERE g=? AND n=?').run(g,key(segment.blockCompleted));
   prepare('DELETE FROM segments WHERE g=? AND seq=?').run(g,seq);
   const next={...segment.before,revision:increment(c.revision)};requireThat(next.scope===scopeText&&next.generation===g&&BigInt(next.segmentCount)+1n===BigInt(c.segmentCount));save(next);return clone(next);
  });
 }
 function readProjection({expectedControl,table,k}){
  requireThat(tables.has(table)&&typeof k==='string'&&k.length<=160);const expected=captureExpected(expectedControl);
  return transaction(false,()=>{const b=budget(limits.maxReadBytes),c=current(expected,b);requireThat(c);return projectionRead(c.generation,table,k,b)??null;});
 }
 // Bounded, canonical-owner guarded keyset predecessor scan. No terminal
 // accounting is inferred from this unauthenticated public cache.
 function readPendingPredecessors({expectedControl,id,after=null,limit=64}){
  requireThat(uint(id)&&(after===null||uint(after))&&bounded(limit,1,64));const expected=captureExpected(expectedControl);
  return transaction(false,()=>{
   const b=budget(limits.maxReadBytes),c=current(expected,b);requireThat(c);
   const post=projectionRead(c.generation,'posts',id,b);requireThat(post?.invocation);
   requireThat(after===null||BigInt(after)<BigInt(post.order));
   const found=prepare(ROLLING_PUBLIC_QUERY_SQL.predecessor).all(c.generation,'posts',key(post.record.root),post.invocation.pluginId,post.invocation.adapter,key(post.order),after===null?'':key(after),limit+1);
   const rows=found.slice(0,limit).map(row=>{
    requireThat(uint(row.k)&&bounded(row.bytes,0,limits.maxRowBytes));
    const value=projectionRead(c.generation,'posts',row.k,b);requireThat(value?.invocation&&value.invocation.reply===null&&value.record.root===post.record.root&&value.invocation.pluginId===post.invocation.pluginId&&value.invocation.adapter===post.invocation.adapter);
    requireThat(BigInt(value.order)<BigInt(post.order)&&(after===null||BigInt(value.order)>BigInt(after)));
    return {postId:value.id,threadId:value.record.root,order:value.order,requestId:value.invocation.requestId,target:value.invocation.target,pluginId:value.invocation.pluginId,adapter:value.invocation.adapter};
   });
   return {rows,nextAfter:found.length>limit?rows.at(-1).order:null,generation:c.generation,revision:c.revision,trusted:false};
  });
 }
 // A single guarded snapshot returns cache data only. The persistent index
 // alone earns canonical publication and authenticates opaque external cursors.
 function readPublicPage({expectedControl,view,params={},after=null,homeSubboards=[],throughBlock=null,throughHash=null}){
  const expected=captureExpected(expectedControl),input=captureExpected(params),curated=['0',...normalizeHomeSubboards(captureExpected(homeSubboards))];
  const allowed={likes:['posts'],'bok-accounting':[],home:[],feed:[],following:['boards','names'],bookmarks:['ids'],chronological:[],pending:[],board:['id'],directory:['query'],thread:['root'],profile:['nameId'],post:['id']};
  requireThat(typeof view==='string'&&Object.hasOwn(allowed,view));requireThat(Object.keys(input).every(k=>k==='limit'||allowed[view].includes(k)));
  const limit=input.limit??50;requireThat(bounded(limit,1,100));
  requireThat(throughBlock===null?throughHash===null:view==='bok-accounting'&&uint(throughBlock,53)&&(throughHash===null||hash(throughHash)));
  const field=v=>uint(v)&&BigInt(v)<0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
  const selections={};let selectionCount=0;
  if(view==='following'||view==='bookmarks')for(const k of view==='following'?['boards','names']:['ids']){
   const text=input[k]??'';requireThat(typeof text==='string'&&text.length<=7800);const ids=text===''?[]:text.split(',');requireThat(ids.every(id=>field(id)&&(k==='boards'||id!=='0'))&&new Set(ids).size===ids.length);selectionCount+=ids.length;selections[k]=ids;
  }
  requireThat(selectionCount<=100);
  const idKey={board:'id',thread:'root',profile:'nameId',post:'id'}[view];if(idKey)requireThat(field(input[idKey]));
  const likePosts=view==='likes'?normalizeLikePosts(input.posts):null;
  requireThat(after===null||(view==='likes'?typeof after==='string'&&/^[0-9a-f]{128}$/.test(after)&&likePosts.some(id=>key(id)===after.slice(0,64)):field(after)));requireThat(view!=='post'||after===null);
  const query=input.query??'';requireThat(typeof query==='string'&&query.length<=120&&!query.includes('\0'));const q=query.trim().toLowerCase();
  return transaction(false,()=>{
   const b=budget(limits.maxReadBytes),c=current(expected,b);requireThat(c);const g=c.generation;
   requireThat(throughBlock===null||BigInt(throughBlock)<=BigInt(c.checkpoint.number));
   if(throughHash!==null){
    // Authenticate the requested public anchor in the same guarded SQLite
    // snapshot as every accounting row. Reorg rollback removes these blocks.
    const block=readSized('SELECT value FROM blocks WHERE g=? AND n=?',[g,key(throughBlock)],b);
    requireThat(block&&block.number===throughBlock&&block.hash===throughHash);
   }
   const work={candidateRows:0,materializedRows:0,materializedBytes:0,seeks:0};
   const points=new Map();
   const point=(table,id)=>{const k=table+':'+id;if(!points.has(k)){const value=projectionRead(g,table,id,b);points.set(k,value);if(value!==undefined)work.materializedRows++;}return points.get(k);};
   const rows=(name,args,n)=>{requireThat(Object.hasOwn(ROLLING_PUBLIC_QUERY_SQL,name)&&bounded(n,1,257));work.seeks++;
    const found=prepare(ROLLING_PUBLIC_QUERY_SQL[name]).all(g,name==='directory'?'boards':name==='accounting'?'bok':'posts',...args,n);work.candidateRows+=found.length;
    for(const row of found){requireThat(typeof row.k==='string'&&row.k.length<=160&&field(row.k));if(!bounded(row.bytes,0,limits.maxRowBytes))throw capacity();
     if(name==='directory')requireThat(typeof row.slug==='string'&&/^[a-z0-9-]{1,62}$/.test(row.slug));
     else if(name==='accounting')requireThat(typeof row.idnum==='string'&&/^[0-9a-f]{64}$/.test(row.idnum));
     else for(const col of ['ord','likes','stamp','idnum'])requireThat(typeof row[col]==='string'&&/^[0-9a-f]{64}$/.test(row[col]));
    }return found;
   };
   const identity=id=>{const value=point('names',id);requireThat(value);const result=clone(value);if(result.profile.avatar.removal)result.profile.avatar.data=null;return result;};
   const policy=version=>{const p=point('policies',version);requireThat(p);return {version,digest:p.digest,text:p.text};};
   const boardValue=id=>{const board=point('boards',id);if(!board)return null;return {...clone(board),mainVersion:c.scalars.version,mainRules:policy(c.scalars.version).text};};
   const visible=p=>{requireThat(p);const value=clone(p);if(value.removal||point('boards',p.record.subboard)?.rejected)value.text=null;return value;};
   let fixed={};if(view==='board'){
    const board=input.id==='0'?null:boardValue(input.id);requireThat(input.id==='0'||board,'ROLLING_PUBLIC_NOT_FOUND');fixed={boardId:input.id,board};
   }else if(view==='thread')requireThat(point('posts',input.root)?.record.root===input.root);
   else if(view==='profile'){requireThat(point('names',input.nameId),'ROLLING_PUBLIC_NOT_FOUND');fixed={identity:identity(input.nameId)};}
   if(view==='following')fixed.following={
    boards:selections.boards.map(id=>{const board=point('boards',id);return {id,name:id==='0'?'Main board':board?.name??null,slug:board?.slug??null};}),
    names:selections.names.map(id=>{const name=point('names',id);return {id,first:name?.first??null,last:name?.last??null};})};
   const valueFor=posts=>{
    const value={...fixed,posts},names={},boards={};
    for(const p of posts){if(p.record.name_id!=='0'&&!Object.hasOwn(names,p.record.name_id))names[p.record.name_id]=identity(p.record.name_id);
     if(p.record.subboard!=='0'&&!Object.hasOwn(boards,p.record.subboard)){const board=point('boards',p.record.subboard);requireThat(board);boards[board.id]={id:board.id,name:board.name,slug:board.slug};}}
    if(view==='board'){const needed=new Set([c.scalars.version,...posts.map(p=>p.mainVersion),...posts.filter(p=>p.removal).map(p=>String(BigInt(p.removal.policy)&0xffffffffn))]);
     if(fixed.board?.rejection)needed.add(fixed.board.rejection.mainVersion);
     value.policies=[...needed].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0).map(policy);value.mainPolicy=policy(c.scalars.version);
    }return {...value,names,boards};
   };
   // Reserve more than the maximum validated scope/checkpoint/revision/token
   // envelope. Count all materialized row bytes separately, before JSON reads.
   const fits=value=>Buffer.byteLength(JSON.stringify(value))<=1048576-4096;
   let value,nextAfter=null;
   if(view==='likes'){
    value={postIds:likePosts,items:[]};let last=after,more=false;
    for(const post of likePosts){
     const postKey=key(post);if(after!==null&&postKey<after.slice(0,64))continue;
     const lower=after!==null&&postKey===after.slice(0,64)?after.slice(64):'';
     work.seeks++;
     const selected="SELECT CASE WHEN length(k)<=160 THEN k END AS k,CASE WHEN length(idnum)=64 THEN idnum END AS idnum,length(CAST(k AS BLOB))+length(CAST(idnum AS BLOB))+length(CAST(value AS BLOB)) AS bytes FROM projection INDEXED BY projection_active_likes WHERE g=? AND kind='likes' AND value='true' AND board=? AND idnum>? ORDER BY idnum LIMIT ?";
     const args=[g,postKey,lower,limit-value.items.length+1];
     // Charge bounded row bytes before materializing identifiers in JavaScript.
     // Both seeks share the same guarded SQLite read transaction.
     const size=prepare(`SELECT COALESCE(sum(bytes),0) AS bytes FROM (${selected})`).get(...args).bytes;
     if(!bounded(size,0,limits.maxReadBytes)||b.bytes+size>b.max)throw capacity();b.bytes+=size;
     work.seeks++;const found=prepare(selected).all(...args);
     work.candidateRows+=found.length;work.materializedRows+=found.length;
     for(const row of found){
      requireThat(typeof row.idnum==='string'&&/^[0-9a-f]{64}$/.test(row.idnum));const tag=String(BigInt('0x'+row.idnum));
      requireThat(field(tag)&&tag!=='0'&&row.k===post+':'+tag);
      if(value.items.length===limit){more=true;break;}
      value.items.push({post,tag});last=postKey+row.idnum;
     }
     if(more)break;
    }
    if(more)nextAfter=last;
   }else if(view==='bok-accounting'){
    requireThat(capturedScope.bok,'ROLLING_PUBLIC_ACCOUNTING_UNSUPPORTED');value={requests:[]};
    let examined=0,last=after;
    for(const row of rows('accounting',[after===null?'':key(after)],limit+1)){
     if(examined===limit){nextAfter=last;break;}
     let request=point('bok',row.k);requireThat(request&&request.requestId===row.k);
     if(throughBlock!==null&&BigInt(request.position.blockNumber)>BigInt(throughBlock)){
      // The same authenticated history supplies the last checkpointed value;
      // a proposed refund must not overwrite the settled accounting response.
      work.seeks++;
      const event=readSized("SELECT value FROM events INDEXED BY events_accounting WHERE length(CAST(value AS BLOB))<=1048576 AND json_valid(value) AND g=? AND json_extract(value,'$.type')='AccountingChanged' AND json_extract(value,'$.payload.request_id')=? AND pos<=? ORDER BY pos DESC LIMIT 1",[g,row.k,key(throughBlock)+'f'.repeat(128)],b);
      if(!event){examined++;last=row.k;continue;}
      const p=event.payload;requireThat(event.type==='AccountingChanged'&&p.request_id===row.k&&BigInt(event.position.blockNumber)<=BigInt(throughBlock));
      request={requestId:p.request_id,state:p.state,sequence:p.sequence,budget:p.budget,available:p.available,reserved:p.reserved,charged:p.charged,refunded:p.refunded,position:clone(event.position)};
     }
     const candidate={requests:[...value.requests,clone(request)]};
     if(!fits(candidate)){if(!value.requests.length)throw capacity();nextAfter=last;break;}value=candidate;examined++;last=row.k;
    }
   }else if(view==='post'){
    const p=point('posts',input.id),page=valueFor(p?[visible(p)]:[]);const {posts,...metadata}=page;value={post:posts[0]??null,...metadata};if(!fits(value))throw capacity();
   }else if(view==='directory'){
    const prior=after===null?null:point('boards',after);requireThat(after===null||prior,'ROLLING_PUBLIC_CURSOR_STALE');
    const candidates=rows('directory',[prior?.slug??'',after??''],257);let examined=0,last=after;value={boards:[]};
    for(const row of candidates){if(examined===256){nextAfter=last;break;}
     const board=point('boards',row.k);requireThat(board);const matched=[board.slug,board.name,board.description].some(v=>v.toLowerCase().includes(q));
     if(matched){if(value.boards.length===limit){nextAfter=last;break;}
      const candidate={boards:[...value.boards,boardValue(row.k)]};if(!fits(candidate)){if(!value.boards.length)throw capacity();nextAfter=last;break;}value=candidate;}
     examined++;last=row.k;
    }
   }else{
    const prior=after===null?null:point('posts',after);requireThat(after===null||prior,'ROLLING_PUBLIC_CURSOR_STALE');
    const high='f'.repeat(64),low='';let candidates;
    if(view==='following'){
     if(prior)requireThat(selections.boards.includes(prior.record.subboard)||selections.names.includes(prior.record.name_id),'ROLLING_PUBLIC_CURSOR_STALE');
     const bound=prior?key(prior.order):high,found=new Map();
     // Each target uses its existing indexed seek; at most 100*(limit+1)
     // candidate rows, never a global feed scan. Merge duplicates before paging.
     for(const id of selections.boards)for(const row of rows('board',[key(id),bound],limit+1))found.set(row.k,row);
     for(const id of selections.names)for(const row of rows('profile',[key(id),bound],limit+1))found.set(row.k,row);
     candidates=[...found.values()].sort((a,b)=>a.ord>b.ord?-1:a.ord<b.ord?1:0).slice(0,limit+1);
    }else if(view==='bookmarks'){
     if(prior)requireThat(selections.ids.includes(prior.id),'ROLLING_PUBLIC_CURSOR_STALE');
     const bound=prior?BigInt(prior.order):null;
     candidates=selections.ids.map(id=>point('posts',id)).filter(p=>p&&(bound===null||BigInt(p.order)<bound)).sort((a,b)=>BigInt(a.order)>BigInt(b.order)?-1:1).slice(0,limit+1).map(p=>({k:p.id}));
    }else if(view==='home'){
     const order=(a,b)=>a.likes!==b.likes?(a.likes>b.likes?-1:1):a.stamp!==b.stamp?(a.stamp>b.stamp?-1:1):a.idnum<b.idnum?-1:a.idnum>b.idnum?1:0;
     if(prior)requireThat(curated.includes(prior.record.subboard)&&!point('boards',prior.record.subboard)?.rejected,'ROLLING_PUBLIC_CURSOR_STALE');
     const boundary=prior?{likes:key(prior.likes),stamp:key(prior.timestamp),idnum:key(prior.id)}:null;
     const next=(board,p)=>{if(!p)return rows('rankFirst',[key(board)],1)[0]??null;
      return [...rows('rankLikes',[key(board),p.likes],1),...rows('rankStamp',[key(board),p.likes,p.stamp],1),...rows('rankId',[key(board),p.likes,p.stamp,p.idnum],1)].sort(order)[0]??null;};
     const heads=[];for(const board of curated){if(point('boards',board)?.rejected)continue;const row=next(board,boundary);if(row)heads.push({board,row});}
     candidates=[];while(heads.length&&candidates.length<limit+1){heads.sort((a,b)=>order(a.row,b.row));const head=heads.shift();candidates.push(head.row);
      if(candidates.length<limit+1){const row=next(head.board,head.row);if(row)heads.push({board:head.board,row});}}
    }else{
     if(prior&&view==='board')requireThat(prior.record.subboard===input.id,'ROLLING_PUBLIC_CURSOR_STALE');
     if(prior&&view==='profile')requireThat(prior.record.name_id===input.nameId,'ROLLING_PUBLIC_CURSOR_STALE');
     if(prior&&view==='thread')requireThat(prior.record.root===input.root,'ROLLING_PUBLIC_CURSOR_STALE');
     const bound=prior?key(prior.order):['thread','chronological','pending'].includes(view)?low:high;
     const args=['feed','chronological','pending'].includes(view)?[bound]:[key(input[idKey]),bound];candidates=rows(view,args,limit+1);
    }
    const selected=[];value=valueFor(selected);
    for(const row of candidates){if(selected.length===limit){nextAfter=selected.at(-1).id;break;}
     const candidate=visible(point('posts',row.k)),page=valueFor([...selected,candidate]);if(!fits(page)){if(!selected.length)throw capacity();nextAfter=selected.at(-1).id;break;}
     selected.push(candidate);value=page;
    }
   }
   work.materializedBytes=b.bytes;return {value,nextAfter,work,generation:c.generation,revision:c.revision,trusted:false};
  });
 }
 // Storage-facing keyset scans return UNTRUSTED cache data, not HTTP cursors or
 // ready public pages. Production reauthentication must compare all rows,
 // including empty coverage and trailing data. No offset or whole-table count.
 function readPage(kind,{expectedControl,generation=null,after=null,limit=100,maxBytes=limits.maxReadBytes}={}){
  const expected=captureExpected(expectedControl);requireThat(bounded(limit,1,100)&&bounded(maxBytes,1,limits.maxReadBytes)&&(generation===null||uint(generation)&&generation!=='0'));
  const table=kind==='events'?'events':kind==='segments'?'segments':kind==='blocks'?'blocks':null;requireThat(table);
  const col=table==='events'?'pos':table==='segments'?'seq':'n',width=table==='events'?192:64;
  requireThat(after===null||typeof after==='string'&&new RegExp(`^[0-9a-f]{${width}}$`).test(after));
  return transaction(false,()=>{const b=budget(limits.maxReadBytes),c=current(expected,b);requireThat(c);const g=generation??c.generation;requireThat(BigInt(g)<=BigInt(c.generation));const pageBudget=budget(maxBytes);
   const metadata=prepare(`SELECT CASE WHEN length(${col})=${width} THEN ${col} ELSE NULL END AS id,length(CAST(value AS BLOB)) AS bytes FROM ${table} WHERE g=? AND ${col}>? ORDER BY ${col} LIMIT ?`).all(g,after??'',limit+1);
   const rows=[];let last=after,more=false;
   for(const row of metadata){requireThat(typeof row.id==='string'&&new RegExp(`^[0-9a-f]{${width}}$`).test(row.id));if(rows.length===limit){more=true;break;}if(!bounded(row.bytes,0,limits.maxRowBytes))throw capacity();
    if(pageBudget.bytes+row.bytes>maxBytes){if(rows.length===0)throw capacity();more=true;break;}
    const value=readSized(`SELECT value FROM ${table} WHERE g=? AND ${col}=?`,[g,row.id],pageBudget);rows.push({key:row.id,value});last=row.id;
   }
   return {rows,next:more?last:null,bytes:pageBudget.bytes,revision:c.revision,generation:g,trusted:false};
  });
 }
 return Object.freeze({filename,authenticationEpoch,inspect,canResumeOwned,recordOwnedPublication,startGeneration,commitTransaction,completeBlock,rollbackOne,readProjection,readPendingPredecessors,readPublicPage,
  readEventPage:options=>readPage('events',options),readSegmentPage:options=>readPage('segments',options),readBlockPage:options=>readPage('blocks',options),
  close(){requireThat(!active);if(!closed){db.close();closed=true;}}});
}
