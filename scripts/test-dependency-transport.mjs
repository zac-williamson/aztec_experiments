import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Agent, makeUndiciFetch } from '@aztec/foundation/json-rpc/undici';
import { NoRetryError } from '@aztec/foundation/retry';
import { WebSocket, WebSocketServer, Receiver } from 'ws';
import { WebSocket as SelectedWebSocket } from 'isows';
import { getWebSocketRpcClient } from '../node_modules/viem/_esm/utils/rpc/webSocket.js';

const require = createRequire(import.meta.url);
const deadline = async (promise, ms = 2000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture deadline')), ms); })]); }
  finally { clearTimeout(timer); }
};

async function httpFixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await deadline(closed);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('Foundation resolves the qualified Undici Agent from the actual consumer', () => {
  const fromFoundation = createRequire(require.resolve('@aztec/foundation/json-rpc/undici'));
  assert.equal(fromFoundation('undici/package.json').version, '6.28.1');
  assert.equal(Agent, fromFoundation('undici').Agent);
  assert.equal(process.versions.undici, '7.29.1', 'Node embedded transport is independently pinned');
});

test('real Foundation POST preserves path, gzip threshold, response and optional cookie API', { timeout: 10000 }, async t => {
  const observed = [];
  const url = await httpFixture(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const body = JSON.parse((req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString());
    observed.push({ path: req.url, headers: req.headers, body });
    res.writeHead(200, { 'content-encoding': 'gzip', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
    res.end(gzipSync(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.params })));
  });
  const agent = new Agent({ connections: 1, headersTimeout: 1000, bodyTimeout: 1000 });
  t.after(() => agent.destroy());
  const cookies = [];
  const fetch = makeUndiciFetch(agent, { getCookieString: async () => 'fixture=only', setCookie: async (...args) => cookies.push(args) });
  for (const params of [['tiny'], ['x'.repeat(1500)]]) {
    const { response } = await fetch(`${url}/rpc?mode=test#ignored`, { jsonrpc: '2.0', id: 7, method: 'echo', params }, { 'x-fixture': 'yes' });
    assert.deepEqual(response.result, params);
  }
  assert.deepEqual(observed.map(x => x.path), ['/rpc?mode=test', '/rpc?mode=test']);
  assert.deepEqual(observed.map(x => x.headers['content-encoding']), [undefined, 'gzip']);
  assert(observed.every(x => x.headers.cookie === 'fixture=only' && x.headers['accept-encoding'] === 'gzip'));
  assert.equal(cookies.length, 4);
  assert(cookies.every(x => x[1] === `${url}/rpc?mode=test`));
  await agent.close();
});

test('Foundation HTTP/gzip/JSON errors release the single connection for a subsequent request', { timeout: 10000 }, async t => {
  let calls = 0;
  const url = await httpFixture(t, (req, res) => {
    req.resume();
    calls++;
    if (req.url === '/400') { res.writeHead(400); res.end('{}'); }
    else if (req.url === '/503') { res.writeHead(503); res.end('{}'); }
    else if (req.url === '/bad-gzip') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end('invalid'); }
    else if (req.url === '/bad-json') { res.end('{'); }
    else { res.end('{"result":"recovered"}'); }
  });
  const agent = new Agent({ connections: 1, headersTimeout: 1000, bodyTimeout: 1000 });
  t.after(() => agent.destroy());
  const fetch = makeUndiciFetch(agent);
  await assert.rejects(fetch(`${url}/400`, {}), NoRetryError);
  await assert.rejects(fetch(`${url}/503`, {}), e => !(e instanceof NoRetryError) && /503/.test(e.message));
  await assert.rejects(fetch(`${url}/503`, {}, {}, true), NoRetryError);
  await assert.rejects(fetch(`${url}/bad-gzip`, {}), /Failed to read response body/);
  await assert.rejects(fetch(`${url}/bad-json`, {}), /Failed to parse body as JSON/);
  assert.equal((await deadline(fetch(`${url}/ok`, {}))).response.result, 'recovered');
  assert.equal(calls, 6, 'no hidden retry interceptor');
  await agent.close();
});

test('Foundation stalled headers hit Agent timeout and cleanly recover', { timeout: 5000 }, async t => {
  const url = await httpFixture(t, (req, res) => { req.resume(); if (req.url === '/ok') res.end('{"result":true}'); });
  const agent = new Agent({ connections: 1, headersTimeout: 100, bodyTimeout: 100 });
  t.after(() => agent.destroy());
  const fetch = makeUndiciFetch(agent);
  await assert.rejects(deadline(fetch(`${url}/stall`, {})), /Headers Timeout|headers timeout/i);
  assert.equal((await deadline(fetch(`${url}/ok`, {}))).response.result, true);
  await agent.close();
});

