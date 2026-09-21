#!/usr/bin/env node
import {initializeCliSimulator} from '../../../../shared/cli-simulator.mjs';
import {assertOperatorEnvironment} from '../../../../scripts/operator-launch.mjs';
if(process.env.BILLBOARD_OPERATOR_PROFILE==='1')assertOperatorEnvironment();
// ============================================================
// cli.mjs — CLI tool for Billboard user flow (Deposit -> Post -> Withdraw)
// ============================================================
//
// Uses ONLY the browser bundle (aztec_bundle.js) for all Aztec
// execution and private fee payment. The bundle provides
// createPXE, createAztecNodeClient, openPXEStore, all
// crypto (WASM-based), and all contract classes.
//
// IndexedDB is polyfilled with fake-indexeddb so the bundle's
// PXE store works identically to the browser.
//
// Usage:
//   node cli.mjs <action> [options]
//
// Actions:
//   recover-eth Check the saved Ethereum request; --retry-ethereum retries its same nonce
//   recover     Reconcile the saved Aztec transaction without creating a new proof
//   status      Show current state (deposit note, portal balance, etc.)
//   deposit     Make a new ETH deposit into the L1 portal
//   claim       Claim an existing deposit on L2
//   post        Post an anonymous message to the billboard
//   list        List all messages on the billboard
//   withdraw    Withdraw on L2 (send L2->L1 message)
//   claim-l1    Claim ETH on L1 (consume Outbox message)
//   declare-immoral  Censor flags a post as immoral (requires censor wallet)
//   transfer-censor   Censor transfers censorship rights to a new address
//   set-moderation-policy  Censor updates the moderation policy text (requires censor wallet)
//   auto        Full flow: deposit -> claim -> post -> withdraw -> claim-l1
//
// Options:
//   --portal-address <addr>  L1 portal address (REQUIRED — L2 address derived from it)
//   --amount <eth>           Deposit amount in ETH (for deposit/auto)
//   --min-deposit <eth>       (deprecated, ignored — derived from chain)
//   --base-cooldown <sec>      (deprecated, ignored — derived from chain)
//   --msg <text>             Message to post (for post/auto, alias: --message)
//   --dummy                   Make a dummy post (advances screening, no content)
//   --reuse-tx <hash>        Reuse a specific deposit by L1 tx hash
//   --withdraw-tx <hash>     Current L2 withdrawal tx hash (required for claim-l1)
//   --expected-policy-version <field>  Bind flag to the reviewed policy
//   --post-id <field>        Stable post identity to flag
//   --post-index <num>       Post index to flag (for declare-immoral)
//   --censor-response <text> Censor's response message (for declare-immoral)
//   --moderation-policy <text>  Moderation policy text (for set-moderation-policy, or deploy default)
//   --censor-wallet <file>   Path to censor Aztec wallet JSON (for declare-immoral/transfer-censor)
//   --new-censor <addr>      New censor address (for transfer-censor)
//   --node-url <url>         Explicit Aztec node URL (required)
//   --eth-rpc <url>          Explicit Ethereum RPC URL (required)
//   --aztec-wallet <file>    Path to Aztec wallet.json
//   --eth-wallet <file>      Path to ETH wallet JSON
//   --private-fee-config <file> Public contract address and gas settings JSON
//   --private-fee-claim-file <file> Private bridge claim JSON for the first fee payment (0600)
//   --acknowledge-ethereum-tx <hash>  Start another payment after this reconciled request
//   --retry-ethereum         Explicitly retry the saved Ethereum nonce and calldata
//   --acknowledge-tx <hash>   Explicitly start another action after this confirmed transaction
//   --json                   Output posts as JSON (for list action, machine-readable)
//   --pxe-dir <prefix>       PXE data directory prefix (default: pxe_bb_user_)
// ============================================================

import fs from 'fs';
import { createFileJournalStorage } from './transaction-journal-store.mjs';
import { createClaimSecretStore } from './claim-secret-store.mjs';
import { loadCliWalletInputs, validateCliNetwork } from './wallet-inputs.mjs';
import { createHash } from 'node:crypto';
import BillboardCRS from '../../../../shared/crs-client.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __realProcess = process; // save before bundle overrides it

