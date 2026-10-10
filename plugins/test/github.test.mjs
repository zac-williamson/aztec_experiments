import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {githubToolbox} from '../github-tools.mjs';
import {createAgent} from '../agent.mjs';
const checkoutApi=async(_method,route)=>{
 if(route.includes('/git/commits/'))return {tree:{sha:'base-tree'}};
 if(route.endsWith('/git/trees/base-tree?recursive=1'))return {sha:'base-tree',truncated:false,tree:[]};
 return {default_branch:'main'};
};

test('plain replies need no repository checkout or API request',async()=>{
 let clones=0;
 const toolbox=githubToolbox({repository:'owner/project',api:async()=>assert.fail('No repository API needed'),runCommand:async()=>{clones++;throw Error('Clone unavailable');}});
 const agent=createAgent({toolbox,instructions:'Help',model:{complete:async()=>({message:{role:'assistant',content:'V6 testnet plugin works.'}})}});
 assert.deepEqual(await agent.run({postId:'0x1',text:'Reply without tools'}),{replyText:'V6 testnet plugin works.'});
 assert.equal(clones,0);
});

test('filesystem tools share one checkout and a failed clone is never retried',async()=>{
 for(const fail of [false,true]){
  let work,clones=0;
  const toolbox=githubToolbox({repository:'owner/project',api:checkoutApi,runCommand:async(_,args)=>{
   if(args[0]==='clone'){clones++;work=args.at(-1);await fs.mkdir(work);if(fail)throw Error('Clone unavailable');await fs.writeFile(path.join(work,'file.txt'),'content');return {stdout:''};}
   if(args[0]==='rev-parse')return {stdout:'sha\n'};
   if(args[0]==='sparse-checkout'||args[0]==='checkout')return {stdout:''};
   throw Error('Unexpected command');
  }});
  const session=await toolbox.open({postId:'0x1'});
  try{
   assert.equal(clones,0);
   for(let i=0;i<2;i++){
    if(fail)await assert.rejects(session.call('read_file',{path:'file.txt'}),/Clone unavailable/);
    else assert.deepEqual(await session.call('read_file',{path:'file.txt'}),{text:'content'});
   }
   assert.equal(clones,1);
  }finally{await session.close();}
  await assert.rejects(fs.stat(path.dirname(work)),{code:'ENOENT'});
 }
});

for(const postId of ['0x123','291','1291'])test('PR publication preserves commit, files and complete invocation identity: '+postId,async()=>{
 let work;const calls=[];
 const runCommand=async(command,args)=>{
  assert.equal(command,'git');
  if(args[0]==='clone'){work=args.at(-1);await fs.mkdir(work);await fs.writeFile(path.join(work,'script.sh'),'old');await fs.chmod(path.join(work,'script.sh'),0o755);return {stdout:''};}
  if(args[0]==='rev-parse')return {stdout:'checkout-sha\n'};
  if(args[0]==='sparse-checkout'||args[0]==='checkout')return {stdout:''};
  if(args[0]==='status')return {stdout:' M script.sh\0?? new.txt\0'};
  throw Error('Unexpected command');
 };
 const api=async(method,route,body)=>{
  calls.push({method,route,body});
  if(route==='/repos/owner/project')return {default_branch:'main'};
  if(route.endsWith('/git/commits/checkout-sha'))return {tree:{sha:'base-tree'}};
  if(route.endsWith('/git/trees/base-tree?recursive=1'))return {sha:'base-tree',truncated:false,tree:[]};
  if(route.endsWith('/pulls'))return {html_url:'https://github.com/owner/project/pull/1'};
  return {sha:'created-sha'};
 };
 const session=await githubToolbox({repository:'owner/project',api,runCommand,allowWrites:true,draftPr:true}).open({postId});
 try{
  await session.call('write_file',{path:'script.sh',content:'new'});
  await session.call('write_file',{path:'new.txt',content:'new file'});
  await assert.rejects(session.call('write_file',{path:'../escape',content:'x'}),/outside/);
  const result=await session.call('create_pr',{title:'Change',body:'Test'});assert(result.url.endsWith('/1'));
  const tree=calls.find(x=>x.route.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree,'base-tree');assert.equal(tree.tree[0].mode,'100755');
  assert.deepEqual(calls.find(x=>x.route.endsWith('/git/commits')).body.parents,['checkout-sha']);
  assert.equal(calls.find(x=>x.route.endsWith('/pulls')).body.base,'main');
  assert.equal(calls.find(x=>x.route.endsWith('/pulls')).body.draft,true);
  const expected='bok/'+(postId==='1291'?'50b':'123').padStart(64,'0');
  assert.equal(calls.find(x=>x.route.endsWith('/git/refs')).body.ref,'refs/heads/'+expected);
  assert.equal(calls.find(x=>x.route.endsWith('/pulls')).body.head,expected);
  await assert.rejects(session.call('create_pr',{title:'Again',body:''}),/One PR/);
 }finally{await session.close();}
 await assert.rejects(fs.stat(work),{code:'ENOENT'});
});

