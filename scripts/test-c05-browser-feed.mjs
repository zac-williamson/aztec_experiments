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
  test(app + ' feed resolves large stable IDs and decodes seven-field reasons with explicit length', async () => {
    const appSource = source(`apps/src/billboard/${app}/app.js`);
    const start = appSource.indexOf('async function refreshBillboard()');
    const end = appSource.indexOf('\nfunction escapeHtml(', start);
    assert(start >= 0 && end > start);
    const elements = { billboardFeed: { innerHTML: '' }, billboardMeta: { innerHTML: '', textContent: '' } };
    const calls = [];
    const errors = [];
    let reasonCalls = 0;
    const methods = new Proxy({}, { get(_target, method) {
      return (...args) => ({ simulate: async () => {
        calls.push([method, ...args]);
        if (method === 'get_post_count') return { result: 2n };
        if (method === 'get_post_id') {
          assert([0n, 1n].includes(args[0]));
          return { result: { value: ids[Number(args[0])] } };
        }
        if (!ids.includes(args[0])) { errors.push('Wrong identity for ' + method); throw new Error('Wrong identity'); }
        const flagged = args[0] === ids[1];
        if (method === 'is_post_flagged') return { result: flagged };
        if (method === 'get_post') return { result: pack(flagged ? flaggedText : text) };
        if (method === 'get_censor_response') return { result: packedReason.fields };
        if (method === 'get_censor_response_length') return { result: { value: BigInt(packedReason.byteLength) } };
        if (method === 'get_post_flagged_by') return { result: '0x1234' };
        throw new Error('Unexpected method ' + method);
      } });
    } });
    const context = vm.createContext({ TextDecoder, Uint8Array, console,
      document: { getElementById: id => elements[id] },
      window: { BillboardModerationCodec: { decodeModerationReason(fields, length) {
        reasonCalls++; assert.equal(fields.length, 7); assert.equal(length, String(packedReason.byteLength));
        return codec.decodeModerationReason(fields, length);
      } } },
      _handles: { address: {}, contract: { methods }, aztecNode: { getBlockNumber: async () => 7 } },
      _billboardLastCount: -1, _billboardLastBlock: -1, _showCensored: true, MSG_FIELDS: 32,
      extractInt: result => result.result, extractFieldArray: result => result.result,
      escapeHtml: value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    });
    vm.runInContext(appSource.slice(start, end), context);
    await context.refreshBillboard();
    assert.deepEqual(errors, []);
    assert.equal(reasonCalls, 1);
    assert(elements.billboardFeed.innerHTML.includes('Visible &lt;message&gt; with Unicode café 🌍'));
    assert(elements.billboardFeed.innerHTML.includes(reason));
    if (app === 'user') assert(elements.billboardFeed.innerHTML.includes(flaggedText));
    assert(!elements.billboardFeed.innerHTML.includes('(error loading)'));
    assert(calls.some(([method, id]) => method === 'get_post' && id === ids[0]));
    assert(calls.some(([method, id]) => method === 'get_censor_response_length' && id === ids[1]));
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
