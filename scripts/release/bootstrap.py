#!/usr/bin/env python3
"""Reviewable stage/operator preparation. Default is payload preview.
--apply requires final deployed fingerprints. It never restarts/enables a service,
changes Caddy/a live unit, registers a runner, or reads/copies a shared signer.
"""
import argparse, hashlib, json, os, pathlib, pwd, grp, re, shutil, subprocess, tarfile, tempfile
RELEASES=pathlib.Path('/opt/rolling-releases')
STAGE=pathlib.Path('/opt/rolling-stage');LIVE=pathlib.Path('/opt/rolling-release-live')
CONFIG=pathlib.Path('/etc/rolling-release');STAGE_CONFIG=pathlib.Path('/etc/rolling-stage')
STATE=pathlib.Path('/var/lib/rolling-release-state');OPERATOR=pathlib.Path('/opt/rolling-ci-bootstrap/operator')
NODE='/opt/rolling-ops/runtime/node'
GENERATED=['.build/contracts-manifest.json','.build/sdk','.build/owner-delivery','.build/rolling-wallet','billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','experiments/private-bok/target','apps/dist/crs']
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def command(args,timeout=120):return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL,timeout=timeout).strip()
def relative(name):return isinstance(name,str) and re.fullmatch(r'[A-Za-z0-9_./@-]+',name) and not name.startswith('/') and all(x not in ('','.','..') for x in name.split('/'))
def load_payload(folder):
 m=json.loads((folder/'manifest.json').read_text());require(m.get('schemaVersion')==1,'Invalid bootstrap manifest')
 require(re.fullmatch('[a-f0-9]{40}',m.get('applicationRevision','')),'Invalid application revision')
 for name,digest in m.get('support',{}).items():require(relative(name) and sha((folder/name).read_bytes())==digest,'Support file fingerprint mismatch')
 for kind in ['application','operator']:
  archive=folder/(kind+'-source.tar.gz');entries=m[kind]['files'];require(isinstance(entries,dict) and entries,'Missing payload files')
  require(sha(archive.read_bytes())==m[kind]['archiveSha256'],'Archive fingerprint mismatch')
  with tarfile.open(archive,'r:gz') as t:
   names=set()
   for item in t:
    require(item.isfile() and relative(item.name) and item.name in entries and item.name not in names,'Unapproved archive member')
    raw=t.extractfile(item).read();record=entries[item.name]
    require(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'Source fingerprint mismatch');names.add(item.name)
   require(names==set(entries),'Incomplete source archive')
 return m
def unpack(folder,kind,target):
 with tarfile.open(folder/(kind+'-source.tar.gz'),'r:gz') as t:
  for item in t:
   dest=target/item.name;require(not dest.is_symlink(),'Unexpected source link');dest.parent.mkdir(parents=True,exist_ok=True)
   raw=t.extractfile(item).read()
   if dest.exists():require(dest.is_file() and dest.read_bytes()==raw,'Existing source differs')
   else:dest.write_bytes(raw)
   os.chown(dest,0,0);os.chmod(dest,0o644)
 for current,dirs,files in os.walk(target):os.chmod(current,0o755)
def directory(p,mode=0o755,uid=0,gid=0):
 require(not p.is_symlink(),'Unexpected directory link');p.mkdir(parents=True,exist_ok=True);os.chown(p,uid,gid);os.chmod(p,mode)
def atomic(p,raw,mode=0o644,uid=0,gid=0):
 require(not p.is_symlink(),'Unexpected configuration link')
 if p.exists():require(p.read_bytes()==raw,'Existing configuration differs; review update explicitly');return
 fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.'+p.name)
 try:
  os.fchmod(fd,mode);os.fchown(fd,uid,gid)
  with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
  os.link(tmp,p)
 finally:os.unlink(tmp)
def json_file(p,value,**kwargs):atomic(p,(json.dumps(value,indent=2)+'\n').encode(),**kwargs)
def user(name,home):
 try:u=pwd.getpwnam(name)
 except KeyError:
  command(['useradd','--system','--user-group','--home-dir',str(home),'--no-create-home','--shell','/usr/sbin/nologin',name]);u=pwd.getpwnam(name)
 require(u.pw_uid!=0 and u.pw_dir==str(home),'Unexpected service user');return u
def checked_json(p,digest):
 q=pathlib.Path(p);require(q.is_file() and not q.is_symlink() and sha(q.read_bytes())==digest,'Live configuration fingerprint changed');return json.loads(q.read_text())