for(const invalid of [{sha:'base-tree',truncated:true,tree:[]},{sha:'other-tree',truncated:false,tree:[]}])test('incomplete or substituted tree cannot materialize files or silently retry',async()=>{
 let calls=0;
 const session=await githubToolbox({repository:'owner/project',api:async(method,route)=>{
  if(route.includes('?recursive=1')){calls++;return invalid;}return checkoutApi(method,route);
 },runCommand:async(_,args)=>{
  if(args[0]==='clone'){await fs.mkdir(args.at(-1));return {stdout:''};}
  if(args[0]==='rev-parse')return {stdout:'sha\n'};
  assert.fail('No materialization for invalid metadata');
 }}).open({postId:'0x1'});
 try{for(let i=0;i<2;i++)await assert.rejects(session.call('read_file',{path:'file.txt'}),/Incomplete repository tree/);assert.equal(calls,1);}
 finally{await session.close();}
});

test('failed checkout initialization is cleaned by the session owner',async()=>{
 let work;
 const toolbox=githubToolbox({repository:'owner/project',api:async()=>{throw Error('unavailable');},runCommand:async(_,args)=>{work=args.at(-1);await fs.mkdir(work);}});
 const session=await toolbox.open({postId:'0x1'});
 try{await assert.rejects(session.call('read_file',{path:'file.txt'}),/unavailable/);}finally{await session.close();}
 await assert.rejects(fs.stat(work),{code:'ENOENT'});
});

test('PR reads retain changed files inside the agent budget despite large GitHub metadata',async()=>{
 let clones=0;
 const api=async(method,route)=>{
  if(route.endsWith('/files?per_page=100'))return Array.from({length:5},()=>({filename:'docs/bok-live-smoke.md',status:'added',additions:9,deletions:0,patch:'x'.repeat(20000)}));
  if(route.endsWith('/pulls/1'))return {number:1,title:'Test',body:'\0'.repeat(20000),html_url:'https://github.com/owner/project/pull/1',head:{ref:'bok/test',sha:'head',repo:{metadata:'x'.repeat(100000)}},base:{ref:'master'}};
  return {default_branch:'master'};
 };
 const session=await githubToolbox({repository:'owner/project',api,runCommand:async(_,args)=>{
  if(args[0]==='clone'){clones++;throw Error('Read PR must not clone');}
  return {stdout:'sha\n'};
 }}).open({postId:'0x1'});
 try{
  const result=await session.call('read_pr',{number:1});
  assert.equal(result.files[0].filename,'docs/bok-live-smoke.md');assert.equal(result.files[0].patchTruncated,true);
  assert.equal(result.pr.bodyTruncated,true);assert.equal(result.pr.headSha,'head');
  assert(JSON.stringify(result).length<16000);assert.equal(result.filesTruncated,false);
  assert.equal(clones,0);
 }finally{await session.close();}
});
