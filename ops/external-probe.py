"""AWS Lambda probe: runs outside application hosts; emits aggregate CloudWatch metrics."""
import concurrent.futures, datetime, json, math, os, time, urllib.parse, urllib.request

SERVICES={
 'core':('rolling-node','rolling-query','board-prover','board-prover-proxy','rolling-application','rolling-application-proxy','rolling-moderator'),
 'bok':('rolling-bok-testnet','rolling-bok-artifact-proxy'),
}
COUNT_KEYS=('active','queued','retainedJobs','completed','failed','oldestJobAgeSeconds','oldestActiveAgeSeconds','lastWorkerMs','lastQueueWaitMs','ingestAgeSeconds','headLagBlocks','pendingPayments','feeBalance','minimumFeeBalance','providerSpendUsd')
def numeric(value,maximum=1e15):
 return type(value) in (int,float) and math.isfinite(value) and 0<=value<=maximum

def sanitize_host(value,role,now=None):
 """Second closed projection before persistence. No SSM stderr or raw text."""
 if not isinstance(value,dict) or value.get('schemaVersion')!=1 or value.get('role')!=role:return None
 try:
  observed=datetime.datetime.fromisoformat(value['observedAt'].replace('Z','+00:00'))
  if observed.tzinfo is None:return None
  age=((now or datetime.datetime.now(datetime.timezone.utc))-observed).total_seconds()
  if age < -30 or age > 180:return None
 except (ValueError,KeyError,TypeError,AttributeError):return None
 result={'schemaVersion':1,'role':role,'observedAt':observed.astimezone(datetime.timezone.utc).isoformat(),'services':{},'metrics':{},'health':{}}
 services=value.get('services') if isinstance(value.get('services'),dict) else {}
 for name in SERVICES[role]:
  service=services.get(name)
  if not isinstance(service,dict) or type(service.get('active')) is not bool or type(service.get('running')) is not bool:continue
  result['services'][name]={'active':service['active'],'running':service['running']}
  if numeric(service.get('restarts')):result['services'][name]['restarts']=service['restarts']
 metrics=value.get('metrics') if isinstance(value.get('metrics'),dict) else {}
 for key in ('cpuPercent','memoryPercent','diskPercent','loadAverage1'):
  if numeric(metrics.get(key),10000 if key=='loadAverage1' else 100):result['metrics'][key]=metrics[key]
 health=value.get('health') if isinstance(value.get('health'),dict) else {}
 for name in ('prover','query','moderator','funding') if role=='core' else ('bok',):
  source=health.get(name)
  if not isinstance(source,dict):continue
  status=source.get('status') if source.get('status') in ('healthy','warning','critical','unknown') else 'unknown'
  item={'status':status,'configured':source.get('configured') is True or status!='unknown'}
  for key in COUNT_KEYS:
   if numeric(source.get(key)):item[key]=source[key]
  result['health'][name]=item
 return result

def collect_hosts(ssm,document,instances):
 result={}
 try:
  command=ssm.send_command(DocumentName=document,DocumentVersion='1',InstanceIds=list(instances.values()),TimeoutSeconds=60,MaxConcurrency='2',MaxErrors='2',CloudWatchOutputConfig={'CloudWatchOutputEnabled':False},Comment='Rolling aggregate host observation')['Command']['CommandId']
 except Exception:return result
 def invocation(role,instance):
  try:
   ssm.get_waiter('command_executed').wait(CommandId=command,InstanceId=instance,WaiterConfig={'Delay':2,'MaxAttempts':25})
   response=ssm.get_command_invocation(CommandId=command,InstanceId=instance)
   if response.get('Status')!='Success' or response.get('ResponseCode')!=0:return None
   text=response.get('StandardOutputContent','')
   if not isinstance(text,str) or len(text)>16384:return None
   return sanitize_host(json.loads(text),role)
  except Exception:return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  pending={role:pool.submit(invocation,role,instance) for role,instance in instances.items()}
  for role,future in pending.items():
   value=future.result()
   if value is not None:result[role]=value
 return result