// ============================================================
// Parse args (handles boolean flags + flags followed by --other-flag)
// ============================================================
function parseArgs() {
  const args = {};
  const positional = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      // Check if next arg is a value or another flag
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true; // boolean flag
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}
const { args, positional } = parseArgs();

// ============================================================
// Config
// ============================================================
const ACTION = positional[0] || 'status';
const network = validateCliNetwork({ nodeUrl: args['node-url'], ethRpcUrl: args['eth-rpc'] });
const AZTEC_NODE_URL = network.nodeUrl;
const AZTEC_API_KEY = __realProcess.env.AZTEC_API_KEY || '';
const ETH_RPC_URL = network.ethRpcUrl;
// Defaults match the user UI template
const PORTAL_ADDRESS = args['portal-address'] || null;
if (!PORTAL_ADDRESS) {
  console.error('ERROR: --portal-address <addr> is required.');
  console.error('The L2 contract address is derived from the portal on chain.');
  __realProcess.exit(1);
}
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');
const AZTEC_WALLET_PATH = args['aztec-wallet'];
const ETH_WALLET_PATH = args['eth-wallet'];

const CENSOR_WALLET_PATH = args['censor-wallet'];
const PXE_DIR_PREFIX = args['pxe-dir'] || 'pxe_bb_user_';

// PXE cache directory (persists IndexedDB state between CLI runs)
const PXE_CACHE_DIR = path.join(PROJECT_ROOT, '.pxe-cache-v2');

// Valid actions
const VALID_ACTIONS = ['status', 'deposit', 'claim', 'post', 'list', 'withdraw', 'claim-l1', 'declare-immoral', 'transfer-censor', 'set-moderation-policy', 'auto', 'recover', 'recover-eth'];
if (!VALID_ACTIONS.includes(ACTION)) {
  console.error('Unknown action: ' + ACTION);
  console.error('Valid actions: ' + VALID_ACTIONS.join(', '));
  __realProcess.exit(1);
}

// ============================================================
// Monkey-patch fetch BEFORE loading SDK (adds API key for Aztec RPC)
// ============================================================
function createCliRpcFetch(originalFetch, nodeUrl, apiKey) {
  const endpoint = new URL(nodeUrl);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Invalid Aztec RPC endpoint.');
  return function(input, init) {
    const isRequest = input instanceof Request;
    const credentials = init?.credentials ?? (isRequest ? input.credentials : undefined);
    const referrerPolicy = init?.referrerPolicy ?? (isRequest ? input.referrerPolicy : undefined);
    if (credentials === 'omit' && referrerPolicy === 'no-referrer') return originalFetch(input, init);
    const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (!target.username && !target.password && target.origin === endpoint.origin && target.pathname === endpoint.pathname) {
      const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
      headers.set('x-aztec-api-key', apiKey);
      return originalFetch(input, { ...init, headers, redirect: 'error' });
    }
    return originalFetch(input, init);
  };
}
if (AZTEC_API_KEY) globalThis.fetch = createCliRpcFetch(globalThis.fetch.bind(globalThis), AZTEC_NODE_URL, AZTEC_API_KEY);

// ============================================================
// Logging
// ============================================================
const COLORS = {
  info: '\x1b[37m', success: '\x1b[32m', warn: '\x1b[33m',
  error: '\x1b[31m', reset: '\x1b[0m',
};
function log(msg, level) {
  const c = COLORS[level] || COLORS.info;
  console.log(`${c}[${new Date().toLocaleTimeString()}] ${msg}${COLORS.reset}`);
}

// ============================================================
// PXE cache (dump/restore IndexedDB between runs)
// ============================================================
const { createPxeCacheSession } = require('./pxe-cache.cjs');

// ============================================================
// Load engine
// ============================================================
// Load moderation-policy helpers onto globalThis before eval'ing engine
const _modPolicy = require(path.join(PROJECT_ROOT, 'shared', 'moderation-policy.js'));
for (const [k, v] of Object.entries(_modPolicy)) {
  if (typeof v === 'function' || typeof v === 'string' || typeof v === 'number') globalThis[k] = v;
}

