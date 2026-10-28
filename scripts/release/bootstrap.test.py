import importlib.util, pathlib, tempfile, tarfile, io, json, unittest, os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('bootstrap',pathlib.Path(__file__).with_name('bootstrap.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class PayloadTests(unittest.TestCase):
 def packet(self,folder,member='source.mjs',kind=tarfile.REGTYPE):
  manifest={'schemaVersion':1,'applicationRevision':'1'*40,'support':{}}
  for name in ['application','operator']:
   archive=folder/(name+'-source.tar.gz');raw=b'export const ready=true;'
   with tarfile.open(archive,'w:gz') as t:
    item=tarfile.TarInfo(member);item.size=len(raw);item.type=kind;item.linkname='/etc/passwd' if kind==tarfile.SYMTYPE else '';t.addfile(item,io.BytesIO(raw))
   manifest[name]={'archiveSha256':b.sha(archive.read_bytes()),'files':{member:{'sha256':b.sha(raw),'bytes':len(raw)}}}
  (folder/'manifest.json').write_text(json.dumps(manifest));return manifest
 def test_valid_payload_is_read_only(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);m=self.packet(p);self.assertEqual(b.load_payload(p),m);self.assertEqual(len(list(p.iterdir())),3)
 def test_archive_link_and_traversal_are_rejected(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
   with tempfile.TemporaryDirectory() as d:
    p=pathlib.Path(d);self.packet(p,name,kind)
    with self.assertRaises(ValueError):b.load_payload(p)
 def test_changed_source_rejected_even_with_updated_archive_hash(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);m=self.packet(p);m['application']['files']['source.mjs']['sha256']='0'*64;(p/'manifest.json').write_text(json.dumps(m))
   with self.assertRaises(ValueError):b.load_payload(p)
 def test_unpacked_operator_directories_are_publicly_readable_under_private_umask(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);self.packet(p,'scripts/release/gate.mjs');target=p/'operator';old=os.umask(0o077)
   try:
    with patch.object(b.os,'chown'):b.unpack(p,'operator',target)
   finally:os.umask(old)
   for name in ['', 'scripts', 'scripts/release']:self.assertEqual((target/name).stat().st_mode&0o777,0o755)
   self.assertEqual((target/'scripts/release/gate.mjs').stat().st_mode&0o777,0o644)
 def test_prepared_baseline_binds_source_generated_bytes_and_host_dependencies(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);source=p/'source';source.mkdir();(source/'app.mjs').write_bytes(b'source');(source/'generated.mjs').write_bytes(b'compiled');deps=p/'deps';deps.mkdir();(deps/'input.js').write_bytes(b'dependency')
   files={name:{'bytes':len((source/name).read_bytes()),'sha256':b.sha((source/name).read_bytes())} for name in ['app.mjs','generated.mjs']}
   proof={'schemaVersion':1,'kind':'prepared-public-baseline','sourceRevision':'1'*40,'deploymentVerified':False,'files':files,'sourceFiles':{'app.mjs':files['app.mjs']['sha256']},'dependencyInputs':{'node_modules/input.js':b.sha(b'dependency')}}
   evidence=p/'proof.json';evidence.write_text(json.dumps(proof));digest=b.sha(evidence.read_bytes())
   with patch.object(b,'owned_public'):
    self.assertEqual(b.verify_prepared(source,evidence,digest,'1'*40,{'app.mjs':files['app.mjs']},deps),proof)
    with self.assertRaises(ValueError):b.verify_prepared(source,evidence,digest,'1'*40,{'app.mjs':{'sha256':'0'*64,'bytes':6}},deps)
    (deps/'input.js').write_bytes(b'changed')
    with self.assertRaises(ValueError):b.verify_prepared(source,evidence,digest,'1'*40,{'app.mjs':files['app.mjs']},deps)
    (deps/'input.js').write_bytes(b'dependency');(source/'generated.mjs').write_bytes(b'changed')
    with self.assertRaises(ValueError):b.verify_prepared(source,evidence,digest,'1'*40,{'app.mjs':files['app.mjs']},deps)
 def test_configuration_never_silently_overwrites(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'config.json';p.write_bytes(b'original')
   with self.assertRaises(ValueError):b.atomic(p,b'changed')
   self.assertEqual(p.read_bytes(),b'original')
if __name__=='__main__':unittest.main()
