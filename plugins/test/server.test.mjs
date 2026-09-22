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
