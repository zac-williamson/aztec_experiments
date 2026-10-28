import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readOperatorConfig} from './prepare.mjs';
import {failure} from './bundle.mjs';
export function runnerDropin(cfg,runnerRoot){
 const values=[runnerRoot,cfg.releaseDirectory,path.dirname(cfg.stagingLink),path.dirname(cfg.liveLink),path.dirname(cfg.stateFile),cfg.nodeBinary];
 if(values.some(value=>typeof value!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(value)||path.resolve(value)!==value))throw failure('RELEASE_CONFIG');
 return `[Service]
User=rolling-release
Group=rolling-release
UMask=0077
Environment=AWS_EC2_METADATA_DISABLED=true AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_CONFIG_FILE=/dev/null
UnsetEnvironment=AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN
IPAddressDeny=169.254.169.254/32
IPAddressDeny=fd00:ec2::254/128
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=${[...new Set(values.slice(0,-1))].join(' ')}
ReadWritePaths=-/run/sudo
InaccessiblePaths=-/var/lib/cloud -/var/lib/private -/var/lib/rolling-stage -/var/lib/rolling-ops -/var/lib/rolling-runner/.aws -/etc/rolling-app -/etc/rolling-ops -/etc/rolling-node -/etc/rolling-query -/etc/board-prover -/etc/rolling-moderator -/etc/rolling-stage -/run/credentials -/run/rolling-application -/run/rolling-staging
ExecStartPre=${cfg.nodeBinary} /usr/local/lib/rolling-release/scripts/release/runner-preflight.mjs
`;
}
export async function hardenRunner(configFile){
 if(process.getuid?.()!==0)throw failure('RELEASE_INSTALL_REQUIRES_ROOT');
 const cfg=await readOperatorConfig(configFile),runnerRoot='/var/lib/rolling-runner';
 const uid=execFileSync('id',['-u','rolling-release'],{encoding:'utf8'}).trim(),groups=execFileSync('id',['-Gn','rolling-release'],{encoding:'utf8'}).trim().split(/\s+/);
 if(!/^[1-9][0-9]*$/.test(uid)||groups.some(g=>['sudo','wheel','admin','docker','lxd'].includes(g)))throw failure('RELEASE_RUNNER_ISOLATION');
 for(const service of [cfg.stagingService,cfg.liveService]){
  const user=execFileSync('/usr/bin/systemctl',['show',service,'--property=User','--value'],{encoding:'utf8'}).trim();
  if(!user||user==='root'||user==='0'||user==='rolling-release')throw failure('RELEASE_APPLICATION_SERVICE_USER');
 }
 const unit=(await fs.readFile(path.join(runnerRoot,'.service'),'utf8')).trim();if(!/^actions\.runner\.zac-williamson-aztec_experiments\.[A-Za-z0-9_.-]+\.service$/.test(unit))throw failure('RELEASE_RUNNER_SERVICE');
 // Use the official svc.sh-installed service/runsvc.sh entry point. Override its
 // user and restrictions; installation never starts or enables this runner.
 const directory='/etc/systemd/system/'+unit+'.d';await fs.mkdir(directory,{recursive:true,mode:0o755});
 await fs.writeFile(path.join(directory,'20-rolling-release.conf'),runnerDropin(cfg,runnerRoot),{flag:'wx',mode:0o644});
 const sudoers='/etc/sudoers.d/rolling-release',temp=sudoers+'.pending-'+process.pid;
 try{await fs.writeFile(temp,'Defaults:rolling-release timestamp_timeout=0\nrolling-release ALL=(root) NOPASSWD: /usr/bin/systemctl restart rolling-staging.service, /usr/bin/systemctl restart rolling-application.service\n',{flag:'wx',mode:0o440});execFileSync('/usr/sbin/visudo',['-cf',temp],{stdio:'pipe'});await fs.link(temp,sudoers);}finally{await fs.rm(temp,{force:true});}
 return {unit,enabled:false,started:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==3)throw failure('RELEASE_USAGE');process.stdout.write(JSON.stringify(await hardenRunner(process.argv[2]))+'\n');}catch(e){process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_RUNNER_INSTALL_FAILED')+'\n');process.exitCode=1;}}
