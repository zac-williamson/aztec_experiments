// Installed root-owned entry point. SSM supplies no arguments or code. Every run
// fetches only this public repository's current master and checks its full build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readOperatorConfig,prepareCandidate} from './prepare.mjs';
import {requireGithubBuild} from './github-build.mjs';
import {runOperator} from './run.mjs';
import {failure,verifyBundle} from './bundle.mjs';
import {jobPreflight} from './job-preflight.mjs';
import {writeReleaseState} from './pipeline.mjs';
export const REPOSITORY='https://github.com/zac-williamson/aztec_experiments.git';
export function gitOptions(){return ['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','protocol.allow=never','-c','protocol.https.allow=always','-c','http.followRedirects=false','-c','submodule.recurse=false'];}
export function assertMasterRevision(revision,remote){if(!/^[a-f0-9]{40}$/.test(revision)||remote.trim()!==revision+'\trefs/heads/master')throw failure('RELEASE_SUPERSEDED');}
export async function runHostJob(){
 if(process.argv.length!==2)throw failure('RELEASE_USAGE');
 await jobPreflight();
 const cfg=await readOperatorConfig('/etc/rolling-release/config.json');
 const state={schemaVersion:1,status:'checking',revision:null,previousRevision:null,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),stages:[],error:null};
 let active=false;
 try{
 const source='/var/lib/rolling-release-job/source';await fs.mkdir(source,{recursive:true,mode:0o700});
 const git=(args,timeout=180000)=>execFileSync('/usr/bin/git',[...gitOptions(),...args],{cwd:source,encoding:'utf8',timeout,stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',HOME:'/var/lib/rolling-release-job',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}}).trim();
 // No token, arbitrary ref, workflow artifact, repository hooks or submodule code
 // enters this checkout. A shallow baseline fetch is only for protected diffs.
 try{await fs.access(path.join(source,'.git'));}catch(e){if(e.code!=='ENOENT')throw e;git(['init','--template=','.']);}
 git(['fetch','--no-tags','--depth=1',REPOSITORY,'+refs/heads/master:refs/remotes/origin/master']);
 const revision=git(['rev-parse','refs/remotes/origin/master']);if(!/^[a-f0-9]{40}$/.test(revision))throw failure('RELEASE_SOURCE');
 git(['checkout','--force','--detach',revision]);
 const baseline=(await verifyBundle(await fs.realpath(cfg.liveLink))).manifest;
 state.revision=revision;state.previousRevision=baseline.revision;
 await requireGithubBuild(source);
 if(revision===baseline.revision){process.stdout.write('Current master is already live.\n');return;}
 await writeReleaseState(cfg.stateFile,state);
 git(['fetch','--no-tags','--depth=1',REPOSITORY,baseline.revision]);
 const candidate=await prepareCandidate(source,cfg);
 assertMasterRevision(revision,git(['ls-remote','--refs',REPOSITORY,'refs/heads/master']));
 active=true;await runOperator('release','/etc/rolling-release/config.json',candidate);
 process.stdout.write('Release completed and live checks passed.\n');
 }catch(e){if(!active){state.status='blocked';state.error=/^RELEASE_[A-Z_]+$/.test(e.code??'')?e.code:'RELEASE_JOB_FAILED';state.updatedAt=new Date().toISOString();await writeReleaseState(cfg.stateFile,state);}throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await runHostJob();}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_JOB_FAILED')+'\n');process.exitCode=1;}}
