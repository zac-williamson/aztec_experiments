#!/usr/bin/env python3
"""Install reviewed operations source only. Existing application units are never restarted.

Input: private JSON packet with schemaVersion1, role, revision40hex,
files[{path,sha256,base64}], observerConfig, and for core serverConfig,
nodeSha256, expectedCaddySha256, optional snapshotConfig{bucket,region}.
Default validates/previews only; --apply performs the reviewed installation.
"""
import argparse, base64, grp, hashlib, json, os, pathlib, pwd, re, shutil, signal, subprocess, tempfile, time, urllib.request

BASE=pathlib.Path('/opt/rolling-ops');CONFIG=pathlib.Path('/etc/rolling-ops');DATA=pathlib.Path('/var/lib/rolling-ops')
CADDY=pathlib.Path('/etc/rolling-app/Caddyfile')
CORE=('rolling-node','rolling-query','board-prover','board-prover-proxy','rolling-application','rolling-application-proxy','rolling-moderator')
BOK=('rolling-bok-testnet','rolling-bok-artifact-proxy')
ALLOWED={'apps/rolling/analytics-schema.mjs'}|{'ops/'+name for name in ('server.mjs','auth.mjs','analytics.mjs','monitor.mjs','community.mjs','backup.mjs','host-observer.py','external-probe.py','pull-snapshot.py')}|{'ops/public/'+name for name in ('index.html','app.mjs','style.css','font.woff2','OFL.txt')}
MARKER_START='  # rolling-ops begin\n';MARKER_END='  # rolling-ops end\n'
BLOCK=MARKER_START+'  @rolling_ops path /_ops /_ops/*\n  handle @rolling_ops {\n   reverse_proxy 127.0.0.1:4320\n  }\n'+MARKER_END

def digest(value):return hashlib.sha256(value).hexdigest()
def command(args,timeout=15):return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL,timeout=timeout).strip()
def require(condition,message):
 if not condition:raise ValueError(message)
def validate_packet(packet):
 require(packet.get('schemaVersion')==1 and packet.get('role') in ('core','bok'),'Invalid packet')
 require(re.fullmatch('[a-f0-9]{40}',packet.get('revision','')),'Invalid source revision')
 files={};total=0
 require(isinstance(packet.get('files'),list) and 1<=len(packet['files'])<=len(ALLOWED),'Invalid file count')
 for item in packet['files']:
  path=item.get('path');require(path in ALLOWED and path not in files,'Unapproved source path')
  raw=base64.b64decode(item.get('base64',''),validate=True);total+=len(raw)
  require(len(raw)<=1048576 and total<=4194304 and digest(raw)==item.get('sha256'),'Invalid source fingerprint')
  files[path]=raw
 require('ops/host-observer.py' in files,'Observer source missing')
 observer=packet.get('observerConfig');require(isinstance(observer,dict) and observer.get('role')==packet['role'],'Invalid observer config')
 require(set(observer)<={'role','health'},'Unsupported observer configuration')
 for name,value in observer.get('health',{}).items():
  require(name in ('prover','query','moderator','funding','bok'),'Unknown observation')
  require(name=='moderator' and value=='current-daemon-journal' or isinstance(value,str) and re.fullmatch(r'http://127\.0\.0\.1:[0-9]{2,5}/[a-zA-Z0-9/_-]+',value),'Only local health sources allowed')
 if packet['role']=='core':
  require({'apps/rolling/analytics-schema.mjs','ops/community.mjs','ops/server.mjs','ops/auth.mjs','ops/analytics.mjs','ops/monitor.mjs','ops/public/index.html','ops/public/app.mjs','ops/public/style.css','ops/public/font.woff2'}<=set(files),'Dashboard source incomplete')
  require(re.fullmatch('[a-f0-9]{64}',packet.get('nodeSha256','')) and re.fullmatch('[a-f0-9]{64}',packet.get('expectedCaddySha256','')),'Runtime/proxy fingerprint required')
  server=packet.get('serverConfig');require(isinstance(server,dict),'Server config missing')
  require(server.get('port',4320)==4320 and server.get('revision')==packet['revision'],'Invalid listener or revision')
  require(set(server)<={'port','revision','auth','database','communityFile','reliabilityInputsFile','releasesFile','accessUrl','campaigns'},'Unsupported server configuration')
  require(server.get('database')==str(DATA/'analytics.sqlite') and server.get('reliabilityInputsFile')==str(DATA/'reliability-inputs.json'),'Invalid data path')
  for key in ('communityFile','releasesFile'):
   require(key not in server or server[key]==str(DATA/('community.json' if key=='communityFile' else 'releases.json')),'Invalid projection path')
  auth=server.get('auth',{});require(set(auth)=={'origin','issuer','clientId','loginDomain'},'Only public identity settings allowed')
  require(re.fullmatch(r'https://[a-zA-Z0-9.-]+',auth.get('origin','')) and re.fullmatch(r'https://cognito-idp\.[a-z0-9-]+\.amazonaws\.com/[\w-]+',auth.get('issuer','')) and re.fullmatch(r'https://[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com',auth.get('loginDomain','')) and re.fullmatch('[a-zA-Z0-9]+',auth.get('clientId','')),'Invalid identity settings')
  if 'snapshotConfig' in packet:
   snapshot=packet['snapshotConfig'];require(set(snapshot)=={'region','bucket'} and re.fullmatch('[a-z0-9.-]{3,63}',snapshot['bucket']) and snapshot['region']=='us-east-1','Invalid snapshot configuration')
   require({'ops/pull-snapshot.py','ops/external-probe.py'}<=set(files),'Snapshot transport source missing')
 return files

