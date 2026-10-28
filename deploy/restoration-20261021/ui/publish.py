#!/usr/bin/env python3
"""Repeat static UI publication. Run stage, review result, then activate.
Packet plan.json: commit(40hex), configuredSource, runningSource, appPid,
appStartTime(/proc/PID/stat field22), configHashes{absolute:sha256}, unitFiles
{absolute:sha256}, files{relative:{sha256,previousSha256|null}}, caddySha256,
protectedPids{unit:pid} (including the application proxy), node, nodeSha256,
appUnit (base unit in unitFiles), notifySha256, expectedCurrentUi (exact absolute
current symlink target). Caddy routing and its notify drop-in must already exist.
Payload at packet/files/<relative>. sdkRetention: {helperSha256, stagedSources[]}
binds the sibling prune-inactive-sdk-outputs.py and every other staged source.
No private values leave host.
"""
import hashlib,importlib.util,json,os,pathlib,re,shlex,shutil,stat,subprocess,sys,urllib.request
PACKET_ROOT=pathlib.Path('/var/lib/rolling-bootstrap-private')
P=pathlib.Path(sys.argv[1]).resolve();mode=sys.argv[2];assert mode in ('stage','activate')
m=json.loads((P/'plan.json').read_text());assert re.fullmatch('[0-9a-f]{40}',m['commit'])
BASE=pathlib.Path('/opt/rolling-ui');SOURCE=pathlib.Path(m['configuredSource']);RUNNING=pathlib.Path(m['runningSource']);NEXT=pathlib.Path('/opt/rolling-app/releases/ui-'+m['commit'][:12]);UI=BASE/'releases'/m['commit'];CADDY=pathlib.Path('/etc/rolling-app/Caddyfile')
NOTIFY=pathlib.Path('/etc/systemd/system/rolling-application-proxy.service.d/90-ui-ready.conf')
sha=lambda b:hashlib.sha256(b).hexdigest()
def digest(p):return sha(p.read_bytes())
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def atomic(p,data,mode=0o644,uid=0,gid=0):
 p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+'.new');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchmod(fd,mode);os.fchown(fd,uid,gid)
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,p);fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 except:raise

def check_current(expected):
 current=BASE/'current'
 assert current.is_symlink() and os.readlink(current)==str(expected)
 assert current.resolve()==pathlib.Path(expected).resolve() and pathlib.Path(expected).is_dir()

def switch_current(expected,target):
 check_current(expected)
 temporary=BASE/'current.new';assert not temporary.exists() and not temporary.is_symlink()
 os.symlink(target,temporary);os.replace(temporary,BASE/'current')
 fd=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)

def preserved(configured=SOURCE,unit_hash=None,current=None):
 assert run(['systemctl','show','rolling-application.service','-p','MainPID','--value'])==str(m['appPid'])
 assert pathlib.Path('/proc/'+str(m['appPid'])+'/cwd').resolve()==RUNNING
 assert pathlib.Path('/proc/'+str(m['appPid'])+'/stat').read_text().rsplit(')',1)[1].split()[19]==str(m['appStartTime'])
 assert 'rolling-application-proxy.service' in m['protectedPids']
 for unit,pid in m['protectedPids'].items():assert isinstance(pid,int) and pid>0 and re.fullmatch(r'[A-Za-z0-9-]+\.service',unit) and run(['systemctl','show',unit,'-p','MainPID','--value'])==str(pid)
 for name,want in m['configHashes'].items():assert digest(pathlib.Path(name))==want
 for name,want in m['unitFiles'].items():assert digest(pathlib.Path(name))==(unit_hash if unit_hash and name==m['appUnit'] else want)
 assert digest(CADDY)==m['caddySha256'] and not CADDY.is_symlink()
 assert digest(NOTIFY)==m['notifySha256'] and not NOTIFY.is_symlink()
 assert run(['systemctl','show','rolling-application.service','-p','WorkingDirectory','--value'])==str(configured)
 check_current(current or m['expectedCurrentUi'])

