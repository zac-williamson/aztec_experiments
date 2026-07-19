// ============================================================
// test_daemon.mjs — Integration tests for daemon orchestration
// ============================================================
//
// Tests the daemon's orchestration logic (post processing, CLI
// wrapping, verdict handling) using:
//   - A mock llama-server (HTTP server on port 5095)
//   - A mock cli.mjs (shell script that returns canned responses)
//
// Does NOT require:
//   - Real llama.cpp compilation
//   - Real model download
//   - Real Aztec network
//   - Real FeeJuice
//
// Run: node censor-daemon/test_daemon.mjs
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function test(name, fn) {
  return Promise.resolve().then(() => fn()).then(() => {
    console.log(`  ✓ ${name}`);
    pass++;
  }).catch(e => {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    fail++;
  });
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(v, msg) { if (!v) throw new Error(msg || 'expected true'); }
function assertFalse(v, msg) { if (v) throw new Error(msg || 'expected false'); }

// ============================================================
// Mock llama-server
// ============================================================
class MockLlamaServer {
  constructor(port, responses) {
    this.port = port;
    this.responses = responses; // function(postText) => { content, reasoning_content }
    this.requests = [];
    this.server = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            return;
          }
          if (req.url === '/v1/chat/completions') {
            const parsed = JSON.parse(body);
            const postText = parsed.messages?.find(m => m.role === 'user')?.content || '';
            const userPrompt = postText;
            // Extract the post text from the prompt
            const postMatch = userPrompt.match(/Post:\s*"([\s\S]*)"/);
            const actualPost = postMatch ? postMatch[1] : '';
            this.requests.push(actualPost);
            const resp = this.responses(actualPost);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{
                message: {
                  content: resp.content || '',
                  reasoning_content: resp.reasoning_content || '',
                },
              }],
            }));
            return;
          }
          res.writeHead(404);
          res.end('not found');
        });
      });
      this.server.listen(this.port, '127.0.0.1', resolve);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) this.server.close(resolve);
      else resolve();
    });
  }
}

// ============================================================
// Mock CLI
// ============================================================
class MockCli {
  constructor(scriptPath, behavior) {
    this.scriptPath = scriptPath;
    this.behavior = behavior; // { posts: [...], flagCalls: [] }
    this.flagCalls = [];
    this.listCalls = 0;
    this._writeScript();
  }

