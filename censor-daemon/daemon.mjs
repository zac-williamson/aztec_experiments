#!/usr/bin/env node
// ============================================================
// daemon.mjs — Auto-Censor Daemon for Billboard
// ============================================================
//
// Watches the Billboard contract for new posts and automatically
// flags any that violate the moderation policy, using a local
// LLM (llama.cpp + a small GGUF model).
//
// This is a thin orchestrator. It does NOT touch the Aztec SDK
// directly — it shells out to the existing user CLI (cli.mjs)
// as a black box for all on-chain operations:
//
//   - `node cli.mjs list --json`         → read all posts
//   - `node cli.mjs declare-immoral ...` → flag a post
//
// From ANY state, running this script will:
//   1. Download + compile llama.cpp (if not already present)
//   2. Download the GGUF model (if not already present)
//   3. Start llama-server (local OpenAI-compatible API on port 5090)
//   4. Poll the billboard via the CLI for new posts
//   5. Run the LLM on each unflagged post
//   6. Flag violations via the CLI's declare-immoral action
//
// Usage:
//   node daemon.mjs [options]
//
// Options:
//   --portal-address <addr>   L1 portal contract address (REQUIRED)
//   --censor-wallet <file>    Path to censor Aztec wallet JSON
//   --policy <file>           Path to moderation policy text file (default: policy.txt)
//   --llama-port <num>        Port for llama-server (default: 5090)
//   --poll-interval <sec>     Seconds between polls (default: 30)
//   --from <index>            Start processing from this post index (default: 0)
//   --ctx-size <num>          LLM context size (default: 4096)
//   --threads <num>           LLM threads (default: 4)
//   --node-url <url>          Aztec node URL
//   --model <url|path>        Model GGUF download URL or local path
//   --dry-run                 Evaluate posts but don't actually flag them
//   --once                    Process current posts once and exit (no polling)
//   --keep-server             Don't kill llama-server on exit
//   --cli <path>              Path to cli.mjs (default: ../apps/src/billboard/user/cli.mjs)
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { moderatePost, parseVerdict } from './moderation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proc = process; // save before bundle overrides

// ============================================================
// Arg parsing
// ============================================================
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = true;
    }
  }
  return args;
}
const args = parseArgs();

// ============================================================
// Config
// ============================================================
const PROJECT_ROOT = path.resolve(__dirname, '..');
const rpcConfigPath = path.join(PROJECT_ROOT, 'shared', 'rpc-config.json');
const rpcConfig = fs.existsSync(rpcConfigPath) ? JSON.parse(fs.readFileSync(rpcConfigPath, 'utf8')) : {};

const CONFIG = {
  aztecNodeUrl: args['node-url'] || rpcConfig.nodeUrl || 'https://v5.mainnet.rpc.aztec-labs.com',
  portalAddress: args['portal-address'] || null,
  censorWallet: args['censor-wallet'] || path.join(PROJECT_ROOT, 'wallets', 'censor_aztec_wallet.json'),
  policyFile: args['policy'] || path.join(__dirname, 'policy.txt'),
  llamaPort: parseInt(args['llama-port']) || 5090,
  pollInterval: parseInt(args['poll-interval']) || 30,
  fromIndex: parseInt(args['from']) || 0,
  ctxSize: parseInt(args['ctx-size']) || 4096,
  threads: parseInt(args['threads']) || 4,
  dryRun: !!args['dry-run'],
  once: !!args['once'],
  keepServer: !!args['keep-server'],
  skipBootstrap: !!args['skip-bootstrap'],
  cliPath: args['cli'] || path.join(PROJECT_ROOT, 'apps', 'src', 'billboard', 'user', 'cli.mjs'),

  // llama.cpp + model locations
  llamaDir: path.join(__dirname, 'llama.cpp'),
  llamaServerBin: path.join(__dirname, 'llama.cpp', 'build', 'bin', 'llama-server'),
  modelDir: path.join(__dirname, 'models'),
  modelUrl: null,
  modelPath: null,
};

