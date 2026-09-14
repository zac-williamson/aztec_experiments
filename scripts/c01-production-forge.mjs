#!/usr/bin/env node
// Local deployment launcher: use pinned production remapping in SDK-owned temp copy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const forge='/Users/zac/.foundry/bin/forge';
const args=process.argv.slice(2);
const run=(argv,stdio)=>new Promise((resolve,reject)=>{
  const child=spawn(forge,argv,{env:{...process.env,FOUNDRY_PROFILE:'production'},stdio});
  child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?resolve():reject(new Error('Pinned Forge command failed')));
});
try{
  if(args.length===1&&args[0]==='--version'){await run(args,'inherit');}
  else{
    const root=await fs.realpath(process.env.C01_NETWORK_ROOT);
    const cwd=await fs.realpath(process.cwd());
    assert.equal(path.dirname(cwd),root);assert(path.basename(cwd).startsWith('.foundry-deploy-'));
    assert.equal(args[0],'script');assert.equal(args[1],'script/deploy/DeployAztecL1Contracts.s.sol');
    assert(args.includes('--broadcast'));assert(!args.includes('--verify'));
    const rpc=new URL(args[args.indexOf('--rpc-url')+1]);assert.equal(rpc.hostname,'127.0.0.1');
    await fs.writeFile(path.join(root,'deployment-directory.json'),JSON.stringify({directory:cwd,profile:'production'})+'\n',{flag:'wx',mode:0o600});
    await run(['build',args[1],'--force','--offline'],['ignore','ignore','inherit']);
    await run([...args,'--offline'],'inherit');
  }
}catch{process.stderr.write('C01_PRODUCTION_FORGE_FAILED\n');process.exitCode=1;}
