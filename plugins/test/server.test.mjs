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
 let state=1;const server=await startEscrowService({descriptor:{scope:{receiver:'r'}},escrow:{count:async()=>1,at:async()=>'p',invocation:async()=>({state}),start:async()=>{state=2;}},board:{readRequest:async()=>({receiver:'r',finalized:true,enabled:true,text:'hello'})},run:async()=>{throw Error('private provider response');},port:0,pollMs:5,onError:()=>{}});
 try{await new Promise(r=>setTimeout(r,30));const health=await(await fetch('http://127.0.0.1:'+server.address.port+'/health')).json();assert.equal(health.status,'degraded');assert(!JSON.stringify(health).includes('private provider'));}finally{await server.close();}
});
