// Fixed-route transport into an isolated model network. No credentials or SDK.
const http = require('node:http');
const MAX_REQUEST = 65536;
const MAX_RESPONSE = 1048576;
const server = http.createServer((request, response) => {
  let upstream;
  let deadline;
  const cancel = () => { clearTimeout(deadline); upstream?.destroy(); };
  request.once('error', () => { cancel(); response.destroy(); });
  request.once('aborted', () => { cancel(); response.destroy(); });
  response.once('close', cancel);
  if (!((request.method === 'GET' && request.url === '/health') ||
    (request.method === 'POST' && request.url === '/v1/chat/completions'))) {
    response.writeHead(404); response.end('Unsupported model route'); return;
  }
  let size = 0;
  const chunks = [];
  // A total deadline also bounds a peer that continuously trickles bytes.
  deadline = setTimeout(() => {
    upstream?.destroy();
    if (!response.writableEnded) { response.writeHead(504); response.end('Model deadline exceeded'); }
    request.destroy();
  }, 120000);
  request.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_REQUEST) { response.writeHead(413); response.end('Request too large'); request.destroy(); }
    else chunks.push(chunk);
  });
  request.on('end', () => {
    if (size > MAX_REQUEST) return;
    upstream = http.request({ hostname: 'model', port: 8080, path: request.url,
      method: request.method, headers: { 'Content-Type': 'application/json', 'Content-Length': size },
      timeout: 120000 }, reply => {
      let total = 0;
      const parts = [];
      reply.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_RESPONSE) { reply.destroy(); upstream.destroy(); response.writeHead(502); response.end('Model response too large'); }
        else parts.push(chunk);
      });
      reply.on('end', () => {
        if (response.writableEnded) return;
        response.writeHead(reply.statusCode, { 'Content-Type': 'application/json' });
        response.end(Buffer.concat(parts));
      });
      reply.on('error', () => { if (!response.writableEnded) { response.writeHead(502); response.end('Model response failed'); } });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Model response timeout')));
    upstream.on('error', () => { if (!response.writableEnded) { response.writeHead(502); response.end('Model unavailable'); } });
    upstream.end(Buffer.concat(chunks));
  });
});
server.requestTimeout = 125000;
server.headersTimeout = 10000;
server.maxConnections = 8;
server.on('connect', (_, socket) => socket.destroy());
server.listen(8080, '0.0.0.0');
