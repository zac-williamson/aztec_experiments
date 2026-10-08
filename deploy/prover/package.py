"""Build an isolated Linux x86-64 runtime from the pinned installed dependencies.
No wallets, application state or operator configuration enter the package.
"""
import argparse,hashlib,json,pathlib,shutil,subprocess,tarfile
root=pathlib.Path(__file__).resolve().parents[2]
a=argparse.ArgumentParser();a.add_argument('output');a.add_argument('--node-archive',required=True);args=a.parse_args()
out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=False)
seen=set()
def copy_package(name):
 if name in seen:return
 src=root/'node_modules'/name
 if not src.exists():raise RuntimeError('Missing dependency '+name)
 seen.add(name);target=out/'node_modules'/name;target.parent.mkdir(parents=True,exist_ok=True)
 shutil.copytree(src,target,symlinks=False)
 meta=json.loads((src/'package.json').read_text())
 for dep in meta.get('dependencies',{}):copy_package(dep)
 for dep in meta.get('optionalDependencies',{}):
  if (root/'node_modules'/dep).exists():copy_package(dep)
# Runtime provenance checks currently validate every pinned Aztec package.
project=json.loads((root/'package.json').read_text())
for name in {**project.get('dependencies',{}),**project.get('devDependencies',{})}:
 if name.startswith('@aztec/'):copy_package(name)
for rel in ['prover','scripts/toolchain.mjs','shared/remote-prover-wire.mjs','toolchain.json','package.json','package-lock.json','crs-manifest.json','apps/src/billboard/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json']:
 src=root/rel;dst=out/rel;dst.parent.mkdir(parents=True,exist_ok=True)
 if src.is_dir():shutil.copytree(src,dst)
 else:shutil.copyfile(src,dst)
manifest=json.loads((root/'crs-manifest.json').read_text())
for entry in [manifest['derivedG1'],*[x for x in manifest['files'] if x['name'] in ['g2.dat','grumpkin_g1.dat']]]:
 src=root/'apps/dist/crs'/entry['name'];assert hashlib.sha256(src.read_bytes()).hexdigest()==entry['sha256']
 dst=out/'apps/dist/crs'/entry['name'];dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
# Retain only the target native BB executable. The runtime uses native proving.
build=out/'node_modules/@aztec/bb.js/build'
pins=json.loads((root/'toolchain.json').read_text());alias=json.loads((root/'prover/native-binaries.json').read_text()).get('linux-x64')
if alias:
 assert alias['packageVersion']==pins['aztec']
 assert hashlib.sha256((build/'amd64-linux/bb').read_bytes()).hexdigest()==alias['sha256'], 'Linux prover differs from pinned official artifact'
for child in build.iterdir():
 if child.name!='amd64-linux':shutil.rmtree(child) if child.is_dir() else child.unlink()
(out/'node').mkdir();subprocess.run(['tar','-xf',str(pathlib.Path(args.node_archive).resolve()),'-C',str(out/'node'),'--strip-components=1'],check=True)
files={str(f.relative_to(out)):hashlib.sha256(f.read_bytes()).hexdigest() for f in out.rglob('*') if f.is_file()}
(out/'prover-release.json').write_text(json.dumps({'schemaVersion':1,'platform':'linux-x64','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':files},indent=2))
print(json.dumps({'directory':str(out),'packages':len(seen),'files':len(files)}))
