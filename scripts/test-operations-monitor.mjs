import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {observeEscrow,readEscrowSnapshot} from '../deploy/operations-monitor.mjs';
import {expectedPortalRuntime,PORTAL_IMMUTABLES} from '../shared/portal-runtime.mjs';
import {readFile} from 'node:fs/promises';
const address=n=>'0x'+n.toString(16).padStart(40,'0');
const config={schemaVersion:1,network:{nodeUrl:'http://localhost:8080',ethRpcUrl:'http://localhost:8545',chainId:'31337',rollupVersion:'1',rollupAddress:address(1)},board:{portalAddress:address(2),contractAddress:'0x'+'3'.padStart(64,'0')}};
const snapshot={blockNumber:4n,timestamp:1000n,liabilities:100n,balance:100n,active:true};
const run=(overrides={},options={})=>observeEscrow({config,now:()=>1000000,read:async()=>({...snapshot,...overrides}),...options});
test('balanced, deficit and forced-ETH surplus have distinct actionable outputs',async()=>{
  for(const [balance,code,severity] of [[100n,'ESCROW_BALANCED','ok'],[99n,'ESCROW_DEFICIT','critical'],[101n,'ESCROW_SURPLUS','warning']]){
    const r=await run({balance});assert.equal(r.code,code);assert.equal(r.severity,severity);assert.ok(r.action.length>20);assert.equal(r.differenceWei,(balance-100n).toString());
  }
});
test('unavailable and hung RPC are bounded and never expose exception contents',async()=>{
  const secret='secret-credential-private-witness';
  const failed=await run({}, {read:async()=>{throw Error(secret);}});assert.equal(failed.code,'OBSERVATION_UNAVAILABLE');assert.ok(!JSON.stringify(failed).includes(secret));
  const started=Date.now();const hung=await run({}, {timeoutMs:20,read:()=>new Promise(()=>{})});assert.equal(hung.code,'OBSERVATION_UNAVAILABLE');assert.ok(Date.now()-started<1000);
});
test('stale, future, malformed and inactive observations cannot report healthy',async()=>{
  assert.equal((await run({timestamp:800n})).code,'OBSERVATION_STALE');assert.equal((await run({timestamp:1031n})).code,'OBSERVATION_STALE');
  assert.equal((await run({liabilities:-1n})).code,'OBSERVATION_UNAVAILABLE');assert.equal((await run({active:false})).code,'PORTAL_INACTIVE');
  assert.equal((await run({active:false,balance:1n})).code,'ESCROW_DEFICIT');
});
test('invalid configuration does not invoke RPC and errors omit original input',async()=>{
  let called=false;const r=await run({}, {config:{secret:'credential'},read:async()=>{called=true;}});assert.equal(called,false);assert.equal(r.code,'MONITOR_CONFIG_INVALID');assert.ok(!JSON.stringify(r).includes('credential'));
});
const metadata=JSON.parse(await readFile(new URL('../shared/portal-runtime.json',import.meta.url)));
const values={MIN_DEPOSIT:1n,MAX_DEPOSIT:1000n,L2_CONTRACT:config.board.contractAddress,ROLLUP:address(1),INBOX:address(4),OUTBOX:address(5),VERSION:1n,L1_CHAIN_ID:31337n,CONFIG_HASH:'0x'+'6'.padStart(64,'0')};
const abi=PORTAL_IMMUTABLES.map(n=>`function ${n}() view returns (${['ROLLUP','INBOX','OUTBOX'].includes(n)?'address':['L2_CONTRACT','CONFIG_HASH'].includes(n)?'bytes32':'uint256'})`).concat(['function totalDeposited() view returns (uint256)','function depositsEnabled() view returns (bool)','function getInbox() view returns (address)','function getOutbox() view returns (address)','function getVersion() view returns (uint256)']);
const iface=new ethers.Interface(abi),hash='0x'+'ab'.repeat(32);
function providerFixture({wrongChain=false,wrongCode=false,wrongBoard=false}={}){
  const calls=[];const actual={...values,...(wrongBoard?{L2_CONTRACT:'0x'+'7'.padStart(64,'0')}:{})};
  return {calls,async send(method,args){calls.push({method,args});if(method==='eth_chainId')return wrongChain?'0x1':'0x7a69';if(method==='eth_getBlockByNumber')return {hash,number:'0x4',timestamp:'0x3e8'};
    assert.deepEqual(args.at(-1),{blockHash:hash,requireCanonical:true});
    if(method==='eth_getCode')return wrongCode?'0x00':expectedPortalRuntime(metadata,actual);
    if(method==='eth_getBalance')return '0x64';
    assert.equal(method,'eth_call');const name=iface.parseTransaction({data:args[0].data}).name;
    const value={...actual,totalDeposited:100n,depositsEnabled:true,getInbox:address(4),getOutbox:address(5),getVersion:1n}[name];
    return iface.encodeFunctionResult(name,[value]);
  }};
}
test('real RPC adapter pins all reads to one canonical block and verifies installed runtime',async()=>{
 const provider=providerFixture();const r=await readEscrowSnapshot({provider,config,metadata});assert.deepEqual(r,snapshot);
 assert.ok(provider.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode','eth_getBalance'].includes(c.method)));
});
test('wrong chain, board and runtime are rejected with fixed identity alert',async()=>{
 for(const mutation of [{wrongChain:true},{wrongCode:true},{wrongBoard:true}]){
  const provider=providerFixture(mutation);const r=await run({}, {read:()=>readEscrowSnapshot({provider,config,metadata})});assert.equal(r.code,'IDENTITY_UNVERIFIED');assert.ok(!('balanceWei'in r));
 }
});
test('real hanging HTTP requests are aborted and their sockets close on monitor disposal',async t=>{
 const {createServer}=await import('node:http');const {createMonitorTransport}=await import('../deploy/operations-monitor.mjs');
 const sockets=new Set();let received=0;const server=createServer((req,res)=>{received++;req.resume();});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const transport=createMonitorTransport(`http://127.0.0.1:${server.address().port}`,{timeoutMs:2000});
 t.after(()=>{transport.destroy();server.closeAllConnections();server.close();});
 const r=await run({}, {timeoutMs:80,read:()=>Promise.all([transport.send('eth_chainId',[]),transport.send('eth_getBlockByNumber',['latest',false])])});
 assert.equal(r.code,'OBSERVATION_UNAVAILABLE');assert.equal(received,2);const socketsClosed=Promise.all([...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve))));transport.destroy();
 // Stop accepting replacement idle sockets so disposal is observed deterministically.
 const closed=new Promise(resolve=>server.close(resolve));
 await Promise.race([Promise.all([closed,socketsClosed]),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('HTTP sockets survived cancellation')),1000);timer.unref();})]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sockets.size,0);
 await assert.rejects(transport.send('eth_chainId',[]));
});
