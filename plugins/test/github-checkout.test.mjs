import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {githubToolbox} from '../github-tools.mjs';
const exec=promisify(execFile);

test('real filtered checkout excludes unreadable blobs and preserves edits and PR base tree',async()=>{
 const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'bok-git-fixture-'));let session,work;
 const git=(args,options={})=>exec('git',args,{cwd:fixture,timeout:10000,...options});
 try{
  await git(['init','-b','main']);await git(['config','uploadpack.allowFilter','true']);
  await fs.writeFile(path.join(fixture,'script.sh'),'#!/bin/sh\necho before\n',{mode:0o755});
  await fs.writeFile(path.join(fixture,'large [*?] file.txt'),'x'.repeat(100001));
  await fs.writeFile(path.join(fixture,'small [*?] file.txt'),'small');
  await fs.symlink('script.sh',path.join(fixture,'link'));
  await fs.mkdir(path.join(fixture,'.github'));await fs.writeFile(path.join(fixture,'.github','guard.yml'),'before');
  await git(['add','.']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
  const baseSha=(await git(['rev-parse','HEAD'])).stdout.trim(),treeSha=(await git(['rev-parse','HEAD^{tree}'])).stdout.trim();
  const entries=(await git(['ls-tree','-r','-l','-z','HEAD'])).stdout.split('\0').filter(Boolean).map(line=>{
   const [,mode,type,sha,size,name]=line.match(/^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t(.*)$/s);return {path:name,mode,type,sha,size:Number(size)};
  });
  const calls=[];let clones=0;
  const api=async(method,route,body)=>{
   calls.push({method,route,body});
   if(route==='/repos/owner/project')return {default_branch:'main'};
   if(route===`/repos/owner/project/git/commits/${baseSha}`)return {tree:{sha:treeSha}};
   if(route===`/repos/owner/project/git/trees/${treeSha}?recursive=1`)return {sha:treeSha,truncated:false,tree:entries};
   if(route.endsWith('/pulls'))return {html_url:'https://github.com/owner/project/pull/1'};
   return {sha:'created-sha'};
  };
  session=await githubToolbox({repository:'owner/project',api,allowWrites:true,runCommand:async(command,args,options)=>{
   if(args[0]==='clone'){clones++;work=args.at(-1);args=args.map(arg=>arg==='https://github.com/owner/project.git'?pathToFileURL(fixture).href:arg);}
   return exec(command,args,options);
  }}).open({postId:'0x1'});
  const listed=await session.call('list_files',{prefix:''});assert.deepEqual(listed.files.sort(),entries.map(x=>x.path).sort());
  const large=entries.find(x=>x.size>100000);
  const assertLargeAbsent=()=>assert.rejects(exec('git',['cat-file','-e',large.sha],{cwd:work,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}}));
  await assertLargeAbsent();
  assert.deepEqual(await session.call('read_file',{path:'small [*?] file.txt'}),{text:'small'});
  await assert.rejects(session.call('read_file',{path:large.path}),/too large/i);
  await assert.rejects(session.call('write_file',{path:large.path,content:'replacement'}),/too large/i);
  for(const alias of ['./'+large.path,'unused/../'+large.path,large.path.toUpperCase()]){
   await assert.rejects(session.call('read_file',{path:alias}),/too large/i);
   await assert.rejects(session.call('write_file',{path:alias,content:'replacement'}),/too large/i);
  }
  await assert.rejects(session.call('read_file',{path:'link'}),/Symlink/);
  await assert.rejects(session.call('write_file',{path:'../escape',content:'bad'}),/outside/);
  await assert.rejects(session.call('read_file',{path:'.git/config'}),/Invalid/);
  await assert.rejects(session.call('read_file',{path:'.GIT/config'}),/Invalid/);
  await assert.rejects(session.call('write_file',{path:'.GIT/config',content:'bad'}),/Invalid/);
  await session.call('write_file',{path:'script.sh',content:'#!/bin/sh\necho after\n'});
  await session.call('write_file',{path:'new.txt',content:'new'});
  await session.call('create_pr',{title:'Change',body:'Test'});
  const tree=calls.find(x=>x.method==='POST'&&x.route.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree,treeSha);assert.deepEqual(tree.tree.map(x=>x.path).sort(),['new.txt','script.sh']);
  assert.equal(tree.tree.find(x=>x.path==='script.sh').mode,'100755');
  assert.deepEqual(calls.find(x=>x.method==='POST'&&x.route.endsWith('/git/commits')).body.parents,[baseSha]);
  assert.equal(clones,1);await assertLargeAbsent();
 }finally{await session?.close();await fs.rm(fixture,{recursive:true,force:true});}
 if(work)await assert.rejects(fs.stat(work),{code:'ENOENT'});
});
