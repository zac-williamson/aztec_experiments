import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createSigner, parseFlagSubmission } from './signer.mjs';
import { parseVerdict } from './moderation.mjs';

const id = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const portal = '0x' + '12'.repeat(20);
const scope = {l1ChainId:'31337',rollupAddress:'0x'+'23'.repeat(20),rollupVersion:'1',boardAddress:id(4),portalAddress:portal};
const validList = { scope, checkpoint:{number:10,hash:id(10)}, policies:[{policyVersion:id(9),text:'No spam',censorWindow:'3600'}], count: 1, posts: [{ index: 0, postId: id(1), policyVersion: id(9), flagDeadline: '3601', text: 'post', flagged: false, timestamp: 1, flagEvent:null }], policy: 'No spam', policyVersion: id(9), censorWindow: 3600, maxSaveUp: 16 };
function fixture(t, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billboard-signer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cliPath = path.join(root, "argv 'quotes' $(inert) script.mjs");
  const censorWallet = path.join(root, 'disposable-wallet-fixture.json');
  fs.writeFileSync(cliPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  fs.writeFileSync(censorWallet, '{}\n');
  const privateFeeConfig = path.join(root, "fee config 'quoted' $(inert).json");
  fs.writeFileSync(privateFeeConfig, '{}\n');
  const config = { cliPath, censorWallet, privateFeeConfig, ethRpcUrl: 'http://127.0.0.1:8545', portalAddress: portal, aztecNodeUrl: 'http://127.0.0.1:5080' };
  return { config, root, signer: createSigner(config, run ? { run } : {}) };
}

for (const reason of ["Quotes ' and \" stay data", '`echo harmless`', '$(echo harmless)', '${HOME}; true', 'safe; # command-looking comment']) {
  test('real argv-echo process preserves one inert reason argument: ' + reason, t => {
    const { signer, config } = fixture(t);
    const argv = JSON.parse(signer.flag({ policyVersion: id(9), postId: id(5), reason }));
    assert.deepEqual(argv, ['declare-immoral', '--portal-address', portal, '--censor-wallet', fs.realpathSync(config.censorWallet), '--node-url', 'http://127.0.0.1:5080/', '--eth-rpc', 'http://127.0.0.1:8545/', '--private-fee-config', fs.realpathSync(config.privateFeeConfig), '--reconcile-previous', '--post-id', id(5), '--expected-policy-version', id(9), '--censor-response', reason]);
  });
}

test('executable, operation, argv and execution limits are chosen by signer', t => {
  const calls = [];
  const { signer, config } = fixture(t, (...args) => { calls.push(args); return 'done'; });
  signer.flag({ policyVersion: id(9), postId: id(1), reason: '1 - Spam' });
  const [executable, argv, options] = calls[0];
  assert.equal(executable, fs.realpathSync(process.execPath));
  assert.equal(argv[0], fs.realpathSync(config.cliPath));
  assert.equal(argv[1], 'declare-immoral');
  assert.equal(options.shell, false);
  assert.equal(options.timeout, 300000);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.maxBuffer, 10 * 1024 * 1024);
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'PATH', 'TMPDIR']);
  assert.ok(Object.isFrozen(argv));
  assert.ok(Object.isFrozen(options.env));
});

test('startup config mutation cannot redirect later flags', t => {
  const calls = [];
  const { signer, config } = fixture(t, (...args) => { calls.push(args); return 'done'; });
  const original = { ...config };
  config.privateFeeConfig = '/bad/fee-config'; config.ethRpcUrl = 'http://wrong.example';
  config.cliPath = '/bad/command'; config.censorWallet = '/bad/wallet';
  config.portalAddress = '0x' + '99'.repeat(20); config.aztecNodeUrl = 'http://example.com';
  signer.flag({ policyVersion: id(9), postId: id(2), reason: '1 - Spam' });
  const argv = calls[0][1];
  assert.equal(argv[0], fs.realpathSync(original.cliPath));
  assert.equal(argv[argv.indexOf('--censor-wallet') + 1], fs.realpathSync(original.censorWallet));
  assert.equal(argv[argv.indexOf('--portal-address') + 1], original.portalAddress);
  assert.equal(argv[argv.indexOf('--node-url') + 1], 'http://127.0.0.1:5080/');
  assert.equal(argv[argv.indexOf('--private-fee-config') + 1], fs.realpathSync(original.privateFeeConfig));
  assert.equal(argv[argv.indexOf('--eth-rpc') + 1], 'http://127.0.0.1:8545/');
  assert(!argv.includes('--private-fee-claim-file'));
  assert.ok(Object.isFrozen(signer));
  assert.deepEqual(Object.keys(signer).sort(), ['flag', 'inspectFlag', 'list', 'submitFlag']);
});

