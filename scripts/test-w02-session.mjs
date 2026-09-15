// Actual session/cache helpers with provider and Web Locks doubles; no native jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function context() {
 const portal={value:'portal'},state={aztec:{address:{toString:()=> 'public-account'},secretKey:'private-key-marker',salt:'0'},ethType:'browser',ethAccount:'0xabc',ethChainId:'1',ethSigner:{sendTransaction:async()=> 'sent'}};
 const requests=[],scope={window:{walletState:state,billboardPrivateFee:{contractAddress:'payer'},ethereum:{request:async({method})=>method==='eth_accounts'?['0xabc']:'0x1'}},
 document:{getElementById:()=>portal},navigator:{locks:{request:async(name,opts,fn)=>{requests.push(name);assert.equal(opts.ifAvailable,true);return fn({name});}}},
 _walletGeneration:0,_assertWalletLive(){if(state.invalidated)throw new Error('Context invalid');},_invalidateWalletContext(){state.invalidated=true;},
 _getNodeUrl:()=> 'http://node',ETH_RPC_URL:'http://eth',buildEnv:()=>({}),buildConfig:(action,extra)=>({action,...extra}),JSON,BigInt};
 const c=vm.createContext(scope),app=source('shared/app-env.js');vm.runInContext(app.slice(app.indexOf('function makeCallEngine(')),c);
 return {c,state,portal,requests};
}
test('same-page overlapping calls and another-tab unavailable lock reject without invoking engine',async()=>{
 const f=context();let resume;const gate=new Promise(r=>resume=r);let calls=0;
 const run=f.c.makeCallEngine(async()=>{calls++;await gate;return 1;});const pending=run('post','status');
 await new Promise(r=>setImmediate(r));await assert.rejects(run('post','status'));assert.equal(calls,1);resume();assert.equal(await pending,1);
 f.c.navigator.locks.request=async(_n,_o,fn)=>fn(null);await assert.rejects(run('post','status'));assert.equal(calls,1);
 assert(!f.requests.join('').includes('private-key-marker'));
});
test('provider account and chain switches prevent engine execution',async()=>{
 for(const method of ['eth_accounts','eth_chainId']){
  const f=context();let called=false;f.c.window.ethereum.request=async arg=>arg.method===method?(method==='eth_accounts'?['0xdef']:'0x2'):(arg.method==='eth_accounts'?['0xabc']:'0x1');
  await assert.rejects(f.c.makeCallEngine(async()=>{called=true;})('post','status'));assert.equal(called,false);assert.equal(f.state.invalidated,true);
 }
});
test('portal mutation blocks signing and proof hooks during an operation',async()=>{
 const f=context();let sent=false;f.state.ethSigner.sendTransaction=async()=>{sent=true;};
 await assert.rejects(f.c.makeCallEngine(async(env,config)=>{const signer=await env.getBrowserSigner();f.portal.value='other';await config.preProveHook({});await signer.sendTransaction({});})('post','status'));
 assert.equal(sent,false);
});
test('engine witness errors and initial provider errors are both redacted',async()=>{
 for(const stage of ['engine','provider']){
  const f=context();if(stage==='provider')f.c.window.ethereum.request=async()=>{throw new Error('private-witness-marker');};
  await assert.rejects(f.c.makeCallEngine(async()=>{throw new Error('private-witness-marker');})('post','status'),e=>!e.message.includes('private-witness-marker'));
 }
});
test('lossless salts and public cache identity separate account/network/deployment',()=>{
 const app=source('apps/src/billboard/user/engine.js'),start=app.indexOf('  function _setupKey('),end=app.indexOf('  // ============================================================',start);
 const c=vm.createContext({});vm.runInContext(app.slice(start,end),c);
 const salt=(1n<<200n)+17n;assert.equal(c.walletSalt('0x'+salt.toString(16)),salt);assert.equal(c.walletSalt(salt.toString()),salt);
 for(const bad of [-1,Number.MAX_SAFE_INTEGER+1,'1e4','-1','0x'+'f'.repeat(64),null])assert.throws(()=>c.walletSalt(bad));
 const cfg={aztecNodeUrl:'n',ethRpcUrl:'e',portalAddress:'0xabc',aztecWallet:{secretKey:'private-marker'}},node={l1ChainId:1,rollupVersion:2};
 const base=c._setupKey(cfg,'account1',node,'0xroll','0xboard');assert(!base.includes('private-marker'));
 for(const changed of [c._setupKey(cfg,'account2',node,'0xroll','0xboard'),c._setupKey(cfg,'account1',{...node,l1ChainId:2},'0xroll','0xboard'),c._setupKey(cfg,'account1',node,'0xnew','0xboard'),c._setupKey(cfg,'account1',node,'0xroll','0xnew')])assert.notEqual(base,changed);
});
test('missing Web Locks support fails closed before wallet work',async()=>{
 const f=context();f.c.navigator.locks=undefined;let called=false;
 await assert.rejects(f.c.makeCallEngine(async()=>{called=true;})('post','status'));
 assert.equal(called,false);
});

test('RPC aliases for the same account acquire the same cross-tab lock',async()=>{
 const first=context(),second=context();second.c._getNodeUrl=()=> 'http://node-alias';
 await first.c.makeCallEngine(async()=>1)('status','status');
 await second.c.makeCallEngine(async()=>1)('status','status');
 assert.equal(first.requests[0],second.requests[0]);
});
