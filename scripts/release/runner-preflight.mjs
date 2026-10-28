// Runs inside the runner service's own systemd sandbox before it connects to
// GitHub. Test connectivity only; never request or log EC2 credential data.
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {failure} from './bundle.mjs';
export async function metadataReachable(host){return new Promise(resolve=>{const socket=net.connect({host,port:80});const done=value=>{socket.destroy();resolve(value);};socket.setTimeout(1500,()=>done(false));socket.once('connect',()=>done(true));socket.once('error',()=>done(false));});}
export async function runnerPreflight(){
 if(process.getuid?.()===0||process.env.AWS_EC2_METADATA_DISABLED!=='true'||process.env.AWS_SHARED_CREDENTIALS_FILE!=='/dev/null'||process.env.AWS_CONFIG_FILE!=='/dev/null')throw failure('RELEASE_RUNNER_ISOLATION');
 const allowed=new Set(['AWS_EC2_METADATA_DISABLED','AWS_SHARED_CREDENTIALS_FILE','AWS_CONFIG_FILE']);
 for(const name of Object.keys(process.env))if(name.startsWith('AWS_')&&!allowed.has(name)&&process.env[name])throw failure('RELEASE_RUNNER_CREDENTIALS');
 for(const file of ['credentials','config']){try{await fs.access(path.join(os.homedir(),'.aws',file));throw failure('RELEASE_RUNNER_CREDENTIALS');}catch(e){if(!['ENOENT','EACCES'].includes(e.code))throw e;}}
 if((await Promise.all(['169.254.169.254','fd00:ec2::254'].map(metadataReachable))).some(Boolean))throw failure('RELEASE_RUNNER_METADATA_REACHABLE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await runnerPreflight();process.stdout.write('Runner credential isolation checked.\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_RUNNER_ISOLATION')+'\n');process.exitCode=1;}}
