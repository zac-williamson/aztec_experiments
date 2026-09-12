// Harmless container fixture. Returns only boolean isolation observations.
const http = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const canWrite = filename => { try { fs.writeFileSync(filename, 'probe'); return true; } catch { return false; } };
async function canConnect(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
http.createServer(async (req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { secretPath, egressHost, egressPort, oversizedResponse } = JSON.parse(Buffer.concat(chunks).toString());
  if (oversizedResponse) { res.end(Buffer.alloc(1048577)); return; }
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const result = {
    uid: process.getuid(), gid: process.getgid(),
    hostSecretReadable: secretPath ? fs.existsSync(secretPath) : null,
    hostSecretEnvironmentPresent: Boolean(process.env.BILLBOARD_TEST_SIGNER_SECRET),
    dockerSocketPresent: fs.existsSync('/var/run/docker.sock'),
    rootWritable: canWrite('/should-not-write'),
    modelWritable: canWrite('/model/model.gguf'),
    tmpWritable: canWrite('/tmp/probe'),
    noNewPrivileges: /^NoNewPrivs:\s+1$/m.test(status),
    noEffectiveCapabilities: /^CapEff:\s+0+$/m.test(status),
    noDefaultRoute: !fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1).some(line => line.trim().split(/\s+/)[1] === '00000000'),
    hostEgressAvailable: await canConnect(egressHost, egressPort),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Location', 'https://example.invalid/');
  res.setHeader('Set-Cookie', 'probe=not-a-secret');
  res.end(JSON.stringify(result));
}).listen(8080, '0.0.0.0');
