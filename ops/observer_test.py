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
 def test_local_budget_survives_without_overriding_host_backup_projection(self):
  import tempfile
  pull=module('pull_snapshot_local','pull-snapshot.py');at=datetime.datetime.now(datetime.timezone.utc).isoformat()
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);(root/'spending.json').write_text(json.dumps({'observedAt':at,'limitUsd':50,'forecastUsd':10,'identity':'PRIVATE_SENTINEL'}));(root/'backup-status.json').write_text(json.dumps({'configured':True,'lastSuccessAt':at,'filename':'PRIVATE_SENTINEL'}))
   result=pull.add_local_projections({'hosts':{},'backup':{'configured':True,'lastOutcome':'restore-failed'}},root);self.assertEqual(result['spending']['forecastUsd'],10);self.assertEqual(result['backup']['lastOutcome'],'restore-failed');self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))
class BackupObservationTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime.datetime.now(datetime.timezone.utc);self.at=self.now.isoformat()
 def backup(self,**extra):return {'configured':True,'lastOutcome':'verified','lastSuccessAt':self.at,'lastVerifiedRestoreAt':self.at,**extra}
 def hosts(self):
  return {role:{'schemaVersion':1,'role':role,'observedAt':self.at,'services':{name:{'active':True,'running':True} for name in external.SERVICES[role]},'backup':self.backup()} for role in ('core','bok')}
 def test_host_projection_drops_every_nonstatus_field(self):
  source=self.backup(secret='PRIVATE_SENTINEL',archive='/private/path',lastAttemptAt=self.at)
  projected=host.project_backup_status(source);self.assertEqual(set(projected),{'configured','lastOutcome','lastSuccessAt','lastVerifiedRestoreAt'});self.assertNotIn('PRIVATE_SENTINEL',json.dumps(projected))
  cleaned=external.sanitize_host({**self.hosts()['core'],'backup':source},'core',self.now)
  self.assertEqual(cleaned['backup'],projected);self.assertNotIn('/private/path',json.dumps(cleaned))
 def test_absent_status_is_unknown_only_after_backup_unit_installed(self):
  with patch.object(host.subprocess,'check_output',return_value='loaded\n'),patch.object(host.pathlib.Path,'is_file',return_value=False):
   value=host.backup_status('core');self.assertTrue(value['configured']);self.assertFalse(external.backup_ready(value,self.now))
  with patch.object(host.subprocess,'check_output',return_value='not-found\n'),patch.object(host.pathlib.Path,'is_file',return_value=False):
   value=host.backup_status('core');self.assertFalse(value['configured']);self.assertTrue(external.backup_ready(value,self.now))
 def test_failed_stale_or_unknown_configured_backups_are_not_ready(self):
  self.assertTrue(external.backup_ready(self.backup(),self.now));self.assertTrue(external.backup_ready({'configured':False},self.now))
  for outcome in ('backup-failed','restore-failed','cleanup-failed','unknown'):
   self.assertFalse(external.backup_ready(self.backup(lastOutcome=outcome),self.now))
  for field,seconds in [('lastSuccessAt',48*3600+1),('lastVerifiedRestoreAt',7*86400+1)]:
   self.assertFalse(external.backup_ready(self.backup(**{field:(self.now-datetime.timedelta(seconds=seconds)).isoformat()}),self.now))
  self.assertFalse(external.backup_ready(self.backup(lastSuccessAt=(self.now+datetime.timedelta(seconds=31)).isoformat()),self.now))
  hosts=self.hosts();hosts['bok']['backup']['lastOutcome']='restore-failed';self.assertFalse(external.host_ready(hosts['bok'],'bok',self.now))
 def test_two_host_aggregate_uses_oldest_dates_and_worst_outcome(self):
  hosts=self.hosts();old=(self.now-datetime.timedelta(days=1)).isoformat();hosts['bok']['backup']['lastSuccessAt']=old
  self.assertEqual(external.aggregate_backups(hosts,self.now)['lastSuccessAt'],old)
  hosts['bok']['backup']['lastOutcome']='restore-failed';self.assertEqual(external.aggregate_backups(hosts,self.now)['lastOutcome'],'restore-failed')
  hosts['core']['backup']['lastOutcome']='cleanup-failed';self.assertEqual(external.aggregate_backups(hosts,self.now)['lastOutcome'],'cleanup-failed')
 def test_missing_host_unknown_or_future_backup_cannot_aggregate_green(self):
  hosts=self.hosts();hosts.pop('bok');result=external.aggregate_backups(hosts,self.now);self.assertEqual(result['lastOutcome'],'unknown');self.assertIsNone(result['lastSuccessAt'])
  hosts=self.hosts();hosts['bok']['backup']['lastOutcome']='unknown';self.assertIsNone(external.aggregate_backups(hosts,self.now)['lastVerifiedRestoreAt'])
  hosts=self.hosts();hosts['bok']['backup']['lastSuccessAt']=(self.now+datetime.timedelta(seconds=31)).isoformat();self.assertIsNone(external.aggregate_backups(hosts,self.now)['lastSuccessAt'])
  self.assertEqual(external.aggregate_backups({'core':{'backup':{'configured':False}},'bok':{'backup':{'configured':False}}},self.now),{'configured':False})
 def test_pull_preserves_bok_restore_failure_even_when_top_level_claims_success(self):
  pull=module('pull_snapshot_backup','pull-snapshot.py');hosts=self.hosts();hosts['bok']['backup']['lastOutcome']='restore-failed'
  value={'schemaVersion':1,'observedAt':self.at,'hosts':hosts,'backup':self.backup(),'external':{'schemaVersion':1,'observedAt':self.at,'website':{'ok':True},'prover':{'ok':True},'feed':{'ok':True}}}
  self.assertEqual(pull.project(value,self.now)['backup']['lastOutcome'],'restore-failed')
if __name__=='__main__':unittest.main()