test('Foundation stalled response body hits Agent timeout and recovers', { timeout: 5000 }, async t => {
  const url = await httpFixture(t, (req, res) => {
    req.resume();
    if (req.url === '/ok') res.end('{"result":true}');
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }
  });
  const agent = new Agent({ connections: 1, headersTimeout: 100, bodyTimeout: 100 });
  t.after(() => agent.destroy());
  const fetch = makeUndiciFetch(agent);
  await assert.rejects(deadline(fetch(`${url}/stall`, {})), /Body Timeout|body timeout/i);
  assert.equal((await deadline(fetch(`${url}/ok`, {}))).response.result, true);
  await agent.close();
});

async function wsFixture(t, connection) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 1024, perMessageDeflate: false });
  server.on('connection', connection);
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await deadline(new Promise(resolve => server.close(resolve)));
  });
  return `ws://127.0.0.1:${server.address().port}`;
}

test('actual isows/viem resolver uses patched package fallback and qualified Node native WebSocket', () => {
  const fromViem = createRequire(require.resolve('viem'));
  const fromIsows = createRequire(fromViem.resolve('isows'));
  assert.equal(fromIsows('ws/package.json').version, '8.21.0');
  assert.equal(require('ws/package.json').version, '8.21.0');
  assert.equal(SelectedWebSocket, globalThis.WebSocket);
});

test('actual isows selects ws when native WebSocket is absent in a fresh isolated runtime', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    delete globalThis.WebSocket;
    const selected = await import('isows');
    const ws = await import('ws');
    assert.equal(selected.WebSocket, ws.WebSocket);
  `], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH }, timeout: 5000, stdio: 'pipe' });
});

test('patched ws fragment bound distinguishes two accepted bytes from three rejected bytes', async () => {
  const accepted = new Receiver({ maxFragments: 2, maxPayload: 20 });
  const good = once(accepted, 'message');
  accepted.write(Buffer.from([0x01, 1, 0x61, 0x80, 1, 0x62]));
  assert.equal((await deadline(good))[0].toString(), 'ab');
  accepted.destroy();
  const rejected = new Receiver({ maxFragments: 2, maxPayload: 20 });
  const bad = once(rejected, 'error');
  rejected.write(Buffer.from([0x01, 1, 0x61, 0x00, 1, 0x62, 0x80, 1, 0x63]));
  assert.equal((await deadline(bad))[0].code, 'WS_ERR_TOO_MANY_BUFFERED_PARTS');
  rejected.destroy();
});

for (const [name, Constructor] of [['native-selected-isows', SelectedWebSocket], ['patched-ws', WebSocket]]) {
  test(`${name} bounded echo and close control`, { timeout: 5000 }, async t => {
    const url = await wsFixture(t, socket => socket.on('message', data => socket.send(data.toString())));
    const socket = new Constructor(url);
    t.after(() => { if (socket.readyState !== 3) socket.close(); });
    await deadline(new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }));
    const message = new Promise(resolve => socket.addEventListener('message', e => resolve(e.data), { once: true }));
    socket.send('bounded fixture');
    assert.equal(await deadline(message), 'bounded fixture');
    const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
    socket.close(1000, 'done');
    assert.equal((await deadline(closed)).code, 1000);
  });
}

test('actual viem JSON-RPC subscription and malformed-message error controls', { timeout: 5000 }, async t => {
  let peer;
  const url = await wsFixture(t, socket => {
    peer = socket;
    socket.on('message', bytes => {
      const msg = JSON.parse(bytes.toString());
      if (msg.method === 'malformed') socket.send('{');
      else socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'eth_subscribe' ? 'sub-1' : 'ok' }));
    });
  });
  const client = await getWebSocketRpcClient(url, { keepAlive: false, reconnect: false });
  t.after(() => client.close());
  assert.equal((await client.requestAsync({ body: { method: 'echo' }, timeout: 1000 })).result, 'ok');
  const events = [];
  let notification;
  const received = new Promise(resolve => { notification = resolve; });
  await new Promise((resolve, reject) => client.request({ body: { method: 'eth_subscribe', params: ['heads'] }, onError: reject,
    onResponse: value => { events.push(value); if (value.result === 'sub-1') resolve(); else notification(); } }));
  peer.send(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: 'sub-1', result: 'event' } }));
  await deadline(received);
  assert.equal(events[1].params.result, 'event');
  await assert.rejects(client.requestAsync({ body: { method: 'malformed' }, timeout: 1000 }), SyntaxError);
});
