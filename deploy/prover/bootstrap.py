"""Generate private, immutable cloud-init shell input; never calls AWS itself.

Host executable tokens are embedded and unit-tested through injected commands.
Only public pins are committed. Capability URLs belong in owner-only external files.
"""
import argparse, ast, base64, datetime as dt, gzip, hashlib, ipaddress, io, json, lzma, os, pathlib, re, signal, stat, subprocess, sys, tokenize, urllib.parse

IMAGE = "azteclabs/aztec@sha256:44479404b67dde931cf8f202a3ce34703876e709ce124924251da8435d5d8651"
NODE_SHA = "7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c"
BB_SHA = "fa4b12adaefd5684b53b802346b9fe839ab3d6a4a829a5ea4efd6bd200e0829f"
BB_VERSION = "6.0.0-rc.6"
CATALOG_SHA = "aaeab6b467fab9c87a03bb53362d2c51cf3ccefd3c5b05104a69403e0916bc93"
NETWORK = {'testnet': {'bootnodes': ['enr:-LO4QA4kHKdUJOirQ4NxtI-gjBNLRK1GPeKtmz664Uph-EqLW1B3EkCqu6ul5C7dejOBWbEWMOPZc07I0Bl8bmW5Vn0EhWF6dGVjqDAwLTExMTU1MTExLTAwMDAwMDAwLTAtMjI3ODAyMzktMmRhOWY4MDGCaWSCdjSCaXCEIlCfmYlzZWNwMjU2azGhAoRffgRFcK_rV5ddbmtUW9cyXrPwrDFL18OFRVejOOXDg3VkcIKd0A', 'enr:-LO4QO3-kuKH3c-RgaxYBWk0PiV-97B4wnvHcgMxYpB-1WjoctKlpY3Fuh29AESLhBn1WtQXE-1G0Umo_VhTcu7bLloEhWF6dGVjqDAwLTExMTU1MTExLTAwMDAwMDAwLTAtMjI3ODAyMzktMmRhOWY4MDGCaWSCdjSCaXCEIicStolzZWNwMjU2azGhAxUvKI8xXnGpkj2VjRZk9VmMbtfHZUoszOvvl76qFrGeg3VkcIKd0A', 'enr:-LO4QNTdBJe-2tIfXpzJmu4Tise0rRdPSn2gwQMtkVPe40szAdpWRgixGub2iUXMcxSQuQ8nkKh-GSvQpRKqw2XzUhQEhWF6dGVjqDAwLTExMTU1MTExLTAwMDAwMDAwLTAtMjI3ODAyMzktMmRhOWY4MDGCaWSCdjSCaXCEIrZz14lzZWNwMjU2azGhApwZiWnsA8TFqvz-sGDrgbi1AypT4QXJfFWdYOz2yeVtg3VkcIKd0A', 'enr:-Nu4QLjG2KMKvsVOjnhELmYmUO-auKssB_HPKNJitPOwXN0IYC5XPwUwZucnlAE0towcJ9lemeu4gmZkRnYWiGL_lkIHhWF6dGVjsDAwLTExMTU1MTExLWViZDk5ZmYwLTg0NTIzMTcxMy0xMmU5YWEzNi0yMjllYWRiN4JpZIJ2NINpcDaQKgEE-AJiEJUAAAAAAAAAAolzZWNwMjU2azGhA5_JMPCAGUHSS3vWQU3LlQoXnUOaO7AUNylXu2ieLTlKhHRjcDaCnJCEdWRwNoKckIN2ZXKFMi4xLjI', 'enr:-Ku4QHA70JBzwsnhlg-Y-Ud_vH_xAJtaoIAGpEGwvBFu8jHxEEVBrzMCrgRTqYpwDgPgyWPEtEGg-pWlxsK3Gq1VGa4EhWF6dGVjoDAwLS0wMDAwMDAwMC0wLTIyNzgwMjM5LTBjNzU3NmQzgmlkgnY0gmlwhNU65vmJc2VjcDI1NmsxoQLj0Km-mQSLz-0Wz8JBhBv9r0AhFbctdeO0yuT-gqUlPYN1ZHCCndA'], 'snapshots': ['https://aztec-labs-snapshots.com/testnet/', 'https://files5.blacknodes.net/Aztec/', 'https://snapshots-data.aztec.graphops.xyz/'], 'blobFileStoreUrls': ['https://aztec-labs-snapshots.com/testnet/blobs'], 'txCollectionFileStoreUrls': ['https://aztec-labs-snapshots.com/testnet/txs'], 'registryAddress': '0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba', 'feeAssetHandlerAddress': '0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9', 'l1ChainId': 11155111}}

# Public rc3 compatibility snapshot, not fresh network clearance or a deployed board.
# Query-only qualification never allocates a proof queue or worker.
QUALIFICATION = {'service': {'serviceMode':'query-only','proofs':'real','host':'127.0.0.1','port':0,'origins':[],
    'chainId':'11155111','rollupVersion':'3409706519',
    'queryNode':{'url':'http://127.0.0.1:8082/','rollupAddress':'0xed1eb2eb670b42e2fb5a478c076a264b9604089d','maxLagSeconds':120}},
    'adminUrl':'http://127.0.0.1:8882/','adminKeyFile':'/var/lib/rolling-admin/qualification-key','recoveryTimeoutMs':180000}

class Invalid(ValueError):
    pass

def require_linux_qualification(root=None):
    """Candidate bytes are not an execution qualification. Never promote a pin here."""
    root=pathlib.Path(root) if root is not None else pathlib.Path(__file__).resolve().parents[2]
    try:
        pins=json.loads((root/'toolchain.json').read_text())
        expected={'version':BB_VERSION,'sha256':BB_SHA}
        if pins.get('nativeProverPackage')!=BB_VERSION or pins.get('nativeProver',{}).get('linux-x64')!=expected:
            raise ValueError()
    except (OSError,ValueError,TypeError,AttributeError):
        raise Invalid('Active Linux prover qualification required') from None
    return expected

def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise Invalid("Invalid UTC deadline")
    try: return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError: raise Invalid("Invalid UTC deadline") from None

def receipt_url(value):
    if type(value) is not str or len(value)>4096 or any(ord(c)<33 or ord(c)>126 for c in value): raise ValueError('Invalid receipt capability')
    try:
        u=urllib.parse.urlsplit(value)
        if u.scheme!='https' or u.hostname!='anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com' or u.port not in (None,443) or u.username or u.password or u.fragment: raise ValueError()
        if not re.fullmatch(r'/receipts/[a-zA-Z0-9_-]{1,80}/[a-zA-Z0-9_-]{1,80}\.json',u.path): raise ValueError()
        q=urllib.parse.parse_qs(u.query,strict_parsing=True)
        required={'X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Expires','X-Amz-SignedHeaders','X-Amz-Signature'}
        if not required<=set(q) or set(q)-required-{'X-Amz-Security-Token'} or any(len(v)!=1 for v in q.values()): raise ValueError()
        if q['X-Amz-Algorithm']!=['AWS4-HMAC-SHA256'] or q['X-Amz-SignedHeaders']!=['host'] or not re.fullmatch('[a-f0-9]{64}',q['X-Amz-Signature'][0]): raise ValueError()
        if not re.fullmatch('[0-9]{8}T[0-9]{6}Z',q['X-Amz-Date'][0]) or not re.fullmatch('[0-9]{1,6}',q['X-Amz-Expires'][0]) or not 1<=int(q['X-Amz-Expires'][0])<=28800: raise ValueError()
        if not re.fullmatch('[A-Z0-9]{16,128}/[0-9]{8}/eu-west-2/s3/aws4_request',q['X-Amz-Credential'][0]): raise ValueError()
    except Exception: raise ValueError('Invalid receipt capability') from None
    return value

def host_resources(value):
    # Only the existing deployment and explicitly bounded development sizes/rates.
    if type(value) is not dict or set(value)!={'dataVolumeGiB','egressMbps'}:
        raise ValueError('Invalid host resources')
    if type(value['dataVolumeGiB']) is not int or value['dataVolumeGiB'] not in (128,1024) or type(value['egressMbps']) is not int or value['egressMbps'] not in (10,50):
        raise ValueError('Invalid host resources')
    return dict(value)

def validate(config, now=None):
    keys = {"createdAt", "budgetStop", "commissioningStop", "runtimeUrl", "runtimeArchiveSha256", "manifestSha256"}
    if type(config) is not dict or not keys <= set(config) or set(config)-keys-{"receiptPutUrl","queryHost","activationDelivery","hostResources"}: raise Invalid("Invalid bootstrap fields")
    created, stop, commission = (timestamp(config[k]) for k in ("createdAt", "budgetStop", "commissioningStop"))
    now = now or dt.datetime.now(dt.timezone.utc)
    if not now - dt.timedelta(minutes=5) <= created <= now + dt.timedelta(minutes=5): raise Invalid("Stale creation time")
    if not created < stop <= created + dt.timedelta(hours=8): raise Invalid("Invalid budget window")
    if commission != created + dt.timedelta(minutes=30) or commission >= stop: raise Invalid("Invalid commissioning deadline")
    if not isinstance(config["runtimeArchiveSha256"], str) or not re.fullmatch("[a-f0-9]{64}", config["runtimeArchiveSha256"]): raise Invalid("Invalid archive digest")
    if not isinstance(config["manifestSha256"], str) or not re.fullmatch("[a-f0-9]{64}", config["manifestSha256"]): raise Invalid("Invalid manifest digest")
    url = config["runtimeUrl"]
    if not isinstance(url, str) or len(url) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in url): raise Invalid("Invalid package URL")
    try:
        u = urllib.parse.urlsplit(url)
        good = u.scheme == "https" and u.hostname == "anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com" and u.port in (None,443) and not u.username and not u.password and not u.fragment
    except ValueError: good = False
    if not good or not re.fullmatch(r"/releases/[a-zA-Z0-9._/-]+\.tar\.gz", u.path) or ".." in u.path.split("/"):
        raise Invalid("Invalid package URL")
    if "receiptPutUrl" in config:
        try: receipt_url(config["receiptPutUrl"])
        except ValueError: raise Invalid("Invalid receipt capability") from None
    if 'hostResources' in config:
        try: host_resources(config['hostResources'])
        except ValueError: raise Invalid('Invalid host resources') from None
    if 'queryHost' in config: query_host_record(config['queryHost'])
    if 'activationDelivery' in config: activation_delivery_record(config['activationDelivery'],config['budgetStop'])
    return dict(config)

