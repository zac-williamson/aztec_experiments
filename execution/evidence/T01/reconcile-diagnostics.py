#!/usr/bin/env python3
"""Read-only evidence inventory. No compilation, witness mutation or proving."""
import base64, collections, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def digest(path):
 h=hashlib.sha256()
 with (ROOT/path).open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def read(path):return json.loads((ROOT/path).read_text())
original_path='execution/evidence/P04/toolchain-compiler-diagnostics.json'
original=read(original_path); assert len(original['diagnostics'])==original['constraintCoverageDiagnosticCount']==26
review=read('execution/evidence/P04/compiler-diagnostic-review-sources.json')
reviewed={f['path']:f for f in review['files'] if f['repository']=='aztec-nr'}
application={}
for label,file in [('billboard','apps/src/billboard/deploy/billboard_artifact.json'),('privateFee','apps/src/billboard/private_fee_artifact.json')]:
 a=read(file)
 application[label]={'path':file,'sha256':digest(file),'noirVersion':a['noir_version'],'functions':{f['name']:{'attributes':f['custom_attributes'],'bytecodeSha256':hashlib.sha256(base64.b64decode(f['bytecode'])).hexdigest(),'verificationKeySha256':hashlib.sha256(base64.b64decode(f['verification_key'])).hexdigest() if f.get('verification_key') else None} for f in a['functions']},'sourceFiles':{v['path']:hashlib.sha256(v['source'].encode()).hexdigest() for v in a['file_map'].values()}}
locations={}; occurrences=[]
for i,d in enumerate(original['diagnostics'],1):
 file,line,col=d['location'].rsplit(':',2); framework='aztec/'+file.split('/aztec/',1)[1]
 if d['location'] not in locations:
  prior=reviewed[framework]
  locations[d['location']]={'reviewedSource':prior,'currentEmbeddedSource':{label:{'present':file in a['sourceFiles'],'sha256':a['sourceFiles'].get(file),'matchesP04ReviewedBytes':a['sourceFiles'].get(file)==prior['sha256']} for label,a in application.items()}}
 functions=sorted({s['function'].split('::',1)[1] for s in d['callStack'] if s['function'].startswith('Billboard::')})
 if not functions:functions=[name for name,f in application['billboard']['functions'].items() if 'abi_private' in f['attributes']]
 assert all(name in application['billboard']['functions'] for name in functions)
 occurrences.append({'id':f'P04-DIAG-{i:02d}','original':d,'currentLocationSource':file,'applicationFunctionCandidates':functions,'mappingBasis':'Original named Billboard caller retained; framework-generated caller mapped conservatively to all current private entrypoints. This does not demonstrate ACIR reachability.','status':'unresolved-independent-disposition-and-hostile-witness-coverage'})
assert len(locations)==12
sdk=read('.build/sdk/sdk-manifest.json'); protocols=[]
for name,recorded in sdk['inputs'].items():
 if '/noir-protocol-circuits-types/artifacts/' not in name or not name.endswith('.json'):continue
 actual=digest(name);assert actual==recorded, 'Installed protocol artifact drift: '+name
 protocols.append({'path':name,'sha256':actual,'sdkInputHashMatches':True,'kind':'simulation' if 'simulated' in name else 'proving-artifact'})
assert protocols
for a in application.values():del a['sourceFiles']
result={'schemaVersion':1,'kind':'diagnostic-reconciliation-inventory','assurance':'Read-only exact-byte inventory; no diagnostic closed and no hostile witness executed.','original':{'path':original_path,'sha256':digest(original_path),'occurrences':26,'uniqueLocations':12,'constraintChecksDisabled':original['constraintChecksDisabled'],'compilerFlags':original['compilerFlags']},'historicalSourceIdentities':{'path':'execution/evidence/P04/compiler-diagnostic-review-sources.json','sha256':digest('execution/evidence/P04/compiler-diagnostic-review-sources.json'),'records':review['files']},'currentBuild':{'contractsManifestSha256':digest('.build/contracts-manifest.json'),'sdkManifestSha256':digest('.build/sdk/sdk-manifest.json'),'toolchain':read('toolchain.json'),'protocolPackageVersion':read('node_modules/@aztec/noir-protocol-circuits-types/package.json')['version']},'applicationArtifacts':application,'protocolArtifactsEmbeddedInSdk':protocols,'locations':locations,'occurrences':occurrences,'freshCompilerDiagnostics':'Not rerun by this script; final T01 compile output must be inventoried separately.','protocolSourceCorrespondence':'Installed artifact hashes are exact. Correspondence to reviewed protocol source, target network verification keys, and discharge of malicious cross-circuit requests remain unestablished here.','independentDisposition':'Open; agent source review is not X01 approval.'}
print(json.dumps(result,indent=2))