require(path.join(PROJECT_ROOT, 'shared', 'helpers.js'));
const engineCode = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
eval(engineCode+'\n//# sourceURL=billboard-user-engine.js');

// ============================================================
// Load Aztec SDK from the browser bundle (WASM, no native binary)
// ============================================================
async function loadAztecSDK() {
  // Polyfill IndexedDB BEFORE loading the bundle
  if (!globalThis.indexedDB) {
    const fakeIDB = await import('fake-indexeddb');
    globalThis.indexedDB = fakeIDB.default;
    for (const key of Object.keys(fakeIDB)) {
      if (key !== 'default' && key !== 'forceCloseDatabase' && !globalThis[key]) {
        globalThis[key] = fakeIDB[key];
      }
    }
  }

  // Set self = globalThis so the bundle treats us as a browser environment.
  // This makes poseidon2HashFields use BarretenbergSync (WASM) instead of
  // Barretenberg (native binary), which is what we want in the CLI.
  if (!globalThis.self) globalThis.self = globalThis;

  // Suppress verbose logging from the bundle's internal logger
  __realProcess.env.LOG_LEVEL = 'warn';

  // Filter out [DEBUG ...] lines and pino logger output from all console methods
  const origWarn = console.warn;
  console.warn = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[DEBUG ')) return;
    if (filterPino(...args)) return;
    return origWarn.apply(console, args);
  };

  // Filter out pino logger output from console.log, console.info, console.error
  const origLog = console.log;
  const origInfo = console.info;
  const origError = console.error;
  function filterPino(...args) {
    // Pino browser logger (asObject:false) calls console.log(bindingsObj, msg, ...)
    // The first arg is the bindings object like { module: 'kv-store', actor: 0 }
    if (args.length > 0 && typeof args[0] === 'object' && args[0] && ('module' in args[0] || 'actor' in args[0])) return true;
    // Stringified form
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('{ module:')) return true;
    return false;
  }
  console.log = function(...args) { if (filterPino(...args)) return; return origLog.apply(console, args); };
  console.info = function(...args) { if (filterPino(...args)) return; return origInfo.apply(console, args); };
  console.error = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[DEBUG ')) return;
    if (filterPino(...args)) return;
    return origError.apply(console, args);
  };

  const bundlePaths = [
    path.join(PROJECT_ROOT, '.build', 'sdk', 'aztec_bundle.js'),
  ];
  let bundleCode = null;
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) { bundleCode = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!bundleCode) throw new Error('Could not find aztec_bundle.js in ' + bundlePaths.join(', '));

  const bundleFn = new Function(bundleCode + '; return __aztec;\n//# sourceURL=billboard-sdk.js');
  const a = bundleFn();

  // Keep polyfill Buffer, patch isBuffer/copy/equals, add read/write methods
  const polyfillBuffer = globalThis.Buffer;
  globalThis.process = __realProcess;

  polyfillBuffer.isBuffer = function(b) {
    return b != null && (b._isBuffer === true || b instanceof Uint8Array);
  };

  const patchedCopy = function(target, targetStart, sourceStart, sourceEnd) {
    if (!(target instanceof Uint8Array)) throw new TypeError("argument should be a Uint8Array/Buffer");
    const ts = targetStart || 0;
    const ss = sourceStart || 0;
    const se = sourceEnd !== undefined ? sourceEnd : this.length;
    if (se <= ss) return 0;
    const src = this.subarray(ss, se);
    target.set(src, ts);
    return src.length;
  };
  const patchedEquals = function(b) {
    if (!(b instanceof Uint8Array)) throw new TypeError("Argument must be a Uint8Array/Buffer");
    if (this.length !== b.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== b[i]) return false;
    return true;
  };
  polyfillBuffer.prototype.copy = patchedCopy;
  polyfillBuffer.prototype.equals = patchedEquals;
  Uint8Array.prototype.copy = patchedCopy;
  if (!Uint8Array.prototype.equals) {
    Uint8Array.prototype.equals = patchedEquals;
  }

  const readU8 = function(o=0) { return this[o]; };
  const readU16BE = function(o=0) { return (this[o]<<8)|this[o+1]; };
  const readU32BE = function(o=0) { return ((this[o]*0x1000000)+(this[o+1]<<16)+(this[o+2]<<8)+this[o+3])>>>0; };
  const readU32LE = function(o=0) { return (this[o]+(this[o+1]<<8)+(this[o+2]<<16)+(this[o+3]*0x1000000))>>>0; };
  const readU64BE = function(o=0) {
    const h = ((this[o]*0x1000000)+(this[o+1]<<16)+(this[o+2]<<8)+this[o+3])>>>0;
    const l = ((this[o+4]*0x1000000)+(this[o+5]<<16)+(this[o+6]<<8)+this[o+7])>>>0;
    return BigInt(h)*0x100000000n + BigInt(l);
  };
  const writeU8 = function(v,o=0) { this[o]=v&0xff; return o+1; };
  const writeU16BE = function(v,o=0) { this[o]=(v>>8)&0xff; this[o+1]=v&0xff; return o+2; };
  const writeU32BE = function(v,o=0) { this[o]=(v>>>24)&0xff; this[o+1]=(v>>16)&0xff; this[o+2]=(v>>8)&0xff; this[o+3]=v&0xff; return o+4; };
  const writeU32LE = function(v,o=0) { this[o]=v&0xff; this[o+1]=(v>>8)&0xff; this[o+2]=(v>>16)&0xff; this[o+3]=(v>>>24)&0xff; return o+4; };
  const writeU64BE = function(v,o=0) {
    const bv = BigInt(v);
    for (let i=0; i<8; i++) this[o+7-i] = Number((bv >> BigInt(i*8)) & 0xffn);
    return o+8;
  };
  const bufMethods = {
    readUint8: readU8, readUint16BE: readU16BE, readUint32BE: readU32BE, readUint32LE: readU32LE,
    readBigUint64BE: readU64BE,
    writeUint8: writeU8, writeUint16BE: writeU16BE, writeUint32BE: writeU32BE, writeUint32LE: writeU32LE,
    writeBigUint64BE: writeU64BE,
    readUInt8: readU8, readUInt16BE: readU16BE, readUInt32BE: readU32BE, readUInt32LE: readU32LE,
    readBigUInt64BE: readU64BE,
    writeUInt8: writeU8, writeUInt16BE: writeU16BE, writeUInt32BE: writeU32BE, writeUInt32LE: writeU32LE,
    writeBigUInt64BE: writeU64BE,
  };
  for (const [name, fn] of Object.entries(bufMethods)) {
    if (!Uint8Array.prototype[name]) {
      Uint8Array.prototype[name] = fn;
    }
  }

  initializeCliSimulator(a, PROJECT_ROOT);
  return a;
}