test('host loader environment is not passed to the actual child', t => {
  const { signer } = fixture(t);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=/nonexistent-billboard-fixture-module';
  try { assert.equal(JSON.parse(signer.flag({ policyVersion: id(9), postId: id(2), reason: '1 - Spam' }))[0], 'declare-immoral'); }
  finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
});

for (const field of ['operation', 'command', 'wallet', 'destination', 'cliPath', 'nodeExecutable', 'censorWallet', 'privateFeeConfig', 'ethRpcUrl', 'privateFeeClaim', 'private-fee-claim-file', 'reconcilePrevious', 'acknowledgeTx']) {
  test('flag rejects model-controlled ' + field + ' without invoking a process', t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ policyVersion: id(9), postId: id(1), reason: '1 - Spam', [field]: 'untrusted' }), /Unknown or missing signer fields/);
    assert.equal(calls, 0);
  });
}
for (const postId of [-1, 0x100000000, 1.5, Number.NaN, Infinity, '1', '1 --node-url', null, undefined, {}, 1n, id(0), id(21888242871839275222246405745257275088548364400416034343698204186575808495617n)]) {
  test('invalid or incorrectly typed post id rejected: ' + String(postId), t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ policyVersion: id(9), postId, reason: '1 - Spam' }), /Invalid post id/);
    assert.equal(calls, 0);
  });
}
test('full Field identity stays exact in signer argv', t => {
  const { signer } = fixture(t);
  const postId = id(21888242871839275222246405745257275088548364400416034343698204186575808495616n);
  const argv = JSON.parse(signer.flag({ policyVersion: id(9), postId, reason: '1 - Spam' }));
  assert.equal(argv[argv.indexOf('--post-id') + 1], postId);
});
for (const reason of ['line\nbreak', 'tab\tdata', 'nul\0data', '\x1b[31mtext', '--node-url', ' --censor-wallet', 'é'.repeat(101), '', null, {}, 123]) {
  test('unsafe or oversized reason rejected before process call: ' + JSON.stringify(reason), t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ policyVersion: id(9), postId: id(1), reason }));
    assert.equal(calls, 0);
  });
}

test('JSON model output cannot override host-selected post index', t => {
  let calls = 0;
  const { signer } = fixture(t, () => { calls++; return 'done'; });
  assert.throws(() => {
    const verdict = parseVerdict('{"isViolation":true,"reason":"1 - Spam","postIndex":99}');
    signer.flag({ policyVersion: id(9), postId: id(1), reason: verdict.reason });
  });
  assert.equal(calls, 0);
});

test('list validates data and projects away untrusted extra fields', t => {
  const raw = { ...validList, operation: 'flag', wallet: '/bad', posts: [{ ...validList.posts[0], destination: '/bad' }] };
  const { signer } = fixture(t, (_file, args) => { assert.equal(args[1], 'list'); assert.equal(args.at(-1), '--json'); return 'ordinary CLI log\n' + JSON.stringify(raw) + '\n'; });
  const data = signer.list();
  assert.deepEqual(data, validList);
  assert.ok(Object.isFrozen(data)); assert.ok(Object.isFrozen(data.posts)); assert.ok(Object.isFrozen(data.posts[0]));
});
for (const [label, raw] of [
  ['malformed JSON', '{"posts":'],
  ['multiple candidate JSON records', JSON.stringify(validList) + '\n' + JSON.stringify(validList)],
  ['missing identity', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], postId: undefined }] })],
  ['zero identity', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], postId: id(0) }] })],
  ['duplicate identities', JSON.stringify({ ...validList, count: 2, posts: [validList.posts[0], { ...validList.posts[0], index: 1 }] })],
  ['string index', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], index: '0' }] })],
  ['index outside count', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], index: 1 }] })],
  ['duplicate indices', JSON.stringify({ ...validList, posts: [validList.posts[0], validList.posts[0]] })],
  ['string flag', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], flagged: 'false' }] })],
  ['nonstring post', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], text: {} }] })],
  ['negative timestamp', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], timestamp: -1 }] })],
  ['oversize post text', JSON.stringify({ ...validList, posts: [{ ...validList.posts[0], text: 'é'.repeat(8193) }] })],
]) {
  test('invalid list response rejected: ' + label, t => {
    const { signer } = fixture(t, () => raw);
    assert.throws(() => signer.list());
  });
}
for (const response of [null, new Uint8Array([1]), 'a'.repeat(10 * 1024 * 1024 + 1)]) {
  test('invalid or oversized process output rejected: ' + typeof response, t => {
    const { signer } = fixture(t, () => response);
    assert.throws(() => signer.flag({ policyVersion: id(9), postId: id(1), reason: '1 - Spam' }), /Invalid or oversized signer output/);
  });
}
test('process timeout is observable without reflecting child diagnostics', t => {
  const { signer } = fixture(t, () => { const error = new Error('fixture-private-diagnostic'); error.signal = 'SIGKILL'; error.stdout = 'fixture-private-diagnostic'; error.stderr = 'fixture-private-diagnostic'; throw error; });
  assert.throws(() => signer.flag({ policyVersion: id(9), postId: id(1), reason: '1 - Spam' }), error => /Signer declare-immoral failed/.test(error.message) && !error.message.includes('fixture-private'));
});

