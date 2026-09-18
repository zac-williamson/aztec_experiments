// Exercise actual browser configuration and CLI file loading without loading a wallet.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const browserSource=fs.readFileSync(new URL('../shared/app-env.js',import.meta.url),'utf8');
const cliSource=fs.readFileSync(new URL('../apps/src/billboard/user/cli.mjs',import.meta.url),'utf8');
const cli=vm.createContext({fs,path});
vm.runInContext(cliSource.slice(cliSource.indexOf('function readPrivateFeeJson('),cliSource.indexOf('main().catch')),cli);
test('CLI reads public configuration and restricted local claim, rejecting links, extra fields, and broad permissions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-private-fee-config-'));
 try {
  const config=path.join(dir,'config.json'),claim=path.join(dir,'claim.json'),link=path.join(dir,'link.json');
  fs.writeFileSync(config,JSON.stringify({contractAddress:'fee',gasSettings:{}}));
  fs.writeFileSync(claim,JSON.stringify({amount:'100',salt:'private',leafIndex:'3'}),{mode:0o600});
  assert.equal(cli.readPrivateFeeJson(config,false).contractAddress,'fee');assert.equal(cli.readPrivateFeeJson(claim,true).salt,'private');
  fs.symlinkSync(claim,link);assert.throws(()=>cli.readPrivateFeeJson(link,true),e=>e.code==='BB_PRIVATE_FEE_CONFIGURATION');
  fs.chmodSync(claim,0o644);assert.throws(()=>cli.readPrivateFeeJson(claim,true),e=>e.code==='BB_PRIVATE_FEE_CONFIGURATION');
  fs.writeFileSync(config,JSON.stringify({contractAddress:'fee',gasSettings:{},issuerUrl:'https://unused.invalid'}));
  assert.throws(()=>cli.readPrivateFeeJson(config,false),e=>e.code==='BB_PRIVATE_FEE_CONFIGURATION');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI keeps ambiguous outcomes actionable without exposing private errors',()=>{
 assert.match(cli.formatCliPrivateFeeFailure({code:'BB_SUBMISSION_UNKNOWN',message:'private'}),/outcome is unknown/);
 assert(!cli.formatCliPrivateFeeFailure({message:'private-wallet-secret'}).includes('private-wallet-secret'));
 assert.match(cli.formatCliPrivateFeeFailure({code:'BB_CLI_PROVER_CONFIGURATION',message:'private'}),/^BB_CLI_PROVER_CONFIGURATION: /);
});

test('CLI diagnostics contain only fixed source locations, never error text or paths',()=>{
 const error={stack:'PRIVATE\n    at execute (billboard-user-engine.js:1123:27)\n    at private (/secret/path/wallet.js:4:5)\n    at again (billboard-user-engine.js:1123:27)'};
 error.cause={stack:'SECRET\n at oracle (billboard-sdk.js:300:12)'};
 assert.deepEqual(Array.from(cli.cliFailureLocations(error)),['billboard-user-engine.js:1123:27','billboard-sdk.js:300:12']);
});

test('Noir diagnostics omit source text and directories',()=>{
 assert.deepEqual(Array.from(cli.cliFailureLocations({noirErrorStack:[{filePath:'/private/build/note_getter.nr',line:12,column:4,fileSource:'PRIVATE',locationText:'PRIVATE'}]})),['note_getter.nr:12:4']);
});
