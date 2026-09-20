import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const configSource=fs.readFileSync(new URL('../shared/public-app-config.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../shared/public-app-bootstrap.js',import.meta.url),'utf8');
const address=n=>'0x'+n.repeat(64),rollup='0x'+'1'.repeat(40);
const config={schemaVersion:1,network:{nodeUrl:'https://node.example/',ethRpcUrl:'https://eth.example/',chainId:'1',rollupVersion:'5',rollupAddress:rollup},board:{portalAddress:'0x'+'2'.repeat(40),contractAddress:address('3')},privateFee:{contractAddress:address('1'),gasSettings:{gasLimits:{daGas:'10',l2Gas:'20'},teardownGasLimits:{daGas:'0',l2Gas:'0'},maxFeesPerGas:{feePerDaGas:'2',feePerL2Gas:'3'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
// Use field-sized addresses (0x33... exceeds the Aztec field).
config.board.contractAddress='0x03'+'3'.repeat(62);
const other='0x04'+'4'.repeat(62),fragment=board=>'#network=1:'+rollup+':5&board='+board;
function fixture({hash=fragment(other),fee=true,fetchFailure=false,resolve}={}){
 const status={textContent:''},links=[{href:'https://site.example/feed.html'},{href:'https://site.example/fee-juice.html'}],events={};let requests=0,connections=0,reloads=0;
 const c=vm.createContext({URL,TextEncoder,AbortSignal,location:{href:'https://site.example/user.html'+hash,hash,reload(){reloads++;}},history:{replaceState(_a,_b,url){c.location.href=url.href;c.location.hash=url.hash;}},document:{body:{hasAttribute:name=>name==='data-hosted-board'},getElementById:id=>id==='setupStatus'?status:null,querySelectorAll:()=>links},localStorage:{getItem(){throw Error('Must not read stale origin settings');},setItem(){throw Error('Must not change saved settings');}},addEventListener(name,fn){events[name]=fn;},fetch:async()=>{requests++;if(fetchFailure)throw Error('offline');return {ok:true,text:async()=>JSON.stringify({...config,privateFee:fee?config.privateFee:null})};},BillboardPublic:{metadata:{},browserPublicFeedStorage:()=>({}),connectPublicBoard:async({network,boardAddress})=>{connections++;if(resolve)await resolve(c);return {config:{schemaVersion:1,network,board:{contractAddress:boardAddress,portalAddress:config.board.portalAddress},privateFee:null}};}}});
 vm.runInContext(configSource,c);vm.runInContext(bootstrap,c);return {c,status,links,events,counts:()=>({requests,connections,reloads})};
}
test('hosted posting uses the explicit board, preserves fee settings and links, and ignores saved settings',async()=>{
 const f=fixture();let initialized=0;await f.c.initializeHostedBoard(()=>initialized++);
 assert.equal(initialized,1);assert.equal(f.c.billboardConfigStore.snapshot().config.board.contractAddress,other);assert.equal(f.c.billboardConfigStore.snapshot().config.privateFee.contractAddress,config.privateFee.contractAddress);
 assert(f.links.every(link=>new URL(link.href).hash===fragment(other)));assert.equal(f.counts().requests,1);
 const snapshot=f.c.billboardConfigStore.snapshot();f.c.billboardConfigStore.clear();assert.throws(()=>f.c.billboardConfigStore.assertCurrent(snapshot));
 f.events.hashchange();assert.equal(f.counts().reloads,1);
});
for(const options of [{fee:false},{fetchFailure:true},{hash:fragment(other).replace('network=1:','network=2:')},{hash:'#board=invalid'}])test('unavailable or mismatched hosted settings prevent wallet initialization '+JSON.stringify(options),async()=>{
 const f=fixture(options);let initialized=0;await f.c.initializeHostedBoard(()=>initialized++);assert.equal(initialized,0);assert.equal(f.c.billboardConfigStore.snapshot().config,null);assert.match(f.status.textContent,options.fee===false?/not enabled/:/unavailable/);if(options.fee===false){assert.equal(f.links[0].hidden,false);assert.equal(f.links[1].hidden,true);f.events.hashchange();assert.equal(f.counts().reloads,1);}
});
test('a board change during verification reloads before installing settings or initializing wallets',async()=>{
 const f=fixture({resolve:c=>{c.location.hash=fragment(config.board.contractAddress);}});let initialized=0;await f.c.initializeHostedBoard(()=>initialized++);assert.equal(initialized,0);assert.equal(f.c.billboardConfigStore.snapshot().config,null);assert.equal(f.counts().reloads,1);
});
