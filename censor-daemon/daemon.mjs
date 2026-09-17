#!/usr/bin/env node
import {assertOperatorEnvironment} from '../scripts/operator-launch.mjs';
if(process.env.BILLBOARD_OPERATOR_PROFILE==='1')assertOperatorEnvironment();
// Host orchestrator. Production model execution always uses the isolated runtime.
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {scopeKey} from '../shared/protocol-schema.mjs';
import {publicNode} from '../shared/public-feed-rpc.mjs';
import {openJobStore} from './job-store.mjs';
import {processModerationCycle} from './worker.mjs';
import {identifyModel} from './model-version.mjs';
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
  'model-image', 'model-manifest', 'model-memory-mib', 'model-sha256', 'private-fee-config', 'eth-rpc', 'state-dir']);
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
  if(args.from!==undefined&&args.from!=='0')throw new Error('--from cannot skip durable jobs; use a separate explicitly scoped state directory.');
  if (args.policy) throw new Error('--policy is unsupported: moderation requires the exact contract policy');
  if (!args['portal-address']) throw new Error('--portal-address is required');
  if (!args['eth-rpc']) throw new Error('--eth-rpc is required');
  if (!args['private-fee-config']) throw new Error('--private-fee-config is required');
  return Object.freeze({
    stateDir:path.resolve(args['state-dir']||path.join(root,'.moderation-state')),
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
    modelMemoryMiB:integer(args['model-memory-mib'],4096,512,32768,'model memory'),
    modelImage: args['model-image'], modelManifest:args['model-manifest']?path.resolve(args['model-manifest']):undefined, modelSha256: args['model-sha256'],
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
function persistModelIdentity(directory,runtime){
  if(!Buffer.isBuffer(runtime.configurationBytes)||!Buffer.isBuffer(runtime.promptBytes)||runtime.configurationBytes.length>1024*1024||runtime.promptBytes.length>1024*1024)throw new Error('Exact model configuration and prompt bytes are required');
  const identity=identifyModel({...runtime.modelIdentity,configurationBytes:runtime.configurationBytes,promptBytes:runtime.promptBytes});
  if(identity.modelVersion!==runtime.modelIdentity?.modelVersion)throw new Error('Model content identity mismatch');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('Moderation state requires a private directory');
  for(const [suffix,bytes] of [['runtime.json',runtime.configurationBytes],['prompt.json',runtime.promptBytes],['identity.json',Buffer.from(JSON.stringify(identity,null,2)+'\n')]]){
    const name=path.join(directory,identity.modelVersion.slice(2)+'-'+suffix);
    let fd;try{fd=fs.openSync(name,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;const existing=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(existing);if(!st.isFile()||st.size!==bytes.length||!fs.readFileSync(existing).equals(bytes))throw new Error('Saved model identity bytes changed');}finally{fs.closeSync(existing);}}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  return identity;
}
export async function runDaemon(argv = process.argv.slice(2), { startRuntime = startModelRuntime,createNode=publicNode } = {}) {
  assertNodeVersion();
  const config=configuration(argv),signer=createSigner({cliPath:config.cliPath,censorWallet:config.censorWallet,portalAddress:config.portalAddress,aztecNodeUrl:config.aztecNodeUrl,privateFeeConfig:config.privateFeeConfig,ethRpcUrl:config.ethRpcUrl});
  let runtime,store,storeScope,stopping=false;const wait=new AbortController(),worker=randomUUID();
  const shutdown=()=>{stopping=true;wait.abort();};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  try{
    log('Starting isolated model runtime and durable moderation queue.');
    const startup=new AbortController(),startupTimer=setTimeout(()=>startup.abort(Error('Model startup deadline')),120000);
    try{runtime=await startRuntime({image:config.modelImage,memoryMiB:config.modelMemoryMiB,imageManifestPath:config.modelManifest,modelPath:config.modelPath,modelSha256:config.modelSha256,port:config.llamaPort,threads:config.threads,ctxSize:config.ctxSize,signal:AbortSignal.any([wait.signal,startup.signal])});}
    finally{clearTimeout(startupTimer);}
    const identity=persistModelIdentity(config.stateDir,runtime),node=createNode(config.aztecNodeUrl);
    do {
      let complete=false;
      try{
        if(!store){const data=signer.list(),id=createHash('sha256').update(scopeKey(data.scope)).digest('hex');store=openJobStore({filename:path.join(config.stateDir,id+'.sqlite'),scope:data.scope,modelVersion:identity.modelVersion});storeScope=data.scope;}
        const result=await processModerationCycle({store,signer,node,scope:storeScope,worker,log,dryRun:config.dryRun,stopping:()=>stopping,evaluate:(post,policy)=>moderatePost(post,policy,runtime.port)});
        complete=result.complete;log('Moderation queue: '+JSON.stringify(result.status.counts));
      }catch(error){log('Moderation cycle remains unresolved: '+(error.code||'FAILED')+': '+error.message,'error');}
      if(config.once){if(!complete)throw new Error('Moderation jobs remain unresolved or require attention; saved work will resume next run');log('All posts processed (--once mode).');break;}
      if(!stopping)await delay(config.pollInterval*1000,undefined,{signal:wait.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
    }while(!stopping);
  }finally{process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);store?.close();if(runtime)await runtime.stop();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDaemon().catch(error => { log('FATAL: ' + error.message, 'error'); process.exitCode = 1; });
}
