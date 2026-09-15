import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/app-env.js', import.meta.url), 'utf8');
function boundary() {
  const calls = [];
  const window = { location: { href: 'https://board.example/' },
    RPC_CONFIG: { nodeUrl: 'https://rpc.example/aztec', apiKey: 'disposable-test-credential' },
    fetch: async (input, init) => { calls.push({ input, init }); return {}; } };
  const context = vm.createContext({ window, URL, Headers, Request });
  vm.runInContext(source, context);
  vm.runInContext('setupRpcAuth()', context);
  return { window, calls, context };
}
test('actual RPC wrapper confines credentials and disallows redirect forwarding', async () => {
  const { window, calls, context } = boundary();
  await window.fetch('https://rpc.example/aztec', { method: 'POST', headers: { 'content-type': 'application/json' } });
  assert.equal(calls[0].init.headers.get('x-aztec-api-key'), 'disposable-test-credential');
  assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
  assert.equal(calls[0].init.redirect, 'error');
  for (const url of ['https://evil.example/?aztec-labs.com', 'https://rpc.example.evil/aztec',
    'https://rpc.example/issuer', 'https://rpc.example/aztec-extra', 'http://rpc.example/aztec', '/issuer']) {
    await window.fetch(url);
    assert.equal(calls.at(-1).init, undefined);
  }
  window.RPC_CONFIG.apiKey = 'replacement-for-another-endpoint';
  window.RPC_CONFIG.nodeUrl = 'https://different.example/';
  await window.fetch('https://rpc.example/aztec');
  assert.equal(calls.at(-1).init.headers.get('x-aztec-api-key'), 'disposable-test-credential');
  const before = window.fetch;
  vm.runInContext('setupRpcAuth()', context);
  assert.equal(window.fetch, before, 'repeated setup must not wrap again');
});
test('Request and URL inputs preserve headers without mutating caller data', async () => {
  const { window, calls } = boundary();
  const request = new Request('https://rpc.example/aztec', { headers: { 'content-type': 'application/json' } });
  await window.fetch(request);
  assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
  assert.equal(calls[0].init.headers.get('x-aztec-api-key'), 'disposable-test-credential');
  assert.equal(request.headers.has('x-aztec-api-key'), false);
  await window.fetch(new URL('https://rpc.example/aztec'));
  assert.equal(calls[1].init.headers.get('x-aztec-api-key'), 'disposable-test-credential');
});
