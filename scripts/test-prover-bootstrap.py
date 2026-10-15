"""Development unit tests; no Linux services, cloud calls, or proof jobs are run."""
import os, shutil, base64, datetime as dt, gzip, hashlib, importlib.util, io, json, lzma, pathlib, subprocess, sys, tarfile, tempfile, unittest
from unittest.mock import patch

if sys.version_info < (3,12):
    raise SystemExit('Bootstrap tests require Python 3.12+ with the tarfile data extraction filter.')

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bootstrap',ROOT/'deploy/prover/bootstrap.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
NOW=dt.datetime(2026,10,11,18,0,tzinfo=dt.timezone.utc)
def config():
    return dict(createdAt='2026-10-11T18:00:00Z',budgetStop='2026-10-12T02:00:00Z',commissioningStop='2026-10-11T18:30:00Z',
                runtimeUrl='https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/releases/test/runtime.tar.gz?X-Amz-Signature=PRIVATE_SENTINEL',
                runtimeArchiveSha256='a'*64,manifestSha256='b'*64)
def fixture_generate(config,now):
    # Labelled payload-only fixture: no active native qualification is fabricated
    # in the repository. Actual generation rejection is tested separately below.
    with patch.object(b,'require_linux_qualification',return_value={'version':b.BB_VERSION,'sha256':b.BB_SHA}):
        return b.generate(config,now)

def host(diagnostic_devices=False, packaged_support=False):
    ns={'PINS':{'manifest':'b'*64,'node':b.NODE_SHA,'bb':b.BB_SHA,'bbVersion':b.BB_VERSION,'catalog':b.CATALOG_SHA,'image':b.IMAGE},'NETWORK':b.NETWORK,'QUALIFICATION':b.QUALIFICATION}
    exec(b.HOST,ns)
    if packaged_support:
        ns['RELEASE']=ROOT
        ns['PINS']['startup']=hashlib.sha256(pathlib.Path(b.__file__).read_bytes()).hexdigest()
    if not diagnostic_devices:ns['emit_diagnostic']=lambda data:None # never write Mac device output
    return ns

def ready_fixture():
    scope=b.QUALIFICATION['service']
    return {'ready':True,'chainId':scope['chainId'],'rollupVersion':scope['rollupVersion'],'rollupAddress':scope['queryNode']['rollupAddress'],'proofsEnabled':True,
            'latestBlockNumber':100,'latestBlockHash':'0x'+'a'*64,'checkpointedBlockNumber':99,'finalizedBlockNumber':98,'oldestHistoricBlockNumber':0,
            'syncedL1Timestamp':'1791741600','checkedAtSeconds':1791741630,'lagSeconds':30}
def qualifier_fixture():
    scope=b.QUALIFICATION['service']
    anchor={'ready':True,'blockNumber':99,'blockHash':'0x'+'b'*64}
    checks={k:{'rejected':True} for k in ('wrong-chain','wrong-version','wrong-rollup','proof-config-floor')}
    checks.update(healthy=anchor,recovered=anchor,nativeAndRollingCatalog={'passed':True,'circuitCount':16},missingHelper={'missingHelperRejected':True},manifestUnchanged=True,
                  noProofLifecycle={'passed':True,'proofEndpointsDisabled':True,'queueAllocated':False,'workerAllocated':False},
                  freshness={k:True for k in ('paused','stale','queriesRejected','resumed','recovered')})
    return {'schemaVersion':1,'passed':True,'stage':'complete','checks':checks,'cleanup':{k:True for k in ('serviceClosed','temporaryFilesRemoved','childProcessesExited')},
            'release':{'manifestSha256':'b'*64},'proofJobs':0,
            'publicScope':{'chainId':scope['chainId'],'version':scope['rollupVersion'],'rollup':scope['queryNode']['rollupAddress'],'serviceMode':'query-only','nodeProofs':'real','maxLagSeconds':120}}

