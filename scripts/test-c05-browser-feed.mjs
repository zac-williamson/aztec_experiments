// Actual browser feed functions and actual reason codec, with DOM/RPC doubles.
// This checks presentation/ABI integration, not network execution or proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const engine = vm.createContext({performance, console, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout });
vm.runInContext(source('apps/src/billboard/user/engine.js'), engine);
const codec = engine.BillboardModerationCodec;
const ids = [(1n << 240n) + 31n, (1n << 241n) + 47n];
const text = 'Visible <message> with Unicode café 🌍';
const flaggedText = 'Flagged content preserved for explicit viewing';
const reason = 'Policy reason: ' + 'é'.repeat(75);
const packedReason = codec.packModerationReason(reason);
class Element {
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
}
for (const app of ['user', 'censor']) {
  test(app + ' renders stable public IDs, Unicode and moderation reasons without wallet reads', async () => {
    const appSource = source(`apps/src/billboard/${app}/app.js`);
    const start = appSource.indexOf('async function refreshBillboard()');
    const end = appSource.indexOf('\nfunction escapeHtml(', start);
    const elements = {billboardFeed:new Element('div'),billboardMeta:new Element('div')};
    let reads=0;
    const context=vm.createContext({performance,console,document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},window:{BillboardPublic:{async readFeed(){reads++;return {posts:[{orderIndex:'0',postId:ids[0].toString(),text,flagged:false},{orderIndex:'1',postId:ids[1].toString(),text:flaggedText,flagged:true,flag:{reason:codec.decodeModerationReason(packedReason.fields,packedReason.byteLength),censorAddress:'0x1234'}}],eventCount:3,lastBlock:7,nextCursor:null,progress:{complete:true}};}}},
      _portalAddr:()=> 'portal',_getNodeUrl:()=> 'node',_getEthRpcUrl:()=> 'ethereum',_getPublicConfig:()=>({}),_getConfigRevision:()=>1,_billboardLastCount:-1,_billboardLastBlock:-1,_showCensored:true,
      escapeHtml:value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')});
    vm.runInContext(appSource.slice(start,end),context);await context.refreshBillboard();
    assert.equal(reads,1);
    const [visible,flagged]=elements.billboardFeed.children;
    assert.equal(visible.children[0].textContent,'#0');assert.equal(visible.children[1].textContent,text);
    assert.equal(flagged.children[0].textContent,'#1');
    const details=flagged.children[1];assert.equal(details.tag,'details');assert.equal(details.children[0].tag,'summary');
    assert.equal(details.children[1].textContent,flaggedText);assert.equal(details.children[2].textContent,'Moderator reason: '+reason);
    assert.equal(elements.billboardMeta.textContent,'Latest messages through block 7');
  });
}

test('user withdrawal readiness refuses screened debt and accepts expired debt',()=>{
  const app=source('apps/src/billboard/user/app.js');
  const start=app.indexOf('function withdrawalReadiness('),end=app.indexOf('function startPostCountdown(',start);
  assert(start>=0&&end>start);
  const readiness=vm.runInNewContext(app.slice(start,end)+';withdrawalReadiness');
  const info={amount:1n,lastScreenedIndex:3n,lastRealPostIndex:3n,nextAllowedTime:200n};
  assert.equal(readiness(info,100).ready,false);assert.equal(readiness(info,100).kind,'cooldown');
  assert.equal(readiness({...info,nextAllowedTime:99n},100).ready,true);
});
