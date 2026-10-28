import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readCommunitySummary} from './community.mjs';
const NOW=Date.UTC(2026,9,28,12),seconds=NOW/1000;
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'rolling-community-')),filename=join(dir,'public.sqlite'),db=new DatabaseSync(filename);
 db.exec('CREATE TABLE control(id INTEGER PRIMARY KEY,value TEXT);CREATE TABLE projection(g TEXT,kind TEXT,k TEXT,value TEXT,stamp TEXT);');
 db.prepare('INSERT INTO control VALUES(1,?)').run(JSON.stringify({schema:3,generation:'1'}));
 const add=(id,age,{parent='0',root=id,bot=null,removal=null,board='0'}={})=>{const stamp=seconds-age;db.prepare('INSERT INTO projection VALUES(?,?,?,?,?)').run('1','posts',id,JSON.stringify({record:{root,parent,subboard:board},timestamp:String(stamp),bot,removal,text:'NOT EXPORTED',position:{txHash:'NOT EXPORTED'}}),BigInt(stamp).toString(16).padStart(64,'0'));};
 return {db,filename,add,close(){db.close();rmSync(dir,{recursive:true});}};
}
test('community counts separate human/Bok, mature denominator, late replies and removed content',()=>{
 const f=fixture();try{
  f.add('1',3*86400);f.add('2',3*86400-300,{root:'1',parent:'1'});f.add('3',2*86400);f.add('4',3600,{root:'3',parent:'3'});f.add('5',3600);f.add('6',1800,{root:'5',parent:'5',bot:{requestId:'123'}});f.add('7',4*86400,{removal:{reason:'hidden'}});
  const x=readCommunitySummary({filename:f.filename,now:()=>NOW});assert.equal(x.status,'ok');assert.equal(x.humanPosts,5);assert.equal(x.bokPosts,1);assert.equal(x.humanReplies,2);assert.equal(x.bokReplies,1);assert.equal(x.newThreads,3);assert.equal(x.matureThreads,2);assert.equal(x.repliedWithin24h,1);assert.equal(x.replyWithin24hRate,.5);assert.equal(x.firstHumanReplySeconds.le_5m,1);assert.equal(x.firstHumanReplySeconds.gt_24h,1);assert(!JSON.stringify(x).includes('NOT EXPORTED'));assert(!Object.hasOwn(x,'posts'));
 }finally{f.close();}
});
test('closed boards and prior generations are excluded; count bounds fail honestly',()=>{
 const f=fixture();try{
  f.add('1',3*86400,{board:'8'});f.db.prepare('INSERT INTO projection VALUES(?,?,?,?,?)').run('1','boards','8',JSON.stringify({rejected:true}),null);f.add('2',1000);f.add('3',2000);f.db.prepare('INSERT INTO projection VALUES(?,?,?,?,?)').run('0','posts','4','{}','f'.repeat(64));
  assert.equal(readCommunitySummary({filename:f.filename,now:()=>NOW}).humanPosts,2);assert.equal(readCommunitySummary({filename:f.filename,now:()=>NOW,maxPosts:1}).reason,'window-too-large');
 }finally{f.close();}
});
test('missing index returns unknown and never creates a database',()=>{
 assert.deepEqual(readCommunitySummary({filename:'/definitely/not/a/rolling-index'}),{schemaVersion:1,status:'unavailable',reason:'public-index-unavailable'});
});
