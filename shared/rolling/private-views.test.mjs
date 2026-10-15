// Synthetic canonical public pages and recovered preferences: selection logic
// only, never encrypted recovery, genuine chain or request-trace acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPrivateViews} from './private-views.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(){
 const preferences={scope:{chainId:'31337',version:'1',board:'8'},head:{initialized:true,schema:1,revision:'6',digest:'23'},bookmarks:['3'],followedBoards:['0'],followedNames:['7'],subscriptions:['1'],replyNotifications:true,readMarkers:[{thread:'1',throughBlock:2,blockHash:'2'}]};
 const post=(id,block,subboard,name,parent,root,text)=>({id,record:{subboard,name_id:name,parent,root},position:{blockNumber:String(block),blockHash:hex(block),txIndexWithinBlock:'0',logIndexWithinTx:'0'},text});
 const page={schemaVersion:1,scope:{chainId:'31337',rollupVersion:'1',boardAddress:hex(8)},complete:true,revision:'canonical-epoch:4',checkpoint:{number:4,hash:hex(4)},nextCursor:'canonical-epoch:4:4',names:{'7':{id:'7',first:'River',last:'Stone'}},boards:{},posts:[post('4',4,'9','7','1','1','latest reply'),post('3',3,'9','0','0','3',null),post('2',2,'0','0','1','1','already read'),post('1',1,'0','0','0','1','root')]};
 return {preferences,page};
}
test('private selection preserves chronological union, anonymous bookmarks, unread reply boundary and public tombstones',()=>{
 const input=fixture(),result=selectPrivateViews(input);
 assert.deepEqual(result.following.posts.map(p=>p.id),['4','2','1']);
 assert.deepEqual(result.bookmarks.posts.map(p=>p.id),['3']);assert.equal(result.bookmarks.posts[0].text,null);
 assert.deepEqual(result.notifications.posts.map(p=>p.id),['4']);
 for(const page of Object.values(result)){assert.equal(page.nextCursor,input.page.nextCursor);assert.deepEqual(page.names,input.page.names);assert.deepEqual(page.scope,input.page.scope);assert(!JSON.stringify(page).includes('followedBoards'));}
 assert(Object.isFrozen(result.notifications.posts[0]));input.page.posts[0].text='changed';assert.equal(result.notifications.posts[0].text,'latest reply');
});
test('empty private page preserves public continuation and never invents exhaustion',()=>{
 const input=fixture();input.preferences.followedBoards=[];input.preferences.followedNames=[];input.preferences.bookmarks=[];input.preferences.subscriptions=[];
 for(const page of Object.values(selectPrivateViews(input))){assert.deepEqual(page.posts,[]);assert.equal(page.nextCursor,input.page.nextCursor);}
 input.page.posts=[];input.page.nextCursor=null;
 for(const page of Object.values(selectPrivateViews(input)))assert.equal(page.nextCursor,null);
});
test('overlapping follows never duplicate a post and global opt-out suppresses reply delivery',()=>{
 const input=fixture();input.preferences.followedBoards=['0','9'];input.preferences.replyNotifications=false;
 const result=selectPrivateViews(input);assert.deepEqual(result.following.posts.map(p=>p.id),['4','3','2','1']);assert.deepEqual(result.notifications.posts,[]);
});
test('new explicit subscription includes historical replies; marker at the same block includes none from that block',()=>{
 const input=fixture();input.preferences.readMarkers=[];assert.deepEqual(selectPrivateViews(input).notifications.posts.map(p=>p.id),['4','2']);
 input.preferences.readMarkers=[{thread:'1',throughBlock:4,blockHash:'4'}];assert.deepEqual(selectPrivateViews(input).notifications.posts,[]);
});
const mutations={
 'wrong chain':x=>x.page.scope.chainId='1','wrong version':x=>x.page.scope.rollupVersion='2','wrong board':x=>x.page.scope.boardAddress=hex(9),
 'incomplete public page':x=>x.page.complete=false,'malformed head':x=>x.preferences.head.digest='0','zero notification thread':x=>x.preferences.subscriptions=['0'],
 'duplicate follows':x=>x.preferences.followedNames=['7','7'],'unsorted follows':x=>x.preferences.followedBoards=['9','0'],
 'duplicate markers':x=>x.preferences.readMarkers.push({...x.preferences.readMarkers[0]}),'invalid marker':x=>x.preferences.readMarkers[0].throughBlock=-1,
 'invalid marker hash':x=>x.preferences.readMarkers[0].blockHash='0','duplicate post':x=>x.page.posts[1].id='4',
 'future public post':x=>x.page.posts[0].position.blockNumber='5','reordered page':x=>x.page.posts.reverse(),
 'duplicate position':x=>x.page.posts[1].position={...x.page.posts[0].position},'malformed parent':x=>x.page.posts[0].record.parent='-1',
 'too many source posts':x=>x.page.posts=Array(101).fill(x.page.posts[0]),'empty cursor':x=>x.page.nextCursor='',
};
for(const [name,mutate]of Object.entries(mutations))test('private view refuses '+name,()=>{const input=fixture();mutate(input);assert.throws(()=>selectPrivateViews(input),{code:'ROLLING_PRIVATE_VIEWS_INVALID'});});
test('read model neither mutates caller data nor leaks malformed values in an error',()=>{
 const input=fixture(),before=structuredClone(input);selectPrivateViews(input);assert.deepEqual(input,before);
 input.preferences.bookmarks=['PRIVATE_SENTINEL'];assert.throws(()=>selectPrivateViews(input),e=>e.code==='ROLLING_PRIVATE_VIEWS_INVALID'&&!String(e).includes('PRIVATE_SENTINEL')&&!e.cause);
});

test('uninitialized preferences and a public snapshot behind a read marker fail closed',()=>{const input=fixture();input.preferences.head={schema:1,initialized:false,revision:'0',digest:'0'};assert.throws(()=>selectPrivateViews(input),{code:'ROLLING_PRIVATE_VIEWS_INVALID'});const other=fixture();other.preferences.readMarkers[0].throughBlock=5;assert.throws(()=>selectPrivateViews(other),{code:'ROLLING_PRIVATE_VIEWS_INVALID'});assert.throws(()=>selectPrivateViews(),{code:'ROLLING_PRIVATE_VIEWS_INVALID'});});