for (const policyVersion of [undefined, null, '1', id(0), id(21888242871839275222246405745257275088548364400416034343698204186575808495617n)]) {
  test('invalid policy version rejected before signing: ' + policyVersion, t => {
    let calls = 0;
    const { signer } = fixture(t, () => { calls++; return 'done'; });
    assert.throws(() => signer.flag({ postId: id(1), policyVersion, reason: 'Spam' }), /Invalid policy version/);
    assert.equal(calls, 0);
  });
}
for (const change of [
  { policyVersion: undefined }, { policy: '' },
  { posts: [{ ...validList.posts[0], policyVersion: undefined }] },
  ...['01', '-1', '18446744073709551616', 100].map(flagDeadline => ({ posts: [{ ...validList.posts[0], flagDeadline }] })),
]) {
  test('missing policy or invalid deadline fails closed: ' + JSON.stringify(change), t => {
    const { signer } = fixture(t, () => JSON.stringify({ ...validList, ...change }));
    assert.throws(() => signer.list());
  });
}

for (const invalid of [undefined, '/nonexistent/billboard-fee-config', '.']) {
  test('missing or invalid fee configuration rejected at signer startup: ' + invalid, t => {
    const { config } = fixture(t);
    assert.throws(() => createSigner({ ...config, privateFeeConfig: invalid }));
  });
}

for (const ethRpcUrl of [undefined, 'file:///tmp/rpc', 'http://name:secret@localhost/', 'http://localhost/#secret']) {
  test('invalid Ethereum RPC rejected at signer startup', t => {
    const { config } = fixture(t);
    assert.throws(() => createSigner({ ...config, ethRpcUrl }));
  });
}

const request={postId:id(1),policyVersion:id(9),reason:'Spam'};
const submission={type:'billboard-moderation-submission-v1',postId:id(1),policyVersion:id(9),receipt:{txHash:id(40),status:'checkpointed',executionResult:'success',blockNumber:10,blockHash:id(10)},predecessorTxHashes:[id(39)]};
test('raw flag preserves stdout while submitFlag requests and validates structured outcome',t=>{
 const output='ordinary diagnostic\n'+JSON.stringify(submission)+'\n';
 const calls=[];const {signer}=fixture(t,(_file,args)=>{calls.push(args);return output;});
 assert.equal(signer.flag(request),output);
 const result=signer.submitFlag(request);
 assert.deepEqual(result,{receipt:submission.receipt,predecessorTxHashes:[id(39)]});
 assert(!calls[0].includes('--json'));assert(calls[1].includes('--json'));
 assert(Object.isFrozen(result));assert(Object.isFrozen(result.receipt));assert(Object.isFrozen(result.predecessorTxHashes));
});
for(const [label,change] of [
 ['wrong post',{postId:id(2)}],['wrong policy',{policyVersion:id(8)}],
 ['missing predecessors',{predecessorTxHashes:undefined}],['bad predecessor',{predecessorTxHashes:['bad']}],
 ['too many predecessors',{predecessorTxHashes:Array.from({length:9},(_,i)=>id(100+i))}],
 ['duplicate predecessor',{predecessorTxHashes:[id(39),id(39)]}],['current hash predecessor',{predecessorTxHashes:[id(40)]}],
 ...[{status:'pending'},{status:'dropped'},{status:'unknown'},{executionResult:'reverted'},{executionResult:undefined},{txHash:'bad'},{blockHash:'bad'},{blockNumber:0},{blockNumber:'10'}].map(r=>[JSON.stringify(r),{receipt:{...submission.receipt,...r}}]),
])test('structured flag outcome rejects '+label,()=>assert.throws(()=>parseFlagSubmission(JSON.stringify({...submission,...change}),request)));
for(const output of ['', 'not JSON', '{"type":"billboard-moderation-submission-v1",', JSON.stringify(submission)+'\n'+JSON.stringify(submission)])
 test('structured flag outcome rejects malformed or ambiguous envelope: '+output.slice(0,35),()=>assert.throws(()=>parseFlagSubmission(output,request)));
