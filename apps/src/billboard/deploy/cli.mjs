#!/usr/bin/env node
import {initializeCliSimulator} from '../../../../shared/cli-simulator.mjs';
import {assertOperatorEnvironment} from '../../../../scripts/operator-launch.mjs';
if(process.env.BILLBOARD_OPERATOR_PROFILE==='1')assertOperatorEnvironment();
// ============================================================
// cli.mjs — CLI tool for Billboard contract deployment
// ============================================================
//
// Uses ONLY the browser bundle (aztec_bundle.js) for all Aztec
// functionality — no npm Aztec SDK needed. The bundle provides
// createPXE, createAztecNodeClient, openPXEStore, all
// crypto (WASM-based), and all contract classes.
//
// IndexedDB is polyfilled with fake-indexeddb so the bundle's
// PXE store works identically to the browser.
//
// Usage:
//   node cli.mjs [options]
//
// Required: --manifest PATH --aztec-wallet PATH --eth-wallet PATH
// Optional: --ready-tx HASH --retry-ethereum true --report PATH
// Board/network/actor settings come exclusively from the reviewed manifest.

import fs from 'fs';
import {deploymentManifestConfig} from '../../../../shared/deployment-manifest.mjs';
import {createFileJournalStorage} from '../user/transaction-journal-store.mjs';
import { createHash } from 'node:crypto';
import BillboardCRS from '../../../../shared/crs-client.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCliWalletInputs, validateCliNetwork } from '../user/wallet-inputs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __realProcess = process; // save before bundle overrides it

