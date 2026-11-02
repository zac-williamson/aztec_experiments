#!/usr/bin/env python3
"""Prepare mainnet host configs; writes live files only with --apply.

Run on each host with its existing credentials/configs:
  python3 mainnet-cutover.py core|bok PUBLIC_RECORD SOURCE OUTPUT [--apply]

PUBLIC_RECORD: {scope, deployment, config, nodeUrl, ethereumUrl,
               relayTerms?:{gasPoolFee,feeUsdc,maxGasWei,totalGasBudgetWei}}
`config` is the complete public wallet.config (including mainnet funding hashes).
`scope` is the complete public reader scope including Bok deployment metadata.
SOURCE is the complete built release on that host, with installed dependencies.
OUTPUT receives root-private proposed configs and an inventory (no key material).
No signing, contract deployment, or funding occurs here.
"""
import argparse, copy, json, os, pathlib, re, shlex, socket, subprocess, tempfile
from urllib.parse import urlparse


def load(p):
    return json.loads(pathlib.Path(p).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['core', 'bok'])
    parser.add_argument('record')
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--apply', action='store_true')
    a = parser.parse_args()
    record = load(a.record)
    source = str(pathlib.Path(a.source).resolve())
    if not re.fullmatch(r'/[-A-Za-z0-9_./]+', source):
        raise ValueError('Source must be a simple absolute host path')
    cfg, scope = record['config'], record['scope']
    network = cfg['network']
    assert network['chainId'] == scope['chainId'] == '1'
    assert network['rollupVersion'] == scope['rollupVersion']
    assert network['rollupAddress'] == scope['rollupAddress']
    assert cfg['board']['contractAddress'] == scope['boardAddress']
    assert cfg['bok']['contractAddress'] == scope['bok']['address']
    assert record['nodeUrl'].startswith('https://')
    assert record['ethereumUrl'] == network['ethRpcUrl']
    suffix = 'mainnet-' + scope['boardAddress'][2:]
    output = pathlib.Path(a.output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    updates, services, links = {}, [], {}

    def put(p, data):
        updates[p] = data if isinstance(data, str) else json.dumps(data, indent=2) + '\n'

    def ip_allow(urls):
        ips = set()
        for url in urls:
            host = urlparse(url).hostname
            ips.update(x[4][0] for x in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM))
        return 'IPAddressAllow=' + ' '.join(sorted(ips)) + '\n'

    allow = ip_allow([record['nodeUrl'], record['ethereumUrl']])

    def override(service, lines):
        put('/etc/systemd/system/' + service + '.d/zzz-mainnet.conf', '[Service]\n' + lines)
        services.append(service)

    if a.role == 'core':
        for directory, service in [('/etc/rolling-app', 'rolling-application.service'), ('/etc/rolling-stage', 'rolling-staging.service')]:
            public = load(directory + '/public.json')
            public.update(nodeUrl=record['nodeUrl'], scope=scope, deployment=record['deployment'])
            public['cacheDirectory'] = str(pathlib.Path(public['cacheDirectory']).parent / suffix)
            wallet = load(directory + '/wallet.json')
            old_relayer = wallet['config']['aggregateFunding'].get('usdcRelayAddress')
            wallet['config'] = copy.deepcopy(cfg)
            # Existing independently scoped stage relay keeps its own signer.
            if directory.endswith('stage') and old_relayer:
                wallet['config']['aggregateFunding']['usdcRelayAddress'] = old_relayer
            wallet['proofsEnabled'] = True
            wallet['remoteProver'].update(board=scope['boardAddress'], chainId='1', rollupVersion=scope['rollupVersion'], proofsEnabled=True)
            relay = load(directory + '/relay.json')
            relay['ethereumUrl'] = record['ethereumUrl']
            relay['stateDirectory'] = str(pathlib.Path(relay['stateDirectory']).parent / suffix)
            funding = wallet['config']['aggregateFunding']
            policy = relay['policy']
            for key in ['chainId', 'router', 'routerCodeHash', 'collateralPortal', 'feePortal', 'bokPortal', 'privateFpc', 'usdcCodeHash', 'usdcImplementation', 'usdcImplementationCodeHash', 'weth', 'quoter', 'quoterCodeHash']:
                policy[key] = funding[key]
            policy.update(development=False, usdc=funding['bokToken'], relayer=funding['usdcRelayAddress'])
            policy.update(record.get('relayTerms', {}))
            put(directory + '/public.json', public)
            put(directory + '/wallet.json', wallet)
            put(directory + '/relay.json', relay)
            release_link = '/opt/rolling-stage/current' if directory.endswith('stage') else '/opt/rolling-release-live/current'
            links[release_link] = source
            override(service, f'WorkingDirectory={release_link}\nExecStart=\nExecStart=/opt/rolling-ops/runtime/node apps/rolling/start.mjs {directory}/public.json {directory}/wallet.json {directory}/relay.json\n' + allow)
        for p, service in [('/etc/board-prover/config.json', 'board-prover.service'), ('/etc/rolling-query/config.json', 'rolling-query.service')]:
            data = load(p)
            data.update(chainId='1', rollupVersion=scope['rollupVersion'], proofs='real')
            data['queryNode'].update(url=record['nodeUrl'], rollupAddress=scope['rollupAddress'])
            # Public Aztec RPC does not implement our optional compact-node extension.
            data.pop('compactBlocks', None)
            data.pop('compactRequestsPerMinute', None)
            if data.get('serviceMode') != 'query-only':
                data.update(board=scope['boardAddress'], privateFeeAddress=cfg['privateFee']['contractAddress'], privateBokAddress=cfg['bok']['contractAddress'], pluginAddresses=[])
            put(p, data)
            override(service, f'WorkingDirectory={source}\nExecStart=\nExecStart=/opt/rolling-ops/runtime/node prover/start.mjs {p}\n' + allow)
        moderator_path = '/var/lib/rolling-bootstrap-private/moderator-current/config.json'
        moderator = load(moderator_path)
        moderator.update(chainId='1', rollupVersion=scope['rollupVersion'], rollupAddress=scope['rollupAddress'], boardAddress=scope['boardAddress'], ethereumUrl=record['ethereumUrl'], deployment=record['deployment'], development=False)
        put(moderator_path, moderator)
        # Keep every model, limit and credential option from the installed command.
        raw = subprocess.check_output(['systemctl', 'show', 'rolling-moderator.service', '--property=ExecStart', '--value'], text=True)
        command = re.search(r'argv\[\]=(.*?) ; ignore_errors=', raw).group(1)
        command = re.sub(r'--state-dir\s+\S+', '--state-dir /var/lib/rolling-moderator/' + suffix, command)
        override('rolling-moderator.service', f'WorkingDirectory={source}\nExecStart=\nExecStart={command}\n' + allow)
        verifier = load('/etc/rolling-release/public-verifier.json')
        verifier.update(nodeUrl=record['nodeUrl'], scope=scope)
        put('/etc/rolling-release/public-verifier.json', verifier)
        instructions = ['Rebuild wallet assets with the new deployment-registration.json before restarting the app.',
            'Reseal the mainnet release with scripts/release/seal-current.mjs after public smoke succeeds.',
            'Both release links are switched to SOURCE on apply; reseal this release before enabling automatic release jobs.',
            'The release journey wallet must be funded on mainnet; never reuse a Sepolia balance assertion.']
    else:
        p = '/etc/rolling-bok-testnet/config.json'
        bok = load(p)
        bok.update(ethereumUrl=record['ethereumUrl'], operatorAddress=cfg['bok']['operatorAddress'], deployment=record['deployment'], development=False)
        bok['stateDirectory'] = str(pathlib.Path(bok['stateDirectory']).parent / suffix)
        bok['descriptor']['scope'].update(chainId='1', rollupVersion=scope['rollupVersion'], rollupAddress=scope['rollupAddress'], boardAddress=scope['boardAddress'], receiver=scope['bok']['address'])
        bok['descriptor']['funding'].update(portalAddress=cfg['aggregateFunding']['bokPortal'], tokenAddress=cfg['aggregateFunding']['bokToken'])
        bok['staticPublication']['boardOrigin'] = 'https://rolling.chat'
        put(p, bok)
        override('rolling-bok-testnet.service', f'WorkingDirectory={source}\n' + allow)
        instructions = ['Ensure retained Bok operator has mainnet public FeeJuice before restarting.', 'Keep existing credential files, GitHub access and generated-app sandbox unchanged.']

    for target, text in updates.items():
        staged = output / target.lstrip('/')
        staged.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        staged.write_text(text)
        staged.chmod(0o600)
    (output / 'plan.json').write_text(json.dumps({'role': a.role, 'source': source, 'targets': list(updates), 'links': links, 'restart': services, 'remaining': instructions}, indent=2) + '\n')
    if a.apply:
        for target, text in updates.items():
            p = pathlib.Path(target)
            p.parent.mkdir(parents=True, exist_ok=True)
            old = p.stat() if p.exists() else None
            fd, temporary = tempfile.mkstemp(prefix='.mainnet-', dir=p.parent)
            with os.fdopen(fd, 'w') as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, old.st_mode & 0o777 if old else 0o644)
            if old:
                os.chown(temporary, old.st_uid, old.st_gid)
            os.replace(temporary, p)
        for target, destination in links.items():
            p = pathlib.Path(target)
            p.parent.mkdir(parents=True, exist_ok=True)
            temporary = p.with_name(p.name + '.mainnet')
            if temporary.is_symlink():
                temporary.unlink()
            temporary.symlink_to(destination)
            os.replace(temporary, p)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        # Restart query/prover first so consumers see the new scope immediately.
        ordered = sorted(services, key=lambda s: 0 if s in ['rolling-query.service', 'board-prover.service'] else 1)
        for service in ordered:
            subprocess.run(['systemctl', 'restart', service], check=True)
    print(json.dumps({'prepared': len(updates), 'applied': a.apply, 'plan': str(output / 'plan.json')}))


if __name__ == '__main__':
    main()
