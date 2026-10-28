import base64, hashlib, importlib.util, pathlib, unittest
ROOT=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('install_host',ROOT/'install-host.py');installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
class InstallTests(unittest.TestCase):
 def packet(self):
  raw=b'approved-source'
  return {'schemaVersion':1,'role':'bok','revision':'a'*40,'observerConfig':{'role':'bok','health':{'bok':'http://127.0.0.1:8807/health'}},'files':[{'path':'ops/host-observer.py','sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}]}
 def test_packet_verifies_content_and_destination(self):
  value=self.packet();self.assertEqual(installer.validate_packet(value),{'ops/host-observer.py':b'approved-source'})
  value['files'][0]['sha256']='0'*64
  with self.assertRaises(ValueError):installer.validate_packet(value)
 def test_packet_requires_approved_paths_and_local_health(self):
  value=self.packet();value['files'][0]['path']='ops/unknown.py'
  with self.assertRaises(ValueError):installer.validate_packet(value)
  value=self.packet();value['observerConfig']['health']['bok']='https://service.example/health'
  with self.assertRaises(ValueError):installer.validate_packet(value)
 def test_route_is_a_sibling_before_api_and_static_catchall(self):
  original=b'{\n admin off\n}\n:4319 {\n bind 172.31.32.101\n route {\n  handle @api {\n   reverse_proxy 127.0.0.1:4318\n  }\n  handle {\n   route {\n   }\n  }\n }\n}\n'
  fingerprint=installer.digest(original);result=installer.caddy_patch(original,fingerprint)
  self.assertEqual(result.replace(installer.BLOCK.encode(),b''),original)
  self.assertLess(result.index(b'@rolling_ops'),result.index(b'handle @api'))
  self.assertEqual(installer.caddy_patch(result,fingerprint),result)
  with self.assertRaises(ValueError):installer.caddy_patch(original+b'\n',fingerprint)
if __name__=='__main__':unittest.main()