def safe_relative(name):
 p=pathlib.PurePosixPath(name);assert not p.is_absolute() and '..' not in p.parts and str(p)==name
 native=name=='node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js'
 assert 'node_modules' not in p.parts or native
 assert native or name.startswith(('apps/','shared/','scripts/','.build/sdk/','.build/rolling-wallet/')) or name in {'.build/contracts-manifest.json','deploy/runtime-wallet.json'}
 return p


def confined_payload_file(root,name):
 relative=safe_relative(name)
 assert root.is_dir() and not root.is_symlink() and root.resolve()==root
 current=root
 for part in relative.parts:
  current=current/part
  assert not current.is_symlink()
  if current!=root/relative and current.exists():assert current.is_dir()
 assert current.resolve().is_relative_to(root)
 return current

EXPORT=r'''import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const [source,walletFile,publicFile]=process.argv.slice(1);const {loadRollingWalletAssets}=await import(pathToFileURL(source+'/scripts/rolling-wallet-assets.mjs'));
const wallet=await loadRollingWalletAssets(JSON.parse(await fs.readFile(walletFile)),JSON.parse(await fs.readFile(publicFile)).scope);
const manifest=JSON.parse(await fs.readFile(source+'/.build/rolling-wallet/manifest.json'));
// Validators above bind source, artifacts, SDK, CRS, configuration and deployment.
process.stdout.write(JSON.stringify({runtime:wallet.runtime,files:manifest.files}));'''

def bound_wallet_file(key):
 selected=pathlib.Path(m[key]);assert selected.is_absolute()
 assert str(selected) in m['configHashes'] and digest(selected)==m['configHashes'][str(selected)]
 return selected

def running_wallet_file():
 selected=bound_wallet_file('runningWalletFile')
 argv=pathlib.Path('/proc/'+str(m['appPid'])+'/cmdline').read_bytes().decode().rstrip('\0').split('\0')
 assert len(argv)==5 and argv[1]=='apps/rolling/start.mjs' and argv[3]==str(selected)
 return selected

def configured_wallet_file():
 selected=bound_wallet_file('configuredWalletFile')
 starts=re.findall(r'^ExecStart=(.*)$',pathlib.Path(m['appUnit']).read_text(),re.M);assert len(starts)==1
 configured=shlex.split(starts[0]);assert len(configured)==5 and configured[1]=='apps/rolling/start.mjs' and configured[3]==str(selected)
 return selected

def wallet_file(source):
 if source==NEXT:
  if 'deploy/runtime-wallet.json' in m['files']:return NEXT/'deploy/runtime-wallet.json'
  return configured_wallet_file()
 assert source==RUNNING
 return running_wallet_file()

def next_wallet_startup(updated):
 rows=updated.splitlines(keepends=True);starts=[i for i,line in enumerate(rows) if line.startswith('ExecStart=')];assert len(starts)==1
 index=starts[0];args=shlex.split(rows[index][10:]);assert len(args)==5 and args[1]=='apps/rolling/start.mjs'
 args[3]=str(wallet_file(NEXT));rows[index]='ExecStart='+shlex.join(args)+'\n'
 return ''.join(rows)

def validate_fee_override():
 if 'deploy/runtime-wallet.json' not in m['files']:return
 old=json.loads(configured_wallet_file().read_text())
 new=json.loads(confined_payload_file(P/'files','deploy/runtime-wallet.json').read_text())
 prices=new['config']['privateFee']['gasSettings']['maxFeesPerGas']
 assert set(prices)=={'feePerDaGas','feePerL2Gas'}
 assert all(isinstance(value,str) and re.fullmatch(r'0|[1-9][0-9]*',value) and int(value)<2**128 for value in prices.values())
 # A static fee update cannot change custody, network, contracts or providers.
 old['config']['privateFee']['gasSettings']['maxFeesPerGas']=prices
 assert new==old, 'Static wallet override may change only the fee-price ceilings'

def wallet(source,node):
 return json.loads(run([node,'--input-type=module','-e',EXPORT,str(source),str(wallet_file(source)),'/etc/rolling-app/public.json']))

