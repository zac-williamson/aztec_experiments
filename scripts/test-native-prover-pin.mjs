import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT,pins,bbBinary} from './toolchain.mjs';

test('every bundled native prover matches its platform checksum',()=>{
 const platforms={'linux-x64':'amd64-linux','linux-arm64':'arm64-linux','darwin-x64':'amd64-macos','darwin-arm64':'arm64-macos'};
 assert.deepEqual(Object.keys(pins.nativeProver).sort(),Object.keys(platforms).sort());
 for(const [platform,directory] of Object.entries(platforms)){
  const bytes=fs.readFileSync(path.join(ROOT,'node_modules/@aztec/bb.js/build',directory,'bb'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pins.nativeProver[platform].sha256,platform);
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
