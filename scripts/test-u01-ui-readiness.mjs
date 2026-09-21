import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const user=fs.readFileSync(new URL('../apps/src/billboard/user/app.js',import.meta.url),'utf8');
const fn=user.slice(user.indexOf('function withdrawalReadiness('),user.indexOf('function startPostCountdown('));
const ready=vm.runInNewContext(fn+';withdrawalReadiness');
const deposit={amount:1n,lastScreenedIndex:2n,lastRealPostIndex:2n,nextAllowedTime:10n};
for(const [name,info,time,kind]of[
 ['eligible',deposit,10,'ready'],['cooldown',{...deposit,nextAllowedTime:11n},10,'cooldown'],
 ['unscreened',{...deposit,lastScreenedIndex:1n},20,'screening'],['missing',{...deposit,amount:0n},20,'unknown'],
 ['unsafe chain time',deposit,Number.MAX_SAFE_INTEGER+1,'unknown'],['missing chain time',deposit,null,'unknown'],
 ['large debt',{...deposit,nextAllowedTime:9007199254740993n},100,'cooldown'],
 ['large unscreened sequence',{...deposit,lastScreenedIndex:9007199254740992n,lastRealPostIndex:9007199254740993n},20,'screening']
])test('withdrawal readiness: '+name,()=>{const result=ready(info,time);assert.equal(result.kind,kind);assert.equal(result.ready,kind==='ready');});
const gate=user.slice(user.indexOf('async function doProceedToWithdraw()'),user.indexOf('// ============================================================',user.indexOf('async function doProceedToWithdraw()')));
test('actual navigation gate rejects unpaid debt without polling or signing',async()=>{
 let reads=0;const ctx={_handles:{contract:{},aztecNode:{}},_getConfigRevision:()=>1,readCurrentDeposit:async()=>{reads++;return {...deposit,nextAllowedTime:11n};},getL2Timestamp:async()=>10,withdrawalReadiness:ready,log(){}};
 await assert.rejects(vm.runInNewContext(gate+';doProceedToWithdraw()',ctx),/time lock/);assert.equal(reads,1);
});
test('actual navigation gate refuses a stale configuration response',async()=>{
 let revision=1;const ctx={_handles:{contract:{},aztecNode:{}},_getConfigRevision:()=>revision,readCurrentDeposit:async()=>{revision++;return deposit;},getL2Timestamp:async()=>10,withdrawalReadiness:ready,log(){}};
 await assert.rejects(vm.runInNewContext(gate+';doProceedToWithdraw()',ctx),/Configuration changed/);
});
class Element{constructor(tag){this.tag=tag;this.children=[];this.textContent='';}append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}}
for(const role of ['user','censor']){
 const source=fs.readFileSync(new URL('../apps/src/billboard/'+role+'/app.js',import.meta.url),'utf8');
 const start=source.indexOf('async function refreshBillboard()'),end=source.indexOf('\nfunction escapeHtml',start);assert.ok(start>=0&&end>start);
 const code=source.slice(start,end);
 function fixture(stale=false){const feed=new Element('div'),meta=new Element('div');let revision=1;const payload='<img src=x onerror=alert(1)>';
  const ctx={document:{getElementById:id=>id==='billboardFeed'?feed:meta,createElement:tag=>new Element(tag)},_portalAddr:()=> 'portal',_getNodeUrl:()=> 'node',_getEthRpcUrl:()=> 'ethereum',_getPublicConfig:()=>({board:{portalAddress:'portal'}}),_getConfigRevision:()=>revision,_billboardLastCount:-1,_billboardLastBlock:-1,window:{BillboardPublic:{readFeed:async options=>{assert.equal(options.expectedConfig.board.portalAddress,'portal');if(stale)revision++;return{eventCount:1,lastBlock:2,progress:{complete:true},posts:[{orderIndex:'1',text:payload,flagged:true,flag:{reason:payload}}]};}}}};
  return{feed,meta,ctx,payload};}
 test(role+' feed renders moderation with literal untrusted reason',async()=>{const f=fixture();await vm.runInNewContext(code+';refreshBillboard()',f.ctx);const article=f.feed.children[0];if(role==='censor'){const detail=article.children[1];assert.equal(detail.tag,'details');assert.equal(detail.children[1].textContent,f.payload);assert.equal(detail.children[2].textContent,'Moderator reason: '+f.payload);}else{assert.equal(article.children[1].textContent,'Message removed by moderator.');assert.equal(article.children[2].textContent,'Moderator reason: '+f.payload);assert(!article.children.some(n=>n.tag==='details'||n.textContent===f.payload));}});
 test(role+' feed discards responses from old configuration',async()=>{const f=fixture(true);await vm.runInNewContext(code+';refreshBillboard()',f.ctx);assert.equal(f.feed.children.length,0);assert.equal(f.meta.textContent,'');});
 test(role+' has no interpolated HTML or raw remote error output',()=>{assert.doesNotMatch(source,/innerHTML\s*=|log\(error\.message|substring\(0,\s*(80|120)\)/);});
}