def public_directory(target):
 assert target.is_relative_to(BASE)
 for part in [BASE,*[BASE.joinpath(*target.relative_to(BASE).parts[:i]) for i in range(1,len(target.relative_to(BASE).parts)+1)]]:
  if not part.exists():part.mkdir(mode=0o755);part.chmod(0o755)
  info=part.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o755

def public_file(target,data):
 public_directory(target.parent);assert not target.exists();atomic(target,data,0o444)

def dependency_root(source):
 # Share only an existing root-owned release dependency tree, never a parent
 # directory or an arbitrary target supplied through a package symlink.
 assert source.resolve()==source and not source.is_symlink()
 target=(source/'node_modules').resolve(strict=True)
 assert target.name=='node_modules' and target.parent.parent==pathlib.Path('/opt/rolling-app/releases')
 assert re.fullmatch(r'[A-Za-z0-9._-]+',target.parent.name)
 for directory in (target.parent,target):
  info=directory.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 return target

def asset_file(source,name):
 relative=pathlib.PurePosixPath(name)
 assert not relative.is_absolute() and '..' not in relative.parts
 file=source/name
 if name=='node_modules/ethers/dist/ethers.umd.min.js':
  assert file.resolve(strict=True).is_relative_to(dependency_root(source))
 else:assert file.resolve().is_relative_to(source.resolve())
 return file

def clone_source():
 assert all('node_modules' not in pathlib.PurePosixPath(name).parts for name in m['files']), 'Static publication cannot mutate shared dependencies'
 dependencies=dependency_root(SOURCE)
 shutil.copytree(SOURCE,NEXT,copy_function=os.link,symlinks=True,
  ignore=lambda directory,names:['node_modules'] if pathlib.Path(directory)==SOURCE else [])
 os.symlink(dependencies,NEXT/'node_modules',target_is_directory=True)
 assert dependency_root(NEXT)==dependencies

def brotli_asset(url,size):
 # Only immutable, manifest-authenticated public artifacts. Runtime/config JSON
 # and private files never become eligible through their extension alone.
 artifact=url in ('/wallet/board.json','/wallet/private-fee.json','/wallet/bok.json') or url in (
  '/wallet/native-contract-'+name+'.json' for name in
  ('ContractClassRegistry','ContractInstanceRegistry','FeeJuice','MultiCallEntrypoint','AuthRegistry','HandshakeRegistry'))
 return (pathlib.PurePosixPath(url).suffix in ('.js','.mjs') or artifact) and size>=100*1024

def brotli_bytes(data):
 # The stage already authenticated this Node binary. No new packages or SDK
 # inputs: sidecars are delivery encodings of the verified decoded asset.
 program="""const fs=require('node:fs'),z=require('node:zlib');
 const input=fs.readFileSync(0);
 const output=z.brotliCompressSync(input,{params:{
  [z.constants.BROTLI_PARAM_QUALITY]:9,[z.constants.BROTLI_PARAM_MODE]:z.constants.BROTLI_MODE_TEXT}});
 if(!z.brotliDecompressSync(output).equals(input))throw Error('Brotli roundtrip failed');
 process.stdout.write(output);"""
 encoded=subprocess.run([m['node'],'-e',program],input=data,check=True,capture_output=True).stdout
 assert len(encoded)<=len(data)+65536
 return encoded

def export_brotli(target,data,destination):
 encoded=brotli_bytes(data);sidecar=target.with_name(target.name+'.br')
 if sidecar.exists() or sidecar.is_symlink():
  info=sidecar.lstat()
  assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o444
  assert sidecar.read_bytes()==encoded, 'Existing Brotli sidecar differs from verified encoding'
 else:public_file(sidecar,encoded)
 link=destination.with_name(destination.name+'.br')
 assert not link.exists() and not link.is_symlink()
 os.link(sidecar,link)