# Executed only on the future Linux host, never while generating or testing.
HOST = r'''
import datetime as dt, fcntl, hashlib, ipaddress, json, os, pathlib, platform, re, shutil, signal, stat, subprocess, sys, tarfile, time, urllib.request, urllib.parse
BASE = pathlib.Path('/var/lib/rolling-bootstrap')
RELEASE = pathlib.Path('/opt/board-prover/releases') / ('rolling-'+PINS['manifest'][:16])
PRIVATE = pathlib.Path('/var/lib/rolling-bootstrap-private')
ADMIN_HASH_FILE = pathlib.Path('/var/lib/rolling-node/data/admin/api_key_hash')
def receipt_url(value):
    if type(value) is not str or len(value)>4096 or any(ord(c)<33 or ord(c)>126 for c in value): raise ValueError('Invalid receipt capability')
    try:
        u=urllib.parse.urlsplit(value)
        if u.scheme!='https' or u.hostname!='anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com' or u.port not in (None,443) or u.username or u.password or u.fragment: raise ValueError()
        if not re.fullmatch(r'/receipts/[a-zA-Z0-9_-]{1,80}/[a-zA-Z0-9_-]{1,80}\.json',u.path): raise ValueError()
        q=urllib.parse.parse_qs(u.query,strict_parsing=True)
        required={'X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Expires','X-Amz-SignedHeaders','X-Amz-Signature'}
        if not required<=set(q) or set(q)-required-{'X-Amz-Security-Token'} or any(len(v)!=1 for v in q.values()): raise ValueError()
        if q['X-Amz-Algorithm']!=['AWS4-HMAC-SHA256'] or q['X-Amz-SignedHeaders']!=['host'] or not re.fullmatch('[a-f0-9]{64}',q['X-Amz-Signature'][0]): raise ValueError()
        if not re.fullmatch('[0-9]{8}T[0-9]{6}Z',q['X-Amz-Date'][0]) or not re.fullmatch('[0-9]{1,6}',q['X-Amz-Expires'][0]) or not 1<=int(q['X-Amz-Expires'][0])<=28800: raise ValueError()
        if not re.fullmatch('[A-Z0-9]{16,128}/[0-9]{8}/eu-west-2/s3/aws4_request',q['X-Amz-Credential'][0]): raise ValueError()
    except Exception: raise ValueError('Invalid receipt capability') from None
    return value

STAGE = 'initial'

DIAGNOSTICS_ACTIVE = False
STEP = 'entry'
STEPS = frozenset(('entry','host-preflight','state-directory','writer-lock','deadline','timer-files','timer-reload','budget-timer','commissioning-timer','mask-prover','inspect-prover','stop-prover','route-read','shaper-files','shaper-start','verify-budget','tc-version','tc-package','tc-classes','tc-class-parse','tc-qdisc','tc-qdisc-parse','monitor-install','runtime-download','runtime-verify','native-checks','node-install','egress-exercise','qualification-install','complete'))

def diagnostic(error=None, status='failed', facts=None):
    # Diagnostic output must never prevent shutdown. No raw exception attributes,
    # command arguments, configuration, or provider responses are serialized.
    try:
        out={'schemaVersion':1,'step':STEP if STEP in STEPS else 'entry','status':status if status in ('started','passed','failed','observed') else 'failed'}
        for key,label in [('manifest','manifestSha256'),('bootstrap','bootstrapSourceSha256'),('node','nodeSha256'),('bb','bbSha256'),('catalog','catalogSha256')]:
            v=PINS.get(key)
            if type(v) is str and re.fullmatch('[a-f0-9]{64}',v):out[label]=v
        category={subprocess.CalledProcessError:'command-exit',subprocess.TimeoutExpired:'command-timeout',FileNotFoundError:'missing-file',PermissionError:'permission',OSError:'io',ValueError:'validation',json.JSONDecodeError:'invalid-json',UnicodeDecodeError:'invalid-encoding'}.get(type(error),'internal')
        if error is not None:
            out['category']=category
            if type(error) is subprocess.CalledProcessError:
                code=vars(error).get('returncode')
                if type(code) is int and -255<=code<=255:out['returnCode']=code
        if type(facts) is dict:
            for key in ('tcVersion','libbpfVersion','packageVersion'):
                value=facts.get(key)
                if type(value) is list and 2<=len(value)<=6 and all(type(x) is int and 0<=x<=999 for x in value):out[key]=value
            for key in ('tcAccepted','packageAccepted'):
                if type(facts.get(key)) is bool:out[key]=facts[key]
            if facts.get('classFormat') in ('class-text','json','empty','other'):out['classFormat']=facts['classFormat']
        data=('ROLLING_BOOTSTRAP_DIAGNOSTIC '+json.dumps(out,separators=(',',':'))+'\n').encode()
        if len(data)>2048:return
        emit_diagnostic(data)
    except Exception:pass

def emit_diagnostic(data):
    # Fixed local character devices only; no create, follow, fsync, blocking retry,
    # permissions, serial getty or bootloader changes. Missing sinks are harmless.
    for device in ('/dev/ttyS0','/dev/console'):
        fd=None
        try:
            fd=os.open(device,os.O_WRONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
            if stat.S_ISCHR(os.fstat(fd).st_mode):os.write(fd,data)
        except Exception:pass
        finally:
            if fd is not None:
                try:os.close(fd)
                except Exception:pass

def mark(step):
    global STEP
    STEP=step if step in STEPS else 'entry'
    if DIAGNOSTICS_ACTIVE:diagnostic(status='started')

def version_facts(text, package=False):
    if type(text) is not str or len(text)>256:return {}
    if package:
        m=re.fullmatch(r'([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})-([0-9]{1,3})ubuntu([0-9]{1,3})(?:\.([0-9]{1,3}))?',text)
        return {'packageVersion':[int(x) for x in m.groups() if x is not None]} if m else {}
    m=re.fullmatch(r'tc utility, iproute2-([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(?:, libbpf ([0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]{1,3})?))?',text)
    if not m:return {}
    result={'tcVersion':[int(x) for x in m[1].split('.')]}
    if m[2]:result['libbpfVersion']=[int(x) for x in m[2].split('.')]
    return result

def shutdown_failure(error):
    diagnostic(error)
    try:write(BASE/'stage','failed')
    except Exception:pass
    try:run(['systemctl','start','rolling-budget.service'],timeout=10)
    except Exception:
        try:run(['/usr/sbin/poweroff'],timeout=10)
        except Exception:pass
    raise SystemExit(1) from None

def run(args, timeout=120, capture=False, cwd=None):
    result = subprocess.run(args, check=True, timeout=timeout, cwd=cwd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin', 'HOME':'/root', 'LANG':'C', 'LC_ALL':'C', 'LOG_LEVEL':'silent'})
    return result.stdout.decode().strip() if capture else None

def write(path, text, mode=0o600):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink(): raise ValueError('Unsafe destination')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'w') as f:
        os.fchmod(f.fileno(), mode); f.write(text); f.flush(); os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def host_resources(value):
    # Only the existing deployment and explicitly bounded development sizes/rates.
    if type(value) is not dict or set(value)!={'dataVolumeGiB','egressMbps'}:
        raise ValueError('Invalid host resources')
    if type(value['dataVolumeGiB']) is not int or value['dataVolumeGiB'] not in (128,1024) or type(value['egressMbps']) is not int or value['egressMbps'] not in (10,50):
        raise ValueError('Invalid host resources')
    return dict(value)

def immutable_deadline(config):
    public = {k:config[k] for k in ('createdAt','budgetStop','commissioningStop','runtimeArchiveSha256','manifestSha256')}
    public['hostResources']=host_resources(config.get('hostResources',{'dataVolumeGiB':1024,'egressMbps':50}))
    record = BASE / 'deadline.json'
    if record.exists():
        if json.loads(record.read_text()) != public: raise ValueError('Deadline changed')
    else: write(record, json.dumps(public))
    if dt.datetime.now(dt.timezone.utc) >= dt.datetime.fromisoformat(config['budgetStop'].replace('Z','+00:00')):
        raise ValueError('Budget expired')

def install_controls(config):
    mark('deadline');immutable_deadline(config)
    resources=host_resources(config.get('hostResources',{'dataVolumeGiB':1024,'egressMbps':50}))
    ceiling=resources['egressMbps'];share=ceiling//2
    mark('timer-files')
    for name, stop in [('budget',config['budgetStop']),('commissioning',config['commissioningStop'])]:
        write('/etc/systemd/system/rolling-'+name+'.service', '[Unit]\nDescription=Rolling bounded shutdown\n[Service]\nType=oneshot\nExecStart=/usr/sbin/poweroff\n', 0o644)
        write('/etc/systemd/system/rolling-'+name+'.timer', '[Unit]\nDescription=Rolling absolute shutdown\n[Timer]\nOnCalendar='+stop.replace('T',' ').replace('Z',' UTC')+'\nPersistent=true\nAccuracySec=1s\nRandomizedDelaySec=0\n[Install]\nWantedBy=timers.target\n', 0o644)
    mark('timer-reload');run(['systemctl','daemon-reload'])
    for name in ('budget','commissioning'):
        mark(name+'-timer');run(['systemctl','enable','--now','rolling-'+name+'.timer'])
        run(['systemctl','is-active','--quiet','rolling-'+name+'.timer'])
    # No proof server can start accidentally during bootstrap or a reboot.
    mark('mask-prover');run(['systemctl','mask','board-prover.service','board-prover-proxy.service'])
    for service in ('board-prover.service','board-prover-proxy.service'):
        mark('inspect-prover')
        try: run(['systemctl','is-active','--quiet',service])
        except subprocess.CalledProcessError as error:
            if error.returncode not in (3,4): raise
        else: mark('stop-prover');run(['systemctl','stop',service])
    # One physical interface: forwarded Docker traffic also traverses this root qdisc.
    mark('route-read')
    routes = json.loads(run(['ip','-j','route','show','default'], capture=True))
    devices = {r['dev'] for r in routes if 'dev' in r}
    if len(devices) != 1: raise ValueError('Expected single egress interface')
    dev = devices.pop()
    if not dev or not all(c.isalnum() or c in '_-.' for c in dev): raise ValueError('Invalid interface')
    # Root ceiling is mandatory even if class classification changes. All IP families covered.
    mark('shaper-files');write(BASE/'interface', dev)
    shaper = '#!/bin/sh\nset -eu\nDEV='+dev+'\n'
    shaper += 'tc qdisc replace dev "$DEV" root handle 1: htb default 10\n'
    shaper += 'tc class replace dev "$DEV" parent 1: classid 1:1 htb rate '+str(ceiling)+'mbit ceil '+str(ceiling)+'mbit burst 1mb cburst 1mb\n'
    shaper += 'tc class replace dev "$DEV" parent 1:1 classid 1:10 htb rate '+str(share)+'mbit ceil '+str(ceiling)+'mbit\n'
    shaper += 'tc class replace dev "$DEV" parent 1:1 classid 1:20 htb rate '+str(share)+'mbit ceil '+str(ceiling)+'mbit\n'
    # The installed prover is disabled. Future enablement must classify its UID as mark20.
    shaper += 'tc filter replace dev "$DEV" parent 1: protocol all prio 1 handle 20 fw classid 1:20\n'
    write('/usr/local/sbin/rolling-egress', shaper, 0o700)
    write('/etc/systemd/system/rolling-egress.service', '[Unit]\nDescription=Whole host egress ceiling\nAfter=network-online.target\nWants=network-online.target\nBefore=docker.service rolling-node.service\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/rolling-egress\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n', 0o644)
    mark('shaper-start');run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','rolling-egress.service'])
    verify_controls()

def class_bytes(text, egress_mbps=50):
    # Noble iproute2 6.1.0 has no class JSON support. These are its C-locale
    # tc_class.c/q_htb.c/tc_util.c outputs, not the newer upstream JSON schema.
    if type(egress_mbps) is not int or egress_mbps not in (10,50): raise ValueError('Invalid egress ceiling')
    if type(text) is not str or len(text) > 16384: raise ValueError('Invalid class output')
    records = {}
    current = None
    for line in text.splitlines():
        if not line.strip(): continue
        if line.startswith('class '):
            header = re.fullmatch(r'class htb (1:(?:1|10|20)) (root|parent 1:1) (?:leaf [0-9a-f]+: )?(?:prio 0 )?rate ([0-9]{1,3})Mbit ceil ([0-9]{1,3})Mbit burst [0-9]+(?:[KM])?b cburst [0-9]+(?:[KM])?b *', line)
            if not header: raise ValueError('Unexpected class topology or ceiling')
            handle, parent, rate, ceiling = header.groups()
            if handle in records or parent != ('root' if handle == '1:1' else 'parent 1:1') or rate != str(egress_mbps if handle == '1:1' else egress_mbps//2) or ceiling != str(egress_mbps):
                raise ValueError('Unexpected class topology or ceiling')
            records[handle] = None; current = handle
        elif line.lstrip().startswith('Sent '):
            stats = re.fullmatch(r' Sent ([0-9]{1,20}) bytes [0-9]+ pkt \(dropped [0-9]+, overlimits [0-9]+ requeues [0-9]+\) *', line)
            if current is None or records[current] is not None or not stats or int(stats[1]) > 2**64-1: raise ValueError('Missing class byte accounting')
            records[current] = int(stats[1])
        elif not re.fullmatch(r' (?:backlog [0-9]+(?:[KM])?b [0-9]+p requeues [0-9]+|lended: [0-9]+ borrowed: [0-9]+ giants: [0-9]+|tokens: -?[0-9]+ ctokens: -?[0-9]+) *', line) or current is None:
            raise ValueError('Unexpected class statistics')
    if set(records) != {'1:1','1:10','1:20'} or any(v is None for v in records.values()): raise ValueError('Missing class byte accounting')
    return records['1:1']

def verify_controls():
    mark('verify-budget');run(['systemctl','is-active','--quiet','rolling-budget.timer'])
    config = json.loads((BASE/'deadline.json').read_text())
    resources=host_resources(config['hostResources'])
    if dt.datetime.now(dt.timezone.utc) >= dt.datetime.fromisoformat(config['budgetStop'].replace('Z','+00:00')): raise ValueError('Expired')
    dev = (BASE/'interface').read_text()
    mark('tc-version');tc=run(['tc','-V'],capture=True)
    accepted=bool(re.fullmatch(r'tc utility, iproute2-6\.1\.0(?:, libbpf [0-9]+\.[0-9]+\.[0-9]+)?',tc))
    if DIAGNOSTICS_ACTIVE or not accepted:diagnostic(status='observed',facts={**version_facts(tc),'tcAccepted':accepted})
    if not accepted:raise ValueError('Unreviewed tc version')
    mark('tc-package');package=run(['dpkg-query','-W','-f=${Version}','iproute2'],capture=True)
    accepted=package in ('6.1.0-1ubuntu6','6.1.0-1ubuntu6.4')
    if DIAGNOSTICS_ACTIVE or not accepted:diagnostic(status='observed',facts={**version_facts(package,True),'packageAccepted':accepted})
    if not accepted:raise ValueError('Unreviewed iproute2 package')
    mark('tc-classes');classes=run(['tc','-s','class','show','dev',dev],capture=True)
    mark('tc-class-parse')
    if DIAGNOSTICS_ACTIVE:diagnostic(status='observed',facts={'classFormat':'class-text' if classes.startswith('class ') else 'json' if classes.startswith('[') else 'empty' if not classes else 'other'})
    byte_count=class_bytes(classes,resources['egressMbps'])
    mark('tc-qdisc');qdisc_raw=run(['tc','-j','qdisc','show','dev',dev],capture=True)
    mark('tc-qdisc-parse');qdisc=json.loads(qdisc_raw)
    roots = [q for q in qdisc if q.get('root') is True]
    if len(roots)!=1 or roots[0].get('kind')!='htb' or roots[0].get('handle')!='1:' or roots[0].get('options',{}).get('default')!='0x10':
        raise ValueError('Wrong root qdisc')
    return byte_count

def fetch_package(url, path):
    # urllib refuses redirects: no capability may escape to a different destination.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): raise ValueError('Redirect rejected')
    opener = urllib.request.build_opener(NoRedirect)
    total = 0
    with opener.open(url, timeout=60) as response, open(path,'xb') as out:
        if response.status != 200: raise ValueError('Download status')
        while True:
            chunk = response.read(1024*1024)
            if not chunk: break
            total += len(chunk)
            if total > 4*1024**3: raise ValueError('Archive too large')
            out.write(chunk)
        out.flush();os.fsync(out.fileno())

def extract_verified(archive, target, expected):
    if digest(archive) != expected: raise ValueError('Archive hash mismatch')
    target.mkdir(parents=True,exist_ok=False)
    with tarfile.open(archive,'r:gz') as tar:
        members = tar.getmembers()
        if len(members)>200000 or sum(m.size for m in members)>20*1024**3: raise ValueError('Archive limit')
        # Python3.12 data filter rejects external links, device files and traversal.
        tar.extractall(target, filter='data')
    verify_release(target)

def verify_release(target):
    if digest(target/'prover-release.json') != PINS['manifest']: raise ValueError('Manifest mismatch')
    m = json.loads((target/'prover-release.json').read_text())
    if m['platform']!='linux-x64' or m['applicationProfile']!='rolling': raise ValueError('Wrong release')
    actual = set()
    for p in target.rglob('*'):
        if not p.resolve().is_relative_to(target.resolve()): raise ValueError('External package link')
        if p.is_file() and str(p.relative_to(target))!='prover-release.json': actual.add(str(p.relative_to(target)))
    if actual != set(m['files']): raise ValueError('Manifest file set mismatch')
    for rel, expected in m['files'].items():
        p = target/rel
        if not p.resolve().is_relative_to(target.resolve()) or digest(p)!=expected: raise ValueError('Release file mismatch')
    pins=json.loads((target/'toolchain.json').read_text())
    if pins.get('nativeProverPackage')!=PINS['bbVersion'] or pins.get('nativeProver',{}).get('linux-x64')!={'version':PINS['bbVersion'],'sha256':PINS['bb']}: raise ValueError('Unqualified Linux prover')
    for rel, key in [('node/bin/node','node'),('node_modules/@aztec-foundation/bb.js/build/amd64-linux/bb','bb'),('prover/rolling-artifacts.json','catalog')]:
        if digest(target/rel)!=PINS[key]: raise ValueError('Native or catalog mismatch')

def prepare_data():
    # A fresh dedicated secondary EBS disk only; never guess among existing data disks.
    resources=host_resources(json.loads((BASE/'deadline.json').read_text())['hostResources'])
    expected_bytes=resources['dataVolumeGiB']*1024**3
    disks=json.loads(run(['lsblk','-b','-J','-o','PATH,TYPE,SIZE,FSTYPE,MOUNTPOINTS,UUID'],capture=True))['blockdevices']
    candidates=[d for d in disks if d['type']=='disk' and int(d['size'])==expected_bytes]
    if len(candidates)!=1: raise ValueError('Expected dedicated configured-size disk')
    d=candidates[0];device=d['path'];mount='/var/lib/rolling-node'
    if d.get('children'): raise ValueError('Partitioned data disk rejected')
    mounts=[x for x in d.get('mountpoints',[]) if x]
    if mounts and mounts!=[mount]: raise ValueError('Data disk already mounted elsewhere')
    marker=BASE/'volume.json'
    if marker.exists():
        record=json.loads(marker.read_text())
        if d.get('uuid')!=record['uuid'] or d.get('fstype')!='ext4': raise ValueError('Data disk changed')
    else:
        if d.get('fstype') or mounts: raise ValueError('Existing filesystem rejected')
        run(['mkfs.ext4','-q',device],timeout=120)
        uuid=run(['blkid','-s','UUID','-o','value',device],capture=True)
        if not uuid or not all(c.isalnum() or c=='-' for c in uuid): raise ValueError('Invalid volume identity')
        record={'uuid':uuid};write(marker,json.dumps(record))
    pathlib.Path(mount).mkdir(parents=True,exist_ok=True)
    line='UUID='+record['uuid']+' '+mount+' ext4 defaults,nosuid,nodev 0 2\n'
    fstab=pathlib.Path('/etc/fstab').read_text()
    if line not in fstab: write('/etc/fstab',fstab+'\n'+line,0o644)
    if not mounts: run(['mount',mount])
    pathlib.Path(mount+'/data').mkdir(exist_ok=True)

def public_ip():
    req=urllib.request.Request('http://169.254.169.254/latest/api/token',method='PUT',headers={'X-aws-ec2-metadata-token-ttl-seconds':'60'})
    with urllib.request.urlopen(req,timeout=5) as r: token=r.read(4096).decode()
    req=urllib.request.Request('http://169.254.169.254/latest/meta-data/public-ipv4',headers={'X-aws-ec2-metadata-token':token})
    with urllib.request.urlopen(req,timeout=5) as r: value=r.read(64).decode().strip()
    address=ipaddress.IPv4Address(value)
    if not address.is_global: raise ValueError('Expected public IPv4')
    return str(address)

def prepare_admin_key():
    # Trusted installer only. Never rotate an existing capability or node hash.
    keyfile=pathlib.Path(QUALIFICATION['adminKeyFile']);directory=keyfile.parent
    directory.mkdir(mode=0o700,exist_ok=True)
    info=directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o700 or info.st_uid!=os.getuid(): raise ValueError('Unsafe admin capability')
    prior=ADMIN_HASH_FILE
    if not keyfile.exists() and (prior.exists() or prior.is_symlink()): raise ValueError('Existing admin authority needs retained capability')
    try:
        fd=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError: pass
    else:
        with os.fdopen(fd,'w') as f:
            f.write(os.urandom(32).hex());f.flush();os.fsync(f.fileno())
        fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    fd=os.open(keyfile,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd) as f:
        info=os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.getuid() or info.st_size!=64: raise ValueError('Unsafe admin capability')
        key=f.read(65)
    if not re.fullmatch('[a-f0-9]{64}',key): raise ValueError('Unsafe admin capability')
    value=hashlib.sha256(key.encode()).hexdigest()
    if (prior.exists() or prior.is_symlink()) and (prior.is_symlink() or not prior.is_file() or prior.stat().st_size>65 or prior.read_text().strip()!=value): raise ValueError('Existing admin authority mismatch')
    return value

def install_node():
    prepare_data()
    write('/etc/rolling-node/network.json',json.dumps(NETWORK),0o644)
    if not shutil.which('docker'):
        run(['apt-get','update'],timeout=180)
        run(['apt-get','install','-y','docker.io'],timeout=300)
    # Docker cannot start on reboot without its shaping prerequisite.
    write('/etc/systemd/system/docker.service.d/rolling.conf','[Unit]\nRequires=rolling-egress.service\nAfter=rolling-egress.service\n',0o644)
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','docker'])
    verify_controls()
    run(['docker','pull','--platform','linux/amd64',PINS['image']],timeout=600)
    ip=public_ip();admin_hash=prepare_admin_key()
    args=['/usr/bin/docker','run','--log-driver','none','--name','rolling-node','--platform','linux/amd64','--memory','24g','--memory-swap','24g','--pids-limit','512','--cap-drop','ALL','--security-opt','no-new-privileges',
          '-p','127.0.0.1:8082:8080','-p','127.0.0.1:8882:8880','-p','40400:40400/tcp','-p','40400:40400/udp',
          '-v','/var/lib/rolling-node/data:/var/lib/data','-v','/etc/rolling-node/network.json:/etc/aztec/network.json:ro',
          '-e','DATA_DIRECTORY=/var/lib/data','-e','NETWORK_CONFIG_LOCATION=/etc/aztec/network.json',
          '-e','ETHEREUM_HOSTS=https://sepolia.gateway.tenderly.co','-e','ETHEREUM_DEBUG_HOSTS=https://ethereum-sepolia-rpc.publicnode.com',
          '-e','L1_CONSENSUS_HOST_URLS=https://ethereum-sepolia-beacon-api.publicnode.com','-e','ETHEREUM_ALLOW_NO_DEBUG_HOSTS=false','-e','BLOB_ALLOW_EMPTY_SOURCES=false',
          '-e','PROVER_REAL_PROOFS=true','-e','SYNC_MODE=snapshot','-e','P2P_IP='+ip,'-e','P2P_PORT=40400','-e','AZTEC_PORT=8080','-e','AZTEC_ADMIN_PORT=8880','-e','AZTEC_ADMIN_API_KEY_HASH='+admin_hash,
          '--entrypoint','node',PINS['image'],'--no-warnings','/usr/src/yarn-project/aztec/dest/bin/index.js','start','--node','--network','testnet']
    # All arguments above are fixed or strict IPv4/digest; no shell is involved.
    unit='[Unit]\nDescription=Bounded private query fullnode\nRequires=docker.service rolling-egress.service\nAfter=docker.service rolling-egress.service\nRequiresMountsFor=/var/lib/rolling-node\n[Service]\nExecStartPre=/usr/bin/python3 /usr/local/lib/rolling-attest.py --check\nExecStart=/usr/bin/python3 '+str(RELEASE/'deploy/prover/bootstrap.py')+' --node-wrapper '+ ' '.join(args)+'\nExecStop=/usr/bin/docker stop -t 30 rolling-node\nRestart=no\nTimeoutStartSec=0\nTimeoutStopSec=45\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n'
    write('/etc/systemd/system/rolling-node.service',unit,0o644)
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','rolling-node'])

def exclusive_record(path, value):
    # An acknowledged intent survives reboot. Even an incomplete file forbids replay.
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(json.dumps(value,separators=(',',':')));f.flush();os.fsync(f.fileno())
    fd=os.open(pathlib.Path(path).parent,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def read_bounded_json(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size>16384: raise ValueError('Invalid bounded record')
        with os.fdopen(fd,'rb',closefd=False) as f:
            data=f.read(16385)
        if len(data)>16384: raise ValueError('Invalid bounded record')
        value=json.loads(data)
        if type(value) is not dict: raise ValueError('Invalid bounded record')
        return value
    finally: os.close(fd)

def readiness_observation(value):
    if type(value) is not dict or type(value.get('attempts')) is not int or not 1<=value['attempts']<=10000: raise ValueError('Invalid readiness observation')
    if value.get('ready') is True and set(value)=={'attempts','ready','snapshot'}:
        return {'attempts':value['attempts'],'ready':True,'snapshot':readiness_projection(value['snapshot'])}
    if value.get('ready') is False and set(value)=={'attempts','ready','category'} and value.get('category') in ('CONFIG','IDENTITY','UNAVAILABLE','UNSYNCED','STALE','TIMEOUT','PROCESS_EXIT'):
        return {'attempts':value['attempts'],'ready':False,'category':value['category']}
    raise ValueError('Invalid readiness observation')

def startup_observation():
    try:
        helper=RELEASE/'deploy/prover/bootstrap.py'
        if digest(helper)!=PINS['startup']:raise ValueError()
        return json.loads(run(['/usr/bin/python3',str(helper),'--startup-observation'],timeout=3,capture=True))
    except Exception:return {'available':False}

def service_observations():
    # Only explicit State properties. Never inspect container config, Error,
    # command lines, environment, journal/log output, or exception messages.
    result={}
    enums={'LoadState':('loaded','not-found','error','masked'),
        'ActiveState':('active','inactive','failed','activating','deactivating','reloading'),
        'SubState':('running','exited','dead','failed','start','start-pre','start-post','stop','stop-sigterm','stop-sigkill','stop-post','auto-restart'),
        'Result':('success','exit-code','signal','core-dump','timeout','watchdog','oom-kill','resources','start-limit-hit','protocol')}
    numeric=('ExecMainCode','ExecMainStatus','NRestarts')
    for role,unit in [('node','rolling-node.service'),('qualification','rolling-qualification.service')]:
        try:
            raw=run(['systemctl','show',unit,'--property='+','.join((*enums,*numeric))],timeout=3,capture=True)
            if len(raw)>4096: raise ValueError()
            lines=raw.splitlines();values=dict(line.split('=',1) for line in lines)
            if len(lines)!=len(values) or set(values)!=set(enums)|set(numeric): raise ValueError()
            if any(values[k] not in allowed for k,allowed in enums.items()): raise ValueError()
            if any(not re.fullmatch('[0-9]{1,10}',values[k]) or int(values[k])>2**32-1 for k in numeric): raise ValueError()
            result[role]={'available':True,**{k:values[k] for k in enums},**{k:int(values[k]) for k in numeric}}
        except Exception: result[role]={'available':False}
    try:
        fmt='{"status":{{json .State.Status}},"running":{{json .State.Running}},"restarting":{{json .State.Restarting}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}}}'
        raw=run(['/usr/bin/docker','inspect','--format',fmt,'rolling-node'],timeout=3,capture=True)
        if len(raw)>1024: raise ValueError()
        v=json.loads(raw)
        if set(v)!={'status','running','restarting','oomKilled','exitCode'} or v['status'] not in ('created','running','paused','restarting','removing','exited','dead'): raise ValueError()
        if any(type(v[k]) is not bool for k in ('running','restarting','oomKilled')) or type(v['exitCode']) is not int or not 0<=v['exitCode']<=255: raise ValueError()
        result['container']={'available':True,**v}
    except Exception: result['container']={'available':False}
    return result

def upload_receipt(data):
    # Intent is outside the qualifier-writable tree. Once present, even an
    # absent/unknown outcome forbids a second request. No SDK retry machinery.
    if not (PRIVATE/'receipt-put.json').exists(): return
    intent=PRIVATE/'upload-intent.json'
    if intent.exists(): return
    capability=read_bounded_json(PRIVATE/'receipt-put.json')
    if set(capability)!={'url'}: raise ValueError('Invalid receipt capability')
    url=receipt_url(capability['url'])
    if type(data) is not bytes or len(data)>16384: raise ValueError('Receipt limit')
    exclusive_record(intent,{'schemaVersion':1,'receiptSha256':hashlib.sha256(data).hexdigest(),'attempts':1})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): raise ValueError('Redirect rejected')
    outcome={'schemaVersion':1,'receiptSha256':hashlib.sha256(data).hexdigest(),'status':'unknown'}
    try:
        # No ambient proxy/credentials/cookies and no redirect. Ignore the
        # response body entirely; even a hostile response cannot fill memory.
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        request=urllib.request.Request(url,data=data,method='PUT',headers={'Content-Type':'application/json'})
        with opener.open(request,timeout=5) as response:
            if response.status in (200,204): outcome['status']='acknowledged'
            else: outcome['status']='rejected'
    except Exception: pass
    exclusive_record(PRIVATE/'upload-result.json',outcome)

def final_receipt():
    # Runs in a separate trusted root unit, never inside the qualifier's
    # loopback-only cgroup. Public receipt survives a lost/unknown upload.
    passed=False
    try:
        PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
        with open(PRIVATE/'receipt-lock','a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            path=PRIVATE/'final-receipt.json'
            if path.exists():
                # Previously sealed bytes are immutable, not a new attempt.
                receipt=read_bounded_json(path)
                q=validated_qualification(receipt.get('qualification',{}))
                passed=q.get('passed') is True and q.get('stage')=='complete' and bool(q.get('checks')) and all(q['checks'].values()) and 'readiness' in q and 'anchors' in q
                return
            else:
                try: q=validated_qualification(read_bounded_json(BASE/'qualification/result.json'))
                except Exception: q=qualification_failure('interrupted-unknown')
                try: observation=readiness_observation(read_bounded_json(BASE/'qualification/readiness-observation.json'))
                except Exception: observation={'available':False}
                receipt={'schemaVersion':1,'manifestSha256':PINS['manifest'],'qualification':q,
                         'readinessObservation':observation,'services':service_observations(),'startup':startup_observation()}
                if type(PINS.get('bootstrap')) is str and re.fullmatch('[a-f0-9]{64}',PINS['bootstrap']): receipt['bootstrapSourceSha256']=PINS['bootstrap']
                exclusive_record(path,receipt)
            data=json.dumps(receipt,separators=(',',':')).encode()
            if len(data)>16384: raise ValueError('Receipt limit')
            q=receipt['qualification']
            passed=q.get('passed') is True and q.get('stage')=='complete' and bool(q.get('checks')) and all(q['checks'].values()) and 'readiness' in q and 'anchors' in q
            emit_diagnostic(b'ROLLING_QUALIFICATION_RECEIPT '+data+b'\n')
            upload_receipt(data)
    except Exception:
        # Disk/transport setup failure must still leave a bounded console attempt.
        # This diagnostic is explicitly not a durable qualification receipt.
        emit_diagnostic(b'ROLLING_QUALIFICATION_RECEIPT_ERROR {"schemaVersion":1,"category":"FINALIZATION_FAILED"}\n')
        raise
    finally:
        if not passed: run(['systemctl','start','--no-block','rolling-budget.service'],timeout=5)

def qualification_projection(report, process_exited=False):
    return activation_support('qualification-projection',(report,process_exited))

def qualification_anchors(checks):
    return activation_support('qualification-anchors',checks)

def readiness_projection(value):
    scope=QUALIFICATION['service']
    exact={'ready':True,'chainId':scope['chainId'],'rollupVersion':scope['rollupVersion'],
           'rollupAddress':scope['queryNode']['rollupAddress'],'proofsEnabled':True}
    if any(value.get(k)!=v or type(value.get(k)) is not type(v) for k,v in exact.items()): raise ValueError('Readiness identity')
    for name in ('latestBlockNumber','checkpointedBlockNumber','finalizedBlockNumber','oldestHistoricBlockNumber','checkedAtSeconds','lagSeconds'):
        number=value.get(name)
        if type(number) is not int or not 0<=number<=2**53-1: raise ValueError('Readiness number')
        exact[name]=number
    if exact['lagSeconds']>120 or not exact['oldestHistoricBlockNumber']<=exact['checkpointedBlockNumber']<=exact['latestBlockNumber'] or exact['finalizedBlockNumber']>exact['checkpointedBlockNumber']: raise ValueError('Readiness ordering')
    for name,pattern in [('latestBlockHash','0x[a-f0-9]{64}'),('syncedL1Timestamp','[0-9]{1,16}')]:
        if type(value.get(name)) is not str or not re.fullmatch(pattern,value[name]): raise ValueError('Readiness anchor')
        exact[name]=value[name]
    if exact['checkedAtSeconds']-int(exact['syncedL1Timestamp'])!=exact['lagSeconds']: raise ValueError('Readiness timestamp')
    return exact

def qualification_failure(stage):
    return {'schemaVersion':1,'passed':False,'stage':stage,'scope':'current-network-query-only','manifestSha256':PINS['manifest']}

def qualify(aborted=False):
    directory=BASE/'qualification';directory.mkdir(mode=0o700,exist_ok=True)
    result_path=directory/'result.json';intent=directory/'intent.json'
    with open(directory/'lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if result_path.exists(): return
        if aborted or intent.exists():
            exclusive_record(result_path,qualification_failure('interrupted-unknown'));return
        deadline_record=json.loads((BASE/'deadline.json').read_text())
        epoch=lambda key:dt.datetime.fromisoformat(deadline_record[key].replace('Z','+00:00')).timestamp()
        deadline=min(epoch('budgetStop')-60,epoch('createdAt')+105*60)
        exclusive_record(intent,{'schemaVersion':1,'manifestSha256':PINS['manifest'],'deadline':int(deadline),'attempts':1})
        stage='readiness';result=qualification_failure(stage)
        try:
            verify_release(RELEASE);verify_controls()
            if not (RELEASE/'prover/qualify-runtime.mjs').is_file(): raise ValueError('Qualifier absent')
            config=directory/'config.json';exclusive_record(config,QUALIFICATION)
            scope=QUALIFICATION['service']
            options={'url':scope['queryNode']['url'],'expectedNetworkScope':{'chainId':scope['chainId'],'version':scope['rollupVersion'],'rollup':scope['queryNode']['rollupAddress']},'proofsEnabled':True,'allowLocalDev':True,'maxLagSeconds':120}
            readiness="import {createAztecNodeClient} from '@aztec-labs/stdlib/interfaces/client';import {jsonStringify} from '@aztec-labs/foundation/json-rpc';import {inspectTrustedNode} from '"+(RELEASE/'shared/trusted-private-node.mjs').as_uri()+"';try {const opts="+json.dumps(options)+";const node=createAztecNodeClient(opts.url,{maxBatchSize:1,fetch:async(host,body)=>{const r=await fetch(host,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();let n=0;const c=[];for await(const b of r.body){n+=b.length;if(n>33554432)throw Error();c.push(b);}return {response:JSON.parse(Buffer.concat(c).toString('utf8')),headers:r.headers};}});process.stdout.write(JSON.stringify(await inspectTrustedNode(node,opts)));} catch(e) {const codes=['CONFIG','IDENTITY','UNAVAILABLE','UNSYNCED','STALE'];const category=codes.find(x=>e?.code==='BB_TRUSTED_NODE_'+x)||'UNAVAILABLE';process.stdout.write(JSON.stringify({ready:false,category}));}"
            attempts=0;ready=False;poll_deadline=min(deadline-900,epoch('createdAt')+90*60)
            while time.time()<poll_deadline:
                verify_controls();attempts+=1
                try:
                    raw=run([str(RELEASE/'node/bin/node'),'--input-type=module','--eval',readiness],timeout=min(60,max(1,poll_deadline-time.time())),capture=True,cwd=RELEASE)
                    if len(raw)>16384: raise ValueError('Readiness output limit')
                    observed=json.loads(raw)
                    if observed.get('ready') is False:
                        observation=readiness_observation({'attempts':attempts,**observed})
                        write(directory/'readiness-observation.json',json.dumps(observation))
                    else:
                        snapshot=readiness_projection(observed)
                        write(directory/'readiness-observation.json',json.dumps({'attempts':attempts,'ready':True,'snapshot':snapshot}))
                        ready=True;break
                except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
                    write(directory/'readiness-observation.json',json.dumps({'attempts':attempts,'ready':False,'category':'TIMEOUT' if type(error) is subprocess.TimeoutExpired else 'PROCESS_EXIT'}))
                time.sleep(min(15,max(0,poll_deadline-time.time())))
            if not ready: raise ValueError('Readiness deadline')
            exclusive_record(directory/'ready.json',snapshot)
            stage='qualifier';verify_controls()
            output=directory/'report.json'
            # Exactly one attempt. The qualifier's nonzero result can still contain
            # useful fixed checks; timeout is unknown and never resumes or repeats it.
            process_exited=False
            try:
                run([str(RELEASE/'node/bin/node'),str(RELEASE/'prover/qualify-runtime.mjs'),str(config),PINS['manifest'],str(output)],timeout=min(900,max(1,deadline-time.time())))
                process_exited=True
            except subprocess.CalledProcessError: pass
            if output.is_symlink() or not output.is_file() or output.stat().st_size>16384: raise ValueError('Missing bounded result')
            report=json.loads(output.read_text());checks=qualification_projection(report,process_exited)
            result={'schemaVersion':1,'passed':all(checks.values()),'stage':'complete' if all(checks.values()) else 'qualification-failed',
                    'scope':'current-network-query-only','manifestSha256':PINS['manifest'],'reportSha256':digest(output),'checks':checks,'readiness':snapshot}
            if checks['healthy'] and checks['recovered']: result['anchors']=qualification_anchors(report['checks'])
            # Preserve the actual bounded report durably before acknowledging result.
            with open(output,'rb') as f: os.fsync(f.fileno())
        except Exception: result=qualification_failure(stage+'-failed')
        exclusive_record(result_path,result)

def install_qualification():
    unit='[Unit]\nDescription=One bounded Linux query qualification\nRequires=rolling-node.service rolling-egress.service\nAfter=rolling-node.service rolling-egress.service\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /usr/local/lib/rolling-attest.py --qualify\nExecStopPost=/usr/bin/python3 /usr/local/lib/rolling-attest.py --qualification-stop\nTimeoutStartSec=6300\nTimeoutStopSec=45\nKillMode=control-group\nRestart=no\nUMask=0077\nEnvironment=LOG_LEVEL=silent\nUnsetEnvironment=NODE_PATH NODE_OPTIONS BB\nPrivateTmp=yes\nPrivateDevices=yes\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/var/lib/rolling-bootstrap\nReadOnlyPaths=/var/lib/rolling-admin/qualification-key\nInaccessiblePaths=-/var/lib/rolling-bootstrap-private -/var/lib/cloud\nIPAddressDeny=any\nIPAddressAllow=localhost\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n'
    write('/etc/systemd/system/rolling-qualification.service',unit,0o644)
    write('/etc/systemd/system/rolling-qualification-receipt.service','[Unit]\nDescription=Trusted bounded final receipt publisher\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /usr/local/lib/rolling-attest.py --qualification-receipt\nTimeoutStartSec=35\nTimeoutStopSec=3\nRestart=no\nUMask=0077\nStandardOutput=null\nStandardError=null\n',0o644)
    run(['systemctl','daemon-reload']);run(['systemctl','enable','rolling-qualification.service'])
    run(['systemctl','start','--no-block','rolling-qualification.service'])

def validated_qualification(q):
    allowed={'schemaVersion','passed','stage','scope','manifestSha256','reportSha256','checks','readiness','anchors'}
    if type(q.get('schemaVersion')) is not int or q['schemaVersion']!=1 or type(q.get('passed')) is not bool or set(q)-allowed or q.get('manifestSha256')!=PINS['manifest'] or q.get('scope')!='current-network-query-only': raise ValueError('Bad result')
    if q.get('stage') not in ('complete','qualification-failed','readiness-failed','qualifier-failed','interrupted-unknown'): raise ValueError('Bad stage')
    if 'checks' in q and (set(q['checks'])!=set(qualification_projection({})) or any(type(v) is not bool for v in q['checks'].values())): raise ValueError('Bad checks')
    if 'reportSha256' in q and not re.fullmatch('[a-f0-9]{64}',q['reportSha256']): raise ValueError('Bad hash')
    if 'readiness' in q: q['readiness']=readiness_projection(q['readiness'])
    if 'anchors' in q: q['anchors']=qualification_anchors(q['anchors'])
    return q

def attest(check=False):
    good=False;count=0
    try: count=verify_controls();good=True
    except Exception: pass
    if check:
        if not good or digest(RELEASE/'deploy/prover/bootstrap.py')!=PINS['startup']: raise ValueError('Control verification failed')
        return
    record=json.loads((BASE/'deadline.json').read_text())
    status=(BASE/'stage').read_text() if (BASE/'stage').exists() else 'initial'
    if status not in ('controls','package','node','installed','failed'): status='initial'
    output={'schemaVersion':1,'stage':status,'controlsVerified':good,'budgetStop':record['budgetStop'],
            'egressBytes':count if type(count)==int and count>=0 else 0,
            'runtimeArchiveSha256':record['runtimeArchiveSha256'],'manifestSha256':record['manifestSha256'],
            'proverPolicy':'masked-pending-qualification','linuxQueryQualified':False}
    if (PRIVATE/'prover-activation-intent.json').exists():
        try: output.update(activation_support('observe'))
        except Exception: good=False;output['controlsVerified']=False;output['proverPolicy']='activation-unverified'
    else:
        try:
            for service in ('board-prover.service','board-prover-proxy.service'):
                if run(['systemctl','show',service,'--property=LoadState','--value'],capture=True,timeout=5)!='masked': raise ValueError('Unexpected prover state')
        except Exception: good=False;output['controlsVerified']=False;output['proverPolicy']='activation-unverified'
    exercise=BASE/'egress-exercise.json'
    if exercise.exists():
        e=json.loads(exercise.read_text())
        if set(e)=={'beforeBytes','afterBytes','deltaBytes','exercise'} and e['exercise']=='installation-egress-not-throughput' and all(type(e[k]) is int and 0<=e[k]<2**64 for k in ('beforeBytes','afterBytes','deltaBytes')) and e['afterBytes']-e['beforeBytes']==e['deltaBytes'] and e['deltaBytes']>0:
            output['egressExercise']=e
    result_path=BASE/'qualification/result.json'
    if result_path.exists():
        try:
            q=validated_qualification(read_bounded_json(result_path))
            output['qualification']=q
            output['linuxQueryQualified']=q.get('passed') is True and q.get('stage')=='complete' and bool(q.get('checks')) and all(q['checks'].values()) and 'readiness' in q and 'anchors' in q
        except Exception: output['qualification']=qualification_failure('interrupted-unknown')
    if (PINS.get('queryHost') and status=='installed') or any((PRIVATE/('query-host-'+n+'.json')).exists() for n in ('request','intent','result')):
        try: output.update(activation_support('query-observe'))
        except Exception: good=False;output['controlsVerified']=False;output['queryHostPolicy']='unverified'
    if (PINS.get('activationDelivery') and status=='installed') or any(PRIVATE.glob('activation-delivery-*.json')):
        try: output.update(activation_support('delivery'))
        except Exception: good=False;output['activationDelivery']='failed-reconcile-only'
    minute=str(int(dt.datetime.now(dt.timezone.utc).timestamp())//60)
    last=BASE/'last-attestation'
    marker=minute+':'+status+':'+str(good)+':'+str(output.get('qualification',{}).get('stage','pending'))
    try:
        if not last.exists() or last.read_text()!=marker:
            with open('/dev/console','w') as f: f.write('ROLLING_BOOTSTRAP '+json.dumps(output,separators=(',',':'))+'\n')
            write(last,marker)
    finally:
        if not good:
            try: run(['systemctl','stop','rolling-query.service','rolling-node.service','board-prover.service','board-prover-proxy.service'])
            finally: run(['systemctl','start','rolling-budget.service'])

def activation_support(operation, expected=None):
    # Only the immutable packaged source may interpret root-owned activation data.
    source=RELEASE/'deploy/prover/bootstrap.py'
    if digest(source)!=PINS['startup']: raise ValueError('Activation source changed')
    namespace={'__name__':'rolling_activation','__file__':str(source)}
    exec(compile(source.read_bytes(),str(source),'exec'),namespace)
    return namespace['prover_activation'](globals(),operation,expected)

def install_attestation(source):
    write('/usr/local/lib/rolling-attest.py',source,0o700)
    write('/etc/systemd/system/rolling-attest.service','[Unit]\nDescription=Bounded public bootstrap attestation\nOnFailure=rolling-budget.service\n[Service]\nType=oneshot\nTimeoutStartSec=100\nExecStart=/usr/bin/python3 /usr/local/lib/rolling-attest.py\nStandardOutput=null\nStandardError=null\n',0o644)
    write('/etc/systemd/system/rolling-attest.timer','[Unit]\nDescription=Bootstrap controls monitor\n[Timer]\nOnBootSec=5s\nOnUnitActiveSec=5s\n[Install]\nWantedBy=timers.target\n',0o644)
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','rolling-attest.timer'])

def execute(config, attestation_source):
    global DIAGNOSTICS_ACTIVE
    DIAGNOSTICS_ACTIVE=True;mark('entry')
    try:_execute(config,attestation_source)
    except Exception as error:shutdown_failure(error)
    finally:DIAGNOSTICS_ACTIVE=False

def _execute(config, attestation_source):
    global STAGE
    mark('host-preflight')
    if platform.system()!='Linux' or platform.machine()!='x86_64' or os.geteuid()!=0: raise ValueError('Linux x64 root required')
    mark('state-directory');BASE.mkdir(parents=True,exist_ok=True,mode=0o700)
    mark('writer-lock')
    with open(BASE/'lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            STAGE='controls';install_controls(config);write(BASE/'stage',STAGE)
            egress_before=verify_controls()
            if 'receiptPutUrl' in config: write(PRIVATE/'receipt-put.json',json.dumps({'url':receipt_url(config['receiptPutUrl'])}))
            mark('monitor-install');install_attestation(attestation_source)
            if not RELEASE.exists():
                STAGE='package';write(BASE/'stage',STAGE)
                archive=BASE/'runtime.tar.gz'
                mark('runtime-download')
                if not archive.exists(): fetch_package(config['runtimeUrl'],archive)
                mark('runtime-verify');extract_verified(archive,RELEASE,config['runtimeArchiveSha256'])
            else: mark('runtime-verify');verify_release(RELEASE)
            mark('native-checks');node=str(RELEASE/'node/bin/node');bb=str(RELEASE/'node_modules/@aztec-foundation/bb.js/build/amd64-linux/bb')
            if run([node,'--version'],capture=True)!='v24.21.0': raise ValueError('Wrong Node')
            if run([bb,'--version'],capture=True).strip()!=PINS['bbVersion']: raise ValueError('Wrong BB')
            run([node,'--input-type=module','--eval',"import {loadRollingArtifacts} from '"+(RELEASE/'prover/rolling-artifacts.mjs').as_uri()+"';loadRollingArtifacts();"],timeout=120)
            STAGE='node';write(BASE/'stage',STAGE);mark('node-install');install_node();verify_controls()
            egress_after=verify_controls();mark('egress-exercise')
            if type(egress_before) is not int or type(egress_after) is not int or egress_after<=egress_before: raise ValueError('Egress counter exercise failed')
            write(BASE/'egress-exercise.json',json.dumps({'beforeBytes':egress_before,'afterBytes':egress_after,'deltaBytes':egress_after-egress_before,'exercise':'installation-egress-not-throughput'}))
            if 'queryHost' in config: exclusive_record(PRIVATE/'query-host-request.json',config['queryHost'])
            if 'activationDelivery' in config: exclusive_record(PRIVATE/'activation-delivery-request.json',config['activationDelivery'])
            STAGE='installed';write(BASE/'stage',STAGE)
            # Only commissioning protection is retired; fixed budget control remains enabled.
            mark('qualification-install');run(['systemctl','disable','--now','rolling-commissioning.timer']);install_qualification();attest();mark('complete');diagnostic(status='passed')
        except Exception as error:shutdown_failure(error)
'''



