"""Reviewed source-only prover publication.

python3 publish.py ROOT_OWNED_PACKET stage|activate
Packet: plan.json and the selected sourceFile (server.mjs by default, or
application-policy.mjs). No dependency install or native rebuild.

Required plan fields (all SHA values are full lowercase SHA256):
 commit, base, target, receiptDirectory, serverSha256, previousServerSha256,
 currentRecordSha256, configSha256, unitSha256, attestorSha256,
 controlSha256, supervisionSha256.

base must equal the freshly observed current-prover target; target must be
/opt/board-prover/releases/prover-gzip-<commit>. receiptDirectory must be
/var/lib/rolling-bootstrap-private/prover-gzip-<commit>/config.

Runtime health qualification does not establish successful real-proof execution.
That end-to-end qualification remains the caller's actual browser flow.
"""
import copy, fcntl, hashlib, importlib.util, json, os, pathlib, re, stat, subprocess, sys, time

P = pathlib.Path
UNIT = 'board-prover.service'
CURRENT = P('/opt/board-prover/current')
RECORD = P('/etc/rolling-supervision/current-prover.json')
CONFIG = P('/etc/board-prover/config.json')
FRAGMENT = P('/etc/systemd/system/board-prover.service')
ATTESTOR = P('/usr/local/lib/rolling-attest.py')
SUPERVISION = P('/usr/local/lib/rolling-supervision/supervision.py')
DROP = P('/run/systemd/system/board-prover.service.d/prover-gzip-drain.conf')
DROP_BYTES = b'[Service]\nRestart=no\n'
STATIC = ('WorkingDirectory ExecStart EnvironmentFiles User Group Restart KillMode KillSignal '
          'SendSIGKILL TimeoutStopUSec MemoryMax NoNewPrivileges ProtectSystem ProtectHome '
          'PrivateTmp PrivateDevices ProtectKernelTunables ProtectKernelModules ProtectControlGroups '
          'RestrictSUIDSGID RestrictRealtime LockPersonality RestrictNamespaces CapabilityBoundingSet '
          'AmbientCapabilities SystemCallFilter ReadWritePaths ReadOnlyPaths InaccessiblePaths '
          'FragmentPath DropInPaths').split()
os.umask(0o077)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=30).strip()


def regular(path, private=False):
    require(path.resolve(strict=True) == path, 'Symbolic path')
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'File ownership')
    if private:
        require(stat.S_IMODE(info.st_mode) == 0o600, 'Private file permissions')
    for parent in path.parents:
        item = parent.stat()
        require(item.st_uid == 0 and not item.st_mode & 0o022, 'Parent ownership')
    return info


def sha(path):
    regular(path)
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(path):
    regular(path, private=True)
    require(path.stat().st_size <= 262144, 'Oversize receipt')
    return json.loads(path.read_bytes())