def export_assets(source,description,destination=None):
 for url,entry in description['files'].items():
  assert re.fullmatch('/(?:wallet|crs)/[A-Za-z0-9_.-]+',url) and url!='/wallet/runtime.json'
  file=asset_file(source,entry['file'])
  data=file.read_bytes();assert len(data)==entry['bytes'] and sha(data)==entry['sha256']
  target=BASE/'by-hash'/entry['sha256']/url.lstrip('/')
  if target.exists():assert not target.is_symlink() and digest(target)==entry['sha256']
  else:public_file(target,data)
  if destination:
   link=destination/url.lstrip('/');public_directory(link.parent);os.link(target,link)
   if brotli_asset(url,len(data)):export_brotli(target,data,link)
 if destination:public_file(destination/'wallet/runtime.json',json.dumps(description['runtime'],separators=(',',':')).encode())

PUBLIC={'/':'live.html','/archive/':'archive.html','/archive/snapshot.json':'archive.json','/reader.mjs':'reader.mjs','/analytics.mjs':'analytics.mjs','/analytics-schema.mjs':'analytics-schema.mjs','/feed-ranking.mjs':'feed-ranking.mjs','/home-reader.mjs':'home-reader.mjs','/feed-preferences.mjs':'feed-preferences.mjs','/reader-client.mjs':'reader-client.mjs','/profile-view.mjs':'profile-view.mjs','/avatar-upload.mjs':'avatar-upload.mjs','/performance.mjs':'performance.mjs','/reader-updates.mjs':'reader-updates.mjs','/wallet-action.mjs':'wallet-action.mjs','/model.mjs':'model.mjs','/navigation.mjs':'navigation.mjs','/style.css':'style.css','/wallet-panel.mjs':'wallet-panel.mjs','/wallet-cache-worker.mjs':'wallet-cache-worker.mjs'}

# Explicit production assets; never export the mock review site.
PUBLIC.update({('/'+name):name for name in ('fonts/DMSans-latin.woff2','fonts/DMSans-latin-ext.woff2','fonts/OFL.txt','favicon.svg','favicon-32.png','apple-touch-icon.png','icon-192.png','icon-512.png','og.png','site.webmanifest')})

def validate_public_routes():
 # The pinned deployed Caddyfile uses one explicit @public path line. Fail
 # before staging if a new exported module would fall through to the old app.
 lines=[line.split('#',1)[0].split() for line in CADDY.read_text().splitlines()]
 matches=[tokens for tokens in lines if tokens and tokens[0]=='@public']
 assert len(matches)==1 and matches[0][1:2]==['path'], 'Expected one explicit Caddy @public path matcher'
 missing=sorted(set(PUBLIC)-set(matches[0][2:]))
 assert not missing, 'Caddy public matcher is missing routes: '+', '.join(missing)

def packet_archive_hash():
 archive=P/'payload.tgz'
 if not archive.exists() and not archive.is_symlink():return None
 info=archive.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid()
 return digest(archive)

def capacity_preflight():
 # Hardlinks share source data; node_modules is one immutable tree. New static
 # HTML/modules consume new blocks. Reserve 1GiB for metadata and service writes.
 reservations={}
 def reserve(target,size):
  parent=target
  while not parent.exists():parent=parent.parent
  device=parent.stat().st_dev
  entry=reservations.setdefault(device,{'path':parent,'bytes':0})
  entry['bytes']+=size
 def candidate(name):return P/'files'/name if name in m['files'] else SOURCE/name
 reserve(NEXT.parent,sum((P/'files'/name).stat().st_size for name in m['files']))
 missing=set()
 for source,select,compressed in [(RUNNING,lambda name:RUNNING/name,False),(SOURCE,candidate,True)]:
  manifest=json.loads(select('.build/rolling-wallet/manifest.json').read_text())
  for url,entry in manifest['files'].items():
   assert re.fullmatch('/(?:wallet|crs)/[A-Za-z0-9_.-]+',url) and re.fullmatch('[0-9a-f]{64}',entry['sha256'])
   relative=pathlib.PurePosixPath(entry['file']);assert not relative.is_absolute() and '..' not in relative.parts
   file=select(str(relative))
   if file.is_relative_to(P/'files'):assert file.resolve().is_relative_to((P/'files').resolve())
   else:assert file==asset_file(source,str(relative))
   assert file.stat().st_size==entry['bytes']
   target=BASE/'by-hash'/entry['sha256']/url.lstrip('/')
   if not target.exists() and target not in missing:reserve(BASE,entry['bytes']);missing.add(target)
   sidecar=target.with_name(target.name+'.br')
   if compressed and brotli_asset(url,entry['bytes']) and not sidecar.exists() and sidecar not in missing:
    reserve(BASE,entry['bytes']+65536);missing.add(sidecar)
 reserve(BASE,sum(candidate('apps/rolling/'+name).stat().st_size for name in PUBLIC.values())+1024*1024)
 for entry in reservations.values():
  required=entry['bytes']+1024*1024*1024
  if shutil.disk_usage(entry['path']).free<required:raise RuntimeError('Insufficient disk space for UI stage and 1GiB operating reserve')
 return sum(entry['bytes'] for entry in reservations.values())