def caddy_patch(raw,expected):
 text=raw.decode('utf8')
 if MARKER_START in text or MARKER_END in text:
  require(text.count(BLOCK)==1,'Unexpected existing operations route')
  original=text.replace(BLOCK,'',1).encode();require(digest(original)==expected,'Proxy configuration changed')
  return raw
 require(digest(raw)==expected,'Proxy configuration changed')
 anchor='\n route {\n';require(text.count(anchor)==1 and ':4319 {' in text,'Unexpected proxy structure')
 return text.replace(anchor,anchor+BLOCK,1).encode()

def atomic(path,raw,mode=0o644,uid=0,gid=0):
 fd,name=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
 try:
  os.fchmod(fd,mode);os.fchown(fd,uid,gid)
  with os.fdopen(fd,'wb') as output:output.write(raw);output.flush();os.fsync(output.fileno())
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def directory(path,mode=0o755,uid=0,gid=0):
 require(not path.is_symlink(),'Unexpected directory symlink');path.mkdir(parents=True,exist_ok=True);os.chmod(path,mode);os.chown(path,uid,gid)
def pids(services):return {service:command(['systemctl','show',service,'--property=MainPID','--value']) for service in services}
def health(url):
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url,timeout=2) as response:return response.status==200 and json.loads(response.read(2048)).get('status')=='ready'
 except Exception:return False