// ============================================================
// Parse args
// ============================================================
function parseArgs() {
  const args={},allowed=new Set(['manifest','aztec-wallet','eth-wallet','ready-tx','retry-ethereum','report']);
  for(let i=2;i<process.argv.length;i+=2){const name=process.argv[i].slice(2);if(!process.argv[i].startsWith('--')||!allowed.has(name)||Object.hasOwn(args,name)||!process.argv[i+1])throw new Error('Invalid deployment option');args[name]=process.argv[i+1];}
  if(!args.manifest)throw new Error('--manifest is required; review explicit network, actors, artifacts and board settings first');
  return args;
}
const args=parseArgs();
const manifestFd=fs.openSync(args.manifest,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
let manifestConfig;
try{if(!fs.fstatSync(manifestFd).isFile()||fs.fstatSync(manifestFd).size>65536)throw new Error('Invalid deployment manifest file');manifestConfig=deploymentManifestConfig(JSON.parse(fs.readFileSync(manifestFd,'utf8')));}finally{fs.closeSync(manifestFd);}
const network=validateCliNetwork({nodeUrl:manifestConfig.aztecNodeUrl,ethRpcUrl:manifestConfig.ethRpcUrl});
const AZTEC_NODE_URL=network.nodeUrl,ETH_RPC_URL=network.ethRpcUrl;
const AZTEC_API_KEY=__realProcess.env.AZTEC_API_KEY||'';
const PROJECT_ROOT=path.join(__dirname,'..','..','..','..');
const AZTEC_WALLET_PATH=args['aztec-wallet'],ETH_WALLET_PATH=args['eth-wallet'];

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
if(AZTEC_API_KEY) globalThis.fetch=createCliRpcFetch(globalThis.fetch.bind(globalThis),AZTEC_NODE_URL,AZTEC_API_KEY);

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
// Load engine
// ============================================================
// Load moderation-policy helpers onto globalThis before eval'ing engine
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const _modPolicy = _require(path.join(PROJECT_ROOT, 'shared', 'moderation-policy.js'));
for (const [k, v] of Object.entries(_modPolicy)) {
  if (typeof v === 'function' || typeof v === 'string' || typeof v === 'number') globalThis[k] = v;
}

const engineCode = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
eval(engineCode);

// ============================================================
// Load Aztec SDK from the browser bundle (WASM, no native binary)
// ============================================================
// The bundle provides everything: createPXE, createAztecNodeClient,
// openPXEStore, BarretenbergSync (WASM), Contract, DeployMethod,
// account contracts, Fr, poseidon2Hash, sha256ToField, etc.
//
// We keep the bundle's Buffer polyfill (don't restore native Buffer) to
// avoid type mismatches. We patch isBuffer/copy/equals to accept any
// Uint8Array (msgpack returns plain Uint8Array, not Buffer6 instances).
async function loadAztecSDK() {
  // Polyfill IndexedDB BEFORE loading the bundle (it uses IndexedDB for CRS caching)
  if (!globalThis.indexedDB) {
    const fakeIDB = await import('fake-indexeddb');
    globalThis.indexedDB = fakeIDB.default;
    // fake-indexeddb exports all IDB classes that the bundle needs
    for (const key of Object.keys(fakeIDB)) {
      if (key !== 'default' && key !== 'forceCloseDatabase' && !globalThis[key]) {
        globalThis[key] = fakeIDB[key];
      }
    }
  }

  // Set self = globalThis so the bundle treats us as a browser environment.
  if (!globalThis.self) globalThis.self = globalThis;

  // Filter out pino logger output and [DEBUG] lines from console methods
  function filterPino(...args) {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] && ('module' in args[0] || 'actor' in args[0])) return true;
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('{ module:')) return true;
    return false;
  }
  const origLog = console.log, origInfo = console.info, origWarn = console.warn, origError = console.error;
  console.log = function(...a) { if (filterPino(...a)) return; return origLog.apply(console, a); };
  console.info = function(...a) { if (filterPino(...a)) return; return origInfo.apply(console, a); };
  console.warn = function(...a) { if (filterPino(...a)) return; return origWarn.apply(console, a); };
  console.error = function(...a) {
    if (a.length > 0 && typeof a[0] === 'string' && a[0].startsWith('[DEBUG ')) return;
    if (filterPino(...a)) return;
    return origError.apply(console, a);
  };

  const bundlePaths = [
    path.join(PROJECT_ROOT, '.build', 'sdk', 'aztec_bundle.js'),
  ];
  let bundleCode = null;
  for (const p of bundlePaths) {
    if (fs.existsSync(p)) { bundleCode = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!bundleCode) throw new Error('Could not find aztec_bundle.js in ' + bundlePaths.join(', '));

  // Load the bundle — it replaces globalThis.Buffer with its polyfill (Buffer6)
  const bundleFn = new Function(bundleCode + '; return __aztec;');
  const a = bundleFn();

  // The polyfill Buffer (Buffer6) is now globalThis.Buffer.
  // KEEP the polyfill Buffer — do NOT restore native Buffer.
  // Reason: the bundle's jsonStringify() replacer uses import_buffer2.Buffer.isBuffer()
  // to detect Buffer objects and convert them to base64. import_buffer2 is the polyfill,
  // so it only recognizes Buffer6 instances (via _isBuffer flag). If we restore native
  // Buffer, BufferSink.toBuffer() returns native Buffers that the replacer can't detect,
  // causing them to be serialized as {"0":0,"1":0,...} instead of base64 strings.
  // The node then rejects the request with "Invalid input (0.chonkProof)".
  //
  // The polyfill Buffer6 extends Uint8Array (via setPrototypeOf), so methods we add
  // to Uint8Array.prototype are inherited by Buffer6 instances.
  const polyfillBuffer = globalThis.Buffer;  // Buffer6
  globalThis.process = __realProcess;

  // Patch polyfill's isBuffer to accept ANY Uint8Array (native Buffers, plain Uint8Arrays
  // from msgpack, etc.) — not just Buffer6 instances with _isBuffer.
  polyfillBuffer.isBuffer = function(b) {
    return b != null && (b._isBuffer === true || b instanceof Uint8Array);
  };

  // Patch .copy and .equals on the polyfill prototype to accept any Uint8Array target
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
  // Also set on Uint8Array.prototype for plain Uint8Array instances (from msgpack)
  Uint8Array.prototype.copy = patchedCopy;
  if (!Uint8Array.prototype.equals) {
    Uint8Array.prototype.equals = patchedEquals;
  }

  // Add Buffer read/write methods to Uint8Array.prototype — Buffer6 instances and
  // plain Uint8Arrays (from msgpack/IndexedDB) lack these, but the bundle calls them.
  // The bundle code uses new-style names (lowercase u: readUint32BE, writeUint32BE).
  // Also add old-style names (capital I: readUInt32BE) for compatibility.
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
    // New-style names (lowercase u) — used by the bundle
    readUint8: readU8, readUint16BE: readU16BE, readUint32BE: readU32BE, readUint32LE: readU32LE,
    readBigUint64BE: readU64BE,
    writeUint8: writeU8, writeUint16BE: writeU16BE, writeUint32BE: writeU32BE, writeUint32LE: writeU32LE,
    writeBigUint64BE: writeU64BE,
    // Old-style names (capital I) — for compatibility
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

  // Return all exports the engine needs
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
    // Same as browser: openPXEStore uses globalThis.indexedDB (fake-indexeddb)
    return a.openPXEStore(config);
  };
}

// ============================================================
// Pause handler (CLI: stdin)
// ============================================================
function readline() {
  return new Promise((resolve) => {
    process.stdout.write('> ');
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.once('data', (chunk) => {
      process.stdin.pause();
      resolve(chunk.trim());
    });
  });
}

async function pauseCLI() {throw new Error('Supply explicit wallet files before starting deployment.');}