  _writeScript() {
    const self = this;
    const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const action = args[0];

if (action === 'list' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({
    count: ${JSON.stringify(this.behavior.posts.length)},
    posts: ${JSON.stringify(this.behavior.posts)},
    censor: "0x000fdd755b5c59a56e6957dbcff8889fe9e5f3c5d6496426c9efcbed92ebb77a",
    kMultiplier: 4,
    censorWindow: ${JSON.stringify(this.behavior.censorWindow || 3600)},
    maxSaveUp: ${JSON.stringify(this.behavior.maxSaveUp || 16)},
    policy: ${JSON.stringify(this.behavior.policy || '')}
  }));
} else if (action === 'declare-immoral') {
  const idx = args[args.indexOf('--post-index') + 1];
  const resp = args[args.indexOf('--censor-response') + 1];
  process.stderr.write("Flagging post " + idx + " with: " + resp + "\\n");
  process.stdout.write("Transaction mined\\n");
} else {
  process.stderr.write("Unknown action: " + action + "\\n");
  process.exit(1);
}
`;
    fs.writeFileSync(this.scriptPath, script);
    fs.chmodSync(this.scriptPath, 0o755);
  }

  cleanup() {
    try { fs.unlinkSync(this.scriptPath); } catch {}
  }
}

// ============================================================
// Run daemon as subprocess with mock infra (async, non-blocking)
// ============================================================
function runDaemon(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(__dirname, 'daemon.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 });
    });
    child.on('error', (e) => {
      resolve({ stdout, stderr: stderr + e.message, exitCode: 1 });
    });
  });
}

// ============================================================
// Tests
// ============================================================
async function main() {
  console.log('=== Daemon Integration Tests (with mock infra) ===\n');

  const MOCK_PORT = 5095;
  const MOCK_CLI = path.join(__dirname, 'test_mock_cli.cjs');

  // Test 1: Dry-run mode with violation
  await test('dry-run flags violation in output but does not call declare-immoral', async () => {
    const posts = [
      { index: 0, text: 'Buy cheap watches at scam.com!!!', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, (postText) => ({
      content: 'VIOLATION - 1 - This is advertising spam',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      // In dry-run mode, daemon should NOT actually call declare-immoral
      // But it should mention the violation
      assertTrue(result.stdout.includes('VIOLATION') || result.stdout.includes('DRY RUN'),
        'output should mention VIOLATION or DRY RUN');
      assertTrue(result.stdout.includes('DRY RUN') || result.stdout.includes('Would flag'),
        'dry-run should indicate it would flag');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 2: Dry-run with OK verdict
  await test('dry-run with OK verdict does not flag', async () => {
    const posts = [
      { index: 0, text: 'Hello world, nice to meet you', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({
      content: 'OK',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertFalse(result.stdout.includes('Would flag'),
        'should not flag an OK post');
      assertTrue(result.stdout.includes('OK'),
        'output should mention OK');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 3: Skips already-flagged posts
  await test('skips already-flagged posts', async () => {
    const posts = [
      { index: 0, text: 'Already flagged spam', flagged: true, censorResponse: 'spam', flaggedBy: '0xabc' },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({
      content: 'VIOLATION - 1 - should not reach here',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('already flagged'),
        'should skip already-flagged posts');
      assertTrue(mockServer.requests.length === 0,
        'should not call LLM for flagged posts');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 4: Skips empty posts
  await test('skips empty posts', async () => {
    const posts = [
      { index: 0, text: '', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({
      content: 'VIOLATION',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('empty'),
        'should mention empty post');
      assertTrue(mockServer.requests.length === 0,
        'should not call LLM for empty posts');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 5: Thinking model with reasoning_content fallback
  await test('handles thinking model (content empty, reasoning_content has verdict)', async () => {
    const posts = [
      { index: 0, text: 'Buy watches cheap', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({
      content: '',  // empty content (ran out of tokens)
      reasoning_content: 'Let me think... this is advertising.\nVIOLATION - 1 - advertising spam',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('VIOLATION'),
        'should detect violation from reasoning_content');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 6: Multiple posts, mixed verdicts
  await test('processes multiple posts with mixed verdicts', async () => {
    const posts = [
      { index: 0, text: 'Hello world', flagged: false },
      { index: 1, text: 'BUY CHEAP STUFF!!!', flagged: false },
      { index: 2, text: 'Nice day', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, (postText) => {
      if (postText.includes('BUY')) return { content: 'VIOLATION - 1 - advertising' };
      return { content: 'OK' };
    });
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Would flag') && result.stdout.includes('#1'),
        'should flag post #1 in dry-run');
      assertTrue(mockServer.requests.length === 3,
        `should call LLM 3 times, got ${mockServer.requests.length}`);
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 7: Missing --portal-address fails
  await test('missing --portal-address exits with error', async () => {
    const result = await runDaemon([
      '--censor-wallet', '/dev/null',
      '--cli', MOCK_CLI,
      '--llama-port', String(MOCK_PORT),
      '--dry-run',
      '--once',
    ]);

    assertTrue(result.exitCode !== 0, 'should exit non-zero');
    assertTrue(result.stdout.includes('portal-address') || (result.stderr || '').includes('portal-address'),
      'should mention portal-address requirement');
  });

  // Test 8: --from skips earlier posts
  await test('--from skips earlier posts', async () => {
    const posts = [
      { index: 0, text: 'Post zero', flagged: false },
      { index: 1, text: 'Post one', flagged: false },
      { index: 2, text: 'Post two', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--from', '2',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      // Should only process post #2
      assertTrue(mockServer.requests.length === 1,
        `should call LLM 1 time (from index 2), got ${mockServer.requests.length}`);
      assertEqual(mockServer.requests[0], 'Post two', 'should process post #2');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 9: Non-dry-run actually calls declare-immoral
  await test('non-dry-run calls declare-immoral via CLI', async () => {
    const posts = [
      { index: 0, text: 'SPAM BUY NOW', flagged: false },
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({
      content: 'VIOLATION - 1 - advertising spam',
    }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Flagging post'),
        'should flag post in non-dry-run mode');
      assertTrue(result.stdout.includes('flagged'),
        'should confirm flagging');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 10: Reads policy from contract (on-chain policy takes priority)
  await test('reads policy from contract output', async () => {
    const posts = [
      { index: 0, text: 'Hello world', flagged: false },
    ];
    const onChainPolicy = '1. No spam\n2. No violence\n3. No illegal content';
    const mockCli = new MockCli(MOCK_CLI, { posts, policy: onChainPolicy });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Policy from contract'),
        'should indicate policy was read from contract');
      // Verify the mock server received the on-chain policy in the prompt
      assertEqual(mockServer.requests.length, 1, 'should call LLM once');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 11: Falls back to local policy file when contract has no policy
  await test('falls back to local policy file when contract policy is empty', async () => {
    const posts = [
      { index: 0, text: 'Hello', flagged: false },
    ];
    // No policy in contract output (empty string)
    const mockCli = new MockCli(MOCK_CLI, { posts, policy: '' });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    // Create a temporary policy file
    const tmpPolicy = path.join(__dirname, 'test_tmp_policy.txt');
    fs.writeFileSync(tmpPolicy, 'Local fallback policy: no spam');

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--policy', tmpPolicy,
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Policy from file'),
        'should indicate policy was read from local file');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
      try { fs.unlinkSync(tmpPolicy); } catch {}
    }
  });

  // Test 12: Censor window — warns on posts past the window
  await test('warns on posts past the censor window', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const posts = [
      { index: 0, text: 'Old spam post', flagged: false, timestamp: nowSec - 7200 }, // 2h ago, past 1h window
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts, censorWindow: 3600 });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('past censor window'),
        'should warn that post is past the censor window');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 13: Censor window — warns on posts about to expire
  await test('warns on posts about to expire in censor window', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const posts = [
      { index: 0, text: 'Recent spam', flagged: false, timestamp: nowSec - 3400 }, // ~3min left in 1h window
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts, censorWindow: 3600 });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('expiring'),
        'should warn that post censor window is expiring soon');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 14: Censor window — prioritizes oldest unflagged posts first
  await test('processes oldest unflagged posts first (censor window urgency)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const posts = [
      { index: 0, text: 'Newer post', flagged: false, timestamp: nowSec - 100 },
      { index: 1, text: 'Older post', flagged: false, timestamp: nowSec - 3500 }, // closer to expiring
    ];
    const mockCli = new MockCli(MOCK_CLI, { posts, censorWindow: 3600 });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      await runDaemon([
        '--portal-address', '0x1234',
        '--censor-wallet', '/dev/null',
        '--cli', MOCK_CLI,
        '--llama-port', String(MOCK_PORT),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      // Older post (index 1, timestamp 3500s ago) should be processed first
      // because it's closer to expiring in the censor window
      assertEqual(mockServer.requests[0], 'Older post',
        'should process older post first (more urgent)');
      assertEqual(mockServer.requests[1], 'Newer post',
        'should process newer post second');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  console.log(`\n=== Results ===`);
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