// Resolve model: explicit local path, URL, or default
const DEFAULT_MODEL_URL = 'https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/resolve/main/Qwen_Qwen3.5-2B-Q4_K_M.gguf';
const DEFAULT_MODEL_NAME = 'Qwen_Qwen3.5-2B-Q4_K_M.gguf';
if (args['model'] && fs.existsSync(args['model'])) {
  CONFIG.modelPath = args['model'];
} else if (args['model'] && args['model'].startsWith('http')) {
  CONFIG.modelPath = path.join(CONFIG.modelDir, path.basename(args['model']));
  CONFIG.modelUrl = args['model'];
} else if (args['model']) {
  CONFIG.modelPath = path.join(CONFIG.modelDir, args['model']);
} else {
  CONFIG.modelPath = path.join(CONFIG.modelDir, DEFAULT_MODEL_NAME);
  CONFIG.modelUrl = DEFAULT_MODEL_URL;
}

// ============================================================
// Logging
// ============================================================
const COLORS = {
  info: '\x1b[37m', success: '\x1b[32m', warn: '\x1b[33m',
  error: '\x1b[31m', llm: '\x1b[36m', post: '\x1b[35m', dim: '\x1b[2m',
  reset: '\x1b[0m',
};
function log(msg, level) {
  const c = COLORS[level] || COLORS.info;
  console.log(`${c}[${new Date().toLocaleTimeString()}]${COLORS.reset} ${msg}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// Step 1: Ensure llama.cpp is compiled
// ============================================================
function ensureLlamaCpp() {
  if (fs.existsSync(CONFIG.llamaServerBin)) {
    log('llama.cpp already compiled', 'success');
    return;
  }

  log('Setting up llama.cpp...', 'warn');

  if (!fs.existsSync(CONFIG.llamaDir)) {
    log('  Cloning llama.cpp...', 'info');
    execSync(`git clone --depth 1 https://github.com/ggml-org/llama.cpp "${CONFIG.llamaDir}"`, {
      stdio: 'inherit', timeout: 120000,
    });
  }

  const buildDir = path.join(CONFIG.llamaDir, 'build');
  log('  Configuring with cmake (CPU-only)...', 'info');
  execSync(`cmake -S "${CONFIG.llamaDir}" -B "${buildDir}" -DGGML_CUDA=OFF -DGGML_BLAS=ON -DCMAKE_BUILD_TYPE=Release`, {
    stdio: 'inherit', timeout: 120000,
  });

  const nproc = Math.min(16, proc.env.NPROC || 8);
  log('  Building llama-server (may take a few minutes)...', 'info');
  execSync(`cmake --build "${buildDir}" --config Release --target llama-server -j ${nproc}`, {
    stdio: 'inherit', timeout: 600000,
  });

  if (!fs.existsSync(CONFIG.llamaServerBin)) {
    throw new Error('Build completed but llama-server binary not found');
  }
  log('  llama.cpp compiled successfully.', 'success');
}

// ============================================================
// Step 2: Ensure model is downloaded
// ============================================================
function ensureModel() {
  if (fs.existsSync(CONFIG.modelPath) && fs.statSync(CONFIG.modelPath).size > 1_000_000) {
    log(`Model present: ${path.basename(CONFIG.modelPath)} (${(fs.statSync(CONFIG.modelPath).size / 1e6).toFixed(1)} MB)`, 'success');
    return;
  }

  if (!CONFIG.modelUrl) {
    throw new Error('Model not found at ' + CONFIG.modelPath + ' and no download URL');
  }

  log('Downloading model from ' + CONFIG.modelUrl + '...', 'warn');
  if (!fs.existsSync(CONFIG.modelDir)) fs.mkdirSync(CONFIG.modelDir, { recursive: true });

  const tmpPath = CONFIG.modelPath + '.tmp';
  try {
    execSync(`curl -L --progress-bar -C - -o "${tmpPath}" "${CONFIG.modelUrl}"`, {
      stdio: 'inherit', timeout: 1800000,
    });
  } catch (e) {
    execSync(`wget -c -O "${tmpPath}" "${CONFIG.modelUrl}"`, {
      stdio: 'inherit', timeout: 1800000,
    });
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 1_000_000) {
    throw new Error('Model download failed or file too small');
  }
  fs.renameSync(tmpPath, CONFIG.modelPath);
  log(`  Model downloaded (${(fs.statSync(CONFIG.modelPath).size / 1e6).toFixed(1)} MB)`, 'success');
}

