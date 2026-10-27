import test from 'node:test';
import assert from 'node:assert/strict';
import {allowance,safeURL,rankPosts,searchBoards,createInlineAction,createInlineActionRegistry,threadTree,threadFolds} from './model.mjs';
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
test('overflow counts whole visible characters beyond the fitting prefix',()=>{
 for(const [text,count] of [['a'.repeat(1000),8],['🙂'.repeat(249),1],['a'.repeat(991)+'🙂',1],['a'.repeat(991)+'e\u0301x',2],['a'.repeat(992)+'👨‍👩‍👧‍👦',1],['a'.repeat(992),0],['',0]]){
  const result=allowance(text);assert.equal(result.overCharacters,count);
  const chars=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.segment);
  assert(new TextEncoder().encode(chars.slice(0,chars.length-count).join('')).length<=992);
  if(count)assert(new TextEncoder().encode(chars.slice(0,chars.length-count+1).join('')).length>992);
 }
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
test('thread tree nests replies under their parent in chain order and keeps orphans at root level',()=>{
 const record=(id,parent)=>({id,record:{root:'1',parent}});
 const tree=threadTree([record('1','0'),record('2','1'),record('3','2'),record('4','1'),record('5','9'),record('6','7'),record('7','6')],'1');
 assert.deepEqual(tree.root.children.map(n=>n.id),['2','4','5','6']);assert.equal(tree.nodes.get('7').parent.id,'6');
 assert.equal(tree.nodes.get('3').depth,2);assert.equal(tree.nodes.get('2').descendants,1);assert.equal(tree.root.descendants,6);
 assert.equal(tree.nodes.get('5').orphan,true);assert.equal(tree.nodes.get('4').orphan,false);
 assert.equal(tree.nodes.get('6').orphan,true,'a parent that only appears later cannot be linked');
 const preview=threadTree([{id:'a',parent:null},{id:'b',parent:'a'}],'a',p=>p.parent);assert.equal(preview.nodes.get('b').depth,1);
 const virtual=threadTree([record('2','1')],'1');assert.equal(virtual.root.virtual,true);assert.equal(virtual.nodes.get('2').depth,1);
 const foreign=threadTree([record('1','0'),record('2','1'),record('3','2')],'9');
 assert(['1','2','3'].every(id=>foreign.nodes.get(id).depth===1&&foreign.nodes.get(id).orphan),'posts of another conversation stay flat');
});
test('fold policy keeps direct and liked replies open, folds quiet, deep, busy and removed branches, and defers to the reader',()=>{
 const chain=[['1','0'],['2','1'],['3','2'],['4','3'],['5','3'],['6','4'],['7','6'],['8','7'],['9','1'],...Array.from({length:7},(_,i)=>[String(10+i),'9']),['17','1'],['18','17']];
 const posts=chain.map(([id,parent])=>({id,record:{root:'1',parent},likes:id==='4'?'2':'0',text:id==='17'?null:'t'}));
 const tree=threadTree(posts,'1'),signals=p=>({likes:Number(p.likes),bot:p.id==='8',removed:p.text===null,pending:p.id==='99'});
 const state={collapsed:new Set(),expanded:new Set()};
 let {folds,groups}=threadFolds(tree,signals,state);
 assert.equal(folds.get('2').collapsed,false,'direct reply open');assert.equal(folds.get('3').collapsed,false,'only reply stays open');
 assert.equal(folds.get('4').collapsed,false,'liked deep reply open');assert.equal(folds.get('5').collapsed,true,'quiet deep sibling folds');
 assert.equal(folds.get('6').collapsed,false,'bot further down keeps the branch open');
 assert.equal(folds.get('7').hidden,'deep');assert.equal(folds.get('8').hidden,null,'only the boundary row is hidden; its subtree hides with it');
 assert.deepEqual(groups.get('6'),{kind:'deep',hidden:['7'],count:2});
 assert.deepEqual(groups.get('9').hidden,['15','16']);assert.equal(groups.get('9').kind,'more');
 assert.equal(folds.get('17').collapsed,true,'removed reply folds');assert.equal(folds.get('18').collapsed,false);
 state.expanded.add('more:9');state.expanded.add('5');state.collapsed.add('2');
 ({folds,groups}=threadFolds(tree,signals,state));
 assert.equal(groups.has('9'),false);assert.equal(folds.get('5').collapsed,false);assert.equal(folds.get('2').collapsed,true);
 const pending=threadFolds(threadTree([...posts,{id:'99',record:{root:'1',parent:'8'},likes:'0',text:'mine'}],'1'),signals,{collapsed:new Set(),expanded:new Set()});
 assert.equal(pending.folds.get('7').hidden,null,'a pending reply opens the fold on its path');assert.equal(pending.folds.get('5').collapsed,true);
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

test('inline reader action captures the clicked target and shares repeated clicks until completion',async()=>{
 const gate=Promise.withResolvers(),states=[],sent=[];let post='10';
 const run=createInlineAction({action:()=>({type:'like',post}),perform:async action=>{sent.push(action);await gate.promise;return {status:'confirmed'};},onState:state=>states.push(state)});
 const first=run();assert.deepEqual(states,['pending']);post='20';assert.equal(run(),first);
 await Promise.resolve();assert.deepEqual(sent,[{type:'like',post:'10'}]);assert(Object.isFrozen(sent[0]));
 gate.resolve();assert.equal((await first).status,'confirmed');assert.deepEqual(states,['pending','confirmed']);assert.equal(sent.length,1);
});
test('an uncertain reader action cannot be submitted again by its control',async()=>{
 for(const perform of [async()=>({status:'unknown'}),async()=>{throw Error('private provider details');},async()=>({status:'unexpected'})]){
  let calls=0;const states=[],run=createInlineAction({action:()=>({type:'preference',kind:1,target:'7',enabled:true}),perform:async action=>{calls++;return perform(action);},onState:(state,action,result)=>states.push({state,result})});
  assert.equal((await run()).status,'unknown');assert.equal((await run()).status,'unknown');assert.equal(calls,1);
  assert.deepEqual(states.map(s=>s.state),['pending','unknown']);assert(!JSON.stringify(states).includes('private provider details'));
 }
});
test('setup or a definite failure requires a new explicit click, with current preference selection',async()=>{
 for(const status of ['blocked','failed','reverted','cancelled']){
  const sent=[];let enabled=true;
  const run=createInlineAction({action:()=>({type:'preference',kind:1,target:'7',enabled}),perform:async action=>{sent.push(action);return {status};},onState:()=>{}});
  await run();assert.equal(sent.length,1);enabled=false;await run();assert.deepEqual(sent.map(a=>a.enabled),[true,false]);
 }
});

test('included inline progress is nonterminal, deduplicated and cannot revive a settled action',async()=>{
 const held=Promise.withResolvers(),states=[];let progress,calls=0;
 const run=createInlineAction({action:()=>({type:'like',post:'7'}),perform:async(action,onIncluded)=>{calls++;progress=onIncluded;await held.promise;return {status:'confirmed'};},onState:state=>states.push(state)});
 const pending=run();await Promise.resolve();progress();progress();assert.deepEqual(states,['pending','included']);assert.equal(run(),pending);assert.equal(calls,1);
 held.resolve();await pending;progress();assert.deepEqual(states,['pending','included','confirmed']);
});

test('in-flight reader action survives replacement controls and shares the captured target until actual completion',async()=>{
 const held=Promise.withResolvers();let included,calls=0,enabled=true;const seen=[];
 const registry=createInlineActionRegistry({perform:async(action,onIncluded)=>{calls++;included=onIncluded;assert.equal(action.enabled,true);await held.promise;return {status:'included'};},onState:(key,value)=>seen.push([key,value.state])});
 const action=()=>({type:'preference',kind:1,target:'7',enabled});const pending=registry.run('bookmark:7',action);await Promise.resolve();
 assert.equal(registry.snapshot('bookmark:7').state,'pending');enabled=false;
 assert.equal(registry.run('bookmark:7',action),pending,'replacement control cannot send an inverse');assert.equal(calls,1);
 included();assert.equal(registry.snapshot('bookmark:7').state,'included');assert.equal(registry.snapshot('bookmark:7').result,undefined,'inclusion progress is still busy');
 held.resolve();assert.equal((await pending).status,'included');assert.equal(registry.snapshot('bookmark:7'),null);assert.deepEqual(seen.map(x=>x[1]),['pending','included','included']);
});
for(const status of ['unknown','reverted','failed','blocked'])test('reader registry retains exact terminal '+status+' and releases only after settled',async()=>{
 const gate=Promise.withResolvers(),states=[];const registry=createInlineActionRegistry({perform:()=>gate.promise,onState:(_key,value)=>states.push(value)});
 const pending=registry.run('like:1',()=>({type:'like',post:'1'}));assert.equal(registry.snapshot('like:2'),null);gate.resolve({status});assert.equal((await pending).status,status);assert.equal(states.at(-1).state,status);assert.equal(registry.snapshot('like:1'),null);
});

import {savedPreferenceControl} from './model.mjs';
test('unknown private choices retain concise labels and never supply an inverse action',()=>{
 for(const value of [null,undefined,0,'true']){const state=savedPreferenceControl('Bookmark',value,'recovering',true);assert.equal(state.disabled,true);assert.equal(state.busy,true);assert.equal(state.enabled,undefined);assert.equal(state.label,'Bookmark');}
 for(const status of ['locked','recovering'])assert.deepEqual(savedPreferenceControl('Follow board',null,status,false),{label:'Follow board',disabled:false,busy:false,enabled:undefined});
 assert.deepEqual(savedPreferenceControl('Bookmark',true,'complete'),{label:'Unbookmark',disabled:false,busy:false,enabled:false});assert.deepEqual(savedPreferenceControl('Follow board',false,'complete'),{label:'Follow board',disabled:false,busy:false,enabled:true});
 assert.equal(savedPreferenceControl('Bookmark',null,'locked',true).disabled,false,'signed out control opens sign in even during an obsolete load');
});

import {savedReaderSelection,savedReaderRoute} from './model.mjs';
test('saved reader captures exact bounded selections and cached follow labels without RPC',()=>{
 const source={bookmarks:['10','20'],followedBoards:['0','8'],followedNames:['7'],labels:{boards:{8:'Builders'},names:{7:'River Lane'}}};
 const selected=savedReaderSelection('following',source);source.followedNames.push('9');source.labels.names[7]='Changed';
 assert.deepEqual(selected.parameters,{boards:'0,8',names:'7',limit:30});assert.deepEqual(selected.following.map(v=>v.label),['Main board','Builders','River Lane']);
 assert.deepEqual(savedReaderSelection('bookmarks',source).parameters,{ids:'10,20',limit:30});
 const hundred=Array.from({length:100},(_,i)=>String(i+1));assert.equal(savedReaderSelection('bookmarks',{...source,bookmarks:hundred}).bookmarks.length,100);
 assert.equal(savedReaderRoute('/notifications'),'/home');assert.equal(savedReaderRoute('/following'),'/following');
 for(const bad of [{...source,bookmarks:['1','1']},{...source,followedNames:Array.from({length:100},(_,i)=>String(i+1))},{...source,bookmarks:['01']}])assert.throws(()=>savedReaderSelection('following',bad));
});
