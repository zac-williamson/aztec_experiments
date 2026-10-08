import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/public-app-bootstrap.js',import.meta.url),'utf8');
const config={network:{chainId:'11155111',rollupVersion:'5',rollupAddress:'0x'+'1'.repeat(40)},board:{contractAddress:'0x'+'2'.repeat(64)},privateFee:null};
const fragment='#network=11155111:'+config.network.rollupAddress+':5&board='+config.board.contractAddress;
function fixture(){let connections=0;const ctx={URL,AbortSignal,location:{href:'https://board.test/user.html',hash:''},document:{body:{hasAttribute:name=>name==='data-public-board-reader'}},fetch:async()=>({ok:true,text:async()=>JSON.stringify(config)}),BillboardConfig:{parse:JSON.parse,validate:x=>x},BillboardPublic:{metadata:{},browserPublicFeedStorage:()=>({}),connectPublicBoard:async()=>{connections++;return {config};}}};vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,count:()=>connections};}
for(const link of ['garbage','https://board.test/user.html','javascript:alert(1)','https://board.test/#bad'])test('explicit invalid board link: '+link,async()=>{const f=fixture();await assert.rejects(f.ctx.loadHostedBoard(link),{code:'BB_BOARD_LINK_INVALID'});assert.equal(f.count(),0);});
test('unsupported network is different from an invalid link',async()=>{const f=fixture();await assert.rejects(f.ctx.loadHostedBoard('https://board.test/'+fragment.replace('11155111','1')),{code:'BB_BOARD_NETWORK_UNSUPPORTED'});assert.equal(f.count(),0);});
test('canonical explicit link and ordinary default both resolve the hosted board',async()=>{const f=fixture();await f.ctx.loadHostedBoard('https://board.test/'+fragment);await f.ctx.loadHostedBoard();assert.equal(f.count(),2);});
test('permanent incompatibility and temporary connectivity expose different next actions',()=>{const f=fixture();assert.equal(f.ctx.boardConnectionFailure({code:'BB_BOARD_INCOMPATIBLE'}).retry,false);assert.equal(f.ctx.boardConnectionFailure(Error()).retry,true);});

// Execute the actual configuration store; the bootstrap must not inherit another board.
const storeSource=fs.readFileSync(new URL('../shared/public-app-config.js',import.meta.url),'utf8');
function moderatorFixture(hash='',stored=null,navigation=null){
 const storage=new Map(),status={textContent:'',append(){}};
 const c={schemaVersion:1,network:{...config.network,nodeUrl:'https://node.test/',ethRpcUrl:'https://eth.test/'},board:{...config.board,portalAddress:'0x'+'3'.repeat(40)},privateFee:null};
 const ctx={URL,AbortSignal,TextEncoder,history:{state:navigation,replaceState(value,_unused,url){this.state=value;const target=new URL(url,ctx.location.href);ctx.location.hash=target.hash;ctx.location.href=target.href;}},location:{href:'https://board.test/censor.html'+hash,hash,pathname:'/censor.html',search:'',reload(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener(){},document:{readyState:'loading',addEventListener(){},body:{hasAttribute:n=>n==='data-moderator-board'},getElementById:()=>status},fetch:async()=>({ok:true,text:async()=>JSON.stringify(c)}),BillboardPublic:{metadata:{},browserPublicFeedStorage:()=>({}),connectPublicBoard:async()=>({config:c})}};
 vm.createContext(ctx);vm.runInContext(storeSource,ctx);if(stored)storage.set(ctx.BillboardConfig.STORAGE_KEY,JSON.stringify({...c,...stored}));vm.runInContext(source,ctx);return {ctx,c,status,storage};
}
test('invalid explicit moderator link never inherits saved board or initializes wallet',async()=>{
 const f=moderatorFixture('#bad',{});let starts=0;await f.ctx.initializeSelectedBoard(()=>starts++);assert.equal(starts,0);assert.equal(f.ctx.billboardConfigStore.snapshot().config,null);assert.match(f.status.textContent,/invalid/);
});
test('moderator without incoming link retains custom-network saved configuration',async()=>{
 const f=moderatorFixture('',{network:{...config.network,chainId:'1',nodeUrl:'https://custom.test',ethRpcUrl:'https://custometh.test'}});f.ctx.loadHostedBoard=()=>{throw Error('Must not resolve hosted defaults');};let starts=0;await f.ctx.initializeSelectedBoard(()=>starts++);assert.equal(starts,1);assert.equal(f.ctx.billboardConfigStore.snapshot().config.network.chainId,'1');
});
for(const failure of [false,true])test('late moderator resolution cannot replace explicitly selected board: '+failure,async()=>{
 const f=moderatorFixture(fragment,{});let resolve,reject,starts=0;f.ctx.loadHostedBoard=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});const pending=f.ctx.initializeSelectedBoard(()=>starts++);const replacement={...f.c,board:{...f.c.board,contractAddress:'0x'+'0'.repeat(63)+'4'}};f.ctx.billboardConfigStore.install(replacement);f.status.textContent='Selected replacement';if(failure)reject(Error('Old read failed'));else resolve({config:f.c});await pending;assert.equal(starts,0);assert.equal(f.status.textContent,'Selected replacement');assert.equal(f.ctx.billboardConfigStore.snapshot().config.board.contractAddress,replacement.board.contractAddress);assert.equal(f.ctx.billboardConfigStore.snapshot().persisted,false);assert.equal(f.ctx.billboardConfigStore.snapshot().persistence,'page');
});