class Bootstrap(unittest.TestCase):
    def test_unqualified_linux_never_generates_payload_and_requires_exact_active_pin(self):
        original=b.require_linux_qualification
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);file=root/'toolchain.json'
            good={'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':b.BB_SHA}}}
            for pins in [{}, {'nativeProverPackage':b.BB_VERSION,'nativeProverHistory':good['nativeProver']},
                         {**good,'nativeProverPackage':'6.0.0-rc.1'},
                         {**good,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':'0'*64}}},
                         {**good,'nativeProver':{'linux-x64':{'version':'6.0.0-rc.1','sha256':b.BB_SHA}}}]:
                file.write_text(json.dumps(pins))
                with patch.object(b,'require_linux_qualification',side_effect=lambda:original(root)),patch.object(b.lzma,'compress') as compressed:
                    with self.assertRaisesRegex(b.Invalid,'^Active Linux prover qualification required$'):b.generate(config(),NOW)
                    compressed.assert_not_called()
            file.write_text(json.dumps(good))
            self.assertEqual(original(root),good['nativeProver']['linux-x64'])

    def test_query_qualification_requires_exact_scope_and_absent_proof_lifecycle(self):
        ns=host(packaged_support=True);report=qualifier_fixture()
        self.assertTrue(all(ns['qualification_projection'](report,True).values()))
        for value in [None,{},True,{'passed':True,'proofEndpointsDisabled':True,'queueAllocated':0,'workerAllocated':False},
                      {**report['checks']['noProofLifecycle'],'queueAllocated':True},
                      {**report['checks']['noProofLifecycle'],'extra':'PRIVATE_SENTINEL'}]:
            report=qualifier_fixture();report['checks']['noProofLifecycle']=value
            self.assertFalse(ns['qualification_projection'](report,True)['noProofLifecycle'])
        report=qualifier_fixture();report['publicScope']['board']='0x'+'1'*64
        self.assertFalse(ns['qualification_projection'](report,True)['scope'])
        self.assertEqual(b.QUALIFICATION['service']['serviceMode'],'query-only')
        self.assertFalse({'board','applicationProfile','privateFeeAddress','queueDirectory','threads'} & set(b.QUALIFICATION['service']))

    def test_packaged_qualification_helpers_require_exact_source_before_execution(self):
        with tempfile.TemporaryDirectory() as t:
            ns=host();ns['RELEASE']=pathlib.Path(t)
            source=ns['RELEASE']/'deploy/prover/bootstrap.py';source.parent.mkdir(parents=True)
            exact=pathlib.Path(b.__file__).read_bytes();ns['PINS']['startup']=hashlib.sha256(exact).hexdigest()
            report=qualifier_fixture();calls=[lambda:ns['qualification_projection'](report,True),lambda:ns['qualification_anchors'](report['checks'])]
            for call in calls:
                with self.assertRaises(FileNotFoundError):call()
            source.write_bytes(exact)
            self.assertTrue(all(calls[0]().values()))
            self.assertEqual(calls[1](),{k:{'blockNumber':99,'blockHash':'0x'+'b'*64} for k in ('healthy','recovered')})
            for value in (True,-1,2**53,'99'):
                invalid=qualifier_fixture()['checks'];invalid['healthy']={**invalid['healthy'],'blockNumber':value}
                with self.assertRaisesRegex(ValueError,'Invalid qualification anchor'):ns['qualification_anchors'](invalid)
            source.write_bytes(exact+b'\nraise AssertionError("unverified source executed")\n')
            for call in calls:
                with self.assertRaisesRegex(ValueError,'Activation source changed'):call()

    def test_current_reviewed_catalog_matches_bootstrap_pin(self):
        # A newly packaged profile catalog must not reach a paid host with the
        # historical catalog pin. The immutable runtime validator still rejects
        # substituted bytes; updates require explicit source review.
        catalog=ROOT/'prover/rolling-artifacts.json'
        self.assertEqual(hashlib.sha256(catalog.read_bytes()).hexdigest(),b.CATALOG_SHA)

    def test_valid_input_frozen_and_bounded_userdata_shell_syntax(self):
        c=config();text=fixture_generate(c,NOW)
        self.assertEqual(c,config());self.assertNotIn('PRIVATE_SENTINEL',text)
        self.assertLess(len(gzip.compress(text.encode(),mtime=0)),16384)
        subprocess.run(['/bin/sh','-n'],input=text,text=True,check=True)
        encoded=text.split("base64.b64decode('")[1].split("')")[0]
        source=lzma.decompress(base64.b64decode(encoded)).decode();compile(source,'generated','exec')
        self.assertIn('PRIVATE_SENTINEL',source) # private artifact, never public evidence
        self.assertNotIn('PRIVATE_SENTINEL',source.split('ATTESTATION = ')[1])

    def test_alone_encoding_preserves_exact_program_and_executes_real_wrapper(self):
        # Encoding comparison uses the same source hash and config. Only the
        # final host entry is a labelled stub; no cloud or host operation runs.
        compressor=lzma.compress;captured=[]
        def legacy_encoding(data,**kwargs):
            captured.append(data)
            return compressor(data,preset=6)
        c=config()
        with patch.object(b.lzma,'compress',side_effect=legacy_encoding):legacy=fixture_generate(c,NOW)
        current=fixture_generate(c,NOW)
        def decode(text):
            encoded=text.split("base64.b64decode('")[1].split("')")[0]
            return lzma.decompress(base64.b64decode(encoded))
        self.assertEqual(decode(current),decode(legacy));self.assertEqual(decode(current),captured[0])
        # Exercise the actual new shell/Python wrapper, rather than only its
        # decompressor. Replace exactly the final entry in its decoded payload.
        program=decode(current)
        self.assertEqual(program.count(b'\nexecute(CONFIG, ATTESTATION)\n'),1)
        harmless=program.replace(b'\nexecute(CONFIG, ATTESTATION)\n',b'\nprint("WRAPPER_DEFINITIONS_READY")\n')
        encoded=current.split("base64.b64decode('")[1].split("')")[0]
        replacement=base64.b64encode(compressor(harmless,format=lzma.FORMAT_ALONE,
            filters=[{'id':lzma.FILTER_LZMA1,'preset':6,'pb':0}])).decode()
        wrapper=current.replace(encoded,replacement)
        result=subprocess.run(['/bin/sh'],input=wrapper,text=True,capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,'WRAPPER_DEFINITIONS_READY\n')
        self.assertEqual(result.stderr,'');self.assertNotIn('PRIVATE_SENTINEL',result.stdout)
        self.assertIn('set -eu\numask 077\n',wrapper)

    def test_malicious_inputs_rejected_without_echo(self):
        bad=[('runtimeUrl','https://evil.example/releases/runtime.tar.gz'),('runtimeUrl',config()['runtimeUrl']+'\n$(id)'),
             ('runtimeUrl','https://user:pass@anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/releases/a.tar.gz'),
             ('runtimeUrl','https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/releases/../a.tar.gz'),
             ('runtimeArchiveSha256','a'*63+';'),('manifestSha256',None),('budgetStop','2026-10-12T02:00:01Z'),
             ('commissioningStop','2026-10-11T18:31:00Z'),('createdAt','2026-10-11T15:00:00Z'),('budgetStop','tomorrow; poweroff')]
        for key,value in bad:
            with self.subTest(key=key,value=value):
                c=config();c[key]=value
                with self.assertRaises(b.Invalid) as e:fixture_generate(c,NOW)
                self.assertNotIn('PRIVATE_SENTINEL',str(e.exception))
        c=config();c['command']='id'
        with self.assertRaises(b.Invalid):fixture_generate(c,NOW)

    def test_bucket_region_binding_and_redirect_rejection(self):
        actual=config();self.assertEqual(b.validate(actual,NOW),actual)
        wrong=config();wrong['runtimeUrl']=wrong['runtimeUrl'].replace('.s3.eu-west-2.','.s3.us-east-1.')
        with self.assertRaises(b.Invalid):b.validate(wrong,NOW)
        # Labelled transport fake: invoke the actual NoRedirect handler with the
        # observed S3 wrong-region301 shape. No network, redirect follow or retry.
        ns=host();calls=[]
        class Opener:
            def __init__(self,handler):self.handler=handler
            def open(self,url,**kwargs):
                calls.append(url)
                return self.handler.redirect_request(None,None,301,'Moved',{'x-amz-bucket-region':'eu-west-2'},actual['runtimeUrl'])
        with tempfile.TemporaryDirectory() as t,patch.object(ns['urllib'].request,'build_opener',side_effect=lambda handler:Opener(handler)):
            destination=pathlib.Path(t)/'archive.tar.gz'
            with self.assertRaisesRegex(ValueError,'^Redirect rejected$'):ns['fetch_package'](wrong['runtimeUrl'],destination)
            self.assertEqual(calls,[wrong['runtimeUrl']]);self.assertFalse(destination.exists())

    def test_deadline_cannot_be_extended_or_package_replaced(self):
        ns=host()
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t)
            # Dates far enough ahead for the host's clock; generator checks launch freshness separately.
            c=config();c['budgetStop']='2099-10-12T02:00:00Z'
            ns['immutable_deadline'](c);ns['immutable_deadline'](c)
            for key,value in [('budgetStop','2100-10-12T02:00:00Z'),('runtimeArchiveSha256','c'*64),('manifestSha256','d'*64)]:
                changed=dict(c,**{key:value})
                with self.assertRaises(ValueError):ns['immutable_deadline'](changed)
                self.assertEqual(json.loads((pathlib.Path(t)/'deadline.json').read_text())['budgetStop'],c['budgetStop'])

    def test_corrupt_archive_never_extracts(self):
        ns=host()
        with tempfile.TemporaryDirectory() as t:
            archive=pathlib.Path(t)/'bad.tar.gz';archive.write_bytes(b'corrupt')
            target=pathlib.Path(t)/'target'
            with self.assertRaises(ValueError):ns['extract_verified'](archive,target,'0'*64)
            self.assertFalse(target.exists())

    def test_archive_external_path_rejected_before_any_execution(self):
        ns=host();called=[];ns['verify_release']=lambda _:called.append('verify')
        with tempfile.TemporaryDirectory() as t:
            archive=pathlib.Path(t)/'bad.tar.gz'
            with tarfile.open(archive,'w:gz') as tar:
                entry=tarfile.TarInfo('../outside');entry.size=1;tar.addfile(entry,io.BytesIO(b'x'))
            with self.assertRaises(tarfile.FilterError):ns['extract_verified'](archive,pathlib.Path(t)/'target',ns['digest'](archive))
            self.assertFalse((pathlib.Path(t)/'outside').exists());self.assertEqual(called,[])

    def test_manifest_all_files_hashes_and_native_pins(self):
        ns=host()
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);files={}
            paths=['node/bin/node','node_modules/@aztec-foundation/bb.js/build/amd64-linux/bb','prover/rolling-artifacts.json']
            for rel in paths:
                p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(rel.encode());files[rel]=ns['digest'](p)
            native={'version':b.BB_VERSION,'sha256':files[paths[1]]}
            (root/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':native}}))
            files['toolchain.json']=ns['digest'](root/'toolchain.json')
            m={'platform':'linux-x64','applicationProfile':'rolling','files':files}
            (root/'prover-release.json').write_text(json.dumps(m));ns['PINS']={'manifest':ns['digest'](root/'prover-release.json'),'bbVersion':b.BB_VERSION,**dict(zip(['node','bb','catalog'],files.values()))}
            ns['verify_release'](root)
            original=(root/'toolchain.json').read_bytes()
            (root/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{}}))
            files['toolchain.json']=ns['digest'](root/'toolchain.json');(root/'prover-release.json').write_text(json.dumps(m))
            ns['PINS']['manifest']=ns['digest'](root/'prover-release.json')
            with self.assertRaisesRegex(ValueError,'Unqualified Linux prover'):ns['verify_release'](root)
            (root/'toolchain.json').write_bytes(original);files['toolchain.json']=ns['digest'](root/'toolchain.json')
            (root/'prover-release.json').write_text(json.dumps(m));ns['PINS']['manifest']=ns['digest'](root/'prover-release.json')
            (root/paths[0]).write_text('tampered')
            with self.assertRaises(ValueError):ns['verify_release'](root)
            (root/paths[0]).write_bytes(paths[0].encode());(root/'extra').write_text('unmanifested')
            with self.assertRaises(ValueError):ns['verify_release'](root)

    def test_actual_control_install_order_and_persistent_absolute_timers(self):
        ns=host();events=[];written={}
        ns['immutable_deadline']=lambda _:events.append('deadline')
        ns['write']=lambda p,s,*args:written.update({str(p):s})
        def run(args,**kw):
            events.append(args)
            if args[:4]==['ip','-j','route','show']:return '[{"dev":"ens5"}]'
        ns['run']=run;ns['verify_controls']=lambda:events.append('verified')
        ns['install_controls'](config())
        self.assertEqual(events[0],'deadline');self.assertEqual(events[-1],'verified')
        timer=written['/etc/systemd/system/rolling-budget.timer']
        self.assertIn('OnCalendar=2026-10-12 02:00:00 UTC',timer);self.assertIn('Persistent=true',timer)
        self.assertIn('rate 50mbit ceil 50mbit',written['/usr/local/sbin/rolling-egress'])
        self.assertTrue(any(e[:2]==['systemctl','mask'] for e in events if type(e)==list))
        self.assertFalse(any('curl' in e or 'docker' in e for e in events if type(e)==list))

    def test_noble_source_derived_class_fixture_and_mandatory_accounting(self):
        # Source-derived, NOT Linux-captured. Noble 6.1.0 tc_class.c:347-375,
        # q_htb.c:292-330, tc_util.c:671-725, sch_htb.c:htb_dump_class.
        ns=host()
        fixture = """class htb 1:1 root rate 50Mbit ceil 50Mbit burst 1Mb cburst 1Mb
 Sent 123456789012 bytes 1234 pkt (dropped 0, overlimits 56 requeues 0)
 backlog 0b 0p requeues 0
 lended: 12 borrowed: 0 giants: 0
 tokens: -43 ctokens: 22
class htb 1:10 parent 1:1 prio 0 rate 25Mbit ceil 50Mbit burst 4725b cburst 7850b
 Sent 123456789000 bytes 1233 pkt (dropped 0, overlimits 0 requeues 0)
 backlog 0b 0p requeues 0
 lended: 12 borrowed: 0 giants: 0
 tokens: 120 ctokens: 220
class htb 1:20 parent 1:1 prio 0 rate 25Mbit ceil 50Mbit burst 4725b cburst 7850b
 Sent 12 bytes 1 pkt (dropped 0, overlimits 0 requeues 0)
 backlog 0b 0p requeues 0
 lended: 0 borrowed: 1 giants: 0
 tokens: 1 ctokens: 2"""
        self.assertEqual(ns['class_bytes'](fixture),123456789012)
        self.assertEqual(ns['class_bytes'](fixture.replace('123456789012 bytes','0 bytes')),0)
        self.assertEqual(ns['class_bytes'](fixture.replace('parent 1:1 prio','parent 1:1 leaf 8001: prio',1)),123456789012)
        invalid=[fixture.replace('rate 50Mbit','rate 100Mbit',1), fixture.replace('ceil 50Mbit','ceil 100Mbit',1),
                 fixture.replace('class htb 1:1 root','class htb 1:1 parent 1:1'),
                 fixture.replace('1:20 parent 1:1','1:20 root'),fixture.replace('1:20','1:10'),
                 fixture[:fixture.index('class htb 1:20')],fixture+"\n"+fixture,
                 fixture.replace(' Sent 123456789012 bytes 1234 pkt (dropped 0, overlimits 56 requeues 0)\n',''),
                 fixture.replace('123456789012 bytes','18446744073709551616 bytes'),
                 fixture.replace('123456789012 bytes','-1 bytes'),fixture.replace('123456789012 bytes','null bytes'),
                 '[{"class":"htb","handle":"1:1","rate":6250000,"ceil":6250000}]']
        for sample in invalid:
            with self.subTest(sample=sample[:90]),self.assertRaises(ValueError):ns['class_bytes'](sample)
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);(pathlib.Path(t)/'interface').write_text('ens5')
            (pathlib.Path(t)/'deadline.json').write_text(json.dumps({'budgetStop':'2099-01-01T00:00:00Z','hostResources':{'dataVolumeGiB':1024,'egressMbps':50}}))
            values={'class':fixture,'version':'tc utility, iproute2-6.1.0, libbpf 1.3.0','package':'6.1.0-1ubuntu6.4',
                    'qdisc':[{'kind':'htb','handle':'1:','root':True,'refcnt':2,
                              'options':{'r2q':10,'default':'0x10','direct_packets_stat':0,'direct_qlen':1000}}]}
            calls=[]
            def run(args,**kw):
                calls.append(args)
                if args==['tc','-V']:return values['version']
                if args[0]=='dpkg-query':return values['package']
                if 'class' in args:return values['class']
                if 'qdisc' in args:return json.dumps(values['qdisc'])
            ns['run']=run;self.assertEqual(ns['verify_controls'](),123456789012)
            self.assertIn(['tc','-s','class','show','dev','ens5'],calls)
            original=json.loads(json.dumps(values))
            for key,bad in [('version','tc utility, iproute2-6.14.0'),('package','6.1.0-1ubuntu6.5'),
                            ('class',invalid[0]),('qdisc',[]),('qdisc',[{'kind':'htb','handle':'1:','root':True}]),
                            ('qdisc',original['qdisc']*2),('qdisc',[dict(original['qdisc'][0],options={'default':'0x20'})])]:
                values.update(original);values[key]=bad
                with self.subTest(key=key),self.assertRaises(ValueError):ns['verify_controls']()
                self.assertEqual(ns['STEP'],{'version':'tc-version','package':'tc-package','class':'tc-class-parse','qdisc':'tc-qdisc-parse'}[key])

    def test_fail_closed_pipeline_controls_before_download_no_retry(self):
        ns=host();events=[]
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);ns['RELEASE']=pathlib.Path(t)/'release'
            ns['install_controls']=lambda _:events.append('controls');ns['verify_controls']=lambda:0
            ns['install_attestation']=lambda _:events.append('attestation')
            def fetch(*_):events.append('download');raise ValueError('PRIVATE_SENTINEL')
            ns['fetch_package']=fetch;ns['attest']=lambda:events.append('safe-attestation')
            ns['run']=lambda args,**kw:events.append(args)
            with patch.object(ns['platform'],'system',return_value='Linux'), patch.object(ns['platform'],'machine',return_value='x86_64'), patch.object(ns['os'],'geteuid',return_value=0):
                with self.assertRaises(SystemExit):ns['execute'](config(),'static')
            self.assertEqual(events[:3],['controls','attestation','download'])
            self.assertEqual(events.count('download'),1)
            self.assertIn(['systemctl','start','rolling-budget.service'],events)
            self.assertEqual((pathlib.Path(t)/'stage').read_text(),'failed')

    def test_actual_node_unit_maps_admin_and_rpc_to_loopback_only(self):
        ns=host();writes={};calls=[]
        ns['prepare_data']=lambda:None;ns['verify_controls']=lambda:0
        ns['write']=lambda p,s,*_:writes.update({str(p):s})
        ns['public_ip']=lambda:'203.0.113.10'
        ns['prepare_admin_key']=lambda:'a'*64
        ns['run']=lambda args,**kw:calls.append(args)
        with patch.object(ns['shutil'],'which',return_value='/usr/bin/docker'):
            ns['install_node']()
        unit=writes['/etc/systemd/system/rolling-node.service']
        command=next(line for line in unit.splitlines() if line.startswith('ExecStart='))
        import shlex
        args=shlex.split(command.removeprefix('ExecStart='))
        mappings=[args[i+1] for i,arg in enumerate(args) if arg=='-p']
        self.assertEqual(mappings,['127.0.0.1:8082:8080','127.0.0.1:8882:8880','40400:40400/tcp','40400:40400/udp'])
        self.assertEqual(args[:3],['/usr/bin/python3',str(ns['RELEASE']/'deploy/prover/bootstrap.py'),'--node-wrapper'])
        self.assertEqual(args[3:5],['/usr/bin/docker','run'])
        self.assertIn('ExecStop=/usr/bin/docker stop -t 30 rolling-node',unit)
        self.assertIn('Restart=no',unit);self.assertIn('TimeoutStopSec=45',unit)
        self.assertIn('AZTEC_ADMIN_API_KEY_HASH='+'a'*64,args)
        self.assertNotIn('qualification-key',command)
        self.assertNotIn('AZTEC_DISABLE_ADMIN_API_KEY',command)
        self.assertNotIn('/var/run/docker.sock',command)
        self.assertNotIn('--privileged',args)
        # Labelled generated-unit test: ordinary/history and debug are explicit,
        # single endpoints. No automatic fallback or permissive validation.
        environment=[args[i+1] for i,arg in enumerate(args) if arg=='-e']
        keys=[item.split('=',1)[0] for item in environment]
        self.assertEqual(len(keys),len(set(keys)))
        env=dict(item.split('=',1) for item in environment)
        self.assertEqual(env['ETHEREUM_HOSTS'],'https://sepolia.gateway.tenderly.co')
        self.assertEqual(env['ETHEREUM_DEBUG_HOSTS'],'https://ethereum-sepolia-rpc.publicnode.com')
        self.assertEqual(env['L1_CONSENSUS_HOST_URLS'],'https://ethereum-sepolia-beacon-api.publicnode.com')
        self.assertEqual(env['ETHEREUM_ALLOW_NO_DEBUG_HOSTS'],'false')
        self.assertEqual(env['BLOB_ALLOW_EMPTY_SOURCES'],'false')
        self.assertEqual(env['PROVER_REAL_PROOFS'],'true')

    def test_controls_failure_never_downloads_and_requests_shutdown(self):
        ns=host();events=[]
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);ns['RELEASE']=pathlib.Path(t)/'release'
            def fail(_): raise ValueError('missing control')
            ns['install_controls']=fail;ns['fetch_package']=lambda *_:events.append('download')
            ns['attest']=lambda:None;ns['run']=lambda args,**kw:events.append(args)
            with patch.object(ns['platform'],'system',return_value='Linux'), patch.object(ns['platform'],'machine',return_value='x86_64'), patch.object(ns['os'],'geteuid',return_value=0):
                with self.assertRaises(SystemExit):ns['execute'](config(),'static')
            self.assertNotIn('download',events)
            self.assertIn(['systemctl','start','rolling-budget.service'],events)

    def qualification_environment(self,directory):
        ns=host();ns['BASE']=pathlib.Path(directory);ns['RELEASE']=pathlib.Path(directory)/'release'
        (ns['RELEASE']/'prover').mkdir(parents=True);(ns['RELEASE']/'prover/qualify-runtime.mjs').write_text('// labelled test fake')
        (ns['BASE']/'deadline.json').write_text(json.dumps(config()))
        helper=ns['RELEASE']/'deploy/prover/bootstrap.py';helper.parent.mkdir(parents=True)
        helper.write_bytes(pathlib.Path(b.__file__).read_bytes());ns['PINS']['startup']=hashlib.sha256(helper.read_bytes()).hexdigest()
        ns['verify_release']=lambda _:None;ns['verify_controls']=lambda:123
        return ns

    def test_once_only_qualification_actual_ready_projection_and_safe_report(self):
        with tempfile.TemporaryDirectory() as t:
            ns=self.qualification_environment(t);calls=[]
            def run(args,**kwargs):
                calls.append((args,kwargs))
                if '--eval' in args:return json.dumps(ready_fixture())
                # Intent must be on disk before executing the sole qualifier.
                self.assertTrue((ns['BASE']/'qualification/intent.json').is_file())
                report=qualifier_fixture();report['PRIVATE_SENTINEL']='PRIVATE_SENTINEL'
                pathlib.Path(args[-1]).write_text(json.dumps(report));return None
            ns['run']=run
            with patch.object(ns['time'],'time',return_value=NOW.timestamp()):
                ns['qualify']();ns['qualify']();ns['qualify'](aborted=True)
            self.assertEqual(len(calls),2)
            self.assertIn('createAztecNodeClient',calls[0][0][-1]);self.assertIn('inspectTrustedNode',calls[0][0][-1])
            self.assertNotIn('createTrustedPrivateNode',calls[0][0][-1])
            self.assertEqual(calls[0][1]['cwd'],ns['RELEASE'])
            # Actual JS syntax check only; imports/network never execute here.
            subprocess.run(['node','--input-type=module','--check'],input=calls[0][0][-1],text=True,check=True)
            result=json.loads((ns['BASE']/'qualification/result.json').read_text())
            self.assertTrue(result['passed']);self.assertTrue(all(result['checks'].values()))
            self.assertEqual(result['readiness'],ready_fixture());self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))
            self.assertEqual(result['reportSha256'],hashlib.sha256((ns['BASE']/'qualification/report.json').read_bytes()).hexdigest())
            self.assertEqual((ns['BASE']/'qualification/intent.json').stat().st_mode&0o777,0o600)

    def test_qualification_interrupt_or_fsync_failure_never_replays(self):
        for boundary in ('existing-intent','fsync-after-intent','systemd-abort'):
            with self.subTest(boundary=boundary),tempfile.TemporaryDirectory() as t:
                ns=self.qualification_environment(t);calls=[];ns['run']=lambda *a,**k:calls.append(a)
                directory=ns['BASE']/'qualification';directory.mkdir(mode=0o700)
                if boundary=='existing-intent':(directory/'intent.json').write_text('{') # partial record still prohibits replay
                if boundary=='fsync-after-intent':
                    with patch.object(ns['os'],'fsync',side_effect=OSError('PRIVATE_SENTINEL')):
                        with self.assertRaises(OSError):ns['qualify']()
                ns['qualify'](aborted=boundary=='systemd-abort');ns['qualify']()
                self.assertEqual(calls,[])
                result=json.loads((directory/'result.json').read_text())
                self.assertFalse(result['passed']);self.assertEqual(result['stage'],'interrupted-unknown')
                self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))

    def test_qualification_failures_and_deadline_are_never_retried(self):
        for boundary in ('readiness-deadline','identity','qualifier-timeout','missing-report','failed-check','wrong-scope','nonzero-with-passed-report'):
            with self.subTest(boundary=boundary),tempfile.TemporaryDirectory() as t:
                ns=self.qualification_environment(t);calls=[]
                def run(args,**kwargs):
                    calls.append(args)
                    if '--eval' in args:
                        r=ready_fixture()
                        if boundary=='identity':r['rollupVersion']='1'
                        return json.dumps(r)
                    if boundary=='qualifier-timeout':raise subprocess.TimeoutExpired('PRIVATE_SENTINEL',900)
                    if boundary=='missing-report':return
                    r=qualifier_fixture()
                    if boundary=='failed-check':r['checks']['freshness']['recovered']=False
                    if boundary=='wrong-scope':r['publicScope']['board']='0x'+'0'*64
                    pathlib.Path(args[-1]).write_text(json.dumps(r))
                    if boundary=='nonzero-with-passed-report':raise subprocess.CalledProcessError(1,args)
                ns['run']=run
                now=NOW.timestamp()+(91*60 if boundary=='readiness-deadline' else 0)
                with patch.object(ns['time'],'time',return_value=now):ns['qualify']();ns['qualify']()
                result=json.loads((ns['BASE']/'qualification/result.json').read_text())
                self.assertFalse(result['passed']);self.assertLessEqual(len(calls),2)
                if boundary=='readiness-deadline':self.assertEqual(calls,[])
                self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))

    def test_readiness_public_fields_are_validated_and_no_unknowns_projected(self):
        ns=host();r=ready_fixture();r['secret']='PRIVATE_SENTINEL'
        self.assertEqual(ns['readiness_projection'](r),ready_fixture())
        for name,value in [('proofsEnabled',1),('lagSeconds',121),('latestBlockNumber',True),('syncedL1Timestamp','0'),('latestBlockHash','PRIVATE_SENTINEL')]:
            r=ready_fixture();r[name]=value
            with self.subTest(name=name),self.assertRaises(ValueError):ns['readiness_projection'](r)

    def test_console_qualification_projection_rejects_unknown_fields(self):
        ns=host(packaged_support=True)
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);ns['PRIVATE']=pathlib.Path(t)/'private'
            ns['PRIVATE'].mkdir(mode=0o700);ns['verify_controls']=lambda:99
            calls=[]
            expected=[(['systemctl','show',service,'--property=LoadState','--value'],{'capture':True,'timeout':5})
                      for service in ('board-prover.service','board-prover-proxy.service')]
            def masked_readback(args,**kwargs):
                self.assertLess(len(calls),len(expected))
                self.assertEqual((args,kwargs),expected[len(calls)])
                calls.append((args,kwargs));return 'masked'
            ns['run']=masked_readback
            (ns['BASE']/'deadline.json').write_text(json.dumps(config()));(ns['BASE']/'stage').write_text('installed')
            directory=ns['BASE']/'qualification';directory.mkdir()
            result={'schemaVersion':1,'passed':True,'stage':'complete','scope':'current-network-query-only','manifestSha256':'b'*64,
                    'checks':ns['qualification_projection'](qualifier_fixture(),True),'readiness':ready_fixture(),
                    'anchors':ns['qualification_anchors'](qualifier_fixture()['checks']),'reportSha256':'d'*64}
            captured=[]
            class Console(io.StringIO):
                def close(self):captured.append(self.getvalue());super().close()
            original_open=open
            ns['open']=lambda p,*a,**k:Console() if p=='/dev/console' else original_open(p,*a,**k)
            for mode in ('valid','unknown','bad-boolean'):
                sample=dict(result)
                if mode=='unknown':sample['secret']='PRIVATE_SENTINEL'
                if mode=='bad-boolean':sample['passed']='PRIVATE_SENTINEL'
                (directory/'result.json').write_text(json.dumps(sample))
                (ns['BASE']/'last-attestation').unlink(missing_ok=True)
                calls.clear();ns['attest']()
                self.assertEqual(calls,expected)
                output=json.loads(captured[-1].removeprefix('ROLLING_BOOTSTRAP '))
                self.assertEqual(output['linuxQueryQualified'],mode=='valid')
                self.assertNotIn('PRIVATE_SENTINEL',captured[-1])
                if mode=='valid':self.assertEqual(output['qualification']['anchors'],result['anchors'])

    def test_generated_config_passes_actual_service_preflight_without_startup(self):
        # Extract exact public config from the generated payload; execute only
        # definitions, never bootstrap or a service. No mirrored validator.
        import ast
        generated=fixture_generate(config(),NOW)
        encoded=generated.split("base64.b64decode('")[1].split("')")[0]
        program=lzma.decompress(base64.b64decode(encoded)).decode()
        assignment=ast.parse(program).body[0]
        self.assertEqual(assignment.targets[0].id,'SOURCE')
        namespace={};exec(ast.literal_eval(assignment.value),namespace)
        actual=namespace['QUALIFICATION']
        script="""
import assert from 'node:assert/strict';
import {validateQueryService} from SERVICE_URI;
import {validateQualification} from QUALIFIER_URI;
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const config=JSON.parse(raw);validateQualification(config);
assert.deepEqual(config.service.origins,[]);
assert.equal(validateQueryService(config.service).serviceMode,'query-only');
assert.equal(Object.hasOwn(config.service,'board'),false);
for(const key of ['origins','queryNode']){
  let reads=0;const s={...config.service};
  Object.defineProperty(s,key,{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});
  assert.throws(()=>validateQueryService(s),/Invalid query-only configuration/);
  assert.equal(reads,0);
}
""".replace('SERVICE_URI',json.dumps((ROOT/'prover/service.mjs').as_uri())).replace('QUALIFIER_URI',json.dumps((ROOT/'prover/qualify-runtime.mjs').as_uri()))
        subprocess.run([os.environ.get('PROVER_VALIDATION_NODE','node'),'--input-type=module','--eval',script],input=json.dumps(actual),text=True,check=True,
                       env={'PATH':'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin','LOG_LEVEL':'silent'})

    def test_qualification_unit_enforces_process_and_network_boundary(self):
        ns=host();written={};calls=[]
        ns['write']=lambda p,s,*_:written.update({str(p):s});ns['run']=lambda a,**k:calls.append(a)
        ns['install_qualification']()
        unit=written['/etc/systemd/system/rolling-qualification.service']
        for line in ('TimeoutStartSec=6300','KillMode=control-group','Restart=no','IPAddressDeny=any','IPAddressAllow=localhost','PrivateTmp=yes','ProtectSystem=strict','ReadWritePaths=/var/lib/rolling-bootstrap','UnsetEnvironment=NODE_PATH NODE_OPTIONS BB','Environment=LOG_LEVEL=silent'):
            self.assertIn(line+'\n',unit)
        self.assertIn('--qualification-stop',unit)
        self.assertNotIn('docker.sock',unit)
        self.assertEqual(calls[-1],['systemctl','start','--no-block','rolling-qualification.service'])

    def test_qualification_tc_readback_has_required_netlink_socket_family(self):
        # Source-derived dependency model, NOT Linux seccomp execution:
        # iproute2 v6.1.0 lib/libnetlink.c:182-243 rtnl_open uses
        # socket(AF_NETLINK, SOCK_RAW|SOCK_CLOEXEC, NETLINK_ROUTE).
        # systemd v255 systemd.exec.xml:1850-1868 filters socket() by family.
        ns=host();written={};ns['write']=lambda p,s,*_:written.update({str(p):s})
        ns['run']=lambda *a,**k:None;ns['install_qualification']()
        unit=written['/etc/systemd/system/rolling-qualification.service']
        settings=dict(line.split('=',1) for line in unit.splitlines() if '=' in line)
        families=set(settings['RestrictAddressFamilies'].split())
        self.assertEqual(settings['CapabilityBoundingSet'],'') # no CAP_NET_ADMIN
        self.assertEqual(settings['IPAddressDeny'],'any');self.assertEqual(settings['IPAddressAllow'],'localhost')
        self.assertEqual(families-{'AF_NETLINK'},{'AF_UNIX','AF_INET','AF_INET6'})
        classes='\n'.join('class htb '+h+' '+parent+' rate '+rate+'Mbit ceil 50Mbit burst 1Mb cburst 1Mb\n Sent 123 bytes 1 pkt (dropped 0, overlimits 0 requeues 0)' for h,parent,rate in [('1:1','root','50'),('1:10','parent 1:1','25'),('1:20','parent 1:1','25')])
        reads=[]
        def command(args,**kwargs):
            if args[0]=='systemctl':
                self.assertIn('AF_UNIX',families);return
            if args==['tc','-V']:return 'tc utility, iproute2-6.1.0, libbpf 1.3.0'
            if args[0]=='dpkg-query':return '6.1.0-1ubuntu6.4'
            if args[0]=='tc' and ('class' in args or 'qdisc' in args):
                if 'AF_NETLINK' not in families:raise PermissionError('model: socket family denied')
                reads.append('class' if 'class' in args else 'qdisc')
                if 'class' in args:return classes
                return json.dumps([{'kind':'htb','handle':'1:','root':True,'options':{'default':'0x10'}}])
            self.fail('Unexpected command dependency')
        ns['run']=command
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t)
            (ns['BASE']/'deadline.json').write_text(json.dumps({'budgetStop':'2099-01-01T00:00:00Z','hostResources':{'dataVolumeGiB':1024,'egressMbps':50}}))
            (ns['BASE']/'interface').write_text('ens5')
            self.assertEqual(ns['verify_controls'](),123);self.assertEqual(reads,['class','qdisc'])
            families.remove('AF_NETLINK')
            with self.assertRaises(PermissionError):ns['verify_controls']()
            self.assertEqual(reads,['class','qdisc']) # rejection cannot become success or bypass tc

    def test_early_diagnostics_classify_failures_without_raw_data(self):
        ns=host();records=[];ns['emit_diagnostic']=lambda data:records.append(json.loads(data.decode().removeprefix('ROLLING_BOOTSTRAP_DIAGNOSTIC ')))
        ns['DIAGNOSTICS_ACTIVE']=True
        for step,error,category,code in [('budget-timer',subprocess.CalledProcessError(1,['PRIVATE_SENTINEL'],output='PRIVATE_SENTINEL'),'command-exit',1),
                                         ('mask-prover',subprocess.CalledProcessError(5,['PRIVATE_SENTINEL']),'command-exit',5),
                                         ('shaper-start',subprocess.TimeoutExpired('PRIVATE_SENTINEL',10),'command-timeout',None),
                                         ('tc-version',ValueError('PRIVATE_SENTINEL'),'validation',None),
                                         ('tc-class-parse',ValueError('PRIVATE_SENTINEL'),'validation',None),
                                         ('state-directory',PermissionError('PRIVATE_SENTINEL'),'permission',None)]:
            ns['mark'](step);ns['diagnostic'](error)
            self.assertEqual(records[-1]['step'],step);self.assertEqual(records[-1]['category'],category)
            self.assertEqual(records[-1].get('returnCode'),code)
        class HostileError(Exception):
            @property
            def returncode(self):raise AssertionError('must not read arbitrary getter')
            def __str__(self):raise AssertionError('must not format raw error')
        ns['diagnostic'](HostileError());self.assertEqual(records[-1]['category'],'internal')
        ns['diagnostic'](subprocess.CalledProcessError(99999,'PRIVATE_SENTINEL'))
        self.assertNotIn('returnCode',records[-1]);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(records))
        facts=ns['version_facts']('tc utility, iproute2-6.1.0, libbpf 1.3')
        self.assertEqual(facts,{'tcVersion':[6,1,0],'libbpfVersion':[1,3]})
        self.assertEqual(ns['version_facts']('6.1.0-1ubuntu6.4',True),{'packageVersion':[6,1,0,1,6,4]})
        self.assertEqual(ns['version_facts']('tc utility, iproute2-6.1.0, PRIVATE_SENTINEL'),{})
        ns['diagnostic'](status='observed',facts={**facts,'classFormat':'PRIVATE_SENTINEL','secret':'PRIVATE_SENTINEL','packageVersion':[True,1]})
        self.assertEqual(records[-1]['tcVersion'],[6,1,0]);self.assertNotIn('packageVersion',records[-1]);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(records))

    def test_first_timer_mask_shaper_faults_record_real_control_step(self):
        for boundary,expected in [('budget','budget-timer'),('mask','mask-prover'),('shaper','shaper-start')]:
            with self.subTest(boundary=boundary):
                ns=host();records=[]
                ns['immutable_deadline']=lambda _:None;ns['write']=lambda *a:None;ns['verify_controls']=lambda:0
                ns['emit_diagnostic']=lambda data:records.append(json.loads(data.decode().removeprefix('ROLLING_BOOTSTRAP_DIAGNOSTIC ')))
                calls=[]
                def command(args,**kwargs):
                    calls.append(args)
                    matches=(boundary=='budget' and args==['systemctl','enable','--now','rolling-budget.timer']) or (boundary=='mask' and args[1]=='mask') or (boundary=='shaper' and 'rolling-egress.service' in args)
                    if matches:raise subprocess.CalledProcessError(7,args,output='PRIVATE_SENTINEL')
                    if args[0]=='ip':return '[{"dev":"ens5"}]'
                    if args[:3]==['systemctl','is-active','--quiet'] and args[-1].endswith('.service'):raise subprocess.CalledProcessError(3,args)
                ns['run']=command
                with self.assertRaises(subprocess.CalledProcessError) as failure:ns['install_controls'](config())
                ns['diagnostic'](failure.exception)
                self.assertEqual(records[-1]['step'],expected);self.assertEqual(records[-1]['returnCode'],7)
                self.assertNotIn('PRIVATE_SENTINEL',json.dumps(records))

    def test_early_failure_and_failed_diagnostics_still_request_shutdown(self):
        for stage in ('preflight','directory','lock'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as t:
                ns=host();ns['BASE']=pathlib.Path(t)/'state';calls=[]
                ns['emit_diagnostic']=lambda _:(_ for _ in ()).throw(OSError('PRIVATE_SENTINEL'))
                ns['write']=lambda *a:(_ for _ in ()).throw(OSError('PRIVATE_SENTINEL'))
                def command(args,**kw):
                    calls.append(args)
                    if args[0]=='systemctl':raise subprocess.TimeoutExpired('PRIVATE_SENTINEL',10)
                ns['run']=command
                with patch.object(ns['platform'],'system',return_value='Darwin' if stage=='preflight' else 'Linux'),patch.object(ns['platform'],'machine',return_value='x86_64'),patch.object(ns['os'],'geteuid',return_value=0):
                    if stage=='directory':ns['BASE'].write_text('not directory')
                    if stage=='lock':ns['BASE'].mkdir();(ns['BASE']/'lock').mkdir()
                    with self.assertRaises(SystemExit):ns['execute'](config(),'unused')
                self.assertIn(['systemctl','start','rolling-budget.service'],calls)
                self.assertIn(['/usr/sbin/poweroff'],calls)
                self.assertFalse((ns['BASE']/'deadline.json').exists())

    def test_diagnostic_sinks_nonblocking_character_devices_no_create_or_follow(self):
        ns=host(diagnostic_devices=True);opened=[];writes=[];closed=[]
        def opening(device,flags):opened.append((device,flags));return len(opened)
        class Device:st_mode=0o020600
        with patch.object(ns['os'],'open',side_effect=opening),patch.object(ns['os'],'fstat',return_value=Device()),patch.object(ns['os'],'write',side_effect=lambda fd,data:writes.append(fd)),patch.object(ns['os'],'close',side_effect=lambda fd:closed.append(fd)):
            ns['diagnostic'](ValueError('PRIVATE_SENTINEL'))
        self.assertEqual([x[0] for x in opened],['/dev/ttyS0','/dev/console']);self.assertEqual(writes,[1,2]);self.assertEqual(closed,[1,2])
        for _,flags in opened:
            self.assertTrue(flags&ns['os'].O_NONBLOCK);self.assertTrue(flags&ns['os'].O_NOFOLLOW);self.assertFalse(flags&ns['os'].O_CREAT)
        with patch.object(ns['os'],'open',side_effect=OSError('PRIVATE_SENTINEL')):ns['diagnostic'](ValueError('PRIVATE_SENTINEL'))
        class RegularFile:st_mode=0o100600
        with patch.object(ns['os'],'open',return_value=1),patch.object(ns['os'],'fstat',return_value=RegularFile()),patch.object(ns['os'],'write') as write,patch.object(ns['os'],'close'):
            ns['diagnostic'](ValueError('PRIVATE_SENTINEL'));write.assert_not_called()

    def test_cli_private_compressed_output_and_no_overwrite(self):
        # The real CLI forbids inputs/outputs inside its checkout. A supervisor's
        # TMPDIR may be inside that checkout, so use an owned external directory.
        with tempfile.TemporaryDirectory(prefix='rolling-bootstrap-cli-',dir='/tmp') as t:
            directory=pathlib.Path(t).resolve();directory.chmod(0o700)
            now=dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
            c=config()
            for key,delta in [('createdAt',dt.timedelta()),('budgetStop',dt.timedelta(hours=8)),('commissioningStop',dt.timedelta(minutes=30))]:
                c[key]=(now+delta).strftime('%Y-%m-%dT%H:%M:%SZ')
            source=directory/'input.json';source.write_text(json.dumps(c));source.chmod(0o600)
            output=directory/'user-data.gz'
            # Exercise the actual closed release gate before the separate positive
            # fixture. This is a real CLI invocation, not fixture_generate's mock.
            real_pins=(ROOT/'toolchain.json').read_bytes()
            active=json.loads(real_pins).get('nativeProver',{}).get('linux-x64')
            if active is None:
                with self.assertRaisesRegex(b.Invalid,'^Active Linux prover qualification required$'):b.require_linux_qualification()
                actual=subprocess.run([sys.executable,str(ROOT/'deploy/prover/bootstrap.py'),'--config',str(source),'--output',str(output)],capture_output=True,text=True,timeout=10)
                self.assertEqual(actual.returncode,1);self.assertFalse(output.exists())
                self.assertNotIn('PRIVATE_SENTINEL',actual.stdout+actual.stderr)
            # Labelled qualified release fixture only. It copies the unchanged CLI
            # into a temporary root; no active repository/toolchain pin is changed.
            fixture=directory/'qualified-fixture';cli=fixture/'deploy/prover/bootstrap.py';cli.parent.mkdir(parents=True)
            shutil.copyfile(ROOT/'deploy/prover/bootstrap.py',cli)
            (fixture/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':b.BB_SHA}}}))
            args=[sys.executable,str(cli),'--config',str(source),'--output',str(output)]
            result=subprocess.run(args,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertNotIn('PRIVATE_SENTINEL',result.stdout+result.stderr)
            self.assertEqual(output.stat().st_mode & 0o777,0o600)
            data=output.read_bytes();self.assertLessEqual(len(data),16384)
            subprocess.run(['/bin/sh','-n'],input=gzip.decompress(data),check=True)
            result=subprocess.run(args,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,1);self.assertEqual(output.read_bytes(),data)
            self.assertNotIn('PRIVATE_SENTINEL',result.stdout+result.stderr)
            self.assertEqual((ROOT/'toolchain.json').read_bytes(),real_pins)

    def test_private_input_permissions_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            p=pathlib.Path(t)/'input.json';p.write_text(json.dumps(config()));p.chmod(0o600)
            self.assertEqual(b.private_file(p),config());p.chmod(0o644)
            with self.assertRaises(b.Invalid):b.private_file(p)
            link=pathlib.Path(t)/'link';link.symlink_to(p)
            with self.assertRaises(OSError):b.private_file(link)


class FinalReceipt(unittest.TestCase):
    """Labelled development transport/process fakes, not Linux evidence."""
    def capability(self):
        return ('https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/receipts/campaign-04/final.json?'
                'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ABCDEFGHIJKLMNOP%2F20261011%2Feu-west-2%2Fs3%2Faws4_request&'
                'X-Amz-Date=20261011T180000Z&X-Amz-Expires=28800&X-Amz-SignedHeaders=host&X-Amz-Signature='+('c'*64))

    def environment(self,directory):
        ns=host();ns['BASE']=pathlib.Path(directory)/'public';ns['PRIVATE']=pathlib.Path(directory)/'private'
        (ns['BASE']/'qualification').mkdir(parents=True);ns['PRIVATE'].mkdir(mode=0o700)
        return ns

    def test_capability_scope_and_private_generation(self):
        c=config();c['receiptPutUrl']=self.capability();self.assertEqual(b.validate(c,NOW),c)
        self.assertEqual(host()['receipt_url'](self.capability()),self.capability())
        for old,new in [('/receipts/','/releases/'),('final.json','../final.json'),('final.json','final%2ejson'),('.s3.eu-west-2.','.s3.us-east-1.'),('https:','http:'),('X-Amz-Expires=28800','X-Amz-Expires=28801'),('X-Amz-SignedHeaders=host','X-Amz-SignedHeaders=host%3Bauthorization')]:
            bad=dict(c,receiptPutUrl=c['receiptPutUrl'].replace(old,new))
            with self.subTest(new=new),self.assertRaises(b.Invalid):b.validate(bad,NOW)
        bad=dict(c,receiptPutUrl=c['receiptPutUrl']+'&unexpected=PRIVATE_SENTINEL')
        with self.assertRaises(b.Invalid):b.validate(bad,NOW)
        text=fixture_generate(c,NOW);self.assertLess(len(gzip.compress(text.encode())),16384)
        source=lzma.decompress(base64.b64decode(text.split("base64.b64decode('")[1].split("')")[0])).decode()
        self.assertNotIn(self.capability(),source.split('ATTESTATION = ')[1])
        compile(source,'generated-private','exec')

    def test_lzma_roundtrip_executes_definitions_and_binds_runtime_hash(self):
        # Actual stdlib decompression/compilation; only the final host entry is a
        # labelled stub. No host command or installed service runs in this test.
        c=config();c['receiptPutUrl']=self.capability()
        # Realistic-sized synthetic capabilities, never real tokens.
        import random,string
        rng=random.Random(14)
        token=''.join(rng.choice(string.ascii_letters+string.digits) for _ in range(1024))
        c['runtimeUrl']+='&X-Amz-Security-Token='+token
        c['receiptPutUrl']+='&X-Amz-Security-Token='+token
        text=fixture_generate(c,NOW);self.assertLess(len(gzip.compress(text.encode())),16384)
        encoded=text.split("base64.b64decode('")[1].split("')")[0]
        source=lzma.decompress(base64.b64decode(encoded)).decode()
        definitions,entry=source.rsplit('execute(CONFIG, ATTESTATION)',1)
        self.assertEqual(entry.strip(),'');ns={};exec(compile(definitions,'generated','exec'),ns)
        calls=[];ns['execute']=lambda conf,script:calls.append((conf,script))
        exec('execute(CONFIG, ATTESTATION)',ns)
        self.assertEqual(calls[0][0],c);compile(calls[0][1],'attestor','exec')
        runtime=ns['SOURCE'][ns['SOURCE'].index('\nimport datetime as dt, fcntl'):]
        expected_runtime=b.tokenize.untokenize(t._replace(string='') if t.type==b.tokenize.COMMENT else t
            for t in b.tokenize.generate_tokens(io.StringIO(b.HOST).readline))
        self.assertEqual(runtime,expected_runtime)
        self.assertEqual(ns['PINS']['bootstrap'],hashlib.sha256(runtime.encode()).hexdigest())
        # An unrepresentable raw delimiter fails closed; never rewrite runtime.
        with patch.object(b,'HOST',b.HOST+'\nEXAMPLE = '+repr(chr(34)*3)+'\n'):
            with self.assertRaisesRegex(b.Invalid,'^Bootstrap source encoding mismatch$'):fixture_generate(c,NOW)
        self.assertEqual(ns['PINS']['startup'],hashlib.sha256(pathlib.Path(b.__file__).read_bytes()).hexdigest())
        self.assertNotIn(token,calls[0][1])
        # Verify the executed decoded payload, not just the generator's source.
        writes={};ns['prepare_data']=lambda:None;ns['verify_controls']=lambda:0
        ns['write']=lambda p,s,*_:writes.update({str(p):s})
        ns['public_ip']=lambda:'203.0.113.10';ns['prepare_admin_key']=lambda:'a'*64
        ns['run']=lambda *args,**kwargs:None
        with patch.object(ns['shutil'],'which',return_value='/usr/bin/docker'):
            ns['install_node']()
        unit=writes['/etc/systemd/system/rolling-node.service']
        import shlex
        command=next(line for line in unit.splitlines() if line.startswith('ExecStart='))
        args=shlex.split(command.removeprefix('ExecStart='))
        environment=[args[i+1] for i,arg in enumerate(args) if arg=='-e']
        self.assertEqual([v for v in environment if v.startswith('ETHEREUM_HOSTS=')],
                         ['ETHEREUM_HOSTS=https://sepolia.gateway.tenderly.co'])
        self.assertEqual([v for v in environment if v.startswith('ETHEREUM_DEBUG_HOSTS=')],
                         ['ETHEREUM_DEBUG_HOSTS=https://ethereum-sepolia-rpc.publicnode.com'])
        self.assertIn('ETHEREUM_ALLOW_NO_DEBUG_HOSTS=false',environment)
        self.assertIn('BLOB_ALLOW_EMPTY_SOURCES=false',environment)
        # Worst-case permitted URL lengths can exceed AWS storage; no truncation.
        c['runtimeUrl']+=''.join(rng.choice(string.ascii_letters+string.digits) for _ in range(4096-len(c['runtimeUrl'])))
        c['receiptPutUrl']+=''.join(rng.choice(string.ascii_letters+string.digits) for _ in range(4096-len(c['receiptPutUrl'])))
        self.assertEqual(len(b.validate(c,NOW)['receiptPutUrl']),4096)
        with tempfile.TemporaryDirectory() as t:
            directory=pathlib.Path(t);directory.chmod(0o700)
            now=dt.datetime.now(dt.timezone.utc)
            for key,delta in [('createdAt',dt.timedelta()),('budgetStop',dt.timedelta(hours=8)),('commissioningStop',dt.timedelta(minutes=30))]:c[key]=(now+delta).strftime('%Y-%m-%dT%H:%M:%SZ')
            source=directory/'input.json';source.write_text(json.dumps(c));source.chmod(0o600)
            output=directory/'output.gz'
            fixture=directory/'fixture';cli=fixture/'deploy/prover/bootstrap.py';cli.parent.mkdir(parents=True)
            shutil.copyfile(ROOT/'deploy/prover/bootstrap.py',cli)
            (fixture/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':b.BB_SHA}}}))
            result=subprocess.run([sys.executable,str(cli),'--config',str(source),'--output',str(output)],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,1);self.assertFalse(output.exists());self.assertNotIn(token,result.stdout+result.stderr)

    def test_success_and_persistence_failure_do_not_masquerade_as_receipts(self):
        for boundary in ('success','disk-failure'):
            with self.subTest(boundary=boundary),tempfile.TemporaryDirectory() as t:
                ns=self.environment(t);events=[]
                # Successful receipt validation also uses the actual pinned helpers.
                ns['RELEASE']=ROOT;ns['PINS']['startup']=hashlib.sha256(pathlib.Path(b.__file__).read_bytes()).hexdigest()
                report=qualifier_fixture();q={'schemaVersion':1,'passed':True,'stage':'complete','scope':'current-network-query-only','manifestSha256':'b'*64,
                    'checks':ns['qualification_projection'](report,True),'readiness':ready_fixture(),'anchors':ns['qualification_anchors'](report['checks'])}
                ns['exclusive_record'](ns['BASE']/'qualification/result.json',q)
                ns['service_observations']=lambda:{};ns['emit_diagnostic']=lambda data:events.append(data)
                ns['upload_receipt']=lambda data:events.append('upload');startup_calls=[]
                def run(args,**kwargs):
                    if args==['/usr/bin/python3',str(ROOT/'deploy/prover/bootstrap.py'),'--startup-observation']:
                        self.assertEqual(kwargs,{'timeout':3,'capture':True});startup_calls.append(args)
                        return json.dumps({'available':False}) # labelled startup observation fixture
                    self.assertEqual(args,['systemctl','start','--no-block','rolling-budget.service'])
                    self.assertEqual(kwargs,{'timeout':5});events.append('shutdown')
                ns['run']=run
                if boundary=='disk-failure':
                    with patch.object(ns['os'],'fsync',side_effect=OSError('PRIVATE_SENTINEL')):
                        with self.assertRaises(OSError):ns['final_receipt']()
                    self.assertNotIn('upload',events);self.assertEqual(events[-1],'shutdown')
                    self.assertIn(b'FINALIZATION_FAILED',events[0]);self.assertNotIn('PRIVATE_SENTINEL',str(events))
                else:
                    ns['final_receipt']();ns['final_receipt']()
                    self.assertNotIn('shutdown',events);self.assertEqual(events[-1],'upload');self.assertEqual(len(events),2)
                self.assertEqual(len(startup_calls),1)

    def test_service_state_projection_and_failures(self):
        good='LoadState=loaded\nActiveState=failed\nSubState=failed\nResult=oom-kill\nExecMainCode=2\nExecMainStatus=9\nNRestarts=0'
        for boundary in ('healthy','timeout','malformed','secret','missing-container'):
            with self.subTest(boundary=boundary):
                ns=host();calls=[]
                def run(args,**kwargs):
                    calls.append((args,kwargs));self.assertEqual(kwargs['timeout'],3)
                    if boundary=='timeout':raise subprocess.TimeoutExpired('PRIVATE_SENTINEL',3)
                    if args[0]=='systemctl':return good+('\nSECRET=PRIVATE_SENTINEL' if boundary=='secret' else '')
                    self.assertNotIn('.State.Error',args[3]);self.assertNotIn('.Config',args[3])
                    if boundary=='missing-container':raise subprocess.CalledProcessError(1,args)
                    return json.dumps({'status':'exited','running':False,'restarting':False,'oomKilled':True,'exitCode':137 if boundary!='malformed' else True})
                ns['run']=run;v=ns['service_observations']();self.assertEqual(len(calls),3)
                self.assertNotIn('PRIVATE_SENTINEL',json.dumps(v))
                if boundary=='healthy':self.assertTrue(v['container']['oomKilled']);self.assertEqual(v['node']['ExecMainStatus'],9)
                if boundary in ('timeout','secret'):self.assertFalse(v['node']['available'])
                if boundary in ('timeout','malformed','missing-container'):self.assertFalse(v['container']['available'])

    def test_readiness_categories_exact_and_unknown_rejected(self):
        ns=host()
        for category in ('CONFIG','IDENTITY','UNAVAILABLE','UNSYNCED','STALE','TIMEOUT','PROCESS_EXIT'):
            value={'ready':False,'category':category,'attempts':1}
            self.assertEqual(ns['readiness_observation'](value),value)
        for value in ({'ready':False,'category':'PRIVATE_SENTINEL','attempts':1},
                      {'ready':False,'category':'STALE','attempts':True},
                      {'ready':False,'category':'STALE','attempts':1,'error':'PRIVATE_SENTINEL'}):
            with self.assertRaises(ValueError):ns['readiness_observation'](value)
        value={'ready':True,'snapshot':ready_fixture(),'attempts':9}
        self.assertEqual(ns['readiness_observation'](value),value)

    def test_failed_poll_retains_fixed_category_before_deadline(self):
        with tempfile.TemporaryDirectory() as t:
            ns=Bootstrap().qualification_environment(t)
            ns['run']=lambda *a,**k:json.dumps({'ready':False,'category':'UNSYNCED'})
            times=iter([NOW.timestamp(),NOW.timestamp(),NOW.timestamp()+91*60,NOW.timestamp()+91*60])
            with patch.object(ns['time'],'time',side_effect=lambda:next(times)),patch.object(ns['time'],'sleep'):
                ns['qualify']()
            value=json.loads((ns['BASE']/'qualification/readiness-observation.json').read_text())
            self.assertEqual(value,{'ready':False,'category':'UNSYNCED','attempts':1})
            self.assertFalse(json.loads((ns['BASE']/'qualification/result.json').read_text())['passed'])

    def test_final_receipt_durable_emit_upload_shutdown_order(self):
        with tempfile.TemporaryDirectory() as t:
            ns=self.environment(t);events=[]
            ns['exclusive_record'](ns['BASE']/'qualification/result.json',ns['qualification_failure']('readiness-failed'))
            ns['service_observations']=lambda:{'node':{'available':False},'qualification':{'available':False},'container':{'available':False}}
            def emit(data):
                self.assertTrue((ns['PRIVATE']/'final-receipt.json').is_file());events.append('emit')
                self.assertNotIn(b'PRIVATE_SENTINEL',data)
            ns['emit_diagnostic']=emit
            ns['upload_receipt']=lambda data:events.append('upload')
            ns['run']=lambda args,**kw:events.append('shutdown')
            ns['final_receipt']();self.assertEqual(events,['emit','upload','shutdown'])
            frozen=(ns['PRIVATE']/'final-receipt.json').read_bytes()
            ns['final_receipt']();self.assertEqual(events,['emit','upload','shutdown','shutdown'])
            self.assertEqual((ns['PRIVATE']/'final-receipt.json').read_bytes(),frozen)
            self.assertEqual((ns['PRIVATE']/'final-receipt.json').stat().st_mode&0o777,0o600)

    def test_malformed_or_secret_qualification_never_reaches_receipt(self):
        for change in ('extra','stage','checks','symlink','size'):
            with self.subTest(change=change),tempfile.TemporaryDirectory() as t:
                ns=self.environment(t);p=ns['BASE']/'qualification/result.json'
                q=ns['qualification_failure']('readiness-failed')
                if change=='extra':q['secret']='PRIVATE_SENTINEL'
                if change=='stage':q['stage']='PRIVATE_SENTINEL'
                if change=='checks':q['checks']={'secret':'PRIVATE_SENTINEL'}
                if change=='symlink':p.symlink_to(ns['PRIVATE']/'secret');(ns['PRIVATE']/'secret').write_text('PRIVATE_SENTINEL')
                else:p.write_text('PRIVATE_SENTINEL'*2000 if change=='size' else json.dumps(q))
                (ns['BASE']/'qualification/readiness-observation.json').write_text('{"secret":"PRIVATE_SENTINEL"}')
                ns['service_observations']=lambda:{};ns['run']=lambda *a,**k:None
                ns['final_receipt']();raw=(ns['PRIVATE']/'final-receipt.json').read_text()
                self.assertNotIn('PRIVATE_SENTINEL',raw)
                self.assertEqual(json.loads(raw)['qualification']['stage'],'interrupted-unknown')

    def test_single_put_unknown_redirect_and_success_never_repeat(self):
        for boundary in ('success','timeout','redirect','rejected','partial-intent','fsync'):
            with self.subTest(boundary=boundary),tempfile.TemporaryDirectory() as t:
                ns=self.environment(t);calls=[];data=b'{"schemaVersion":1}'
                ns['exclusive_record'](ns['PRIVATE']/'receipt-put.json',{'url':self.capability()})
                if boundary=='partial-intent':(ns['PRIVATE']/'upload-intent.json').write_text('{')
                class Reply:
                    status=200 if boundary=='success' else 403
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                class Opener:
                    def open(inner,request,timeout):
                        calls.append(request);self.assertEqual(timeout,5);self.assertEqual(request.method,'PUT');self.assertEqual(request.data,data)
                        self.assertTrue((ns['PRIVATE']/'upload-intent.json').is_file())
                        if boundary=='timeout':raise TimeoutError('PRIVATE_SENTINEL')
                        if boundary=='redirect':raise ValueError('PRIVATE_SENTINEL')
                        return Reply()
                def build(*handlers):
                    self.assertEqual(handlers[0].proxies,{})
                    with self.assertRaisesRegex(ValueError,'^Redirect rejected$'):handlers[1].redirect_request(None,None,307,'secret',{},self.capability())
                    return Opener()
                with patch.object(ns['urllib'].request,'build_opener',side_effect=build):
                    if boundary=='fsync':
                        with patch.object(ns['os'],'fsync',side_effect=OSError('PRIVATE_SENTINEL')):
                            with self.assertRaises(OSError):ns['upload_receipt'](data)
                    else:ns['upload_receipt'](data)
                    ns['upload_receipt'](data)
                self.assertEqual(len(calls),0 if boundary in ('partial-intent','fsync') else 1)
                result=ns['PRIVATE']/'upload-result.json'
                if result.exists():
                    value=json.loads(result.read_text());self.assertNotIn('PRIVATE_SENTINEL',json.dumps(value))
                    self.assertEqual(value['status'],'acknowledged' if boundary=='success' else 'rejected' if boundary=='rejected' else 'unknown')

    def test_qualifier_cannot_read_capabilities_and_publisher_is_separate(self):
        ns=host();files={};ns['write']=lambda path,data,*mode:files.update({str(path):data});ns['run']=lambda *a,**k:None
        ns['install_qualification']();unit=files['/etc/systemd/system/rolling-qualification.service']
        self.assertIn('IPAddressDeny=any\nIPAddressAllow=localhost',unit)
        self.assertIn('InaccessiblePaths=-/var/lib/rolling-bootstrap-private -/var/lib/cloud',unit)
        self.assertIn('TimeoutStopSec=45',unit)
        publisher=files['/etc/systemd/system/rolling-qualification-receipt.service']
        self.assertIn('--qualification-receipt',publisher);self.assertIn('TimeoutStartSec=35',publisher)
        self.assertIn('Restart=no',publisher);self.assertNotIn('receiptPutUrl',publisher)
        self.assertIn("'--log-driver','none'",b.HOST);self.assertNotIn("'run','--rm'",b.HOST)

class AdminCapability(unittest.TestCase):
    def environment(self,t):
        ns=host();ns['QUALIFICATION']={**b.QUALIFICATION,'adminKeyFile':str(pathlib.Path(t)/'admin/key')}
        ns['ADMIN_HASH_FILE']=pathlib.Path(t)/'existing-hash'
        return ns

    def test_private_generation_reuse_hash_and_existing_authority(self):
        with tempfile.TemporaryDirectory() as t:
            ns=self.environment(t);value=ns['prepare_admin_key']();keyfile=pathlib.Path(ns['QUALIFICATION']['adminKeyFile']);key=keyfile.read_text()
            self.assertEqual(len(key),64);self.assertEqual(value,hashlib.sha256(key.encode()).hexdigest())
            self.assertEqual(keyfile.stat().st_mode&0o777,0o600);self.assertEqual(keyfile.parent.stat().st_mode&0o777,0o700)
            self.assertEqual(ns['prepare_admin_key'](),value);self.assertEqual(keyfile.read_text(),key)
            ns['ADMIN_HASH_FILE'].write_text(value);self.assertEqual(ns['prepare_admin_key'](),value)
            ns['ADMIN_HASH_FILE'].write_text('f'*64)
            with self.assertRaises(ValueError):ns['prepare_admin_key']()
            self.assertEqual(keyfile.read_text(),key);self.assertEqual(ns['ADMIN_HASH_FILE'].read_text(),'f'*64)
            keyfile.unlink()
            with self.assertRaises(ValueError):ns['prepare_admin_key']()
            self.assertFalse(keyfile.exists())

    def test_corrupt_or_unsafe_capability_is_never_replaced(self):
        for mode in ['short','permissions','symlink','directory']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as t:
                ns=self.environment(t);ns['prepare_admin_key']();keyfile=pathlib.Path(ns['QUALIFICATION']['adminKeyFile'])
                if mode=='short':keyfile.write_text('PRIVATE_SENTINEL')
                if mode=='permissions':keyfile.chmod(0o644)
                if mode=='directory':keyfile.parent.chmod(0o755)
                if mode=='symlink':
                    keyfile.unlink();keyfile.symlink_to(pathlib.Path(t)/'missing')
                with self.assertRaises((ValueError,OSError)):ns['prepare_admin_key']()
                if mode=='short':self.assertEqual(keyfile.read_text(),'PRIVATE_SENTINEL')
                if mode=='symlink':self.assertTrue(keyfile.is_symlink())

    def test_qualifier_can_read_only_dedicated_capability_private_transport_stays_hidden(self):
        ns=host();writes={};ns['write']=lambda p,s,*_:writes.update({str(p):s});ns['run']=lambda *a,**k:None
        ns['install_qualification']();unit=writes['/etc/systemd/system/rolling-qualification.service']
        self.assertIn('ReadOnlyPaths=/var/lib/rolling-admin/qualification-key\n',unit)
        self.assertIn('InaccessiblePaths=-/var/lib/rolling-bootstrap-private -/var/lib/cloud',unit)
        self.assertIn('IPAddressDeny=any\nIPAddressAllow=localhost',unit)
        self.assertNotIn('ReadWritePaths=/var/lib/rolling-admin',unit)

class NodeStartup(unittest.TestCase):
    def test_stream_bounds_unknown_and_secret_output_are_not_evidence(self):
        ns=host();output=b.NodeOutput()
        secret=b'https://secret.example/?token=PRIVATE_SENTINEL x-api-key=PRIVATE_SENTINEL'
        for chunk in [b'Downloading CRS of size ',secret,b'\nGenesis archive ',b'root: PRIVATE_SENTINEL\n',b'Error: arbitrary PRIVATE_SENTINEL\n']:
            output.feed(chunk)
        for _ in range(20):output.feed(b'PRIVATE_SENTINEL'*200)
        self.assertLessEqual(len(output.pending),8192);self.assertTrue(output.dropping)
        output.feed(b'Aztec Server listening on port 8080\n');self.assertNotIn('public-rpc',output.value['stages'])
        output.feed(b'Aztec Server listening on port 8080\n');output.finish(1)
        self.assertEqual(output.value['errors'],['unknown']);self.assertEqual(output.value['oversizedLines'],1)
        self.assertIn('public-rpc',output.value['stages']);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(output.value))
        self.assertNotIn('secret.example',json.dumps(output.value));self.assertEqual(output.pending,b'')
        with self.assertRaises(ValueError):output.feed(b'x'*4097)

    def test_fixed_error_flags_deduplicated_and_validated_before_receipt(self):
        ns=host();output=b.NodeOutput();output.feed(b'Error: ERR_DLOPEN_FAILED PRIVATE_SENTINEL\nEACCES PRIVATE_SENTINEL\nEACCES\n');output.finish(-15)
        self.assertEqual(output.value['errors'],['native-load','permission']);self.assertIsNone(output.value['exitCode']);self.assertEqual(output.value['signal'],15)
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);p=ns['BASE']/'node-startup.json';p.write_text(json.dumps(output.value));p.chmod(0o600)
            self.assertTrue(b.node_startup_observation(ns['BASE'])['available'])
            for bad in [dict(output.value,extra='PRIVATE_SENTINEL'),dict(output.value,errors=['PRIVATE_SENTINEL']),dict(output.value,complete=False),dict(output.value,exitCode=1),dict(output.value,oversizedLines=-1)]:
                p.write_text(json.dumps(bad));self.assertEqual(b.node_startup_observation(ns['BASE']),{'available':False})

    def test_final_receipt_helper_hash_is_checked_before_execution(self):
        with tempfile.TemporaryDirectory() as t:
            ns=host();ns['RELEASE']=pathlib.Path(t);helper=ns['RELEASE']/'deploy/prover/bootstrap.py';helper.parent.mkdir(parents=True);helper.write_bytes(pathlib.Path(b.__file__).read_bytes())
            ns['PINS']['startup']=hashlib.sha256(helper.read_bytes()).hexdigest();calls=[]
            ns['run']=lambda args,**kw:(calls.append((args,kw)) or '{"available":false}')
            self.assertEqual(ns['startup_observation'](),{'available':False});self.assertEqual(len(calls),1);self.assertEqual(calls[0][1]['timeout'],3)
            helper.write_text('PRIVATE_SENTINEL');self.assertEqual(ns['startup_observation'](),{'available':False});self.assertEqual(len(calls),1)

    def test_forwarded_termination_reaps_exact_child_and_retains_signal(self):
        import sys,time,signal
        with tempfile.TemporaryDirectory() as t:
            script="""import importlib.util,pathlib,subprocess,sys,signal,os
spec=importlib.util.spec_from_file_location('b',sys.argv[1]);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
base=pathlib.Path(sys.argv[2]);original=subprocess.Popen
def spawn(args,**kw):
 return original([sys.executable,'-c',"import pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text('ready');time.sleep(20)",str(base/'ready')],**kw)
b.subprocess.Popen=spawn
code=b.node_wrapper(['/usr/bin/docker','run',b.IMAGE,'testnet'],base)
if code<0:signal.signal(-code,signal.SIG_DFL);os.kill(os.getpid(),-code)
raise SystemExit(code)
"""
            # This test owns a separate group, including its disposable grandchild.
            # A failed readiness assertion must not leave inherited pipes open.
            process=subprocess.Popen([sys.executable,'-c',script,b.__file__,t],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            try:
                self.assertEqual(os.getpgid(process.pid),process.pid)
                deadline=time.monotonic()+3
                while not (pathlib.Path(t)/'ready').exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue((pathlib.Path(t)/'ready').exists());process.send_signal(signal.SIGTERM)
                stdout,stderr=process.communicate(timeout=3);self.assertEqual(process.returncode,-15);self.assertEqual(stdout,b'');self.assertEqual(stderr,b'')
                observed=b.node_startup_observation(pathlib.Path(t));self.assertEqual(observed['signal'],15);self.assertTrue(observed['complete'])
            finally:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                try:process.communicate(timeout=2)
                finally:
                    for stream in (process.stdout,process.stderr):stream.close()
                self.assertIsNotNone(process.poll())
                gone=False;cleanup_deadline=time.monotonic()+1
                while time.monotonic()<cleanup_deadline:
                    try:os.killpg(process.pid,0)
                    except ProcessLookupError:gone=True;break
                    time.sleep(.01)
                self.assertTrue(gone,'Owned disposable process group was not reaped')

    def test_real_disposable_process_exit_and_signal_are_preserved_without_raw_output(self):
        # Real short Python children stand in for Docker; no Docker/service runs.
        import sys
        original=subprocess.Popen
        for ending,expected in [('raise SystemExit(7)',7),('os.kill(os.getpid(),signal.SIGTERM)',-15)]:
            with self.subTest(ending=ending),tempfile.TemporaryDirectory() as t:
                ns=host();ns['BASE']=pathlib.Path(t);calls=[]
                def spawn(args,**kw):
                    calls.append(args)
                    return original([sys.executable,'-c',"import os,signal;print('Genesis archive root: PRIVATE_SENTINEL',flush=True);"+ending],**kw)
                with patch.object(ns['subprocess'],'Popen',side_effect=spawn):
                    code=b.node_wrapper(['/usr/bin/docker','run',b.IMAGE,'testnet'],ns['BASE'])
                self.assertEqual(code,expected);self.assertEqual(len(calls),1)
                observed=b.node_startup_observation(ns['BASE']);self.assertTrue(observed['complete']);self.assertTrue(observed['available'])
                self.assertIn('process-spawned',observed['stages']);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(observed))
                self.assertEqual(observed['exitCode'],7 if expected==7 else None);self.assertEqual(observed['signal'],15 if expected<0 else None)

    def test_real_child_fsync_enospc_is_reaped_and_original_error_preserved(self):
        import errno,sys,time
        original_spawn=subprocess.Popen;original_fsync=b.os.fsync
        for ignore_term in [False,True]:
            with self.subTest(ignore_term=ignore_term),tempfile.TemporaryDirectory() as t:
                children=[];post_spawn_syncs=0;failure=OSError(errno.ENOSPC,'PRIVATE_SENTINEL')
                def spawn(args,**kw):
                    code="import signal,time;"+("signal.signal(signal.SIGTERM,signal.SIG_IGN);" if ignore_term else '')+"print('ready',flush=True);time.sleep(30)"
                    child=original_spawn([sys.executable,'-c',code],**kw);children.append(child)
                    self.assertEqual(child.stdout.readline(),b'ready\n');return child
                def fsync(fd):
                    nonlocal post_spawn_syncs
                    # Source mounting has its own durable writes before Popen.
                    # Fail the first node-startup persistence after this child
                    # actually exists, independent of that earlier write count.
                    if children:
                        post_spawn_syncs+=1
                        if post_spawn_syncs==1:raise failure
                    return original_fsync(fd)
                started=time.monotonic()
                try:
                    with patch.object(b.subprocess,'Popen',side_effect=spawn),patch.object(b.os,'fsync',side_effect=fsync):
                        with self.assertRaises(OSError) as caught:b.node_wrapper(['/usr/bin/docker','run',b.IMAGE,'testnet'],pathlib.Path(t))
                    self.assertIs(caught.exception,failure);self.assertLess(time.monotonic()-started,5)
                    self.assertGreaterEqual(post_spawn_syncs,1)
                    self.assertEqual(len(children),1);self.assertIsNotNone(children[0].poll())
                    self.assertTrue(failure.node_cleanup['reaped']);self.assertEqual(failure.node_cleanup['killSent'],ignore_term);self.assertFalse(failure.node_cleanup['failed'])
                    observed=b.node_startup_observation(pathlib.Path(t));self.assertTrue(observed['available']);self.assertEqual(observed['cleanup'],failure.node_cleanup)
                    self.assertNotIn('PRIVATE_SENTINEL',json.dumps(observed));self.assertEqual(observed['signal'],9 if ignore_term else 15)
                finally:
                    for child in children:
                        if child.poll() is None:child.kill();child.wait(timeout=2)

    def test_stage_hook_command_is_narrow_and_preserves_prior_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);args=['/usr/bin/docker','run','--log-driver','none','--entrypoint','node',b.IMAGE,'--no-warnings','/usr/src/yarn-project/aztec/dest/bin/index.js','start','--node','--network','testnet']
            actual=b.instrument_node_args(args,base)
            self.assertEqual(args[args.index(b.IMAGE)+1:],actual[actual.index(b.IMAGE)+3:])
            self.assertIn(str(base/'startup-code')+':/usr/src/yarn-project/rolling:ro',actual)
            self.assertIn(str(base/'startup-stages')+':/rolling-startup',actual)
            self.assertEqual(actual[actual.index(b.IMAGE)+1:actual.index(b.IMAGE)+3],['--import','/usr/src/yarn-project/rolling/deploy/prover/startup-stages.mjs'])
            self.assertEqual((base/'startup-stages').stat().st_mode & 0o777,0o700)
            actual_files={str(p.relative_to(base/'startup-code')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (base/'startup-code').rglob('*') if p.is_file()}
            self.assertEqual(actual_files,b.STARTUP_SOURCES)
            self.assertFalse(any(p.name=='node_modules' for p in (base/'startup-code').rglob('*')))
            self.assertFalse(any('ROLLING_COMPACT_TIER=' in arg for arg in actual))
            with self.assertRaises(FileExistsError):b.instrument_node_args(args,base)
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);prior=base/'startup-code';prior.mkdir(mode=0o700)
            marker=prior/'node_modules';marker.write_text('prior-owned-data')
            with self.assertRaises(FileExistsError):b.instrument_node_args(args,base)
            self.assertEqual(marker.read_text(),'prior-owned-data')
        self.assertEqual(hashlib.sha256((pathlib.Path(b.__file__).parent/'startup-stages.mjs').read_bytes()).hexdigest(),b.STARTUP_HELPER_SHA)

    def test_complete_source_closure_is_checked_before_any_mount_write(self):
        # Actual pinned files, not a synthetic helper graph. Requires reviewed
        # lead helper composition; cannot pass using the historical single file.
        captured=b.startup_sources(ROOT)
        self.assertEqual(set(captured),set(b.STARTUP_SOURCES))
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t)/'source';root.mkdir()
            for rel,raw in captured.items():
                p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
            self.assertEqual(b.startup_sources(root),captured)
            rel='prover/compact-block-native.mjs';p=root/rel
            for failure in ('changed','missing','symlink','oversized'):
                if p.exists() or p.is_symlink():p.unlink()
                if failure=='changed':p.write_bytes(captured[rel]+b' ')
                elif failure=='symlink':p.symlink_to(ROOT/rel)
                elif failure=='oversized':p.write_bytes(b'x'*1048577)
                base=pathlib.Path(t)/failure;base.mkdir()
                with patch.object(b,'__file__',str(root/'deploy/prover/bootstrap.py')):
                    with self.assertRaises((OSError,ValueError)):b.instrument_node_args(['/usr/bin/docker','run',b.IMAGE],base)
                self.assertEqual(list(base.iterdir()),[])

    def test_actual_js_record_agrees_with_python_projection(self):
        import os
        node=os.environ.get('PROVER_VALIDATION_NODE','node')
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);directory=base/'startup-stages';directory.mkdir(mode=0o700)
            helper=pathlib.Path(b.__file__).parent/'startup-stages.mjs'
            code="import {createRecorder,PHASES} from "+json.dumps(helper.as_uri())+";const record=createRecorder(process.argv[1],process.argv[2]);if(!record('factory','begin')||!record('factory-bb','begin')||!record('factory-bb','complete'))throw Error('fixture');record.observe('started');record.observe('head',100n);record.observe('local',99n);record.observe('checkpoint',7);record.observe('failed',{category:'http',httpStatus:429,rpcCode:null});if(!record.flush())throw Error('fixture');process.stdout.write(JSON.stringify(PHASES));"
            result=subprocess.run([node,'--input-type=module','--eval',code,str(directory),b.STARTUP_HELPER_SHA],capture_output=True,text=True,timeout=3,check=True)
            self.assertEqual(json.loads(result.stdout),list(b.DIAGNOSTIC_PHASES))
            observation=b.stage_observation(base);self.assertTrue(observation['available']);self.assertEqual(observation['runtimeAdapter'],'publicnode-config-v1')
            self.assertEqual(observation['history'],[['factory','begin'],['factory-bb','begin'],['factory-bb','complete']])
            self.assertEqual(observation['schemaVersion'],2)
            self.assertEqual(observation['archiver']['error'],{'category':'http','httpStatus':429,'rpcCode':None})
            self.assertEqual(observation['archiver']['passesFailed'],1)
            self.assertEqual(observation['archiver']['lastCheckpoint'],7)
            self.assertEqual(observation['archiver']['localL1Block'],99)
            self.assertEqual(observation['archiver']['observedHeadL1Block'],100)

    def test_stage_projection_independent_of_native_output_and_rejects_forged_records(self):
        import os
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);directory=base/'startup-stages';directory.mkdir(mode=0o700);file=directory/'stages.json'
            good={'schemaVersion':2,'archiver':{'passesStarted':0,'passesCompleted':0,'passesFailed':0,'inFlight':False,'lastObservationMs':0,'lastProgressMs':0,'localL1Block':None,'observedHeadL1Block':None,'lastCheckpoint':None,'error':None,'droppedObservations':0},'instrumented':True,'runtimeAdapter':b.STARTUP_ADAPTER,'helperSha256':b.STARTUP_HELPER_SHA,'history':[['factory','begin'],['factory-bb','begin'],['factory-bb','complete']]}
            file.write_text(json.dumps(good));file.chmod(0o600)
            self.assertEqual(b.stage_observation(base),{'available':True,**good})
            output=b.NodeOutput();output.feed(b'__rollingStartupStage("admin-auth","complete"); PRIVATE_SENTINEL\n');output.finish(1)
            self.assertEqual(output.value['stages'],[])
            for bad in [{k:v for k,v in good.items() if k!='runtimeAdapter'},{**good,'runtimeAdapter':'diagnostic-only'},{**good,'extra':'PRIVATE_SENTINEL'},{**good,'helperSha256':'a'*64},{**good,'history':[['factory','complete']]},{**good,'history':[['factory','begin'],['factory-bb','begin'],['factory','complete']]},{**good,'history':[['PRIVATE_SENTINEL','begin']]},{**good,'schemaVersion':True}]:
                file.write_text(json.dumps(bad));self.assertEqual(b.stage_observation(base),{'available':False})
            for patch in [{'passesStarted':True},{'passesFailed':1},{'lastCheckpoint':2**32},{'lastObservationMs':float('nan')},{'lastProgressMs':1},{'inFlight':1},{'secret':'PRIVATE_SENTINEL'},{'error':{'category':'PRIVATE_SENTINEL','httpStatus':None,'rpcCode':None}},{'error':{'category':'http','httpStatus':True,'rpcCode':None}},{'error':{'category':'http','httpStatus':600,'rpcCode':None}},{'error':{'category':'rpc','httpStatus':None,'rpcCode':2**31}},{'error':{'category':'unknown','httpStatus':None,'rpcCode':None,'message':'PRIVATE_SENTINEL'}}]:
                file.write_text(json.dumps({**good,'archiver':{**good['archiver'],**patch}}));self.assertEqual(b.stage_observation(base),{'available':False})
            file.write_text(json.dumps(good))
            for name in ('.stages.failed','.stages.tmp'):
                marker=directory/name;marker.write_text('1');marker.chmod(0o600)
                self.assertEqual(b.stage_observation(base),{'available':False});marker.unlink()
                marker.symlink_to(directory/'absent');self.assertEqual(b.stage_observation(base),{'available':False});marker.unlink()
            file.write_text('x'*8193);self.assertEqual(b.stage_observation(base),{'available':False})
            file.unlink();file.symlink_to(base/'elsewhere');self.assertEqual(b.stage_observation(base),{'available':False})
            file.unlink();os.mkfifo(file,0o600);self.assertEqual(b.stage_observation(base),{'available':False})
            file.unlink();file.write_text(json.dumps(good));file.chmod(0o644);self.assertEqual(b.stage_observation(base),{'available':False})
            file.chmod(0o600);directory.chmod(0o755);self.assertEqual(b.stage_observation(base),{'available':False})

    def test_cleanup_failure_remains_separate_and_bounded(self):
        class Unreapable:
            def __init__(self):self.waits=[];self.kills=0
            def poll(self):return None
            def terminate(self):raise OSError('PRIVATE_SENTINEL')
            def kill(self):self.kills+=1
            def wait(self,timeout):self.waits.append(timeout);raise subprocess.TimeoutExpired('PRIVATE_SENTINEL',timeout)
        child=Unreapable();result,code=b.reap_failed_node(child)
        self.assertTrue(result['failed']);self.assertFalse(result['reaped']);self.assertEqual(child.waits,[2,2]);self.assertEqual(child.kills,1);self.assertIsNone(code)
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))

