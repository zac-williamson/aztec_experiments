import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const definition=(name,description,properties,required=Object.keys(properties))=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const string={type:'string'};

/** GitHub implementation of the agent tool API. Writes stay in a fresh branch.
 * API transport is supplied by the host; no token enters the working directory.
 */
export function githubToolbox({repository,api,allowWrites=false,draftPr=false,runCommand=exec}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Invalid repository');
  return {async open({postId}) {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bok-')),work=path.join(dir,'repository');
    let prUrl=null;
    try{await runCommand('git',['clone','--depth','1','https://github.com/'+repository+'.git',work],{timeout:60000,maxBuffer:1024*1024});}
    catch(error){await fs.rm(dir,{recursive:true,force:true});throw error;}
    try {
    const info=await api('GET','/repos/'+repository),base=info.default_branch;
    const baseSha=(await runCommand('git',['rev-parse','HEAD'],{cwd:work})).stdout.trim();
    const safe=async name=>{
      if(typeof name!=='string'||name.includes('\0')||name.split(/[\\/]/).includes('.git'))throw Error('Invalid file path');
      const target=path.resolve(work,name);if(!target.startsWith(work+path.sep))throw Error('Path outside repository');
      // Reject symlinks at every existing path component, including parent dirs.
      let current=work;for(const part of path.relative(work,target).split(path.sep)){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Symlink access rejected');}catch(e){if(e.code!=='ENOENT')throw e;}}
      return target;
    };
    const definitions=[
      definition('list_files','List tracked repository files',{prefix:string}),
      definition('read_file','Read a UTF-8 repository file',{path:string}),
      definition('write_file','Write a UTF-8 file in the isolated checkout',{path:string,content:string}),
      definition('read_pr','Read a PR in this repository',{number:{type:'integer',minimum:1}}),
      definition('create_pr','Publish current edits as a new pull request; never merge',{title:string,body:string}),
    ];
    return {
      definitions,
      summary:reason=>(reason+(prUrl?' PR: '+prUrl:' No PR was published.')).slice(0,900),
      async call(name,args){
        if(name==='list_files'){if(typeof args.prefix!=='string')throw Error('Prefix required');const listed=await runCommand('git',['ls-files','-z'],{cwd:work,maxBuffer:4*1024*1024});const files=listed.stdout.split('\0').filter(x=>x&&x.startsWith(args.prefix));return {files:files.slice(0,500),truncated:files.length>500};}
        if(name==='read_file'){const file=await safe(args.path);if((await fs.stat(file)).size>100000)throw Error('File too large');return {text:await fs.readFile(file,'utf8')};}
        if(name==='write_file'){if(typeof args.content!=='string'||Buffer.byteLength(args.content)>100000)throw Error('File too large');const file=await safe(args.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,args.content);return {written:args.path};}
        if(name==='read_pr'){
          if(!Number.isSafeInteger(args.number)||args.number<1)throw Error('Invalid PR');
          const [pr,changes]=await Promise.all([api('GET',`/repos/${repository}/pulls/${args.number}`),api('GET',`/repos/${repository}/pulls/${args.number}/files?per_page=100`)]);
          // GitHub embeds entire repository/user objects in a PR response. Returning
          // those exhausted the agent's tool-result budget before any files arrived.
          const files=[];let remaining=10000;
          for(const file of changes){
            const entry={filename:file.filename,status:file.status,additions:file.additions,deletions:file.deletions,
              patch:file.patch?.slice(0,1000),patchTruncated:(file.patch?.length??0)>1000};
            const size=JSON.stringify(entry).length;if(size>remaining)break;
            files.push(entry);remaining-=size;
          }
          const result={files,filesTruncated:files.length<changes.length||changes.length===100,
            pr:{number:pr.number,title:pr.title?.slice(0,200),url:pr.html_url,state:pr.state,draft:pr.draft,
              body:pr.body?.slice(0,2000),bodyTruncated:(pr.body?.length??0)>2000,
              base:pr.base?.ref,head:pr.head?.ref,headSha:pr.head?.sha}};
          // Budget serialized JSON, since escaping can expand strings substantially.
          while(JSON.stringify(result).length>15000){
            if(result.pr.body?.length){result.pr.body=result.pr.body.slice(0,Math.floor(result.pr.body.length/2));result.pr.bodyTruncated=true;}
            else if(result.files.length){result.files.pop();result.filesTruncated=true;}
            else throw Error('PR metadata exceeds the tool response limit');
          }
          return result;
        }
        if(name==='create_pr'){
          if(!allowWrites)throw Error('GitHub writes are disabled');
          if(prUrl)throw Error('One PR per invocation');
          if(typeof args.title!=='string'||args.title.length>200||typeof args.body!=='string'||args.body.length>20000)throw Error('Invalid PR text');
          const status=await runCommand('git',['status','--porcelain=v1','-z','--untracked-files=all'],{cwd:work,maxBuffer:1024*1024});
          const entries=status.stdout.split('\0').filter(Boolean);if(entries.length>30)throw Error('Too many changed files');
          const tree=[];
          for(const entry of entries){const filename=entry.slice(3);if(filename.endsWith('/')||filename.startsWith('.github/'))throw Error('Workflow/directory changes not supported');const file=await safe(filename);const stat=await fs.stat(file);if(!stat.isFile()||stat.size>100000)throw Error('Unsupported file change');const blob=await api('POST',`/repos/${repository}/git/blobs`,{content:await fs.readFile(file,'utf8'),encoding:'utf-8'});tree.push({path:filename,mode:(stat.mode&0o111)?'100755':'100644',type:'blob',sha:blob.sha});}
          if(!tree.length)throw Error('No file changes');
          const baseCommit=await api('GET',`/repos/${repository}/git/commits/${baseSha}`);
          const built=await api('POST',`/repos/${repository}/git/trees`,{base_tree:baseCommit.tree.sha,tree});
          const commit=await api('POST',`/repos/${repository}/git/commits`,{message:args.title,tree:built.sha,parents:[baseSha]});
          const branch='bok/'+BigInt(postId).toString(16).padStart(64,'0');
          await api('POST',`/repos/${repository}/git/refs`,{ref:'refs/heads/'+branch,sha:commit.sha});
          const pr=await api('POST',`/repos/${repository}/pulls`,{title:args.title,body:args.body,head:branch,base,draft:draftPr});prUrl=pr.html_url;
          return {url:prUrl};
        }
        throw Error('Unknown tool');
      },
      close:()=>fs.rm(dir,{recursive:true,force:true}),
    };
    }catch(error){await fs.rm(dir,{recursive:true,force:true});throw error;}
  }};
}

export function githubApi({token,fetchImpl=fetch}) {
  return async(method,route,body)=>{
    if(!route.startsWith('/repos/'))throw Error('Unsupported GitHub route');
    const response=await fetchImpl('https://api.github.com'+route,{method,headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('GitHub request failed ('+response.status+')');
    return response.json();
  };
}
