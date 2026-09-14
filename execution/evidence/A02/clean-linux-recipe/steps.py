import datetime, hashlib, json, os, pathlib, shutil, signal, subprocess, sys, time
root = pathlib.Path('/work')
out = root / '.build/linux-retry-evidence'
out.mkdir(parents=True)
records = []
def save():
    (out / 'steps.json').write_text(json.dumps(records, indent=2) + '\n')
def verify(label):
    inventory = json.loads((root / 'clean-source-inventory.json').read_text())
    differences = [name for name, expected in inventory['sourceInputs'].items() if not (root/name).is_file() or hashlib.sha256((root/name).read_bytes()).hexdigest() != expected]
    for name, expected in inventory['sourceSymlinks'].items():
        if not (root/name).is_symlink() or str((root/name).readlink()) != expected:
            differences.append(name + ':symlink')
    (out / (label + '.json')).write_text(json.dumps({'differences': differences, 'count': len(inventory['sourceInputs'])}, indent=2)+'\n')
    if differences:
        raise RuntimeError('Source inventory mismatch: ' + ', '.join(differences))
verify('source-before')
PERMISSION_PROBE = "import os,json,pathlib,hashlib,uuid\nroot=pathlib.Path('/work');inv=json.loads((root/'clean-source-inventory.json').read_text())\nassert os.getuid()==0 and os.getgid()==0\nfor name,expected in inv['sourceInputs'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name\nfor name,target in inv['sourceSymlinks'].items():assert str((root/name).readlink())==target,name\npaths={root}\nfor name in inv['sourceInputs']:\n for p in (root/name).parents:\n  if p==root:break\n  paths.add(p)\ncreated=[]\nfor name in ['.build/toolchain','.build/crs-cache','billboard/target','billboard/portal/cache']:\n p=root/name;missing=[];current=p\n while not current.exists():missing.append(current);current=current.parent\n p.mkdir(parents=True,exist_ok=True);created.extend(reversed(missing));paths.add(p)\nresults=[]\ntry:\n for p in sorted(paths):\n  s=p.stat();assert s.st_uid==0 and s.st_gid==0,str(p)\n  probe=p/('ownership-write-probe-'+uuid.uuid4().hex)\n  try:\n   with probe.open('xb') as stream:stream.write(b'probe')\n  finally:probe.unlink(missing_ok=True)\n  results.append({'path':str(p),'uid':s.st_uid,'gid':s.st_gid,'mode':oct(s.st_mode & 0o777),'write':'pass'})\nfinally:\n for p in sorted(set(created),key=lambda x:len(x.parts),reverse=True):p.rmdir()\nassert all(not p.exists() for p in created)\nprint(json.dumps({'effectiveUid':os.getuid(),'effectiveGid':os.getgid(),'verifiedSourceFiles':len(inv['sourceInputs']),'verifiedSymlinks':len(inv['sourceSymlinks']),'directoryChecks':results,'createdProbeDirectoriesRemoved':all(not p.exists() for p in created)}))\n"
steps = [
('fresh-environment', ['bash','-ceu', '''node --version
uname -a
test "$(node --version)" = 'v24.21.0'
test "$(uname -m)" = 'aarch64'
for absent in /root/nargo /root/.svm /root/.npm /work/node_modules /work/billboard/portal/node_modules /work/shared/rpc-config.json /work/billboard/target /work/apps/dist /work/.build/crs-cache /work/.build/toolchain; do test ! -e "$absent"; done
printf 'Fresh dependency caches and generated outputs confirmed absent.\\n'
'''], 30),
('source-permissions', ['python3','-c',PERMISSION_PROBE], 60),
('foundry', ['bash','-ceu', '''curl --fail --location --show-error --max-time 180 https://github.com/foundry-rs/foundry/releases/download/v1.4.1/foundry_v1.4.1_linux_arm64.tar.gz --output /tmp/foundry.tar.gz
printf 'e0128a2e8168f9852175dfdc7eef5bfbbd864931c231ad1a428d30340614622e  /tmp/foundry.tar.gz\\n' | sha256sum --check -
mkdir -p /opt/foundry
tar -xzf /tmp/foundry.tar.gz -C /opt/foundry
forge --version
'''], 240),
('npm-root', ['npm','ci','--ignore-scripts','--no-audit','--no-fund','--timing'], 900),
('npm-portal', ['npm','ci','--prefix','billboard/portal','--ignore-scripts','--no-audit','--no-fund'], 180),
('noir-bootstrap', ['npm','run','bootstrap:noir'], 240),
('build', ['npm','run','build'], 900),
('artifacts', ['npm','run','check:artifacts'], 90),
('output-snapshot', ['node','scripts/check-reproducibility.mjs','snapshot','.build/linux-retry-evidence/output-snapshot.json'], 90),
('dependency-tests', ['npm','run','test:dependencies'], 180),
('build-tests', ['npm','run','test:build'], 180),
('interface-tests', ['node','--test','scripts/test-shell-baseline.mjs','scripts/test-receipt-baseline.mjs','scripts/test-sdk-storage.mjs','scripts/test-protocol-schema.mjs','scripts/test-protocol-commitments.mjs'], 180),
('noir-interface', ['node','scripts/fixtures/noir-interface-v1/run.mjs'], 180),
('solidity-interface', ['node','scripts/fixtures/solidity-interface-v1/run.mjs'], 180),
('portal-regressions', ['bash','-ceu','cd billboard/portal && FOUNDRY_PROFILE=regression forge test --offline -vv'], 180),
('cli-sdk', ['npm','run','test:cli-sdk'], 660),
('noir-tests', ['npm','run','test:noir'], 1320),
('output-after-tests', ['node','scripts/check-reproducibility.mjs','snapshot','.build/linux-retry-evidence/output-after-tests.json'], 60),
('output-compare', ['node','scripts/check-reproducibility.mjs','compare','.build/linux-retry-evidence/output-snapshot.json','.build/linux-retry-evidence/output-after-tests.json'], 60),
]
for label, command, timeout in steps:
    entry={'step':label, 'command':command, 'timeoutSeconds':timeout, 'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    records.append(entry); save()
    print('START '+label, flush=True)
    started=time.monotonic()
    with (out/(label+'.log')).open('w') as log:
        child=subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        entry['pid']=child.pid
        try:
            entry['exitCode']=child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            entry['exitCode']=None
            entry['timedOut']=True
        actions=[]
        def group_alive():
            try: os.killpg(child.pid,0); return True
            except ProcessLookupError: return False
        for sig, grace in [(signal.SIGTERM,8),(signal.SIGKILL,3)]:
            child.poll()
            if not group_alive(): break
            try: os.killpg(child.pid,sig); actions.append(signal.Signals(sig).name)
            except ProcessLookupError: break
            until=time.monotonic()+grace
            while group_alive() and time.monotonic()<until:
                child.poll(); time.sleep(.05)
        child.poll()
        entry['cleanup']={'signals':actions,'parentReaped':child.returncode is not None,'groupAbsent':not group_alive()}
        if not entry['cleanup']['parentReaped'] or not entry['cleanup']['groupAbsent']:
            entry['cleanupFailed']=True
    if label == 'npm-root':
        timing = out / 'npm-timing'
        timing.mkdir(exist_ok=True)
        for diagnostic in pathlib.Path('/root/.npm/_logs').glob('*-timing.json'):
            shutil.copy2(diagnostic, timing / diagnostic.name)
    entry['durationSeconds']=round(time.monotonic()-started,2)
    entry['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
    print('END '+label+' '+str(entry), flush=True)
    if entry['exitCode'] != 0 or entry.get('cleanupFailed'):
        verify('source-after-failure')
        sys.exit(1)
verify('source-after')
print('ALL STEPS PASSED', flush=True)
