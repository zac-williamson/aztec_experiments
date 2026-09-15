#!/usr/bin/env node
// Host orchestrator. Production model execution always uses the isolated runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { moderatePost } from './moderation.mjs';
import { createSigner } from './signer.mjs';
import { startModelRuntime } from './model-runtime.mjs';
import { assertNodeVersion } from '../scripts/toolchain.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const flags = new Set(['dry-run', 'once']);
const values = new Set(['portal-address', 'censor-wallet', 'policy', 'llama-port',
  'poll-interval', 'from', 'ctx-size', 'threads', 'node-url', 'model', 'cli',
  'model-image', 'model-sha256', 'private-fee-config', 'eth-rpc']);
function parseArgs(argv) {
  const args = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error('Unexpected positional daemon argument');
    const name = token.slice(2);
    if (name === 'skip-bootstrap' || name === 'keep-server') {
      throw new Error('--' + name + ' is unsupported: production requires a managed isolated model runtime');
    }
    if ((!flags.has(name) && !values.has(name)) || Object.hasOwn(args, name)) throw new Error('Unknown or duplicate daemon option: --' + name);
    if (flags.has(name)) args[name] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Missing value for --' + name);
      args[name] = argv[++i];
    }
  }
  return args;
}
function integer(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Invalid ' + label);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('Invalid ' + label);
  return number;
}
function configuration(argv) {
  const args = parseArgs(argv);
  if (args.policy) throw new Error('--policy is unsupported: moderation requires the exact contract policy');
  if (!args['portal-address']) throw new Error('--portal-address is required');
  if (!args['eth-rpc']) throw new Error('--eth-rpc is required');
  if (!args['private-fee-config']) throw new Error('--private-fee-config is required');
  return Object.freeze({
    portalAddress: args['portal-address'],
    privateFeeConfig: path.resolve(args['private-fee-config']),
    ethRpcUrl: args['eth-rpc'],
    censorWallet: path.resolve(args['censor-wallet'] || path.join(root, 'wallets/censor_aztec_wallet.json')),
    cliPath: path.resolve(args.cli || path.join(root, 'apps/src/billboard/user/cli.mjs')),
    aztecNodeUrl: args['node-url'] || 'http://127.0.0.1:5080',
    llamaPort: integer(args['llama-port'], 5090, 1024, 65535, 'model port'),
    pollInterval: integer(args['poll-interval'], 30, 1, 3600, 'poll interval'),
    fromIndex: integer(args.from, 0, 0, 0xffffffff, 'starting post index'),
    ctxSize: integer(args['ctx-size'], 4096, 512, 32768, 'context size'),
    threads: integer(args.threads, 4, 1, 16, 'model threads'),
    dryRun: Boolean(args['dry-run']), once: Boolean(args.once),
    modelPath: args.model ? path.resolve(args.model) : undefined,
    modelImage: args['model-image'], modelSha256: args['model-sha256'],
  });
}
function log(message, level = 'info') {
  const safe = String(message).replace(/[\u0000-\u001f\u007f-\u009f]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  console.log(`[${new Date().toISOString()}] [${level}] ${safe}`);
}
function remainingWindow(post, now) {
  return BigInt(post.flagDeadline) - BigInt(now);
}

// The injected runtime is a programmatic test seam. Production CLI arguments and
// environment variables cannot replace it with an arbitrary external endpoint.
export async function runDaemon(argv = process.argv.slice(2), { startRuntime = startModelRuntime } = {}) {
  assertNodeVersion();
  const config = configuration(argv);
  const signer = createSigner({ cliPath: config.cliPath, censorWallet: config.censorWallet,
    portalAddress: config.portalAddress, aztecNodeUrl: config.aztecNodeUrl, privateFeeConfig: config.privateFeeConfig, ethRpcUrl: config.ethRpcUrl });
  if (config.modelPath && fs.existsSync(config.modelPath) &&
      fs.realpathSync(config.modelPath) === fs.realpathSync(config.censorWallet)) {
    throw new Error('Model and signer wallet must be different files');
  }
  let runtime;
  let stopping = false;
  const wait = new AbortController();
  const shutdown = () => { stopping = true; wait.abort(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try {
    log('Starting isolated model runtime; signer configuration fixed at startup.');
    runtime = await startRuntime({ image: config.modelImage, modelPath: config.modelPath,
      modelSha256: config.modelSha256, port: config.llamaPort, threads: config.threads, ctxSize: config.ctxSize });
    let nextIndex = config.fromIndex;
    const completed = new Set();
    async function processPost(post, data) {
      const idx = post.index;
      if (post.flagged) { log('#' + idx + ' already flagged, skipping.'); return; }
      if (post.policyVersion !== data.policyVersion) {
        throw Object.assign(new Error('Historical policy unavailable for this post; event-backed policy retrieval is required'), { code: 'HISTORICAL_POLICY_UNAVAILABLE' });
      }
      if (!post.text.trim()) { log('#' + idx + ' (empty), skipping.'); return; }
      const verdict = await moderatePost(post.text, data.policy, runtime.port);
      log('#' + idx + ' LLM: ' + (verdict.isViolation ? 'VIOLATION' : 'OK'));
      if (!verdict.isViolation) return;
      if (config.dryRun) { log('[DRY RUN] Would flag post #' + idx, 'warn'); return; }
      log('Flagging post #' + idx + ' via restricted signer.');
      // The index comes from validated fetched data, never from model output.
      signer.flag({ postId: post.postId, policyVersion: post.policyVersion, reason: verdict.reason });
      log('Post #' + idx + ' flagged.');
    }
    async function pollAndProcess() {
      let data;
      try { data = signer.list(); }
      catch (error) { log('Failed to fetch posts: ' + error.message, 'error'); return false; }
      log('Policy from contract (' + data.policy.length + ' chars), version ' + data.policyVersion);
      const now = Math.floor(Date.now() / 1000);
      const pending = data.posts.filter(post => post.index >= nextIndex && !completed.has(post.index));
      pending.sort((a, b) => {
        const first = BigInt(a.flagDeadline), second = BigInt(b.flagDeadline);
        return first < second ? -1 : first > second ? 1 : 0;
      });
      let succeeded = true;
      for (const post of pending) {
        if (stopping) break;
        const remaining = remainingWindow(post, now);
        if (remaining !== null && remaining < 0) log('#' + post.index + ' past censor window; flag may be too late', 'warn');
        else if (remaining !== null && remaining < 300) log('#' + post.index + ' censor window expiring', 'warn');
        try {
          await processPost(post, data);
          completed.add(post.index);
          while (completed.delete(nextIndex)) nextIndex++;
        } catch (error) {
          succeeded = false;
          log('#' + post.index + ' moderation/signing error: ' + (error.code || 'FAILED') + ': ' + error.message, 'error');
          // Do not advance beyond failed work. Durable state/retries are M02.
        }
      }
      return succeeded;
    }
    do {
      const succeeded = await pollAndProcess();
      if (config.once) {
        if (!succeeded) throw new Error('One or more moderation jobs failed; no success was recorded for failed jobs');
        log('All posts processed (--once mode).');
        break;
      }
      if (!stopping) await delay(config.pollInterval * 1000, undefined, { signal: wait.signal }).catch(error => {
        if (error.name !== 'AbortError') throw error;
      });
    } while (!stopping);
  } finally {
    process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
    if (runtime) await runtime.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDaemon().catch(error => { log('FATAL: ' + error.message, 'error'); process.exitCode = 1; });
}
