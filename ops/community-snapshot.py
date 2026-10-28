"""Narrow root exporter: read only the public index; atomically publish counts.

The service mounts the application index read-only. No private wallet state is read.
"""
import grp,json,os,pathlib,subprocess,tempfile
def main():
 result=subprocess.run(['/opt/rolling-ops/runtime/node','/opt/rolling-ops/current/ops/community-export.mjs','/etc/rolling-app/public.json'],capture_output=True,timeout=45)
 if result.returncode or len(result.stdout)>32768:raise ValueError('Unavailable')
 value=json.loads(result.stdout)
 if not isinstance(value,dict) or set(value)!={'7','30'}:raise ValueError('Unavailable')
 destination=pathlib.Path('/var/lib/rolling-ops/community.json')
 fd,name=tempfile.mkstemp(prefix='.community-',dir=destination.parent)
 try:
  os.fchmod(fd,0o640);os.fchown(fd,0,grp.getgrnam('rolling-ops').gr_gid)
  with os.fdopen(fd,'w') as out:json.dump(value,out,separators=(',',':'),allow_nan=False)
  os.replace(name,destination)
 finally:
  if os.path.exists(name):os.unlink(name)
if __name__=='__main__':
 try:main()
 except Exception:raise SystemExit('Public summary unavailable; previous counts will expire.')
