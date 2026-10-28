import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readOperatorConfig} from './prepare.mjs';
import {releaseCandidate,rollbackRelease} from './pipeline.mjs';
import {runTestnetJourney} from './journey.mjs';
import {failure,verifyBundle} from './bundle.mjs';
import {smokeApplication} from './smoke.mjs';
export async function runOperator(command,configFile,candidate){
 const config=await readOperatorConfig(configFile);candidate=await fs.realpath(candidate);
 if(path.dirname(candidate)!==config.releaseDirectory)throw failure('RELEASE_CANDIDATE_PATH');
 const restart=unit=>async()=>{execFileSync('sudo',['-n','/usr/bin/systemctl','restart',unit],{stdio:'pipe',timeout:120000,maxBuffer:65536});};
 const forStage=compatibility=>({...compatibility,runtimeSha256:compatibility.stageRuntimeSha256??compatibility.runtimeSha256});
 const common={candidate,stageLink:config.stagingLink,liveLink:config.liveLink,stageOrigin:config.stagingOrigin,liveOrigin:config.liveOrigin,stateFile:config.stateFile,restartStage:restart(config.stagingService),restartLive:restart(config.liveService),smoke:(origin,manifest)=>smokeApplication(origin,origin===config.stagingOrigin?{...manifest,compatibility:forStage(manifest.compatibility)}:manifest)};
 if(command==='release'){const compatibility=forStage((await verifyBundle(candidate)).manifest.compatibility);return releaseCandidate({...common,journey:()=>runTestnetJourney(config.walletFile,{expectedOrigin:config.stagingOrigin,expectedCompatibility:compatibility,publicFile:config.publicFile})});}
 if(command==='rollback')return rollbackRelease({...common,target:candidate});
 throw failure('RELEASE_USAGE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==5)throw failure('RELEASE_USAGE');const state=await runOperator(process.argv[2],process.argv[3],process.argv[4]);process.stdout.write(JSON.stringify(state)+'\n');}
 catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_FAILED')+'\n');process.exitCode=1;}
}
