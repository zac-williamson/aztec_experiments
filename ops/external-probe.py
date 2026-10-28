"""AWS Lambda probe: runs outside application hosts; emits aggregate CloudWatch metrics."""
import concurrent.futures, datetime, json, os, time, urllib.parse, urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def check(origin, kind, opener=None):
 start=time.monotonic();ok=False
 try:
  parsed=urllib.parse.urlparse(origin)
  if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:raise ValueError('Invalid public origin')
  url=origin.rstrip('/')+('/prover/healthz' if kind=='prover' else '/')
  request=urllib.request.Request(url,headers={'User-Agent':'RollingChat-Health/1','Accept':'application/json' if kind=='prover' else 'text/html'})
  with (opener or urllib.request.build_opener(NoRedirect())).open(request,timeout=5) as response:
   data=response.read(262145)
   if response.status!=200 or len(data)>262144:raise ValueError('Invalid probe response')
   if kind=='prover':
    body=json.loads(data)
    if not isinstance(body,dict) or not isinstance(body.get('query'),dict):raise ValueError('Invalid health shape')
    ok=body.get('ready') is True and body.get('proofs')=='real' and body['query'].get('ready') is True
   else:ok=b'<html' in data.lower() and b'rolling' in data.lower()
 except (OSError,ValueError,TypeError):pass
 return {'ok':ok,'latencyMs':round((time.monotonic()-start)*1000)}

def observe(origin, probe=check):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  tasks={key:pool.submit(probe,origin,key) for key in ('website','prover')}
  result={key:future.result() for key,future in tasks.items()}
 return {'schemaVersion':1,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),**result}

def handler(event, context):
 import boto3
 result=observe(os.environ['ORIGIN'])
 metrics=[{'MetricName':name,'Value':1 if result[kind]['ok'] else 0,'Unit':'Count'} for name,kind in [('ExternalWebsiteHealthy','website'),('ExternalProverHealthy','prover')]]
 metrics.append({'MetricName':'ObserverHeartbeat','Value':1,'Unit':'Count'})
 boto3.client('cloudwatch').put_metric_data(Namespace='RollingChat/Operations',MetricData=metrics)
 # Fixed aggregate response only. Never log response bodies, URLs or exception strings.
 return result
