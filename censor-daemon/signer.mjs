// Host-side authority. Model output never supplies executable/configuration data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { validateReason } from './moderation.mjs';
import { validatePostId, validateScope, validateFeedEvent } from '../shared/protocol-schema.mjs';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_INDEX = Number.MAX_SAFE_INTEGER;
function exactObject(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected a plain signer request');
  if (Reflect.ownKeys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Unknown or missing signer fields');
  }
}
function index(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INDEX) throw new Error('Invalid post index');
  return value;
}
function policyVersion(value) {
  try { return validatePostId(value); }
  catch { throw new Error('Invalid policy version'); }
}
function deadline(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20 ||
      BigInt(value) > 0xffffffffffffffffn) throw new Error('Invalid flag deadline');
  return value;
}
function realFile(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error(`Invalid ${label} path`);
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}
function parsePosts(stdout) {
  const candidates = stdout.split('\n').map(line => line.trim()).filter(line => line.startsWith('{') && line.includes('"posts"'));
  if (candidates.length !== 1) throw new Error('Expected one JSON post-list response');
  let data;
  try { data = JSON.parse(candidates[0]); }
  catch { throw new Error('Malformed JSON post-list response'); }
  index(data.count);
  const scope=validateScope(data.scope);
  if(!data.checkpoint||!Number.isSafeInteger(data.checkpoint.number)||data.checkpoint.number<1||!/^0x[0-9a-f]{64}$/.test(data.checkpoint.hash))throw new Error('Invalid public feed checkpoint');
  if(!Array.isArray(data.policies)||data.policies.length>10000)throw new Error('Invalid historical policies');
  const policies=data.policies.map(p=>{if(!p||Object.keys(p).sort().join()!=='censorWindow,policyVersion,text'||typeof p.text!=='string'||!p.text.isWellFormed()||!p.text.length||p.text.includes('\0')||Buffer.byteLength(p.text)>1488||typeof p.censorWindow!=='string'||! /^[1-9][0-9]*$/.test(p.censorWindow)||BigInt(p.censorWindow)>0xffffffffn)throw new Error('Invalid historical policy');return Object.freeze({policyVersion:policyVersion(p.policyVersion),text:p.text,censorWindow:p.censorWindow});});
  if(new Set(policies.map(p=>p.policyVersion)).size!==policies.length)throw new Error('Duplicate historical policy');
  if (!Array.isArray(data.posts) || data.posts.length > 10000) throw new Error('Invalid or oversized post list');
  const seen = new Set(), identities = new Set();
  const posts = data.posts.map(post => {
    if (!post || typeof post !== 'object') throw new Error('Invalid post');
    const postIndex = index(post.index);
    if (postIndex >= data.count || seen.has(postIndex)) throw new Error('Invalid or duplicate post index');
    seen.add(postIndex);
    const postId = validatePostId(post.postId);
    if (identities.has(postId)) throw new Error('Duplicate post id');
    identities.add(postId);
    if (typeof post.text !== 'string' || Buffer.byteLength(post.text, 'utf8') > 16384 || typeof post.flagged !== 'boolean') throw new Error('Invalid post fields');
    if (!Number.isSafeInteger(post.timestamp) || post.timestamp < 0) throw new Error('Invalid post timestamp');
    return Object.freeze({ index: postIndex, postId, policyVersion: policyVersion(post.policyVersion), flagDeadline: deadline(post.flagDeadline), text: post.text, flagged: post.flagged, timestamp: post.timestamp,flagEvent:post.flagEvent?validateFeedEvent(post.flagEvent,scope):null });
  });
  if (typeof data.policy !== 'string' || !data.policy.isWellFormed() || data.policy.includes('\0') || Buffer.byteLength(data.policy, 'utf8') > 1488 || !data.policy.length) throw new Error('Invalid policy');
  for (const key of ['censorWindow', 'maxSaveUp']) {
    if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] < 0)) throw new Error(`Invalid ${key}`);
  }
  if(posts.length!==data.count||policies.at(-1)?.policyVersion!==data.policyVersion||policies.at(-1)?.text!==data.policy)throw new Error('Incomplete public policy/post snapshot');
  return Object.freeze({ scope,checkpoint:Object.freeze({...data.checkpoint}),policies:Object.freeze(policies),count: data.count, posts: Object.freeze(posts), policy: data.policy, policyVersion: policyVersion(data.policyVersion),
    censorWindow: data.censorWindow || 0, maxSaveUp: data.maxSaveUp || 0 });
}