# Dedicated records from the exact pinned process with an explicit configuration-provider adapter; not adversarial attestation.
STARTUP_HELPER_SHA = 'f10d47fa2f26f50197bb36c44c75f2d34b41a2e5726caed26c935e42f2c69d15'
# Entire relative-import closure. SDK imports intentionally resolve in the image.
STARTUP_SOURCES = {
    'deploy/prover/startup-stages.mjs': STARTUP_HELPER_SHA,
    'prover/compact-node-transform.mjs': 'd7e7e95a1061342e7aaa301e826fbf4bd21cfb9ea2de605e2a2aa17452160545',
    'prover/compact-node-registration.mjs': '07316d9a6629dff67fbb8d033360a45b9a1492febdd18520e6ffe6c1023c546c',
    'prover/compact-block-native.mjs': '6fc4e562fea1a2d544d742b8e58a8941724cbd6b7d7e67d4231e02a586707888',
    'shared/trusted-private-node.mjs': '4396e9b5c7e0cacef5c9fb53d59e433b76acedef7d57be577ba494d20e1e863a',
}
STARTUP_ADAPTER = 'publicnode-config-v1'
DIAGNOSTIC_PHASES = ('registry-guard', 'rollup-compatibility', 'l1-config', 'genesis-compare', 'telemetry', 'factory', 'factory-bb', 'factory-kzg', 'factory-keystore', 'factory-addresses', 'factory-l1-constants', 'factory-blob', 'factory-snapshot', 'factory-epoch-cache', 'factory-world-state', 'factory-avm', 'factory-archiver', 'factory-world-state-sync', 'factory-verifiers', 'factory-fee-provider', 'factory-p2p', 'factory-start', 'public-rpc-bind', 'admin-auth', 'admin-rpc-bind', 'archiver-store', 'archiver-protocol-register', 'archiver-constants', 'archiver-start-header', 'archiver-start', 'archiver-blob-test', 'archiver-clock-test', 'archiver-trace-test', 'archiver-history-test', 'archiver-initial-sync')

