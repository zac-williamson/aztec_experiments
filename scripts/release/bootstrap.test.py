import importlib.util, pathlib, tempfile, tarfile, io, json, unittest
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
 def test_configuration_never_silently_overwrites(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'config.json';p.write_bytes(b'original')
   with self.assertRaises(ValueError):b.atomic(p,b'changed')
   self.assertEqual(p.read_bytes(),b'original')
if __name__=='__main__':unittest.main()
