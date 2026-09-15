// ============================================================
// test_daemon.mjs — Integration tests for daemon orchestration
// ============================================================
//
// Tests the daemon's orchestration logic (post processing, CLI
// wrapping, verdict handling) using:
//   - A mock llama-server on an OS-assigned loopback port
//   - A mock Node CLI with disposable wallet/configuration fixtures
//   - An explicit imported test harness; production has no isolation bypass
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
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-daemon-tests-'));
const POLICY_VERSION = '0x' + '09'.padStart(64, '0');
const OTHER_POLICY_VERSION = '0x' + '0a'.padStart(64, '0');
const MOCK_WALLET = path.join(TEST_ROOT, 'disposable-wallet.json');
fs.writeFileSync(MOCK_WALLET, '{}');
const MOCK_FEES = path.join(TEST_ROOT, 'private-fees.json');
fs.writeFileSync(MOCK_FEES, '{}');
process.once('exit', () => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

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
    this.policies = [];
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
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
            const actualPost = JSON.parse(userPrompt.slice(userPrompt.indexOf('\n') + 1)).post;
            this.requests.push(actualPost);
            this.policies.push(JSON.parse(userPrompt.slice(userPrompt.indexOf('\n') + 1)).policy);
            const resp = this.responses(actualPost);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{
                finish_reason: resp.finish_reason || 'stop',
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
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.port = this.server.address().port; resolve(); });
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
    this.callsFile = this.scriptPath + '.calls.jsonl';
    fs.writeFileSync(this.callsFile, '');
    this._writeScript();
  }

  _writeScript() {
    const self = this;
    const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const action = args[0];
fs.appendFileSync(${JSON.stringify(this.callsFile)}, JSON.stringify(args) + \"\\n\");

if (action === 'list' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({
    count: ${JSON.stringify(this.behavior.posts.length)},
    posts: ${JSON.stringify(this.behavior.posts.map(post => ({ policyVersion: this.behavior.policyVersion ?? POLICY_VERSION, flagDeadline: String((post.timestamp ?? Math.floor(Date.now() / 1000)) + (this.behavior.censorWindow ?? 3600)), ...post, postId: '0x' + BigInt(post.index + 101).toString(16).padStart(64, '0') })))},
    censor: "0x000fdd755b5c59a56e6957dbcff8889fe9e5f3c5d6496426c9efcbed92ebb77a",
    kMultiplier: 4,
    censorWindow: ${JSON.stringify(this.behavior.censorWindow || 3600)},
    maxSaveUp: ${JSON.stringify(this.behavior.maxSaveUp || 16)},
    policy: ${JSON.stringify(this.behavior.policy ?? 'No spam')},
    policyVersion: ${JSON.stringify(this.behavior.policyVersion ?? POLICY_VERSION)}
  }));
} else if (action === 'declare-immoral') {
  if (${JSON.stringify(this.behavior.flagExit || 0)}) process.exit(${JSON.stringify(this.behavior.flagExit || 0)});
  const idx = args[args.indexOf('--post-id') + 1];
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

  calls() { return fs.readFileSync(this.callsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

  cleanup() {
    try { fs.unlinkSync(this.callsFile); } catch {}
    try { fs.unlinkSync(this.scriptPath); } catch {}
  }
}

// ============================================================
// Run daemon as subprocess with mock infra (async, non-blocking)
// ============================================================
function runDaemon(args, timeoutMs = 30000, { production = false, stopAfterMs, omitFeeConfig = false, omitEthRpc = false } = {}) {
  // Explicit test-only harness injects mock runtime. Production has no CLI/env
  // bypass for model isolation, and this harness uses only disposable fixtures.
  const productionArgs = [...(omitEthRpc ? [] : ['--eth-rpc', 'http://127.0.0.1:8545']), ...(omitFeeConfig ? [] : ['--private-fee-config', MOCK_FEES])];
  for (let i = 0; i < args.length; i++) {
    if (!production && args[i] === '--skip-bootstrap') continue;
    if (!production && args[i] === '--model') { i++; continue; }
    productionArgs.push(args[i]);
  }
  const moduleUrl = new URL('./daemon.mjs', import.meta.url).href;
  const harness = `import {runDaemon} from ${JSON.stringify(moduleUrl)};
    await runDaemon(process.argv.slice(1), {startRuntime: async config => ({port:config.port, stop:async()=>{}})});`;
  return new Promise((resolve) => {
    const childArgs = production ? [path.join(__dirname, 'daemon.mjs'), ...productionArgs] : ['--input-type=module', '-e', harness, '--', ...productionArgs];
    const child = spawn(process.execPath, childArgs, {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL',
    });
    const stopTimer = stopAfterMs ? setTimeout(() => child.kill('SIGTERM'), stopAfterMs) : undefined;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code, signal) => {
      clearTimeout(stopTimer);
      resolve({ stdout, stderr, exitCode: code === null ? 1 : code, signal });
    });
    child.on('error', (error) => {
      resolve({ stdout, stderr: stderr + error.message, exitCode: 1 });
    });
  });
}

// ============================================================
// Tests
// ============================================================
async function main() {
  console.log('=== Daemon Integration Tests (with mock infra) ===\n');

  const MOCK_PORT = 0;
  const MOCK_CLI = path.join(TEST_ROOT, 'test_mock_cli.cjs');

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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
      assertFalse(mockCli.calls().some(args => args[0] === 'declare-immoral'), 'dry-run must not execute a flag');
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
  await test('reasoning-only model output is an observable failure and cannot flag', async () => {
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.exitCode !== 0, 'reasoning-only output must remain unresolved');
      assertFalse(result.stdout.includes('Would flag'), 'reasoning text cannot authorize a flag');
      assertTrue(result.stdout.includes('moderation/signing error'), 'unresolved response must be observable');
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
      '--censor-wallet', MOCK_WALLET,
      '--cli', MOCK_CLI,
      '--llama-port', '5090',
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Flagging post'),
        'should flag post in non-dry-run mode');
      assertTrue(result.stdout.includes('flagged'),
        'should confirm flagging');
      const signed = mockCli.calls().filter(args => args[0] === 'declare-immoral');
      for (const argv of signed) {
        assertEqual(argv[argv.indexOf('--private-fee-config') + 1], fs.realpathSync(MOCK_FEES), 'fixed fee config reaches CLI');
        assertFalse(argv.includes('--private-fee-claim-file'), 'no repeated bridge claim');
        assertEqual(argv[argv.indexOf('--eth-rpc') + 1], 'http://127.0.0.1:8545/', 'fixed Ethereum RPC reaches CLI');
      }
      assertEqual(signed.length, 1, 'one actual mock flag call');
      assertEqual(signed[0][signed[0].indexOf('--expected-policy-version') + 1], POLICY_VERSION, 'exact policy version reaches signing CLI');
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
    const onChainPolicy = '  1. No spam\n2. No violence\n3. No illegal content\n ';
    const mockCli = new MockCli(MOCK_CLI, { posts, policy: onChainPolicy });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    try {
      const result = await runDaemon([
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.stdout.includes('Policy from contract'),
        'should indicate policy was read from contract');
      // Verify the mock server received the on-chain policy in the prompt
      assertEqual(mockServer.requests.length, 1, 'should call LLM once');
      assertEqual(mockServer.policies[0], onChainPolicy, 'policy bytes must not be trimmed or normalized');
    } finally {
      await mockServer.stop();
      mockCli.cleanup();
    }
  });

  // Test 11: Falls back to local policy file when contract has no policy
  await test('rejects a local policy override instead of signing with fallback text', async () => {
    const posts = [
      { index: 0, text: 'Hello', flagged: false },
    ];
    // No policy in contract output (empty string)
    const mockCli = new MockCli(MOCK_CLI, { posts, policy: '' });
    const mockServer = new MockLlamaServer(MOCK_PORT, () => ({ content: 'OK' }));
    await mockServer.start();

    // Create a temporary policy file
    const tmpPolicy = path.join(TEST_ROOT, 'test_tmp_policy.txt');
    fs.writeFileSync(tmpPolicy, 'Local fallback policy: no spam');

    try {
      const result = await runDaemon([
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
        '--policy', tmpPolicy,
        '--dry-run',
        '--once',
        '--skip-bootstrap',
        '--model', path.join(__dirname, 'test_dummy_model.gguf'),
      ]);

      assertTrue(result.exitCode !== 0, 'local override must fail closed');
      assertEqual(mockServer.requests.length, 0, 'no moderation with fallback policy');
      assertFalse(mockCli.calls().some(args => args[0] === 'declare-immoral'), 'no signing');
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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
        '--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET,
        '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port),
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

  await test('model cannot add a destination, operation or post index to a verdict', async () => {
    const mockCli = new MockCli(MOCK_CLI, { posts: [{ index: 0, text: 'A post', flagged: false }] });
    const mockServer = new MockLlamaServer(0, () => ({ content: JSON.stringify({
      isViolation: true, reason: 'Spam', operation: 'transfer-censor', postIndex: 123,
      destination: '0x' + 'ff'.repeat(20),
    }) }));
    await mockServer.start();
    try {
      const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET, '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port), '--once']);
      assertTrue(result.exitCode !== 0, 'malformed verdict must fail observably');
      assertTrue(result.stdout.includes('INVALID_VERDICT'), 'expected structured error code');
      assertFalse(mockCli.calls().some(args => args[0] !== 'list'), 'model cannot authorize any operation');
    } finally { await mockServer.stop(); mockCli.cleanup(); }
  });

  await test('failed signing is not reported as a completed successful job', async () => {
    const mockCli = new MockCli(MOCK_CLI, { posts: [{ index: 0, text: 'Spam', flagged: false }], flagExit: 7 });
    const mockServer = new MockLlamaServer(0, () => ({ content: 'VIOLATION - 1 - Spam' }));
    await mockServer.start();
    try {
      const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET, '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port), '--once']);
      assertTrue(result.exitCode !== 0, 'signing failure must cause unsuccessful one-shot exit');
      assertFalse(result.stdout.includes('Post #0 flagged.'), 'failed signing cannot be logged as successful');
      assertTrue(result.stdout.includes('Signer declare-immoral failed (7)'), 'bounded failure status must be observable');
    } finally { await mockServer.stop(); mockCli.cleanup(); }
  });

  await test('production CLI cannot bypass model isolation with skip-bootstrap', async () => {
    const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20),
      '--censor-wallet', MOCK_WALLET, '--skip-bootstrap', '--once'], 30000, { production: true });
    assertTrue(result.exitCode !== 0, 'unsupported isolation bypass must fail');
    assertTrue(result.stdout.includes('managed isolated model runtime'), 'operator receives migration guidance');
  });

  for (const [label, behavior, diagnostic] of [
    ['old post policy', { posts: [{ index: 0, text: 'Spam', flagged: false, policyVersion: OTHER_POLICY_VERSION }] }, 'HISTORICAL_POLICY_UNAVAILABLE'],
    ['empty contract policy', { posts: [{ index: 0, text: 'Spam', flagged: false }], policy: '' }, 'Invalid policy'],
  ]) {
    await test(label + ' fails closed without model or signer action', async () => {
      const mockCli = new MockCli(MOCK_CLI, behavior);
      const mockServer = new MockLlamaServer(0, () => ({ content: 'VIOLATION - 1 - Spam' }));
      await mockServer.start();
      try {
        const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20),
          '--censor-wallet', MOCK_WALLET, '--cli', MOCK_CLI,
          '--llama-port', String(mockServer.port), '--once']);
        assertTrue(result.exitCode !== 0, 'unavailable matching policy cannot complete job');
        assertTrue(result.stdout.includes(diagnostic), 'clear policy diagnostic');
        assertEqual(mockServer.requests.length, 0, 'model must not see mismatched policy');
        assertFalse(mockCli.calls().some(args => args[0] === 'declare-immoral'), 'no signing');
      } finally { await mockServer.stop(); mockCli.cleanup(); }
    });
  }

  await test('each poll refreshes exact policy before processing its matching new posts', async () => {
    const mockCli = new MockCli(MOCK_CLI, { posts: [] });
    const policies = [' First policy \n', '\n Second policy  '];
    const versions = [POLICY_VERSION, OTHER_POLICY_VERSION];
    const responses = policies.map((policy, i) => ({ count: i + 1, policy, policyVersion: versions[i],
      censorWindow: 3600, maxSaveUp: 16, posts: [{ index: i,
        postId: '0x' + BigInt(i + 501).toString(16).padStart(64, '0'), policyVersion: versions[i],
        flagDeadline: String(Math.floor(Date.now() / 1000) + 3600), text: 'Spam ' + i, flagged: false }] }));
    fs.writeFileSync(MOCK_CLI, `const fs = require('fs');
      const args = process.argv.slice(2);
      const file = ${JSON.stringify(mockCli.callsFile)};
      const previous = fs.readFileSync(file,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
      fs.appendFileSync(file, JSON.stringify(args)+'\\n');
      if(args[0]==='list') {
        const count = previous.filter(a=>a[0]==='list').length;
        process.stdout.write(JSON.stringify(${JSON.stringify(responses)}[Math.min(count,1)]));
      } else process.stdout.write('Transaction mined');`);
    const mockServer = new MockLlamaServer(0, () => ({ content: 'VIOLATION - 1 - Spam' }));
    await mockServer.start();
    try {
      const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20),
        '--censor-wallet', MOCK_WALLET, '--cli', MOCK_CLI,
        '--llama-port', String(mockServer.port), '--poll-interval', '1'], 10000, { stopAfterMs: 2400 });
      assertEqual(result.exitCode, 0, 'graceful shutdown after multiple polls');
      assertEqual(mockServer.policies.length, 2, 'two new posts processed');
      policies.forEach((policy, i) => assertEqual(mockServer.policies[i], policy, 'fresh exact policy ' + i));
      const calls = mockCli.calls().filter(args => args[0] === 'declare-immoral');
      assertEqual(calls.length, 2, 'both matching posts flagged');
      calls.forEach((args, i) => assertEqual(args[args.indexOf('--expected-policy-version') + 1], versions[i], 'snapshot policy reaches signer'));
    } finally { await mockServer.stop(); mockCli.cleanup(); }
  });

  await test('private fee configuration is mandatory at daemon startup', async () => {
    const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20)], 5000, { omitFeeConfig: true });
    assertTrue(result.exitCode !== 0, 'startup must fail');
    assertTrue((result.stdout + result.stderr).includes('--private-fee-config is required'), 'bounded configuration error');
  });

  await test('Ethereum endpoint is mandatory at daemon startup', async () => {
    const result = await runDaemon(['--portal-address', '0x' + '12'.repeat(20)], 5000, { omitEthRpc: true });
    assertTrue(result.exitCode !== 0, 'startup must fail');
    assertTrue((result.stdout + result.stderr).includes('--eth-rpc is required'), 'bounded endpoint error');
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
