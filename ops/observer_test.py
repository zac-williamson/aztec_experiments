import importlib.util, json, pathlib, unittest
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
if __name__=='__main__':unittest.main()