for(const status of ['checkpointed','proven','finalized'])test('structured successful inclusion accepts '+status,()=>{
 const value={...submission,receipt:{...submission.receipt,status}};
 assert.equal(parseFlagSubmission(JSON.stringify(value),request).receipt.status,status);
});
for(const [label,change] of [
 ['missing scope',{scope:undefined}],['missing checkpoint',{checkpoint:undefined}],['missing policies',{policies:undefined}],
 ['duplicate policies',{policies:[validList.policies[0],validList.policies[0]]}],
 ['missing timestamp',{posts:[{...validList.posts[0],timestamp:undefined}]}],
 ['incomplete snapshot',{count:2}],['wrong current policy',{policy:'Other'}],
])test('list rejects incomplete trusted snapshot '+label,t=>{const {signer}=fixture(t,()=>JSON.stringify({...validList,...change}));assert.throws(()=>signer.list());});
test('historical policy is retained for posts from earlier policy version',t=>{
 const raw={...validList,policyVersion:id(11),policy:'New policy',policies:[...validList.policies,{policyVersion:id(11),text:'New policy',censorWindow:'3600'}]};
 const {signer}=fixture(t,()=>JSON.stringify(raw));const data=signer.list();
 assert.equal(data.posts[0].policyVersion,id(9));assert.deepEqual(data.policies,raw.policies);
 assert(Object.isFrozen(data.policies));assert(Object.isFrozen(data.policies[0]));
});

const journalOutcome={type:'billboard-moderation-journal-v1',postId:id(1),policyVersion:id(9),txHash:id(40),predecessorTxHashes:[id(39)]};
test('inspectFlag uses read-only CLI branch without reconciliation',t=>{
 const {signer}=fixture(t,(_file,args)=>{assert(args.includes('--inspect-only'));assert(args.includes('--json'));assert(!args.includes('--reconcile-previous'));return JSON.stringify(journalOutcome);});
 assert.deepEqual(signer.inspectFlag(request),{txHash:id(40),predecessorTxHashes:[id(39)]});
});
test('inspectFlag accepts empty authenticated journal',t=>{const {signer}=fixture(t,()=>JSON.stringify({...journalOutcome,txHash:null,predecessorTxHashes:[]}));assert.equal(signer.inspectFlag(request).txHash,null);});
for(const change of [{postId:id(2)},{policyVersion:id(2)},{txHash:'bad'},{txHash:undefined},{txHash:null},{predecessorTxHashes:[id(40)]},{predecessorTxHashes:[id(39),id(39)]},{predecessorTxHashes:['bad']},{predecessorTxHashes:Array.from({length:9},(_,i)=>id(50+i))}])test('inspectFlag rejects malformed/mismatched journal '+JSON.stringify(change),t=>{const {signer}=fixture(t,()=>JSON.stringify({...journalOutcome,...change}));assert.throws(()=>signer.inspectFlag(request));});
for(const output of ['garbage','{"type":"billboard-moderation-journal-v1",',JSON.stringify(journalOutcome)+'\n'+JSON.stringify(journalOutcome)])test('inspectFlag rejects ambiguous or malformed output',t=>{const {signer}=fixture(t,()=>output);assert.throws(()=>signer.inspectFlag(request));});

test('operator signer retains clean profile in actual child and rejects alternate executable', t => {
  const keys=['BILLBOARD_OPERATOR_PROFILE','OTEL_SDK_DISABLED','OTEL_PROPAGATORS','NODE_OPTIONS','NODE_PATH',...Object.keys(process.env).filter(k=>k.startsWith('OTEL_'))];
  const saved=new Map([...new Set(keys)].map(k=>[k,process.env[k]]));
  try {
    for(const key of saved.keys())delete process.env[key];
    Object.assign(process.env,{BILLBOARD_OPERATOR_PROFILE:'1',OTEL_SDK_DISABLED:'true',OTEL_PROPAGATORS:'none'});
    const {config}=fixture(t);
    fs.writeFileSync(config.cliPath,'console.log(JSON.stringify({profile:process.env.BILLBOARD_OPERATOR_PROFILE,disabled:process.env.OTEL_SDK_DISABLED,propagators:process.env.OTEL_PROPAGATORS,options:process.env.NODE_OPTIONS??null,modulePath:process.env.NODE_PATH??null,flags:process.execArgv}));\n');
    const output=JSON.parse(createSigner(config).flag({policyVersion:id(9),postId:id(5),reason:'Spam'}));
    assert.deepEqual(output,{profile:'1',disabled:'true',propagators:'none',options:null,modulePath:null,flags:[]});
    assert.throws(()=>createSigner({...config,nodeExecutable:'/bin/sh'}),/must use packaged Node/);
    process.env.OTEL_PROPAGATORS='baggage';
    assert.throws(()=>createSigner(config),/supported shell operator launcher/);
  } finally {
    for(const [key,value] of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
