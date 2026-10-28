import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openAnalyticsStore,AnalyticsInputError} from './analytics.mjs';

const event=(name,count=1,bucket='none')=>({name,count,bucket});
const payload=(batch='a'.repeat(32),events=[event('visit')])=>({v:1,batch,source:'x',campaign:'launch',device:'mobile',events,test:false});
test('daily totals, milestone conversion and duration buckets have separate acquisition dimensions',()=>{
 const s=openAnalyticsStore({now:()=>Date.UTC(2026,9,28,18)});
 try{
  s.ingest(payload('a'.repeat(32),[event('visit'),event('account_open'),event('first_post'),event('post_included',2,'le_15s')]));
  s.ingest({...payload('b'.repeat(32)),source:'direct',campaign:'none'});
  const x=s.summary({days:7});assert.equal(x.totals.visit,2);assert.equal(x.totals.post_included,2);assert.equal(x.daily.length,7);assert.equal(x.funnel.find(x=>x.event==='first_post').visitRate,.5);
  assert.equal(x.sources.find(x=>x.source==='x').totals.first_post,1);assert.equal(x.sources[0].campaign,undefined);assert.equal(x.sources[0].device,undefined);
  assert.equal(x.campaigns.find(x=>x.campaign==='launch').totals.first_post,1);assert.equal(x.devices[0].totals.post_included,0);
  assert.equal(x.durations[0].buckets.le_15s,2);
 }finally{s.close();}
});
test('one-use batch deduplication survives retries in memory, then expires without durable IDs',()=>{
 let time=Date.UTC(2026,9,28);const s=openAnalyticsStore({now:()=>time});
 try{assert.equal(s.ingest(payload()).accepted,1);assert.equal(s.ingest(payload()).duplicate,true);assert.equal(s.summary().totals.visit,1);time+=15*60*1000+1;assert.equal(s.ingest(payload()).accepted,1);assert.equal(s.summary().totals.visit,2);}finally{s.close();}
});
test('unknown fields and potentially identifying strings are rejected atomically',()=>{
 const s=openAnalyticsStore();
 try{
  for(const body of [{...payload(),wallet:'0x123'},{...payload(),ip:'127.0.0.1'},{...payload(),source:'https://private.test/a'},{...payload(),campaign:'email@example.com'},payload('x'),payload('a'.repeat(32),[{...event('visit'),url:'/thread/123'}]),payload('a'.repeat(32),[event('visit'),event('wallet-0x123')]),payload('a'.repeat(32),[event('visit',1,'le_1s')]),payload('a'.repeat(32),[event('active_seconds',61)])])assert.throws(()=>s.ingest(body),AnalyticsInputError);
  assert.equal(s.summary().totals.visit,0);
 }finally{s.close();}
});
test('tests and global admission overflow do not pollute aggregates',()=>{
 const s=openAnalyticsStore({maxBatchesPerMinute:1});
 try{assert.equal(s.ingest({...payload(),test:true}).ignored,true);s.ingest(payload());assert.equal(s.ingest(payload('b'.repeat(32))).limited,true);assert.equal(s.summary().totals.visit,1);}finally{s.close();}
});
test('only coarse aggregate rows are persisted; retention removes them without migration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rolling-analytics-'));const file=join(dir,'daily.sqlite');let time=Date.UTC(2026,9,1);
 const s=openAnalyticsStore({filename:file,now:()=>time,retentionDays:7});
 try{s.ingest(payload());time+=8*86400000;s.ingest(payload('b'.repeat(32)));assert.equal(s.summary().totals.visit,1);}finally{s.close();}
 const db=new DatabaseSync(file,{readOnly:true});
 try{const rows=db.prepare('SELECT * FROM analytics_daily').all();assert(rows.every(r=>r.day==='2026-10-09'));assert.deepEqual(Object.keys(rows[0]),['day','event','dimension','value','bucket','n']);assert(!readFileSync(file).includes(Buffer.from('a'.repeat(32))));}finally{db.close();rmSync(dir,{recursive:true});}
});
test('summary rejects invalid and unbounded date ranges',()=>{
 const s=openAnalyticsStore();try{for(const query of [{days:0},{days:10000},{to:'wrong'},{from:'2026-02-30',to:'2026-03-01'},{from:'2020-01-01',to:'2026-10-28'}])assert.throws(()=>s.summary(query),AnalyticsInputError);}finally{s.close();}
});
