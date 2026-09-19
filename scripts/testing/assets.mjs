import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../toolchain.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fingerprints() {
  const result = {};
  for (const name of ['scripts/application-post.mjs','scripts/t03-repeated-posts.mjs','scripts/o01-censor-command-flow.mjs','scripts/o01-censor-command-io.mjs','scripts/t04-browser-journey.mjs','scripts/t04-browser-journey-verify.mjs','scripts/t04-browser-post-recovery.mjs','scripts/t04-post-response-loss.mjs','scripts/run-bounded-browser-check.mjs','scripts/u01-browser-flow.mjs','scripts/u01-browser-post-verify.mjs','scripts/u01-browser-post.mjs','scripts/browser-error-observer.mjs','scripts/u01-browser-rpc.mjs','scripts/t03-rpc-observer.mjs','scripts/t03-public-footprint.mjs','deploy/hosting-config.mjs','scripts/c01-native-profile.mjs','scripts/test-c01-application.mjs','scripts/owned-test-process-tree.mjs','scripts/c01-settle-application-message.mjs','scripts/c01-application-deployment.mjs',
    'scripts/w03-note-attribution.mjs','shared/application-nullifier.mjs','scripts/w03-proof-recovery.mjs','shared/l2-journal.mjs','shared/transaction-outcomes.mjs','shared/journal-backup.mjs','scripts/prove-application-action.mjs','scripts/w02-wallet-restore.mjs','shared/wallet-backup.js','scripts/w01-private-fee-standalone.mjs','scripts/w01-private-fee-flow.mjs','scripts/w01-private-funding.mjs','shared/private-fee-client.mjs','shared/private-fee-payment.mjs','shared/private-fee-funding.mjs','shared/ethereum-journal.mjs','shared/journal-record.mjs','apps/src/billboard/user/transaction-journal-store.mjs','scripts/c01-settle-ready.mjs','scripts/c01-settle-message.mjs','scripts/c01-bridge-flow.mjs','scripts/c02-screening-flow.mjs','scripts/t02-screening-journey.mjs','scripts/t02-redeposit-flow.mjs','scripts/t02-wrong-origin.mjs','scripts/t02-claim-boundary.mjs','scripts/test-t02-claim-boundary.mjs','node_modules/@aztec/pxe/src/node/caching_aztec_node.ts','node_modules/@aztec/pxe/dest/node/caching_aztec_node.js','node_modules/@aztec/pxe/src/pxe.ts','node_modules/@aztec/pxe/dest/pxe.js','node_modules/@aztec/pxe/src/block_synchronizer/block_synchronizer.ts','node_modules/@aztec/pxe/dest/block_synchronizer/block_synchronizer.js','node_modules/@aztec/l1-artifacts/dest/InboxAbi.js','node_modules/@aztec/l1-artifacts/l1-contracts/src/core/messagebridge/Inbox.sol','scripts/t02-redeposit-replay.mjs','node_modules/@aztec/l1-artifacts/dest/OutboxAbi.js','node_modules/@aztec/l1-artifacts/l1-contracts/src/core/messagebridge/Outbox.sol','scripts/c03-author-claims.mjs','scripts/c03-contention-flow.mjs','scripts/c01-client-mining.mjs','scripts/c01-deposit-flow.mjs','scripts/c01-exit-flow.mjs','scripts/c01-withdraw-l1.mjs','scripts/c01-ready-flow.mjs','scripts/c01-board-inclusion.mjs','scripts/c01-board-flow.mjs','scripts/c01-real-node.mjs','scripts/toolchain.mjs','package-lock.json','toolchain.json',
    'node_modules/@aztec/ethereum/dest/deploy_aztec_l1_contracts.js']) {
    result[name] = sha(await fs.readFile(path.join(ROOT, name)));
  }
  for(const name of await fs.readdir(path.join(ROOT,'scripts/testing'))){
    if(name.endsWith('.mjs'))result['scripts/testing/'+name]=sha(await fs.readFile(path.join(ROOT,'scripts/testing',name)));
  }
  return result;
}
export async function browserFingerprints() {
  const result={};
  async function file(name){const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(ROOT,name)))hash.update(chunk);result[name]=hash.digest('hex');}
  for(const name of ['.build/apps-manifest.json','.build/sdk/sdk-manifest.json'])await file(name);
  async function walk(relative){for(const entry of await fs.readdir(path.join(ROOT,relative),{withFileTypes:true})){assert(!entry.isSymbolicLink(),'Browser asset symlink rejected');const name=relative+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(entry.isFile())await file(name);}}
  await walk('apps/dist');
  const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/apps-manifest.json'),'utf8'));
  for(const [name,digest] of Object.entries(manifest.outputs))assert.equal(result[name],digest,'Browser release output differs from manifest');
  return result;
}
export async function verifyCensorPackage(){
  const descriptor=JSON.parse(await fs.readFile(path.join(ROOT,'.build/o01-operator-package.json'),'utf8'));
  assert.deepEqual(Object.keys(descriptor).sort(),['manifestSha256','root','schemaVersion']);
  assert.equal(descriptor.schemaVersion,1);assert(path.isAbsolute(descriptor.root));
  const root=await fs.realpath(descriptor.root);assert(root.startsWith(path.join(ROOT,'.build')+path.sep));
  const bytes=await fs.readFile(path.join(root,'operator-package.json'));assert.equal(sha(bytes),descriptor.manifestSha256);
  const manifest=JSON.parse(bytes);assert.equal(manifest.profile,'operator');assert(Array.isArray(manifest.files)&&manifest.files.length>0);
  const seen=new Set();
  for(const file of manifest.files){
    assert(typeof file.path==='string'&&!path.isAbsolute(file.path)&&!file.path.split('/').includes('..')&&!seen.has(file.path));seen.add(file.path);
    const filename=path.join(root,file.path);assert.equal(await fs.realpath(filename),filename);assert((await fs.lstat(filename)).isFile());
    const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);assert.equal(hash.digest('hex'),file.sha256);
  }
  for(const name of ['scripts/operator-launch.sh','scripts/operator-launch.mjs','toolchain.json','apps/src/billboard/user/cli.mjs','apps/src/billboard/user/engine.js','shared/public-app-config.js','.build/sdk/sdk-manifest.json','crs-manifest.json']){
    assert(seen.has(name));assert.equal(sha(await fs.readFile(path.join(root,name))),sha(await fs.readFile(path.join(ROOT,name))));
  }
  return {root,manifestSha256:sha(bytes),verifiedFiles:seen.size};
}

