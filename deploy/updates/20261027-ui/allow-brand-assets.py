"""Add only PR9's public brand assets to the existing private-origin proxy."""
import hashlib,json,os,pathlib,subprocess,tempfile,urllib.request
P=pathlib.Path
config=P('/etc/rolling-app/Caddyfile')
raw=config.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='6de583e5196c7da10a961fc0a7f2c6834ed7f71f68023c00992132c27898beae'
unit='rolling-application-proxy.service'
def prop(unit,key):return subprocess.check_output(['systemctl','show',unit,'-p',key,'--value'],text=True).strip()
pid=prop(unit,'MainPID');assert int(pid)>0
binary=str(P('/proc',pid,'exe').resolve())
protected=['rolling-application.service','rolling-node.service','rolling-query.service','rolling-moderator.service','board-prover.service','board-prover-proxy.service']
pids={name:prop(name,'MainPID') for name in protected};assert all(int(x)>0 for x in pids.values())
assets=['/fonts/DMSans-latin.woff2','/fonts/DMSans-latin-ext.woff2','/fonts/OFL.txt','/favicon.svg','/favicon-32.png','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/og.png','/site.webmanifest']
rows=raw.decode().splitlines(keepends=True)
matches=[i for i,row in enumerate(rows) if row.strip().startswith('@public path ')]
assert len(matches)==1
i=matches[0];assert all(path not in rows[i].split() for path in assets)
rows[i]=rows[i].rstrip('\n')+' '+' '.join(assets)+'\n';updated=''.join(rows).encode()
info=config.stat()
def replace(data):
 fd,name=tempfile.mkstemp(prefix='Caddyfile.pr9-',dir=config.parent)
 try:
  with os.fdopen(fd,'wb') as f:
   os.fchmod(f.fileno(),info.st_mode&0o777);os.fchown(f.fileno(),info.st_uid,info.st_gid);f.write(data);f.flush();os.fsync(f.fileno())
  subprocess.run([binary,'validate','--config',name,'--adapter','caddyfile'],check=True,capture_output=True)
  os.replace(name,config)
 finally:P(name).unlink(missing_ok=True)
try:
 replace(updated)
 subprocess.run(['systemctl','restart',unit],check=True)
 assert prop(unit,'ActiveState')=='active'
 # Same private-origin routing and authenticated upstream remain in place.
 with urllib.request.urlopen('http://172.31.32.101:4319/wallet/runtime.json',timeout=10) as response:assert response.status==200
except BaseException:
 replace(raw);subprocess.run(['systemctl','restart',unit],check=True);raise
assert all(prop(name,'MainPID')==value for name,value in pids.items())
print(json.dumps({'assets':assets,'caddySha256':hashlib.sha256(updated).hexdigest(),'proxyPid':int(prop(unit,'MainPID')),'protectedPids':pids}))