// ============================================================
// Step 3: Start llama-server
// ============================================================
let llamaProc = null;

async function isServerReady(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

async function startLlamaServer() {
  if (await isServerReady(CONFIG.llamaPort)) {
    log('llama-server already running on port ' + CONFIG.llamaPort, 'success');
    return;
  }

  if (CONFIG.skipBootstrap) {
    throw new Error('llama-server not running on port ' + CONFIG.llamaPort + ' and --skip-bootstrap is set');
  }

  log('Starting llama-server on port ' + CONFIG.llamaPort + '...', 'info');
  const serverArgs = [
    '--model', CONFIG.modelPath,
    '--port', String(CONFIG.llamaPort),
    '--host', '127.0.0.1',
    '--ctx-size', String(CONFIG.ctxSize),
    '--threads', String(CONFIG.threads),
    '--no-webui',
    '--flash-attn', 'on',
  ];

  llamaProc = spawn(CONFIG.llamaServerBin, serverArgs, {
    // stdin must be 'pipe' (not 'ignore'): newer llama.cpp builds treat
    // stdin EOF as a shutdown signal and exit immediately. A pipe stays
    // open for the lifetime of this process, keeping llama-server alive.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Stream important lines from llama-server stdout
  llamaProc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (t.includes('error') || t.includes('ERROR')) log('[llama-server] ' + t, 'error');
      else if (t.includes('model loaded') || t.includes('listening')) log('[llama-server] ' + t, 'success');
    }
  });
  llamaProc.stderr.on('data', (data) => {
    const t = data.toString().trim();
    if (t) log('[llama-server] ' + t, 'warn');
  });
  llamaProc.on('exit', (code) => {
    log('[llama-server] exited with code ' + code, 'warn');
    llamaProc = null;
  });

  log('  Waiting for model to load...', 'info');
  const maxWait = 120000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await isServerReady(CONFIG.llamaPort)) {
      log('  llama-server is ready!', 'success');
      return;
    }
    if (!llamaProc) throw new Error('llama-server process died during startup');
    await sleep(2000);
  }
  throw new Error('llama-server did not become ready within ' + (maxWait / 1000) + 's');
}

function stopLlamaServer() {
  if (!llamaProc) return;
  if (CONFIG.keepServer) {
    log('Keeping llama-server running (--keep-server).', 'info');
    return;
  }
  log('Stopping llama-server...', 'info');
  try { llamaProc.kill('SIGTERM'); } catch {}
  llamaProc = null;
}

// ============================================================
// CLI wrapper — call cli.mjs as a subprocess
// ============================================================
function cliBaseArgs() {
  if (!CONFIG.portalAddress) throw new Error('--portal-address is required');
  const a = ['--portal-address', CONFIG.portalAddress, '--censor-wallet', CONFIG.censorWallet];
  if (CONFIG.aztecNodeUrl !== 'https://v5.mainnet.rpc.aztec-labs.com') {
    a.push('--node-url', CONFIG.aztecNodeUrl);
  }
  return a;
}