class NativeVersionDiagnostic(unittest.TestCase):
    """Labelled local doubles; these tests never qualify Linux or call AWS/systemd."""
    def capability(self,path):
        return ('https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com'+path+
                '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ABCDEFGHIJKLMNOP/20261011/eu-west-2/s3/aws4_request'+
                '&X-Amz-Date=20261011T180000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature='+'a'*64)
    def config(self):
        return {'mode':'native-version-only','createdAt':'2026-10-11T18:00:00Z','budgetStop':'2026-10-11T18:45:00Z',
                'commissioningStop':'2026-10-11T18:30:00Z','binarySha256':b.BB_SHA,'binaryBytes':b.NATIVE_BYTES,
                'expectedVersion':b.BB_VERSION,'binaryUrl':self.capability('/releases/native-bb-'+b.BB_SHA+'/bb'),
                'receiptPutUrl':self.capability('/receipts/native-test/final.json')}
    def host(self):
        ns={'PINS':{'bb':b.BB_SHA,'bbVersion':b.BB_VERSION,'bootstrap':'c'*64},'BINARY_BYTES':b.NATIVE_BYTES}
        exec(b.native_control_source()+b.NATIVE_CAPTURE+b.NATIVE_HOST,ns)
        ns['emit_diagnostic']=lambda data:None
        return ns
    def guest(self):
        return {'status':'passed','architecture':'x86_64','libc':{'status':'observed','major':2,'minor':39},'loaderAvailable':True,'os':{'status':'observed','ubuntu2404':True},'cpu':{'status':'observed','processors':2,'vendor':'amd','flags':{k:True for k in ('sse4_2','avx','avx2','avx512f','bmi2','adx')}}}
    def result(self,**changes):
        row={'bytes':0,'sha256':hashlib.sha256(b'').hexdigest(),'truncated':False}
        return {'schemaVersion':1,'started':True,'timeout':False,'reaped':True,'returnCode':0,
                'stdout':dict(row),'stderr':dict(row),'versionMatches':True,**changes}
    def state(self,**changes):
        return {'status':'observed','ActiveState':'inactive','SubState':'dead','Result':'success',
                'ExecMainCode':1,'ExecMainStatus':0,'ExecMainStartTimestampMonotonic':100,**changes}
    def test_closed_config_and_capability_scopes(self):
        good=self.config();self.assertEqual(b.validate_native(good,NOW),good)
        mutations={'mode':'general-runner','binaryBytes':True,'binarySha256':'0'*64,'expectedVersion':'PRIVATE_SENTINEL',
                   'budgetStop':'2026-10-11T19:00:00Z','commissioningStop':'2026-10-11T18:29:00Z',
                   'binaryUrl':self.capability('/releases/other/bb'),'receiptPutUrl':self.capability('/releases/secret')}
        for key,value in mutations.items():
            with self.subTest(key=key),self.assertRaises(ValueError):b.validate_native({**good,key:value},NOW)
        for url in [good['binaryUrl'].replace('https:','http:'),good['binaryUrl']+'#secret',good['binaryUrl'].replace('.s3.eu-west-2.amazonaws.com','.evil.invalid'),good['binaryUrl'].replace('/bb?','/../bb?')]:
            with self.assertRaises(ValueError):b.validate_native({**good,'binaryUrl':url},NOW)
        with self.assertRaises(ValueError):b.validate_native({**good,'command':'whoami'},NOW)
        with self.assertRaises(ValueError):b.validate_native(good,NOW+dt.timedelta(minutes=6))
    def test_explicit_closure_is_exact_and_excludes_node_lifecycle(self):
        import ast
        full={n.name:ast.dump(n,include_attributes=False) for n in ast.parse(b.HOST).body if isinstance(n,ast.FunctionDef)}
        closure={n.name:ast.dump(n,include_attributes=False) for n in ast.parse(b.native_control_source()).body if isinstance(n,ast.FunctionDef)}
        self.assertEqual(set(closure),set(b.NATIVE_REUSE))
        for name in closure:self.assertEqual(closure[name],full[name])
        self.assertNotIn('execute',closure);self.assertNotIn('install_node',closure)
        ns=self.host()
        # Each selected function's global name references must resolve in this
        # finite assembly or builtins; checks nested comprehension code too.
        import builtins,types,dis
        def check(code):
            for instruction in dis.get_instructions(code):
                if instruction.opname in ('LOAD_GLOBAL','LOAD_NAME'):self.assertTrue(instruction.argval in ns or hasattr(builtins,instruction.argval),instruction.argval)
            for constant in code.co_consts:
                if isinstance(constant,types.CodeType):check(constant)
        for name in b.NATIVE_REUSE:check(ns[name].__code__)
        with patch.object(b,'HOST',b.HOST+'\ndef upload_receipt(data): pass\n'):
            with self.assertRaises(b.Invalid):b.native_control_source()
    def test_native_payload_hash_roundtrip_and_normal_gate_unchanged(self):
        with patch.object(b,'require_linux_qualification',side_effect=b.Invalid('Active Linux prover qualification required')) as gate:
            payload=b.generate_native(self.config(),NOW);gate.assert_not_called()
            with self.assertRaises(b.Invalid):b.generate(config(),NOW)
        encoded=payload.split("base64.b64decode('")[1].split("')")[0]
        program=lzma.decompress(base64.b64decode(encoded)).decode();compile(program,'native fixture','exec')
        import ast
        assigns={n.targets[0].id:ast.literal_eval(n.value) for n in ast.parse(program).body if isinstance(n,ast.Assign)}
        source=assigns['SOURCE'];pins=ast.literal_eval(ast.parse(source).body[0].value)
        self.assertEqual(pins['bootstrap'],hashlib.sha256((b.native_control_source()+b.NATIVE_CAPTURE+b.NATIVE_HOST).encode()).hexdigest())
        # Validator field names are public source, not a leaked capability.
        private_config=self.config();self.assertEqual(assigns['CONFIG'],private_config)
        for secret in (private_config['binaryUrl'],private_config['receiptPutUrl'],
                       'ABCDEFGHIJKLMNOP/20261011/eu-west-2/s3/aws4_request','a'*64):
            self.assertNotIn(secret,source);self.assertNotIn(secret,assigns['WORKER'])
        self.assertNotIn('install_node()',source);self.assertNotIn('require_linux_qualification',source)
        self.assertIn("native_execute(CONFIG,WORKER)",program)
        self.assertLessEqual(len(gzip.compress(payload.encode(),mtime=0)),16384)
        # Realistic maximum capability sizes still obey the actual hard cap.
        large=self.config()
        for key in ('binaryUrl','receiptPutUrl'):
            token=''.join(hashlib.sha256((key+str(i)).encode()).hexdigest() for i in range(40))
            large[key]+='&X-Amz-Security-Token='+token
        self.assertLessEqual(len(gzip.compress(b.generate_native(large,NOW).encode(),mtime=0)),16384)
    def test_native_cli_private_exclusive_payload_does_not_promote_gate(self):
        # Real generator subprocess only; decoded host program is never executed.
        with tempfile.TemporaryDirectory(dir='/tmp',prefix='rolling-native-cli-') as t:
            root=pathlib.Path(t).resolve();root.chmod(0o700);private=root/'config.json';output=root/'payload.gz'
            now=dt.datetime.now(dt.timezone.utc).replace(microsecond=0);c=self.config()
            for key,minutes in [('createdAt',0),('budgetStop',45),('commissioningStop',30)]:c[key]=(now+dt.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%SZ')
            private.write_text(json.dumps(c));private.chmod(0o600)
            toolchain=(ROOT/'toolchain.json').read_bytes()
            args=[sys.executable,str(ROOT/'deploy/prover/bootstrap.py'),'--native-version-only','--config',str(private),'--output',str(output)]
            first=subprocess.run(args,capture_output=True,timeout=10)
            self.assertEqual(first.returncode,0);before=output.read_bytes();self.assertLessEqual(len(before),16384)
            self.assertEqual(output.stat().st_mode&0o777,0o600);self.assertNotIn(b'X-Amz',first.stdout+first.stderr)
            for secret in (c['binaryUrl'],c['receiptPutUrl'],'ABCDEFGHIJKLMNOP/20261011/eu-west-2/s3/aws4_request','a'*64):self.assertNotIn(secret.encode(),first.stdout+first.stderr)
            alias=root/'alias';alias.symlink_to(root,target_is_directory=True)
            rejected=subprocess.run(args[:-1]+[str(alias/'rejected.gz')],capture_output=True,timeout=10)
            self.assertNotEqual(rejected.returncode,0);self.assertFalse((root/'rejected.gz').exists())
            second=subprocess.run(args,capture_output=True,timeout=10)
            self.assertNotEqual(second.returncode,0);self.assertEqual(output.read_bytes(),before)
            self.assertEqual((ROOT/'toolchain.json').read_bytes(),toolchain)

    def test_native_retention_is_incoming_order_only_before_execution(self):
        # Labelled systemd transport: exercise the actual generated host helper.
        ns=self.host();events=[];writes={}
        ns['write']=lambda path,text,mode: (events.append(('write',path)),writes.update({str(path):(text,mode)}))
        ns['run']=lambda args,**kw:events.append(tuple(args))
        def capture(args,seconds,limit):
            events.append(tuple(args));self.assertEqual((seconds,limit),(3,4096))
            raw=('Before=rolling-native-version.service timers.target\nAfter=sysinit.target\n' if args[2]=='rolling-budget.timer'
                 else 'Before=shutdown.target\nAfter=rolling-budget.timer basic.target rolling-egress.service\n')
            return {'timeout':False,'returnCode':0,'reaped':True,'stdout':{'truncated':False}},{'stdout':raw.encode()}
        ns['bounded_capture']=capture;ns['native_retain_execution']()
        self.assertEqual(writes,{'/etc/systemd/system/rolling-budget.timer.d/native-version-reference.conf':('[Unit]\nBefore=rolling-native-version.service\n',0o644)})
        for timer in ('budget','commissioning'):
            self.assertIn(('systemctl','is-active','--quiet','rolling-'+timer+'.timer'),events)
        self.assertEqual([e for e in events if e[0]=='systemctl' and e[1] in ('start','stop','restart','enable')],[])

    def test_native_retention_rejects_missing_reverse_or_cyclic_edges(self):
        ns=self.host();ns['write']=lambda *a:None;ns['run']=lambda *a,**k:None
        good_timer={'Before':{ns['NATIVE_UNIT']},'After':set()}
        good_service={'Before':set(),'After':{'rolling-budget.timer'}}
        cases=[({'Before':set(),'After':set()},good_service),
               ({'Before':{ns['NATIVE_UNIT']},'After':{ns['NATIVE_UNIT']}},good_service),
               (good_timer,{'Before':set(),'After':set()}),
               (good_timer,{'Before':{'rolling-budget.timer'},'After':{'rolling-budget.timer'}})]
        for timer,service in cases:
            with self.subTest(timer=timer,service=service):
                ns['native_ordering']=lambda unit:timer if unit=='rolling-budget.timer' else service
                with self.assertRaises(ValueError):ns['native_retain_execution']()

    def test_native_retention_transport_and_projection_fail_closed(self):
        ns=self.host();good={'timeout':False,'returnCode':0,'reaped':True,'stdout':{'truncated':False}}
        for data in (b'Before=x\n',b'Before=x\nAfter=y\nBefore=z\n',b'Before=x x\nAfter=y\n',b'Before=bad name/secret\nAfter=y\n',b'Before=x\nAfter='+b'z'*256):
            ns['bounded_capture']=lambda *a:(good,{'stdout':data})
            with self.assertRaises(ValueError):ns['native_ordering']('rolling-budget.timer')
        for change in ({'timeout':True},{'returnCode':1},{'reaped':False},{'stdout':{'truncated':True}}):
            ns['bounded_capture']=lambda *a:({**good,**change},{'stdout':b'PRIVATE_SENTINEL'})
            with self.assertRaises(ValueError):ns['native_ordering']('rolling-budget.timer')
        calls=[];ns['bounded_capture']=lambda *a:calls.append(a)
        with self.assertRaises(ValueError):ns['native_ordering']('PRIVATE_SENTINEL')
        self.assertEqual(calls,[])

    def test_state_transport_projection_and_finite_valid_fields(self):
        ns=self.host();raw='ActiveState=inactive\nSubState=dead\nResult=success\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=100\n'
        capture={'timeout':False,'returnCode':0,'reaped':True,'stdout':{'truncated':False}}
        ns['bounded_capture']=lambda *args:(capture,{'stdout':raw.encode()})
        self.assertEqual(ns['native_state'](),self.state())
        for bad in [raw.replace('success','PRIVATE_SENTINEL'),raw+'Result=success\n',raw.replace('=100','=9999999999999999999999'),raw.replace('ExecMainStatus=0','ExecMainStatus=-1'),raw.replace('SubState=dead\n','')]:
            ns['bounded_capture']=lambda *args:(capture,{'stdout':bad.encode()})
            self.assertEqual(ns['native_state'](),{'status':'projection-error'})
        ns['bounded_capture']=lambda *args:({**capture,'timeout':True},{'stdout':b'PRIVATE_SENTINEL'})
        self.assertEqual(ns['native_state'](),{'status':'transport-error'})
        def error(*args):raise OSError('PRIVATE_SENTINEL')
        ns['bounded_capture']=error
        self.assertEqual(ns['native_state'](),{'status':'transport-error'})
    def test_result_projection_and_distinct_outcomes(self):
        ns=self.host();good=self.result();self.assertEqual(ns['native_result'](good),good)
        for key,value in [('versionMatches','PRIVATE_SENTINEL'),('returnCode',True),('schemaVersion',True),('stdout',{'bytes':0,'sha256':'PRIVATE_SENTINEL','truncated':False})]:
            with self.assertRaises(ValueError):ns['native_result']({**good,key:value})
        with self.assertRaises(ValueError):ns['native_result']({**good,'secret':'PRIVATE_SENTINEL'})
        cases=[(self.state(),good,'passed'),(self.state(),self.result(timeout=True),'timeout'),
               (self.state(Result='oom-kill'),None,'oom'),(self.state(Result='signal'),None,'signal'),
               (self.state(),self.result(returnCode=1),'nonzero'),(self.state(ActiveState='active'),None,'started'),
               ({'status':'projection-error'},good,'state-unreadable'),(self.state(),None,'unqualified'),
               (self.state(ExecMainCode=0,ExecMainStartTimestampMonotonic=0),good,'unqualified')]
        for state,result,expected in cases:self.assertEqual(ns['native_classify'](state,result),expected)
    def test_download_size_hash_before_executable_permission_no_redirect_proxy(self):
        ns=self.host();payload=b'public-test-binary';ns['BINARY_BYTES']=len(payload);ns['PINS']['bb']=hashlib.sha256(payload).hexdigest()
        class Response:
            status=200
            def __init__(self,data):self.io=io.BytesIO(data)
            def read1(self,size):return self.io.read(size)
            def __enter__(self):return self
            def __exit__(self,*args):pass
        class Opener:
            def __init__(self,data):self.data=data
            def open(self,request,timeout):self.request=request;self.timeout=timeout;return Response(self.data)
        with tempfile.TemporaryDirectory() as t:
            for i,data in enumerate([payload,payload+b'!',payload[:-1],b'X'*len(payload)]):
                target=pathlib.Path(t)/str(i);opener=Opener(data)
                with patch.object(ns['urllib'].request,'build_opener',return_value=opener) as builder:
                    if data==payload:
                        ns['native_fetch'](self.config()['binaryUrl'],target);self.assertEqual(target.stat().st_mode&0o777,0o555)
                    else:
                        with self.assertRaises(ValueError):ns['native_fetch'](self.config()['binaryUrl'],target)
                        self.assertEqual(target.stat().st_mode&0o777,0o600)
                    self.assertEqual(builder.call_args.args[0].proxies,{})
                    with self.assertRaises(ValueError):builder.call_args.args[1].redirect_request(None,None,None,None,None,None)
            old=pathlib.Path(t)/'owned';old.write_bytes(b'prior')
            with self.assertRaises(FileExistsError):ns['native_fetch'](self.config()['binaryUrl'],old)
            self.assertEqual(old.read_bytes(),b'prior')
    def test_guest_preflight_fixed_observed_facts_and_secret_safe_failures(self):
        ns=self.host();cpu=b'processor : 0\nvendor_id : AuthenticAMD\nflags : sse4_2 avx avx2 avx512f bmi2 adx\n\nprocessor : 1\nvendor_id : AuthenticAMD\nflags : sse4_2 avx avx2 avx512f bmi2 adx\n'
        files={'/proc/cpuinfo':cpu,'/usr/lib/os-release':b'ID=ubuntu\nVERSION_ID="24.04"\nHOME_URL="PRIVATE_SENTINEL"\n'}
        ns['native_read']=lambda path,limit:files[path];ns['native_loader']=lambda:True
        capture={'timeout':False,'returnCode':0,'reaped':True,'stdout':{'truncated':False}}
        calls=[]
        def capture_good(args,seconds,limit):calls.append((args,seconds,limit));return capture,{'stdout':b'glibc 2.39\n'}
        ns['bounded_capture']=capture_good
        with patch.object(ns['platform'],'machine',return_value='x86_64'):
            facts=ns['native_guest']();self.assertEqual(facts,self.guest())
            self.assertEqual(calls,[(['/usr/bin/getconf','GNU_LIBC_VERSION'],3,256)])
            self.assertNotIn('PRIVATE_SENTINEL',json.dumps(facts))
            for raw,status in [(b'glibc 2.33\n','observed'),(b'PRIVATE_SENTINEL','projection-error')]:
                ns['bounded_capture']=lambda *args:(capture,{'stdout':raw})
                failed=ns['native_guest']();self.assertEqual(failed['status'],'failed');self.assertEqual(failed['libc']['status'],status);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(failed))
            ns['bounded_capture']=lambda *args:({**capture,'timeout':True},{'stdout':b'PRIVATE_SENTINEL'})
            self.assertEqual(ns['native_guest']()['libc'],{'status':'transport-error'})
            ns['bounded_capture']=capture_good;ns['native_loader']=lambda:False
            self.assertEqual(ns['native_guest']()['status'],'failed')
            ns['native_loader']=lambda:True;files['/proc/cpuinfo']=b'PRIVATE_SENTINEL'
            self.assertEqual(ns['native_guest']()['cpu'],{'status':'projection-error'})
        with patch.object(ns['platform'],'machine',return_value='PRIVATE_SENTINEL'):
            self.assertEqual(ns['native_guest']()['architecture'],'other')
        with self.assertRaises(ValueError):ns['native_cpu'](b'x'*65537)
        with self.assertRaises(ValueError):ns['native_cpu'](cpu.replace(b'processor : 1',b'processor : 0'))
        different=cpu.replace(b'processor : 1\nvendor_id : AuthenticAMD\nflags : sse4_2 avx avx2 avx512f bmi2 adx',b'processor : 1\nvendor_id : AuthenticAMD\nflags : sse4_2 avx avx2 bmi2 adx')
        self.assertFalse(ns['native_cpu'](different)['flags']['avx512f'])
        with self.assertRaises(ValueError):ns['native_os'](b'x'*4097)
        with self.assertRaises(ValueError):ns['native_os'](b'ID=ubuntu\nID=ubuntu\nVERSION_ID=24.04')
        self.assertFalse(ns['native_os'](b'ID=PRIVATE_SENTINEL\nVERSION_ID=24.04')['ubuntu2404'])

    def test_guest_file_reads_are_bounded_and_do_not_follow_aliases(self):
        # Labelled local files only; no real guest/platform inspection.
        ns=self.host()
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);file=root/'facts';file.write_bytes(b'abcd')
            self.assertEqual(ns['native_read'](file,4),b'abcd')
            with self.assertRaises(ValueError):ns['native_read'](file,3)
            alias=root/'alias';alias.symlink_to(file)
            with self.assertRaises(OSError):ns['native_read'](alias,4)
            with self.assertRaises(ValueError):ns['native_read'](root,4)
            with self.assertRaises(FileNotFoundError):ns['native_read'](root/'missing',4)

    def test_capture_is_bounded_and_reaps_timeout_without_raw_output(self):
        ns=self.host()
        result,raw=ns['bounded_capture']([sys.executable,'-c',"import sys;sys.stdout.write('x'*20000)"],2)
        self.assertEqual(result['returnCode'],0);self.assertTrue(result['reaped']);self.assertEqual(result['stdout']['bytes'],20000)
        self.assertTrue(result['stdout']['truncated']);self.assertEqual(len(raw['stdout']),8192)
        result,raw=ns['bounded_capture']([sys.executable,'-c','import time;time.sleep(10)'],.1)
        self.assertTrue(result['timeout']);self.assertTrue(result['reaped']);self.assertLess(result['returnCode'],0)
    def exercise(self,root,fail=None,public_modes=None):
        ns=self.host();events=[];writes={};base=root/'base';base.mkdir();private=root/'private'
        ns.update(BASE=base,PRIVATE=private,NATIVE_ROOT=root/'binary')
        ns['install_controls']=lambda config:events.append('controls')
        ns['verify_controls']=lambda:events.append('verify')
        def download(*args):
            events.append('download')
            if public_modes is not None:public_modes.append(ns['NATIVE_ROOT'].stat().st_mode&0o777)
        ns['native_fetch']=download
        ns['write']=lambda path,text,mode=0o600:writes.update({str(path):text})
        ns['run']=lambda args,**kw:events.append(tuple(args))
        ns['native_state']=lambda:self.state()
        ns['native_ordering']=lambda unit: {'Before':{ns['NATIVE_UNIT']},'After':set()} if unit=='rolling-budget.timer' else {'Before':set(),'After':{'rolling-budget.timer'}}
        ns['native_guest']=lambda:self.guest()
        ns['read_bounded_json']=lambda path:self.result()
        ns['upload_receipt']=lambda data:events.append('upload')
        ns['native_shutdown']=lambda:events.append('shutdown')
        ns['emit_diagnostic']=lambda data:events.append('emit')
        original=ns['exclusive_record']
        def record(path,value):
            if fail=='receipt' and path.name=='native-final.json':raise OSError('PRIVATE_SENTINEL')
            return original(path,value)
        ns['exclusive_record']=record
        if fail=='upload':ns['upload_receipt']=lambda data:(_ for _ in ()).throw(OSError('PRIVATE_SENTINEL'))
        if fail=='controls':ns['verify_controls']=lambda:(_ for _ in ()).throw(ValueError('PRIVATE_SENTINEL'))
        if fail=='guest':ns['native_guest']=lambda:{**self.guest(),'status':'failed'}
        if fail=='retention':ns['native_ordering']=lambda unit:{'Before':set(),'After':set()}
        with patch.object(ns['platform'],'system',return_value='Linux'),patch.object(ns['platform'],'machine',return_value='x86_64'),patch.object(ns['os'],'geteuid',return_value=0):
            if fail in ('receipt','upload'):
                with self.assertRaises(OSError):ns['native_execute'](self.config(),'public worker')
            else:ns['native_execute'](self.config(),'public worker')
        return ns,events,writes
    def test_retention_failure_blocks_native_start_and_preserves_shutdown(self):
        with tempfile.TemporaryDirectory() as t:
            ns,events,writes=self.exercise(pathlib.Path(t),fail='retention')
            self.assertNotIn(('systemctl','start','--wait',ns['NATIVE_UNIT']),events)
            self.assertEqual(events[-1],'shutdown')
            receipt=json.loads((ns['BASE']/'native-final.json').read_text())
            self.assertFalse(receipt['passed']);self.assertEqual(receipt['outcome'],'precondition-or-io-failure')

    def test_public_directory_traversable_under_private_umask_before_download(self):
        # Actual local filesystem modes; service/network calls remain labelled
        # doubles. Other-user execute permission models DynamicUser traversal.
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);modes=[];previous=os.umask(0o077)
            try:
                historical=root/'historical';historical.mkdir(mode=0o755)
                self.assertEqual(historical.stat().st_mode&0o777,0o700)
                ns,events,writes=self.exercise(root,public_modes=modes)
            finally:os.umask(previous)
            self.assertEqual(modes,[0o755]) # observed at actual download boundary
            self.assertTrue(ns['NATIVE_ROOT'].stat().st_mode&0o001)
            self.assertFalse(historical.stat().st_mode&0o001)
            for directory in (ns['BASE'],ns['PRIVATE']):
                self.assertEqual(directory.stat().st_mode&0o777,0o700)
            self.assertEqual((ns['PRIVATE']/'receipt-put.json').stat().st_mode&0o777,0o600)
            self.assertEqual(events[-1],'shutdown')
            self.assertIn('DynamicUser=yes',writes['/etc/systemd/system/rolling-native-version.service'])
    def test_public_directory_collision_never_chmods_existing_directory(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);existing=root/'binary';existing.mkdir(mode=0o700);existing.chmod(0o700)
            sentinel=existing/'retained';sentinel.write_bytes(b'public retained fixture')
            ns,events,writes=self.exercise(root)
            self.assertEqual(existing.stat().st_mode&0o777,0o700)
            self.assertEqual(sentinel.read_bytes(),b'public retained fixture')
            self.assertNotIn('download',events);self.assertEqual(events[-1],'shutdown')
            self.assertEqual(writes,{})
            self.assertEqual(json.loads((ns['BASE']/'native-final.json').read_text())['outcome'],'precondition-or-io-failure')
    def test_public_directory_permission_failure_stops_before_download_and_shuts_down(self):
        with tempfile.TemporaryDirectory() as t:
            real_fchmod=os.fchmod
            def fail_directory(fd,mode):
                if os.fstat(fd).st_mode&0o170000==0o040000:raise OSError('PRIVATE_SENTINEL')
                return real_fchmod(fd,mode)
            with patch.object(os,'fchmod',side_effect=fail_directory):
                ns,events,writes=self.exercise(pathlib.Path(t))
            self.assertNotIn('download',events);self.assertEqual(events[-1],'shutdown');self.assertEqual(writes,{})
            receipt=json.loads((ns['BASE']/'native-final.json').read_text())
            self.assertEqual(receipt['outcome'],'precondition-or-io-failure');self.assertNotIn('PRIVATE_SENTINEL',json.dumps(receipt))
    def test_controls_before_download_unit_isolation_receipt_and_once_intent(self):
        with tempfile.TemporaryDirectory() as t:
            ns,events,writes=self.exercise(pathlib.Path(t))
            self.assertLess(events.index('verify'),events.index('download'));self.assertEqual(events[-1],'shutdown')
            for timer in ('budget','commissioning'):self.assertLess(events.index(('systemctl','is-active','--quiet','rolling-'+timer+'.timer')),events.index('download'))
            unit=writes['/etc/systemd/system/rolling-native-version.service']
            for required in ('DynamicUser=yes','PrivateNetwork=yes','IPAddressDeny=any','MemoryMax=512M','CPUQuota=200%','RuntimeMaxSec=20s','Restart=no','InaccessiblePaths=/var/lib/rolling-bootstrap-private /var/lib/cloud'):self.assertIn(required,unit)
            self.assertNotIn('X-Amz',unit);self.assertNotIn('Environment=',unit)
            receipt=json.loads((ns['BASE']/'native-final.json').read_text());self.assertTrue(receipt['passed']);self.assertFalse(receipt['nodeStartupQualified'])
            self.assertNotIn('X-Amz',json.dumps(receipt));self.assertNotIn('PRIVATE_SENTINEL',json.dumps(receipt))
            self.assertEqual(json.loads((ns['BASE']/'native-intent.json').read_text())['attempts'],1)
            before=events.count('download')
            with patch.object(ns['platform'],'system',return_value='Linux'),patch.object(ns['platform'],'machine',return_value='x86_64'),patch.object(ns['os'],'geteuid',return_value=0):
                with self.assertRaises(FileExistsError):ns['native_execute'](self.config(),'public worker')
            self.assertEqual(events.count('download'),before)
    def test_final_shutdown_even_persistence_upload_or_control_failure(self):
        for failure in ('receipt','upload','controls','guest'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as t:
                ns,events,writes=self.exercise(pathlib.Path(t),failure)
                self.assertEqual(events[-1],'shutdown')
                if failure in ('controls','guest'):self.assertNotIn('download',events)
                if failure=='receipt':self.assertNotIn('upload',events)

class ProverActivation(unittest.TestCase):
    def scope(self):
        return {'schemaVersion':1,'manifestSha256':'b'*64,'catalogSha256':b.CATALOG_SHA,'deploymentEvidenceSha256':'e'*64,
                'chainId':'11155111','rollupVersion':'3409706519','rollupAddress':b.QUALIFICATION['service']['queryNode']['rollupAddress'],
                **{k:'0x'+str(i)*64 for i,k in enumerate(('board','privateFeeAddress','privateBokAddress','boardDeployer','bokOwner','bokOperator'),1)},
                'portalAddress':'0x'+'7'*40,'checkpointNumber':101,'checkpointHash':'0x'+'8'*64}

    def evidence(self,s):
        paths=('billboard/target/rolling_contract-RollingBoard.json','experiments/private-bok/target/private_bok-PrivateBok.json',
               'apps/src/billboard/private_fee_artifact.json','shared/portal-runtime.json')
        files={p:'f'*64 for p in paths}
        e={'schemaVersion':1,'scope':{k:v for k,v in s.items() if k not in ('schemaVersion','deploymentEvidenceSha256')},
           'artifacts':files,'checks':{k:True for k in ('boardConstructor','boardPortalRuntime','boardReady','privateFeeCanonical','bokConstructor','canonicalAnchors')},'bokScope':'constructor-allowlist-only'}
        return e,files

    def path_fixture(self,root):
        # Actual official Node24.21.0 archive link names/targets; only payload
        # bytes are labelled harmless fixtures. No real chown/user/service runs.
        from types import SimpleNamespace
        original_path=pathlib.Path;original_lstat=pathlib.Path.lstat
        release=root/'opt/board-prover/releases/release';release.mkdir(parents=True)
        (root/'etc').mkdir();events=[];created=False
        links={'npm':'../lib/node_modules/npm/bin/npm-cli.js',
               'npx':'../lib/node_modules/npm/bin/npx-cli.js',
               'corepack':'../lib/node_modules/corepack/dist/corepack.js'}
        (release/'node/bin').mkdir(parents=True)
        for name,target in links.items():
            destination=(release/'node/bin'/target).resolve();destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_text('public executable fixture');destination.chmod(0o755)
            (release/'node/bin'/name).symlink_to(target)
        def path(value,*args):return root/'etc/board-prover' if value=='/etc/board-prover' and not args else original_path(value,*args)
        def lstat(value,*args,**kw):
            info=original_lstat(value,*args,**kw)
            # Root ownership is a labelled double; real filesystem types,
            # target resolution and link contents drive the production helper.
            if value.is_relative_to(root):
                values=list(info);values[4]=0;return os.stat_result(values)
            return info
        def user(_):
            if not created:raise KeyError('not allocated')
            return SimpleNamespace(pw_uid=999,pw_gid=998,pw_shell='/usr/sbin/nologin')
        def group(_):
            if not created:raise KeyError('not allocated')
            return SimpleNamespace(gr_gid=998,gr_mem=[])
        def run(args,**kw):
            nonlocal created
            self.assertEqual(args[0],'useradd');events.append(('useradd',));created=True
        def record(path,value):
            events.append(('record',path.name))
            with path.open('x') as f:json.dump(value,f)
        patches=[patch('pwd.getpwnam',side_effect=user),patch('grp.getgrnam',side_effect=group),
                 patch.object(pathlib.Path,'lstat',lstat),patch.object(b,'pathlib',SimpleNamespace(Path=path)),
                 patch.object(b.os,'chown',side_effect=lambda path,uid,gid,**kw:events.append(('chown',path,uid,gid,kw))),
                 patch.object(b.os,'chmod',side_effect=lambda path,mode,**kw:events.append(('chmod',path,mode,kw)))]
        return {'RELEASE':release,'run':run,'exclusive_record':record},events,patches,links

    def test_actual_paths_preserves_official_node_file_links_and_hardens_targets_without_following(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t).resolve();h,events,patches,links=self.path_fixture(root)
            with ExitStack() as stack:
                for p in patches:stack.enter_context(p)
                self.assertEqual(b.activation_paths(h,self.scope()),(999,998))
            for name,target in links.items():
                link=h['RELEASE']/'node/bin'/name;self.assertEqual(os.readlink(link),target)
                self.assertIn(('chown',link,0,998,{'follow_symlinks':False}),events)
                self.assertFalse(any(e[0]=='chmod' and e[1]==link for e in events))
                self.assertIn(('chmod',link.resolve(),0o550,{'follow_symlinks':False}),events)
            self.assertEqual((root/'etc/board-prover/config.json').read_text(),json.dumps(b.activation_config(self.scope())))
            self.assertEqual((h['RELEASE'].parent.parent/'current').resolve(),h['RELEASE'])

    def test_actual_paths_prevalidates_all_links_before_any_identity_or_permission_mutation(self):
        from contextlib import ExitStack
        for kind in ('escape','absolute','directory','loop','dangling'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
                root=pathlib.Path(t).resolve();h,events,patches,_=self.path_fixture(root)
                link=h['RELEASE']/'zz-invalid';outside=root/'outside';outside.write_text('private fixture')
                target={'escape':'../../../../outside','absolute':str(outside),'directory':'node/bin','loop':'zz-invalid','dangling':'absent'}[kind]
                link.symlink_to(target)
                with ExitStack() as stack:
                    for p in patches:stack.enter_context(p)
                    with self.assertRaises(b.Invalid):b.activation_paths(h,self.scope())
                self.assertEqual(events,[]);self.assertEqual(outside.read_text(),'private fixture')
                self.assertFalse((root/'etc/board-prover').exists())

    def test_actual_paths_rejects_late_special_file_or_parent_before_any_mutation(self):
        from contextlib import ExitStack
        for kind in ('fifo','parent','existing-current'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
                root=pathlib.Path(t).resolve();h,events,patches,_=self.path_fixture(root)
                if kind=='fifo':os.mkfifo(h['RELEASE']/'zz-fifo')
                elif kind=='parent':h['RELEASE'].parent.chmod(0o777)
                else:(h['RELEASE'].parent.parent/'current').symlink_to(root/'absent')
                with ExitStack() as stack:
                    for p in patches:stack.enter_context(p)
                    with self.assertRaises(b.Invalid):b.activation_paths(h,self.scope())
                self.assertEqual(events,[])

    def test_actual_unsafe_link_after_durable_intent_shuts_down_and_refuses_replay(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t).resolve();h,events,patches=self.exercise(root)
            ph,pe,pp,_=self.path_fixture(root/'fixture')
            (ph['RELEASE']/'zz-directory').symlink_to('node/bin')
            (ph['RELEASE']/'deploy/prover').mkdir(parents=True)
            (ph['RELEASE']/'deploy/prover/board-prover.service').write_text('public fixture unit')
            (ph['RELEASE']/'prover-release.json').write_text((h['RELEASE']/'prover-release.json').read_text())
            h['RELEASE']=ph['RELEASE'];original_paths=b.activation_paths
            # Replace only the earlier labelled path double with the actual
            # production helper; command and identity doubles remain isolated.
            patches[4]=patch.object(b,'activation_paths',side_effect=original_paths)
            with ExitStack() as stack:
                for p in patches+pp:stack.enter_context(p)
                with self.assertRaises(b.Invalid):b.prover_activation(h,'activate','a'*64)
                self.assertTrue((h['PRIVATE']/'prover-activation-intent.json').exists())
                self.assertEqual(pe,[]);self.assertFalse(any(e and e[0]=='useradd' for e in events))
                self.assertNotIn(('systemctl','unmask','board-prover.service'),events)
                self.assertEqual(events[-1],('systemctl','start','--no-block','rolling-budget.service'))
                before=list(events)
                with self.assertRaisesRegex(b.Invalid,'already attempted'):b.prover_activation(h,'activate','a'*64)
                self.assertEqual(events,before)

    def test_closed_scope_rejects_provider_keys_wrong_network_coercion_and_duplicates(self):
        s=self.scope();self.assertEqual(b.activation_record(s,'b'*64),s)
        class Hostile:
            def __str__(self):raise AssertionError('coercion')
        for changes in ({'url':'PRIVATE_SENTINEL'},{'board':Hostile()},{'chainId':11155111},{'rollupVersion':'2914217885'},
                        {'privateFeeAddress':s['board']},{'board':'0x'+'0'*64},{'checkpointNumber':True},{'checkpointHash':'PRIVATE_SENTINEL'}):
            with self.subTest(keys=list(changes)),self.assertRaises(b.Invalid):b.activation_record({**s,**changes},'b'*64)

    def test_evidence_requires_exact_receipt_scope_artifacts_and_ready_not_opaque_hash(self):
        s=self.scope();e,files=self.evidence(s);self.assertEqual(b.activation_evidence(e,s,files),e)
        variants=[{**e,'checks':{**e['checks'],'boardReady':False}}, {**e,'checks':{**e['checks'],'boardReady':1}},
                  {**e,'scope':{**e['scope'],'board':s['privateFeeAddress']}},{**e,'artifacts':{}},{**e,'bokScope':'full-credit-qualified'}]
        for value in variants:
            with self.assertRaises(b.Invalid):b.activation_evidence(value,s,files)

    def test_prover_configuration_is_fixed_loopback_no_capabilities_admin_or_extra_plugins(self):
        s=self.scope();v=b.activation_config(s)
        self.assertEqual(v['host'],'127.0.0.1');self.assertEqual(v['origins'],[]);self.assertEqual(v['threads'],1)
        self.assertEqual(v['pluginAddresses'],[s['privateBokAddress']]);self.assertEqual(v['queryNode']['maxLagSeconds'],120)
        self.assertNotIn('admin',json.dumps(v));self.assertNotIn('ethRpcUrl',v);self.assertEqual(v['proofs'],'real')

    def rules(self,count=3,uid=999):
        return '*mangle\n'+''.join(':'+c+' ACCEPT [0:0]\n' for c in ('PREROUTING','INPUT','FORWARD','OUTPUT','POSTROUTING'))+f'[{count}:32] -A OUTPUT -m owner --uid-owner {uid} -j MARK --set-xmark 0x14/0xffffffff\nCOMMIT\n'

    def test_uid_rules_reject_missing_duplicate_overwrite_wrong_uid_and_unbounded_output(self):
        self.assertEqual(b.activation_rule_counter(self.rules(),999),3)
        for value in ('',self.rules()+self.rules(),self.rules(uid=998),self.rules().replace('0x14','0x10'),self.rules()+'-A POSTROUTING -j MARK --set-mark 0\n','x'*16385):
            with self.assertRaises(b.Invalid):b.activation_rule_counter(value,999)

    def test_actual_traffic_parser_accepts_closed_header_detail_layouts(self):
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);(base/'interface').write_text('ens5')
            for parent in ('',' parent 1:'):
                for chain in ('',' chain 0'):
                    header=f'filter{parent} protocol all pref 1 fw{chain}'
                    detail=header+' handle 0x14 classid 1:20'
                    for raw in (detail,header+'\n'+detail,'  '+header+'  \n '+detail+' \n'):
                        with self.subTest(parent=parent,chain=chain,header=raw!=detail):
                            calls=[]
                            def run(args,**kw):
                                calls.append(args);return raw if args[0]=='tc' else self.rules()
                            self.assertTrue(all(b.activation_traffic({'BASE':base,'run':run,'verify_controls':lambda:1},999).values()))
                            self.assertEqual([x[0] for x in calls],['tc','iptables-save','ip6tables-save'])

    def test_actual_traffic_parser_rejects_wrong_duplicate_unknown_and_family_mappings(self):
        header='filter protocol all pref 1 fw chain 0';detail=header+' handle 0x14 classid 1:20'
        invalid=['',header,header+'\n'+header+'\n'+detail,detail+'\n'+detail,
                 header+'\n'+detail.replace('0x14','0x15'),header+'\n'+detail.replace('1:20','1:10'),
                 header+'\n'+detail.replace('chain 0','chain 1'),header+'\n'+detail+' extra',
                 header+'\n'+detail.replace('protocol all','protocol ip'),
                 header+'\n'+detail.replace('protocol all','protocol ipv6'),
                 header+'\n'+detail.replace('pref 1','pref 2'),header+'\n'+detail.replace(' fw',' u32'),
                 header+'\n'+detail.replace('filter protocol','filter parent 2: protocol'),
                 header+'\n'+detail.replace(' handle ','handle '),header+'\n'+detail+'\nunknown']
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);(base/'interface').write_text('ens5')
            for raw in invalid:
                with self.subTest(raw=raw):
                    calls=[]
                    def run(args,**kw):calls.append(args);return raw
                    with self.assertRaisesRegex(b.Invalid,'Prover traffic class'):
                        b.activation_traffic({'BASE':base,'run':run,'verify_controls':lambda:1},999,True)
                    self.assertEqual([x[0] for x in calls],['tc'])

    def test_both_address_families_must_execute_owner_mark_and_keep_class_mapping(self):
        with tempfile.TemporaryDirectory() as t:
            base=pathlib.Path(t);(base/'interface').write_text('ens5');calls=[];counts={'iptables-save':0,'ip6tables-save':0}
            def run(args,**kw):
                calls.append(args)
                if args[0]=='tc':return 'filter protocol all pref 1 fw chain 0\nfilter protocol all pref 1 fw chain 0 handle 0x14 classid 1:20'
                if args[0] in counts:
                    counts[args[0]]+=1;return self.rules(counts[args[0]])
            h={'BASE':base,'run':run,'verify_controls':lambda:1}
            self.assertTrue(all(b.activation_traffic(h,999,True).values()))
            self.assertEqual(sum(x[0]=='setpriv' for x in calls),1)
            original=run
            h['run']=lambda args,**kw:self.rules(1) if args[0]=='ip6tables-save' else original(args,**kw)
            with self.assertRaisesRegex(b.Invalid,'UID mark exercise'):b.activation_traffic(h,999,True)

    def exercise(self,root,fail=None):
        private=root/'private';private.mkdir();release=root/'release';(release/'deploy/prover').mkdir(parents=True)
        (release/'deploy/prover/board-prover.service').write_text('public fixture unit')
        s=self.scope();e,files=self.evidence(s);(release/'prover-release.json').write_text(json.dumps({'files':files}))
        events=[];q={'passed':True,'stage':'complete','checks':{'all':True},'anchors':{},'readiness':{}}
        def record(path,value):
            events.append(('record',path.name))
            with open(path,'x') as f:json.dump(value,f)
        def run(args,**kw):
            events.append(tuple(args))
            if fail=='start' and args[:2]==['systemctl','start'] and args[-1]=='board-prover.service':raise OSError('PRIVATE_SENTINEL')
            if args[0] in ('iptables','ip6tables') and args[-1]=='-S':return '\n'.join('-P '+c+' ACCEPT' for c in ('PREROUTING','INPUT','FORWARD','OUTPUT','POSTROUTING'))
        def read(path,expected=None):
            if path.name=='prover-activation-scope.json':return s
            if path.name=='prover-deployment-evidence.json':return e
            return {'manifestSha256':'b'*64,'bootstrapSourceSha256':'d'*64,'qualification':q}
        def identity(*args):
            events.append(('identity',))
            if fail=='identity':raise b.Invalid('scope failed')
            return ready_fixture()
        h={'PRIVATE':private,'BASE':root,'RELEASE':release,'PINS':{'manifest':'b'*64,'bootstrap':'d'*64},'run':run,'exclusive_record':record,
           'verify_release':lambda r:events.append(('verify-release',)),'verify_controls':lambda:events.append(('controls',)),
           'validated_qualification':lambda r:r,'read_bounded_json':lambda p:{'budgetStop':'2099-01-01T00:00:00Z','hostResources':{'dataVolumeGiB':1024,'egressMbps':50}},
           'digest':lambda p:b.PROVER_UNIT_SHA if str(p).endswith('.service') else 'c'*64,'write':lambda *a:events.append(('write-unit',))}
        patches=[patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),
                 patch.object(b,'activation_proxy_masked',side_effect=lambda h:events.append(('proxy-masked',))),
                 patch.object(b,'activation_identity',side_effect=identity),patch.object(b,'activation_paths',side_effect=lambda *a:events.append(('paths',)) or (999,998)),
                 patch.object(b,'activation_traffic',return_value={'ipv4UidMark':True,'ipv6UidMark':True}),
                 patch.object(b,'activation_service'),patch.object(b,'activation_health',return_value={'submitted':0}),
                 patch.object(b.signal,'alarm'),patch.object(b.signal,'signal')]
        return h,events,patches

    def test_one_attempt_intent_precedes_account_rules_unmask_and_start_and_replay_is_refused(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as t,ExitStack() as stack:
            h,events,patches=self.exercise(pathlib.Path(t))
            for p in patches:stack.enter_context(p)
            result=b.prover_activation(h,'activate','a'*64)
            self.assertEqual(result['status'],'active-loopback');self.assertFalse(result['applicationProofQualified'])
            intent=events.index(('record','prover-activation-intent.json'))
            self.assertLess(intent,events.index(('paths',)));self.assertLess(intent,events.index(('systemctl','unmask','board-prover.service')))
            self.assertEqual(events.count(('identity',)),2)
            before=list(events)
            with self.assertRaisesRegex(b.Invalid,'already attempted'):b.prover_activation(h,'activate','a'*64)
            self.assertEqual(before,events)

    def test_scope_failure_never_unmasks_and_ambiguous_start_never_retries_but_shuts_down(self):
        from contextlib import ExitStack
        for failure in ('identity','start'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as t,ExitStack() as stack:
                h,events,patches=self.exercise(pathlib.Path(t),failure)
                for p in patches:stack.enter_context(p)
                with self.assertRaises((b.Invalid,OSError)):b.prover_activation(h,'activate','a'*64)
                self.assertEqual(events[-1],('systemctl','start','--no-block','rolling-budget.service'))
                starts=events.count(('systemctl','start','board-prover.service'));self.assertEqual(starts,1 if failure=='start' else 0)
                self.assertFalse((h['PRIVATE']/'prover-activation-result.json').exists())

    def test_sdk_scope_check_uses_release_artifacts_and_canonical_portal_and_bok_checks(self):
        source=b.ACTIVATION_CHECK
        for token in ('loadRollingArtifacts()','originalContractClassId','currentContractClassId','computeContractAddressFromInstance',
                      'getPublicStorageAt','depositsEnabled()','verifyPortalRuntime','getContractInstanceFromInstantiationParams','await anchor();const ready=',
                      "bokScope:'constructor-allowlist-only'","redirect:'error'",'calls<=7'):
            self.assertIn(token,source)
        self.assertNotIn('process.env',source);self.assertNotIn('sendTx',source);self.assertNotIn('wallet',source)

    def test_live_scope_response_requires_fresh_readiness_and_exact_checkpoint(self):
        s=self.scope();ready=ready_fixture();now=int(dt.datetime.now(dt.timezone.utc).timestamp())
        ready.update(checkedAtSeconds=now,syncedL1Timestamp=str(now-30))
        result={'ready':ready,'scopeVerified':True,'checkpointHash':s['checkpointHash'],'bokScope':'constructor-allowlist-only'}
        h={'RELEASE':pathlib.Path('/public-release'),'readiness_projection':host()['readiness_projection']}
        captured=[]
        h['run']=lambda command,**kw:captured.append(command) or json.dumps(result)
        self.assertEqual(b.activation_identity(h,s),ready)
        self.assertEqual(json.loads(captured[0][-1]),s) # detached argument, never a mutable scope-file reread
        for change in ({'scopeVerified':1},{'checkpointHash':'0x'+'0'*64},{'bokScope':'full'}):
            h['run']=lambda *a,**kw:json.dumps({**result,**change})
            with self.assertRaises(b.Invalid):b.activation_identity(h,s)
        old={**ready,'checkedAtSeconds':now-11,'syncedL1Timestamp':str(now-41)}
        h['run']=lambda *a,**kw:json.dumps({**result,'ready':old})
        with self.assertRaisesRegex(b.Invalid,'Stale'):b.activation_identity(h,s)

    def test_intent_persistence_failure_cannot_allocate_or_unmask_and_still_shuts_down(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as t,ExitStack() as stack:
            h,events,patches=self.exercise(pathlib.Path(t))
            for p in patches:stack.enter_context(p)
            def no_disk(*args):raise OSError('ENOSPC_PRIVATE_SENTINEL')
            h['exclusive_record']=no_disk
            with self.assertRaises(OSError):b.prover_activation(h,'activate','a'*64)
            self.assertNotIn(('paths',),events);self.assertNotIn(('systemctl','unmask','board-prover.service'),events)
            self.assertEqual(events[-1],('systemctl','start','--no-block','rolling-budget.service'))

    def test_pending_attestation_is_not_active_and_expired_intent_fails_closed(self):
        with tempfile.TemporaryDirectory() as t:
            h={'PRIVATE':pathlib.Path(t),'PINS':{'manifest':'b'*64}};now=int(dt.datetime.now(dt.timezone.utc).timestamp())
            intent={'schemaVersion':1,'scopeSha256':'a'*64,'manifestSha256':'b'*64,'startedAt':now,'attempts':1}
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',return_value=intent):
                self.assertEqual(b.prover_activation(h,'observe'),{'proverPolicy':'activation-in-progress','proverActivated':False})
            for stamp in (now-301,now+20,True,'PRIVATE_SENTINEL'):
                with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',return_value={**intent,'startedAt':stamp}),self.assertRaises(b.Invalid):
                    b.prover_activation(h,'observe')

    def test_activation_support_is_source_bound_and_not_automatic_at_qualification(self):
        ns=host();ns['PINS']['startup']='0'*64
        with patch.dict(ns,{'digest':lambda p:'1'*64}):
            with self.assertRaisesRegex(ValueError,'source changed'):ns['activation_support']('activate','a'*64)
        import ast
        functions={n.name:ast.get_source_segment(b.HOST,n) for n in ast.parse(b.HOST).body if isinstance(n,ast.FunctionDef)}
        for name in ('_execute','qualify','final_receipt'):self.assertNotIn('activation_support',functions[name])

class QueryHost(unittest.TestCase):
    def record(self):return {'privateAddress':'10.0.0.4','operatorAuthSha256':'a'*64,'originSecurityGroupId':'sg-'+'b'*17}

    def test_closed_query_config_has_digest_only_and_no_proof_resources(self):
        r=self.record();c=b.query_host_config(r);r['operatorAuthSha256']='c'*64
        self.assertEqual(c['operatorAuthSha256'],'a'*64);self.assertEqual(c['serviceMode'],'query-only');self.assertEqual(c['host'],'10.0.0.4');self.assertEqual(c['port'],8083)
        self.assertEqual(c['queryNode'],b.QUALIFICATION['service']['queryNode']);self.assertEqual(c['origins'],[])
        self.assertFalse({'queueDirectory','board','privateFeeAddress','privateKey','adminKey','receiptPutUrl'}&set(c))
        self.assertEqual(b.validate({**config(),'queryHost':self.record()},NOW)['queryHost'],self.record())
        for key,value in [('privateAddress','8.8.8.8'),('privateAddress','127.0.0.1'),('privateAddress','::1'),('privateAddress',{}),('operatorAuthSha256','key'),('originSecurityGroupId','sg-bad')]:
            with self.subTest(key=key,value=value),self.assertRaises(b.Invalid):b.query_host_record({**self.record(),key:value})
        with self.assertRaises(b.Invalid):b.query_host_record({**self.record(),'key':'PRIVATE_SENTINEL'})

    def test_fixed_query_unit_confines_identity_and_preserves_secret_boundary(self):
        unit=b.query_host_unit(pathlib.Path('/opt/board-prover/releases/rolling-'+'b'*16))
        for item in ['User=rolling-query','Group=rolling-query','SupplementaryGroups=rolling-runtime','Restart=no','KillMode=control-group','TimeoutStopSec=30','MemoryMax=2G','ProtectSystem=strict','/var/lib/rolling-bootstrap-private /var/lib/cloud /var/lib/rolling-admin','StandardOutput=null','prover/start.mjs /etc/rolling-query/config.json']:self.assertIn(item,unit)
        for item in ['--prover','AZTEC_API_KEY','PRIVATE_SENTINEL','ReadWritePaths=','board-prover.service']:self.assertNotIn(item,unit)
        with self.assertRaises(b.Invalid):b.query_host_unit(pathlib.Path('/tmp/other'))

    def test_public_runtime_real_modes_preserve_file_links_and_private_sentinel(self):
        original=pathlib.Path.lstat;gids={};events=[]
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t).resolve();release=root/'releases'/'candidate';release.mkdir(parents=True)
            binary=release/'public-bin';binary.write_text('public');binary.chmod(0o755)
            data=release/'public.json';data.write_text('{}');link=release/'alias';link.symlink_to('public-bin')
            private=root/'private';private.mkdir(mode=0o700);sentinel=private/'cap';sentinel.write_text('PRIVATE_SENTINEL');sentinel.chmod(0o600)
            def lstat(p,*a,**kw):
                result=list(original(p,*a,**kw));result[4]=0
                if p in gids:result[5]=gids[p]
                return os.stat_result(result)
            def chown(p,uid,gid,**kw):events.append((p,uid,gid,kw));gids[p]=gid
            with patch.object(pathlib.Path,'lstat',lstat),patch.object(b.os,'chown',side_effect=chown):
                entries=b.query_public_plan(release);b.query_public_harden(entries,997)
                self.assertEqual(b.query_public_plan(release)[0][1].st_gid,997)
            self.assertEqual(binary.stat().st_mode&0o777,0o550);self.assertEqual(data.stat().st_mode&0o777,0o440)
            self.assertEqual(os.readlink(link),'public-bin');self.assertTrue(all(e[3]=={'follow_symlinks':False} for e in events))
            self.assertEqual(sentinel.read_text(),'PRIVATE_SENTINEL');self.assertEqual(sentinel.stat().st_mode&0o777,0o600);self.assertEqual(private.stat().st_mode&0o777,0o700)
            # Read/traverse group bits are present for the one explicit shared
            # runtime group; no world or private capability access is widened.
            self.assertEqual(binary.stat().st_mode&0o007,0);self.assertEqual(release.stat().st_mode&0o050,0o050)
            release.chmod(0o750) # owned temporary cleanup needs directory writes

    def test_public_plan_rejects_unsafe_links_before_any_ownership_change(self):
        fixture=ProverActivation()
        from contextlib import ExitStack
        for kind in ('outside','directory','loop','dangling','absolute'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
                root=pathlib.Path(t).resolve();h,events,patches,_=fixture.path_fixture(root);link=h['RELEASE']/'bad'
                target={'outside':'../../../outside','directory':'node','loop':'bad','dangling':'absent','absolute':'/etc/passwd'}[kind];link.symlink_to(target)
                with ExitStack() as stack:
                    for item in patches:stack.enter_context(item)
                    with self.assertRaises(b.Invalid):b.query_public_plan(h['RELEASE'])
                self.assertEqual(events,[])

    def test_activation_keeps_query_public_group_and_adds_only_prover_reader(self):
        fixture=ProverActivation()
        from contextlib import ExitStack
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t).resolve();h,events,patches,_=fixture.path_fixture(root);private=root/'private';private.mkdir();(private/'query-host-result.json').write_text('{}');h['PRIVATE']=private
            oldrun=h['run'];members=['rolling-query']
            def run(args,**kw):
                if args[0]=='usermod':self.assertEqual(args,['usermod','--append','--groups','rolling-runtime','board-prover']);members.append('board-prover');events.append(('reader',));return
                return oldrun(args,**kw)
            h['run']=run
            # Preserve the fixture's allocated primary identity while modelling
            # only the separately verified shared public reader group.
            base_group=patches[1].kwargs['side_effect']
            patches[1]=patch('grp.getgrnam',side_effect=lambda name:SimpleNamespace(gr_gid=997,gr_mem=members) if name=='rolling-runtime' else base_group(name))
            with ExitStack() as stack:
                for item in patches:stack.enter_context(item)
                stack.enter_context(patch.object(b,'query_host_readback',return_value={'publicGid':997}))
                self.assertEqual(b.activation_paths(h,fixture.scope()),(999,998))
            self.assertIn(('reader',),events)
            public_chowns=[e for e in events if e[0]=='chown' and e[1].is_relative_to(h['RELEASE'])]
            self.assertTrue(public_chowns);self.assertTrue(all(e[3]==997 for e in public_chowns))
            self.assertEqual(members,['rolling-query','board-prover'])

    def lifecycle_fixture(self,root):
        """Actual files/functions; labelled root IDs, process status and systemd only."""
        from contextlib import ExitStack,contextmanager
        from types import SimpleNamespace
        @contextmanager
        def fixture():
            Path=pathlib.Path;original_stat=Path.stat;original_lstat=Path.lstat;original_fstat=os.fstat;original_lexists=os.path.lexists
            release=root/'opt/board-prover/releases'/('rolling-'+'b'*16);release.mkdir(parents=True)
            (release/'public').write_text('public');(release/'link').symlink_to('public')
            private=root/'private';private.mkdir(mode=0o700);base=root/'base';base.mkdir()
            (root/'etc/systemd/system').mkdir(parents=True);proc=root/'proc/123';proc.mkdir(parents=True)
            state={'created':False,'groups':'998 997','uid':999,'gid':998,'members':['rolling-query'],'show':{'User':'rolling-query','Group':'rolling-query','SupplementaryGroups':'rolling-runtime','Restart':'no','ActiveState':'active','MainPID':'123','DropInPaths':'','MemoryMax':str(2*1024**3)}}
            events=[];owners={};q=self.record();unit=b.query_host_unit(Path('/opt/board-prover/releases')/release.name)
            def mapped(value,*args):
                p=Path(value,*args)
                return root/str(p).lstrip('/') if str(p).startswith(('/etc/','/proc/')) or str(p) in ('/etc','/proc') else p
            def identity(info,p=None):
                v=list(info);v[4]=0
                if p in owners:v[5]=owners[p]
                return os.stat_result(v)
            def lstat(p,*a,**kw):return identity(original_lstat(p,*a,**kw),p)
            def stat(p,*a,**kw):return identity(original_stat(p,*a,**kw),p)
            def save(p,value):
                p=mapped(p);events.append(('record',p.name))
                with p.open('x') as f:json.dump(value,f)
                p.chmod(0o600)
            def write(p,text,mode=0o600):p=mapped(p);p.write_text(text);p.chmod(mode)
            def user(name):
                self.assertEqual(name,'rolling-query')
                if not state['created']:raise KeyError(name)
                return SimpleNamespace(pw_uid=state['uid'],pw_gid=state['gid'],pw_shell='/usr/sbin/nologin')
            def group(name):
                if not state['created']:raise KeyError(name)
                return SimpleNamespace(gr_gid=997 if name=='rolling-runtime' else 998,gr_mem=state['members'] if name=='rolling-runtime' else [])
            def run(args,**kw):
                events.append(tuple(args))
                if args[0]=='groupadd':return ''
                if args[0]=='useradd':state['created']=True;return ''
                if args==['systemctl','show','board-prover.service','--property=LoadState','--value']:return 'masked'
                if args==['ip','-j','-4','address','show']:return json.dumps([{'addr_info':[{'family':'inet','local':q['privateAddress']}]}])
                if args[:3]==['systemctl','show','rolling-query.service']:
                    write(proc/'status','Uid:\t'+('999 '*4).strip()+'\nGid:\t'+('998 '*4).strip()+'\nGroups:\t'+state['groups']+'\n')
                    return '\n'.join(k+'='+v for k,v in state['show'].items())
                if args in (['systemctl','daemon-reload'],['systemctl','start','rolling-query.service'],['systemctl','stop','rolling-query.service'],['systemctl','start','--no-block','rolling-budget.service']):return ''
                raise AssertionError('Unexpected simulated command')
            save(private/'query-host-request.json',q)
            save(private/'final-receipt.json',{'manifestSha256':'b'*64,'bootstrapSourceSha256':'c'*64,'qualification':{'passed':True,'stage':'complete','checks':{'fixture':True},'anchors':{},'readiness':{}}})
            write(base/'deadline.json',json.dumps({'budgetStop':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}))
            h={'PRIVATE':private,'BASE':base,'RELEASE':release,'PINS':{'manifest':'b'*64,'bootstrap':'c'*64,'queryHost':hashlib.sha256(json.dumps(q,sort_keys=True,separators=(',',':')).encode()).hexdigest()},
               'run':run,'exclusive_record':save,'write':write,'digest':lambda p:hashlib.sha256(mapped(p).read_bytes()).hexdigest(),
               'read_bounded_json':lambda p:json.loads(mapped(p).read_text()),'validated_qualification':lambda q:q,'verify_release':lambda p:events.append(('verify-release',)), 'verify_controls':lambda:events.append(('controls',))}
            with ExitStack() as stack:
                for item in [patch.object(b,'pathlib',SimpleNamespace(Path=mapped)),patch.object(Path,'lstat',lstat),patch.object(Path,'stat',stat),
                    patch.object(b.os,'fstat',side_effect=lambda fd:identity(original_fstat(fd))),patch.object(b.os,'geteuid',return_value=0),
                    patch.object(b.os,'chown',side_effect=lambda p,u,g,**kw:owners.__setitem__(mapped(p),g)),
                    patch.object(b.os.path,'lexists',side_effect=lambda p:original_lexists(mapped(p))),patch('pwd.getpwnam',side_effect=user),patch('grp.getgrnam',side_effect=group),
                    patch.object(b,'query_host_unit',side_effect=lambda p:unit if p==release else (_ for _ in ()).throw(AssertionError('Wrong release'))),
                    patch.object(b,'query_host_fresh',side_effect=lambda h:events.append(('fresh-readiness',))),patch.object(b,'activation_proxy_masked',side_effect=lambda h:events.append(('proxy-masked',))),
                    patch.object(b,'query_listener_denials',side_effect=lambda address:events.append(('listener-denials',address)))]:stack.enter_context(item)
                try:yield h,events,state,root
                finally:
                    for p in [release,*release.rglob('*')]:
                        if p.is_dir():p.chmod(0o750)
        return fixture()

    def test_simulated_commissioning_actual_readback_once_and_reader_modes(self):
        with tempfile.TemporaryDirectory() as t,self.lifecycle_fixture(pathlib.Path(t).resolve()) as (h,events,state,root):
            expected={'queryHostPolicy':'active-private-authenticated','queryProofJobsEnabled':False}
            self.assertEqual(b.query_host(h),expected);self.assertEqual(b.query_host(h),expected)
            self.assertEqual(events.count(('systemctl','start','rolling-query.service')),1)
            self.assertLess(events.index(('record','query-host-intent.json')),next(i for i,e in enumerate(events) if e[0]=='groupadd'))
            self.assertEqual(b.query_host_readback(h)['publicGid'],997)
            self.assertEqual((root/'etc/rolling-query/config.json').stat().st_mode&0o777,0o640)
            self.assertEqual(h['RELEASE'].stat().st_mode&0o777,0o550)
            self.assertEqual(h['PRIVATE'].stat().st_mode&0o777,0o700)
            state['members'].append('board-prover');self.assertEqual(b.query_host_readback(h)['publicGid'],997)

    def test_actual_readback_rejects_group_grammar_and_identity_config_unit_drift(self):
        with tempfile.TemporaryDirectory() as t,self.lifecycle_fixture(pathlib.Path(t).resolve()) as (h,events,state,root):
            b.query_host(h)
            for groups in ('997 0','997 996','997 997','998','', '997 bad','0997','997 2147483648','997 +998'):
                with self.subTest(groups=groups):
                    state['groups']=groups
                    with self.assertRaisesRegex(b.Invalid,'Query public group'):b.query_host_readback(h)
            state['groups']='997';self.assertEqual(b.query_host_readback(h)['uid'],999)
            state['uid']=1000
            with self.assertRaisesRegex(b.Invalid,'Query identity'):b.query_host_readback(h)
            state['uid']=999;state['show']['User']='root'
            with self.assertRaisesRegex(b.Invalid,'Query service state'):b.query_host_readback(h)
            state['show']['User']='rolling-query'
            for path,reason in [(root/'etc/rolling-query/config.json','config changed'),(root/'etc/systemd/system/rolling-query.service','unit changed')]:
                before=path.read_bytes();path.write_text('changed')
                with self.assertRaisesRegex(b.Invalid,reason):b.query_host_readback(h)
                path.write_bytes(before)

    def test_retained_state_disappearance_fails_closed_without_second_start(self):
        with tempfile.TemporaryDirectory() as t,self.lifecycle_fixture(pathlib.Path(t).resolve()) as (h,events,state,root):
            b.query_host(h)
            for name in ('request','intent','result'):
                p=h['PRIVATE']/('query-host-'+name+'.json');raw=p.read_bytes();p.unlink()
                with self.subTest(name=name),self.assertRaises((b.Invalid,OSError)):b.query_host(h)
                p.write_bytes(raw);p.chmod(0o600)
            p=h['PRIVATE']/'final-receipt.json';p.unlink()
            with self.assertRaises(OSError):b.query_host(h)
            self.assertEqual(events.count(('systemctl','start','rolling-query.service')),1)
            self.assertEqual(events.count(('systemctl','start','--no-block','rolling-budget.service')),4)

    def test_attestor_bound_opt_in_or_retained_records_cannot_disappear_silently(self):
        for bound,retained in ((True,False),(False,True)):
            with self.subTest(bound=bound,retained=retained),tempfile.TemporaryDirectory() as t:
                ns=host();base=pathlib.Path(t);private=base/'private';private.mkdir();events=[]
                (base/'stage').write_text('installed');(base/'deadline.json').write_text(json.dumps({'budgetStop':'2026-10-12T02:00:00Z','runtimeArchiveSha256':'a'*64,'manifestSha256':'b'*64}))
                if bound:ns['PINS']['queryHost']='d'*64
                if retained:(private/'query-host-intent.json').write_text('{}')
                def support(operation):events.append(('support',operation));raise b.Invalid('labelled lost state')
                def run(args,**kw):events.append(tuple(args));return 'masked'
                ns.update(BASE=base,PRIVATE=private,verify_controls=lambda:1,run=run,activation_support=support,
                          open=lambda *a,**kw:io.StringIO(),write=lambda p,v,*a:pathlib.Path(p).write_text(v))
                ns['attest']()
                self.assertIn(('support','query-observe'),events)
                self.assertIn(('systemctl','start','rolling-budget.service'),events)
                self.assertTrue(any(e[:2]==('systemctl','stop') and 'rolling-query.service' in e for e in events))

    def test_query_payload_existing_compressed_limit_and_bound_opt_in(self):
        text=fixture_generate({**config(),'queryHost':self.record()},NOW)
        self.assertLessEqual(len(gzip.compress(text.encode(),mtime=0)),16384)
        encoded=text.split("base64.b64decode('")[1].split("')")[0]
        program=lzma.decompress(base64.b64decode(encoded)).decode()
        import ast
        source=ast.literal_eval(ast.parse(program).body[0].value)
        pins=ast.literal_eval(ast.parse(source).body[0].value)
        self.assertEqual(pins['queryHost'],hashlib.sha256(json.dumps(self.record(),sort_keys=True,separators=(',',':')).encode()).hexdigest())
        subprocess.run(['/bin/sh','-n'],input=text,text=True,check=True)

    def test_pending_or_existing_intent_never_allocates_or_restarts(self):
        with tempfile.TemporaryDirectory() as t:
            private=pathlib.Path(t);events=[];h={'PRIVATE':private,'run':lambda *a,**k:events.append(a)}
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'query_host_request',return_value=self.record()):
                self.assertEqual(b.query_host(h)['queryHostPolicy'],'pending-qualification')
                (private/'query-host-intent.json').write_text('{}')
                with self.assertRaisesRegex(b.Invalid,'reconcile only'):b.query_host(h)
            self.assertEqual(events,[(['systemctl','stop','rolling-query.service'],),(['systemctl','start','--no-block','rolling-budget.service'],)])

    def test_query_failure_stops_owned_unit_and_shutdown_even_without_result_write(self):
        with tempfile.TemporaryDirectory() as t:
            private=pathlib.Path(t);(private/'final-receipt.json').write_text('{}');events=[]
            h={'PRIVATE':private,'run':lambda args,**kw:events.append(args)}
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=OSError('labelled private read failure')):
                with self.assertRaises(OSError):b.query_host(h)
            self.assertEqual(events,[['systemctl','stop','rolling-query.service'],['systemctl','start','--no-block','rolling-budget.service']])