test('explicit moderator reload preserves selected custom network without hosted fallback',async()=>{
 const f=moderatorFixture(fragment),custom={...f.c,network:{...f.c.network,nodeUrl:'https://custom.example',ethRpcUrl:'https://custom-eth.example',chainId:'1'}};f.ctx.billboardConfigStore.install(custom);let ended=0,reloaded=0;f.ctx.BillboardAccount={endSession:async()=>{ended++;}};f.ctx.location.reload=()=>reloaded++;
 await f.ctx.reloadSelectedBoard();assert.equal(ended,1);assert.equal(reloaded,1);
 const next=moderatorFixture(f.ctx.location.hash,null,f.ctx.history.state);next.ctx.loadHostedBoard=()=>{throw Error('Unexpected hosted fallback');};let started=0;next.ctx.billboardConfigStore.subscribe(s=>next.ctx.rememberSelectedBoard(s.config));await next.ctx.initializeSelectedBoard(()=>started++);assert.equal(started,1);const again=moderatorFixture(next.ctx.location.hash,null,next.ctx.history.state);again.ctx.loadHostedBoard=()=>{throw Error('Unexpected second reload fallback');};await again.ctx.initializeSelectedBoard(()=>started++);assert.equal(started,2);assert.equal(next.ctx.billboardConfigStore.snapshot().config.network.nodeUrl,'https://custom.example/');assert.equal(next.ctx.billboardConfigStore.snapshot().config.network.chainId,'1');
});
test('navigation config from a different board never overrides an explicit incoming link',async()=>{
 const f=moderatorFixture(fragment);f.ctx.history.state={billboardSelectedConfiguration:{...f.c,board:{...f.c.board,contractAddress:'0x'+'0'.repeat(63)+'4'}}};let starts=0;await f.ctx.initializeSelectedBoard(()=>starts++);assert.equal(starts,1);assert.equal(f.ctx.billboardConfigStore.snapshot().config.board.contractAddress,f.c.board.contractAddress);
});

test('changing board during session termination cannot reload an obsolete selection',async()=>{
 const f=moderatorFixture(fragment);f.ctx.billboardConfigStore.install(f.c);let finish,reloads=0;f.ctx.BillboardAccount={endSession:()=>new Promise(resolve=>finish=resolve)};f.ctx.location.reload=()=>reloads++;const pending=f.ctx.reloadSelectedBoard();f.ctx.billboardConfigStore.install({...f.c,board:{...f.c.board,contractAddress:'0x'+'0'.repeat(63)+'4'}});finish();await assert.rejects(pending,/changed/);assert.equal(reloads,0);
});

test('explicitly clearing selected board removes its navigation state before reload',async()=>{
 const f=moderatorFixture(fragment);f.ctx.billboardConfigStore.install(f.c);f.ctx.rememberSelectedBoard(f.c);f.ctx.billboardConfigStore.clear();f.ctx.forgetSelectedBoard();assert.equal(f.ctx.location.hash,'');assert.equal(f.ctx.history.state.billboardSelectedConfiguration,null);const next=moderatorFixture(f.ctx.location.hash,{},f.ctx.history.state);await next.ctx.initializeSelectedBoard(()=>{});assert.equal(next.ctx.billboardConfigStore.snapshot().config,null);
});