def cleanup_packet_payload(result):
 # This is packet garbage collection, never release retention. Authenticate the
 # exact installed content and the complete owned packet tree before unlinking.
 assert P.parent==PACKET_ROOT and P.name=='ui-'+m['commit'][:12] and P.resolve()==P
 info=P.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and not (info.st_mode & 0o022)
 for name,entry in m['files'].items():
  assert digest(confined_payload_file(NEXT,name))==entry['sha256']
 for name,want in result['files'].items():
  relative=pathlib.PurePosixPath(name);assert not relative.is_absolute() and '..' not in relative.parts
  assert not (UI/name).is_symlink() and digest(UI/name)==want
 assert packet_archive_hash()==result.get('payloadArchiveSha256')
 files=P/'files';found=set()
 if files.exists() or files.is_symlink():
  for item in [files,*files.rglob('*')]:
   info=item.lstat();assert info.st_uid==os.getuid() and not (info.st_mode & 0o022) and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
   if stat.S_ISREG(info.st_mode):
    name=str(item.relative_to(files));assert name in m['files'] and digest(item)==m['files'][name]['sha256'];found.add(name)
  assert found==set(m['files'])
 elif m['files']:raise AssertionError('Packet files missing before cleanup')
 if files.exists():shutil.rmtree(files)
 archive=P/'payload.tgz'
 if archive.exists():archive.unlink()
 atomic(P/'payload-cleanup-result.json',json.dumps({'commit':m['commit'],'filesRemoved':len(found),'archiveRemoved':result.get('payloadArchiveSha256') is not None}).encode(),0o600)

def retention_helper():
 spec=m['sdkRetention'];assert set(spec)=={'helperSha256','stagedSources'}
 assert re.fullmatch('[0-9a-f]{64}',spec['helperSha256']) and isinstance(spec['stagedSources'],list)
 for name in spec['stagedSources']:assert re.fullmatch(r'/opt/(?:rolling-app|rolling-bok|rolling-moderator|board-prover)/releases/[A-Za-z0-9._-]+',name)
 helper=P/'prune-inactive-sdk-outputs.py';info=helper.lstat()
 assert stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&0o022 and helper.resolve()==helper and digest(helper)==spec['helperSha256']
 module_spec=importlib.util.spec_from_file_location('publication_sdk_retention',helper)
 module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
 return module

def cleanup_inactive_sdk_outputs():
 # Activation is already committed. Retention failure never rolls back a good UI
 # or masks its successful receipt; retain a separate fixed diagnostic for retry.
 try:
  helper=retention_helper()
  candidates=[str(path) for root in helper.ROOTS if root.is_dir() for path in root.iterdir() if path.is_dir() and not path.is_symlink()]
  protected=set(m['sdkRetention']['stagedSources'])|set(map(str,(SOURCE,RUNNING,NEXT,UI)))|{m['expectedCurrentUi']}
  result=helper.prune({'candidates':candidates,'protected':sorted(protected)},apply=True)
 except Exception as error:
  result={'applied':False,'errorType':type(error).__name__}
 atomic(P/'sdk-retention-result.json',json.dumps(result).encode(),0o600)
 return result.get('applied') is True