// ============================================================
// Node hashing and proving use separate, explicitly initialized singleton backends.
// ============================================================
let _crsDone = false;
async function initCRSNode(a) {
  if (_crsDone) return;
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'crs-manifest.json'), 'utf8'));
  log('  Initializing BarretenbergSync (WASM)...', 'info');
  await a.BarretenbergSync.initSingleton();
  // Sync is for hashing only. The asynchronous prover gets the verified local SRS.
  globalThis.BillboardCRS = BillboardCRS;
  await a.initializeCliProver({
    manifest,
    loadLocal: async file => {
      if (typeof file.name !== 'string' || path.basename(file.name) !== file.name) throw new Error('Invalid local CRS file');
      const localPath = path.join(PROJECT_ROOT, 'apps', 'dist', 'crs', file.name);
      const fd = fs.openSync(localPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size !== file.bytes) throw new Error('Cached CRS size mismatch');
        return new Uint8Array(fs.readFileSync(fd));
      } finally { fs.closeSync(fd); }
    },
    sha256: data => createHash('sha256').update(data).digest('hex'),
  });
  _crsDone = true;
  log('  CRS initialized.', 'success');
}

// ============================================================
// Store creation (Node.js: use bundle's openPXEStore with fake-indexeddb)
// ============================================================
function createStoreNode(a) {
  return async (config) => {
    return a.openPXEStore(config);
  };
}

