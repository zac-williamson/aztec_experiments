import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedRanking} from './feed-ranking.mjs';
const now=2000000000,tx='0x'+'1'.repeat(64);
const post=(id,{age=0,likes='0',name='0',board='0',root=String(id),text='An open conversation',hash}={})=>({id:String(id),timestamp:String(now-age),likes,record:{name_id:name,subboard:board,root},text,position:{txHash:hash??'0x'+'2'.repeat(64)}});
const rank=(items,preferences={},extra={})=>createFeedRanking({items,now,seed:'fixed',preferences,...extra});
const ids=session=>session.page({limit:100}).items.map(p=>p.id);
test('local follows and text/topic relevance can beat raw likes; stale popularity decays',()=>{
 const items=[post(1,{age:60*86400,likes:'100000000'}),post(2,{board:'8',text:'Proof systems and privacy'}),post(3,{likes:'20'})];
 assert.equal(ids(rank(items,{followedBoards:['8'],topics:['privacy']}))[0],'2');assert.equal(ids(rank(items)).at(-1),'1');
 assert.equal(ids(rank([post(1),post(2,{name:'8'})],{followedNames:['8']}))[0],'2');
});
test('logarithmic engagement has diminishing benefit without fabricated velocity',()=>{
 const items=[post(1,{likes:'1000000000000',age:4*86400}),post(2,{likes:'15'})];assert.equal(ids(rank(items))[0],'2');
});
test('read and repeatedly seen posts tire locally while unread replies revive their conversation',()=>{
 const items=[post(1,{likes:'50',age:100}),post(2),post(3,{root:'1'})];
 const preferences={readThreads:{'1':now-10},seenPosts:{'1':{count:10,lastSeen:now}}};
 const result=ids(rank(items,preferences));assert(result.includes('3'));assert(!result.includes('1'));assert.equal(result.length,2);
 assert.equal(ids(rank([post(1),post(2)],{seenPosts:{'1':{count:10,lastSeen:now}}}))[0],'2');
});
test('discovery gets a place outside follows and public name repetition is reduced',()=>{
 const items=Array.from({length:7},(_,i)=>post(i+1,{board:'8',name:String(i+1)}));items.push(post(90,{age:3600}));
 assert.equal(ids(rank(items,{followedBoards:['8']}))[4],'90');
 const repeated=[post(1,{name:'7',likes:'2'}),post(2,{name:'7',likes:'2'}),post(3,{name:'8'})];
 assert.equal(rank(repeated).page({limit:3}).items[1].record.name_id,'8');
});
test('anonymous posts are independent; conversations dedupe; no ownership inference',()=>{
 const result=ids(rank([post(1,{likes:'3'}),post(2,{likes:'3'}),post(3,{name:'7'}),post(4,{root:'1'})]));
 assert.deepEqual(new Set(result.slice(0,2)),new Set(['1','2']));assert(!result.includes('4'));
});
test('included transaction prioritizes only real matching post and one row per conversation',()=>{
 const items=[post(1,{likes:'999'}),post(2,{age:1000,hash:tx}),post(3,{root:'2'})];
 assert.equal(ids(rank(items,{}, {priorityTxs:[tx]}))[0],'2');assert(!ids(rank(items,{}, {priorityTxs:[tx]})).includes('3'));
 assert.deepEqual(ids(rank(items,{}, {priorityTxs:['0x'+'f'.repeat(64)]})),ids(rank(items)));
});
test('frozen local pages preserve order, metadata and cursors across later preference/time changes',()=>{
 const items=Array.from({length:22},(_,i)=>post(i+1)),preferences={followedBoards:[]};const session=rank(items,preferences);
 const expected=ids(session),pages=[];let cursor=null;do{const page=session.page({cursor,limit:3});pages.push(...page.items.map(p=>p.id));cursor=page.nextCursor;preferences.followedBoards.push('0');items[0].text='changed';}while(cursor);
 assert.deepEqual(pages,expected);assert.equal(new Set(pages).size,22);assert.equal(session.page().items.find(p=>p.id==='1')?.text??session.page({limit:100}).items.find(p=>p.id==='1').text,'An open conversation');
 assert(Object.isFrozen(session.page().items[0]));const first=session.page({limit:1});assert.throws(()=>rank(items,{}, {seed:'other'}).page({cursor:first.nextCursor}));
});
test('duplicate candidates collapse and redactions are excluded; invalid bounds fail',()=>{
 const p=post(1);assert.deepEqual(ids(rank([p,p,{...post(2),text:null},{...post(3),removal:{}}])),['1']);
 assert.throws(()=>rank(Array(3001).fill(p)));assert.throws(()=>rank([p]).page({limit:0}));assert.throws(()=>rank([p]).page({cursor:'foreign:0'}));
});