class ActivationDelivery(unittest.TestCase):
    def request(self,scope=None):
        scope=scope or ProverActivation().scope()
        return {'campaign':'controlled-delivery','scopeBindingSha256':b.activation_delivery_digest(b.activation_delivery_scope(scope)),
          'getUrl':'https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/receipts/controlled-delivery/activation.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ABCDEFGHIJKLMNOP%2F20261011%2Feu-west-2%2Fs3%2Faws4_request&X-Amz-Date=20261011T180000Z&X-Amz-Expires=28800&X-Amz-SignedHeaders=host&X-Amz-Signature='+'a'*64}

    def fixture(self,root):
        private=root/'private';private.mkdir(mode=0o700);release=root/'release';release.mkdir();events=[]
        scope=ProverActivation().scope();evidence,files=ProverActivation().evidence(scope)
        scope['deploymentEvidenceSha256']=hashlib.sha256(json.dumps(evidence,separators=(',',':')).encode()).hexdigest()
        request=self.request(scope);ns=host()
        def record(path,value):events.append(('record',path.name));ns['exclusive_record'](path,value)
        def read(path,expected=None):
            # Actual local files/modes/bytes; root ownership is labelled simulated.
            info=path.lstat();self.assertFalse(path.is_symlink());self.assertEqual(info.st_mode&0o777,0o600)
            raw=path.read_bytes()
            if expected is not None and hashlib.sha256(raw).hexdigest()!=expected:raise b.Invalid('fixture exact file hash')
            return json.loads(raw)
        record(private/'activation-delivery-request.json',request)
        record(private/'final-receipt.json',{'manifestSha256':'b'*64,'bootstrapSourceSha256':'d'*64,'qualification':{'passed':True,'stage':'complete','checks':{'all':True},'anchors':{},'readiness':{}}})
        record(root/'deadline.json',{'budgetStop':config()['budgetStop']});record(release/'prover-release.json',{'files':files})
        h={'PRIVATE':private,'BASE':root,'RELEASE':release,'PINS':{'manifest':'b'*64,'bootstrap':'d'*64,'activationDelivery':b.activation_delivery_digest(request)},
           'exclusive_record':record,'write':ns['write'],'read_bounded_json':read,'verify_controls':lambda:events.append(('controls',)),
           'verify_release':lambda r:events.append(('release',)),'validated_qualification':lambda q:q}
        envelope={'schemaVersion':1,'campaign':request['campaign'],'scope':scope,'evidence':evidence}
        clock=[int(NOW.timestamp())];raw=lambda:json.dumps(envelope,separators=(',',':')).encode()
        return h,events,envelope,clock,raw,read

    def test_delivery_closed_campaign_fixed_object_expiry_and_scope_binding(self):
        request=self.request();self.assertEqual(b.activation_delivery_record(request,config()['budgetStop']),request)
        for changed in [{**request,'campaign':'wrong'}, {**request,'scopeBindingSha256':'x'}, {**request,'extra':True},
                        {**request,'getUrl':request['getUrl'].replace('28800','1')}, {**request,'getUrl':request['getUrl'].replace('activation.json','other.json')},
                        {**request,'getUrl':request['getUrl']+'&versionId=mutable'}, {**request,'getUrl':request['getUrl'].replace('.s3.eu-west-2.amazonaws.com','.invalid')}]:
            with self.subTest(changed=changed.keys()),self.assertRaises(b.Invalid):b.activation_delivery_record(changed,config()['budgetStop'])

    def test_delivery_waits_for_qualification_and_paces_only_completed_404_reads(self):
        with tempfile.TemporaryDirectory() as t:
            h,events,e,clock,raw,read=self.fixture(pathlib.Path(t));private=h['PRIVATE'];final=read(private/'final-receipt.json');(private/'final-receipt.json').unlink()
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',return_value=None) as fetch:
                self.assertEqual(b.activation_delivery(h)['activationDelivery'],'pending-query-qualification');fetch.assert_not_called()
                h['exclusive_record'](private/'final-receipt.json',final)
                for delta in (0,0,29,1):clock[0]+=delta;b.activation_delivery(h)
                self.assertEqual(fetch.call_count,2)
                (private/'final-receipt.json').unlink()
                with self.assertRaisesRegex(b.Invalid,'disappeared'):b.activation_delivery(h)

    def test_delivery_consumes_exact_version_and_bytes_before_existing_once_activation(self):
        with tempfile.TemporaryDirectory() as t:
            h,events,e,clock,raw,read=self.fixture(pathlib.Path(t));private=h['PRIVATE']
            def activate(context,operation,expected=None):
                events.append(('activation',operation));saved=read(private/'activation-delivery-observed.json')
                self.assertEqual(saved['versionId'],'fixed-version');self.assertEqual(saved['objectSha256'],hashlib.sha256(raw()).hexdigest())
                self.assertEqual(read(private/'prover-activation-scope.json',saved['scopeSha256']),e['scope'])
                if operation=='activate':
                    self.assertEqual(expected,saved['scopeSha256']);h['exclusive_record'](private/'prover-activation-intent.json',{})
                    h['exclusive_record'](private/'prover-activation-result.json',{})
                return {'proverPolicy':'active-loopback'}
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',side_effect=lambda url:(raw(),'fixed-version')) as fetch,patch.object(b,'prover_activation',side_effect=activate):
                self.assertEqual(b.activation_delivery(h)['activationDelivery'],'consumed');self.assertEqual(b.activation_delivery(h)['activationDelivery'],'consumed');self.assertEqual(fetch.call_count,1)
            self.assertLess(events.index(('record','activation-delivery-observed.json')),events.index(('activation','activate')))
            self.assertEqual(events.count(('activation','activate')),1)

    def test_delivery_rejects_changed_campaign_scope_evidence_duplicate_and_unknown_fields(self):
        for defect in ('campaign','board','checkpoint','checks','hash','duplicate','extra'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as t:
                h,events,e,clock,raw,read=self.fixture(pathlib.Path(t))
                if defect=='campaign':e['campaign']='other'
                if defect=='board':e['scope']['board']='0x'+'9'*64
                if defect=='checkpoint':e['scope']['checkpointNumber']=0
                if defect=='checks':
                    e['evidence']['checks']['boardReady']=False
                    e['scope']['deploymentEvidenceSha256']=hashlib.sha256(json.dumps(e['evidence'],separators=(',',':')).encode()).hexdigest()
                if defect=='hash':e['scope']['deploymentEvidenceSha256']='0'*64
                if defect=='extra':e['command']='not allowed'
                data=raw() if defect!='duplicate' else raw().replace(b'{',b'{"schemaVersion":1,',1)
                with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',return_value=(data,'v1')),patch.object(b,'prover_activation') as activate:
                    with self.assertRaises((b.Invalid,ValueError)):b.activation_delivery(h)
                    activate.assert_not_called();self.assertFalse((h['PRIVATE']/'activation-delivery-observed.json').exists())

    def test_delivery_missing_or_interrupted_history_is_not_retried(self):
        for defect in ('request','window','attempt','result','pair'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as t:
                h,events,e,clock,raw,read=self.fixture(pathlib.Path(t));p=h['PRIVATE']
                with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',return_value=None) as fetch:
                    b.activation_delivery(h);clock[0]+=30
                    name={'request':'request','window':'window','attempt':'attempt-1','result':'attempt-1-result','pair':'attempt-1'}[defect]
                    (p/('activation-delivery-'+name+'.json')).unlink()
                    if defect=='pair':(p/'activation-delivery-attempt-1-result.json').unlink()
                    with self.assertRaises((b.Invalid,OSError)):b.activation_delivery(h)
                    self.assertEqual(fetch.call_count,1)

    def test_delivery_window_and_sixty_attempts_never_extend(self):
        for count in (0,60):
            with self.subTest(count=count),tempfile.TemporaryDirectory() as t:
                h,events,e,clock,raw,read=self.fixture(pathlib.Path(t));p=h['PRIVATE'];start=clock[0]
                h['exclusive_record'](p/'activation-delivery-window.json',{'startedAt':start,'stopAt':start+1800,'attempts':count,'lastAttemptAt':start+(count-1)*30 if count else None})
                for i in range(1,count+1):
                    h['exclusive_record'](p/('activation-delivery-attempt-'+str(i)+'.json'),{'number':i,'startedAt':start+(i-1)*30})
                    h['exclusive_record'](p/('activation-delivery-attempt-'+str(i)+'-result.json'),{'status':'pending'})
                clock[0]+=1771 if count else 1800
                with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch') as fetch:
                    with self.assertRaises(b.Invalid):b.activation_delivery(h)
                    fetch.assert_not_called()

    def test_delivery_budget_reserve_and_changed_qualification_reject_before_fetch(self):
        for defect in ('budget','qualification','binding'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as t:
                h,events,e,clock,raw,read=self.fixture(pathlib.Path(t))
                if defect=='budget':clock[0]=int(b.timestamp(config()['budgetStop']).timestamp())-899
                if defect=='qualification':
                    final=h['PRIVATE']/'final-receipt.json';value=read(final);value['qualification']['checks']['all']=False
                    final.write_text(json.dumps(value))
                if defect=='binding':h['PINS']['activationDelivery']='0'*64
                with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch') as fetch:
                    with self.assertRaises(b.Invalid):b.activation_delivery(h)
                    fetch.assert_not_called()

    def test_delivery_consumption_crash_never_fetches_or_starts_again(self):
        with tempfile.TemporaryDirectory() as t:
            h,events,e,clock,raw,read=self.fixture(pathlib.Path(t))
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',side_effect=lambda url:(raw(),'v1')) as fetch,patch.object(b,'prover_activation',side_effect=OSError('controlled before activation intent')) as activate:
                with self.assertRaises(OSError):b.activation_delivery(h)
                with self.assertRaisesRegex(b.Invalid,'reconcile only'):b.activation_delivery(h)
                self.assertEqual(fetch.call_count,1);self.assertEqual(activate.call_count,1)

    def test_delivery_rechecks_time_after_download_before_consumption(self):
        with tempfile.TemporaryDirectory() as t:
            h,events,e,clock,raw,read=self.fixture(pathlib.Path(t))
            def fetch(url):clock[0]+=1800;return raw(),'v1'
            with patch.object(b.os,'geteuid',return_value=0),patch.object(b,'activation_private',side_effect=read),patch('time.time',side_effect=lambda:clock[0]),patch.object(b,'activation_delivery_fetch',side_effect=fetch),patch.object(b,'prover_activation') as activate:
                with self.assertRaisesRegex(b.Invalid,'expired'):b.activation_delivery(h)
                activate.assert_not_called()

    def test_delivery_transport_bounds_version_and_sanitizes_errors(self):
        import urllib.request,urllib.error
        from types import SimpleNamespace
        class Response(io.BytesIO):
            status=200
            headers={'x-amz-version-id':'v1'}
        for data,version in ((b'{}','v1'),(b'x'*16385,'v1'),(b'{}','null'),(b'{}',None)):
            response=Response(data);response.headers={'x-amz-version-id':version}
            with patch.object(urllib.request,'build_opener',return_value=SimpleNamespace(open=lambda *a,**k:response)):
                if len(data)<16385 and version=='v1':self.assertEqual(b.activation_delivery_fetch(self.request()['getUrl']),(b'{}','v1'))
                else:
                    with self.assertRaisesRegex(b.Invalid,'^Delivery unavailable$'):b.activation_delivery_fetch(self.request()['getUrl'])
        for code in (404,302,403):
            def fail(*a,**k):raise urllib.error.HTTPError('PRIVATE_SENTINEL',code,'PRIVATE_SENTINEL',{},None)
            with patch.object(urllib.request,'build_opener',return_value=SimpleNamespace(open=fail)):
                if code==404:self.assertIsNone(b.activation_delivery_fetch(self.request()['getUrl']))
                else:
                    with self.assertRaisesRegex(b.Invalid,'^Delivery unavailable$'):b.activation_delivery_fetch(self.request()['getUrl'])

    def test_delivery_payload_binds_opt_in_and_existing_compressed_limit(self):
        text=fixture_generate({**config(),'queryHost':QueryHost().record(),'activationDelivery':self.request()},NOW)
        self.assertLessEqual(len(gzip.compress(text.encode(),mtime=0)),16384)
        import ast
        program=lzma.decompress(base64.b64decode(text.split("base64.b64decode('")[1].split("')")[0])).decode()
        source=ast.literal_eval(ast.parse(program).body[0].value);pins=ast.literal_eval(ast.parse(source).body[0].value)
        self.assertEqual(pins['activationDelivery'],b.activation_delivery_digest(self.request()))
        subprocess.run(['/bin/sh','-n'],input=text,text=True,check=True)

    def test_delivery_attestor_defers_install_then_missing_bound_request_fails_shutdown(self):
        for stage in ('node','installed'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as t:
                ns=host();base=pathlib.Path(t);private=base/'private';private.mkdir();events=[]
                (base/'stage').write_text(stage);(base/'deadline.json').write_text(json.dumps({'budgetStop':config()['budgetStop'],'runtimeArchiveSha256':'a'*64,'manifestSha256':'b'*64}))
                ns['PINS']['activationDelivery']='d'*64
                def support(operation):events.append(operation);raise b.Invalid('controlled missing request')
                ns.update(BASE=base,PRIVATE=private,verify_controls=lambda:1,run=lambda args,**kw:events.append(args) or 'masked',activation_support=support,open=lambda *a,**kw:io.StringIO(),write=lambda p,v,*a:pathlib.Path(p).write_text(v))
                ns['attest']()
                self.assertEqual('delivery' in events,stage=='installed')
                self.assertEqual(['systemctl','start','rolling-budget.service'] in events,stage=='installed')

class BoundedHostResources(unittest.TestCase):
    def test_explicit_development_resources_are_validated_and_immutable(self):
        resources={'dataVolumeGiB':128,'egressMbps':10}
        c={**config(),'hostResources':resources}
        self.assertEqual(b.validate(c,NOW),c)
        generated=fixture_generate(c,NOW)
        self.assertLess(len(gzip.compress(generated.encode(),mtime=0)),16384)
        subprocess.run(['/bin/sh','-n'],input=generated,text=True,check=True)
        ns=host()
        with tempfile.TemporaryDirectory() as t:
            ns['BASE']=pathlib.Path(t);c['budgetStop']='2099-01-01T00:00:00Z'
            ns['immutable_deadline'](c)
            record=json.loads((ns['BASE']/'deadline.json').read_text())
            self.assertEqual(record['hostResources'],resources)
            ns['immutable_deadline'](c)
            with self.assertRaises(ValueError):ns['immutable_deadline']({**c,'hostResources':{'dataVolumeGiB':1024,'egressMbps':50}})

    def test_resources_closed_values_and_generation_host_parity(self):
        import ast
        outer=next(n for n in ast.parse(pathlib.Path(b.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='host_resources')
        inner=next(n for n in ast.parse(b.HOST).body if isinstance(n,ast.FunctionDef) and n.name=='host_resources')
        self.assertEqual(ast.dump(outer,include_attributes=False),ast.dump(inner,include_attributes=False))
        ns=host();good={'dataVolumeGiB':128,'egressMbps':10}
        invalid=[None,[],{},True,{**good,'unknown':1}]
        for key,values in [('dataVolumeGiB',[True,'128',128.0,0,127,256,1025]),('egressMbps',[True,'10',10.0,0,5,25,51])]:
            invalid.extend({**good,key:value} for value in values)
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(b.Invalid):b.validate({**config(),'hostResources':value},NOW)
                with self.assertRaises(ValueError):ns['host_resources'](value)
        for size in (128,1024):
            for rate in (10,50):
                value={'dataVolumeGiB':size,'egressMbps':rate}
                self.assertEqual(b.validate({**config(),'hostResources':value},NOW)['hostResources'],value)
                self.assertEqual(ns['host_resources'](value),value)
        closure={}
        exec(b.native_control_source(),closure)
        self.assertEqual(closure['host_resources'](good),good)

    def test_default_and_explicit_shaper_install_and_independent_verification(self):
        for explicit in (False,True):
            with self.subTest(explicit=explicit),tempfile.TemporaryDirectory() as t:
                ns=host();ns['BASE']=pathlib.Path(t);written={};events=[]
                resources={'dataVolumeGiB':128,'egressMbps':10} if explicit else {'dataVolumeGiB':1024,'egressMbps':50}
                c={**config(),'budgetStop':'2099-01-01T00:00:00Z',**({'hostResources':resources} if explicit else {})}
                ceiling=resources['egressMbps']
                classes='\n'.join('class htb '+h+' '+parent+' rate '+str(rate)+'Mbit ceil '+str(ceiling)+'Mbit burst 1Mb cburst 1Mb\n Sent 123 bytes 1 pkt (dropped 0, overlimits 0 requeues 0)' for h,parent,rate in [('1:1','root',ceiling),('1:10','parent 1:1',ceiling//2),('1:20','parent 1:1',ceiling//2)])
                values={'classes':classes}
                original_write=ns['write']
                def write(path,text,*args):
                    if str(path).startswith(str(ns['BASE'])):original_write(path,text,*args)
                    else:written[str(path)]=text
                def run(args,**kw):
                    events.append(args)
                    if args[:4]==['ip','-j','route','show']:return '[{"dev":"ens5"}]'
                    if args==['tc','-V']:return 'tc utility, iproute2-6.1.0, libbpf 1.3.0'
                    if args[0]=='dpkg-query':return '6.1.0-1ubuntu6.4'
                    if 'class' in args:return values['classes']
                    if 'qdisc' in args:return json.dumps([{'kind':'htb','handle':'1:','root':True,'options':{'default':'0x10'}}])
                ns.update(write=write,run=run)
                ns['install_controls'](c)
                shaper=written['/usr/local/sbin/rolling-egress']
                self.assertIn('rate '+str(ceiling)+'mbit ceil '+str(ceiling)+'mbit',shaper)
                self.assertEqual(shaper.count('rate '+str(ceiling//2)+'mbit ceil '+str(ceiling)+'mbit'),2)
                self.assertEqual(json.loads((ns['BASE']/'deadline.json').read_text())['hostResources'],resources)
                self.assertEqual(ns['verify_controls'](),123)
                for bad in [classes.replace('ceil '+str(ceiling)+'Mbit','ceil 100Mbit',1),classes.replace('rate '+str(ceiling)+'Mbit','rate 1Mbit',1),classes.replace('rate '+str(ceiling//2)+'Mbit','rate 1Mbit',1),classes+ '\n'+classes]:
                    values['classes']=bad
                    with self.assertRaises(ValueError):ns['verify_controls']()
                values['classes']=classes
                record=json.loads((ns['BASE']/'deadline.json').read_text())
                for bad in [None,{}, {'dataVolumeGiB':128,'egressMbps':True}]:
                    (ns['BASE']/'deadline.json').write_text(json.dumps({**record,'hostResources':bad}))
                    with self.assertRaises(ValueError):ns['verify_controls']()
                record.pop('hostResources');(ns['BASE']/'deadline.json').write_text(json.dumps(record))
                with self.assertRaises(KeyError):ns['verify_controls']()
                # Default input cannot silently reinstall over a smaller bound.
                if explicit:
                    (ns['BASE']/'deadline.json').write_text(json.dumps({**record,'hostResources':resources}))
                    with self.assertRaises(ValueError):ns['immutable_deadline']({**config(),'budgetStop':'2099-01-01T00:00:00Z'})

    def test_configured_data_disk_preserves_identity_mount_and_uniqueness_guards(self):
        from types import SimpleNamespace
        for size in (128,1024):
            with self.subTest(size=size),tempfile.TemporaryDirectory() as t:
                ns=host();base=pathlib.Path(t);ns['BASE']=base/'control';ns['BASE'].mkdir()
                resources={'dataVolumeGiB':size,'egressMbps':10 if size==128 else 50}
                (ns['BASE']/'deadline.json').write_text(json.dumps({'hostResources':resources}))
                actual_path=pathlib.Path
                def mapped(value):
                    if actual_path(value).is_relative_to(actual_path(t)):return actual_path(value)
                    self.assertIn(str(value),['/var/lib/rolling-node','/var/lib/rolling-node/data','/etc/fstab'])
                    return actual_path(t)/str(value).lstrip('/')
                ns['pathlib']=SimpleNamespace(Path=mapped)
                fstab=base/'etc/fstab';fstab.parent.mkdir();fstab.write_text('# prior\n')
                # Existing write already receives mapped volume path, but fstab is a literal.
                original_write=ns['write']
                def write(path,text,*args):
                    original_write(mapped(path) if str(path)=='/etc/fstab' else path,text,*args)
                ns['write']=write
                disk={'path':'/dev/nvme1n1','type':'disk','size':size*1024**3,'fstype':None,'mountpoints':[],'uuid':None}
                disks=[disk];commands=[]
                def run(args,**kw):
                    commands.append(args)
                    if args[0]=='lsblk':return json.dumps({'blockdevices':disks})
                    if args[0]=='blkid':return 'uuid-123'
                ns['run']=run
                ns['prepare_data']()
                self.assertIn(['mkfs.ext4','-q','/dev/nvme1n1'],commands)
                self.assertIn(['mount','/var/lib/rolling-node'],commands)
                self.assertIn('UUID=uuid-123 /var/lib/rolling-node ext4 defaults,nosuid,nodev',fstab.read_text())
                disk.update(fstype='ext4',uuid='uuid-123',mountpoints=['/var/lib/rolling-node'])
                commands.clear();ns['prepare_data']()
                self.assertEqual(len(commands),1) # lsblk only, no reformat/remount
                good=dict(disk)
                bad_sets=[[good,dict(good,path='/dev/nvme2n1')],[dict(good,size=(1024 if size==128 else 128)*1024**3)],
                          [dict(good,children=[{}])],[dict(good,mountpoints=['/elsewhere'])],[dict(good,uuid='wrong')],[dict(good,fstype='xfs')]]
                for bad in bad_sets:
                    disks=bad;commands.clear()
                    with self.assertRaises(ValueError):ns['prepare_data']()
                    self.assertEqual([c for c in commands if c[0] in ('mkfs.ext4','mount')],[])
                disks=[good];(ns['BASE']/'volume.json').unlink()
                with self.assertRaisesRegex(ValueError,'Existing filesystem'):ns['prepare_data']()

if __name__=='__main__':unittest.main(verbosity=2)