def activate():
 retention_helper() # Qualify shipped code before any pointer/unit change.
 r=json.loads((P/'stage-result.json').read_text())
 assert r['schemaVersion']==1 and r['commit']==m['commit'] and r['source']==str(NEXT) and r['ui']==str(UI)
 assert str(dependency_root(NEXT))==r['dependencyRoot']==str(dependency_root(SOURCE))
 assert r['planSha256']==digest(P/'plan.json') and r['publisherSha256']==digest(pathlib.Path(__file__))
 assert r['expectedCurrentUi']==m['expectedCurrentUi'] and r['caddySha256']==m['caddySha256'] and r['notifySha256']==m['notifySha256']
 assert digest(P/'application.service.next')==r['unitSha256']
 for name,want in r['files'].items():
  relative=pathlib.PurePosixPath(name);assert not relative.is_absolute() and '..' not in relative.parts
  assert not (UI/name).is_symlink() and digest(UI/name)==want
 for name,entry in m['files'].items():
  assert digest(confined_payload_file(NEXT,name))==entry['sha256']
 if r.get('walletConfigSha256') is not None:assert not (NEXT/'deploy/runtime-wallet.json').is_symlink() and digest(NEXT/'deploy/runtime-wallet.json')==r['walletConfigSha256']
 preserved()
 unit=pathlib.Path(m['appUnit']);info=unit.stat();original=unit.read_bytes()
 assert sha(original)==m['unitFiles'][str(unit)]
 atomic(P/'application.service.before',original,0o600)
 atomic(P/'current.before',m['expectedCurrentUi'].encode(),0o600)
 switch_attempted=False;install_attempted=False
 try:
  # Record the future source without stopping any healthy owner. Caddy already
  # serves /opt/rolling-ui/current and immutable assets from /by-hash.
  install_attempted=True
  atomic(unit,(P/'application.service.next').read_bytes(),stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)
  run(['systemctl','daemon-reload'])
  preserved(configured=NEXT,unit_hash=r['unitSha256'])
  switch_attempted=True;switch_current(m['expectedCurrentUi'],UI)
  with urllib.request.urlopen('http://172.31.32.101:4319/wallet/runtime.json',timeout=10) as response:
   assert sha(response.read())==r['files']['wallet/runtime.json']
  preserved(configured=NEXT,unit_hash=r['unitSha256'],current=UI)
 except:
  # Roll back pointers and future startup configuration only. Existing hashed
  # assets remain available to tabs which observed the candidate publication.
  if switch_attempted:
   if (BASE/'current').is_symlink() and os.readlink(BASE/'current')==str(UI):switch_current(UI,m['expectedCurrentUi'])
   else:check_current(m['expectedCurrentUi'])
  if install_attempted:
   actual=digest(unit);assert actual in (sha(original),r['unitSha256'])
   if actual==r['unitSha256']:atomic(unit,original,stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)
   run(['systemctl','daemon-reload'])
  preserved()
  raise
 atomic(P/'activation-result.json',json.dumps({'commit':m['commit'],'appPid':m['appPid'],'runningSource':str(RUNNING),'nextSource':str(NEXT),'ui':str(UI),'previousUi':m['expectedCurrentUi'],'protectedPids':m['protectedPids'],'caddySha256':m['caddySha256'],'notifySha256':m['notifySha256']}).encode(),0o600)
 cleanup_packet_payload(r)
 retained=cleanup_inactive_sdk_outputs()
 print(json.dumps({'activated':True,'appRestarted':False,'proxyRestarted':False,'payloadCleaned':True,'sdkRetentionCleaned':retained}))