// ============================================================
// Main
// ============================================================
async function main() {
  log('Billboard CLI Deploy Tool', 'info');
  log('  Using explicit Aztec RPC endpoint.', 'info');
  log('  Using explicit Ethereum RPC endpoint.', 'info');
  log('  Salt:       ' + manifestConfig.contractSalt, 'info');
  log('', 'info');

  const {ethWallet,aztecWallet}=loadCliWalletInputs({action:'deploy',aztecWalletPath:AZTEC_WALLET_PATH,ethWalletPath:ETH_WALLET_PATH});
  if(!ethWallet)throw new Error('An explicit Ethereum wallet file is required for deployment.');
  log('Private wallet files loaded.','success');

  // Load SDK from bundle
  log('Loading Aztec SDK (bundle)...', 'info');
  const a = await loadAztecSDK();
  log('  SDK loaded.', 'success');

  // Load ethers
  const ethers = await import('ethers');

  // Load resources
  const portalBytecode = fs.readFileSync(path.join(__dirname, 'portal_bytecode.txt'), 'utf8').trim();
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, 'billboard_artifact.json'), 'utf8'));

  const env = {
    aztec: a, ethers, log,
    createJournalStorage: () => createFileJournalStorage(path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH)), 'transaction-journal-v1')),
    createTransactionJournal: options => a.createL2Journal({...options, storage: createFileJournalStorage(path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH)), 'transaction-journal-v1'))}),
    pause: pauseCLI,
    initCRS: () => initCRSNode(a),
    createStore: createStoreNode(a),
    getBrowserSigner: null,
    portalBytecode: portalBytecode.startsWith('0x') ? portalBytecode : '0x' + portalBytecode,
    artifact,
  };

  const config = {...manifestConfig,aztecApiKey:AZTEC_API_KEY,aztecWallet,ethWallet,
    dataDirPrefix:'pxe_bb_cli_',readyTxHash:args['ready-tx'],retryEthereum:args['retry-ethereum']==='true'};

  // Validate and reserve report output before any deployment transaction.
  const reportPath=path.resolve(args.report||args.manifest+'.report.json');
  const intentDigest='0x'+createHash('sha256').update(JSON.stringify(manifestConfig.deploymentManifest)).digest('hex');
  const reportIdentity=()=>{try{const st=fs.lstatSync(reportPath);if(!st.isFile()||st.isSymbolicLink()||st.size>131072)throw Error('Invalid deployment report');return st.dev+':'+st.ino+':'+st.size+':'+st.mtimeMs;}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const previousReport=reportIdentity();
  if(previousReport!==null){const fd=fs.openSync(reportPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const old=JSON.parse(fs.readFileSync(fd,'utf8'));if(old.schemaVersion!==1||old.intentDigest!==intentDigest)throw Error('Refusing to overwrite unrelated deployment report');}finally{fs.closeSync(fd);}}
  const temporary=reportPath+'.'+__realProcess.pid+'.tmp';
  const reportFd=fs.openSync(temporary,'wx',0o600);
  try {
    const result = await globalThis.runDeploy(env, config);
    if(result.intentDigest!==intentDigest)throw Error('Deployment report identity mismatch');
    fs.writeFileSync(reportFd,JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),manifest:manifestConfig.deploymentManifest,...result},null,2)+'\n');fs.fsyncSync(reportFd);
    if(reportIdentity()!==previousReport)throw Error('Deployment report changed during deployment');
    fs.renameSync(temporary,reportPath);
    log('Deployment report: '+reportPath,'info');
    log('', 'info');
    log('========================================', 'success');
    log(result.status === 'active' ? '  Deployment complete!' : '  Deployment saved; network settlement pending. Resume with the same settings.', result.status === 'active' ? 'success' : 'info');
    if (result.readyTxHash) log('  Binding transaction: ' + result.readyTxHash, 'info');
    log('  L2 contract: ' + result.l2Addr, 'success');
    log('  L1 portal:   ' + result.portalAddr, 'success');
    log('========================================', 'success');
  } catch (e) {
    const diagnosticPath=path.join(path.dirname(path.resolve(AZTEC_WALLET_PATH)),`deployment-error-${__realProcess.pid}.json`);
    fs.writeFileSync(diagnosticPath,JSON.stringify({name:e?.name,code:e?.code,message:e?.message,stack:e?.stack},null,2)+'\n',{flag:'wx',mode:0o600});
    log('', 'error');
    log(e?.code === 'BB_ETH_RECOVERY_REQUIRED'
      ? 'Ethereum transaction confirmation could not be verified. Its request is saved. Resume the same deployment command to check the original transaction.'
      : 'Deployment did not complete. Preserve its transaction records and check receipts before retrying.', 'error');
    log('Private diagnostic saved: '+diagnosticPath,'error');
    __realProcess.exitCode=1;
  } finally { fs.closeSync(reportFd); if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
}

main().catch(e => { log('Deployment setup failed. Check explicit RPC endpoints and private wallet files.', 'error'); __realProcess.exit(1); });
