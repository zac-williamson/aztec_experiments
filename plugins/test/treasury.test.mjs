import test from 'node:test';import assert from 'node:assert/strict';
import {concat,toBeHex,zeroPadValue,ZeroHash} from 'ethers';
import {CCTP_ROUTES,FORWARD_HOOK,messengerAbi,transmitterAbi,forwardingFee,burnTransaction,verifyBurn,verifyForward,finalizedReceipt} from '../treasury-cctp.mjs';
const route=CCTP_ROUTES.testnet,word=v=>toBeHex(v,32),addr=a=>zeroPadValue(a,32),u32=v=>toBeHex(v,4);
const intent={sender:'0x1111111111111111111111111111111111111111',recipient:'0x2222222222222222222222222222222222222222',amount:'1000000',maxFee:'60000'};
function body({fee=0n,recipient=intent.recipient,amount=1000000n,hook=FORWARD_HOOK}={}){return concat([u32(1),addr(route.sourceToken),addr(recipient),word(amount),addr(intent.sender),word(60000),word(fee),word(0),hook]);}
const outer=b=>concat([u32(1),u32(0),u32(6),ZeroHash,addr(route.messenger),addr(route.messenger),ZeroHash,u32(2000),u32(0),b]);
const log=(abi,event,args,address)=>({address,...abi.encodeEventLog(abi.getEvent(event),args)});
const attested=(b=body({fee:50000n}),nonce=12)=>concat([u32(1),u32(0),u32(6),word(nonce),addr(route.messenger),addr(route.messenger),ZeroHash,u32(2000),u32(2000),b]);
const burn=b=>({status:1,hash:word(11),logs:[log(transmitterAbi,'MessageSent',[outer(b)],route.transmitter)]});
function destination({fee=50000n,recipient=intent.recipient,amount=1000000n,finality=2000n,token=route.destinationToken}={}){
 return {status:1,hash:word(22),logs:[log(messengerAbi,'MintAndWithdraw',[recipient,amount-fee,token,fee],route.messenger),log(transmitterAbi,'MessageReceived',[intent.sender,0,word(12),addr(route.messenger),finality,body({fee,recipient,amount})],route.transmitter)]};
}
test('Circle source intent and destination mint prove exact received USDC and fee',()=>{
 const b=verifyBurn(route,intent,burn(body()));assert.deepEqual(verifyForward(route,b,attested(),destination()),{receivedMicroUSDC:'950000',feeMicroUSDC:'50000',destinationTransaction:word(22)});
 const tx=messengerAbi.parseTransaction(burnTransaction(route,intent));assert.equal(tx.args.destinationDomain,6n);assert.equal(tx.args.destinationCaller,ZeroHash);assert.equal(tx.args.hookData,FORWARD_HOOK);
});
test('source route, recipient, token, amount and forwarding hook are bound to intent',()=>{
 for(const changes of [{recipient:intent.sender},{amount:999999n},{hook:word(0)}])assert.throws(()=>verifyBurn(route,intent,burn(body(changes))),/intent/);
 const r=burn(body());r.logs[0].address=intent.sender;assert.throws(()=>verifyBurn(route,intent,r),/one Circle/);
 assert.throws(()=>verifyBurn(route,intent,{...burn(body()),status:0}),/reverted/);
});
test('unrelated mint, excessive fee, fast finality, revert and ambiguous receipts never complete treasury transfer',()=>{
 for(const changes of [{recipient:intent.sender},{amount:999999n},{fee:60001n},{finality:1000n},{token:route.sourceToken}])assert.throws(()=>verifyForward(route,outer(body()),attested(),destination(changes)),/mismatch/);
 const r=destination();assert.throws(()=>verifyForward(route,outer(body()),attested(),{...r,status:0}),/reverted/);assert.throws(()=>verifyForward(route,outer(body()),attested(),{...r,logs:[...r.logs,...r.logs]}),/Ambiguous/);
});
test('forwarding quote obeys fixed treasury fee ceiling and rejects unknown fee schedules',()=>{
 const rows=[{finalityThreshold:2000,minimumFee:0,forwardFee:{high:55000}}];assert.equal(forwardingFee(rows,60000n,1000000n),55000n);
 assert.throws(()=>forwardingFee(rows,54000n,1000000n),/limit/);assert.throws(()=>forwardingFee(rows,60000n,50000n),/limit/);
 assert.throws(()=>forwardingFee([{...rows[0],minimumFee:1}],60000n,1000000n),/Unsupported/);
});

test('identical transfers cannot substitute a different received nonce',()=>{
 assert.throws(()=>verifyForward(route,outer(body()),attested(body({fee:50000n}),13),destination()),/mismatch/);
});
test('destination receipt must be finalized and canonical',async()=>{
 const receipt={blockNumber:10,blockHash:word(10)};
 assert.equal(await finalizedReceipt({getBlock:async tag=>tag==='finalized'?{number:9}:{hash:word(10)}},receipt),false);
 assert.equal(await finalizedReceipt({getBlock:async tag=>tag==='finalized'?{number:10}:{hash:word(11)}},receipt),false);
 assert.equal(await finalizedReceipt({getBlock:async tag=>tag==='finalized'?{number:10}:{hash:word(10)}},receipt),true);
});
