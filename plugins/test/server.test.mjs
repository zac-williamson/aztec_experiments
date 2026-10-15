import test from 'node:test';import assert from 'node:assert/strict';
import {startEscrowService} from '../escrow-service.mjs';
test('on-chain invocation must be finalized before starting; restart skips claimed work',async()=>{
 let state=1,finalized=false,runs=0,starts=0;
 const escrow={count:async()=>1,at:async()=>'post',invocation:async()=>({state}),start:async()=>{starts++;state=2;}};
 const args={descriptor:{scope:{receiver:'receiver'}},escrow,board:{readRequest:async()=>({receiver:'receiver',enabled:true,finalized,text:'hello'})},run:async()=>runs++,port:0,pollMs:5,onError:e=>{throw e;}};
 let server=await startEscrowService(args);
 try{await new Promise(r=>setTimeout(r,30));assert.equal(starts,0);finalized=true;await new Promise(r=>setTimeout(r,50));assert.equal(starts,1);assert.equal(runs,1);}finally{await server.close();}
 server=await startEscrowService(args);try{await new Promise(r=>setTimeout(r,30));assert.equal(runs,1);}finally{await server.close();}
});

test('health reports a failed job without exposing its private error detail',async()=>{
 let state=1,polls=0;const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},escrow:{count:async()=>{polls++;return 1;},at:async()=>'p',invocation:async()=>({state}),start:async()=>{state=2;}},board:{readRequest:async()=>({receiver:'r',finalized:true,enabled:true,text:'hello'})},run:async()=>{throw Error('private provider response');},port:0,pollMs:5,onError:()=>{}});
 try{await new Promise(r=>setTimeout(r,30));const health=await(await fetch('http://127.0.0.1:'+server.address.port+'/health')).json();assert.equal(health.status,'degraded');assert(polls>=2);assert(!JSON.stringify(health).includes('private provider'));}finally{await server.close();}
});

const until=async predicate=>{const end=Date.now()+1500;while(!predicate()){if(Date.now()>end)throw Error('Condition timed out');await new Promise(r=>setTimeout(r,5));}};
test('independent users run concurrently, while a new deposit can fund overlapping work for the same account',async()=>{
 const states=[1,1,1],reserves=[0n,0n,0n],accounts=['a','a','b'],started=[],release=new Map();let available=0n;
 const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},port:0,pollMs:5,concurrency:3,onError:()=>{},escrow:{count:async()=>3,at:async i=>String(i),invocation:async p=>({state:states[+p],account:accounts[+p],reserved:reserves[+p]}),available:async()=>available,start:async p=>{states[+p]=2;reserves[+p]=100n;}},board:{readRequest:async()=>({receiver:'r',enabled:true,finalized:true,text:'hello'})},run:async p=>{started.push(p);await new Promise(r=>release.set(p,r));states[+p]=3;}});
 try{await until(()=>started.length===2);assert.deepEqual(started,['0','2']);available=100n;await until(()=>started.length===3);assert.deepEqual(started,['0','2','1']);}finally{for(const r of release.values())r();await server.close();}
});
test('transient start failure is reconsidered, but started executions never replay',async()=>{
 let state=1,attempts=0,runs=0;
 const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},port:0,pollMs:5,onError:()=>{},escrow:{count:async()=>1,at:async()=> 'p',invocation:async()=>({state,account:'a'}),start:async()=>{if(++attempts===1)throw Error('RPC down');state=2;}},board:{readRequest:async()=>({receiver:'r',enabled:true,finalized:true,text:'hello'})},run:async()=>{runs++;throw Error('uncertain provider');}});
 try{await until(()=>runs===1);await new Promise(r=>setTimeout(r,30));assert.equal(attempts,2);assert.equal(runs,1);}finally{await server.close();}
});
test('transient reads cannot lose a previously deferred invocation',async()=>{
 let state=1,reads=0,runs=0;
 const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},port:0,pollMs:5,onError:()=>{},escrow:{count:async()=>1,at:async()=> 'p',invocation:async()=>({state,account:'a'}),start:async()=>{state=2;}},board:{readRequest:async()=>{if(++reads===2)throw Error('RPC down');return {receiver:'r',enabled:true,finalized:reads>2,text:'hello'};}},run:async()=>runs++});
 try{await until(()=>runs===1);assert.equal(reads,3);}finally{await server.close();}
});
test('concurrency stays bounded and shutdown drains active work without starting queued work',async()=>{
 const states=[1,1,1],started=[],release=[];
 const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},port:0,pollMs:5,concurrency:2,onError:()=>{},escrow:{count:async()=>3,at:async i=>String(i),invocation:async p=>({state:states[+p],account:p}),start:async p=>{states[+p]=2;}},board:{readRequest:async()=>({receiver:'r',enabled:true,finalized:true,text:'hello'})},run:async p=>{started.push(p);await new Promise(r=>release.push(r));states[+p]=3;}});
 await until(()=>started.length===2);let closed=false;const closing=server.close().then(()=>{closed=true;});
 try{await new Promise(r=>setTimeout(r,20));assert.equal(closed,false);assert.equal(started.length,2);release[0]();await new Promise(r=>setTimeout(r,20));assert.equal(closed,false);assert.equal(started.length,2);}finally{for(const r of release)r();await closing;}
 assert.equal(closed,true);assert.equal(states[2],1);
});