def atomic(path, data, mode=0o600, uid=0, gid=0):
    require(path.parent.resolve() == path.parent and not path.is_symlink(), 'Atomic destination')
    temporary = path.with_name(path.name + '.prover-gzip-next')
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            os.fchown(stream.fileno(), uid, gid)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def save(path, value):
    atomic(path, (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode())


def props(unit, names):
    return dict(line.split('=', 1) for line in run([
        'systemctl', 'show', unit, '--property=' + ','.join(names)
    ]).splitlines())


def state(unit=UNIT):
    return props(unit, ['MainPID', 'ActiveState', 'SubState', 'NRestarts'])


def settings():
    value = props(UNIT, STATIC)
    command = value['ExecStart']
    require(command.startswith('{ ') and command.count('argv[]=') == 1, 'Unexpected configured command')
    value['ExecStart'] = command.split(' ; start_time=', 1)[0].rstrip(' }')
    return value


def definitions(unit):
    value = props(unit, ['FragmentPath', 'DropInPaths'])
    require(bool(value['FragmentPath']), 'Missing unit fragment')
    return {name: sha(P(name)) for name in [value['FragmentPath'], *value['DropInPaths'].split()]}


def protected():
    result = {}
    for line in run(['systemctl', 'list-units', '--all', '--type=service', '--plain', '--no-legend']).splitlines():
        unit = line.split()[0]
        if unit == UNIT or not unit.startswith(('rolling-', 'board-prover')):
            continue
        if props(unit, ['Type'])['Type'] == 'oneshot':
            triggers = props(unit, ['TriggeredBy'])
            result[unit] = {'definitions': definitions(unit), 'triggers': triggers}
            for timer in triggers['TriggeredBy'].split():
                result[timer] = {'definitions': definitions(timer), 'active': props(timer, ['ActiveState'])}
        else:
            result[unit] = {'state': state(unit), 'definitions': definitions(unit)}
    expected = ('rolling-node', 'rolling-query', 'board-prover-proxy', 'rolling-application',
                'rolling-application-proxy', 'rolling-moderator')
    require(all(name + '.service' in result for name in expected), 'Missing protected service')
    require(all(result[name + '.service']['state']['ActiveState'] == 'active' for name in expected),
            'Protected service not active')
    return result


def process_identity(target):
    current = state()
    if current['ActiveState'] != 'active' or not re.fullmatch('[1-9][0-9]*', current['MainPID']):
        return None
    proc = P('/proc') / current['MainPID']
    try:
        if (proc / 'cwd').resolve(strict=True) != target or (proc / 'exe').resolve(strict=True) != target / 'node/bin/node':
            return None
        return current['MainPID'], (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    except OSError:
        return None


def empty_group(group):
    require(group.startswith('/system.slice/') and '..' not in group.split('/'), 'Invalid service cgroup')
    path = P('/sys/fs/cgroup') / group.lstrip('/')
    return not path.exists() or all(not item.read_text().strip() for item in path.rglob('cgroup.procs'))


def source_files(target, files):
    for name, digest in files.items():
        require(isinstance(name, str) and all(part not in ('', '.', '..') for part in name.split('/'))
                and not name.startswith('/') and '\\' not in name, 'Invalid source path')
        require(bool(re.fullmatch('[a-f0-9]{64}', digest)), 'Invalid source digest')
        require(sha(target / name) == digest, 'Source pin changed: ' + name)


def switch_link(old, new):
    require(CURRENT.is_symlink() and CURRENT.resolve() == old, 'Current source changed')
    temporary = CURRENT.with_name('current.prover-gzip-next')
    os.symlink(new, temporary)
    try:
        require(CURRENT.resolve() == old, 'Concurrent source switch')
        os.replace(temporary, CURRENT)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def main(packet_name, operation):
    require(os.geteuid() == 0 and operation in ('stage', 'activate'), 'Root/operator mode required')
    packet = P(packet_name)
    require(packet.is_absolute() and packet.resolve() == packet, 'Packet path')
    plan = read(packet / 'plan.json')
    required = {'commit', 'base', 'target', 'receiptDirectory', 'serverSha256', 'previousServerSha256',
                'currentRecordSha256', 'configSha256', 'unitSha256', 'attestorSha256',
                'controlSha256', 'supervisionSha256'}
    require(set(plan) in (required, required | {'sourceFile'}) and all(isinstance(value, str) for value in plan.values()), 'Plan schema')
    source_file=plan.get('sourceFile','prover/server.mjs')
    require(source_file in ('prover/server.mjs','prover/application-policy.mjs'), 'Approved source file')
    require(bool(re.fullmatch('[a-f0-9]{40}', plan['commit'])), 'Commit')
    for name in required - {'commit', 'base', 'target', 'receiptDirectory'}:
        require(bool(re.fullmatch('[a-f0-9]{64}', plan[name])), 'Plan digest')
    base, target = P(plan['base']), P(plan['target'])
    require(bool(re.fullmatch('/opt/board-prover/releases/[a-z0-9][a-z0-9-]{0,127}', str(base))), 'Base path')
    require(str(target) == '/opt/board-prover/releases/prover-gzip-' + plan['commit'], 'Target path')
    receipts = P(plan['receiptDirectory'])
    require(str(receipts) == '/var/lib/rolling-bootstrap-private/prover-gzip-' + plan['commit'] + '/config', 'Receipt path')
    require(sha(ATTESTOR) == plan['attestorSha256'] and sha(SUPERVISION) == plan['supervisionSha256'], 'Control loader pin')
    spec = importlib.util.spec_from_file_location('prover_publication_observation', SUPERVISION)
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)
    h, control = monitor.load_control()
    require(sha(h['control_source']()) == plan['controlSha256'], 'Control source pin')
    plan_sha = sha(packet / 'plan.json')
    require(sha(packet / source_file) == plan['serverSha256'], 'Packet source pin')
    require(sha(RECORD) == plan['currentRecordSha256'], 'Current deployment changed')
    previous_record_bytes = RECORD.read_bytes()
    previous_record = read(RECORD)
    require(previous_record['target'] == str(base), 'Current base mismatch')
    previous_stage = read(P(previous_record['stagePath']))
    require(sha(P(previous_record['stagePath'])) == previous_record['stageSha256']
            and sha(P(previous_record['activationPath'])) == previous_record['activationSha256'], 'Prior receipts changed')
    require(previous_stage['files'][source_file] == plan['previousServerSha256'], 'Previous source binding')
    old_observation = monitor.observe_current_prover(h, control, qualify_files=True)
    require(old_observation['proverAvailability'] == 'ready', 'Current prover not ready')
    require(sha(CONFIG) == plan['configSha256'] == previous_stage['configSha256']
            and sha(FRAGMENT) == plan['unitSha256'], 'Immutable service configuration')
    require(not DROP.exists() and not DROP.is_symlink(), 'Existing publication drain')
    baseline = {'planSha256': plan_sha, 'protected': protected(), 'settings': settings(),
                'controlGroup': props(UNIT, ['ControlGroup'])['ControlGroup'],
                'oldIdentity': process_identity(base)}
    require(baseline['oldIdentity'] is not None, 'Old process identity unavailable')
    require(baseline['settings']['Restart'] in ('always', 'on-success'), 'Natural drain requires automatic restart after clean exit')
    stage_path = receipts / 'prover-stage.json'
    activation_path = receipts / 'prover-activation.json'
    candidate_record_path = receipts / 'candidate-current-prover.json'
    stage = copy.deepcopy(previous_stage)
    stage.update(target=str(target), planSha256=plan_sha)
    stage['files'][source_file] = plan['serverSha256']

    def native_files(source):
        for relative, key in [('node/bin/node', 'node'),
                              ('node_modules/@aztec-foundation/bb.js/build/amd64-linux/bb', 'bb'),
                              ('prover-release.json', 'manifest')]:
            require(sha(source / relative) == h['PINS'][key], 'Native runtime changed')
        crs_pin = stage['baseline']['runtimePins'][stage['baseline']['base'] + '/crs-manifest.json']
        require(sha(source / 'crs-manifest.json') == crs_pin, 'CRS changed')
    # Keep historical base/native/CRS and source-pin provenance byte-for-byte.
    # This single-file overlay is represented by the authoritative files map.
    if operation == 'stage':
        require(not target.exists() and not receipts.parent.exists(), 'Candidate already exists')
        receipts.mkdir(parents=True, mode=0o700)
        os.chmod(receipts.parent, 0o700)
        run(['cp', '-al', str(base), str(target)])
        info = regular(target / source_file)
        atomic(target / source_file, (packet / source_file).read_bytes(),
               stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
        source_files(target, stage['files'])
        native_files(target)
        source_files(base, previous_stage['files'])
        require(protected() == baseline['protected'] and settings() == baseline['settings']
                and process_identity(base) == baseline['oldIdentity'], 'Service changed during staging')
        save(stage_path, stage)
        save(receipts / 'publisher-baseline.json', baseline)
        print(json.dumps({'staged': True, 'source': str(target), 'stageSha256': sha(stage_path)}))
        return
    require(read(stage_path) == stage, 'Staged receipt mismatch')
    staged_baseline = read(receipts / 'publisher-baseline.json')
    require(staged_baseline['planSha256'] == plan_sha and staged_baseline['protected'] == baseline['protected']
            and staged_baseline['settings'] == baseline['settings']
            and staged_baseline['controlGroup'] == baseline['controlGroup'], 'Staging baseline changed')
    source_files(target, stage['files'])
    native_files(target)

    def fixed(expected, draining=False):
        require(CURRENT.resolve() == expected, 'Source switch changed')
        require(sha(CONFIG) == plan['configSha256'] and sha(FRAGMENT) == plan['unitSha256'], 'Configuration changed')
        require(sha(ATTESTOR) == plan['attestorSha256'] and sha(SUPERVISION) == plan['supervisionSha256']
                and sha(h['control_source']()) == plan['controlSha256'], 'Controls changed')
        require(protected() == baseline['protected'], 'Protected service changed')
        expected_settings = dict(baseline['settings'])
        if draining:
            expected_settings['Restart'] = 'no'
            expected_settings['DropInPaths'] = ' '.join(sorted([*expected_settings['DropInPaths'].split(), str(DROP)]))
        actual_settings = settings()
        actual_settings['DropInPaths'] = ' '.join(sorted(actual_settings['DropInPaths'].split()))
        expected_settings['DropInPaths'] = ' '.join(sorted(expected_settings['DropInPaths'].split()))
        require(actual_settings == expected_settings, 'Service controls changed')

    def add_drain(expected):
        DROP.parent.mkdir(parents=True, exist_ok=True)
        atomic(DROP, DROP_BYTES, 0o644)
        run(['systemctl', 'daemon-reload'])
        fixed(expected, True)

    def remove_drain():
        if DROP.exists() or DROP.is_symlink():
            regular(DROP)
            require(DROP.read_bytes() == DROP_BYTES, 'Drain file changed')
            DROP.unlink()
        run(['systemctl', 'daemon-reload'])

    def drained():
        current = state()
        return current['MainPID'] == '0' and current['ActiveState'] in ('inactive', 'failed') and empty_group(baseline['controlGroup'])

    def drain(expected):
        fixed(expected, True)
        deadline = time.monotonic() + 300
        signalled = False
        while time.monotonic() < deadline:
            if drained():
                return
            if not signalled and process_identity(expected):
                run(['systemctl', 'kill', '--kill-whom=main', '--signal=SIGTERM', UNIT])
                signalled = True
            time.sleep(1)
        raise TimeoutError('Natural drain incomplete; no forced kill or duplicate process')

    def restore_policy(expected):
        remove_drain()
        fixed(expected)
        if drained():
            run(['systemctl', 'start', UNIT])

    def qualify(expected):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if state()['ActiveState'] == 'failed':
                raise RuntimeError('Prover startup failed')
            identity = process_identity(expected)
            if identity:
                # Transport readiness is a retryable observation. Immutable
                # controls and identity checks below never become retries.
                health = control['activation_health'](observation=True)
                if health['queue'] is not None and health['query']['ready']:
                    fixed(expected)
                    control['activation_traffic'](h, 995)
                    control['activation_service']({**h, 'RELEASE': expected}, 995, 986, plan['configSha256'])
                    require(process_identity(expected) == identity, 'Prover restarted during qualification')
                    return identity, health
            time.sleep(1)
        raise TimeoutError('Prover readiness not established')

    switched = False
    new_record = None
    try:
        add_drain(base)
        drain(base)
    except BaseException:
        restore_policy(base)
        raise
    try:
        fixed(base, True)
        source_files(target, stage['files'])
        switch_link(base, target)
        switched = True
        remove_drain()
        fixed(target)
        run(['systemctl', 'start', UNIT])
        identity, health = qualify(target)
        active = {'activated': True, 'configSha256': plan['configSha256'], 'files': stage['files'],
                  'health': health, 'pid': identity[0], 'source': str(target)}
        save(activation_path, active)
        new_record = {'schemaVersion': 1, 'target': str(target), 'stagePath': str(stage_path),
                      'stageSha256': sha(stage_path), 'activationPath': str(activation_path),
                      'activationSha256': sha(activation_path)}
        save(candidate_record_path, new_record)
        qualified = monitor.observe_current_prover(h, control, qualify_files=True, record_path=candidate_record_path)
        require(qualified['proverAvailability'] == 'ready', 'Candidate unavailable')
        require(sha(RECORD) == plan['currentRecordSha256'], 'Current record changed during activation')
        require(process_identity(target) == identity, 'Candidate restarted before admission')
        fixed(target)
        save(RECORD, new_record)
        require(monitor.observe_current_prover(h, control)['proverAvailability'] == 'ready', 'Published observation failed')
        print(json.dumps({'activated': True, 'source': str(target), 'pid': identity[0],
                          'deploymentHealthQualified': True, 'endToEndProofTested': False}))
    except BaseException:
        expected = target if switched else base
        try:
            if not DROP.exists():
                add_drain(expected)
            drain(expected)
            fixed(expected, True)
            if switched:
                switch_link(target, base)
                switched = False
            # Atomic publication may have replaced the file before directory
            # fsync reported an error; inspect actual bytes rather than a flag.
            if sha(RECORD) != plan['currentRecordSha256']:
                require(new_record is not None and read(RECORD) == new_record,
                        'Published record changed before rollback')
                atomic(RECORD, previous_record_bytes)
            remove_drain()
            fixed(base)
            run(['systemctl', 'start', UNIT])
            restored_identity, restored_health = qualify(base)
            require(monitor.observe_current_prover(h, control)['proverAvailability'] == 'ready', 'Rollback observation failed')
            save(receipts / 'rollback.json', {'restored': True, 'source': str(base),
                                           'pid': restored_identity[0], 'health': restored_health})
        except BaseException:
            restore_policy(target if switched else base)
            raise
        raise


if __name__ == '__main__':
    # Same-host overlay publications serialize. No application operation waits on
    # this lock; it is solely the root operator's deployment mutex.
    require(len(sys.argv) == 3, 'Usage: publish.py PACKET stage|activate')
    lock = os.open('/run/lock/rolling-prover-publication.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main(*sys.argv[1:])
    finally:
        os.close(lock)
