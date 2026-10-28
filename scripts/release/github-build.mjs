import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {failure} from './bundle.mjs';
export function acceptBaseline(runs,revision){
 if(!/^[a-f0-9]{40}$/.test(revision)||!Array.isArray(runs))throw failure('RELEASE_BASELINE_CHECK');
 const eligible=runs.filter(r=>r.head_sha===revision&&r.head_branch==='master'&&['push','workflow_dispatch'].includes(r.event)&&r.head_repository?.full_name==='zac-williamson/aztec_experiments').sort((a,b)=>Number(b.id)-Number(a.id));
 if(!eligible.length||eligible[0].status!=='completed'||eligible[0].conclusion!=='success')throw failure('RELEASE_BASELINE_CHECK');return eligible[0].id;
}
export async function requireGithubBuild(root){
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(!process.env.GH_TOKEN)throw failure('RELEASE_GITHUB_AUTH');
 const response=await fetch('https://api.github.com/repos/zac-williamson/aztec_experiments/actions/workflows/build.yml/runs?head_sha='+revision+'&per_page=30',{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw failure('RELEASE_BASELINE_CHECK');const data=await response.json();return acceptBaseline(data.workflow_runs,revision);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==3)throw failure('RELEASE_USAGE');await requireGithubBuild(process.argv[2]);process.stdout.write('Full build passed for candidate commit.\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_BASELINE_CHECK')+'\n');process.exitCode=1;}}
