// Actual browser feed functions and actual reason codec, with DOM/RPC doubles.
// This checks presentation/ABI integration, not network execution or proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const engine = vm.createContext({ console, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout });
vm.runInContext(source('apps/src/billboard/user/engine.js'), engine);
const codec = engine.BillboardModerationCodec;
const ids = [(1n << 240n) + 31n, (1n << 241n) + 47n];
const text = 'Visible <message> with Unicode café 🌍';
const flaggedText = 'Flagged content preserved for explicit viewing';
const reason = 'Policy reason: ' + 'é'.repeat(75);
const packedReason = codec.packModerationReason(reason);
function pack(text, count = 32) {
  const padded = new Uint8Array(count * 31); padded.set(new TextEncoder().encode(text));
  return Array.from({ length: count }, (_, i) => {
    let value = 0n;
    for (let j = 0; j < 31; j++) value = value * 256n + BigInt(padded[i * 31 + j]);
    return value;
  });
}
for (const app of ['user', 'censor']) {
  test(app + ' renders stable public IDs, Unicode and moderation reasons without wallet reads', async () => {
    const appSource = source(`apps/src/billboard/${app}/app.js`);
    const start = appSource.indexOf('async function refreshBillboard()');
    const end = appSource.indexOf('\nfunction escapeHtml(', start);
    const elements = { billboardFeed: { innerHTML: '' }, billboardMeta: { textContent: '' } };
    let reads=0;
    const context=vm.createContext({console,document:{getElementById:id=>elements[id]},window:{BillboardPublic:{async readFeed(){reads++;return {posts:[{orderIndex:'0',postId:ids[0].toString(),text,flagged:false},{orderIndex:'1',postId:ids[1].toString(),text:flaggedText,flagged:true,flag:{reason,censorAddress:'0x1234'}}],eventCount:3,lastBlock:7,nextCursor:null,progress:{complete:true}};}}},
      _portalAddr:()=> 'portal',_getNodeUrl:()=> 'node',ETH_RPC_URL:'ethereum',_billboardLastCount:-1,_billboardLastBlock:-1,_showCensored:true,
      escapeHtml:value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')});
    vm.runInContext(appSource.slice(start,end),context);await context.refreshBillboard();
    assert.equal(reads,1);assert(elements.billboardFeed.innerHTML.includes('Visible &lt;message&gt; with Unicode café 🌍'));
    assert(elements.billboardFeed.innerHTML.includes(reason));if(app==='user')assert(elements.billboardFeed.innerHTML.includes(flaggedText));
    assert.equal(elements.billboardMeta.textContent,'Latest messages through block 7');
  });
}

test('user countdown does not announce withdrawal eligibility while screened debt remains', () => {
  const app = source('apps/src/billboard/user/app.js');
  const start = app.indexOf('  function updateDisplay()');
  const end = app.indexOf('\n  fetchData();', start);
  assert(start >= 0 && end > start);
  const status = { textContent: '' };
  const context = vm.createContext({
    nextAllowedTime: 200, timeOffset: 0, currentCooldown: 10, currentMaxSaveUp: 16,
    lastRealPostIndex: 3, lastScreenedIndex: 3, el: {},
    Date: { now: () => 100000 }, document: { getElementById: () => status },
  });
  vm.runInContext(app.slice(start, end), context);
  context.updateDisplay();
  assert(!/eligible to withdraw/.test(status.textContent));
  assert(/cooldown|debt|wait/i.test(status.textContent));
  context.nextAllowedTime = 99;
  context.updateDisplay();
  assert(/eligible to withdraw/.test(status.textContent));
});
