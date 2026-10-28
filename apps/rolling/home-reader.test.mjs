import test from 'node:test';
import assert from 'node:assert/strict';
import {createRankedHomeReader} from './home-reader.mjs';

const now=2000000000,hash='0x'+'1'.repeat(64),tx='0x'+'2'.repeat(64);
const post=(id,root=String(id),extra={})=>({id:String(id),timestamp:String(now),likes:'0',record:{root,name_id:'0',subboard:'0'},text:'Public conversation',position:{txHash:tx},...extra});
const envelope=(posts,extra={})=>({schemaVersion:1,complete:true,scope:{boardAddress:'1'},revision:'release:1',checkpoint:{number:10,hash},confirmationCheckpoint:{number:9,hash},posts,names:{},boards:{},nextCursor:null,...extra});

test('Home pages keep one snapshot, deduplicate candidates and never repeat a rendered conversation',async()=>{
 const calls=[],items=Array.from({length:8},(_,i)=>post(i+1));
 const read=createRankedHomeReader({now:()=>now,read:async(route,parameters,signal,options)=>{calls.push({route,parameters,options});return envelope(items);}});
 const first=await read('home',{limit:3},undefined,{revision:'release:1'}),out=[...first.posts];let cursor=first.nextCursor;
 while(cursor){const page=await read('home',{limit:3,cursor},undefined,{revision:first.revision});out.push(...page.posts);cursor=page.nextCursor;}
 assert.equal(calls.length,3);assert(calls.every(call=>call.options.revision==='release:1'));
 assert.deepEqual(new Set(out.map(p=>p.id)),new Set(items.map(p=>p.id)));assert.equal(out.length,8);
 await assert.rejects(read('home',{limit:3,cursor:first.nextCursor},undefined,{revision:first.revision}));
});

for(const change of [{revision:'release:2'},{scope:{boardAddress:'2'}},{checkpoint:{number:11,hash}},{confirmationCheckpoint:{number:8,hash}}])test('Home rejects inconsistent candidate snapshot '+Object.keys(change)[0],async()=>{
 const read=createRankedHomeReader({now:()=>now,read:async(route,parameters)=>envelope([post(1)],parameters.pool==='engaged'?change:{})});
 await assert.rejects(read('home'));
});

test('observation retains every authenticated thread candidate while visible rows remain deduplicated',async()=>{
 const items=[post(1),post(2,'1',{invocation:{requestId:'99',pluginId:'7',reply:'3'}}),post(3,'1',{bot:{requestId:'99',pluginId:'7'}})];
 const read=createRankedHomeReader({now:()=>now,getPriorityTxs:()=>[tx],read:async()=>envelope(items)});
 const page=await read('home');assert.equal(page.posts.length,1);
 assert.deepEqual(new Set(page.observedPosts.map(p=>p.id)),new Set(['1','2','3']));
 assert(page.observedPosts.some(p=>p.invocation?.requestId==='99'));assert(page.observedPosts.some(p=>p.bot?.requestId==='99'));
});

test('duplicate-conversation scans are bounded and empty continuation does not repeat visible rows',async()=>{
 let calls=0;const read=createRankedHomeReader({now:()=>now,read:async(route,parameters)=>{calls++;const offset=Number(parameters.cursor??0);return envelope([post(offset+1,'1')],{nextCursor:String(offset+1)});}});
 const first=await read('home');assert.equal(calls,12);assert.equal(first.posts.length,1);assert(first.nextCursor);
 const second=await read('home',{cursor:first.nextCursor},undefined,{revision:first.revision});
 assert.equal(calls,21);assert.equal(second.posts.length,0);assert(second.nextCursor);assert(second.observedPosts.length>0);
});

test('reading history stays local and follow selection alone reaches the public following route',async()=>{
 const calls=[],preferences={followedBoards:['5'],followedNames:['8'],topics:['private local phrase'],readThreads:{'77':now},seenPosts:{'88':{count:3,lastSeen:now}}};
 const read=createRankedHomeReader({now:()=>now,getPreferences:()=>preferences,read:async(route,parameters)=>{calls.push({route,parameters});return envelope([post(1)]);}});
 await read('home');const selected=calls.find(c=>c.route==='following');assert.deepEqual(selected.parameters,{boards:'5',names:'8',limit:60});
 assert(!JSON.stringify(calls).includes('private local phrase'));assert(!JSON.stringify(calls).includes('readThreads'));assert(!JSON.stringify(calls).includes('seenPosts'));
});

test('Home cursor is invalid after a fresh session and non-Home requests remain unchanged',async()=>{
 const calls=[],baseRead=async(...args)=>{calls.push(args);return envelope([post(1),post(2)]);};
 const read=createRankedHomeReader({now:()=>now,read:baseRead});const old=await read('home',{limit:1});await read('home',{limit:1});
 await assert.rejects(read('home',{limit:1,cursor:old.nextCursor},undefined,{revision:old.revision}));
 const controller=new AbortController(),parameters={id:'9'},options={revision:'r'};await read('board',parameters,controller.signal,options);
 assert.deepEqual(calls.at(-1),['board',parameters,controller.signal,options]);
});
