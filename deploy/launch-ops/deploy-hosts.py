#!/usr/bin/env python3
"""Install committed operations source; dry run unless --apply. No application changes."""
import base64,gzip,hashlib,importlib.util,json,pathlib,subprocess,tempfile,time,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=['aws','--profile','message-board-deploy','--region','us-east-1','--output','json','--no-cli-pager']
def aws(args):
 p=subprocess.run(BASE+args,capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr[:700])
 return json.loads(p.stdout) if p.stdout.strip() else {}
def send(instance,script):
 return aws(['ssm','send-command','--instance-ids',instance,'--document-name','AWS-RunShellScript','--parameters',json.dumps({'commands':[script],'executionTimeout':['120']}),'--comment','Install isolated Rolling operations sidecar'])['Command']['CommandId']
def poll(command,instance):
 for i in range(45):
  try:r=aws(['ssm','get-command-invocation','--command-id',command,'--instance-id',instance])
  except RuntimeError:time.sleep(1);continue
  if r['Status'] in ('Pending','InProgress','Delayed'):time.sleep(2);continue
  if r['Status']!='Success':raise RuntimeError(json.dumps({'status':r['Status'],'out':r.get('StandardOutputContent','')[:1500],'err':r.get('StandardErrorContent','')[:1000]}))
  return r.get('StandardOutputContent','')
 raise RuntimeError('Installation still running: '+command)

def main():
 stack=aws(['cloudformation','describe-stacks','--stack-name','rolling-chat-launch-monitor'])['Stacks'][0]
 assert stack['StackStatus'] in ('CREATE_COMPLETE','UPDATE_COMPLETE')
 outputs={r['OutputKey']:r['OutputValue'] for r in stack['Outputs']};bucket=outputs['SnapshotBucket']
 revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 spec=importlib.util.spec_from_file_location('installer',ROOT/'deploy/launch-ops/install-host.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 for source in sorted(mod.ALLOWED | {'deploy/launch-ops/install-host.py'}):
  assert (ROOT/source).read_bytes()==subprocess.check_output(['git','show',revision+':'+source],cwd=ROOT), 'Uncommitted source: '+source
 identity=json.loads((ROOT/'deploy/launch-ops/identity.json').read_text());origin='https://d30njln0kead8n.cloudfront.net'
 server={'port':4320,'revision':revision,'database':'/var/lib/rolling-ops/analytics.sqlite','reliabilityInputsFile':'/var/lib/rolling-ops/reliability-inputs.json','communityFile':'/var/lib/rolling-ops/community.json','releasesFile':'/var/lib/rolling-release-state/state.json','accessUrl':'https://us-east-1.console.aws.amazon.com/cognito/v2/idp/user-pools/'+identity['poolId']+'/users?region=us-east-1','auth':{'origin':origin,'issuer':'https://cognito-idp.us-east-1.amazonaws.com/'+identity['poolId'],'clientId':identity['clientId'],'loginDomain':'https://'+identity['domain']+'.auth.us-east-1.amazoncognito.com'}}
 roles={'core':'i-0a9b5b9ba55815cda','bok':'i-0a7d9957f2b3d7f19'};objects=[];packets={}
 for role,instance in roles.items():
  paths=sorted(mod.ALLOWED) if role=='core' else ['ops/host-observer.py']
  packet={'schemaVersion':1,'role':role,'revision':revision,'files':[{'path':p,'sha256':hashlib.sha256((ROOT/p).read_bytes()).hexdigest(),'base64':base64.b64encode((ROOT/p).read_bytes()).decode()} for p in paths],'observerConfig':{'role':role,'health':{'prover':'http://127.0.0.1:8081/healthz','query':'http://127.0.0.1:8081/healthz','moderator':'current-daemon-journal'} if role=='core' else {'bok':'http://127.0.0.1:8807/health'}}}
  if role=='core':packet.update(serverConfig=server,snapshotConfig={'region':'us-east-1','bucket':bucket},nodeSha256='7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c',expectedCaddySha256='0375eb51e9d8451a86a3ce7390c4097d54bd9235c46fb1df3df4f83a5a43d37e')
  mod.validate_packet(packet)
  payload=gzip.compress(json.dumps({'packet':packet,'installer':base64.b64encode((ROOT/'deploy/launch-ops/install-host.py').read_bytes()).decode()}).encode());key='install/'+role+'.json.gz';objects.append(key);packets[role]=(key,payload,hashlib.sha256(payload).hexdigest())
 roleName='anonymous-message-board-testnet-InstanceRole-ku6rzJWiVY4r'
 policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'s3:GetObject','Resource':[outputs['SnapshotObjectArn']]+['arn:aws:s3:::'+bucket+'/'+key for key in objects]}]}
 if '--apply' not in sys.argv:print(json.dumps({'revision':revision,'bucket':bucket,'sourceBytes':{r:len(v[1]) for r,v in packets.items()},'policy':policy,'requiresApply':True}));return
 aws(['iam','put-role-policy','--role-name',roleName,'--policy-name','RollingOperationsSnapshotRead','--policy-document',json.dumps(policy)])
 reports={}
 try:
  for role,instance in roles.items():
   key,payload,digest=packets[role]
   with tempfile.NamedTemporaryFile() as tmp:
    tmp.write(payload);tmp.flush();aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',tmp.name,'--server-side-encryption','AES256'])
   script="""set -eu
umask 077
python3 - <<'PYREMOTE'
import boto3,base64,gzip,hashlib,json,os,pathlib,subprocess,tempfile,shutil,time
from botocore.exceptions import ClientError
client=boto3.client('s3',region_name='us-east-1');bucket=%r;key=%r
for attempt in range(30):
 try:raw=client.get_object(Bucket=bucket,Key=key)['Body'].read(1048576);break
 except ClientError as error:
  if error.response.get('Error',{}).get('Code')!='AccessDenied' or attempt==29:raise SystemExit('Source access unavailable')
  time.sleep(3)
assert hashlib.sha256(raw).hexdigest()==%r
bundle=json.loads(gzip.decompress(raw));work=pathlib.Path(tempfile.mkdtemp(prefix='rolling-ops-install-',dir='/var/tmp'))
try:
 (work/'install.py').write_bytes(base64.b64decode(bundle['installer']));(work/'packet.json').write_text(json.dumps(bundle['packet']))
 subprocess.run(['/usr/bin/python3',str(work/'install.py'),str(work/'packet.json'),'--apply'],check=True)
finally:shutil.rmtree(work)
PYREMOTE
"""%(bucket,key,digest)
   command=send(instance,script);print(json.dumps({'role':role,'command':command}),flush=True);reports[role]=json.loads(poll(command,instance));print(json.dumps(reports[role]),flush=True)
 finally:
  policy['Statement'][0]['Resource']=[outputs['SnapshotObjectArn']]
  errors=[]
  try:aws(['iam','put-role-policy','--role-name',roleName,'--policy-name','RollingOperationsSnapshotRead','--policy-document',json.dumps(policy)])
  except Exception:errors.append('snapshot policy shrink failed')
  for key in objects:
   try:aws(['s3api','delete-object','--bucket',bucket,'--key',key])
   except Exception:errors.append('source artifact cleanup failed')
  if errors:raise RuntimeError('; '.join(errors))
 (ROOT/'deploy/launch-ops/host-deployment.json').write_text(json.dumps({'revision':revision,'reports':reports},indent=2)+'\n')
if __name__=='__main__':main()
