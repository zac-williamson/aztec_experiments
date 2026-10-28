#!/usr/bin/env python3
"""Create a public baseline from an exact Git commit and verified retained build.
No builds, network calls, credentials, service changes or deployment assertions.
The resulting directory has no dependency symlink; provision that separately.
"""
import argparse,hashlib,io,json,pathlib,posixpath,re,subprocess,tarfile
ROOTS=['apps','shared','scripts','plugins','prover','billboard','experiments']
ROOT_FILES=['package.json','package-lock.json','toolchain.json','.nvmrc','noir-dependencies.json','crs-manifest.json']
GENERATED=['.build/contracts-manifest.json','.build/apps-manifest.json','.build/sdk','.build/owner-delivery','.build/rolling-wallet','billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json','experiments/private-bok/target','apps/dist/crs']
NESTED='billboard/portal/node_modules/@aztec-foundation/l1-artifacts/l1-contracts/'
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(b):return hashlib.sha256(b).hexdigest()
def safe(name):return isinstance(name,str) and bool(re.fullmatch(r'[A-Za-z0-9_./@-]+',name)) and not name.startswith('/') and all(x not in ('','.','..') for x in name.split('/'))
def source_files(repo,revision):
 require(bool(re.fullmatch('[a-f0-9]{40}',revision)),'Exact source revision required')
 raw=subprocess.check_output(['git','-C',str(repo),'archive','--format=tar',revision,*ROOTS,*ROOT_FILES])
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
  members={x.name:x for x in archive if x.isfile() or x.issym()}
  def content(name,seen=()):
   require(safe(name) and name in members and name not in seen,'Source link is not confined')
   item=members[name]
   if item.issym():return content(posixpath.normpath(posixpath.join(posixpath.dirname(name),item.linkname)),seen+(name,))
   return archive.extractfile(item).read()
  return {name:content(name) for name in sorted(members) if name!='plugins/.env.example'}
def retained_bytes(build,name):
 require(safe(name),'Invalid generated path');p=build/name;require(p.is_file() and not p.is_symlink(),'Missing or linked generated file: '+name)
 return p.read_bytes()
def materialize(repo,revision,build,output):
 require(not output.exists(),'Output must be a new directory')
 source=source_files(repo,revision);generated={}
 for name in GENERATED:
  root=build/name;require(root.exists() and not root.is_symlink(),'Missing generated input: '+name)
  for p in sorted(root.rglob('*')) if root.is_dir() else [root]:
   require(not p.is_symlink(),'Generated link rejected')
   if p.is_file():generated[p.relative_to(build).as_posix()]=p.read_bytes()
 manifests={name:json.loads(generated[name]) for name in ['.build/sdk/sdk-manifest.json','.build/rolling-wallet/manifest.json','.build/contracts-manifest.json','.build/apps-manifest.json','experiments/private-bok/target/private-bok-build.json']}
 sdk=manifests['.build/sdk/sdk-manifest.json'];wallet=manifests['.build/rolling-wallet/manifest.json']
 require(sdk['lockfile']==sha(source['package-lock.json']) and sdk['buildScript']==sha(source['scripts/build-sdk.mjs']),'SDK toolchain/lockfile differs from exact source')
 # Keep every dependency input recorded, and materialize only the Solidity source
 # closure needed by checkSdk. Top-level npm packages remain independently owned.
 dependency_inputs={};verified_inputs=0
 for manifest in manifests.values():
  for name,digest in manifest['inputs'].items():
   require(safe(name) and bool(re.fullmatch('[a-f0-9]{64}',digest)),'Invalid provenance input')
   p=build/name;require(p.is_file() and sha(p.read_bytes())==digest,'Retained build input changed: '+name)
   if name in source:require(sha(source[name])==digest,'Build input does not match requested commit: '+name)
   elif name in generated:require(sha(generated[name])==digest,'Generated provenance changed: '+name)
   elif name.startswith('node_modules/'):dependency_inputs[name]=digest
   elif name.startswith(NESTED) and name.endswith('.sol'):
    generated[name]=retained_bytes(build,name);dependency_inputs[name]=digest
   else:raise ValueError('Input is outside source or pinned generated closure: '+name)
   verified_inputs+=1
 for name,digest in sdk['outputs'].items():require(safe(name) and '/' not in name and sha(generated['.build/sdk/'+name])==digest,'SDK output changed: '+name)
 for name,record in wallet['files'].items():
  file=record['file'];raw=source.get(file,generated.get(file))
  if raw is None:
   require(file.startswith('node_modules/') and file in wallet['inputs'],'Unbound wallet asset');raw=(build/file).read_bytes()
  require(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'Wallet asset changed: '+file)
 for name,digest in manifests['.build/apps-manifest.json']['outputs'].items():require(name in source and sha(source[name])==digest,'Committed generated frontend output differs: '+name)
 crs=json.loads(source['crs-manifest.json']);require(generated['apps/dist/crs/crs-manifest.json']==source['crs-manifest.json'],'CRS manifest differs')
 for record in [*crs['files'],crs['derivedG1']]:
  raw=generated['apps/dist/crs/'+record['name']];require(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'CRS bytes differ')
 # A generated path also tracked in Git must match both authorities. The FPC
 # artifact is likewise checked against the exact source if it is tracked.
 for name,raw in generated.items():
  if name in source:require(raw==source[name],'Generated output differs from committed bytes: '+name)
 files={**source,**generated};require(not any(re.search(r'(^|/)(private|state)(/|$)|(^|/)\.env(?:\.|$)|\.(pem|key)$',name) for name in files),'Private file rejected')
 inventory={name:{'sha256':sha(raw),'bytes':len(raw)} for name,raw in sorted(files.items())}
 proof={'schemaVersion':1,'kind':'prepared-public-baseline','sourceRevision':revision,'sourceFiles':{name:sha(raw) for name,raw in source.items()},'generatedFiles':{name:sha(raw) for name,raw in generated.items()},'dependencyInputs':dependency_inputs,'provenance':{name:sha(generated[name]) for name in manifests},'verifiedInputReferences':verified_inputs,'files':inventory,'deploymentVerified':False}
 output.mkdir(mode=0o755)
 for name,raw in files.items():
  p=output/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 for p in output.rglob('*'):
  if p.is_dir():p.chmod(0o755)
 proof_file=output.parent/(output.name+'.proof.json');proof_file.write_text(json.dumps(proof,indent=2)+'\n')
 archive=output.parent/(output.name+'.tar.gz')
 with tarfile.open(archive,'w:gz',compresslevel=6) as t:
  for name,raw in sorted(files.items()):
   item=tarfile.TarInfo(name);item.size=len(raw);item.mode=0o644;item.mtime=0;t.addfile(item,io.BytesIO(raw))
 return {'directory':str(output),'proof':str(proof_file),'proofSha256':sha(proof_file.read_bytes()),'archive':str(archive),'archiveSha256':sha(archive.read_bytes()),'sourceRevision':revision,'fileCount':len(files),'verifiedInputReferences':verified_inputs,'nestedSolidityInputs':sum(name.startswith(NESTED) for name in dependency_inputs),'hostChanges':False,'deploymentVerified':False}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--repo',required=True,type=pathlib.Path);a.add_argument('--revision',required=True);a.add_argument('--build',required=True,type=pathlib.Path);a.add_argument('--output',required=True,type=pathlib.Path);args=a.parse_args()
 try:print(json.dumps(materialize(args.repo.resolve(),args.revision,args.build.resolve(),args.output.resolve())))
 except ValueError as e:print(json.dumps({'status':'blocked','error':str(e)}));raise SystemExit(1)
