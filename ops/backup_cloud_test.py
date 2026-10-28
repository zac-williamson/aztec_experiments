import importlib.util,io,json,os,pathlib,subprocess,tempfile,unittest
spec=importlib.util.spec_from_file_location('backup_cloud',pathlib.Path(__file__).with_name('backup-cloud.py'));cloud=importlib.util.module_from_spec(spec);spec.loader.exec_module(cloud)
class Body:
 def __init__(self,data):self.data=data;self.closed=False
 def iter_chunks(self,chunk_size):yield self.data
 def close(self):self.closed=True
class CloudTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name).resolve();self.work=self.root/'rolling-ops-backup-core'/'run-fixture';self.work.mkdir(parents=True,mode=0o700);self.calls=[];self.bytes=b'ciphertext-only'
  self.base=['s3api',None,'--bucket','rolling-backup-example'];self.key=['--key','rolling-ops/core/2026-10-28.rbackup']
 def tearDown(self):self.temp.cleanup()
 def client(self,service,region):self.calls.append((service,region));return self
 def request(self,args):return cloud.dispatch({'region':'us-east-1','args':args},self.client,str(self.root))
 def put_object(self,**kwargs):self.assertEqual(kwargs['ServerSideEncryption'],'AES256');self.assertEqual(kwargs['Body'].read(),self.bytes);return {'PRIVATE':'never returned'}
 def get_object(self,**kwargs):self.body=Body(self.bytes);return {'ContentLength':len(self.bytes),'Body':self.body,'PRIVATE':'never returned'}
 def get_parameter(self,**kwargs):self.assertEqual(kwargs['Name'],'/rolling/operations/backup-key/core');return {'Parameter':{'Type':'SecureString','Value':'A'*43+'=','EXTRA':'never returned'}}
 def test_only_supported_operations_and_prefixes_reach_boto(self):
  for args in [['s3api','delete-object','--bucket','rolling-backup-example',*self.key],['ssm','get-parameter','--name','/unrelated','--with-decryption'],['s3api','get-object','--bucket','rolling-backup-example','--key','unrelated/key',str(self.work/'downloaded.rbackup')]]:
   with self.assertRaises(ValueError):self.request(args)
  self.assertEqual(self.calls,[])
 def test_private_bounded_file_round_trip_does_not_return_metadata(self):
  source=self.work/'archive.rbackup';source.write_bytes(self.bytes);source.chmod(0o600)
  self.assertEqual(self.request(['s3api','put-object','--bucket','rolling-backup-example',*self.key,'--body',str(source),'--server-side-encryption','AES256']),{})
  target=self.work/'downloaded.rbackup';self.assertEqual(self.request(['s3api','get-object','--bucket','rolling-backup-example',*self.key,str(target)]),{})
  self.assertEqual(target.read_bytes(),self.bytes);self.assertEqual(target.stat().st_mode&0o077,0);self.assertTrue(self.body.closed)
  with self.assertRaises(FileExistsError):self.request(['s3api','get-object','--bucket','rolling-backup-example',*self.key,str(target)])
 def test_symlink_and_public_source_are_rejected(self):
  outside=self.root/'other';outside.write_bytes(self.bytes);source=self.work/'archive.rbackup';source.symlink_to(outside)
  args=['s3api','put-object','--bucket','rolling-backup-example',*self.key,'--body',str(source),'--server-side-encryption','AES256']
  with self.assertRaises(OSError):self.request(args)
  source.unlink();source.write_bytes(self.bytes);source.chmod(0o644)
  with self.assertRaises(ValueError):self.request(args)
  self.assertEqual(self.calls,[])
 def test_parameter_value_stays_in_captured_result_and_errors_are_constant(self):
  result=self.request(['ssm','get-parameter','--name','/rolling/operations/backup-key/core','--with-decryption']);self.assertEqual(set(result['Parameter']),{'Type','Value'})
  run=subprocess.run(['/usr/bin/python3',str(pathlib.Path(cloud.__file__))],input=json.dumps({'PRIVATE_SENTINEL':'secret'}),text=True,capture_output=True)
  self.assertNotEqual(run.returncode,0);self.assertEqual(run.stdout,'');self.assertEqual(run.stderr,'BACKUP_CLOUD_UNAVAILABLE\n')
if __name__=='__main__':unittest.main()