def install(packet,files):
 require(os.geteuid()==0,'Root installation required')
 role=packet['role'];before=pids(CORE if role=='core' else BOK)
 require(all(pid.isdecimal() and int(pid)>0 for pid in before.values()),'Existing service is unavailable; inspect before installation')
 original=patched=caddy_exe=None
 if role=='core':
  original=CADDY.read_bytes();patched=caddy_patch(original,packet['expectedCaddySha256'])
  node_source=pathlib.Path('/opt/board-prover/current/node/bin/node');node=node_source.read_bytes()
  require(digest(node)==packet['nodeSha256'],'Pinned Node changed')
  caddy_exe=str(pathlib.Path('/proc/'+before['rolling-application-proxy']+'/exe').resolve())
  require(command([caddy_exe,'version']).startswith('v2.11.7 '),'Review Caddy reload support for this version')
  fd,candidate=tempfile.mkstemp(prefix='.ops-validate-',dir=CADDY.parent)
  try:
   with os.fdopen(fd,'wb') as output:output.write(patched)
   command([caddy_exe,'validate','--adapter','caddyfile','--config',candidate])
  finally:os.unlink(candidate)
  try:user=pwd.getpwnam('rolling-ops')
  except KeyError:
   command(['useradd','--system','--user-group','--home-dir',str(DATA),'--no-create-home','--shell','/usr/sbin/nologin','rolling-ops']);user=pwd.getpwnam('rolling-ops')
  require(user.pw_uid!=0 and user.pw_shell in ('/usr/sbin/nologin','/bin/false'),'Unexpected operations user')
  uid,gid=user.pw_uid,user.pw_gid
 else:uid=gid=0
 directory(BASE);directory(BASE/'releases');directory(CONFIG,0o750,0,gid);directory(DATA,0o700,uid,gid)
 release=BASE/'releases'/packet['revision'];directory(release)
 for relative,raw in files.items():
  destination=release/relative
  # Explicit permissions for every intermediate directory: installer umask is0077.
  parent=release
  for part in pathlib.PurePosixPath(relative).parts[:-1]:
   parent=parent/part;directory(parent)
  if destination.exists():require(not destination.is_symlink() and destination.read_bytes()==raw,'Source revision already installed with different bytes')
  else:atomic(destination,raw)
 atomic(CONFIG/'observer.json',json.dumps(packet['observerConfig'],separators=(',',':')).encode(),0o600)
 if role=='core':
  directory(BASE/'runtime');atomic(BASE/'runtime'/'node',node,0o555)
  command([str(BASE/'runtime'/'node'),'--check',str(release/'ops/server.mjs')])
  atomic(CONFIG/'server.json',json.dumps(packet['serverConfig'],separators=(',',':')).encode(),0o640,0,gid)
 temporary=BASE/'.current-new'
 if temporary.is_symlink():temporary.unlink()
 require(not temporary.exists(),'Unexpected release staging path');temporary.symlink_to(release);os.replace(temporary,BASE/'current')
 if role=='core':
  unit='''[Unit]
Description=Rolling private operations dashboard
After=network-online.target
[Service]
Type=simple
User=rolling-ops
Group=rolling-ops
WorkingDirectory=/opt/rolling-ops/current
ExecStart=/opt/rolling-ops/runtime/node /opt/rolling-ops/current/ops/server.mjs /etc/rolling-ops/server.json
Restart=on-failure
RestartSec=5
UMask=0077
MemoryMax=256M
CPUQuota=25%
TasksMax=64
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/rolling-ops
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=169.254.169.254/32
IPAddressDeny=fd00:ec2::254/128
CapabilityBoundingSet=
LockPersonality=yes
[Install]
WantedBy=multi-user.target
'''
  atomic(pathlib.Path('/etc/systemd/system/rolling-ops.service'),unit.encode())
  if packet.get('snapshotConfig'):
   atomic(CONFIG/'snapshot.json',json.dumps(packet['snapshotConfig']).encode(),0o600)
   atomic(pathlib.Path('/etc/systemd/system/rolling-ops-snapshot.service'),b'''[Unit]
Description=Import private aggregate operations observation
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/rolling-ops/current/ops/pull-snapshot.py --config /etc/rolling-ops/snapshot.json
User=root
UMask=0077
TimeoutStartSec=25
MemoryMax=128M
CPUQuota=10%
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/rolling-ops
''')
   atomic(pathlib.Path('/etc/systemd/system/rolling-ops-snapshot.timer'),b'''[Unit]
Description=Refresh aggregate operations observation
[Timer]
OnBootSec=15
OnUnitActiveSec=30
AccuracySec=1
[Install]
WantedBy=timers.target
''')
  command(['systemctl','daemon-reload']);command(['systemctl','enable','rolling-ops.service'])
  command(['systemctl','restart','rolling-ops.service'])
  deadline=time.monotonic()+10
  while not health('http://127.0.0.1:4320/_ops/health'):
   require(time.monotonic()<deadline,'Operations service failed readiness');time.sleep(.25)
  require(CADDY.read_bytes()==original,'Proxy changed during staging; route not installed')
  if patched!=original:
   saved_stat=CADDY.stat();saved_mode=saved_stat.st_mode&0o777;atomic(CONFIG/'caddy-before-ops',original,0o600)
   atomic(CADDY,patched,saved_mode,saved_stat.st_uid,saved_stat.st_gid);os.kill(int(before['rolling-application-proxy']),signal.SIGUSR1)
   deadline=time.monotonic()+10
   while not health('http://172.31.32.101:4319/_ops/health'):
    if time.monotonic()>=deadline:
     if CADDY.read_bytes()==patched:atomic(CADDY,original,saved_mode,saved_stat.st_uid,saved_stat.st_gid);os.kill(int(before['rolling-application-proxy']),signal.SIGUSR1)
     raise ValueError('Proxy route failed readiness; prior configuration restored when unchanged')
    time.sleep(.25)
  if packet.get('snapshotConfig'):command(['systemctl','enable','--now','rolling-ops-snapshot.timer'])
 after=pids(CORE if role=='core' else BOK)
 require(before==after,'Existing service PID changed during installation; inspect concurrent activity')
 return {'schemaVersion':1,'role':role,'revision':packet['revision'],'existingServicePidsUnchanged':True,'filesInstalled':len(files),'opsReady':role=='core','proxyHash':digest(patched) if patched else None}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('packet');parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 packet_path=pathlib.Path(args.packet);require(packet_path.stat().st_size<=6291456,'Packet too large')
 packet=json.loads(packet_path.read_text());files=validate_packet(packet)
 result=install(packet,files) if args.apply else {'valid':True,'role':packet['role'],'revision':packet['revision'],'files':sorted(files),'requiresApply':True}
 print(json.dumps(result,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except Exception as error:
  # Configuration/source contents and command stderr never enter SSM output.
  print(json.dumps({'ok':False,'error':str(error) if isinstance(error,ValueError) else type(error).__name__}));raise SystemExit(1)
