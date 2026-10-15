import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT,pins,bbBinary} from './toolchain.mjs';

// Package inventory is not runtime qualification. The exact rc6 registry archive
// was checked against the committed npm SHA512 before these four member hashes
// were recorded; see G13/native-prover-platform-check/official-package-inventory.
const inventory={
 'linux-x64':{directory:'amd64-linux',sha256:'fa4b12adaefd5684b53b802346b9fe839ab3d6a4a829a5ea4efd6bd200e0829f'},
 'linux-arm64':{directory:'arm64-linux',sha256:'83645bab6e43d3ea6ec65634d31d11490b1150190d6696206f2a7b8e1e0d79e0'},
 'darwin-x64':{directory:'amd64-macos',sha256:'170d938cdd0d480d99bf51f3ef044c85ab8cc9b8dea897119d2c8521167366b5'},
 'darwin-arm64':{directory:'arm64-macos',sha256:'8acdba0ecf928087e60bdca0206a508f109e7b62ca621b08fa62263509090217'},
};
test('every bundled native prover matches its integrity-locked package checksum',()=>{
 const lock=JSON.parse(fs.readFileSync(path.join(ROOT,'package-lock.json'),'utf8')).packages['node_modules/@aztec-foundation/bb.js'];
 assert.equal(lock.version,'6.0.0-rc.6');
 assert.equal(lock.resolved,'https://registry.npmjs.org/@aztec-foundation/bb.js/-/bb.js-6.0.0-rc.6.tgz');
 assert.equal(lock.integrity,'sha512-xDMJKYUKpYxHAtrC48m+wQKN3bWM7muX6et/OZUbQC5AzoezT5ePeTnYKYeOYQQvLgdNHv/nYJVLRvG/Bn63yg==');
 const installed=path.join(ROOT,'node_modules/@aztec-foundation/bb.js');
 assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8')).version,lock.version);
 assert.equal(pins.nativeProverPackage,lock.version);
 assert.equal(pins.aztecPackages['@aztec-foundation/bb.js'],lock.version);
 assert.deepEqual(fs.readdirSync(path.join(installed,'build')).sort(),Object.values(inventory).map(v=>v.directory).sort());
 for(const [platform,{directory,sha256}] of Object.entries(inventory)){
  const bytes=fs.readFileSync(path.join(installed,'build',directory,'bb'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,platform);
 }
 // b3f5f6b qualified Darwin arm64; ae1a220 added the measured Linux x64 pin.
 // Bundled Intel macOS and Linux ARM64 binaries remain unqualified to execute.
 assert.deepEqual(Object.keys(pins.nativeProver).sort(),['darwin-arm64','linux-x64']);
 for(const [platform,pin] of Object.entries(pins.nativeProver)){
  assert.equal(pin.sha256,inventory[platform].sha256,platform);assert.equal(pin.version,lock.version,platform);
 }
 assert(bbBinary());
});

test('BB override cannot execute a version-spoofing binary before hash validation',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prover-pin-'));
 try{
  const binary=path.join(directory,'bb'),marker=path.join(directory,'executed');
  fs.writeFileSync(binary,'#!/bin/sh\ntouch "'+marker+'"\nprintf "'+pins.aztec+'\\n"\n',{mode:0o700});
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e','import {bbBinary} from "./scripts/toolchain.mjs"; bbBinary();'],{cwd:ROOT,env:{...process.env,BB:binary},stdio:'pipe'}),error=>error.stderr.toString().includes('Native prover checksum mismatch'));
  assert.equal(fs.existsSync(marker),false,'Untrusted override must not execute');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('remote runtime rejects a version-spoofing executable before running it',async()=>{const {resolveNativeProver}=await import('../prover/native-binary.mjs');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'remote-prover-pin-'));try{const binary=path.join(directory,'bb'),marker=path.join(directory,'executed');fs.writeFileSync(binary,'#!/bin/sh\ntouch "'+marker+'"\nprintf "'+pins.aztec+'\\n"\n',{mode:0o700});assert.throws(()=>resolveNativeProver(binary),/checksum mismatch/);assert.equal(fs.existsSync(marker),false);}finally{fs.rmSync(directory,{recursive:true,force:true});}});

test('missing host qualification rejects both local and remote overrides before execution',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'missing-prover-pin-'));
 try{
  const binary=path.join(directory,'bb'),marker=path.join(directory,'executed');
  fs.writeFileSync(binary,'#!/bin/sh\ntouch "'+marker+'"\n',{mode:0o700});
  execFileSync(process.execPath,['--input-type=module','-e',`
   import assert from 'node:assert/strict';
   import {pins,bbBinary} from './scripts/toolchain.mjs';
   import {resolveNativeProver} from './prover/native-binary.mjs';
   delete pins.nativeProver[process.platform+'-'+process.arch];
   assert.throws(()=>bbBinary(),/Unsupported native prover platform/);
   assert.throws(()=>resolveNativeProver(process.env.BB),/checksum mismatch/);
  `],{cwd:ROOT,env:{...process.env,BB:binary},stdio:'pipe'});
  assert.equal(fs.existsSync(marker),false,'Missing qualification must never execute a bundled or override binary');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