function runCli(actionArgs) {
  const allArgs = [actionArgs[0], ...cliBaseArgs(), ...actionArgs.slice(1)];
  log('  $ node cli.mjs ' + allArgs.join(' '), 'dim');
  try {
    return execSync(`node "${CONFIG.cliPath}" ${allArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    throw new Error('CLI failed: ' + (e.message || '') + '\n' + out.substring(0, 500));
  }
}

function fetchPosts() {
  const stdout = runCli(['list', '--json']);
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{') && t.includes('"posts"')) return JSON.parse(t);
  }
  throw new Error('Could not find JSON output in CLI response');
}

function flagPost(postIndex, responseText) {
  runCli(['declare-immoral', '--post-index', String(postIndex), '--censor-response', responseText]);
}

// ============================================================
// Post processing
// ============================================================
async function processPost(post, policy) {
  const idx = post.index;

  if (post.flagged) {
    log('  #' + idx + ' already flagged, skipping.', 'dim');
    return;
  }

  const text = post.text || '';
  if (!text.trim()) {
    log('  #' + idx + ' (empty), skipping.', 'dim');
    return;
  }

  const preview = text.substring(0, 60).replace(/\n/g, ' ') + (text.length > 60 ? '...' : '');
  log('  #' + idx + ' evaluating: "' + preview + '"', 'post');

  const verdict = await moderatePost(text, policy, CONFIG.llamaPort);
  log('    LLM: ' + (verdict.isViolation ? 'VIOLATION' : 'OK') + ' — ' + verdict.reason.substring(0, 80), 'llm');

  if (!verdict.isViolation) return;

  const responseText = verdict.reason.substring(0, 200);
  if (CONFIG.dryRun) {
    log('    [DRY RUN] Would flag post #' + idx + ' with: "' + responseText + '"', 'warn');
    return;
  }

  log('    Flagging post #' + idx + ' via CLI...', 'warn');
  try {
    flagPost(idx, responseText);
    log('    ✅ Post #' + idx + ' flagged!', 'success');
  } catch (e) {
    log('    ❌ Failed to flag: ' + (e.message || e).substring(0, 200), 'error');
  }
}

// ============================================================
// Censor window helpers
// ============================================================
//
// The contract's censor_window (default 3600s) is the time the
// censor has to flag a post before screening locks in its flag
// status. The daemon uses this to:
//   1. Prioritize posts closest to expiring (oldest unflagged first)
//   2. Warn when a post is about to become screenable
//   3. Skip posts that are already past the window (flag is useless)
//
// Note: declare_immoral on-chain doesn't enforce the censor window —
// the censor can technically flag any post at any time. But flagging
// after screening has passed that post has no effect on the penalty,
// since the post's flag status was already read at screening time.
// The daemon still flags past-window violations (better late than
// never) but logs a warning.
//
function remainingWindow(post, censorWindow, nowSec) {
  if (!post.timestamp || !censorWindow) return null;
  return post.timestamp + censorWindow - nowSec;
}

function formatDuration(sec) {
  if (sec < 0) return '-' + Math.floor(-sec / 60) + 'm' + Math.floor((-sec % 60)) + 's';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + 'm' + s + 's';
}

// ============================================================
// Main
// ============================================================
async function main() {
  log('╔══════════════════════════════════════════════╗', 'info');
  log('║     Billboard Auto-Censor Daemon             ║', 'info');
  log('╚══════════════════════════════════════════════╝', 'info');
  log('  Aztec node:     ' + CONFIG.aztecNodeUrl, 'info');
  log('  Portal address: ' + (CONFIG.portalAddress || 'NOT SET'), 'info');
  log('  LLM port:       ' + CONFIG.llamaPort, 'info');
  log('  Dry run:        ' + CONFIG.dryRun, 'info');
  log('', 'info');

  if (!CONFIG.portalAddress) {
    log('ERROR: --portal-address <addr> is required.', 'error');
    proc.exit(1);
  }

  // Steps 1-3: bootstrap LLM (skippable with --skip-bootstrap for testing)
  if (!CONFIG.skipBootstrap) {
    log('═══ Step 1: Ensure llama.cpp ═══', 'info');
    ensureLlamaCpp();

    log('═══ Step 2: Ensure model ═══', 'info');
    ensureModel();
  }

  log('═══ Step 3: Start llama-server ═══', 'info');
  await startLlamaServer();

  // Step 4: Load policy — prefer on-chain (source of truth set by censor),
  // fall back to local policy file, fall back to hardcoded default.
  log('═══ Step 4: Load moderation policy ═══', 'info');
  let policy = null;
  let censorWindow = 0;
  let maxSaveUp = 0;

  // First fetch to read contract-level config (policy, censor_window)
  try {
    const initialData = fetchPosts();
    if (initialData.policy && initialData.policy.trim().length > 0) {
      policy = initialData.policy.trim();
      log('  Policy from contract (' + policy.length + ' chars)', 'success');
    }
    censorWindow = initialData.censorWindow || 0;
    maxSaveUp = initialData.maxSaveUp || 0;
    if (censorWindow > 0) log('  Censor window: ' + censorWindow + 's (' + Math.floor(censorWindow / 60) + 'm)', 'info');
    if (maxSaveUp > 0) log('  Max save-up: ' + maxSaveUp, 'info');
  } catch (e) {
    log('  Could not fetch contract config: ' + (e.message || e).substring(0, 150), 'warn');
  }

  if (!policy) {
    if (fs.existsSync(CONFIG.policyFile)) {
      policy = fs.readFileSync(CONFIG.policyFile, 'utf8').trim();
      log('  Policy from file (' + policy.length + ' chars): ' + CONFIG.policyFile, 'success');
    } else {
      log('  No policy file, using default.', 'warn');
      policy = 'No spam, advertising, profanity, or advocacy of violence.';
    }
  }
  log('  Policy: ' + policy.substring(0, 80).replace(/\n/g, ' ') + '...', 'info');

  // Step 5: Process posts
  log('═══ Step 5: Fetch & process posts ═══', 'info');
  let lastProcessed = CONFIG.fromIndex - 1;

  async function pollAndProcess() {
    let data;
    try {
      data = fetchPosts();
    } catch (e) {
      log('Failed to fetch posts: ' + (e.message || e).substring(0, 200), 'error');
      return;
    }

    // Update censor_window if contract config changed
    if (data.censorWindow) censorWindow = data.censorWindow;

    const count = data.count;
    const nowSec = Math.floor(Date.now() / 1000);
    log('  Post count: ' + count + ' (last processed: ' + lastProcessed + ')', 'info');

    // Collect unprocessed posts
    const newPosts = [];
    for (let i = lastProcessed + 1; i < count; i++) {
      const post = data.posts.find(p => p.index === i);
      if (post) newPosts.push(post);
    }

    // Sort by censor window urgency: posts closest to expiring first.
    // Posts without timestamps (old contracts) keep insertion order.
    if (censorWindow > 0 && newPosts.some(p => p.timestamp)) {
      newPosts.sort((a, b) => {
        const ra = remainingWindow(a, censorWindow, nowSec);
        const rb = remainingWindow(b, censorWindow, nowSec);
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb; // most urgent (lowest remaining) first
      });
    }

    for (const post of newPosts) {
      // Warn if post is past the censor window
      const remaining = remainingWindow(post, censorWindow, nowSec);
      if (remaining !== null && remaining < 0) {
        log('  ⚠️  #' + post.index + ' past censor window by ' + formatDuration(-remaining) + ' — flag may be too late', 'warn');
      } else if (remaining !== null && remaining < 300) {
        log('  ⏰ #' + post.index + ' censor window expiring in ' + formatDuration(remaining), 'warn');
      }
      await processPost(post, policy);
      lastProcessed = Math.max(lastProcessed, post.index);
    }
  }

  await pollAndProcess();

  if (CONFIG.once) {
    log('All posts processed (--once mode). Exiting.', 'success');
    stopLlamaServer();
    return;
  }

  // Step 6: Polling loop
  log('', 'info');
  log('Polling every ' + CONFIG.pollInterval + 's for new posts... (Ctrl+C to stop)', 'info');

  const pollTimer = setInterval(async () => {
    try { await pollAndProcess(); }
    catch (e) { log('Poll error: ' + (e.message || e), 'error'); }
  }, CONFIG.pollInterval * 1000);

  // Graceful shutdown
  const shutdown = () => {
    log('\nShutting down...', 'info');
    clearInterval(pollTimer);
    stopLlamaServer();
    proc.exit(0);
  };
  proc.on('SIGINT', shutdown);
  proc.on('SIGTERM', shutdown);
}

main().catch(e => {
  log('FATAL: ' + (e.stack || e.message || String(e)), 'error');
  if (llamaProc && !CONFIG.keepServer) {
    try { llamaProc.kill('SIGTERM'); } catch {}
  }
  proc.exit(1);
});
