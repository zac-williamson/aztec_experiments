import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {githubToolbox} from '../github-tools.mjs';

test('PR publication uses checked-out commit and preserves executable files',async()=>{
 let work;const calls=[];
 const runCommand=async(command,args)=>{
  assert.equal(command,'git');
  if(args[0]==='clone'){work=args.at(-1);await fs.mkdir(work);await fs.writeFile(path.join(work,'script.sh'),'old');await fs.chmod(path.join(work,'script.sh'),0o755);return {stdout:''};}
  if(args[0]==='rev-parse')return {stdout:'checkout-sha\n'};
  if(args[0]==='status')return {stdout:' M script.sh\0?? new.txt\0'};
  throw Error('Unexpected command');
 };
 const api=async(method,route,body)=>{
  calls.push({method,route,body});
  if(route==='/repos/owner/project')return {default_branch:'main'};
  if(route.endsWith('/git/commits/checkout-sha'))return {tree:{sha:'base-tree'}};
  if(route.endsWith('/pulls'))return {html_url:'https://github.com/owner/project/pull/1'};
  return {sha:'created-sha'};
 };
 const session=await githubToolbox({repository:'owner/project',api,runCommand,allowWrites:true}).open({postId:'0x123'});
 try{
  await session.call('write_file',{path:'script.sh',content:'new'});
  await session.call('write_file',{path:'new.txt',content:'new file'});
  await assert.rejects(session.call('write_file',{path:'../escape',content:'x'}),/outside/);
  const result=await session.call('create_pr',{title:'Change',body:'Test'});assert(result.url.endsWith('/1'));
  const tree=calls.find(x=>x.route.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree,'base-tree');assert.equal(tree.tree[0].mode,'100755');
  assert.deepEqual(calls.find(x=>x.route.endsWith('/git/commits')).body.parents,['checkout-sha']);
  assert.equal(calls.find(x=>x.route.endsWith('/pulls')).body.base,'main');
  await assert.rejects(session.call('create_pr',{title:'Again',body:''}),/One PR/);
 }finally{await session.close();}
 await assert.rejects(fs.stat(work),{code:'ENOENT'});
});

test('failed GitHub initialization removes its fresh checkout',async()=>{
 let work;
 const toolbox=githubToolbox({repository:'owner/project',api:async()=>{throw Error('unavailable');},runCommand:async(_,args)=>{work=args.at(-1);await fs.mkdir(work);}});
 await assert.rejects(toolbox.open({postId:'0x1'}),/unavailable/);
 await assert.rejects(fs.stat(work),{code:'ENOENT'});
});
