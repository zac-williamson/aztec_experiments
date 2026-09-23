import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startIsolationProbe, validateModelOptions, checkIsolation, hashModel, PROBE_IMAGE } from './model-runtime.mjs';

const probePath = fileURLToPath(new URL('./model-runtime-probe.cjs', import.meta.url));
async function rawRequest(port, request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.end(request));
    socket.on('data', chunk => chunks.push(chunk));
    socket.once('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.once('error', error => error.code === 'ECONNRESET' ? resolve('') : reject(error));
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Proxy did not close unsupported request')); });
  });
}
test('requires immutable image and model content pins before starting Docker', async () => {
  await assert.rejects(validateModelOptions({ image: 'latest' }), /immutable/);
  await assert.rejects(validateModelOptions({ image: PROBE_IMAGE, modelPath: probePath }), /SHA-256 is required/);
  await assert.rejects(validateModelOptions({ image: PROBE_IMAGE, modelPath: probePath, modelSha256: '0'.repeat(64) }), /SHA-256 mismatch/);
  assert.equal((await validateModelOptions({ image: PROBE_IMAGE, modelPath: probePath, modelSha256: await hashModel(probePath) })).port, 5090);
});

test('actual container excludes dummy signer files/env and denies egress to a reachable controlled host fixture', { timeout: 150000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'billboard-model-isolation-'));
  const secretPath = path.join(directory, 'dummy-signer-secret');
  await fs.writeFile(secretPath, 'DISPOSABLE-NONSECRET-CANARY', { mode: 0o600 });
  const original = process.env.BILLBOARD_TEST_SIGNER_SECRET;
  process.env.BILLBOARD_TEST_SIGNER_SECRET = 'DISPOSABLE-NONSECRET-ENV-CANARY';
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const hostFixture = net.createServer(socket => socket.end('fixture'));
  await new Promise((resolve, reject) => { hostFixture.once('error', reject); hostFixture.listen(0, '0.0.0.0', resolve); });
  const hostPort = hostFixture.address().port;
  let runtime;
  try {
    runtime = await startIsolationProbe({ probePath, port });
    const before = await runtime.inspect();
    const hostName = process.platform === 'darwin' ? 'host.docker.internal' : before.proxy.NetworkSettings.Networks[before.proxyNetwork.Name].Gateway;
    const control = await promisify(execFile)('docker', ['exec', runtime.proxyId, 'node', '-e',
      // Drain the positive-control response: destroying an unread socket resets its peer on Linux.
      "require('dns').lookup(process.argv[2],(e,a)=>{if(e)throw e;let body='';const s=require('net').connect(Number(process.argv[1]),a);s.setEncoding('utf8');s.on('data',chunk=>body+=chunk);s.once('end',()=>{if(body!=='fixture')process.exit(4);console.log(a)});s.setTimeout(3000,()=>process.exit(2));s.on('error',()=>process.exit(3))})", String(hostPort), hostName], { encoding: 'utf8', timeout: 10000 });
    const egressHost = control.stdout.trim();
    assert.ok(net.isIP(egressHost));
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', body: JSON.stringify({ secretPath, egressHost, egressPort: hostPort }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(result, { uid: 65532, gid: 65532, hostSecretReadable: false,
      hostSecretEnvironmentPresent: false, dockerSocketPresent: false,
      rootWritable: false, modelWritable: false, tmpWritable: true,
      noNewPrivileges: true, noEffectiveCapabilities: true, noDefaultRoute: true, hostEgressAvailable: false });
    const inspected = await runtime.inspect();
    assert.equal(inspected.container.State.Running, true);
    assert.equal(inspected.proxy.State.Running, true);
    assert.equal(inspected.network.Options['com.docker.network.bridge.gateway_mode_ipv4'], 'isolated');
    assert.equal(inspected.network.EnableIPv6, false);
    const weakenedNetwork = structuredClone(inspected.network);
    weakenedNetwork.Options['com.docker.network.bridge.gateway_mode_ipv4'] = 'nat';
    assert.throws(() => checkIsolation(inspected.container, weakenedNetwork, inspected.config, inspected.network.Name, inspected.imageEnv), /host bridge/);
    for (const mutate of [
      c => { c.Config.Env.push('BILLBOARD_TEST_SIGNER_SECRET=unexpected'); },
      c => { c.HostConfig.Tmpfs['/tmp'] = 'rw,noexec'; },
      c => { c.Mounts[0].RW = true; },
      c => { c.HostConfig.PidMode = 'host'; },
      c => { c.HostConfig.CapAdd = ['SYS_ADMIN']; },
    ]) {
      const weakened = structuredClone(inspected.container);
      mutate(weakened);
      assert.throws(() => checkIsolation(weakened, inspected.network, inspected.config, inspected.network.Name, inspected.imageEnv), /isolation check failed/);
    }
    for (const route of ['/probe', '/v1/models', '/http://example.invalid/']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${route}`)).status, 404);
    }
    assert.match(await rawRequest(port, 'GET http://example.invalid/health HTTP/1.1\r\nHost: example.invalid\r\nConnection: close\r\n\r\n'), /^HTTP\/1.1 404/);
    assert.equal(await rawRequest(port, 'CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid\r\n\r\n'), '');
    const oversizedRequest = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: 'x'.repeat(65537) }).catch(() => null);
    assert.ok(oversizedRequest === null || oversizedRequest.status === 413);
    const oversizedReply = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ oversizedResponse: true }) });
    assert.equal(oversizedReply.status, 502);
    await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write('POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{', () => socket.destroy());
      });
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await runtime.inspect()).proxy.State.Running, true);
    console.log(JSON.stringify({ outcome: 'pass', platform: process.platform, image: PROBE_IMAGE,
      gatewayMode: inspected.network.Options['com.docker.network.bridge.gateway_mode_ipv4'],
      modelGateway: inspected.container.NetworkSettings.Networks[inspected.network.Name].Gateway,
      networkIpam: inspected.network.IPAM.Config, positiveControlHostReachable: true, ...result }));
  } finally {
    if (runtime) await runtime.stop();
    await new Promise(resolve => hostFixture.close(resolve));
    if (original === undefined) delete process.env.BILLBOARD_TEST_SIGNER_SECRET;
    else process.env.BILLBOARD_TEST_SIGNER_SECRET = original;
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test('aborted actual startup removes any partially created owned resources', {timeout:45000}, async()=>{
 const docker=async args=>(await promisify(execFile)('docker',args,{encoding:'utf8',timeout:10000})).stdout.trim().split('\n').filter(Boolean).sort();
 const resources=async()=>({containers:await docker(['ps','-a','--filter','label=org.billboard.role','--format','{{.Names}}']),networks:(await docker(['network','ls','--format','{{.Name}}'])).filter(n=>n.startsWith('billboard-model-'))});
 const before=await resources();
 await assert.rejects(startIsolationProbe({probePath,port:5098,signal:AbortSignal.timeout(400)}));
 assert.deepEqual(await resources(),before);
});