// ============================================================
// Main
// ============================================================
async function main() {
  if(ACTION==='list') {
    const {listPublicFeed}=await import('../../../../shared/public-feed-cli.mjs');
    const result=await listPublicFeed({root:PROJECT_ROOT,nodeUrl:AZTEC_NODE_URL,ethereumUrl:ETH_RPC_URL,portalAddress:PORTAL_ADDRESS,cacheDirectory:args['public-feed-cache']});
    if(args.json)console.log(JSON.stringify(result));
    else for(const post of result.posts)console.log('#'+post.index+' '+(post.flagged?'[flagged] ':'')+post.text);
    return;
  }
  if (Object.hasOwn(args, 'sponsor-config') || Object.hasOwn(args, 'sponsor-provider')) {
    throw new Error('Coupon sponsorship has been removed. Use --private-fee-config.');
  }
  log('Billboard User CLI', 'info');
  log('  Action:       ' + ACTION, 'info');
  log('  Aztec node:   ' + AZTEC_NODE_URL, 'info');
  log('  ETH RPC:      ' + ETH_RPC_URL, 'info');
  log('  Portal address: ' + PORTAL_ADDRESS, 'info');
  log('', 'info');

  if (Object.hasOwn(args,'reuse')) throw new Error('Use --reuse-tx <deposit transaction hash>; automatic deposit discovery is not supported.');
  // Validate action-specific requirements
  if ((ACTION === 'deposit' || ACTION === 'auto') && !args['reuse-tx'] && !args['amount']) {
    log('ERROR: --amount <eth> required for deposit/auto (or use --reuse-tx)', 'error');
    __realProcess.exit(1);
  }
  // Enforce 0.025 ETH max on deposits (alpha experimental software)
  if ((ACTION === 'deposit' || ACTION === 'auto') && !args['reuse-tx'] && args['amount']) {
    const amt = parseFloat(args['amount']);
    if (!isNaN(amt) && amt > 0.025) {
      log('ERROR: Maximum deposit is 0.025 ETH. This is alpha experimental software, not for production use.', 'error');
      __realProcess.exit(1);
    }
  }
  // Alpha warning for deposit/auto actions
  if (ACTION === 'deposit' || ACTION === 'auto') {
    log('⚠️  Alpha experimental software. Not meant for production use. Max deposit: 0.025 ETH.', 'warn');
  }
  if (ACTION === 'post' && !args['msg'] && !args['message'] && !args['dummy']) {
    log('ERROR: --msg <text> required for post (or use --dummy for a dummy post)', 'error');
    __realProcess.exit(1);
  }
  if (ACTION === 'declare-immoral' && args['post-index'] === undefined && args['post-id'] === undefined) {
    log('ERROR: --post-id <field> or --post-index <order> required for declare-immoral', 'error');
    __realProcess.exit(1);
  }
  if (ACTION === 'transfer-censor' && !args['new-censor']) {
    log('ERROR: --new-censor <addr> required for transfer-censor', 'error');
    __realProcess.exit(1);
  }
  if (ACTION === 'set-moderation-policy' && !args['moderation-policy']) {
    log('ERROR: --moderation-policy <text> required for set-moderation-policy', 'error');
    __realProcess.exit(1);
  }

  const { ethWallet, aztecWallet, censorWalletJson } = loadCliWalletInputs({
    action: ACTION, explicitCensorWallet: Object.hasOwn(args, 'censor-wallet'),
    censorWalletPath: CENSOR_WALLET_PATH, aztecWalletPath: AZTEC_WALLET_PATH, ethWalletPath: ETH_WALLET_PATH,
  });
  log(censorWalletJson ? 'Using only the configured censor wallet.' : 'User wallet loaded.', 'success');

  // Load SDK from bundle
  log('Loading Aztec SDK (bundle)...', 'info');
  const a = await loadAztecSDK();
  log('  SDK loaded.', 'success');

  // Load ethers
  const ethers = await import('ethers');

  // Load resources (portal bytecode + artifact from deploy dir)
  const deployDir = path.join(__dirname, '..', 'deploy');
  const portalBytecodePath = path.join(deployDir, 'portal_bytecode.txt');
  const artifactPath = path.join(deployDir, 'billboard_artifact.json');
  const portalBytecode = fs.readFileSync(portalBytecodePath, 'utf8').trim();
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const privateFeeArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'private_fee_artifact.json'), 'utf8'));

  const env = {
    aztec: a, ethers, log,
    initCRS: () => initCRSNode(a),
    createStore: createStoreNode(a),
    getBrowserSigner: null,
    portalBytecode: portalBytecode.startsWith('0x') ? portalBytecode : '0x' + portalBytecode,
    artifact, privateFeeArtifact,
    createEthereumJournal: options => a.createEthereumJournal({...options,storage:createFileJournalStorage(path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH || CENSOR_WALLET_PATH)),'transaction-journal-v1'))}),
    createTransactionJournal: options => a.createL2Journal({...options,storage:createFileJournalStorage(path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH || CENSOR_WALLET_PATH)),'transaction-journal-v1'))}),
  };

  const privateFee = !args['inspect-only'] && args['private-fee-config'] ? readPrivateFeeJson(args['private-fee-config'], false) : undefined;
  const privateFeeClaim = !args['inspect-only'] && args['private-fee-claim-file'] ? readPrivateFeeJson(args['private-fee-claim-file'], true) : undefined;
  if (privateFeeClaim && !privateFee) throw new Error('A private fee claim requires --private-fee-config.');

  const config = {
    inspectOnly: args['inspect-only'] === true,
    reconcilePrevious: args['reconcile-previous'] === true,
    privateFee, privateFeeClaim,
    action: ACTION,
    acknowledgeTx: args['acknowledge-tx'],
    acknowledgeEthereumTx: args['acknowledge-ethereum-tx'],
    retryEthereum: args['retry-ethereum']===true,
    aztecNodeUrl: AZTEC_NODE_URL,
    ethRpcUrl: ETH_RPC_URL,
    contractSalt: 0, // not used when portalAddress is provided
    portalAddress: PORTAL_ADDRESS,
    aztecWallet, ethWallet,
    dataDirPrefix: PXE_DIR_PREFIX,
    depositAmount: args['amount'],

    message: args['msg'] || args['message'],
    isDummy: !!args['dummy'],
    reuseTxHash: args['reuse-tx'],
    withdrawTxHash: args['withdraw-tx'],
    postId: args['post-id'],
    expectedPolicyVersion: args['expected-policy-version'],
    postIndex: args['post-index'],
    censorResponse: args['censor-response'],
    moderationPolicy: args['moderation-policy'] || undefined,
    censorWalletPath: CENSOR_WALLET_PATH,
    censorWalletJson,
    newCensor: args['new-censor'] || undefined,

    depositChainId: args['deposit-chain-id'],
    claimSecretStore: aztecWallet && ['deposit', 'claim', 'auto'].includes(ACTION)
      ? createClaimSecretStore(path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH)), 'claim-secrets-v2'), aztecWallet.secretKey, aztecWallet.salt) : undefined,
    jsonOutput: !!args['json'],
  };

  if(config.inspectOnly) {
    if(ACTION!=='declare-immoral'||args.json!==true)throw new Error('Journal inspection requires declare-immoral --json.');
    console.log(JSON.stringify(await globalThis.runBillboardUser(env,config)));
    return;
  }

  let cache;
  let cacheReady = false;
  try {
    const sk = a.Fr.fromHexString(aztecWallet.secretKey);
    const signingKey = a.deriveSigningKey(sk);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(sk);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const inst = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(BigInt(aztecWallet.salt)), publicKeys, immutablesHash,
    });
    const account = inst.address.toString().toLowerCase();
    const node = a.createAztecNodeClient(AZTEC_NODE_URL);
    const provider = new ethers.JsonRpcProvider(ETH_RPC_URL);
    let nodeInfo, l1Network;
    try { [nodeInfo, l1Network] = await Promise.all([node.getNodeInfo(), provider.getNetwork()]); }
    finally { provider.destroy(); }
    if (BigInt(nodeInfo.l1ChainId) !== l1Network.chainId) throw new Error('Aztec and Ethereum RPC chain identities differ');
    const chainId = String(nodeInfo.l1ChainId), version = String(nodeInfo.rollupVersion);
    const rollup = nodeInfo.l1ContractAddresses.rollupAddress.toString().toLowerCase();
    config.expectedNetworkScope = { chainId, rollup, version };
    const directory = PXE_DIR_PREFIX + account.slice(0, 16) + '_' + nodeInfo.l1ContractAddresses.rollupAddress;
    const identity = a.getPXEStoreIdentity({ l1ChainId: nodeInfo.l1ChainId, rollupAddress: rollup,
      accountAddress: account, dataDirectory: directory });
    cache = createPxeCacheSession({ directory: PXE_CACHE_DIR, walletSecret: aztecWallet.secretKey,
      scope: { account, chainId, rollup, version, databaseName: identity.name } });
    await cache.restore(globalThis.indexedDB); cacheReady = true;
    const result = await globalThis.runBillboardUser(env, config);
    await cache.save(globalThis.indexedDB);
    log('  Private PXE checkpoint saved.', 'success');
    if(ACTION==='declare-immoral'&&args.json)console.log(JSON.stringify({type:'billboard-moderation-submission-v1',postId:args['post-id'],policyVersion:args['expected-policy-version'],receipt:result.moderatorReceipt??null,predecessorTxHashes:result.moderatorPredecessors??[]}));
    const recoveredRevert=['transaction_reverted','ethereum_reverted','ethereum_replaced'].includes(result.state);
    log(recoveredRevert?'  Recovery found a failed or replaced transaction; the original action failed.':'  Action "' + ACTION + '" completed!',recoveredRevert?'warn':'success');
    if(result.lastEthereumTxHash)log('  To start another payment, acknowledge the reconciled transaction with --acknowledge-ethereum-tx '+result.lastEthereumTxHash,'info');
    if(result.lastL2TxHash)log('  To start another action, acknowledge the confirmed transaction with --acknowledge-tx '+result.lastL2TxHash,'info');
    if (result.state) log('  Final state: ' + result.state, recoveredRevert?'warn':'success');
  } catch (e) {
    if (cacheReady) {
      try { await cache.save(globalThis.indexedDB); }
      catch { throw new Error('Action or checkpoint save failed; preserve wallet/cache and reconcile transaction status before retrying'); }
    }
    throw e;
  } finally { if (cache) cache.close(); }

 }

