import datetime, hashlib, json, pathlib, subprocess, sys, time, uuid
root=pathlib.Path.cwd().resolve()
evidence=root/'execution/evidence/A02'
name='billboard-a02-clean-retry2-'+uuid.uuid4().hex[:10]
image='docker.io/library/node@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0'
result_path=evidence/'clean-linux-retry2-run.json'
if result_path.exists():
    raise SystemExit('Refusing to overwrite an earlier retry result')
source=root/'.build/A02-clean-linux-retry2-source'
if not (source/'clean-source-inventory.json').exists():
    raise SystemExit('Prepared source inventory required')
record={'schema':1,'containerName':name,'image':image,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timeoutSeconds':6600,'filesystem':'Container writable layer; no bind mounts, volumes, host home, socket, or exposed ports','commands':[]}
def save():
    result_path.write_text(json.dumps(record,indent=2)+'\n')
def call(args, timeout=60, archive=None):
    command=['docker']+args
    try:
        if archive:
            with archive.open('rb') as stream:
                r=subprocess.run(command,stdin=stream,capture_output=True,text=True,timeout=timeout)
        else:
            r=subprocess.run(command,capture_output=True,text=True,timeout=timeout)
        item={'command':command,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
    except subprocess.TimeoutExpired as e:
        item={'command':command,'exitCode':None,'timedOut':True,'stdout':str(e.stdout or ''),'stderr':str(e.stderr or '')}
    record['commands'].append(item);save()
    return item
create=['create','--init','--name',name,'--memory','3g','--cpus','2','--env','GOMAXPROCS=2','--pids-limit','512','--cap-drop','ALL','--security-opt','no-new-privileges','--workdir','/work','--entrypoint','bash',image,'/work/clean-container-run.sh']
save()
created=call(create)
if created['exitCode'] != 0:
    record['outcome']='fail_or_incomplete'
    record['cleanup']=call(['rm','-f',name],45)
    record['absenceCheck']=call(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],30)
    save()
    raise SystemExit('Container creation failed; details preserved')
try:
    archive=source.with_suffix('.tar')
    record['sourceArchiveSha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
    copied=call(['cp','-',name+':/work'],120,archive)
    if copied['exitCode'] != 0:
        raise RuntimeError('Source copy failed')
    inspected=call(['inspect',name])
    if inspected['exitCode'] != 0:
        raise RuntimeError('Cannot inspect owned container')
    details=json.loads(inspected['stdout'])[0]
    if details['HostConfig'].get('Init') is not True or details['Mounts'] or details['HostConfig']['PortBindings']:
        raise RuntimeError('Missing init or unexpected mounts or exposed ports')
    (evidence/'clean-linux-retry2-container-inspect.json').write_text(json.dumps(details,indent=2)+'\n')
    started=time.monotonic()
    with (evidence/'clean-linux-retry2-build.log').open('w') as log:
        try:
            result=subprocess.run(['docker','start','-a',name],stdout=log,stderr=subprocess.STDOUT,timeout=6600)
            record['attachExitCode']=result.returncode
        except subprocess.TimeoutExpired:
            record['attachExitCode']=None
            record['wrapperTimedOut']=True
            call(['stop','--time','10',name],30)
    record['durationSeconds']=round(time.monotonic()-started,2)
    current=call(['inspect',name])
    if current['exitCode']==0:
        state=json.loads(current['stdout'])[0]['State']
        record['containerState']=state
        record['containerRunOutcome']='pass' if not state['Running'] and state['ExitCode']==0 and record.get('attachExitCode')==0 else 'fail_or_incomplete'
    else:
        record['containerRunOutcome']='unknown'
    destination=evidence/'clean-linux-retry2-container-evidence'
    destination.mkdir(exist_ok=False)
    record['evidenceExtraction']=call(['cp',name+':/work/.build/linux-retry-evidence/.',str(destination)],120)
    expectedFiles=['steps.json','source-before.json','source-after.json','output-snapshot.json','output-after-tests.json','output-compare.log']
    missing=[p for p in expectedFiles if not (destination/p).is_file()]
    record['missingEvidenceFiles']=missing
    if record['evidenceExtraction']['exitCode'] != 0 or missing:
        raise RuntimeError('Evidence extraction failed or required evidence missing')
    steps=json.loads((destination/'steps.json').read_text())
    expectedSteps=['fresh-environment','source-permissions','foundry','npm-root','npm-portal','noir-bootstrap','build','artifacts','output-snapshot','dependency-tests','build-tests','interface-tests','noir-interface','solidity-interface','portal-regressions','cli-sdk','noir-tests','output-after-tests','output-compare']
    if [step['step'] for step in steps] != expectedSteps or not all(step.get('exitCode')==0 and step.get('cleanup',{}).get('parentReaped') and step.get('cleanup',{}).get('groupAbsent') for step in steps):
        raise RuntimeError('Not every intended stage passed with successful owned-process cleanup')
    for label in ['source-before','source-after']:
        if json.loads((destination/(label+'.json')).read_text())['differences']:
            raise RuntimeError('Container source attestation failed')
    reference=evidence/'native-qualification/outputs-after-checks.json'
    before=json.loads(reference.read_text());after=json.loads((destination/'output-after-tests.json').read_text())
    if before.get('schema')!=1 or before.get('algorithm')!='sha256' or not before.get('files') or before!=after:
        raise RuntimeError('Whole Linux output snapshot does not match current native reference')
    record['comparison']={'reference':str(reference.relative_to(root)),'referenceSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'matchedOutputCount':len(before['files']),'outcome':'pass'}
    record['evidenceFileHashes']={str(p.relative_to(destination)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(destination.rglob('*')) if p.is_file()}
    record['evidenceDisposition']='pass'
except Exception as error:
    record['error']=str(error)
    record['outcome']='fail_or_incomplete'
finally:
    record['cleanup']=call(['rm','-f',name],45)
    record['absenceCheck']=call(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],30)
    record['ownedContainerAbsent']=record['absenceCheck']['exitCode']==0 and not record['absenceCheck']['stdout'].strip()
    record['outcome']='pass' if record.get('containerRunOutcome')=='pass' and record.get('evidenceDisposition')=='pass' and record['cleanup']['exitCode']==0 and record['ownedContainerAbsent'] else 'fail_or_incomplete'
    record['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
print(json.dumps({k:v for k,v in record.items() if k!='commands'},indent=2))
sys.exit(0 if record.get('outcome')=='pass' else 1)
