import datetime, importlib.util, json, pathlib, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
host=module('host_observer','host-observer.py');external=module('external_probe','external-probe.py')
class Response:
 def __init__(self,body,status=200):self.body=body;self.status=status
 def read(self,_limit):return self.body
 def __enter__(self):return self
 def __exit__(self,*args):pass
class Opener:
 def __init__(self,response):self.response=response
 def open(self,request,timeout):return self.response
class ObserverTests(unittest.TestCase):
 def test_private_bok_failure_text_never_leaves_host(self):
  self.assertEqual(host.project_health('bok',{'status':'degraded','active':2,'lastFailure':{'message':'PRIVATE_SENTINEL'},'account':'SECRET'}),{'status':'critical','active':2})
 def test_prover_needs_real_proofs_and_query_is_independent(self):
  value={'ready':True,'proofs':'disabled','query':{'enabled':True,'ready':False},'queue':{'jobs':2,'completed':5,'failed':0,'running':True,'jobId':'SECRET'}}
  self.assertEqual(host.project_health('prover',value),{'status':'critical','retainedJobs':2,'completed':5,'failed':0,'active':1})
  self.assertEqual(host.project_health('query',value),{'status':'critical'})
 def test_health_sources_reject_nonloopback_urls(self):
  for url in ['https://example.org/health','http://169.254.169.254/','http://127.0.0.1/?secret=yes','http://user@127.0.0.1/health']:
   with self.assertRaises(ValueError):host.local_json(url)
 def test_external_prover_requires_real_work_and_query_readiness(self):
  def probe(body):return external.check('https://app.example','prover',Opener(Response(json.dumps(body).encode())))
  self.assertTrue(probe({'ready':True,'proofs':'real','query':{'ready':True}})['ok'])
  self.assertFalse(probe({'ready':True,'proofs':'disabled','query':{'ready':True}})['ok'])
  self.assertFalse(probe({'ready':True,'proofs':'real','query':{'ready':False}})['ok'])
 def test_external_does_not_echo_errors_or_response_bodies(self):
  self.assertFalse(external.check('https://app.example','website',Opener(Response(b'PRIVATE_SENTINEL',500)))['ok'])
  self.assertFalse(external.check('http://app.example','website')['ok'])
  self.assertTrue(external.check('https://app.example','website',Opener(Response(b'<html><title>Rolling Chat</title></html>')))['ok'])
 def test_moderation_projection_is_fixed_and_numeric(self):
  out=host.project_health('moderator',{'type':'billboard-moderation-health-v1','severity':'warning','lastSuccessfulIngestAgeMs':1234,'counts':{'unsignedPending':3,'private':'SECRET'},'alerts':[{'message':'SECRET'}]})
  self.assertEqual(out,{'status':'warning','ingestAgeSeconds':1.2,'queued':3})
 def test_external_feed_requires_a_complete_application_response(self):
  def probe(body):return external.check('https://app.example','feed',Opener(Response(json.dumps(body).encode())))
  good={'schemaVersion':1,'complete':True,'scope':{'boardAddress':'public'},'posts':[{'text':'PRIVATE_SENTINEL'}]}
  result=probe(good);self.assertTrue(result['ok']);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))
  self.assertFalse(probe({**good,'complete':False})['ok']);self.assertFalse(probe({'ready':True})['ok'])