// Secrets stay in a local file, never a command argument or executable provider module.
function readPrivateFeeJson(filename, secret) {
  try {
    const fd = fs.openSync(path.resolve(filename), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 16384 || (secret && (stat.mode & 0o077) !== 0)) throw new Error();
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      const keys = secret ? ['amount', 'salt', 'leafIndex', 'secret'] : ['contractAddress', 'gasSettings'];
      if (!value || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) ||
          !(secret ? ['amount', 'salt', 'leafIndex'] : keys).every(key => Object.hasOwn(value, key))) throw new Error();
      return value;
    } finally { fs.closeSync(fd); }
  } catch (_) {
    const error = new Error('Private fee configuration or claim file could not be loaded.');
    error.code = 'BB_PRIVATE_FEE_CONFIGURATION';
    throw error;
  }
}

function formatCliPrivateFeeFailure(error) {
  const messages = {
    PRIVATE_FEE_CAP_TOO_LOW: 'The configured transaction fee cap is below the network current minimum. Update the fee settings before continuing.',
    BB_PRIVATE_FEE_CONFIGURATION: 'Private fee configuration or claim file could not be loaded.',
    BB_CLI_PROVER_CONFIGURATION: 'Local CLI proving setup could not be verified.',
    BB_PRIVATE_FEE_PREPARATION_FAILED: 'Private fee preparation failed before submission.',
    BB_PRIVATE_FEE_ACTION_FAILED: 'Private fee action failed. Check the saved transaction outcome.',
    BB_SUBMISSION_UNKNOWN: 'Transaction submission outcome is unknown. Check its outcome before another attempt.',
    BB_TRANSACTION_FAILED: 'The transaction did not complete successfully. Check its receipt before another attempt.',
    BB_STATE_CONFLICT: 'Transaction state changed. Refresh and create a new proof before another attempt.',
    BB_NO_SAVED_ETHEREUM_TRANSACTION: 'No saved Ethereum request exists for this wallet and portal.',
    BB_ETH_RECOVERY_REQUIRED: 'Check the saved Ethereum request using recover-eth. Use --retry-ethereum only to retry its original nonce and payment details.',
    BB_ETH_SUBMISSION_UNKNOWN: 'Ethereum submission is uncertain. Preserve the saved request and use recover-eth.',
    BB_ETH_TRANSACTION_FAILED: 'Ethereum request reverted or was replaced. Use recover-eth before another payment.',
    BB_RECOVERY_REQUIRED: 'Recover the saved transaction first using the recover action. Starting another action requires its confirmed hash via --acknowledge-tx.',
    BB_JOURNAL_INVALID: 'Transaction journal could not be authenticated or saved. Preserve wallet and recovery storage before continuing.',
    BB_NO_SAVED_TRANSACTION: 'No saved Aztec transaction exists for this wallet and board.',
    BB_RECOVERY_UNKNOWN: 'Recovery could not be verified. Preserve the receipt and retry lookup; do not create another deposit.',
    BB_SETTLEMENT_PENDING: 'Withdrawal recorded; network settlement is pending. Retry the Ethereum claim later.',
  };
  try { if (typeof error?.code === 'string' && Object.hasOwn(messages, error.code)) return error.code + ': ' + messages[error.code]; } catch (_) {}
  return 'Private fee payment could not be completed. Check any transaction outcome before another attempt.';
}
function formatCliFailure(error) {
  const safeMessages = new Set([
    'Aztec and Ethereum RPC chain identities differ',
    'PXE cache is locked. Another process may be active; preserve the cache and inspect the lock before explicit recovery.',
    'PXE checkpoint authentication failed; existing data preserved',
    'PXE cache requires a private directory',
    'Invalid private PXE checkpoint file',
    'PXE checkpoint changed concurrently; refusing overwrite',
    'Unexpected PXE database scope; refusing checkpoint',
    'Action or checkpoint save failed; preserve wallet/cache and reconcile transaction status before retrying',
    ...['Aztec', 'Censor', 'ETH'].flatMap(label => [label + ' wallet is required', label + ' wallet could not be read as a private regular file']),
    'Invalid wallet salt', 'Invalid Aztec key', 'Invalid Censor key', 'Invalid Ethereum key',
  ]);
  if (safeMessages.has(error?.message)) return error.message;
  if (args['private-fee-config'] || args['private-fee-claim-file'] || ['BB_NO_SAVED_ETHEREUM_TRANSACTION','BB_ETH_RECOVERY_REQUIRED','BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_TRANSACTION_FAILED','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','BB_NO_SAVED_TRANSACTION','BB_RECOVERY_UNKNOWN','BB_SETTLEMENT_PENDING','BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT'].includes(error?.code)) return formatCliPrivateFeeFailure(error);
  return 'Command failed. Preserve wallet/cache and check any transaction outcome before retrying.';
}
function cliFailureLocations(error) {
  const locations=new Set();
  for(const frame of Array.isArray(error?.noirErrorStack)?error.noirErrorStack:[]) {
    if(frame&&typeof frame.filePath==='string'&&Number.isSafeInteger(frame.line)&&frame.line>=0&&Number.isSafeInteger(frame.column)&&frame.column>=0) {
      const name=frame.filePath.split('/').at(-1);
      if(/^[a-zA-Z0-9_]{1,64}\.nr$/.test(name))locations.add(name+':'+frame.line+':'+frame.column);
    }
  }
  // Aztec SimulationError supplies a Noir stack; its cause retains the JS site.
  for(let depth=0;error&&depth<4;depth++,error=error.cause) {
    for(const line of String(error.stack??'').split('\n').filter(line=>line.trimStart().startsWith('at '))) {
      for(const match of line.matchAll(/(billboard-user-engine|billboard-sdk)\.js:(\d+):(\d+)/g))locations.add(match[1]+'.js:'+match[2]+':'+match[3]);
    }
  }
  return [...locations].slice(0,4);
}
main().catch(e => {
  log('FATAL: ' + formatCliFailure(e), 'error');
  for(const location of cliFailureLocations(e))log('Failure location: '+location,'error');
  __realProcess.exit(1);
});
