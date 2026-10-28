"""Add only operations routes; create isolated staging CDN using existing private origin."""
import copy,json,os,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parent
BASE=['aws','--profile','message-board-deploy','--region','us-east-1','--output','json','--no-cli-pager']
def aws(args):
 p=subprocess.run(BASE+args,capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr[:1000])
 return json.loads(p.stdout) if p.stdout.strip() else {}
def submit_config(args,config):
 # Existing origins may contain private headers. Never save their configuration in Git.
 fd,name=tempfile.mkstemp(prefix='rolling-cdn-',suffix='.json')
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,'w') as out:json.dump(config,out)
  return aws(args+['--distribution-config','file://'+name])
 finally:os.unlink(name)
def behavior(origin,path=None):
 x={'TargetOriginId':origin,'ViewerProtocolPolicy':'redirect-to-https','AllowedMethods':{'Quantity':7,'Items':['GET','HEAD','OPTIONS','PUT','PATCH','POST','DELETE'],'CachedMethods':{'Quantity':2,'Items':['GET','HEAD']}},'SmoothStreaming':False,'Compress':True,'CachePolicyId':'4135ea2d-6df8-44a3-9df3-4b5a84be39ad','OriginRequestPolicyId':'216adef6-5c7f-47e4-b989-5492eafa07d3','LambdaFunctionAssociations':{'Quantity':0},'FunctionAssociations':{'Quantity':0},'FieldLevelEncryptionId':'','TrustedSigners':{'Enabled':False,'Quantity':0},'TrustedKeyGroups':{'Enabled':False,'Quantity':0}}
 if path:x['PathPattern']=path
 return x
def operations():
 d=aws(['cloudfront','get-distribution-config','--id','E3BMCK3MOVYK1K']);c=d['DistributionConfig'];before=copy.deepcopy(c)
 assert any(o['Id']=='rolling-application' for o in c['Origins']['Items'])
 rows=c.setdefault('CacheBehaviors',{'Quantity':0,'Items':[]}).setdefault('Items',[])
 for pattern in ['/_ops','/_ops/*']:
  found=[r for r in rows if r['PathPattern']==pattern]
  if found:
   expected=behavior('rolling-application',pattern)
   assert len(found)==1 and all(found[0].get(k)==v for k,v in expected.items()),'Existing operations route needs review'
  else:rows.insert(0,behavior('rolling-application',pattern))
 c['CacheBehaviors']['Quantity']=len(rows)
 assert c['Logging']['Enabled'] is False,'Raw CDN logging needs privacy review'
 if before==c:print('Operations routes already configured');return
 result=submit_config(['cloudfront','update-distribution','--id','E3BMCK3MOVYK1K','--if-match',d['ETag']],c)
 print(json.dumps({'id':result['Distribution']['Id'],'status':result['Distribution']['Status'],'routes':['/_ops','/_ops/*']}))
def staging():
 record=ROOT/'staging-distribution.json'
 if record.exists():print(record.read_text());return
 d=aws(['cloudfront','get-distribution-config','--id','E3BMCK3MOVYK1K'])['DistributionConfig'];origin=copy.deepcopy(next(x for x in d['Origins']['Items'] if x['Id']=='rolling-application'));origin['Id']='rolling-stage';origin['OriginPath']='/_stage'
 c={'CallerReference':'rolling-launch-stage-20261028','Aliases':{'Quantity':0},'DefaultRootObject':'','Origins':{'Quantity':1,'Items':[origin]},'OriginGroups':{'Quantity':0},'DefaultCacheBehavior':behavior('rolling-stage'),'CacheBehaviors':{'Quantity':0},'CustomErrorResponses':{'Quantity':0},'Comment':'Rolling isolated testnet release staging','Logging':{'Enabled':False,'IncludeCookies':False,'Bucket':'','Prefix':''},'PriceClass':'PriceClass_100','Enabled':True,'ViewerCertificate':{'CloudFrontDefaultCertificate':True},'Restrictions':{'GeoRestriction':{'RestrictionType':'none','Quantity':0}},'WebACLId':'','HttpVersion':'http2and3','IsIPV6Enabled':True}
 result=submit_config(['cloudfront','create-distribution'],c)['Distribution'];public={'id':result['Id'],'domain':result['DomainName'],'status':result['Status'],'sourceOrigin':'E3BMCK3MOVYK1K/rolling-application','originPath':'/_stage'};record.write_text(json.dumps(public,indent=2)+'\n');print(json.dumps(public))
if __name__=='__main__':{'operations':operations,'staging':staging}[sys.argv[1]]()