def stage_directory(base):
    directory=base/'startup-stages'
    info=directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o700 or info.st_uid!=os.getuid():raise ValueError('Invalid stage directory')
    return directory

def startup_sources(root=None):
    """Capture exact regular public bytes before any destination or evidence write."""
    root=(pathlib.Path(root) if root is not None else pathlib.Path(__file__).resolve().parents[2]).resolve()
    captured={}
    for rel,expected in STARTUP_SOURCES.items():
        path=root/rel
        if path.resolve()!=path or any(not stat.S_ISDIR(parent.lstat().st_mode) for parent in path.parents if parent!=root and root in parent.parents):
            raise ValueError('Invalid helper source path')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or not 0<info.st_size<=1048576:raise ValueError('Invalid helper source file')
            with os.fdopen(fd,'rb',closefd=False) as stream:raw=stream.read(1048577)
            if len(raw)!=info.st_size or hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Invalid helper source hash')
            captured[rel]=raw
        finally:os.close(fd)
    return captured

def instrument_node_args(args,base):
    captured=startup_sources() # complete closure is checked before creating either directory
    i=args.index(IMAGE)
    directory=base/'startup-stages';directory.mkdir(mode=0o700) # exclusive, retain failures/prior evidence
    stage_directory(base)
    code=base/'startup-code';code.mkdir(mode=0o700)
    for rel,raw in captured.items():
        destination=code/rel;destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(raw);stream.flush();os.fsync(fd)
        finally:os.close(fd)
    for path in sorted([code,*[p for p in code.rglob('*') if p.is_dir()]],key=lambda p:len(p.parts),reverse=True)+[base]:
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    # No mounted node_modules: this exact local closure shares the image SDK classes.
    return args[:i]+['-v',str(code)+':/usr/src/yarn-project/rolling:ro','-v',str(directory)+':/rolling-startup']+args[i:i+1]+['--import','/usr/src/yarn-project/rolling/deploy/prover/startup-stages.mjs']+args[i+1:]

def validate_archiver_progress(p):
    counters=('passesStarted','passesCompleted','passesFailed','lastObservationMs','lastProgressMs','droppedObservations')
    heights=('localL1Block','observedHeadL1Block','lastCheckpoint')
    if type(p) is not dict or set(p)!=set(counters+heights+('inFlight','error')):raise ValueError()
    def uint(n):return type(n) is int and 0<=n<=4294967295
    if any(not uint(p[k]) for k in counters) or any(p[k] is not None and not uint(p[k]) for k in heights):raise ValueError()
    if type(p['inFlight']) is not bool or p['passesCompleted']+p['passesFailed']+int(p['inFlight'])!=p['passesStarted'] or p['lastProgressMs']>p['lastObservationMs']:raise ValueError()
    e=p['error']
    if e is not None:
        if type(e) is not dict or set(e)!={'category','httpStatus','rpcCode'} or e['category'] not in ('http','rpc','blob','old-block','unknown'):raise ValueError()
        if e['httpStatus'] is not None and (type(e['httpStatus']) is not int or not 100<=e['httpStatus']<=599):raise ValueError()
        if e['rpcCode'] is not None and (type(e['rpcCode']) is not int or not -(2**31)<=e['rpcCode']<2**31):raise ValueError()
    return p

def stage_observation(base):
    try:
        directory=stage_directory(base)
        for name in ('.stages.failed','.stages.tmp'):
            try:(directory/name).lstat()
            except FileNotFoundError:continue
            raise ValueError()
        fd=os.open(directory/'stages.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.getuid() or info.st_size>8192:raise ValueError()
            with os.fdopen(fd,'rb',closefd=False) as f:data=f.read(8193)
            if len(data)>8192:raise ValueError()
            v=json.loads(data)
        finally:os.close(fd)
        if type(v) is not dict or set(v)!={'schemaVersion','instrumented','runtimeAdapter','helperSha256','history','archiver'} or type(v['schemaVersion']) is not int or v['schemaVersion']!=2 or v['instrumented'] is not True or v['runtimeAdapter']!=STARTUP_ADAPTER or v['helperSha256']!=STARTUP_HELPER_SHA:raise ValueError()
        validate_archiver_progress(v['archiver'])
        if type(v['history']) is not list or len(v['history'])>2*len(DIAGNOSTIC_PHASES):raise ValueError()
        stack=[];started=set()
        for pair in v['history']:
            if type(pair) is not list or len(pair)!=2 or pair[0] not in DIAGNOSTIC_PHASES or pair[1] not in ('begin','complete'):raise ValueError()
            phase,state=pair
            if state=='begin':
                if phase in started:raise ValueError()
                started.add(phase);stack.append(phase)
            elif not stack or stack.pop()!=phase:raise ValueError()
        return {'available':True,**v}
    except Exception:return {'available':False}

NODE_STAGES=('process-spawned','crs','genesis','rollup-standby','node-construction','public-rpc','admin-rpc')
NODE_ERRORS=('native-load','module-load','permission','disk-full','memory','fetch','unknown')

def node_startup_observation(base):
    try:
        v=private_file(base/'node-startup.json')
        if set(v)-{'cleanup'}!={'schemaVersion','stages','errors','oversizedLines','complete','exitCode','signal'} or type(v['schemaVersion']) is not int or v['schemaVersion']!=1 or type(v['complete']) is not bool: raise ValueError()
        if 'cleanup' in v and (type(v['cleanup']) is not dict or set(v['cleanup'])!={'attempted','reaped','terminateSent','killSent','failed'} or any(type(x) is not bool for x in v['cleanup'].values())):raise ValueError()
        for key,allowed in [('stages',NODE_STAGES),('errors',NODE_ERRORS)]:
            if type(v[key]) is not list or len(v[key])>len(allowed) or any(type(x) is not str or x not in allowed for x in v[key]) or len(set(v[key]))!=len(v[key]): raise ValueError()
        if type(v['oversizedLines']) is not int or not 0<=v['oversizedLines']<=2**32-1: raise ValueError()
        for key,limit in [('exitCode',255),('signal',64)]:
            if v[key] is not None and (type(v[key]) is not int or not 0<=v[key]<=limit): raise ValueError()
        if v['signal']==0:raise ValueError()
        if v['complete']!=(sum(v[k] is not None for k in ('exitCode','signal'))==1) or (not v['complete'] and (v['exitCode'] is not None or v['signal'] is not None)): raise ValueError()
        return {'available':True,**v,'instrumentation':stage_observation(base)}
    except Exception:return {'available':False}

class NodeOutput:
    def __init__(self):
        self.pending=b'';self.dropping=False
        self.value={'schemaVersion':1,'stages':[],'errors':[],'oversizedLines':0,'complete':False,'exitCode':None,'signal':None}
    def line(self,line):
        # Matches are never copied. These are observed log signatures, not health.
        for prefix,stage in [(b'Downloading CRS of size ','crs'),(b'Downloading Grumpkin CRS of size ','crs'),(b'Using cached ','crs'),(b'Genesis archive root: ','genesis')]:
            if line.startswith(prefix) and stage not in self.value['stages']:self.value['stages'].append(stage)
        for phrase,stage in [(b'Entering standby mode.','rollup-standby'),(b'Aztec Node version: ','node-construction'),(b'Aztec Server listening on port ','public-rpc'),(b'Aztec Server admin API listening on port ','admin-rpc')]:
            if phrase in line and stage not in self.value['stages']:self.value['stages'].append(stage)
        for token,category in [(b'ERR_DLOPEN_FAILED','native-load'),(b'ERR_MODULE_NOT_FOUND','module-load'),(b'EACCES','permission'),(b'ENOSPC','disk-full'),(b'ENOMEM','memory'),(b'fetch failed','fetch')]:
            if token in line and category not in self.value['errors']:self.value['errors'].append(category)
    def feed(self,chunk):
        # Caller reads <=4096 bytes. An oversized line is discarded in full.
        if len(chunk)>4096:raise ValueError('Chunk bound')
        parts=chunk.split(b'\n')
        for i,part in enumerate(parts):
            if not self.dropping:
                if len(self.pending)+len(part)>8192:
                    self.pending=b'';self.dropping=True;self.value['oversizedLines']=min(2**32-1,self.value['oversizedLines']+1)
                else:self.pending+=part
            if i<len(parts)-1:
                if not self.dropping:self.line(self.pending)
                self.pending=b'';self.dropping=False
    def finish(self,code):
        if not self.dropping:self.line(self.pending)
        self.pending=b''
        if code and not self.value['errors']:self.value['errors'].append('unknown')
        self.value.update(complete=True,exitCode=code if code>=0 else None,signal=-code if code<0 else None)

def reap_failed_node(process):
    # One TERM, then one KILL on timeout. systemd retains the outer cgroup limit.
    result={'attempted':process is not None,'reaped':False,'terminateSent':False,'killSent':False,'failed':False};code=None
    if process is None:return result,code
    try:
        if process.poll() is None:
            try:process.terminate();result['terminateSent']=True
            except ProcessLookupError:pass
            except Exception:result['failed']=True
        try:code=process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:process.kill();result['killSent']=True
            except ProcessLookupError:pass
            code=process.wait(timeout=2)
        result['reaped']=True
    except Exception:result['failed']=True
    return result,code

def node_wrapper(args,base):
    # Fixed generated systemd argv; never network/caller-selected commands.
    if args[:2]!=['/usr/bin/docker','run'] or args[-1]!='testnet' or IMAGE not in args:raise ValueError('Node command')
    output=NodeOutput();saved=None;process=None;requested=None
    def persist():
        nonlocal saved
        value=json.dumps(output.value,separators=(',',':'))
        if value!=saved:
            target=base/'node-startup.json';fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'w') as f:f.write(value);f.flush();os.fsync(f.fileno())
            fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(fd)
            finally:os.close(fd)
            saved=value
    def stop(number,frame):
        nonlocal requested
        requested=number
        if process is not None:
            try:process.send_signal(number)
            except ProcessLookupError:pass
    original_failure=None
    previous={n:signal.signal(n,stop) for n in (signal.SIGTERM,signal.SIGINT)}
    try:
        persist()
        if requested is not None:output.finish(-requested);persist();return -requested
        args=instrument_node_args(args,base)
        process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0)
        output.value['stages'].append('process-spawned');persist()
        if requested is not None:stop(requested,None)
        while True:
            chunk=process.stdout.read(4096)
            if not chunk:break
            before=(len(output.value['stages']),len(output.value['errors']))
            output.feed(chunk)
            if before!=(len(output.value['stages']),len(output.value['errors'])):persist()
        code=process.wait();output.finish(code);persist();return code
    except BaseException as error:
        original_failure=error
        cleanup,code=reap_failed_node(process);output.value['cleanup']=cleanup
        if code is not None:output.finish(code)
        try:persist()
        except Exception:pass # Failed storage cannot replace the original failure.
        try:error.node_cleanup=dict(cleanup)
        except Exception:pass
        raise
    finally:
        try:
            if process is not None:process.stdout.close()
        except Exception:
            if original_failure is None:raise
        finally:
            for n,handler in previous.items():signal.signal(n,handler)


PROVER_UNIT_SHA = '340d19baa4b764e5198fafb261f74001ffefa4c2d9dde111ef0ba07ca7e61cef'
ACTIVATION_PUBLIC_FILES = ('shared/portal-runtime.mjs','shared/portal-runtime.json',
                           'shared/protocol-commitments.mjs','shared/protocol-schema.mjs')


# Optional operator data plane. All executable content comes from this packaged
# source, never the campaign record. No API key or cloud authority enters it.
def query_host_record(value):
    if type(value) is not dict or set(value)!={'privateAddress','operatorAuthSha256','originSecurityGroupId'}:raise Invalid('Query host fields')
    if any(type(v) is not str for v in value.values()):raise Invalid('Query host types')
    try: address=ipaddress.IPv4Address(value['privateAddress'])
    except ValueError:raise Invalid('Query private address') from None
    if str(address)!=value['privateAddress'] or not any(address in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):raise Invalid('Query private address')
    if not re.fullmatch('[a-f0-9]{64}',value['operatorAuthSha256']) or not re.fullmatch('sg-([a-f0-9]{8}|[a-f0-9]{17})',value['originSecurityGroupId']):raise Invalid('Query host binding')
    return dict(value)

