import test from 'node:test';
import assert from 'node:assert/strict';
import {allowance,safeURL,rankPosts,searchBoards} from './model.mjs';
import {boards,posts,ownNames,profiles} from './fixtures.mjs';
test('992-byte boundary rejects oversized input without truncating',()=>{
 assert.equal(allowance('a'.repeat(992)).valid,true);
 assert.equal(allowance('a'.repeat(993)).valid,false);
 assert.equal(allowance('🙂'.repeat(248)).valid,true);
 assert.equal(allowance('🙂'.repeat(249)).remaining,-4);
 assert.equal(allowance('e\u0301').characters,1);
 assert.equal(allowance('e\u0301').bytes,3);
 assert.equal(allowance('').valid,false);
});
test('posted links only accept http and https',()=>{
 for(const unsafe of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','//example.com','mailto:a@b.com'])assert.equal(safeURL(unsafe),null);
 assert.equal(safeURL('https://example.org/a'),'https://example.org/a');
});
test('Home is deterministic and new subboards do not enter curated Home',()=>{
 const curated=new Set(['commons','building','ideas']);
 const input=[...posts,{id:'new',root:'new',board:'new-board',likes:999,time:999}];
 const a=rankPosts(input,'home',new Set(),new Set(),curated);
 assert(!a.some(p=>p.id==='new'));
 assert.deepEqual(a,rankPosts([...input].reverse(),'home',new Set(),new Set(),curated));
 assert.equal(new Set(a.map(p=>p.id)).size,a.length);
});
test('Following includes only subscribed boards or identities in time order',()=>{
 const a=rankPosts(posts,'following',new Set(['building']),new Set(['Jules Reed']),new Set());
 assert(a.every(p=>p.board==='building'||p.author==='Jules Reed'));
 assert(a.every((p,i)=>!i||a[i-1].time>=p.time));
});
test('directory includes rejected tombstones and searches case insensitively',()=>{
 assert.equal(searchBoards(boards,'  BUILDING  ')[0].id,'building');
 assert.equal(searchBoards(boards,'no-rules')[0].rejected,true);
});
test('every fixture reply has a canonical parent and existing root',()=>{
 for(const p of posts){assert(posts.some(r=>r.id===p.root&&!r.parent));if(p.parent)assert(posts.some(parent=>parent.id===p.parent&&parent.root===p.root));}
});

test('each selectable name has its own public profile with no ownership grouping',()=>{
 for(const name of ownNames){assert(profiles[name], `Missing profile for ${name}`);assert.equal(profiles[name].bot,undefined);assert.deepEqual(Object.keys(profiles[name]).sort(),['bio','color','initials']);}
});
