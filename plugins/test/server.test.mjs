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
