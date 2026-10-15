"""Build an isolated Linux x86-64 runtime from the pinned installed dependencies.
No wallets, application state or operator configuration enter the package.
"""
import argparse,hashlib,importlib.util,json,pathlib,shutil,subprocess,tarfile

def release_preflight(root):
 """Reject unqualified native bytes or an incomplete helper composition before output."""
 spec=importlib.util.spec_from_file_location('release_bootstrap',pathlib.Path(__file__).with_name('bootstrap.py'))
 bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)
 pin=bootstrap.require_linux_qualification(root)
 bootstrap.startup_sources(root)
 for relative in ('deploy/prover/board-prover.service',*bootstrap.ACTIVATION_PUBLIC_FILES):
  path=pathlib.Path(root)/relative
  if path.is_symlink() or not path.is_file():raise ValueError('Activation source closure missing')
 if hashlib.sha256((pathlib.Path(root)/'deploy/prover/board-prover.service').read_bytes()).hexdigest()!=bootstrap.PROVER_UNIT_SHA:raise ValueError('Activation service source changed')
 return pin

def rolling_resources(root, node):
 pins=json.loads((root/'toolchain.json').read_text())
 if subprocess.check_output([node,'--version'],text=True).strip()!='v'+pins['node']:raise RuntimeError('Pinned validation Node required')
 script="import {loadRollingArtifacts} from "+json.dumps((root/'prover/rolling-artifacts.mjs').as_uri())+";loadRollingArtifacts();"
 subprocess.run([node,'--input-type=module','--eval',script],check=True,cwd=root)
 manifest=json.loads((root/'prover/rolling-artifacts.json').read_text())
 return [entry['path'] for entry in manifest['artifacts']]+list(manifest['inputs'])

def copy_sources(root, out, rolling=()):
 """Copy the actual runtime source closure, without native/SDK/CRS packaging.

 Kept separate so isolated import regressions need no heavyweight Linux archive.
 """
 for rel in ['prover','deploy/prover/bootstrap.py','deploy/prover/startup-stages.mjs','deploy/prover/board-prover.service','scripts/toolchain.mjs','shared/remote-prover-wire.mjs','shared/trusted-private-node.mjs','shared/rolling/compact-client.mjs','shared/portal-runtime.mjs','shared/portal-runtime.json','shared/protocol-commitments.mjs','shared/protocol-schema.mjs','toolchain.json','package.json','package-lock.json','crs-manifest.json','apps/src/billboard/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json','plugins/adapter_artifact.json']+list(rolling):
  src=root/rel;dst=out/rel;dst.parent.mkdir(parents=True,exist_ok=True)
  if src.is_dir():shutil.copytree(src,dst,ignore=shutil.ignore_patterns('.DS_Store','._*'))
  else:shutil.copyfile(src,dst)

def main():
 root=pathlib.Path(__file__).resolve().parents[2]
 a=argparse.ArgumentParser();a.add_argument('output');a.add_argument('--node-archive',required=True);a.add_argument('--application-profile',choices=['legacy','rolling'],default='legacy');a.add_argument('--validation-node',default='node');args=a.parse_args()
 linux_pin=release_preflight(root)
 rolling=rolling_resources(root,args.validation_node) if args.application_profile=='rolling' else []
 out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=False)
 seen=set()
 def copy_package(name):
  if name in seen:return
  src=root/'node_modules'/name
  if not src.exists():raise RuntimeError('Missing dependency '+name)
  seen.add(name);target=out/'node_modules'/name;target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copytree(src,target,symlinks=False,ignore=shutil.ignore_patterns('.DS_Store','._*'))
  meta=json.loads((src/'package.json').read_text())
  for dep in meta.get('dependencies',{}):copy_package(dep)
  for dep in meta.get('optionalDependencies',{}):
   if (root/'node_modules'/dep).exists():copy_package(dep)
 # Runtime provenance checks currently validate every pinned Aztec package.
 project=json.loads((root/'package.json').read_text())
 for name in {**project.get('dependencies',{}),**project.get('devDependencies',{})}:
  if name.startswith(('@aztec-labs/','@aztec-foundation/')):copy_package(name)
 copy_sources(root,out,rolling)
 manifest=json.loads((root/'crs-manifest.json').read_text())
 for entry in [manifest['derivedG1'],*[x for x in manifest['files'] if x['name'] in ['g2.dat','grumpkin_g1.dat']]]:
  src=root/'apps/dist/crs'/entry['name'];assert hashlib.sha256(src.read_bytes()).hexdigest()==entry['sha256']
  dst=out/'apps/dist/crs'/entry['name'];dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
 # Retain only the target native BB executable. The runtime uses native proving.
 build=out/'node_modules/@aztec-foundation/bb.js/build'
 assert hashlib.sha256((build/'amd64-linux/bb').read_bytes()).hexdigest()==linux_pin['sha256'], 'Linux prover differs from pinned official artifact'
 for child in build.iterdir():
  if child.name!='amd64-linux':shutil.rmtree(child) if child.is_dir() else child.unlink()
 (out/'node').mkdir();subprocess.run(['tar','-xf',str(pathlib.Path(args.node_archive).resolve()),'-C',str(out/'node'),'--strip-components=1'],check=True)
 if rolling:rolling_resources(out,args.validation_node)
 files={str(f.relative_to(out)):hashlib.sha256(f.read_bytes()).hexdigest() for f in out.rglob('*') if f.is_file() and f.name!='.DS_Store' and not f.name.startswith('._')}
 (out/'prover-release.json').write_text(json.dumps({'schemaVersion':1,'platform':'linux-x64','applicationProfile':args.application_profile,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':files},indent=2))
 print(json.dumps({'directory':str(out),'packages':len(seen),'files':len(files)}))

if __name__=='__main__':main()
