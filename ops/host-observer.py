#!/usr/bin/env python3
"""Read-only aggregate Linux snapshot. No logs, process arguments, identities or keys."""
import argparse, datetime, json, os, pathlib, subprocess, urllib.request, urllib.parse
SERVICES = {
 'core': ('rolling-node','rolling-query','board-prover','board-prover-proxy','rolling-application','rolling-application-proxy','rolling-moderator'),
 'bok': ('rolling-bok-testnet','rolling-bok-artifact-proxy'),
}
def number(value, maximum=1e15):
 return value if type(value) in (int,float) and 0 <= value <= maximum else None

def project_health(name, value):
 result={'status':'unknown'}
 if not isinstance(value,dict): return result
 if name=='prover':
  result['status']='healthy' if value.get('ready') is True and value.get('proofs')=='real' else 'critical'
  queue=value.get('queue') if isinstance(value.get('queue'),dict) else {}
  # Existing `jobs` includes completed results awaiting acknowledgement.
  for source,target in [('jobs','retainedJobs'),('queued','queued'),('completed','completed'),('failed','failed'),('oldestJobAgeSeconds','oldestJobAgeSeconds'),('oldestActiveAgeSeconds','oldestActiveAgeSeconds'),('lastWorkerMs','lastWorkerMs'),('lastQueueWaitMs','lastQueueWaitMs')]:
   if number(queue.get(source)) is not None: result[target]=queue[source]
  result['active']=queue['active'] if number(queue.get('active')) is not None else 1 if queue.get('running') is True else 0
 elif name=='query':
  query=value.get('query') if isinstance(value.get('query'),dict) else {}
  result['status']='healthy' if query.get('enabled') is True and query.get('ready') is True else 'critical'
 elif name=='bok':
  result['status']='healthy' if value.get('status') in ('ready','working') else 'critical' if value.get('status')=='degraded' else 'unknown'
  if number(value.get('active')) is not None:result['active']=value['active']
 elif name=='moderator':
  if value.get('type')!='billboard-moderation-health-v1':return result
  result['status']={'ok':'healthy','warning':'warning','critical':'critical'}.get(value.get('severity'),'unknown')
  age=value.get('lastSuccessfulIngestAgeMs')
  if number(age) is not None:result['ingestAgeSeconds']=round(age/1000,1)
  counts=value.get('counts') if isinstance(value.get('counts'),dict) else {}
  if number(counts.get('unsignedPending')) is not None:result['queued']=counts['unsignedPending']
 elif name=='funding':
  if value.get('schemaVersion')!=1:return result
  result['status']=value.get('status') if value.get('status') in ('healthy','warning','critical','unknown') else 'unknown'
  for key in ('pendingPayments','feeBalance','minimumFeeBalance'):
   if number(value.get(key)) is not None:result[key]=value[key]
 return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def local_json(url):
 parsed=urllib.parse.urlparse(url)
 if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:raise ValueError('Loopback health URL required')
 with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(url,timeout=3) as response:
  body=response.read(65537)
  if response.status!=200 or len(body)>65536:raise ValueError('Invalid health response')
  return json.loads(body)

def moderator_health():
 # Read only the current daemon's bounded recent health projections. Raw journal
 # material stays on this host and is never returned or printed.
 pid=subprocess.check_output(['systemctl','show','rolling-moderator.service','--property=MainPID','--value'],text=True,timeout=2,stderr=subprocess.DEVNULL).strip()
 if not pid.isdecimal() or int(pid)<1:return {'status':'unknown'}
 raw=subprocess.check_output(['journalctl','-u','rolling-moderator.service','_PID='+pid,'--since=-5min','-n','50','--output=json','--no-pager','--output-fields=MESSAGE,__REALTIME_TIMESTAMP'],text=True,timeout=3,stderr=subprocess.DEVNULL)
 if len(raw)>262144:return {'status':'unknown'}
 now=datetime.datetime.now(datetime.timezone.utc).timestamp()
 for line in reversed(raw.splitlines()):
  try:
   row=json.loads(line);message=row.get('MESSAGE','');start=message.find('{"type":"billboard-moderation-health-v1"')
   age=now-int(row['__REALTIME_TIMESTAMP'])/1e6
   if start<0 or age<0 or age>180:continue
   value=json.loads(message[start:]);out=project_health('moderator',value)
   if 'ingestAgeSeconds' in out:out['ingestAgeSeconds']=round(out['ingestAgeSeconds']+age,1)
   # Do not count an earlier PID's health after a restart during the read.
   current=subprocess.check_output(['systemctl','show','rolling-moderator.service','--property=MainPID','--value'],text=True,timeout=2,stderr=subprocess.DEVNULL).strip()
   return out if current==pid else {'status':'unknown'}
  except (ValueError,TypeError,KeyError):continue
 return {'status':'unknown'}

def observe(role, config, state_path=None):
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 out={'schemaVersion':1,'role':role,'observedAt':now,'metrics':{},'services':{},'health':{}}
 for name in SERVICES[role]:
  try:
   data=subprocess.check_output(['systemctl','show',name+'.service','--property=ActiveState,SubState,NRestarts'],text=True,timeout=2,stderr=subprocess.DEVNULL)
   fields=dict(line.split('=',1) for line in data.splitlines() if '=' in line)
   out['services'][name]={'active':fields.get('ActiveState')=='active','running':fields.get('SubState')=='running','restarts':number(int(fields.get('NRestarts','0')))}
  except (OSError,ValueError,subprocess.SubprocessError):pass
 try:
  mem=dict((line.split(':')[0],int(line.split()[1])) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
  out['metrics']['memoryPercent']=round(100*(1-mem['MemAvailable']/mem['MemTotal']),2)
 except (OSError,ValueError,KeyError,ZeroDivisionError):pass
 try:
  disk=os.statvfs('/');out['metrics']['diskPercent']=round(100*(1-disk.f_bavail/disk.f_blocks),2)
  out['metrics']['loadAverage1']=round(os.getloadavg()[0],2)
 except (OSError,ZeroDivisionError):pass
 try:
  cpu=[int(v) for v in pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
  current={'total':sum(cpu),'idle':cpu[3]+cpu[4]}
  if state_path:
   path=pathlib.Path(state_path)
   try:
    previous=json.loads(path.read_text());delta=current['total']-previous['total'];idle=current['idle']-previous['idle']
    if delta>0 and 0<=idle<=delta:out['metrics']['cpuPercent']=round(100*(1-idle/delta),2)
   except (OSError,ValueError,KeyError,TypeError):pass
   path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(current));os.chmod(temporary,0o600);temporary.replace(path)
 except (OSError,ValueError,IndexError):pass
 sources=config.get('health',{})
 for name in ('prover','query','moderator','funding') if role=='core' else ('bok',):
  try:
   source=sources.get(name)
   if name=='moderator' and source=='current-daemon-journal':out['health'][name]={**moderator_health(),'configured':True}
   elif isinstance(source,str):out['health'][name]={**project_health(name,local_json(source)),'configured':True}
   else:out['health'][name]={'status':'unknown','configured':False}
  except (OSError,ValueError,TypeError,subprocess.SubprocessError):out['health'][name]={'status':'unknown','configured':isinstance(source,str)}
 return out

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('role',choices=SERVICES);parser.add_argument('--config');parser.add_argument('--state')
 args=parser.parse_args();config=json.loads(pathlib.Path(args.config).read_text()) if args.config else {}
 print(json.dumps(observe(args.role,config,args.state),separators=(',',':')))
