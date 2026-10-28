"""Fixed backup-only boto3 adapter. JSON stdin/stdout pipes are private to the job."""
import json,os,pathlib,re,stat,sys
MAX_ARCHIVE=96*1024*1024
def require(value):
 if not value:raise ValueError('Invalid backup request')
def client(service,region):
 import boto3
 from botocore.config import Config
 return boto3.client(service,region_name=region,config=Config(connect_timeout=10,read_timeout=60,retries={'total_max_attempts':1}))
def local_file(value,role,name,work_root):
 require(isinstance(value,str));p=pathlib.Path(value)
 require(p.is_absolute() and p.name==name and p.parent.name.startswith('run-') and p.parent.parent==pathlib.Path(work_root)/('rolling-ops-backup-'+role))
 require(p.parent.resolve()==p.parent and stat.S_IMODE(p.parent.stat().st_mode)&0o077==0)
 return p
def dispatch(payload,client_factory=client,work_root='/run'):
 require(isinstance(payload,dict) and set(payload)=={'region','args'})
 region,args=payload['region'],payload['args']
 require(isinstance(region,str) and re.fullmatch(r'[-a-z0-9]+-\d',region) and isinstance(args,list) and all(isinstance(x,str) for x in args))
 if len(args)==5 and args[:3]==['ssm','get-parameter','--name'] and args[4]=='--with-decryption':
  require(re.fullmatch(r'/rolling/operations/backup-key/(core|bok)',args[3]))
  result=client_factory('ssm',region).get_parameter(Name=args[3],WithDecryption=True)['Parameter']
  require(result.get('Type')=='SecureString' and isinstance(result.get('Value'),str) and re.fullmatch(r'[A-Za-z0-9+/]{43}=',result['Value']))
  return {'Parameter':{'Type':'SecureString','Value':result['Value']}}
 require(len(args)>=4 and args[0]=='s3api' and args[2]=='--bucket' and re.fullmatch(r'[-a-z0-9]{3,63}',args[3]))
 operation,bucket=args[1],args[3]
 if len(args)==4 and operation in ['get-public-access-block','get-bucket-lifecycle-configuration','get-bucket-versioning']:
  s3=client_factory('s3',region)
  if operation=='get-public-access-block':
   data=s3.get_public_access_block(Bucket=bucket).get('PublicAccessBlockConfiguration',{})
   return {'PublicAccessBlockConfiguration':{k:data.get(k) is True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}}
  if operation=='get-bucket-versioning':
   value=s3.get_bucket_versioning(Bucket=bucket).get('Status');return {} if value is None else {'Status':value}
  rules=s3.get_bucket_lifecycle_configuration(Bucket=bucket).get('Rules',[])
  require(isinstance(rules,list) and len(rules)<=1000)
  return {'Rules':[{'Status':r.get('Status'),'Filter':{'Prefix':r.get('Filter',{}).get('Prefix',r.get('Prefix'))},'Expiration':{'Days':r.get('Expiration',{}).get('Days')}} for r in rules]}
 require(len(args)>=6 and args[4]=='--key')
 match=re.fullmatch(r'rolling-ops/(core|bok)/[A-Za-z0-9._:-]+\.rbackup',args[5]);require(match)
 role,key=match.group(1),args[5]
 if operation=='put-object' and len(args)==10 and args[6]=='--body' and args[8:]==['--server-side-encryption','AES256']:
  p=local_file(args[7],role,'archive.rbackup',work_root)
  with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as source:
   info=os.fstat(source.fileno());require(stat.S_ISREG(info.st_mode) and 0<info.st_size<=MAX_ARCHIVE and stat.S_IMODE(info.st_mode)&0o077==0)
   client_factory('s3',region).put_object(Bucket=bucket,Key=key,Body=source,ServerSideEncryption='AES256')
  return {}
 if operation=='get-object' and len(args)==7:
  p=local_file(args[6],role,'downloaded.rbackup',work_root)
  response=client_factory('s3',region).get_object(Bucket=bucket,Key=key)
  body=response['Body']
  try:
   require(isinstance(response.get('ContentLength'),int) and 0<response['ContentLength']<=MAX_ARCHIVE)
   with os.fdopen(os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as target:
    size=0
    for chunk in body.iter_chunks(chunk_size=1024*1024):
     size+=len(chunk);require(size<=MAX_ARCHIVE);target.write(chunk)
    require(size==response['ContentLength'])
  finally:body.close()
  return {}
 raise ValueError('Unsupported backup request')
if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.read(16385);require(len(raw)<=16384)
  result=dispatch(json.loads(raw));sys.stdout.write(json.dumps(result,separators=(',',':'))+'\n')
 except Exception:
  sys.stderr.write('BACKUP_CLOUD_UNAVAILABLE\n');sys.exit(1)