export function createSigner(configuration, { run = execFileSync } = {}) {
  exactObject(configuration, ['cliPath', 'censorWallet', 'portalAddress', 'aztecNodeUrl', 'privateFeeConfig', 'ethRpcUrl', 'nodeExecutable'],
    ['cliPath', 'censorWallet', 'portalAddress', 'aztecNodeUrl', 'privateFeeConfig', 'ethRpcUrl']);
  if (typeof run !== 'function') throw new Error('Invalid process runner');
  if (typeof configuration.portalAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(configuration.portalAddress)) throw new Error('Invalid portal address');
  const url = new URL(configuration.aztecNodeUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid Aztec node URL');
  const ethUrl = new URL(configuration.ethRpcUrl);
  if (!['http:', 'https:'].includes(ethUrl.protocol) || ethUrl.username || ethUrl.password || ethUrl.hash) throw new Error('Invalid Ethereum RPC URL');
  const trusted = Object.freeze({
    ethRpcUrl: ethUrl.href,
    nodeExecutable: realFile(configuration.nodeExecutable || process.execPath, 'Node executable'),
    cliPath: realFile(configuration.cliPath, 'CLI'),
    censorWallet: realFile(configuration.censorWallet, 'wallet'),
    privateFeeConfig: realFile(configuration.privateFeeConfig, 'private fee configuration'),
    portalAddress: configuration.portalAddress, aztecNodeUrl: url.href,
  });
  // Do not inherit NODE_OPTIONS, NODE_PATH, preload hooks, loader injection,
  // cloud credentials, or model configuration. Model processes get no such env.
  const env = Object.freeze({ PATH: `${path.dirname(trusted.nodeExecutable)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: os.homedir(), TMPDIR: os.tmpdir(), LANG: 'C.UTF-8' });
  function call(operation, tail) {
    const argv = Object.freeze([trusted.cliPath, operation,
      '--portal-address', trusted.portalAddress, '--censor-wallet', trusted.censorWallet,
      '--node-url', trusted.aztecNodeUrl, '--eth-rpc', trusted.ethRpcUrl, '--private-fee-config', trusted.privateFeeConfig, ...tail]);
    let stdout;
    try {
      stdout = run(trusted.nodeExecutable, argv, { shell: false, encoding: 'utf8',
        timeout: 300000, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, env });
    } catch (error) {
      // Child diagnostics can contain secrets; report only a bounded status.
      const status = Number.isInteger(error.status) ? String(error.status) : error.signal ? 'signal' : 'execution';
      throw new Error(`Signer ${operation} failed (${status})`);
    }
    if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) throw new Error('Invalid or oversized signer output');
    return stdout;
  }
  return Object.freeze({
    list(...args) {
      if (args.length) throw new Error('List does not accept signer request fields');
      return parsePosts(call('list', ['--json']));
    },
    inspectFlag(request) {
      const stdout=this.flag(request,true,true);
      const lines=stdout.split('\n').map(s=>s.trim()).filter(s=>s.startsWith('{')&&s.includes('"billboard-moderation-journal-v1"'));
      if(lines.length!==1)throw new Error('Missing read-only moderator journal outcome');
      const value=JSON.parse(lines[0]);
      if(value.type!=='billboard-moderation-journal-v1'||value.postId!==request.postId||value.policyVersion!==request.policyVersion||!(value.txHash===null||/^0x[0-9a-f]{64}$/.test(value.txHash))||!Array.isArray(value.predecessorTxHashes)||value.predecessorTxHashes.length>8||new Set(value.predecessorTxHashes).size!==value.predecessorTxHashes.length||value.predecessorTxHashes.some(h=>!/^0x[0-9a-f]{64}$/.test(h)||h===value.txHash)||(value.txHash===null&&value.predecessorTxHashes.length))throw new Error('Invalid read-only moderator journal outcome');
      return Object.freeze({txHash:value.txHash,predecessorTxHashes:Object.freeze([...value.predecessorTxHashes])});
    },
    submitFlag(request) {
      const stdout=this.flag(request,true);
      return parseFlagSubmission(stdout,request);
    },
    flag(request, structured=false, inspectOnly=false) {
      exactObject(request, ['postId', 'policyVersion', 'reason']);
      const expectedPolicyVersion = policyVersion(request.policyVersion);
      const postId = validatePostId(request.postId);
      const reason = validateReason(request.reason);
      if (reason.startsWith('--')) throw new Error('Reason must not be a CLI option');
      return call('declare-immoral', [...(structured?['--json']:[]),...(inspectOnly?['--inspect-only']:['--reconcile-previous']), '--post-id', postId, '--expected-policy-version', expectedPolicyVersion, '--censor-response', reason]);
    },
  });
}

export function parseFlagSubmission(stdout,request){
 const candidates=stdout.split('\n').map(s=>s.trim()).filter(s=>s.startsWith('{')&&s.includes('"billboard-moderation-submission-v1"'));
 if(candidates.length!==1)throw new Error('Signer returned no unique structured transaction outcome');
 const value=JSON.parse(candidates[0]),r=value.receipt;
 if(value.type!=='billboard-moderation-submission-v1'||value.postId!==request.postId||value.policyVersion!==request.policyVersion||!r||!/^0x[0-9a-f]{64}$/.test(r.txHash)||!['checkpointed','proven','finalized'].includes(r.status)||r.executionResult!=='success'||!Number.isSafeInteger(r.blockNumber)||r.blockNumber<1||!/^0x[0-9a-f]{64}$/.test(r.blockHash)||!Array.isArray(value.predecessorTxHashes)||value.predecessorTxHashes.length>8||new Set(value.predecessorTxHashes).size!==value.predecessorTxHashes.length||value.predecessorTxHashes.includes(r.txHash)||value.predecessorTxHashes.some(h=>!/^0x[0-9a-f]{64}$/.test(h)))throw new Error('Signer outcome does not match the requested flag');
 return Object.freeze({receipt:Object.freeze({...r}),predecessorTxHashes:Object.freeze([...value.predecessorTxHashes])});
}
