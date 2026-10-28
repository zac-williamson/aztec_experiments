import {createFeedRanking} from './feed-ranking.mjs';

// Public candidates use bounded index reads. Reading history stays in this tab.
export function createRankedHomeReader({read,getPreferences=()=>({}),getPriorityTxs=()=>[],now=()=>Math.floor(Date.now()/1000)}={}){
 let serial=0,session=null;
 const fail=()=>{throw Error('The Home feed changed. Refresh to continue.');};
 const same=(a,b)=>a.revision===b.revision&&JSON.stringify(a.scope)===JSON.stringify(b.scope)&&a.checkpoint?.number===b.checkpoint?.number&&a.checkpoint?.hash===b.checkpoint?.hash&&a.confirmationCheckpoint?.number===b.confirmationCheckpoint?.number&&a.confirmationCheckpoint?.hash===b.confirmationCheckpoint?.hash;
 async function collect(state,sources,signal){
  const pages=await Promise.all(sources.map(source=>read(source.route,{...source.parameters,...(source.cursor?{cursor:source.cursor}:{})},signal,{revision:state.base.revision})));
  pages.forEach((page,i)=>{if(!same(state.base,page)||!Array.isArray(page.posts))fail();const source=sources[i];if(page.nextCursor&&page.nextCursor===source.cursor)fail();source.cursor=page.nextCursor??null;source.done=!source.cursor;ingest(state,page);});
 }
 function ingest(state,page){
  state.observed.push(...page.posts);
  Object.assign(state.names,page.names??{});Object.assign(state.boards,page.boards??{});
  for(const post of page.posts){if(!state.ids.has(post.id)){state.ids.add(post.id);if(!state.roots.has(post.record?.root))state.queue.push(post);}}
 }
 function rank(state){
  const ranked=createFeedRanking({items:state.queue,now:state.now,seed:state.base.revision,preferences:state.preferences,boards:state.boards,priorityTxs:state.priorityTxs});
  const queue=[];let cursor=null;do{const page=ranked.page({cursor,limit:100});queue.push(...page.items);cursor=page.nextCursor;}while(cursor);state.queue=queue;
 }
 return async function rankedRead(route,parameters={},signal,options={}){
  if(route!=='home')return read(route,parameters,signal,options);
  const limit=parameters.limit??30;if(!Number.isInteger(limit)||limit<1||limit>100)fail();
  let state;
  if(!parameters.cursor){
   const id=++serial,preferences=structuredClone(getPreferences()),priorityTxs=[...getPriorityTxs()];
   const sources=['recent','engaged','explore'].map(pool=>({route:'candidates',parameters:{pool,limit:60},cursor:null,done:false}));
   const base=await read('candidates',sources[0].parameters,signal,options);if(!Array.isArray(base.posts))fail();
   sources[0].cursor=base.nextCursor??null;sources[0].done=!sources[0].cursor;
   state={id,base,sources,preferences,priorityTxs,now:now(),names:{},boards:{},ids:new Set(),roots:new Set(),queue:[],observed:[],page:0};ingest(state,base);
   const boards=(preferences.followedBoards??[]).slice(0,100),names=(preferences.followedNames??[]).filter(x=>x!=='0').slice(0,100-boards.length);
   if(boards.length||names.length)sources.push({route:'following',parameters:{boards:boards.join(','),names:names.join(','),limit:60},cursor:null,done:false});
   await collect(state,sources.slice(1),signal);rank(state);
   if(signal?.aborted||id!==serial)throw new DOMException('Feed request superseded','AbortError');session=state;
  }else{
   state=session;if(!state||parameters.cursor!==`home:${state.id}:${state.page}`||options.revision!==state.base.revision)fail();
  }
  // Bound work even when many candidates belong to one conversation. An empty
  // page may have a cursor; the UI offers an explicit continuation in that case.
  for(let wave=0;state.queue.length<limit&&state.sources.some(s=>!s.done)&&wave<3;wave++){
   await collect(state,state.sources.filter(s=>!s.done),signal);rank(state);
  }
  if(signal?.aborted||state.id!==serial)throw new DOMException('Feed request superseded','AbortError');
  const posts=state.queue.splice(0,limit);posts.forEach(post=>state.roots.add(post.record.root));state.page++;
  return {...state.base,posts,observedPosts:state.observed.splice(0),names:{...state.names},boards:{...state.boards},ranking:'personalised-v1',nextCursor:state.queue.length||state.sources.some(s=>!s.done)?`home:${state.id}:${state.page}`:null};
 };
}