def query_host_request(h):
    record=query_host_record(activation_private(h['PRIVATE']/'query-host-request.json'))
    if hashlib.sha256(json.dumps(record,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=h['PINS'].get('queryHost'):raise Invalid('Query campaign binding')
    return record

def query_host_config(record):
    record=query_host_record(record)
    return {**QUALIFICATION['service'],'queryNode':dict(QUALIFICATION['service']['queryNode']),
            'host':record['privateAddress'],'port':8083,'operatorAuthSha256':record['operatorAuthSha256']}

def query_host_unit(release):
    # release is derived solely from the already checked manifest digest.
    if not re.fullmatch('/opt/board-prover/releases/rolling-[a-f0-9]{16}',str(release)):raise Invalid('Query release path')
    return ('[Unit]\nDescription=Authenticated operator query only\nRequires=rolling-node.service rolling-egress.service\nAfter=rolling-node.service rolling-egress.service\n'
      '[Service]\nType=simple\nUser=rolling-query\nGroup=rolling-query\nSupplementaryGroups=rolling-runtime\nWorkingDirectory='+str(release)+'\nExecStart='+str(release)+'/node/bin/node prover/start.mjs /etc/rolling-query/config.json\n'
      'Restart=no\nTimeoutStopSec=30\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nPrivateTmp=yes\nPrivateDevices=yes\nProtectSystem=strict\nProtectHome=yes\nCapabilityBoundingSet=\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n'
      'IPAddressDeny=any\nIPAddressAllow=localhost 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16\nInaccessiblePaths=/var/lib/rolling-bootstrap-private /var/lib/cloud /var/lib/rolling-admin\nMemoryMax=2G\nTasksMax=128\nLimitCORE=0\nEnvironment=NODE_BACKEND=js HARDWARE_CONCURRENCY=1 LOG_LEVEL=silent\nUnsetEnvironment=NODE_PATH NODE_OPTIONS BB\nStandardOutput=null\nStandardError=null\n')

def query_public_plan(release):
    if not release.is_absolute() or release.resolve()!=release:raise Invalid('Query release')
    entries=[(p,p.lstat()) for p in [release,*release.rglob('*')]]
    if not stat.S_ISDIR(entries[0][1].st_mode):raise Invalid('Query release directory')
    regular={p for p,i in entries if stat.S_ISREG(i.st_mode)}
    for p,i in entries:
        if i.st_uid!=0 or not (stat.S_ISREG(i.st_mode) or stat.S_ISDIR(i.st_mode) or stat.S_ISLNK(i.st_mode)):raise Invalid('Query public ownership')
        if stat.S_ISLNK(i.st_mode):
            try:
                if os.path.isabs(os.readlink(p)) or p.resolve(strict=True) not in regular:raise Invalid('Query public link')
            except (OSError,RuntimeError):raise Invalid('Query public link') from None
    for p in (release.parent,release.parent.parent):
        i=p.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid!=0 or i.st_mode&0o022:raise Invalid('Query traversal')
    return entries

def query_public_harden(entries,gid):
    for p,i in entries:
        current=p.lstat()
        if (current.st_dev,current.st_ino,current.st_mode,current.st_uid)!=(i.st_dev,i.st_ino,i.st_mode,i.st_uid):raise Invalid('Query release changed')
        os.chown(p,0,gid,follow_symlinks=False)
        if not stat.S_ISLNK(i.st_mode):os.chmod(p,0o550 if stat.S_ISDIR(i.st_mode) or i.st_mode&0o111 else 0o440,follow_symlinks=False)
    release=entries[0][0]
    for p in (release.parent,release.parent.parent):os.chmod(p,0o755,follow_symlinks=False)

def query_listener_denials(address):
    import urllib.request,urllib.error
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise Invalid('Query redirect')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    for path,method,expected in [('/healthz','GET',404),('/v1/node','POST',401)]:
        request=urllib.request.Request('http://'+address+':8083'+path,data=b'[]' if method=='POST' else None,method=method)
        try:
            with opener.open(request,timeout=2):raise Invalid('Query unauthenticated admission')
        except urllib.error.HTTPError as error:
            with error:
                if error.code!=expected or len(error.read(513))>512:raise Invalid('Query boundary')

def query_host_fresh(h):
    # Independent current upstream inspection: operator digest cannot sign a
    # self-test request, and the operator listener intentionally has no health API.
    code="import {createAztecNodeClient} from '@aztec-labs/stdlib/interfaces/client';import {jsonStringify} from '@aztec-labs/foundation/json-rpc';import {inspectTrustedNode} from './shared/trusted-private-node.mjs';const o="+json.dumps({'url':QUALIFICATION['service']['queryNode']['url'],'expectedNetworkScope':{'chainId':QUALIFICATION['service']['chainId'],'version':QUALIFICATION['service']['rollupVersion'],'rollup':QUALIFICATION['service']['queryNode']['rollupAddress']},'proofsEnabled':True,'maxLagSeconds':120},separators=(',',':'))+";const n=createAztecNodeClient(o.url,{maxBatchSize:1,fetch:async(host,body)=>{const r=await fetch(host,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();let size=0;const c=[];for await(const b of r.body){size+=b.length;if(size>33554432)throw Error();c.push(b);}return {response:JSON.parse(Buffer.concat(c).toString('utf8')),headers:r.headers};}});if((await inspectTrustedNode(n,o)).ready!==true)throw Error();process.stdout.write('ready');"
    if h['run']([str(h['RELEASE']/'node/bin/node'),'--max-old-space-size=256','--input-type=module','--eval',code],capture=True,timeout=25,cwd=h['RELEASE'])!='ready':raise Invalid('Query freshness')

def query_host_readback(h):
    import pwd,grp
    r=activation_private(h['PRIVATE']/'query-host-result.json')
    if type(r) is not dict or set(r)!={'uid','gid','publicGid','configSha256','unitSha256','manifestSha256'} or r['manifestSha256']!=h['PINS']['manifest'] or any(type(r[k]) is not int or not 0<r[k]<2**31 for k in ('uid','gid','publicGid')) or any(type(r[k]) is not str or not re.fullmatch('[a-f0-9]{64}',r[k]) for k in ('configSha256','unitSha256')):raise Invalid('Query result')
    user=pwd.getpwnam('rolling-query');public=grp.getgrnam('rolling-runtime')
    if (user.pw_uid,user.pw_gid,user.pw_shell)!=(r['uid'],r['gid'],'/usr/sbin/nologin') or public.gr_gid!=r['publicGid'] or not {'rolling-query'}<=set(public.gr_mem)<= {'rolling-query','board-prover'}:raise Invalid('Query identity')
    intent=activation_private(h['PRIVATE']/'query-host-intent.json')
    if type(intent) is not dict or type(intent.get('attempts')) is not int or intent!={'manifestSha256':h['PINS']['manifest'],'requestSha256':h['digest'](h['PRIVATE']/'query-host-request.json'),'finalReceiptSha256':h['digest'](h['PRIVATE']/'final-receipt.json'),'attempts':1}:raise Invalid('Query intent')
    record=query_host_request(h)
    config=pathlib.Path('/etc/rolling-query/config.json');info=config.lstat();parent=config.parent.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=r['gid'] or stat.S_IMODE(info.st_mode)!=0o640 or not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=0 or parent.st_gid!=r['gid'] or stat.S_IMODE(parent.st_mode)!=0o750:raise Invalid('Query config permissions')
    if h['digest'](config)!=r['configSha256'] or json.loads(config.read_text())!=query_host_config(record):raise Invalid('Query config changed')
    unit=pathlib.Path('/etc/systemd/system/rolling-query.service')
    if h['digest'](unit)!=r['unitSha256'] or unit.read_text()!=query_host_unit(h['RELEASE']):raise Invalid('Query unit changed')
    raw=h['run'](['systemctl','show','rolling-query.service','--property=User,Group,SupplementaryGroups,Restart,ActiveState,MainPID,DropInPaths,MemoryMax'],capture=True,timeout=5)
    if len(raw)>4096:raise Invalid('Query service state')
    rows=[line.partition('=') for line in raw.splitlines()];values={k:v for k,sep,v in rows}
    exact={'User':'rolling-query','Group':'rolling-query','SupplementaryGroups':'rolling-runtime','Restart':'no','ActiveState':'active','DropInPaths':'','MemoryMax':str(2*1024**3)}
    if len(rows)!=len(values) or any(not sep for _,sep,_ in rows) or set(values)!=set(exact)|{'MainPID'} or any(values[k]!=v for k,v in exact.items()) or not re.fullmatch('[1-9][0-9]{0,9}',values['MainPID']):raise Invalid('Query service state')
    with open(pathlib.Path('/proc')/values['MainPID']/'status','rb') as f:data=f.read(16385)
    if len(data)>16384:raise Invalid('Query process identity')
    for key,number in ((b'Uid:',r['uid']),(b'Gid:',r['gid'])):
        if [line.split()[1:] for line in data.splitlines() if line.startswith(key)]!=[[str(number).encode()]*4]:raise Invalid('Query process identity')
    groups=[line.split()[1:] for line in data.splitlines() if line.startswith(b'Groups:')]
    if len(groups)!=1 or len(groups[0])!=len(set(groups[0])) or any(not re.fullmatch(rb'[1-9][0-9]{0,9}',v) or int(v)>=2**31 for v in groups[0]) or not {str(r['publicGid']).encode()}<=set(groups[0])<={str(r['gid']).encode(),str(r['publicGid']).encode()}:raise Invalid('Query public group')
    for p,i in query_public_plan(h['RELEASE']):
        if i.st_gid!=r['publicGid'] or (not stat.S_ISLNK(i.st_mode) and stat.S_IMODE(i.st_mode)!=(0o550 if stat.S_ISDIR(i.st_mode) or i.st_mode&0o111 else 0o440)):raise Invalid('Query public permissions')
    query_listener_denials(record['privateAddress'])
    query_host_fresh(h)
    return r

def query_host(h):
    import fcntl,pwd,grp,time
    if os.geteuid()!=0:raise Invalid('Query authority')
    private=h['PRIVATE'];intent=private/'query-host-intent.json';result=private/'query-host-result.json'
    with open(private/'query-host-lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            record=query_host_request(h)
            if intent.exists():
                if not result.exists():raise Invalid('Query interrupted; reconcile only')
                query_host_readback(h);return {'queryHostPolicy':'active-private-authenticated','queryProofJobsEnabled':False}
            if result.exists():raise Invalid('Query result without intent')
            if not (private/'final-receipt.json').exists():return {'queryHostPolicy':'pending-qualification','queryProofJobsEnabled':False}
            final=activation_private(private/'final-receipt.json');q=h['validated_qualification'](final.get('qualification',{}))
            if final.get('manifestSha256')!=h['PINS']['manifest'] or final.get('bootstrapSourceSha256')!=h['PINS']['bootstrap'] or q.get('passed') is not True or q.get('stage')!='complete' or not q.get('checks') or not all(q['checks'].values()) or not {'anchors','readiness'}<=set(q):raise Invalid('Query qualification')
            if timestamp(h['read_bounded_json'](h['BASE']/'deadline.json')['budgetStop']).timestamp()-time.time()<900:raise Invalid('Query budget reserve')
            h['verify_release'](h['RELEASE']);h['verify_controls']();activation_proxy_masked(h)
            if h['run'](['systemctl','show','board-prover.service','--property=LoadState','--value'],capture=True,timeout=5)!='masked':raise Invalid('Proof service must be masked')
            addresses=json.loads(h['run'](['ip','-j','-4','address','show'],capture=True,timeout=5))
            if record['privateAddress'] not in [a.get('local') for row in addresses for a in row.get('addr_info',[]) if a.get('family')=='inet']:raise Invalid('Query address not local')
            query_host_fresh(h)
            entries=query_public_plan(h['RELEASE']);unit=query_host_unit(h['RELEASE']);configdir=pathlib.Path('/etc/rolling-query')
            if os.path.lexists(configdir) or os.path.lexists('/etc/systemd/system/rolling-query.service'):raise Invalid('Existing query paths')
            for name,lookup in [('rolling-query',pwd.getpwnam),('rolling-query',grp.getgrnam),('rolling-runtime',grp.getgrnam)]:
                try:lookup(name)
                except KeyError:pass
                else:raise Invalid('Existing query identity')
            h['exclusive_record'](intent,{'manifestSha256':h['PINS']['manifest'],'requestSha256':h['digest'](private/'query-host-request.json'),'finalReceiptSha256':h['digest'](private/'final-receipt.json'),'attempts':1})
            h['run'](['groupadd','--system','rolling-runtime'],timeout=5)
            h['run'](['useradd','--system','--user-group','--groups','rolling-runtime','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','rolling-query'],timeout=5)
            user=pwd.getpwnam('rolling-query');public=grp.getgrnam('rolling-runtime')
            if any(type(v) is not int or not 0<v<2**31 for v in (user.pw_uid,user.pw_gid,public.gr_gid)) or user.pw_shell!='/usr/sbin/nologin' or public.gr_mem!=['rolling-query']:raise Invalid('Query identity')
            query_public_harden(entries,public.gr_gid)
            configdir.mkdir(mode=0o750);os.chown(configdir,0,user.pw_gid);os.chmod(configdir,0o750)
            config=configdir/'config.json';h['exclusive_record'](config,query_host_config(record));os.chown(config,0,user.pw_gid);os.chmod(config,0o640)
            h['write']('/etc/systemd/system/rolling-query.service',unit,0o644);h['run'](['systemctl','daemon-reload'],timeout=5)
            h['verify_controls']();h['run'](['systemctl','start','rolling-query.service'],timeout=15)
            r={'uid':user.pw_uid,'gid':user.pw_gid,'publicGid':public.gr_gid,'configSha256':h['digest'](config),'unitSha256':hashlib.sha256(unit.encode()).hexdigest(),'manifestSha256':h['PINS']['manifest']}
            h['exclusive_record'](result,r)
            ready_by=time.monotonic()+15
            while True:
                try:query_host_readback(h);break
                except Exception:
                    if time.monotonic()>=ready_by:raise
                    h['verify_controls']();time.sleep(1)
            return {'queryHostPolicy':'active-private-authenticated','queryProofJobsEnabled':False}
        except BaseException:
            try:h['run'](['systemctl','stop','rolling-query.service'],timeout=35)
            finally:h['run'](['systemctl','start','--no-block','rolling-budget.service'],timeout=5)
            raise

def activation_delivery_digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def activation_delivery_record(value, budget_stop):
    if type(value) is not dict or set(value)!={'campaign','getUrl','scopeBindingSha256'}:raise Invalid('Delivery fields')
    if type(value['campaign']) is not str or not re.fullmatch('[a-zA-Z0-9_-]{1,80}',value['campaign']):raise Invalid('Delivery campaign')
    if type(value['scopeBindingSha256']) is not str or not re.fullmatch('[a-f0-9]{64}',value['scopeBindingSha256']):raise Invalid('Delivery scope binding')
    try:
        u=urllib.parse.urlsplit(receipt_url(value['getUrl']))
        if u.path!='/receipts/'+value['campaign']+'/activation.json':raise ValueError()
        q=urllib.parse.parse_qs(u.query,strict_parsing=True)
        expires=dt.datetime.strptime(q['X-Amz-Date'][0],'%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)+dt.timedelta(seconds=int(q['X-Amz-Expires'][0]))
        if expires<timestamp(budget_stop):raise ValueError()
    except Exception:raise Invalid('Delivery capability') from None
    return dict(value)

def activation_delivery_scope(scope):
    # Commit before launch to every fixed release/network/actor/address field.
    return {k:v for k,v in scope.items() if k not in ('checkpointNumber','checkpointHash','deploymentEvidenceSha256')}

def activation_delivery_fetch(url):
    # SigV4 authorizes only this fixed S3 GET. No cookies, ambient credentials,
    # redirects, retries, response diagnostics or executable input are admitted.
    import urllib.request,urllib.error
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args):raise Invalid('Delivery redirect')
    previous=signal.getsignal(signal.SIGALRM)
    def expired(*_):raise TimeoutError('Delivery read deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(8)
    try:
        try:response=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(url,timeout=8)
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            if code==404:return None
            raise Invalid('Delivery HTTP') from None
        with response:
            if response.status!=200:raise Invalid('Delivery HTTP')
            raw=response.read(16385);version=response.headers.get('x-amz-version-id')
            if len(raw)>16384 or type(version) is not str or not re.fullmatch('[a-zA-Z0-9._-]{1,1024}',version) or version=='null':raise Invalid('Delivery object')
            return raw,version
    except Exception:raise Invalid('Delivery unavailable') from None
    finally:signal.alarm(0);signal.signal(signal.SIGALRM,previous)

def activation_delivery(h):
    import fcntl,time
    if os.geteuid()!=0:raise Invalid('Delivery authority')
    private=h['PRIVATE'];prefix='activation-delivery-'
    # Existing private-file validation establishes canonical root ownership before
    # opening the lock. Every attempt/result is exclusive and fsynced.
    deadline=h['read_bounded_json'](h['BASE']/'deadline.json')
    request=activation_delivery_record(activation_private(private/(prefix+'request.json')),deadline['budgetStop'])
    if activation_delivery_digest(request)!=h['PINS'].get('activationDelivery'):raise Invalid('Delivery campaign binding')
    fd=os.open(private/(prefix+'lock'),os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        observed=private/(prefix+'observed.json');window=private/(prefix+'window.json')
        intent=private/'prover-activation-intent.json';result=private/'prover-activation-result.json'
        if observed.exists():
            record=activation_private(observed)
            if set(record)!={'campaign','versionId','objectSha256','scopeSha256'} or record['campaign']!=request['campaign'] or type(record['versionId']) is not str or not re.fullmatch('[a-zA-Z0-9._-]{1,1024}',record['versionId']) or record['versionId']=='null' or any(type(record[k]) is not str or not re.fullmatch('[a-f0-9]{64}',record[k]) for k in ('objectSha256','scopeSha256')):raise Invalid('Delivery retained binding')
            scope=activation_record(activation_private(private/'prover-activation-scope.json',record['scopeSha256']),h['PINS']['manifest'])
            if activation_delivery_digest(activation_delivery_scope(scope))!=request['scopeBindingSha256']:raise Invalid('Delivery retained scope')
            activation_private(private/'prover-deployment-evidence.json',scope['deploymentEvidenceSha256'])
            if not intent.exists() or not result.exists():raise Invalid('Delivery uncertain activation; reconcile only')
            return {**prover_activation(h,'observe'),'activationDelivery':'consumed'}
        if intent.exists() or result.exists():raise Invalid('Delivery missing original receipt')
        final_path=private/'final-receipt.json'
        if not final_path.exists():
            if window.exists():raise Invalid('Delivery qualification disappeared')
            return {'activationDelivery':'pending-query-qualification'}
        final=activation_private(final_path);q=h['validated_qualification'](final.get('qualification',{}))
        if final.get('manifestSha256')!=h['PINS']['manifest'] or final.get('bootstrapSourceSha256')!=h['PINS']['bootstrap'] or q.get('passed') is not True or q.get('stage')!='complete' or not q.get('checks') or not all(q['checks'].values()) or not {'anchors','readiness'}<=set(q):raise Invalid('Delivery qualification')
        now=int(time.time());stop=int(timestamp(deadline['budgetStop']).timestamp())-900
        paths=list(private.glob(prefix+'attempt-*.json'))
        if not window.exists():
            if paths:raise Invalid('Delivery window disappeared')
            h['exclusive_record'](window,{'startedAt':now,'stopAt':min(now+1800,stop),'attempts':0,'lastAttemptAt':None})
        limits=activation_private(window)
        if set(limits)!={'startedAt','stopAt','attempts','lastAttemptAt'} or any(type(limits[k]) is not int for k in ('startedAt','stopAt','attempts')) or not 0<=limits['attempts']<=60 or limits['stopAt']!=min(limits['startedAt']+1800,stop) or not limits['startedAt']<=now<limits['stopAt']:raise Invalid('Delivery window expired')
        count=limits['attempts'];last=None
        if len(paths)!=2*count:raise Invalid('Delivery interrupted read; reconcile only')
        for number in range(1,count+1):
            attempt=activation_private(private/(prefix+'attempt-'+str(number)+'.json'))
            outcome=activation_private(private/(prefix+'attempt-'+str(number)+'-result.json'))
            if set(attempt)!={'number','startedAt'} or type(attempt['number']) is not int or attempt['number']!=number or type(attempt['startedAt']) is not int or not limits['startedAt']<=attempt['startedAt']<=now or (last is not None and attempt['startedAt']<last+30) or outcome!={'status':'pending'}:raise Invalid('Delivery attempt history')
            last=attempt['startedAt']
        if limits['lastAttemptAt']!=last or (last is not None and type(limits['lastAttemptAt']) is not int):raise Invalid('Delivery high-water changed')
        if count>=60:raise Invalid('Delivery attempts exhausted')
        if last is not None and now<last+30:return {'activationDelivery':'pending-object'}
        h['verify_controls']()
        # A partial/truncated update or missing attempt pair fails closed on the
        # next visit; deleting a completed pair cannot reduce the durable count.
        h['write'](window,json.dumps({**limits,'attempts':count+1,'lastAttemptAt':now},separators=(',',':')))
        h['exclusive_record'](private/(prefix+'attempt-'+str(count+1)+'.json'),{'number':count+1,'startedAt':now})
        fetched=activation_delivery_fetch(request['getUrl'])
        if fetched is None:
            h['exclusive_record'](private/(prefix+'attempt-'+str(count+1)+'-result.json'),{'status':'pending'})
            return {'activationDelivery':'pending-object'}
        raw,version=fetched
        def unique(pairs):
            obj={}
            for k,v in pairs:
                if k in obj:raise Invalid('Delivery duplicate field')
                obj[k]=v
            return obj
        envelope=json.loads(raw,object_pairs_hook=unique)
        if type(envelope) is not dict or set(envelope)!={'schemaVersion','campaign','scope','evidence'} or type(envelope['schemaVersion']) is not int or envelope['schemaVersion']!=1 or envelope['campaign']!=request['campaign']:raise Invalid('Delivery envelope')
        scope=activation_record(envelope['scope'],h['PINS']['manifest']);evidence=envelope['evidence']
        if activation_delivery_digest(activation_delivery_scope(scope))!=request['scopeBindingSha256']:raise Invalid('Delivery scope changed')
        evidence_raw=json.dumps(evidence,separators=(',',':')).encode()
        if len(evidence_raw)>16384 or hashlib.sha256(evidence_raw).hexdigest()!=scope['deploymentEvidenceSha256']:raise Invalid('Delivery evidence bytes')
        h['verify_release'](h['RELEASE']);manifest=json.loads((h['RELEASE']/'prover-release.json').read_text())
        activation_evidence(evidence,scope,manifest['files'])
        if time.time()>=limits['stopAt']:raise Invalid('Delivery expired before consumption')
        scope_sha=hashlib.sha256(json.dumps(scope,separators=(',',':')).encode()).hexdigest()
        h['exclusive_record'](observed,{'campaign':request['campaign'],'versionId':version,'objectSha256':hashlib.sha256(raw).hexdigest(),'scopeSha256':scope_sha})
        h['exclusive_record'](private/'prover-activation-scope.json',scope)
        h['exclusive_record'](private/'prover-deployment-evidence.json',evidence)
        # The existing activation owns live identity, shutdown, intent-before-start
        # and all service permissions. The attestor's original100s outer cap stays.
        return {**prover_activation(h,'activate',scope_sha),'activationDelivery':'consumed'}

def activation_record(value, manifest):
    """Closed public scope; no endpoint, key, worker option or executable input."""
    fields={'schemaVersion','manifestSha256','catalogSha256','deploymentEvidenceSha256','chainId','rollupVersion',
            'rollupAddress','board','privateFeeAddress','privateBokAddress','boardDeployer','bokOwner','bokOperator',
            'portalAddress','checkpointNumber','checkpointHash'}
    if type(value) is not dict or set(value)!=fields or type(value['schemaVersion']) is not int or value['schemaVersion']!=1:
        raise Invalid('Activation schema')
    fixed={'manifestSha256':manifest,'catalogSha256':CATALOG_SHA,'chainId':QUALIFICATION['service']['chainId'],
           'rollupVersion':QUALIFICATION['service']['rollupVersion'],'rollupAddress':QUALIFICATION['service']['queryNode']['rollupAddress']}
    if any(type(value[k]) is not str or value[k]!=v for k,v in fixed.items()): raise Invalid('Activation identity')
    for name in ('board','privateFeeAddress','privateBokAddress','boardDeployer','bokOwner','bokOperator','portalAddress'):
        size=40 if name=='portalAddress' else 64
        if type(value[name]) is not str or not re.fullmatch('0x[a-f0-9]{'+str(size)+'}',value[name]) or int(value[name],16)==0:
            raise Invalid('Activation address')
    if len({value[k] for k in ('board','privateFeeAddress','privateBokAddress')})!=3: raise Invalid('Activation distinct addresses')
    if type(value['checkpointNumber']) is not int or not 0<value['checkpointNumber']<2**32: raise Invalid('Activation checkpoint')
    for key,pattern in [('checkpointHash','0x[a-f0-9]{64}'),('deploymentEvidenceSha256','[a-f0-9]{64}')]:
        if type(value[key]) is not str or not re.fullmatch(pattern,value[key]): raise Invalid('Activation digest')
    return dict(value)

def activation_evidence(value, scope, files):
    # Root supplies an independently reviewed receipt, not merely an opaque hash.
    checks={'boardConstructor','boardPortalRuntime','boardReady','privateFeeCanonical','bokConstructor','canonicalAnchors'}
    expected={k:scope[k] for k in scope if k not in ('deploymentEvidenceSha256','schemaVersion')}
    artifacts=('billboard/target/rolling_contract-RollingBoard.json','experiments/private-bok/target/private_bok-PrivateBok.json',
               'apps/src/billboard/private_fee_artifact.json','shared/portal-runtime.json')
    if type(value) is not dict or set(value)!={'schemaVersion','scope','artifacts','checks','bokScope'} or type(value['schemaVersion']) is not int or value['schemaVersion']!=1:
        raise Invalid('Deployment receipt schema')
    if value['scope']!=expected or value['artifacts']!={p:files[p] for p in artifacts}: raise Invalid('Deployment receipt binding')
    if type(value['checks']) is not dict or set(value['checks'])!=checks or any(x is not True for x in value['checks'].values()): raise Invalid('Deployment checks')
    if value['bokScope']!='constructor-allowlist-only': raise Invalid('Bok scope')
    return value

# Fixed source, executed only on the qualified Linux host with its pinned SDK.
# No wallet, signer, deployment, transaction submission or configurable endpoint.
ACTIVATION_CHECK = r'''
import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {RegistryAbi} from '@aztec-foundation/l1-artifacts';
import {encodeFunctionData,decodeFunctionResult,keccak256,toBytes} from 'viem';
import {createTrustedPrivateNode,inspectTrustedNode} from './shared/trusted-private-node.mjs';
import {loadRollingArtifacts} from './prover/rolling-artifacts.mjs';
import {encodeConfigCommitment} from './shared/protocol-commitments.mjs';
import {verifyPortalRuntime} from './shared/portal-runtime.mjs';
const check=x=>{if(!x)throw Error('ACTIVATION_SCOPE');};
const s=JSON.parse(process.argv[1]);
const network={chainId:s.chainId,version:s.rollupVersion,rollup:s.rollupAddress};
const options={url:'http://127.0.0.1:8082/',expectedNetworkScope:network,proofsEnabled:true,allowLocalDev:true,maxLagSeconds:120};
const num=x=>BigInt(x.toString()),same=(a,b)=>num(a)===num(b);
const address=x=>AztecAddress.fromString(x),field=x=>new Fr(BigInt(x));
const node=await createTrustedPrivateNode(options);
const reference={hash:s.checkpointHash};
async function anchor(){const b=await node.getBlockData(s.checkpointNumber);check(b?.blockHash.toString()===s.checkpointHash&&b.header.globalVariables.blockNumber===s.checkpointNumber);}
await anchor();
const [board,bok]=loadRollingArtifacts().map(raw=>loadContractArtifact(raw));
const fee=loadContractArtifact(JSON.parse(fs.readFileSync('apps/src/billboard/private_fee_artifact.json','utf8')));
async function instance(text,artifact,deployer){
 const a=address(text),i=await node.getContract(a,reference),c=await getContractClassFromArtifact(artifact);
 check(i&&same(i.address,a)&&same(i.originalContractClassId,c.id)&&same(i.currentContractClassId,c.id)&&same(await computeContractAddressFromInstance(i),a));
 if(deployer)check(same(i.deployer,deployer));return i;
}
await instance(s.board,board,s.boardDeployer);await instance(s.privateBokAddress,bok,s.bokOwner);
const canonical=await getContractInstanceFromInstantiationParams(fee,{salt:Fr.ZERO,deployer:AztecAddress.ZERO,constructorArgs:[]});
check(same(canonical.address,s.privateFeeAddress));await instance(s.privateFeeAddress,fee,AztecAddress.ZERO);
const slot=(a,k)=>num(a.storageLayout[k].slot);
const read=(a,n)=>node.getPublicStorageAt(reference,address(a),field(n)).then(num);
const base=slot(board,'config');check(slot(board,'portal_address')===1n&&base===3n&&slot(board,'deposits')===14n);
const config=[];for(let i=0;i<10;i++)config.push(await read(s.board,base+BigInt(i)));
const [chain,rollup,version,min,max,baseCooldown,kMultiplier,censorWindow,maxSaveUp,deployer]=config;
check(same(chain,s.chainId)&&same(rollup,s.rollupAddress)&&same(version,s.rollupVersion)&&same(deployer,s.boardDeployer));
check(same(await read(s.board,1n),s.portalAddress));
for(const [name,expected] of Object.entries({board:s.board,operator:s.bokOperator,owner:s.bokOwner,l1_chain:s.chainId,version:s.rollupVersion}))check(same(await read(s.privateBokAddress,slot(bok,name)),expected));
const economics=Object.fromEntries(Object.entries({minDeposit:min,maxDeposit:max,baseCooldown,kMultiplier,censorWindow,maxSaveUp}).map(([k,v])=>[k,String(v)]));
const hash=await sha256ToField({toBuffer:()=>encodeConfigCommitment({l1ChainId:s.chainId,rollupAddress:s.rollupAddress,rollupVersion:s.rollupVersion,boardAddress:s.board},economics)});
const contracts=await node.getL1ContractAddresses();check(same(contracts.rollupAddress,s.rollupAddress));
let calls=0,last=0;
async function rpc(method,params){
 check(++calls<=7);await new Promise(r=>setTimeout(r,Math.max(0,1250-(Date.now()-last))));last=Date.now();
 const r=await fetch('https://sepolia.gateway.tenderly.co',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),redirect:'error',signal:AbortSignal.timeout(8000)});
 check(r.ok&&r.body);const reader=r.body.getReader(),parts=[];let size=0;
 try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;check(size<=65536);parts.push(x.value);}}finally{await reader.cancel();reader.releaseLock();}
 const v=JSON.parse(Buffer.concat(parts).toString('utf8'));check(!v.error&&v.id===calls);return v.result;
}
check(same(await rpc('eth_chainId',[]),s.chainId));
const l1=await rpc('eth_getBlockByNumber',['latest',false]);const lag=Date.now()/1000-Number(BigInt(l1.timestamp));check(/^0x[0-9a-f]{64}$/.test(l1.hash)&&lag>=0&&lag<=120);
for(const [functionName,args] of [['getCanonicalRollup',[]],['getRollup',[BigInt(s.rollupVersion)]]]){
 const data=encodeFunctionData({abi:RegistryAbi,functionName,args});
 const result=await rpc('eth_call',[{to:'0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba',data},l1.number]);
 check(same(decodeFunctionResult({abi:RegistryAbi,functionName,data:result}),s.rollupAddress));
}
const code=await rpc('eth_getCode',[s.portalAddress,l1.number]);
const metadata=JSON.parse(fs.readFileSync('shared/portal-runtime.json','utf8'));
verifyPortalRuntime(code,metadata,{MIN_DEPOSIT:min,MAX_DEPOSIT:max,L2_CONTRACT:BigInt(s.board),ROLLUP:rollup,INBOX:num(contracts.inboxAddress),OUTBOX:num(contracts.outboxAddress),VERSION:version,L1_CHAIN_ID:chain,CONFIG_HASH:num(hash)});
// depositsEnabled() selector, derived by the pinned keccak implementation below.
const selector=keccak256(toBytes('depositsEnabled()')).slice(0,10);
check(await rpc('eth_call',[{to:s.portalAddress,data:selector},l1.number])==='0x'+('0'.repeat(63))+'1');
check((await rpc('eth_getBlockByNumber',[l1.number,false])).hash===l1.hash);
await anchor();const ready=await inspectTrustedNode(node,options);check(ready.checkpointedBlockNumber>=s.checkpointNumber);
process.stdout.write(JSON.stringify({ready,scopeVerified:true,checkpointHash:s.checkpointHash,bokScope:'constructor-allowlist-only'}));
'''

def activation_private(path, expected=None):
    path=pathlib.Path(path)
    if path.parent.resolve()!=path.parent or path.parent.stat().st_uid!=0 or stat.S_IMODE(path.parent.stat().st_mode)!=0o700:
        raise Invalid('Activation private directory')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>16384: raise Invalid('Activation private file')
        data=os.read(fd,16385)
        if len(data)!=info.st_size or (expected is not None and hashlib.sha256(data).hexdigest()!=expected): raise Invalid('Activation file binding')
        return json.loads(data)
    finally:os.close(fd)

def activation_config(scope):
    return {'serviceMode':'prover','applicationProfile':'rolling','proofs':'real','host':'127.0.0.1','port':8081,'origins':[],
            'chainId':scope['chainId'],'rollupVersion':scope['rollupVersion'],
            **{k:scope[k] for k in ('board','privateFeeAddress','privateBokAddress')},
            'pluginAddresses':[scope['privateBokAddress']],'threads':1,'queueDirectory':'/run/board-prover',
            'crsPath':'/run/board-prover/crs','queryNode':dict(QUALIFICATION['service']['queryNode'])}

def activation_rule_counter(text, uid):
    if type(text) is not str or len(text)>16384:raise Invalid('UID traffic readback')
    rule='-A OUTPUT -m owner --uid-owner '+str(uid)+' -j MARK --set-xmark 0x14/0xffffffff'
    count=[]
    for line in text.splitlines():
        if not line or line.startswith('#') or line=='*mangle' or line=='COMMIT' or re.fullmatch(r':(PREROUTING|INPUT|FORWARD|OUTPUT|POSTROUTING) ACCEPT \[[0-9]+:[0-9]+\]',line):continue
        m=re.fullmatch(r'\[([0-9]{1,20}):([0-9]{1,20})\] '+re.escape(rule),line)
        if not m:raise Invalid('Unexpected traffic rule')
        count.append(int(m[1]))
    if len(count)!=1:raise Invalid('Missing or duplicate UID mark')
    return count[0]

def activation_traffic(h, uid, exercise=False, gid=None):
    run=h['run'];h['verify_controls']()
    dev=(h['BASE']/'interface').read_text()
    filters=run(['tc','filter','show','dev',dev,'parent','1:'],capture=True,timeout=5)
    lines=[x.strip() for x in filters.splitlines() if x.strip()]
    # tc emits an optional header and exactly one mapping detail. Separators
    # belong to their fields: stripping a header must not require a trailing
    # space. Only this all-protocol chain-zero fw mapping is accepted.
    prefix=r'filter(?: parent 1:)? protocol all pref 1 fw(?: chain 0)?'
    header=[x for x in lines if re.fullmatch(prefix,x)]
    detail=[x for x in lines if re.fullmatch(prefix+r' handle 0x14 classid 1:20',x)]
    if len(header)>1 or len(detail)!=1 or len(header)+len(detail)!=len(lines):
        raise Invalid('Prover traffic class')
    before=[activation_rule_counter(run([family+'-save','-c','-t','mangle'],capture=True,timeout=5),uid) for family in ('iptables','ip6tables')]
    if exercise:
        # Loopback UDP proves both owner match and MARK target execute. It is
        # deliberately not a throughput measurement or external traffic probe.
        code="import socket;\nfor f,a in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')]:\n s=socket.socket(f,socket.SOCK_DGRAM);s.sendto(b'rolling-mark-check',(a,9));s.close()"
        run(['setpriv','--reuid='+str(uid),'--regid='+str(uid if gid is None else gid),'--clear-groups','/usr/bin/python3','-c',code],timeout=5)
        after=[activation_rule_counter(run([family+'-save','-c','-t','mangle'],capture=True,timeout=5),uid) for family in ('iptables','ip6tables')]
        if any(a<=b for a,b in zip(after,before)):raise Invalid('UID mark exercise')
    return {'ipv4UidMark':True,'ipv6UidMark':True,'fwmarkClass20':True,'aggregate50Mbps':True}

def activation_identity(h, scope):
    raw=h['run'](['/usr/bin/env','NODE_BACKEND=js','HARDWARE_CONCURRENCY=1',str(h['RELEASE']/'node/bin/node'),'--input-type=module','--eval',ACTIVATION_CHECK,
                  json.dumps(scope,separators=(',',':'))],timeout=90,capture=True,cwd=h['RELEASE'])
    if type(raw) is not str or len(raw)>16384:raise Invalid('Activation scope response')
    result=json.loads(raw)
    if type(result) is not dict or set(result)!={'ready','scopeVerified','checkpointHash','bokScope'} or result['scopeVerified'] is not True or result['checkpointHash']!=scope['checkpointHash'] or result['bokScope']!='constructor-allowlist-only':raise Invalid('Activation scope failed')
    ready=h['readiness_projection'](result['ready'])
    now=int(dt.datetime.now(dt.timezone.utc).timestamp())
    if not 0<=now-ready['checkedAtSeconds']<=10:raise Invalid('Stale activation readiness')
    return ready

def activation_health():
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise Invalid('Health redirect')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open('http://127.0.0.1:8081/healthz',timeout=5) as response:
        data=response.read(16385)
        if response.status!=200 or len(data)>16384:raise Invalid('Prover health')
    health=json.loads(data)
    if type(health) is not dict or set(health)!={'ready','proofs','queue','query'} or health['ready'] is not True or health['proofs']!='real' or health['query']!={'enabled':True,'ready':True}:raise Invalid('Prover health')
    q=health['queue']
    if type(q) is not dict or set(q)!={'jobs','bytes','running','submitted','completed','failed'} or type(q['running']) is not bool or any(type(q[k]) is not int or not 0<=q[k]<=2**53-1 for k in q if k!='running'):raise Invalid('Prover queue health')
    return q

def activation_paths(h, scope):
    """Create only dedicated public runtime/config paths, never widen PRIVATE."""
    import pwd,grp
    run=h['run'];release=h['RELEASE']
    # Manifest verification precedes this function. Prevalidate the complete
    # ownership/link/traversal plan before allocating an identity or changing
    # any path. Official Node npm/npx/corepack links are relative file links.
    entries=query_public_plan(release)
    if os.path.lexists(pathlib.Path('/etc/board-prover')) or os.path.lexists(release.parent.parent/'current'):raise Invalid('Existing prover paths')
    try:pwd.getpwnam('board-prover')
    except KeyError:pass
    else:raise Invalid('Existing prover identity')
    try:grp.getgrnam('board-prover')
    except KeyError:pass
    else:raise Invalid('Existing prover group')
    run(['useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','board-prover'],timeout=5)
    user=pwd.getpwnam('board-prover');group=grp.getgrnam('board-prover')
    if not 1<=user.pw_uid<2**31 or not 1<=user.pw_gid==group.gr_gid<2**31 or user.pw_shell!='/usr/sbin/nologin' or group.gr_mem:raise Invalid('Prover identity')
    public_gid=group.gr_gid
    if 'PRIVATE' in h and (h['PRIVATE']/'query-host-result.json').exists():
        query=query_host_readback(h)
        public_gid=query['publicGid']
        run(['usermod','--append','--groups','rolling-runtime','board-prover'],timeout=5)
        if 'board-prover' not in grp.getgrnam('rolling-runtime').gr_mem:raise Invalid('Public runtime membership')
    query_public_harden(entries,public_gid)
    configdir=pathlib.Path('/etc/board-prover');configdir.mkdir(mode=0o750)
    os.chown(configdir,0,group.gr_gid);os.chmod(configdir,0o750)
    config=configdir/'config.json';h['exclusive_record'](config,activation_config(scope));os.chown(config,0,group.gr_gid);os.chmod(config,0o640)
    os.symlink(release,release.parent.parent/'current')
    return user.pw_uid,group.gr_gid

def activation_proxy_masked(h):
    if h['run'](['systemctl','show','board-prover-proxy.service','--property=LoadState','--value'],capture=True,timeout=5)!='masked':raise Invalid('Proxy must remain masked')

def activation_service(h, uid, gid, config_sha):
    config=pathlib.Path('/etc/board-prover/config.json');info=config.lstat();parent=config.parent.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=gid or stat.S_IMODE(info.st_mode)!=0o640 or not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=0 or parent.st_gid!=gid or stat.S_IMODE(parent.st_mode)!=0o750:raise Invalid('Prover config permissions')
    if h['digest'](config)!=config_sha or h['digest']('/etc/systemd/system/board-prover.service')!=PROVER_UNIT_SHA:raise Invalid('Prover source changed')
    if pathlib.Path('/opt/board-prover/current').resolve()!=h['RELEASE']:raise Invalid('Prover release changed')
    raw=h['run'](['systemctl','show','board-prover.service','--property=User,Group,Restart,ActiveState,MainPID,DropInPaths,MemoryMax'],capture=True,timeout=5)
    if len(raw)>4096:raise Invalid('Prover service properties')
    values={}
    for line in raw.splitlines():
        key,sep,value=line.partition('=')
        if not sep or key in values:raise Invalid('Prover service properties')
        values[key]=value
    exact={'User':'board-prover','Group':'board-prover','Restart':'no','ActiveState':'active','DropInPaths':'','MemoryMax':str(24*1024**3)}
    if set(values)!=set(exact)|{'MainPID'} or any(values[k]!=v for k,v in exact.items()) or not re.fullmatch('[1-9][0-9]{0,9}',values['MainPID']):raise Invalid('Prover service controls')
    status=pathlib.Path('/proc')/values['MainPID']/'status'
    with open(status,'rb') as f:data=f.read(16385)
    if len(data)>16384:raise Invalid('Prover process identity')
    for key,number in ((b'Uid:',uid),(b'Gid:',gid)):
        rows=[line.split()[1:] for line in data.splitlines() if line.startswith(key)]
        if rows!=[[str(number).encode()]*4]:raise Invalid('Prover process identity')

def qualification_projection(h, report, process_exited=False):
    # Fixed booleans only: no messages, configuration, reply, logs or arbitrary keys.
    checks=report.get('checks',{});cleanup=report.get('cleanup',{})
    result={'processExitVerified':process_exited is True}
    for name in ('wrong-chain','wrong-version','wrong-rollup','proof-config-floor'):
        result[name]=checks.get(name,{}).get('rejected') is True
    for name in ('healthy','recovered'):
        r=checks.get(name,{})
        result[name]=r.get('ready') is True and type(r.get('blockNumber')) is int and r['blockNumber']>=0 and bool(re.fullmatch('0x[a-f0-9]{64}',str(r.get('blockHash'))))
    result['nativeAndRollingCatalog']=checks.get('nativeAndRollingCatalog',{}).get('passed') is True
    result['missingHelper']=checks.get('missingHelper',{}).get('missingHelperRejected') is True
    result['manifestUnchanged']=checks.get('manifestUnchanged') is True
    for name in ('paused','stale','queriesRejected','resumed','recovered'):
        result['freshness-'+name]=checks.get('freshness',{}).get(name) is True
    for name in ('serviceClosed','temporaryFilesRemoved','childProcessesExited'):
        result['cleanup-'+name]=cleanup.get(name) is True
    scope=h['QUALIFICATION']['service'];expected={'chainId':scope['chainId'],'rollupVersion':scope['rollupVersion']}
    public=report.get('publicScope',{})
    result['scope']=public=={'chainId':expected['chainId'],'version':expected['rollupVersion'],
        'rollup':scope['queryNode']['rollupAddress'],'serviceMode':'query-only','nodeProofs':'real','maxLagSeconds':120}
    result['release']=report.get('release',{}).get('manifestSha256')==h['PINS']['manifest']
    result['noProofJobs']=type(report.get('proofJobs')) is int and report['proofJobs']==0
    lifecycle=checks.get('noProofLifecycle',{});expected={'passed':True,'proofEndpointsDisabled':True,'queueAllocated':False,'workerAllocated':False}
    result['noProofLifecycle']=type(lifecycle) is dict and set(lifecycle)==set(expected) and all(type(lifecycle[k]) is bool and lifecycle[k] is v for k,v in expected.items())
    result['complete']=report.get('passed') is True and report.get('stage')=='complete'
    return result

def qualification_anchors(checks):
    anchors={}
    for name in ('healthy','recovered'):
        value=checks[name]
        if type(value.get('blockNumber')) is not int or not 0<=value['blockNumber']<=2**53-1 or type(value.get('blockHash')) is not str or not re.fullmatch('0x[a-f0-9]{64}',value['blockHash']): raise ValueError('Invalid qualification anchor')
        anchors[name]={'blockNumber':value['blockNumber'],'blockHash':value['blockHash']}
    return anchors

def prover_activation(h, operation, expected=None):
    """Pinned package support. No listener, retry, capability or paid API."""
    import fcntl,time
    if operation=='qualification-projection':return qualification_projection(h,*expected)
    if operation=='qualification-anchors':return qualification_anchors(expected)
    if operation=='query-observe':return query_host(h)
    if operation=='delivery':return activation_delivery(h)
    if os.geteuid()!=0 or operation not in ('activate','observe'):raise Invalid('Activation authority')
    private=h['PRIVATE'];intent_path=private/'prover-activation-intent.json';result_path=private/'prover-activation-result.json'
    if operation=='observe':
        intent=activation_private(intent_path)
        if type(intent) is not dict or set(intent)!={'schemaVersion','scopeSha256','manifestSha256','startedAt','attempts'} or type(intent['schemaVersion']) is not int or intent['schemaVersion']!=1 or type(intent['attempts']) is not int or intent['attempts']!=1 or intent['manifestSha256']!=h['PINS']['manifest'] or type(intent['scopeSha256']) is not str or not re.fullmatch('[a-f0-9]{64}',intent['scopeSha256']):raise Invalid('Activation intent')
        if not result_path.exists():
            if type(intent.get('startedAt')) is not int or not 0<=int(time.time())-intent['startedAt']<=300:raise Invalid('Activation interrupted')
            return {'proverPolicy':'activation-in-progress','proverActivated':False}
        result=activation_private(result_path)
        keys={'schemaVersion','status','manifestSha256','uid','gid','configSha256','traffic','applicationProofQualified','bokScope'}
        traffic={'ipv4UidMark':True,'ipv6UidMark':True,'fwmarkClass20':True,'aggregate50Mbps':True}
        if type(result) is not dict or set(result)!=keys or type(result['schemaVersion']) is not int or result['schemaVersion']!=1 or result['status']!='active-loopback' or result['manifestSha256']!=h['PINS']['manifest'] or any(type(result[k]) is not int or not 0<result[k]<2**31 for k in ('uid','gid')) or type(result['configSha256']) is not str or not re.fullmatch('[a-f0-9]{64}',result['configSha256']) or type(result['traffic']) is not dict or set(result['traffic'])!=set(traffic) or any(v is not True for v in result['traffic'].values()) or result['applicationProofQualified'] is not False or result['bokScope']!='constructor-allowlist-only':raise Invalid('Activation result')
        activation_proxy_masked(h);activation_traffic(h,result['uid'])
        activation_service(h,result['uid'],result['gid'],result['configSha256']);activation_health()
        return {'proverPolicy':'active-loopback','proverActivated':True,'applicationScopeSha256':intent['scopeSha256'],
                'bokScope':'constructor-allowlist-only','applicationProofQualified':False}
    if type(expected) is not str or not re.fullmatch('[a-f0-9]{64}',expected):raise Invalid('Activation digest')
    with open(private/'prover-activation-lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if intent_path.exists() or result_path.exists():raise Invalid('Activation already attempted; reconcile only')
        previous=signal.getsignal(signal.SIGALRM)
        def expired(*_):raise TimeoutError('Activation deadline')
        signal.signal(signal.SIGALRM,expired);signal.alarm(300)
        try:
            scope=activation_record(activation_private(private/'prover-activation-scope.json',expected),h['PINS']['manifest'])
            h['verify_release'](h['RELEASE']);h['verify_controls']();activation_proxy_masked(h)
            manifest=json.loads((h['RELEASE']/'prover-release.json').read_text())
            evidence=activation_private(private/'prover-deployment-evidence.json',scope['deploymentEvidenceSha256'])
            activation_evidence(evidence,scope,manifest['files'])
            final=activation_private(private/'final-receipt.json')
            q=h['validated_qualification'](final.get('qualification',{}))
            if final.get('manifestSha256')!=h['PINS']['manifest'] or final.get('bootstrapSourceSha256')!=h['PINS']['bootstrap'] or q.get('passed') is not True or q.get('stage')!='complete' or not q.get('checks') or not all(q['checks'].values()) or not {'anchors','readiness'}<=set(q):raise Invalid('Current query qualification required')
            deadline=h['read_bounded_json'](h['BASE']/'deadline.json')
            if timestamp(deadline['budgetStop']).timestamp()-time.time()<900:raise Invalid('Activation budget reserve')
            unit=h['RELEASE']/'deploy/prover/board-prover.service'
            if h['digest'](unit)!=PROVER_UNIT_SHA:raise Invalid('Prover unit changed')
            activation_identity(h,scope);h['verify_controls']()
            h['exclusive_record'](intent_path,{'schemaVersion':1,'scopeSha256':expected,'manifestSha256':h['PINS']['manifest'],'startedAt':int(time.time()),'attempts':1})
            uid,gid=activation_paths(h,scope)
            for family in ('iptables','ip6tables'):
                # No hidden preexisting policy may override the new owner mark.
                policy=h['run']([family,'-t','mangle','-S'],capture=True,timeout=5)
                if set(policy.splitlines())!={'-P '+c+' ACCEPT' for c in ('PREROUTING','INPUT','FORWARD','OUTPUT','POSTROUTING')}:raise Invalid('Existing mangle policy')
                h['run']([family,'-t','mangle','-A','OUTPUT','-m','owner','--uid-owner',str(uid),'-j','MARK','--set-xmark','0x14/0xffffffff'],timeout=5)
            traffic=activation_traffic(h,uid,exercise=True,gid=gid)
            activation_identity(h,scope);h['verify_controls']();activation_proxy_masked(h)
            # Intent already durable; any ambiguous start is terminal, never replayed.
            h['run'](['systemctl','unmask','board-prover.service'],timeout=5)
            h['write']('/etc/systemd/system/board-prover.service',unit.read_text(),0o644)
            h['run'](['systemctl','daemon-reload'],timeout=5)
            h['run'](['systemctl','start','board-prover.service'],timeout=15)
            h['run'](['systemctl','is-active','--quiet','board-prover.service'],timeout=5)
            deadline=time.monotonic()+30
            while True:
                try:queue=activation_health();break
                except Exception:
                    if time.monotonic()>=deadline:raise
                    h['verify_controls']();time.sleep(1)
            if queue['submitted']!=0:raise Invalid('Unexpected proof job')
            config_sha=h['digest']('/etc/board-prover/config.json');activation_service(h,uid,gid,config_sha)
            result={'schemaVersion':1,'status':'active-loopback','manifestSha256':h['PINS']['manifest'],'uid':uid,'gid':gid,
                    'configSha256':config_sha,'traffic':traffic,'applicationProofQualified':False,'bokScope':'constructor-allowlist-only'}
            h['exclusive_record'](result_path,result)
            return result
        except BaseException:
            try:h['run'](['systemctl','stop','board-prover.service'],timeout=35)
            finally:h['run'](['systemctl','start','--no-block','rolling-budget.service'],timeout=5)
            raise
        finally:signal.alarm(0);signal.signal(signal.SIGALRM,previous)

def generate(config, now=None):
    config = validate(config, now)
    require_linux_qualification()
    # Remove comments only to stay within AWS's 16KiB compressed user-data cap.
    # Tokenization preserves every string, executable token and line boundary.
    runtime=tokenize.untokenize(t._replace(string='') if t.type==tokenize.COMMENT else t for t in tokenize.generate_tokens(io.StringIO(HOST).readline))
    pins = {'image':IMAGE, 'manifest':config['manifestSha256'], 'node':NODE_SHA, 'bb':BB_SHA, 'bbVersion':BB_VERSION, 'catalog':CATALOG_SHA, 'bootstrap':hashlib.sha256(runtime.encode()).hexdigest(),'startup':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
    if 'queryHost' in config:pins['queryHost']=hashlib.sha256(json.dumps(config['queryHost'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if 'activationDelivery' in config:pins['activationDelivery']=activation_delivery_digest(config['activationDelivery'])
    prefix = 'PINS = '+repr(pins)+'\nNETWORK = '+repr(NETWORK)+'\nQUALIFICATION = '+repr(QUALIFICATION)+'\n'
    dispatch = "\ntry:\n    if sys.argv[1:2]==['--activate-prover']:\n        if len(sys.argv)!=3: raise ValueError('Activation arguments')\n        activation_support('activate',sys.argv[2])\n    elif '--qualify' in sys.argv: qualify()\n    elif '--qualification-stop' in sys.argv:\n        qualify(aborted=True);run(['systemctl','start','rolling-qualification-receipt.service'],timeout=40)\n    elif '--qualification-receipt' in sys.argv: final_receipt()\n    else: attest('--check' in sys.argv)\nexcept Exception as error:\n    shutdown_failure(error)\n"
    # A raw multiline literal avoids doubling runtime backslashes/newlines in
    # the compressed envelope. Verify its decoded value before emitting bytes;
    # runtime code, attestation content and their hashes remain unchanged.
    literal = 'r"""'+prefix+runtime+'"""'
    try:
        if ast.literal_eval(literal) != prefix+runtime: raise ValueError()
    except (SyntaxError, ValueError): raise Invalid('Bootstrap source encoding mismatch') from None
    program = 'SOURCE = '+literal+'\nCONFIG = '+repr(config)+'\nATTESTATION = SOURCE + '+repr(dispatch)+'\nexec(SOURCE)\nexecute(CONFIG, ATTESTATION)\n'
    encoded = base64.b64encode(lzma.compress(program.encode(),format=lzma.FORMAT_ALONE,
        filters=[{'id':lzma.FILTER_LZMA1,'preset':6,'pb':0}])).decode()
    return "#!/bin/sh\nset -eu\numask 077\nexec /usr/bin/python3 - <<'B'\nimport base64,lzma\nexec(lzma.decompress(base64.b64decode('"+encoded+"')))\nB\n"


# This closed diagnostic does not qualify normal deployment or run node/proof work.
NATIVE_BYTES = 44698432
NATIVE_REUSE = ('receipt_url','diagnostic','emit_diagnostic','mark','version_facts','run','write','digest',
                'host_resources','immutable_deadline','install_controls','class_bytes','verify_controls','exclusive_record',
                'read_bounded_json','upload_receipt')
NATIVE_GLOBALS = ('BASE','PRIVATE','STAGE','DIAGNOSTICS_ACTIVE','STEP','STEPS')

def native_control_source():
    # Explicit AST membership, in original order. No text-pattern extraction or
    # inferred dependency traversal. The generated program binds the full bytes.
    selected=[];found=[]
    for node in ast.parse(HOST).body:
        if isinstance(node,(ast.Import,ast.ImportFrom)):
            selected.append(ast.get_source_segment(HOST,node))
        elif isinstance(node,ast.FunctionDef) and node.name in NATIVE_REUSE:
            found.append(node.name);selected.append(ast.get_source_segment(HOST,node))
        elif isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in NATIVE_GLOBALS:
            found.append(node.targets[0].id);selected.append(ast.get_source_segment(HOST,node))
    if len(found)!=len(set(found)) or set(found)!=set(NATIVE_REUSE+NATIVE_GLOBALS):raise Invalid('Native control closure changed')
    return '\n\n'.join(selected)+'\n'

def native_binary_url(value):
    # Same scoped S3 capability grammar, but a single immutable public-binary key.
    if type(value) is not str:raise Invalid('Invalid binary capability')
    try:
        u=urllib.parse.urlsplit(value)
        expected='/releases/native-bb-'+BB_SHA+'/bb'
        if u.path!=expected:raise ValueError()
        receipt_url(urllib.parse.urlunsplit((u.scheme,u.netloc,'/receipts/native/binary.json',u.query,u.fragment)))
    except Exception:raise Invalid('Invalid binary capability') from None
    return value

def validate_native(config,now=None):
    keys={'mode','createdAt','budgetStop','commissioningStop','binaryUrl','binarySha256','binaryBytes','expectedVersion','receiptPutUrl'}
    if type(config) is not dict or set(config)!=keys:raise Invalid('Invalid native diagnostic fields')
    if config['mode']!='native-version-only' or type(config['binarySha256']) is not str or config['binarySha256']!=BB_SHA or type(config['binaryBytes']) is not int or config['binaryBytes']!=NATIVE_BYTES or type(config['expectedVersion']) is not str or config['expectedVersion']!=BB_VERSION:raise Invalid('Invalid native diagnostic pins')
    created,stop,commission=(timestamp(config[k]) for k in ('createdAt','budgetStop','commissioningStop'))
    now=now or dt.datetime.now(dt.timezone.utc)
    if not now-dt.timedelta(minutes=5)<=created<=now+dt.timedelta(minutes=5) or stop!=created+dt.timedelta(minutes=45) or commission!=created+dt.timedelta(minutes=30):raise Invalid('Invalid native diagnostic deadlines')
    native_binary_url(config['binaryUrl']);receipt_url(config['receiptPutUrl'])
    return dict(config)

NATIVE_CAPTURE = r'''
import hashlib, json, os, pathlib, selectors, signal, subprocess, time

def bounded_capture(args,seconds,limit=8192):
    # Fixed callers only. Stream, hash and discard bytes past the cap; no native
    # output or exception text enters evidence. Wall bound includes full pipes.
    captures={k:{'bytes':0,'sha256':hashlib.sha256(),'data':bytearray()} for k in ('stdout','stderr')}
    child=None;timed=False;reaped=False;code=None
    try:
        child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            start_new_session=True,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
        with selectors.DefaultSelector() as selector:
            for key,pipe in (('stdout',child.stdout),('stderr',child.stderr)):
                os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,key)
            deadline=time.monotonic()+seconds
            while selector.get_map():
                if time.monotonic()>=deadline:timed=True;break
                for key,_ in selector.select(min(.05,max(0,deadline-time.monotonic()))):
                    data=os.read(key.fileobj.fileno(),4096)
                    if not data:selector.unregister(key.fileobj);continue
                    row=captures[key.data];row['bytes']+=len(data);row['sha256'].update(data)
                    if len(row['data'])<limit:row['data'].extend(data[:limit-len(row['data'])])
            if not timed:
                try:code=child.wait(timeout=max(.001,deadline-time.monotonic()));reaped=True
                except subprocess.TimeoutExpired:timed=True
    finally:
        if child is not None:
            if child.poll() is None or timed:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            try:code=child.wait(timeout=2);reaped=True
            except subprocess.TimeoutExpired:pass
            for pipe in (child.stdout,child.stderr):
                if pipe is not None:pipe.close()
    summary={'started':child is not None,'timeout':timed,'reaped':reaped,'returnCode':code}
    for key,row in captures.items():summary[key]={'bytes':row['bytes'],'sha256':row['sha256'].hexdigest(),'truncated':row['bytes']>limit}
    return summary,{k:bytes(v['data']) for k,v in captures.items()}

def native_worker():
    output=pathlib.Path('/var/lib/rolling-native-version/result.json')
    # StateDirectory is disposable, but an acknowledged intent is never replayed.
    with open(output.parent/'intent.json','x') as file:
        file.write('{"schemaVersion":1,"attempts":1}');file.flush();os.fsync(file.fileno())
    directory=os.open(output.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
    result,raw=bounded_capture(['/opt/rolling-native-version/bb','--version'],15)
    result.update(schemaVersion=1,versionMatches=raw['stdout'].strip()==EXPECTED_VERSION.encode() and not result['stdout']['truncated'])
    with open(output,'x') as file:
        file.write(json.dumps(result,separators=(',',':')));file.flush();os.fsync(file.fileno())
    directory=os.open(output.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
'''

NATIVE_HOST = r'''
NATIVE_UNIT='rolling-native-version.service'
NATIVE_ROOT=pathlib.Path('/opt/rolling-native-version')

CPU_FLAGS=('sse4_2','avx','avx2','avx512f','bmi2','adx')

def native_read(path,limit):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('Guest file type')
        with os.fdopen(fd,'rb',closefd=False) as file:data=file.read(limit+1)
        if len(data)>limit:raise ValueError('Guest file limit')
        return data
    finally:os.close(fd)

def native_cpu(data):
    if type(data) is not bytes or len(data)>65536:raise ValueError('CPU limit')
    processors=[];flags=[];vendors=[]
    for block in data.decode('ascii').strip().split('\n\n'):
        fields={}
        for line in block.splitlines():
            key,separator,value=line.partition(':');key=key.strip()
            if key not in ('processor','vendor_id','flags'):continue
            if not separator or key in fields:raise ValueError('CPU fields')
            fields[key]=value.strip()
        if set(fields)!={'processor','vendor_id','flags'} or not re.fullmatch('[0-9]{1,4}',fields['processor']) or int(fields['processor'])>1023:raise ValueError('CPU record')
        index=int(fields['processor'])
        if index in processors or len(processors)>=8:raise ValueError('CPU count')
        tokens=fields['flags'].split()
        if not 1<=len(tokens)<=256 or any(not re.fullmatch('[a-z0-9_]{1,32}',value) for value in tokens):raise ValueError('CPU flags')
        processors.append(index);flags.append(set(tokens));vendors.append({'AuthenticAMD':'amd','GenuineIntel':'intel'}.get(fields['vendor_id'],'other'))
    if not processors:raise ValueError('CPU missing')
    common=set.intersection(*flags)
    return {'status':'observed','processors':len(processors),'vendor':vendors[0] if len(set(vendors))==1 else 'mixed','flags':{flag:flag in common for flag in CPU_FLAGS}}

def native_os(data):
    if type(data) is not bytes or len(data)>4096:raise ValueError('OS limit')
    fields={}
    for line in data.decode('utf-8').splitlines():
        key,separator,value=line.partition('=')
        if key not in ('ID','VERSION_ID'):continue
        if not separator or key in fields:raise ValueError('OS fields')
        fields[key]=value
    if set(fields)!={'ID','VERSION_ID'}:raise ValueError('OS missing')
    return {'status':'observed','ubuntu2404':fields['ID'] in ('ubuntu','"ubuntu"') and fields['VERSION_ID'] in ('24.04','"24.04"')}

def native_loader():
    # Fixed Ubuntu ELF interpreter path; following its trusted system symlink is
    # intentional. Never serialize its target or load a caller-selected library.
    path=pathlib.Path('/lib64/ld-linux-x86-64.so.2')
    return path.is_file() and os.access(path,os.X_OK)

def native_guest():
    facts={'status':'failed','architecture':'unavailable','libc':{'status':'transport-error'},'loaderAvailable':False,'os':{'status':'unavailable'},'cpu':{'status':'unavailable'}}
    try:facts['architecture']='x86_64' if platform.machine()=='x86_64' else 'other'
    except Exception:pass
    try:
        capture,raw=bounded_capture(['/usr/bin/getconf','GNU_LIBC_VERSION'],3,256)
        if not capture['timeout'] and capture['returnCode']==0 and capture['reaped']:
            match=None if capture['stdout']['truncated'] else re.fullmatch(rb'glibc ([0-9]{1,3})\.([0-9]{1,3})\n?',raw['stdout'])
            facts['libc']={'status':'observed','major':int(match[1]),'minor':int(match[2])} if match else {'status':'projection-error'}
    except Exception:pass
    try:facts['loaderAvailable']=bool(native_loader())
    except Exception:pass
    for name,path,limit,parser in [('cpu','/proc/cpuinfo',65536,native_cpu),('os','/usr/lib/os-release',4096,native_os)]:
        try:data=native_read(path,limit)
        except Exception:continue
        try:facts[name]=parser(data)
        except Exception:facts[name]={'status':'projection-error'}
    libc=facts['libc'];cpu=facts['cpu'];os_facts=facts['os']
    if facts['architecture']=='x86_64' and libc['status']=='observed' and (libc['major'],libc['minor'])>=(2,34) and facts['loaderAvailable'] and os_facts.get('ubuntu2404') is True and cpu.get('processors')==2 and cpu.get('vendor')=='amd':facts['status']='passed'
    return facts

def native_fetch(url,path):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise ValueError('Redirect rejected')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    deadline=time.monotonic()+60;total=0;sha=hashlib.sha256()
    # This is a public binary, but the source capability remains root-only.
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as file:
        with opener.open(urllib.request.Request(url,method='GET'),timeout=5) as response:
            if response.status!=200:raise ValueError('Binary transport')
            while True:
                if time.monotonic()>=deadline:raise TimeoutError('Binary deadline')
                block=response.read1(min(65536,BINARY_BYTES-total+1))
                if not block:break
                total+=len(block)
                if total>BINARY_BYTES:raise ValueError('Binary size')
                sha.update(block);file.write(block)
        if total!=BINARY_BYTES or sha.hexdigest()!=PINS['bb']:raise ValueError('Binary integrity')
        file.flush();os.fsync(file.fileno());os.fchmod(file.fileno(),0o555)
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)

def native_ordering(unit):
    if unit not in ('rolling-budget.timer',NATIVE_UNIT):raise ValueError('Invalid retention unit')
    capture,raw=bounded_capture(['systemctl','show',unit,'--property=Before,After'],3,4096)
    if capture['timeout'] or capture['returnCode']!=0 or not capture['reaped'] or capture['stdout']['truncated']:raise ValueError('Retention readback unavailable')
    fields={}
    for line in raw['stdout'].decode('ascii').splitlines():
        key,value=line.split('=',1)
        if key not in ('Before','After') or key in fields:raise ValueError('Invalid retention readback')
        names=value.split()
        if len(names)>128 or len(names)!=len(set(names)) or any(not re.fullmatch(r'[A-Za-z0-9_.:@\\-]{1,255}',name) for name in names):raise ValueError('Invalid retention dependencies')
        fields[key]=set(names)
    if set(fields)!={'Before','After'}:raise ValueError('Incomplete retention readback')
    return fields

def native_retain_execution():
    # A file-declared ordering edge also holds a reference. The already-active
    # timer retains this inactive service across --wait / show, without starting
    # it. Before follows the normal timer -> basic.target -> service ordering.
    # Neither timer deadline nor its activation/stop dependencies are changed.
    write('/etc/systemd/system/rolling-budget.timer.d/native-version-reference.conf',
          '[Unit]\nBefore='+NATIVE_UNIT+'\n',0o644)
    run(['systemctl','daemon-reload'],timeout=5)
    for timer in ('budget','commissioning'):
        run(['systemctl','is-active','--quiet','rolling-'+timer+'.timer'],timeout=3)
    timer=native_ordering('rolling-budget.timer');service=native_ordering(NATIVE_UNIT)
    if NATIVE_UNIT not in timer['Before'] or NATIVE_UNIT in timer['After'] or 'rolling-budget.timer' not in service['After'] or 'rolling-budget.timer' in service['Before']:
        raise ValueError('Retention ordering mismatch')

def native_state():
    try:
        capture,raw=bounded_capture(['systemctl','show',NATIVE_UNIT,'--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,ExecMainStartTimestampMonotonic'],3,4096)
    except Exception:return {'status':'transport-error'}
    if capture['timeout'] or capture['returnCode']!=0 or not capture['reaped']:return {'status':'transport-error'}
    try:
        if capture['stdout']['truncated']:raise ValueError()
        fields={}
        for line in raw['stdout'].decode('ascii').splitlines():
            key,value=line.split('=',1)
            if key in fields:raise ValueError()
            fields[key]=value
        if set(fields)!={'ActiveState','SubState','Result','ExecMainCode','ExecMainStatus','ExecMainStartTimestampMonotonic'}:raise ValueError()
        allowed={'ActiveState':('active','inactive','failed','activating','deactivating'),
                 'SubState':('running','dead','failed','start','stop','stop-sigterm','stop-sigkill','exited'),
                 'Result':('success','exit-code','signal','core-dump','timeout','oom-kill','resources','start-limit-hit','protocol')}
        if any(fields[key] not in values for key,values in allowed.items()):raise ValueError()
        nums={}
        for key,maximum in [('ExecMainCode',6),('ExecMainStatus',255),('ExecMainStartTimestampMonotonic',2**63-1)]:
            if not re.fullmatch('[0-9]{1,19}',fields[key]) or int(fields[key])>maximum:raise ValueError()
            nums[key]=int(fields[key])
        return {'status':'observed',**{k:fields[k] for k in allowed},**nums}
    except Exception:return {'status':'projection-error'}

def native_result(value):
    expected={'schemaVersion','started','timeout','reaped','returnCode','stdout','stderr','versionMatches'}
    if type(value) is not dict or set(value)!=expected or type(value['schemaVersion']) is not int or value['schemaVersion']!=1:raise ValueError('Invalid version result')
    if any(type(value[k]) is not bool for k in ('started','timeout','reaped','versionMatches')):raise ValueError('Invalid version flags')
    if value['returnCode'] is not None and (type(value['returnCode']) is not int or not -255<=value['returnCode']<=255):raise ValueError('Invalid version status')
    for key in ('stdout','stderr'):
        row=value[key]
        if type(row) is not dict or set(row)!={'bytes','sha256','truncated'} or type(row['bytes']) is not int or not 0<=row['bytes']<=2**53-1 or type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}',row['sha256']) or type(row['truncated']) is not bool or row['truncated']!=(row['bytes']>8192):raise ValueError('Invalid output projection')
    return json.loads(json.dumps(value))

def native_classify(state,result):
    if state['status']!='observed':return 'state-unreadable'
    if state['Result']=='oom-kill':return 'oom'
    if state['Result']=='timeout' or result and result['timeout']:return 'timeout'
    if state['Result'] in ('signal','core-dump') or result and result['returnCode'] is not None and result['returnCode']<0:return 'signal'
    if state['Result']=='exit-code' or result and result['returnCode'] not in (None,0):return 'nonzero'
    if state['ActiveState']=='active':return 'started'
    if result and result['started'] and result['reaped'] and result['returnCode']==0 and result['versionMatches'] and not result['stdout']['truncated'] and not result['stderr']['truncated'] and state['Result']=='success' and state['ActiveState']=='inactive' and state['ExecMainCode']==1 and state['ExecMainStatus']==0 and state['ExecMainStartTimestampMonotonic']>0:return 'passed'
    return 'unqualified'

def native_shutdown():
    try:run(['systemctl','start','rolling-budget.service'],timeout=5)
    except Exception:
        try:run(['/usr/sbin/poweroff'],timeout=5)
        except Exception:pass

def native_execute(config,worker):
    receipt={'schemaVersion':1,'mode':'native-version-only','passed':False,'nodeStartupQualified':False,'proofJobs':0,
             'binarySha256':PINS['bb'],'binaryBytes':BINARY_BYTES,'expectedVersion':PINS['bbVersion'],
             'controlSourceSha256':PINS['bootstrap'],'workerSha256':hashlib.sha256(worker.encode()).hexdigest(),
             'budgetStop':config['budgetStop'],'commissioningStop':config['commissioningStop'],
             'stage':'host-preflight','state':{'status':'not-observed'},'resultStatus':'not-observed','guestPreflight':{'status':'not-observed'}}
    lock=None
    try:
        if platform.system()!='Linux' or platform.machine()!='x86_64' or os.geteuid()!=0:raise ValueError('Native host required')
        BASE.mkdir(mode=0o700,parents=True,exist_ok=True);PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
        lock=open(BASE/'native-writer.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # Existing controls use these names as immutable artifact identities; in
        # this closed mode they mean binary and control-source, not an archive.
        controls={**config,'runtimeArchiveSha256':PINS['bb'],'manifestSha256':PINS['bootstrap']}
        receipt['stage']='controls';install_controls(controls)
        for timer in ('budget','commissioning'):run(['systemctl','is-active','--quiet','rolling-'+timer+'.timer'],timeout=3)
        verify_controls();receipt['controlsVerified']=True
        exclusive_record(PRIVATE/'receipt-put.json',{'url':receipt_url(config['receiptPutUrl'])})
        exclusive_record(BASE/'native-intent.json',{'schemaVersion':1,'binarySha256':PINS['bb'],'controlSourceSha256':PINS['bootstrap'],'attempts':1})
        receipt['stage']='guest-preflight';receipt['guestPreflight']=native_guest()
        if receipt['guestPreflight']['status']!='passed':raise ValueError('Guest preflight failed')
        receipt['stage']='download';NATIVE_ROOT.mkdir(mode=0o755,parents=True,exist_ok=False)
        # The private bootstrap umask is 077. Only this newly owned directory
        # contains public bytes; DynamicUser needs traversal to read capture.py.
        directory=os.open(NATIVE_ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fchmod(directory,0o755);os.fsync(directory)
        finally:os.close(directory)
        native_fetch(config['binaryUrl'],NATIVE_ROOT/'bb')
        write(NATIVE_ROOT/'capture.py',worker,0o444)
        unit='[Unit]\nDescription=Closed public binary version diagnostic\nAfter=rolling-egress.service\n[Service]\nType=exec\nDynamicUser=yes\nStateDirectory=rolling-native-version\nStateDirectoryMode=0700\nExecStart=/usr/bin/python3 /opt/rolling-native-version/capture.py\nRestart=no\nRuntimeMaxSec=20s\nTimeoutStopSec=2s\nKillMode=control-group\nMemoryMax=512M\nMemorySwapMax=0\nCPUQuota=200%\nTasksMax=64\nUMask=0077\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nPrivateNetwork=yes\nIPAddressDeny=any\nPrivateTmp=yes\nPrivateDevices=yes\nProtectSystem=strict\nProtectHome=yes\nProtectKernelTunables=yes\nProtectControlGroups=yes\nRestrictSUIDSGID=yes\nInaccessiblePaths=/var/lib/rolling-bootstrap-private /var/lib/cloud\nStandardOutput=null\nStandardError=null\n'
        write('/etc/systemd/system/'+NATIVE_UNIT,unit,0o644);native_retain_execution()
        receipt['stage']='version'
        try:run(['systemctl','start','--wait',NATIVE_UNIT],timeout=25)
        except Exception:pass # Exact state/result observed before stopping, never retry.
        receipt['state']=native_state();result=None
        try:result=native_result(read_bounded_json(pathlib.Path('/var/lib/rolling-native-version/result.json')));receipt['resultStatus']='observed';receipt['result']=result
        except FileNotFoundError:receipt['resultStatus']='absent'
        except Exception:receipt['resultStatus']='invalid-or-unreadable'
        receipt['outcome']=native_classify(receipt['state'],result);receipt['passed']=receipt['outcome']=='passed'
        receipt['stage']='complete'
    except Exception:
        receipt['outcome']='precondition-or-io-failure'
    finally:
        try:
            # Receipt is bounded before any publication; no raw capability, args,
            # native output, response or exception is retained.
            data=json.dumps(receipt,separators=(',',':')).encode()
            if len(data)>8192:raise ValueError('Native receipt limit')
            exclusive_record(BASE/'native-final.json',receipt)
            emit_diagnostic(b'ROLLING_NATIVE_VERSION '+data+b'\n')
            upload_receipt(data)
        finally:
            native_shutdown()
            if lock is not None:lock.close()
'''

def generate_native(config,now=None):
    config=validate_native(config,now)
    controls=native_control_source()
    runtime=controls+NATIVE_CAPTURE+NATIVE_HOST
    worker='EXPECTED_VERSION = '+repr(BB_VERSION)+'\n'+NATIVE_CAPTURE+'\nnative_worker()\n'
    pins={'bb':BB_SHA,'bbVersion':BB_VERSION,'bootstrap':hashlib.sha256(runtime.encode()).hexdigest()}
    source='PINS = '+repr(pins)+'\nBINARY_BYTES = '+repr(NATIVE_BYTES)+'\n'+runtime
    program='SOURCE = '+repr(source)+'\nWORKER = '+repr(worker)+'\nCONFIG = '+repr(config)+'\nexec(SOURCE)\ntry:\n    native_execute(CONFIG,WORKER)\nexcept BaseException:\n    sys.exit(1)\n'
    encoded=base64.b64encode(lzma.compress(program.encode(),format=lzma.FORMAT_ALONE,filters=[{'id':lzma.FILTER_LZMA1,'preset':6,'pb':0}])).decode()
    return "#!/bin/sh\nset -eu\numask 077\nexec /usr/bin/python3 - <<'B'\nimport base64,lzma\nexec(lzma.decompress(base64.b64decode('"+encoded+"')))\nB\n"


def private_file(path):
    path = pathlib.Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.getuid() or info.st_size>16384:
            raise Invalid('Input must be an owner-only bounded regular file')
        with os.fdopen(fd,'r',closefd=False) as f: return json.load(f)
    finally: os.close(fd)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--native-version-only',action='store_true')
    args=parser.parse_args()
    try:
        output=pathlib.Path(args.output).absolute()
        repo=pathlib.Path(__file__).resolve().parents[2]
        if output.resolve().is_relative_to(repo) or output.parent.resolve()!=output.parent or pathlib.Path(args.config).resolve().is_relative_to(repo): raise Invalid('Private inputs and outputs must be outside checkout')
        info=output.parent.stat()
        if stat.S_IMODE(info.st_mode)!=0o700 or info.st_uid!=os.getuid(): raise Invalid('Private output directory required')
        generator=generate_native if args.native_version_only else generate
        body=gzip.compress(generator(private_file(args.config)).encode(),mtime=0)
        if len(body)>16384: raise Invalid('Compressed user data exceeds AWS limit')
        fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as f: f.write(body);f.flush();os.fsync(f.fileno())
        fd=os.open(output.parent,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        print(json.dumps({'generated':True,'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}))
    except Exception:
        print('Bootstrap generation failed; inspect private inputs locally.',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    if sys.argv[1:2] in (['--node-wrapper'],['--startup-observation']):
        try:
            base=pathlib.Path('/var/lib/rolling-bootstrap')
            if sys.argv[1]=='--startup-observation':print(json.dumps(node_startup_observation(base)));sys.exit(0)
            code=node_wrapper(sys.argv[2:],base)
            if code<0:signal.signal(-code,signal.SIG_DFL);os.kill(os.getpid(),-code)
            sys.exit(code)
        except Exception:sys.exit(1)
    sys.exit(main())