test('health clears a recovered polling failure without waiting for a new job',async()=>{
 let offline=true,failures=0,successfulPolls=0;
 const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},port:0,pollMs:5,onError:()=>failures++,escrow:{count:async()=>{if(offline)throw Error('temporary RPC failure');successfulPolls++;return 0;}},board:{},run:async()=>{throw Error('No job should run');}});
 const health=async()=>(await fetch('http://127.0.0.1:'+server.address.port+'/health')).json();
 try{await until(()=>failures>0);assert.equal((await health()).status,'degraded');offline=false;await until(()=>successfulPolls>0);const recovered=await health();assert.equal(recovered.status,'ready');assert.equal(recovered.lastFailure,null);assert.equal(recovered.lastSuccess,null);}finally{await server.close();}
});

// Controlled board-port fixtures mirror the production indexed predecessor
// admission. Actual SQLite ordering and rollback are tested in public-sqlite.
const canonicalRequest=(rows,done,postId)=>{
 const row=rows.find(r=>r.postId===postId);assert(row);
 return {predecessorsClear:!done.has(row.requestId)&&!rows.some(r=>r.threadId===row.threadId&&!done.has(r.requestId)&&BigInt(r.order)<BigInt(row.order))};
};
test('Rolling threads overlap while same-thread requests remain ordered and shutdown drains',async()=>{
 const requests=[{requestId:'a1',postId:'1',threadId:'a',order:'1'},{requestId:'a2',postId:'2',threadId:'a',order:'2'},{requestId:'b1',postId:'3',threadId:'b',order:'4'}];
 const started=[],done=new Set(),release=new Map();
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest(requests,done,id),pending:async()=>({requests:requests.filter(r=>!done.has(r.requestId)),nextCursor:null})},run:async r=>{started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);}});
 try{await until(()=>started.length===2);assert.deepEqual(started,['a1','b1']);release.get('a1')();await until(()=>started.length===3);assert.deepEqual(started,['a1','b1','a2']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling deferred thread does not prevent discovering a later independent thread',async()=>{
 const a1={requestId:'a1',postId:'1',threadId:'a',order:'1'},a2={requestId:'a2',postId:'2',threadId:'a',order:'2'},b={requestId:'b1',postId:'3',threadId:'b',order:'4'};
 const started=[],done=new Set(),release=new Map();let calls=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest([a1,a2,b],done,id),pending:async()=>({requests:(++calls===1?[a1,a2]:[a1,a2,b]).filter(r=>!done.has(r.requestId)),nextCursor:null})},run:async r=>{started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);}});
 try{await until(()=>started.includes('b1'));assert.deepEqual(started,['a1','b1']);release.get('a1')();await until(()=>started.includes('a2'));assert.deepEqual(started,['a1','b1','a2']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling scans past active duplicates and retains same-thread order across pages',async()=>{
 let order=0;const row=(id,threadId)=>({requestId:id,postId:id,threadId,order:String(++order)});
 const a1=row('a1','a'),a2=row('a2','a'),a3=row('a3','a'),b=row('b1','b');
 const started=[],done=new Set(),release=new Map();let scans=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest([a1,a2,a3,b],done,id),pending:async cursor=>{scans++;return {requests:(cursor===null?[a1,a2]:[a3,b]).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'next':null};}},recoverPending:async()=>done.has('a1')?[]:[a1],run:async r=>{started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);}});
 try{await until(()=>started.includes('b1'));assert(scans>=2);assert.deepEqual(started,['a1','b1']);release.get('a1')();await until(()=>started.includes('a2'));assert.deepEqual(started,['a1','b1','a2']);release.get('a2')();await until(()=>started.includes('a3'));assert.deepEqual(started,['a1','b1','a2','a3']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling canonical admission rejects a compacted later thread row until its predecessor completes',async()=>{
 const a=Array.from({length:4},(_,i)=>({requestId:'a'+(i+1),postId:String(i),threadId:'a',order:String(i+1)})),b={requestId:'b',postId:'b',threadId:'b',order:'5'};
 const started=[],done=new Set(),release=new Map();let scans=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest([...a,b],done,id),pending:async cursor=>{scans++;return {requests:(cursor===null?a.slice(0,3):[a[3],b]).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'next':null};}},run:async r=>{started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);}});
 try{await until(()=>started.includes('b'));assert(scans>=2);assert.deepEqual(started,['a1','b']);for(const [previous,next] of [['a1','a2'],['a2','a3'],['a3','a4']]){release.get(previous)();await until(()=>started.includes(next));assert.equal(started.at(-1),next);}assert.deepEqual(started,['a1','b','a2','a3','a4']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling completion during a pending read cannot admit the stale later thread row',async()=>{
 const a1={requestId:'a1',postId:'1',threadId:'a',order:'1'},a2={requestId:'a2',postId:'2',threadId:'a',order:'2'},a3={requestId:'a3',postId:'3',threadId:'a',order:'3'};
 const started=[],done=new Set(),release=new Map(),cursors=[];let unblock,reading=false;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest([a1,a2,a3],done,id),pending:async cursor=>{cursors.push(cursor);if(cursors.length===2){reading=true;await new Promise(resolve=>{unblock=resolve;});return{requests:[a3],nextCursor:'stale'};}return{requests:[a1,a2,a3].filter(r=>!done.has(r.requestId)),nextCursor:'later'};}},run:async r=>{started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);}});
 try{await until(()=>reading);release.get('a1')();await until(()=>done.has('a1'));unblock();await until(()=>started.includes('a2'));assert.deepEqual(started,['a1','a2']);assert(cursors.includes('stale'),'bounded cyclic scan continues without a global rewind');}
 finally{unblock?.();for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling fenced first-page requests do not starve later independent threads',async()=>{
 let order=0;const row=(id,threadId)=>({requestId:id,postId:id,threadId,order:String(++order)});
 const old=[row('fenced-a','a'),row('fenced-b','b')],fresh=[row('c','c'),row('d','d')];
 const started=[],release=new Map(),done=new Set();let failures=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:()=>failures++,board:{readRequest:async id=>canonicalRequest([...old,...fresh],done,id),pending:async cursor=>({requests:(cursor===null?old:fresh).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'fresh':null})},run:async r=>{
  if(r.requestId.startsWith('fenced-'))throw Error('Original durable request requires reconciliation');
  started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);
 }});
 try{await until(()=>started.length===2);assert(failures>=2);assert.deepEqual(started,['c','d']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling fulfilled unreplied no-ops cannot rewind discovery ahead of independent work',async()=>{
 const rows=['a','b','c','d'].map((id,i)=>({requestId:id,postId:id,threadId:id,order:String(i+1)}));
 const done=new Set(),started=[],release=new Map();
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:e=>assert.fail(e),board:{readRequest:async id=>canonicalRequest(rows,done,id),pending:async cursor=>({requests:(cursor===null?rows.slice(0,2):rows.slice(2)).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'later':null})},run:async r=>{
  if(['a','b'].includes(r.requestId))return {status:'accounted-without-reply',replayed:false};
  started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);
 }});
 try{await until(()=>started.length===2);assert.deepEqual(started,['c','d']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling repeated recovery failures and more than64 fenced threads cannot starve a later page',async()=>{
 const old=Array.from({length:70},(_,i)=>({requestId:'old'+i,postId:'old'+i,threadId:'old'+i,order:String(i)}));
 const fresh=['c','d'].map((id,i)=>({requestId:id,postId:id,threadId:id,order:String(70+i)})),rows=[...old,...fresh];
 const done=new Set(),started=[],release=new Map(),cursors=[];
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:()=>{},recoverPending:async()=>old.slice(0,16),board:{readRequest:async id=>canonicalRequest(rows,done,id),pending:async cursor=>{cursors.push(cursor);return {requests:(cursor===null?rows.slice(0,64):rows.slice(64)).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'later':null};}},run:async r=>{
  if(r.requestId.startsWith('old'))throw Error('Reconcile existing operation');
  started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);
 }});
 try{await until(()=>started.length===2);assert(cursors.includes('later'));assert.deepEqual(started,['c','d']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling recovery hints cannot overtake an unresolved predecessor outside the retained page',async()=>{
 const unrelated=Array.from({length:64},(_,i)=>({requestId:'old'+i,postId:'old'+i,threadId:'old'+i,order:String(i)}));
 const a1={requestId:'a1',postId:'a1',threadId:'a',order:'64'},a2={requestId:'a2',postId:'a2',threadId:'a',order:'65'},c={requestId:'c',postId:'c',threadId:'c',order:'66'};
 const rows=[...unrelated,a1,a2,c],done=new Set(),started=[],release=new Map();let rejectedHints=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,concurrency:2,onError:()=>{},recoverPending:async()=>done.has('a2')?[]:[a2],board:{readRequest:async id=>{const result=canonicalRequest(rows,done,id);if(id==='a2'&&!result.predecessorsClear)rejectedHints++;return result;},pending:async cursor=>({requests:(cursor===null?unrelated:[a1,c]).filter(r=>!done.has(r.requestId)),nextCursor:cursor===null?'later':null})},run:async r=>{
  if(r.requestId.startsWith('old')||r.requestId==='a1')throw Error('Original operation fenced');
  started.push(r.requestId);await new Promise(resolve=>release.set(r.requestId,resolve));done.add(r.requestId);
 }});
 try{await until(()=>started.includes('c'));assert(rejectedHints>0);assert.deepEqual(started,['c']);done.add('a1');await until(()=>started.includes('a2'));assert.deepEqual(started,['c','a2']);}
 finally{for(const resolve of release.values())resolve();await server.close();}
});

test('Rolling shutdown during canonical admission cannot launch a new job',async()=>{
 const row={requestId:'a',postId:'a',threadId:'a',order:'1'};let admit,reading=false,runs=0;
 const server=await startEscrowService({profile:'rolling',descriptor:{},port:0,pollMs:5,onError:e=>assert.fail(e),board:{pending:async()=>({requests:[row],nextCursor:null}),readRequest:async()=>{reading=true;await new Promise(resolve=>{admit=resolve;});return {predecessorsClear:true};}},run:async()=>{runs++;}});
 await until(()=>reading);const closed=server.close();admit();await closed;assert.equal(runs,0);
});