export async function prepareRuntime(directory,scenario,report) {
    const crs=path.join(directory,'crs');await fs.mkdir(crs);
    const manifestBytes=await fs.readFile(path.join(ROOT,'crs-manifest.json'));
    assert.equal(sha(manifestBytes),'4927de3e03d69f4e640a841f9421dd0b93819b5e3d42c142d12ee079d5a402be');
    const manifest=JSON.parse(manifestBytes);
    report.setup=[];
    for(const [entry,name] of [[manifest.derivedG1,'bn254_g1.dat'],[manifest.files.find(f=>f.name==='g2.dat'),'bn254_g2.dat'],[manifest.files.find(f=>f.name==='grumpkin_g1.dat'),'grumpkin_g1_v2.flat.dat']]){
      const bytes=await fs.readFile(path.join(ROOT,'apps/dist/crs',entry.name));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
      await fs.writeFile(path.join(crs,name),bytes,{flag:'wx',mode:0o400});report.setup.push({name,sha256:entry.sha256,bytes:entry.bytes});
    }
    const bb=path.join(ROOT,'node_modules/@aztec/bb.js/build/arm64-macos/bb');
    const binarySha=sha(await fs.readFile(bb));
    assert.equal(binarySha,'208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031');
    report.networkProofs=false;report.controlledSettlement=scenario.fixture==='activated-board';report.binarySha256=binarySha;
    assert(!bb.includes("'"));
    await fs.writeFile(path.join(directory,'bb-one-thread'),"#!/bin/sh\nHARDWARE_CONCURRENCY=1 exec '"+bb+"' \"$@\"\n",{flag:'wx',mode:0o700});
    const applicationThreads=scenario.applicationThreads;
    if(applicationThreads===2)await fs.writeFile(path.join(directory,'bb-two-threads'),"#!/bin/sh\nHARDWARE_CONCURRENCY=2 exec '"+bb+"' \"$@\"\n",{flag:'wx',mode:0o700});
    report.applicationBBThreads=applicationThreads;report.nodeBBThreads=1;report.worldStateHardwareConcurrency=1;
    await fs.mkdir(path.join(directory,'acvm'),{mode:0o700});
    const profile=path.join(directory,'local-only.sb');
    await fs.writeFile(profile, '(version 1)\n(allow default)\n(deny network-outbound (remote ip "*:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny network-inbound (local ip "*:*"))\n(allow network-inbound (local ip "localhost:*"))\n');
    return {crs,profile};
}