def host_ready(host,role):
 if not host:return False
 for name in SERVICES[role]:
  if host.get('services',{}).get(name,{}).get('active') is not True or host.get('services',{}).get(name,{}).get('running') is not True:return False
 for health in host.get('health',{}).values():
  if health.get('configured') is True and health.get('status')!='healthy':return False
  for name,maximum in [('oldestJobAgeSeconds',120),('oldestActiveAgeSeconds',120),('ingestAgeSeconds',90)]:
   if numeric(health.get(name)) and health[name]>maximum:return False
  if numeric(health.get('feeBalance')) and numeric(health.get('minimumFeeBalance')) and health['feeBalance']<health['minimumFeeBalance']:return False
 for name,maximum in [('cpuPercent',90),('memoryPercent',90),('diskPercent',85)]:
  value=host.get('metrics',{}).get(name)
  if numeric(value) and value>=maximum:return False
 return True

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def check(origin, kind, opener=None):
 start=time.monotonic();ok=False
 try:
  parsed=urllib.parse.urlparse(origin)
  if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:raise ValueError('Invalid public origin')
  url=origin.rstrip('/')+('/prover/healthz' if kind=='prover' else '/api/home?limit=1' if kind=='feed' else '/')
  request=urllib.request.Request(url,headers={'User-Agent':'RollingChat-Health/1','Accept':'text/html' if kind=='website' else 'application/json'})
  with (opener or urllib.request.build_opener(NoRedirect())).open(request,timeout=5) as response:
   data=response.read(262145)
   if response.status!=200 or len(data)>262144:raise ValueError('Invalid probe response')
   if kind=='prover':
    body=json.loads(data)
    if not isinstance(body,dict) or not isinstance(body.get('query'),dict):raise ValueError('Invalid health shape')
    ok=body.get('ready') is True and body.get('proofs')=='real' and body['query'].get('ready') is True
   elif kind=='feed':
    body=json.loads(data)
    ok=isinstance(body,dict) and body.get('schemaVersion')==1 and body.get('complete') is True and isinstance(body.get('scope'),dict) and isinstance(body['scope'].get('boardAddress'),str) and isinstance(body.get('posts'),list)
   else:ok=b'<html' in data.lower() and b'rolling' in data.lower()
 except (OSError,ValueError,TypeError):pass
 return {'ok':ok,'latencyMs':round((time.monotonic()-start)*1000)}

def observe(origin, probe=check):
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  tasks={key:pool.submit(probe,origin,key) for key in ('website','prover','feed')}
  result={key:future.result() for key,future in tasks.items()}
 return {'schemaVersion':1,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),**result}

def handler(event, context):
 import boto3
 from botocore.config import Config
 client_config=Config(connect_timeout=3,read_timeout=5,retries={'total_max_attempts':1})
 instances={'core':os.environ['CORE_INSTANCE'],'bok':os.environ['BOK_INSTANCE']}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  host_future=pool.submit(collect_hosts,boto3.client('ssm',config=client_config),os.environ['DOCUMENT'],instances)
  result=observe(os.environ['ORIGIN']);hosts=host_future.result()
 snapshot={'schemaVersion':1,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hosts':hosts,'external':result}
 boto3.client('s3',config=client_config).put_object(Bucket=os.environ['BUCKET'],Key='snapshots/latest.json',Body=json.dumps(snapshot,separators=(',',':'),allow_nan=False).encode(),ContentType='application/json',CacheControl='no-store',ServerSideEncryption='AES256')
 metrics=[{'MetricName':name,'Value':1 if result[kind]['ok'] else 0,'Unit':'Count'} for name,kind in [('ExternalWebsiteHealthy','website'),('ExternalProverHealthy','prover'),('ExternalFeedHealthy','feed')]]
 metrics.extend([{'MetricName':'CoreHostReady' if role=='core' else 'BokHostReady','Value':1 if host_ready(hosts.get(role),role) else 0,'Unit':'Count'} for role in ('core','bok')])
 metrics.append({'MetricName':'ObserverHeartbeat','Value':1,'Unit':'Count'})
 boto3.client('cloudwatch',config=client_config).put_metric_data(Namespace='RollingChat/Operations',MetricData=metrics)
 # Fixed aggregate response only. Never log response bodies, URLs or exception strings.
 return {'schemaVersion':1,'observedAt':snapshot['observedAt'],'hostsObserved':len(hosts),'externalHealthy':all(result[kind]['ok'] for kind in ('website','prover','feed'))}