def copy_generated(source,target):
 require(source.exists() and not source.is_symlink(),'Missing or linked generated input')
 for current,dirs,files in os.walk(source) if source.is_dir() else [(source.parent,[],[source.name])]:
  for name in dirs+files:require(not (pathlib.Path(current)/name).is_symlink(),'Generated input contains a link')
 if source.is_dir():shutil.copytree(source,target,dirs_exist_ok=False)
 else:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
def link(p,target):
 if p.is_symlink():require(p.resolve()==target.resolve(),'Existing application pointer differs')
 else:require(not p.exists(),'Application pointer is not a symlink');p.symlink_to(target)

def owned_public(p):
 st=p.lstat();require(not p.is_symlink() and st.st_uid==0 and not st.st_mode&0o022,'Prepared baseline must be root-owned public regular files')
def verify_prepared(source,proof_file,proof_sha,revision,application_files,dependencies):
 require(proof_file.is_file() and not proof_file.is_symlink() and sha(proof_file.read_bytes())==proof_sha,'Prepared baseline proof changed')
 proof=json.loads(proof_file.read_text());require(proof.get('schemaVersion')==1 and proof.get('kind')=='prepared-public-baseline' and proof.get('sourceRevision')==revision and proof.get('deploymentVerified') is False,'Invalid prepared baseline proof')
 for p in [source,proof_file,*source.rglob('*')]:owned_public(p)
 actual={p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
 require(actual==set(proof['files']),'Prepared baseline inventory differs')
 for name,record in proof['files'].items():require(relative(name) and len((source/name).read_bytes())==record['bytes'] and sha((source/name).read_bytes())==record['sha256'],'Prepared baseline bytes differ')
 for name,record in application_files.items():require(proof['sourceFiles'].get(name)==record['sha256'] and proof['files'].get(name)==record,'Prepared baseline differs from exact Git source archive')
 for name,digest in proof['dependencyInputs'].items():
  require(relative(name),'Invalid SDK dependency input')
  target=dependencies/name.removeprefix('node_modules/') if name.startswith('node_modules/') else source/name
  require(target.is_file() and sha(target.read_bytes())==digest,'Prepared SDK dependency differs on this host')
 return proof

def prepare(folder,m,p):
 require(os.geteuid()==0,'Root host preparation required')
 require({'bootstrap.py','rolling-staging.service','rolling-release-prune.service','rolling-release-prune.timer'}<=set(m.get('support',{})),'Host support files are not fingerprinted')
 for file in [folder,folder/'manifest.json',folder/'application-source.tar.gz',folder/'operator-source.tar.gz',*[folder/name for name in m['support']]]:
  stat=file.lstat();require(not file.is_symlink() and stat.st_uid==0 and not stat.st_mode&0o022,'Host payload must be root-owned and not writable by other users')
 require(p.get('applicationRevision')==m['applicationRevision'],'Baseline source revision differs')
 root=p.get('baselineRuntime');require(isinstance(root,str) and re.fullmatch(r'/opt/rolling-app/releases/[A-Za-z0-9_.-]+',root),'Final deployed runtime path is required')
 require(command(['systemctl','show','rolling-application.service','--property=WorkingDirectory','--value'])==root,'Active application runtime changed')
 require(command(['systemctl','show','rolling-application.service','--property=User','--value'])=='rolling-application','Unexpected live application user')
 require(pathlib.Path(NODE).is_file() and sha(pathlib.Path(NODE).read_bytes())==p['nodeSha256'] and command([NODE,'--version'])=='v24.21.0','Pinned Node is unavailable or changed')
 require(p['stageOrigin']=='https://d1jab0kmgvw5tv.cloudfront.net' and p['liveOrigin']=='https://d30njln0kead8n.cloudfront.net','Unexpected application origins')
 address=p.get('stageRelayAddress');require(isinstance(address,str) and re.fullmatch('0x[0-9a-f]{40}',address) and int(address,16)>0,'Dedicated stage relay public address required')
 public=checked_json(p['livePublicConfig'],p['livePublicConfigSha256']);wallet=checked_json(p['liveWalletConfig'],p['liveWalletConfigSha256']);relay=checked_json(p['liveRelayConfig'],p['liveRelayConfigSha256'])
 require(wallet['config']['network']['chainId']=='11155111' and wallet['proofsEnabled'] is True and wallet['remoteProver']['proofsEnabled'] is True,'Real-proof Sepolia baseline required')
 require(address!=relay['policy']['relayer'],'Stage relay must not share the live signer')
 require(shutil.disk_usage('/opt').free>=3*1024**3,'At least 3 GiB free space required')
 src=pathlib.Path(root);dependencies=(src/'node_modules').resolve();require(dependencies.is_dir() and dependencies.stat().st_uid==0,'Root-owned dependencies required')
 # Normal setup requires the deployed tree to match. An explicit prepared
 # baseline instead binds a root-owned exact Git source archive, every retained
 # generated byte and dependency input; public-origin verification still follows.
 prepared=None
 if p.get('preparedBaseline'):
  location=p['preparedBaseline'];require(location=='/opt/rolling-prepared/'+m['applicationRevision'],'Unexpected prepared baseline path')
  src=pathlib.Path(location);proof_file=pathlib.Path(location+'.proof.json')
  prepared=verify_prepared(src,proof_file,p.get('preparedBaselineProofSha256'),m['applicationRevision'],m['application']['files'],dependencies)
 else:
  compared=0
  for name,record in m['application']['files'].items():
   actual=src/name
   if actual.is_file():require(sha(actual.read_bytes())==record['sha256'],'Deployed source differs from declared application revision');compared+=1
  require(compared>100,'Insufficient deployed source inventory')
 release=user('rolling-release',pathlib.Path('/var/lib/rolling-release-job'));stage=user('rolling-staging',pathlib.Path('/var/lib/rolling-stage'));ops=grp.getgrnam('rolling-ops')
 directory(RELEASES,uid=release.pw_uid,gid=release.pw_gid);directory(STAGE,uid=release.pw_uid,gid=release.pw_gid);directory(LIVE,uid=release.pw_uid,gid=release.pw_gid)
 directory(CONFIG,0o750,0,release.pw_gid);directory(STAGE_CONFIG,0o750,0,stage.pw_gid);directory(STATE,0o2750,release.pw_uid,ops.gr_gid)
 directory(pathlib.Path(release.pw_dir),0o700,release.pw_uid,release.pw_gid);directory(pathlib.Path(stage.pw_dir),0o700,stage.pw_uid,stage.pw_gid)
 baseline=RELEASES/m['applicationRevision'];fresh=not baseline.exists();directory(baseline)
 if fresh:
  unpack(folder,'application',baseline)
  for name in GENERATED:copy_generated(src/name,baseline/name)
  sdk=json.loads((src/'.build/sdk/sdk-manifest.json').read_text())
  for name,digest in sdk['inputs'].items():
   if name.startswith('billboard/portal/node_modules/'):
    require(relative(name) and name.startswith('billboard/portal/node_modules/@aztec-foundation/l1-artifacts/l1-contracts/') and name.endswith('.sol') and sha((src/name).read_bytes())==digest,'Invalid nested SDK source')
    copy_generated(src/name,baseline/name)
  (baseline/'node_modules').symlink_to(dependencies)
  for current,dirs,files in os.walk(baseline):
   os.chmod(current,0o755)
   for name in files:os.chmod(pathlib.Path(current)/name,0o644)
 else:require((baseline/'release.json').is_file(),'Incomplete existing baseline; inspect before retry')
 directory(OPERATOR.parent);directory(OPERATOR);unpack(folder,'operator',OPERATOR);link(OPERATOR/'node_modules',dependencies)
 public.update({'port':8091,'cacheDirectory':'/var/lib/rolling-stage/index','artifactPath':str(STAGE/'current/billboard/target/rolling_contract-RollingBoard.json'),'bokArtifactPath':str(STAGE/'current/experiments/private-bok/target/private_bok-PrivateBok.json')})
 wallet['trustedQuery']['url']=p['stageOrigin']+'/prover/v1/node';wallet['remoteProver']['url']=p['stageOrigin']+'/prover';wallet['config']['aggregateFunding']['usdcRelayAddress']=address
 relay['signerFile']='/run/rolling-staging/relay-signer.json';relay['stateDirectory']='/var/lib/rolling-stage/relay';relay['policy']['relayer']=address
 relay['policy']['totalGasBudgetWei']=str(min(int(relay['policy']['totalGasBudgetWei']),10**16));require(int(relay['policy']['maxGasWei'])<=int(relay['policy']['totalGasBudgetWei']),'Stage relay budget needs explicit review')
 json_file(STAGE_CONFIG/'public.json',public,mode=0o640,gid=stage.pw_gid);json_file(STAGE_CONFIG/'wallet.json',wallet,mode=0o640,gid=stage.pw_gid);json_file(STAGE_CONFIG/'relay.json',relay,mode=0o640,gid=stage.pw_gid)
 # The release job sees only the non-secret verifier projection, not service configs.
 artifacts=OPERATOR.parent/'artifacts';directory(artifacts)
 for name,source in [('board.json','billboard/target/rolling_contract-RollingBoard.json'),('bok.json','experiments/private-bok/target/private_bok-PrivateBok.json')]:atomic(artifacts/name,(baseline/source).read_bytes())
 verifier={k:public[k] for k in ['nodeUrl','scope','artifactPath','bokArtifactPath']};verifier['artifactPath']=str(artifacts/'board.json');verifier['bokArtifactPath']=str(artifacts/'bok.json')
 json_file(CONFIG/'public-verifier.json',verifier,mode=0o640,gid=release.pw_gid)
 cfg={'schemaVersion':1,'stagingOrigin':p['stageOrigin'],'liveOrigin':p['liveOrigin'],'stagingLink':str(STAGE/'current'),'liveLink':str(LIVE/'current'),'releaseDirectory':str(RELEASES),'stateFile':str(STATE/'state.json'),'walletFile':str(CONFIG/'test-wallet.json'),'publicFile':str(CONFIG/'public-verifier.json'),'nodeBinary':NODE,'stagingService':'rolling-staging.service','liveService':'rolling-application.service'}
 json_file(CONFIG/'config.json',cfg,mode=0o600,uid=release.pw_uid,gid=release.pw_gid)
 if fresh:command([NODE,str(OPERATOR/'scripts/release/seal-current.mjs'),str(baseline),m['applicationRevision'],p['liveOrigin'],str(STAGE_CONFIG/'wallet.json')],timeout=300)
 else:command([NODE,str(OPERATOR/'scripts/release/bundle.mjs'),'verify',str(baseline)],timeout=120)
 link(STAGE/'current',baseline);link(LIVE/'current',baseline)
 atomic(pathlib.Path('/etc/systemd/system/rolling-staging.service'),(folder/'rolling-staging.service').read_bytes())
 for name in ['rolling-release-prune.service','rolling-release-prune.timer']:atomic(pathlib.Path('/etc/systemd/system')/name,(folder/name).read_bytes())
 installed=pathlib.Path('/usr/local/lib/rolling-release')
 if not installed.exists():command([NODE,str(OPERATOR/'scripts/release/install.mjs'),str(CONFIG/'config.json')],timeout=300)
 else:
  for name in m['operator']['files']:
   if name=='toolchain.json':continue
   actual=installed/name;st=actual.lstat();require(actual.is_file() and not actual.is_symlink() and st.st_uid==0 and not st.st_mode&0o022 and actual.read_bytes()==(OPERATOR/name).read_bytes(),'Installed operator differs; review an explicit update')
 return {'status':'prepared-not-started','baseline':str(baseline),'operatorConfig':str(CONFIG/'config.json'),'stageRelaySignerRequired':str(STAGE_CONFIG/'relay-signer.json'),'ciFunderRequired':str(CONFIG/'test-wallet.json'),'githubRunnerInstalled':False,'releaseJobStarted':False,'liveUnitChanged':False,'caddyChanged':False}

def main():
 a=argparse.ArgumentParser();a.add_argument('--payload',required=True,type=pathlib.Path);a.add_argument('--plan',type=pathlib.Path);a.add_argument('--apply',action='store_true');args=a.parse_args()
 folder=args.payload.resolve();m=load_payload(folder);p=json.loads((args.plan or folder/'plan.json').read_text())
 if not args.apply:
  print(json.dumps({'status':'payload-verified','applicationRevision':m['applicationRevision'],'sourceFiles':len(m['application']['files']),'operatorFiles':len(m['operator']['files']),'hostChanges':False,'missingFinalInputs':[k for k in ['baselineRuntime','livePublicConfigSha256','liveWalletConfig','liveWalletConfigSha256','liveRelayConfigSha256','stageRelayAddress'] if not p.get(k)]}));return
 print(json.dumps(prepare(folder,m,p)))
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'status':'blocked','error':str(e) if isinstance(e,ValueError) else 'Bootstrap preparation failed; inspect locally'}));raise SystemExit(1)