class HostTransportTests(unittest.TestCase):
 def host(self,role='core'):
  return {'schemaVersion':1,'role':role,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'metrics':{'cpuPercent':25,'memoryPercent':30,'diskPercent':40},'services':{key:{'active':True,'running':True,'restarts':0} for key in external.SERVICES[role]},'health':{'prover':{'status':'healthy','configured':True,'queued':1}}}
 def test_closed_projection_preserves_only_aggregate_values(self):
  value=self.host();value['PRIVATE_SENTINEL']='secret';value['metrics']['secret']='PRIVATE_SENTINEL';value['services']['board-prover']['command']='PRIVATE_SENTINEL';value['health']['prover']['error']='PRIVATE_SENTINEL'
  projected=external.sanitize_host(value,'core');self.assertNotIn('PRIVATE_SENTINEL',json.dumps(projected));self.assertTrue(external.host_ready(projected,'core'))
 def test_absent_stale_future_or_wrong_role_cannot_be_healthy(self):
  value=self.host();self.assertIsNone(external.sanitize_host(value,'bok'))
  for seconds in (-181,31):
   value['observedAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=seconds)).isoformat();self.assertIsNone(external.sanitize_host(value,'core'))
  self.assertFalse(external.host_ready(None,'core'))
 def test_missing_services_and_configured_unknown_are_unhealthy(self):
  value=self.host();value['services'].pop('rolling-query');self.assertFalse(external.host_ready(value,'core'))
  value=self.host();value['health']['funding']={'status':'unknown','configured':False};self.assertTrue(external.host_ready(value,'core'))
  value['health']['funding']['configured']=True;self.assertFalse(external.host_ready(value,'core'))
 def test_ssm_command_is_fixed_and_only_its_returned_id_is_read(self):
  from unittest.mock import MagicMock
  ssm=MagicMock();ssm.send_command.return_value={'Command':{'CommandId':'our-command'}}
  ssm.get_command_invocation.return_value={'Status':'Success','ResponseCode':0,'StandardOutputContent':json.dumps(self.host())}
  result=external.collect_hosts(ssm,'fixed-document',{'core':'instance-core'})
  self.assertIn('core',result);kwargs=ssm.send_command.call_args.kwargs
  self.assertEqual(kwargs['DocumentName'],'fixed-document');self.assertNotIn('Parameters',kwargs);self.assertFalse(kwargs['CloudWatchOutputConfig']['CloudWatchOutputEnabled'])
  ssm.get_command_invocation.assert_called_once_with(CommandId='our-command',InstanceId='instance-core')
  ssm.get_command_invocation.return_value['ResponseCode']=1;self.assertEqual(external.collect_hosts(ssm,'fixed-document',{'core':'instance-core'}),{})
 def test_sustained_capacity_or_waiting_work_is_actionable(self):
  value=self.host();value['metrics']['diskPercent']=86;self.assertFalse(external.host_ready(value,'core'))
  value=self.host();value['health']['prover']['oldestJobAgeSeconds']=121;self.assertFalse(external.host_ready(value,'core'))
  value=self.host();value['health']['prover']['queued']=0;self.assertTrue(external.host_ready(value,'core'))
class SnapshotPullTests(unittest.TestCase):
 def test_pull_preserves_observed_time_and_drops_unknown_fields(self):
  pull=module('pull_snapshot','pull-snapshot.py');at=datetime.datetime.now(datetime.timezone.utc).isoformat()
  value={'schemaVersion':1,'observedAt':at,'hosts':{},'secret':'PRIVATE_SENTINEL','external':{'schemaVersion':1,'observedAt':at,'website':{'ok':True,'latencyMs':10,'body':'PRIVATE_SENTINEL'},'prover':{'ok':True},'feed':{'ok':True}}}
  result=pull.project(value);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result));self.assertEqual(result['external']['observedAt'],at)
  value['observedAt']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=181)).isoformat()
  with self.assertRaises(ValueError):pull.project(value)
 def test_local_budget_and_backup_are_preserved_without_arbitrary_fields(self):
  import tempfile
  pull=module('pull_snapshot_local','pull-snapshot.py');at=datetime.datetime.now(datetime.timezone.utc).isoformat()
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);(root/'spending.json').write_text(json.dumps({'observedAt':at,'limitUsd':50,'forecastUsd':10,'identity':'PRIVATE_SENTINEL'}));(root/'backup-status.json').write_text(json.dumps({'configured':True,'lastSuccessAt':at,'filename':'PRIVATE_SENTINEL'}))
   result=pull.add_local_projections({'hosts':{}},root);self.assertEqual(result['spending']['forecastUsd'],10);self.assertTrue(result['backup']['configured']);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))
if __name__=='__main__':unittest.main()