assert os.getuid()==0
assert re.fullmatch(r'/opt/rolling-ui/releases/[0-9a-f]{40}',m['expectedCurrentUi'])
assert re.fullmatch('[0-9a-f]{64}',m['notifySha256'])
assert str(NOTIFY) not in m['unitFiles'] or m['unitFiles'][str(NOTIFY)]==m['notifySha256']
proxy_unit=run(['systemctl','show','rolling-application-proxy.service','-p','FragmentPath','--value']);assert proxy_unit in m['unitFiles']
preserved()
if mode=='stage':
 retention_helper()
 assert digest(CADDY)==m['caddySha256'];assert not NEXT.exists() and not UI.exists()
 validate_public_routes()
 for name,entry in m['files'].items():
  old=confined_payload_file(SOURCE,name);payload=confined_payload_file(P/'files',name);assert digest(payload)==entry['sha256']
  assert (not old.exists() and not old.is_symlink()) if entry['previousSha256'] is None else (not old.is_symlink() and digest(old)==entry['previousSha256'])
 validate_fee_override()
 capacity_preflight()
 archive_hash=packet_archive_hash()
 clone_source()
 for name,entry in m['files'].items():
  target=confined_payload_file(NEXT,name);reference=target if target.exists() else NEXT/'apps/rolling/wallet-panel.mjs';info=reference.stat();atomic(target,confined_payload_file(P/'files',name).read_bytes(),stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)
  assert digest(target)==entry['sha256'];assert not (SOURCE/name).exists() or target.stat().st_ino!=(SOURCE/name).stat().st_ino
 node=m['node'];assert re.fullmatch(r'/opt/board-prover/releases/rolling-[a-f0-9]+/node/bin/node',node) and digest(pathlib.Path(node))==m['nodeSha256']
 assert 'bokTopup' not in m, 'Funding scope changes require the full deployment cutover'
 old,new=wallet(RUNNING,node),wallet(NEXT,node)
 unit=pathlib.Path(m['appUnit']);assert digest(unit)==m['unitFiles'][str(unit)]
 original=unit.read_text();rows=original.splitlines(keepends=True)
 assert rows.count('WorkingDirectory='+str(SOURCE)+'\n')==1
 starts=[line for line in rows if line.startswith('ExecStart=')];assert len(starts)==1 and shlex.split(starts[0][10:])[0]==node
 updated=''.join(line.replace(str(SOURCE),str(NEXT)) if line.startswith(('WorkingDirectory=','ExecStart=')) else line for line in rows)
 updated=next_wallet_startup(updated)
 assert shlex.split(next(line[10:] for line in updated.splitlines() if line.startswith('ExecStart=')))[0]==node
 atomic(P/'application.service.next',updated.encode(),0o600)
 public_directory(UI);export_assets(RUNNING,old);export_assets(NEXT,new,UI)
 for url,name in PUBLIC.items():public_file(UI/(url.lstrip('/')+('index.html' if url.endswith('/') else '')),(NEXT/'apps/rolling'/name).read_bytes())
 result={'schemaVersion':1,'dependencyRoot':str(dependency_root(NEXT)),'payloadArchiveSha256':archive_hash,'commit':m['commit'],'source':str(NEXT),'ui':str(UI),'planSha256':digest(P/'plan.json'),'publisherSha256':digest(pathlib.Path(__file__)),'caddySha256':m['caddySha256'],'notifySha256':m['notifySha256'],'expectedCurrentUi':m['expectedCurrentUi'],'unitSha256':digest(P/'application.service.next'),'walletConfigSha256':digest(NEXT/'deploy/runtime-wallet.json') if 'deploy/runtime-wallet.json' in m['files'] else None,'files':{str(f.relative_to(UI)):digest(f) for f in UI.rglob('*') if f.is_file()}}
 atomic(P/'stage-result.json',json.dumps(result,sort_keys=True).encode(),0o600)
 for name,entry in m['files'].items():assert (not (SOURCE/name).exists()) if entry['previousSha256'] is None else digest(SOURCE/name)==entry['previousSha256']
 preserved();print(json.dumps({'staged':True,'files':len(result['files'])}))
else:
 activate()
