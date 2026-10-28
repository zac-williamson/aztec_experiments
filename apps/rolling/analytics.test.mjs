import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createAnalytics,classifySource} from './analytics.mjs';

function fixture(overrides={}){
 let time=0,id=0;const events=new Map(),timers=new Map(),sent=[],writes=[];
 const target=()=>({addEventListener(n,f){const a=events.get(n)??[];a.push(f);events.set(n,a);},removeEventListener(n,f){events.set(n,(events.get(n)??[]).filter(x=>x!==f));}});
 const document={...target(),referrer:'https://x.com/private-account/status/123?token=secret',hidden:false};
 const window={...target(),location:new URL('https://rolling.chat/?utm_campaign=launch&wallet=0xPRIVATE#/thread/123'),crypto:webcrypto,matchMedia:()=>({matches:false}),localStorage:{getItem:()=>null,setItem:(...x)=>writes.push(x),removeItem:(...x)=>writes.push(x)},setTimeout:(fn)=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i),setInterval:fn=>{timers.set(++id,fn);return id;},clearInterval:i=>timers.delete(i)};
 const navigator={};const analytics=createAnalytics({window,document,navigator,now:()=>time,transport:x=>sent.push(x),...overrides});
 return {analytics,window,document,navigator,sent,writes,advance(ms){time+=ms;},fire(n,x={}){for(const f of events.get(n)??[])f(x);},sample(){for(const fn of [...timers.values()])fn();},all(){return sent.flatMap(x=>x.events);}};
}
test('collector transmits only fixed categories and counters, without a visit identity',()=>{
 const f=fixture();f.analytics.track('account_open');f.advance(1200);f.analytics.track('account_usable');f.analytics.flush();
 assert.deepEqual(f.all().map(x=>x.name),['visit','account_open','account_usable']);assert.equal(f.all()[2].bucket,'le_5s');
 assert.deepEqual(Object.keys(f.sent[0]),['v','batch','source','campaign','device','events','test']);assert.equal(f.sent[0].source,'x');assert.equal(f.sent[0].campaign,'launch');
 assert(!JSON.stringify(f.sent).includes('PRIVATE'));assert(!JSON.stringify(f.sent).includes('thread'));assert(!JSON.stringify(f.sent).includes('private-account'));assert.equal(f.writes.length,0);f.analytics.dispose();
});
test('repeated callbacks count milestones once and automatic restored accounts are not signup conversions',()=>{
 const f=fixture();assert.equal(f.analytics.track('account_usable'),false);f.analytics.track('account_open');f.analytics.track('account_open');f.analytics.track('account_usable');f.analytics.track('account_usable');f.analytics.track('first_post');f.analytics.track('first_post');f.analytics.flush();assert.equal(f.all().filter(x=>x.name==='first_post').length,1);assert.equal(f.all().filter(x=>x.name==='account_open').length,1);f.analytics.dispose();
});
test('DNT, GPC, automated tests, staging origins, local pages and explicit disable remain silent',()=>{
 for(const options of [{navigator:{doNotTrack:'1'}},{navigator:{globalPrivacyControl:true}},{navigator:{webdriver:true}},{enabled:false},{allowedOrigins:[]}]){const f=fixture(options);f.analytics.track('post_included');f.analytics.flush();assert.equal(f.sent.length,0);f.analytics.dispose();}
});
test('visible reading excludes hidden tabs and stops after idle interval',()=>{
 const f=fixture();f.advance(30000);f.fire('scroll');f.analytics.flush();assert.equal(f.all().find(x=>x.name==='active_seconds').count,30);assert.equal(f.all().filter(x=>x.name==='engaged').length,1);
 f.document.hidden=true;f.fire('visibilitychange');const prior=f.all().filter(x=>x.name==='active_seconds').reduce((n,x)=>n+x.count,0);f.advance(3600000);f.sample();f.analytics.flush();assert.equal(f.all().filter(x=>x.name==='active_seconds').reduce((n,x)=>n+x.count,0),prior);
 f.document.hidden=false;f.fire('visibilitychange');f.advance(120000);f.sample();f.analytics.flush();assert.equal(f.all().filter(x=>x.name==='active_seconds').reduce((n,x)=>n+x.count,0),prior+60);f.analytics.dispose();
});
test('opt-out stores only a boolean, drops pending data and is immediate',()=>{
 const f=fixture();f.analytics.setOptOut(true);f.analytics.flush();f.analytics.track('post_attempt');assert.equal(f.sent.length,0);assert.deepEqual(f.writes,[['rolling.analytics.disabled','1']]);assert.equal(f.analytics.enabled(),false);f.analytics.dispose();
});
test('transport errors never escape into application actions and batches have unrelated IDs',()=>{
 const f=fixture();f.analytics.flush();f.analytics.track('post_attempt');f.analytics.flush();assert.notEqual(f.sent[0].batch,f.sent[1].batch);f.analytics.dispose();
 const bad=fixture({transport:()=>{throw Error('offline');}});assert.doesNotThrow(()=>bad.analytics.flush());assert.doesNotThrow(()=>bad.analytics.track('post_attempt'));bad.analytics.dispose();
});
test('source classification is coarse and does not retain private origins',()=>{
 assert.equal(classifySource('https://reddit.com/r/private/path','https://rolling.chat'),'reddit');assert.equal(classifySource('https://unknown.private.example/user/secret','https://rolling.chat'),'other');assert.equal(classifySource('https://rolling.chat/account','https://rolling.chat'),'direct');
});
