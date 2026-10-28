"""Exercise the actual activation functions with local files and labelled service facts."""
import ast
import hashlib
import io
import importlib.util
import json
import os
import pathlib
import re
import stat
import subprocess
import shutil
import shlex
import tempfile
import types
import unittest

SOURCE_FILE = pathlib.Path(__file__).with_name('publish.py')
TREE = ast.parse(SOURCE_FILE.read_text())
FUNCTIONS = ast.Module(body=[node for node in TREE.body if isinstance(node, ast.FunctionDef)], type_ignores=[])


class RepeatPublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.base = self.root / 'ui'
        self.old_ui = self.base / 'releases' / ('a' * 40)
        self.new_ui = self.base / 'releases' / ('b' * 40)
        for directory in (self.old_ui, self.new_ui):
            (directory / 'wallet').mkdir(parents=True)
        (self.old_ui / 'wallet/runtime.json').write_bytes(b'old runtime')
        (self.new_ui / 'wallet/runtime.json').write_bytes(b'new runtime')
        os.symlink(self.old_ui, self.base / 'current')
        self.packet = self.root / ('ui-' + 'b' * 12)
        self.packet.mkdir()
        self.old_source = self.root / 'old-source'
        self.new_source = self.root / 'new-source'
        self.old_source.mkdir()
        self.new_source.mkdir()
        self.unit = self.root / 'application.service'
        self.unit.write_text('WorkingDirectory=' + str(self.old_source) + '\n')
        self.original_unit = self.unit.read_bytes()
        self.caddy = self.root / 'Caddyfile'
        self.caddy.write_bytes(b'existing static routing')
        self.notify = self.root / '90-ui-ready.conf'
        self.notify.write_bytes(b'[Service]\nType=notify\nNotifyAccess=main\n')
        self.pids = {'rolling-application.service': 101, 'rolling-application-proxy.service': 102, 'rolling-query.service': 103}
        self.configured = self.old_source
        self.calls = []
        self.fail_reload = False
        self.fail_readback = False
        proc = self.root / 'proc' / '101'
        proc.mkdir(parents=True)
        os.symlink(self.old_source, proc / 'cwd')
        (proc / 'stat').write_text('101 (node) ' + ' '.join(['S'] + ['0'] * 18 + ['987']))

        def path(value):
            text = str(value)
            return self.root / text.lstrip('/') if text.startswith('/proc/') else pathlib.Path(value)

        self.ns = {'hashlib': hashlib, 'importlib':importlib, 'json': json, 'os': os, 'pathlib': types.SimpleNamespace(Path=path, PurePosixPath=pathlib.PurePosixPath),
                   're': re, 'shlex':shlex, 'stat': stat, 'shutil': shutil, 'PACKET_ROOT': self.root, 'SOURCE': self.old_source, 'RUNNING': self.old_source, 'NEXT': self.new_source,
                   'UI': self.new_ui, 'BASE': self.base, 'P': self.packet, 'CADDY': self.caddy, 'NOTIFY': self.notify,
                   '__file__': str(SOURCE_FILE), 'sha': lambda data: hashlib.sha256(data).hexdigest(),
                   'urllib': types.SimpleNamespace(request=types.SimpleNamespace(urlopen=self.urlopen))}
        exec(compile(FUNCTIONS, str(SOURCE_FILE), 'exec'), self.ns)
        self.ns['run'] = self.run_command
        self.ns['dependency_root'] = lambda source: self.root / 'labelled-existing-dependencies'
        self.native_retention_helper=self.ns['retention_helper']
        self.retention_calls=[]
        self.ns['retention_helper']=lambda:types.SimpleNamespace(ROOTS=(),prune=lambda plan,apply:self.retention_calls.append(plan) or {'applied':True})
        original_atomic = self.ns['atomic']
        self.ns['atomic'] = lambda p, data, mode=0o644, uid=None, gid=None: original_atomic(p, data, mode, os.getuid() if uid is None else uid, os.getgid() if gid is None else gid)
        digest = self.ns['digest']
        self.plan = {'sdkRetention':{'helperSha256':'0'*64,'stagedSources':[]},'commit': 'b' * 40, 'appPid': 101, 'appStartTime': '987', 'appUnit': str(self.unit),
                     'unitFiles': {str(self.unit): digest(self.unit)}, 'configHashes': {}, 'files': {},
                     'protectedPids': {unit: pid for unit, pid in self.pids.items() if unit != 'rolling-application.service'},
                     'expectedCurrentUi': str(self.old_ui), 'caddySha256': digest(self.caddy), 'notifySha256': digest(self.notify)}
        self.ns['m'] = self.plan
        (self.packet / 'plan.json').write_text(json.dumps(self.plan))
        (self.packet / 'application.service.next').write_text('WorkingDirectory=' + str(self.new_source) + '\n')
        self.result = {'schemaVersion': 1, 'dependencyRoot': str(self.ns['dependency_root'](self.old_source)), 'commit': self.plan['commit'], 'source': str(self.new_source), 'ui': str(self.new_ui),
                       'planSha256': digest(self.packet / 'plan.json'), 'publisherSha256': digest(SOURCE_FILE),
                       'expectedCurrentUi': str(self.old_ui), 'caddySha256': self.plan['caddySha256'], 'notifySha256': self.plan['notifySha256'],
                       'unitSha256': digest(self.packet / 'application.service.next'), 'files': {'wallet/runtime.json': digest(self.new_ui / 'wallet/runtime.json')}}
        (self.packet / 'stage-result.json').write_text(json.dumps(self.result))

    def run_command(self, args):
        self.calls.append(args)
        if args == ['systemctl', 'daemon-reload']:
            self.configured = pathlib.Path(self.unit.read_text().strip().split('=', 1)[1])
            if self.fail_reload:
                self.fail_reload = False
                raise RuntimeError('Labelled lost daemon-reload response')
            return ''
        self.assertEqual(args[0:2], ['systemctl', 'show'])
        unit, key = args[2], args[4]
        if key == 'MainPID':
            return str(self.pids[unit])
        if key == 'WorkingDirectory':
            return str(self.configured)
        raise AssertionError(args)

    def urlopen(self, _url, timeout):
        self.assertEqual(timeout, 10)
        if self.fail_readback:
            raise OSError('Labelled static readback failure')
        return io.BytesIO((self.base / 'current/wallet/runtime.json').read_bytes())

    def assert_unchanged_controls(self):
        self.assertEqual(self.ns['digest'](self.caddy), self.plan['caddySha256'])
        self.assertEqual(self.ns['digest'](self.notify), self.plan['notifySha256'])
        self.assertEqual(self.pids, {'rolling-application.service': 101, 'rolling-application-proxy.service': 102, 'rolling-query.service': 103})
        self.assertTrue(all(call[1] in ('show', 'daemon-reload') for call in self.calls))

    def public_routes_fixture(self):
        nodes=[node for node in TREE.body if
               isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='PUBLIC' for target in node.targets) or
               isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Attribute) and isinstance(node.value.func.value,ast.Name) and node.value.func.value.id=='PUBLIC']
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE_FILE),'exec'),self.ns)
        return list(self.ns['PUBLIC'])

    def test_public_routes_accept_exact_current_matcher_without_mutation(self):
        routes=self.public_routes_fixture()
        self.caddy.write_text(':4319 {\n @public path '+' '.join(routes)+' /wallet/* /crs/*\n}\n')
        before=self.caddy.read_bytes()
        self.ns['validate_public_routes']()
        self.assertEqual(self.caddy.read_bytes(),before)
        self.assertEqual(self.calls,[])

    def test_public_routes_reject_each_missing_new_module(self):
        routes=self.public_routes_fixture()
        for missing in ['/home-reader.mjs','/feed-ranking.mjs','/feed-preferences.mjs']:
            with self.subTest(route=missing):
                self.caddy.write_text('@public path '+' '.join(route for route in routes if route!=missing)+'\n')
                with self.assertRaisesRegex(AssertionError,re.escape(missing)):
                    self.ns['validate_public_routes']()
        self.assertEqual(list(self.new_source.iterdir()),[])
        self.assertEqual(self.calls,[])

    def test_public_routes_ignore_comments_other_matchers_and_prefixes(self):
        routes=self.public_routes_fixture();missing='/home-reader.mjs'
        allowed=' '.join(route for route in routes if route!=missing)
        self.caddy.write_text('@public path '+allowed+' /home-reader.mjs.old # '+missing+'\n@other path '+missing+'\n')
        with self.assertRaisesRegex(AssertionError,re.escape(missing)):
            self.ns['validate_public_routes']()

    def test_public_routes_reject_missing_ambiguous_or_changed_matcher_shape(self):
        self.public_routes_fixture()
        for content in ['# @public path /\n','@public {\n path /\n}\n','@public path /\n@public path /reader.mjs\n']:
            self.caddy.write_text(content)
            with self.assertRaisesRegex(AssertionError,'one explicit'):
                self.ns['validate_public_routes']()

    def test_public_route_check_precedes_stage_mutations(self):
        stage=next(node for node in TREE.body if isinstance(node,ast.If) and ast.unparse(node.test)=="mode == 'stage'")
        calls=[ast.unparse(node.value) for node in stage.body if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call)]
        self.assertLess(calls.index('validate_public_routes()'),calls.index('capacity_preflight()'))
        self.assertLess(calls.index('validate_public_routes()'),calls.index('clone_source()'))

    def test_repeat_activation_switches_files_and_future_start_without_restarting(self):
        self.ns['activate']()
        self.assertEqual(os.readlink(self.base / 'current'), str(self.new_ui))
        self.assertEqual(self.configured, self.new_source)
        self.assertEqual((self.packet / 'application.service.before').read_bytes(), self.original_unit)
        self.assert_unchanged_controls()

    def test_retention_helper_exact_hash_and_regular_sibling_required(self):
        helper=self.packet/'prune-inactive-sdk-outputs.py'
        helper.write_bytes(SOURCE_FILE.with_name(helper.name).read_bytes());helper.chmod(0o600)
        self.plan['sdkRetention']['helperSha256']=self.ns['digest'](helper)
        self.assertTrue(callable(self.native_retention_helper().prune))
        helper.write_bytes(helper.read_bytes()+b'\n# changed\n')
        with self.assertRaises(AssertionError):self.native_retention_helper()
        helper.unlink();helper.symlink_to(SOURCE_FILE.with_name(helper.name))
        with self.assertRaises(AssertionError):self.native_retention_helper()

    def test_retention_after_success_preserves_sources_and_explicit_candidate(self):
        staged=str(self.root/'staged-source')
        self.plan['sdkRetention']['stagedSources']=[staged]
        # Existing stage plan hash authenticates every retention option too.
        (self.packet/'plan.json').write_text(json.dumps(self.plan))
        self.result['planSha256']=self.ns['digest'](self.packet/'plan.json')
        (self.packet/'stage-result.json').write_text(json.dumps(self.result))
        def prune(plan,apply):
            self.assertTrue((self.packet/'activation-result.json').exists())
            self.assertTrue((self.packet/'payload-cleanup-result.json').exists())
            self.assertEqual(os.readlink(self.base/'current'),str(self.new_ui))
            self.assertTrue(apply)
            self.assertEqual(set(plan['protected']),{str(self.old_source),str(self.new_source),str(self.old_ui),str(self.new_ui),staged})
            return {'applied':True}
        self.ns['retention_helper']=lambda:types.SimpleNamespace(ROOTS=(),prune=prune)
        self.ns['activate']()
        self.assertTrue(json.loads((self.packet/'sdk-retention-result.json').read_text())['applied'])

    def test_retention_failure_records_cleanup_failure_without_reverting_activation(self):
        def prune(*args,**kwargs):raise AssertionError('private diagnostic must not be serialized')
        self.ns['retention_helper']=lambda:types.SimpleNamespace(ROOTS=(),prune=prune)
        self.ns['activate']()
        self.assertEqual(os.readlink(self.base/'current'),str(self.new_ui))
        self.assertEqual(json.loads((self.packet/'sdk-retention-result.json').read_text()),{'applied':False,'errorType':'AssertionError'})
        self.assertTrue((self.packet/'activation-result.json').exists())

    def test_bad_retention_helper_fails_before_activation(self):
        def invalid():raise AssertionError('helper hash changed')
        self.ns['retention_helper']=invalid
        with self.assertRaises(AssertionError):self.ns['activate']()
        self.assertEqual(os.readlink(self.base/'current'),str(self.old_ui))
        self.assertFalse((self.packet/'activation-result.json').exists())

    def test_readback_failure_restores_exact_pointer_and_unit(self):
        self.fail_readback = True
        with self.assertRaises(OSError):
            self.ns['activate']()
        self.assertEqual(os.readlink(self.base / 'current'), str(self.old_ui))
        self.assertEqual(self.unit.read_bytes(), self.original_unit)
        self.assertEqual(self.configured, self.old_source)
        self.assertTrue((self.new_ui / 'wallet/runtime.json').exists())
        self.assertEqual(self.retention_calls,[])
        self.assert_unchanged_controls()

    def test_daemon_reload_response_failure_restores_unit_without_switching_ui(self):
        self.fail_reload = True
        with self.assertRaises(RuntimeError):
            self.ns['activate']()
        self.assertEqual(os.readlink(self.base / 'current'), str(self.old_ui))
        self.assertEqual(self.unit.read_bytes(), self.original_unit)
        self.assert_unchanged_controls()

    def test_failure_after_pointer_replacement_still_restores_exact_previous_pointer(self):
        original_switch = self.ns['switch_current']
        calls = []

        def fail_after_first_replace(expected, target):
            original_switch(expected, target)
            calls.append(target)
            if len(calls) == 1:
                raise OSError('Labelled directory fsync failure after replace')

        self.ns['switch_current'] = fail_after_first_replace
        with self.assertRaises(OSError):
            self.ns['activate']()
        self.assertEqual(os.readlink(self.base / 'current'), str(self.old_ui))
        self.assertEqual(self.unit.read_bytes(), self.original_unit)
        self.assert_unchanged_controls()

    def test_tampered_staged_wallet_config_refuses_before_activation(self):
        config = self.new_source / 'deploy/runtime-wallet.json'
        config.parent.mkdir(parents=True)
        config.write_bytes(b'changed')
        self.result['walletConfigSha256'] = hashlib.sha256(b'expected').hexdigest()
        (self.packet / 'stage-result.json').write_text(json.dumps(self.result))
        with self.assertRaises(AssertionError):
            self.ns['activate']()
        self.assertEqual(os.readlink(self.base / 'current'), str(self.old_ui))
        self.assertNotIn(['systemctl', 'daemon-reload'], self.calls)

    def bind_wallet(self, selected):
        self.plan['runningWalletFile']=self.plan['configuredWalletFile']=str(selected)
        self.plan['configHashes'][str(selected)]=self.ns['digest'](selected)
        args=['/node','apps/rolling/start.mjs','/public.json',str(selected),'/relay.json']
        (self.root/'proc/101/cmdline').write_bytes(('\0'.join(args)+'\0').encode())
        self.unit.write_text('WorkingDirectory='+str(self.old_source)+'\nExecStart='+shlex.join(args)+'\n')

    def test_wallet_selection_ignores_inherited_override_and_keeps_startup_path(self):
        selected=self.root/'active-wallet.json';selected.write_text('current config')
        self.bind_wallet(selected)
        for source in (self.old_source,self.new_source):
            (source/'deploy').mkdir();(source/'deploy/runtime-wallet.json').write_text('obsolete config')
            self.assertEqual(self.ns['wallet_file'](source),selected)
        updated=self.ns['next_wallet_startup'](self.unit.read_text())
        self.assertEqual(shlex.split(updated.split('ExecStart=')[1])[3],str(selected))
        self.plan['files']['deploy/runtime-wallet.json']={}
        self.assertEqual(self.ns['wallet_file'](self.new_source),self.new_source/'deploy/runtime-wallet.json')
        updated=self.ns['next_wallet_startup'](self.unit.read_text())
        self.assertEqual(shlex.split(updated.split('ExecStart=')[1])[3],str(self.new_source/'deploy/runtime-wallet.json'))

    def test_wallet_selection_rejects_unbound_changed_or_wrong_process_config(self):
        selected=self.root/'active-wallet.json';selected.write_text('current config');self.bind_wallet(selected)
        self.plan['configHashes'].clear()
        with self.assertRaises(AssertionError):self.ns['wallet_file'](self.old_source)
        self.bind_wallet(selected);selected.write_text('changed')
        with self.assertRaises(AssertionError):self.ns['wallet_file'](self.old_source)
        self.bind_wallet(selected);(self.root/'proc/101/cmdline').write_bytes(b'/node\0apps/rolling/start.mjs\0/public.json\0/wrong-wallet.json\0/relay.json\0')
        with self.assertRaises(AssertionError):self.ns['wallet_file'](self.old_source)

    def test_repeat_publication_keeps_independent_running_and_configured_wallets(self):
        running=self.root/'running-wallet.json';running.write_text('old prices');self.bind_wallet(running)
        configured=self.root/'configured-wallet.json';configured.write_text('intended new prices')
        self.plan['configuredWalletFile']=str(configured)
        self.plan['configHashes'][str(configured)]=self.ns['digest'](configured)
        self.unit.write_text(self.unit.read_text().replace(str(running),str(configured)))
        self.assertEqual(self.ns['wallet_file'](self.old_source),running)
        self.assertEqual(self.ns['wallet_file'](self.new_source),configured)
        updated=self.ns['next_wallet_startup'](self.unit.read_text())
        self.assertEqual(shlex.split(updated.split('ExecStart=')[1])[3],str(configured))
        self.unit.write_text(self.unit.read_text().replace(str(configured),'/wrong-config.json'))
        with self.assertRaises(AssertionError):self.ns['wallet_file'](self.new_source)
        self.assertEqual(self.ns['wallet_file'](self.old_source),running)

    def test_static_fee_override_cannot_change_contracts_or_providers(self):
        name='deploy/runtime-wallet.json'
        self.assertEqual(str(self.ns['safe_relative'](name)),name)
        with self.assertRaises(AssertionError):self.ns['safe_relative']('deploy/credentials.json')
        old={'config':{'board':{'contractAddress':'board'},'privateFee':{'gasSettings':{'maxFeesPerGas':{'feePerDaGas':'0','feePerL2Gas':'2'},'gasLimits':{'l2Gas':'100'}}}},'trustedQuery':{'url':'original'}}
        for root in (self.old_source,self.packet/'files'):(root/'deploy').mkdir(parents=True,exist_ok=True)
        (self.old_source/name).write_text(json.dumps(old))
        running=self.root/'still-running-wallet.json';prior=json.loads(json.dumps(old));prior['config']['board']['contractAddress']='prior-board';running.write_text(json.dumps(prior))
        self.bind_wallet(running)
        self.plan['configuredWalletFile']=str(self.old_source/name)
        self.plan['configHashes'][str(self.old_source/name)]=self.ns['digest'](self.old_source/name)
        self.unit.write_text(self.unit.read_text().replace(str(running),str(self.old_source/name)))
        new=json.loads(json.dumps(old));new['config']['privateFee']['gasSettings']['maxFeesPerGas']['feePerL2Gas']='20'
        self.ns['m']['files']={name:{}}
        target=self.packet/'files'/name;target.write_text(json.dumps(new))
        self.ns['validate_fee_override']()
        for mutate in ('provider','contract','gas-limit'):
            bad=json.loads(json.dumps(new))
            if mutate=='provider':bad['trustedQuery']['url']='changed'
            elif mutate=='contract':bad['config']['board']['contractAddress']='changed'
            else:bad['config']['privateFee']['gasSettings']['gasLimits']['l2Gas']='200'
            target.write_text(json.dumps(bad))
            with self.assertRaises(AssertionError):self.ns['validate_fee_override']()

    def test_changed_proxy_pid_refuses_before_mutation(self):
        self.pids['rolling-application-proxy.service'] = 999
        with self.assertRaises(AssertionError):
            self.ns['activate']()
        self.assertEqual(self.unit.read_bytes(), self.original_unit)
        self.assertEqual(os.readlink(self.base / 'current'), str(self.old_ui))
        self.assertNotIn(['systemctl', 'daemon-reload'], self.calls)

    def test_changed_static_control_or_pointer_refuses_before_mutation(self):
        for name in ('caddy', 'notify', 'pointer'):
            with self.subTest(name=name):
                original = getattr(self, name).read_bytes() if name != 'pointer' else None
                if name == 'pointer':
                    (self.base / 'current').unlink()
                    os.symlink(self.new_ui, self.base / 'current')
                else:
                    getattr(self, name).write_bytes(b'changed')
                with self.assertRaises(AssertionError):
                    self.ns['activate']()
                self.assertEqual(self.unit.read_bytes(), self.original_unit)
                self.assertNotIn(['systemctl', 'daemon-reload'], self.calls)
                if name != 'pointer':
                    getattr(self, name).write_bytes(original)


    def payload_fixture(self, name='apps/rolling/reader.mjs'):
        for directory in (self.packet / 'files', self.new_source):
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'verified installed payload')
        self.plan['files'] = {name: {'sha256': self.ns['digest'](self.new_source / name), 'previousSha256': None}}
        (self.packet / 'payload.tgz').write_bytes(b'owned uploaded archive')
        self.result['payloadArchiveSha256'] = self.ns['digest'](self.packet / 'payload.tgz')
        (self.packet / 'plan.json').write_text(json.dumps(self.plan))
        self.result['planSha256'] = self.ns['digest'](self.packet / 'plan.json')
        (self.packet / 'stage-result.json').write_text(json.dumps(self.result))
        return name

    def test_success_removes_only_verified_packet_payload_and_keeps_rollback_metadata(self):
        name = self.payload_fixture()
        self.ns['activate']()
        self.assertFalse((self.packet / 'files').exists())
        self.assertFalse((self.packet / 'payload.tgz').exists())
        self.assertEqual((self.new_source / name).read_bytes(), b'verified installed payload')
        self.assertEqual((self.new_ui / 'wallet/runtime.json').read_bytes(), b'new runtime')
        for name in ['plan.json', 'stage-result.json', 'activation-result.json', 'application.service.before',
                     'application.service.next', 'current.before', 'payload-cleanup-result.json']:
            self.assertTrue((self.packet / name).is_file(), name)
        self.assert_unchanged_controls()

    def test_failed_activation_keeps_payload_for_inspection(self):
        name = self.payload_fixture()
        self.fail_readback = True
        with self.assertRaises(OSError): self.ns['activate']()
        self.assertTrue((self.packet / 'files' / name).exists())
        self.assertTrue((self.packet / 'payload.tgz').exists())
        self.assertFalse((self.packet / 'payload-cleanup-result.json').exists())

    def test_cleanup_authenticates_entire_tree_archive_and_installed_copies_before_any_delete(self):
        name = self.payload_fixture()
        for damage in ['extra', 'symlink', 'archive', 'installed', 'static']:
            with self.subTest(damage=damage):
                changed = None
                if damage == 'extra':
                    changed = self.packet / 'files/unrelated'; changed.write_bytes(b'do not delete')
                elif damage == 'symlink':
                    changed = self.packet / 'files/unrelated'; os.symlink(self.old_source, changed)
                else:
                    changed = {'archive': self.packet / 'payload.tgz', 'installed': self.new_source / name,
                               'static': self.new_ui / 'wallet/runtime.json'}[damage]
                    original = changed.read_bytes(); changed.write_bytes(b'tampered')
                with self.assertRaises(AssertionError): self.ns['cleanup_packet_payload'](self.result)
                self.assertTrue((self.packet / 'files' / name).is_file())
                self.assertTrue((self.packet / 'payload.tgz').is_file())
                if damage in ['extra', 'symlink']: changed.unlink()
                else: changed.write_bytes(original)
        self.ns['P'] = self.new_source
        with self.assertRaises(AssertionError): self.ns['cleanup_packet_payload'](self.result)
        self.assertTrue((self.packet / 'files' / name).exists())

    def test_capacity_counts_replacements_and_new_assets_once_before_stage_mutations(self):
        source = self.old_source
        old_bytes, new_bytes = b'old artifact', b'new artifact contents'
        if getattr(self,'large_assets',False):new_bytes*=10000
        asset = '.build/sdk/sdk.mjs'
        manifest = '.build/rolling-wallet/manifest.json'
        for directory in [source, self.packet / 'files']:
            (directory / asset).parent.mkdir(parents=True, exist_ok=True)
            (directory / manifest).parent.mkdir(parents=True, exist_ok=True)
        def description(data):
            return {'files': {'/wallet/sdk.mjs': {'file': asset, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}}
        (source / asset).write_bytes(old_bytes)
        (source / manifest).write_text(json.dumps(description(old_bytes)))
        (self.packet / 'files' / asset).write_bytes(new_bytes)
        (self.packet / 'files' / manifest).write_text(json.dumps(description(new_bytes)))
        (source / 'apps/rolling').mkdir(parents=True)
        (source / 'apps/rolling/live.html').write_bytes(b'page')
        self.ns['PUBLIC'] = {'/': 'live.html'}
        self.plan['files'] = {name: {'sha256': self.ns['digest'](self.packet / 'files' / name)} for name in [asset, manifest]}
        existing = self.base / 'by-hash' / hashlib.sha256(old_bytes).hexdigest() / 'wallet/sdk.mjs'
        existing.parent.mkdir(parents=True); existing.write_bytes(old_bytes)
        payload_bytes = sum((self.packet / 'files' / name).stat().st_size for name in [asset, manifest])
        required_data = payload_bytes + len(new_bytes) + len(b'page') + 1024 * 1024
        if len(new_bytes)>=100*1024:required_data+=len(new_bytes)+65536
        self.ns['shutil'] = types.SimpleNamespace(disk_usage=lambda _: types.SimpleNamespace(free=required_data + 1024**3 - 1))
        with self.assertRaisesRegex(RuntimeError, 'Insufficient disk space'): self.ns['capacity_preflight']()
        self.assertEqual(list(self.new_source.iterdir()), [])
        self.assertFalse((self.base / 'by-hash' / hashlib.sha256(new_bytes).hexdigest()).exists())
        self.ns['shutil'] = types.SimpleNamespace(disk_usage=lambda _: types.SimpleNamespace(free=required_data + 1024**3))
        self.assertEqual(self.ns['capacity_preflight'](), required_data)
        stage = next(node for node in TREE.body if isinstance(node, ast.If) and ast.unparse(node.test) == "mode == 'stage'")
        calls = [ast.unparse(node) for node in stage.body]
        check = next(i for i, value in enumerate(calls) if value == 'capacity_preflight()')
        copy = next(i for i, value in enumerate(calls) if value == 'clone_source()')
        export = next(i for i, value in enumerate(calls) if value.startswith('export_assets('))
        self.assertLess(check, copy); self.assertLess(check, export)


    def test_capacity_includes_brotli_upper_bound_before_any_stage_mutation(self):
        self.large_assets=True
        self.test_capacity_counts_replacements_and_new_assets_once_before_stage_mutations()

    def test_native_overlay_allows_only_the_exact_owner_oracle(self):
        native = 'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js'
        self.assertEqual(str(self.ns['safe_relative'](native)), native)
        for name in ['node_modules/other.js', native + '.backup', 'apps/node_modules/other.js',
                     '../' + native, '/' + native, native.replace('/oracle/', '/oracle/../oracle/'),
                     native.replace('/oracle/', '/oracle//')]:
            with self.subTest(name=name), self.assertRaises(AssertionError): self.ns['safe_relative'](name)

    def test_native_overlay_rejects_symlinked_roots_parents_and_leaf(self):
        native = 'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js'
        for count in [0, 1, 3, len(pathlib.PurePosixPath(native).parts)]:
            with self.subTest(depth=count):
                base = self.root / ('tree-' + str(count)); base.mkdir()
                external = self.root / ('outside-' + str(count)); external.mkdir()
                parts = pathlib.PurePosixPath(native).parts
                link = base.joinpath(*parts[:count]) if count else base
                if count: link.parent.mkdir(parents=True, exist_ok=True)
                else: base.rmdir()
                os.symlink(external, link)
                with self.assertRaises(AssertionError): self.ns['confined_payload_file'](base, native)
                self.assertEqual(list(external.iterdir()), [])

    def test_native_overlay_atomic_write_breaks_old_release_hardlink(self):
        native = 'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js'
        old = self.old_source / native; new = self.new_source / native
        old.parent.mkdir(parents=True); new.parent.mkdir(parents=True)
        old.write_bytes(b'old pinned SDK source'); os.link(old, new)
        self.assertEqual(old.stat().st_ino, new.stat().st_ino)
        target = self.ns['confined_payload_file'](self.new_source, native)
        self.ns['atomic'](target, b'new pinned SDK source', 0o644)
        self.assertEqual(old.read_bytes(), b'old pinned SDK source')
        self.assertEqual(new.read_bytes(), b'new pinned SDK source')
        self.assertNotEqual(old.stat().st_ino, new.stat().st_ino)

    def test_native_overlay_passes_exact_activation_hash_and_payload_cleanup(self):
        native = self.payload_fixture('node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js')
        target = self.new_source / native
        original = target.read_bytes(); target.write_bytes(b'wrong source')
        with self.assertRaises(AssertionError): self.ns['activate']()
        self.assertNotIn(['systemctl', 'daemon-reload'], self.calls)
        target.write_bytes(original); self.ns['activate']()
        self.assertEqual(target.read_bytes(), original)
        self.assertFalse((self.packet / 'files').exists())


class SharedReleaseDependencies(unittest.TestCase):
    """Run production clone/confinement code against real temporary filesystem trees."""
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root = pathlib.Path(temp.name).resolve()
        class HostPath(type(root)):
            # Model root-owned deployment files; retain real type/mode and all
            # real path resolution. No /opt paths or host ownership are changed.
            def lstat(self):
                actual = super().lstat()
                values = list(actual); values[4] = 0
                return os.stat_result(values)
        self.root = HostPath(root)
        self.releases = self.root / 'releases'; self.releases.mkdir()
        self.source = self.releases / 'old'; self.source.mkdir()
        self.next = self.releases / 'new'
        self.dependencies = self.source / 'node_modules'
        self.ethers = self.dependencies / 'ethers/dist/ethers.umd.min.js'
        self.ethers.parent.mkdir(parents=True); self.ethers.write_bytes(b'fixture ethers')
        (self.source / 'shared').mkdir(); (self.source / 'shared/source.mjs').write_bytes(b'fixture source')
        (self.source / 'source-link').symlink_to('shared/source.mjs')
        def host_path(value):
            return self.releases if str(value) == '/opt/rolling-app/releases' else HostPath(value)
        self.ns = {'pathlib': types.SimpleNamespace(Path=host_path, PurePosixPath=pathlib.PurePosixPath),
                   'os': os, 'stat': stat, 're': re, 'shutil': shutil, 'SOURCE': self.source,
                   'NEXT': self.next, 'm': {'files': {}}}
        exec(compile(FUNCTIONS, str(SOURCE_FILE), 'exec'), self.ns)

    def test_repeated_clones_reuse_one_dependency_tree_and_hardlink_only_source(self):
        native = self.ethers.stat(); source = (self.source / 'shared/source.mjs').stat()
        self.ns['clone_source']()
        first = self.next; second = self.releases / 'third'
        self.ns.update(SOURCE=first, NEXT=second); self.ns['clone_source']()
        for release in (first, second):
            self.assertTrue((release / 'node_modules').is_symlink())
            self.assertEqual(os.readlink(release / 'node_modules'), str(self.dependencies))
            self.assertEqual((release / 'shared/source.mjs').stat().st_ino, source.st_ino)
            self.assertEqual(os.readlink(release / 'source-link'), 'shared/source.mjs')
        self.assertEqual(self.ethers.stat().st_ino, native.st_ino)
        self.assertEqual(self.ethers.stat().st_nlink, native.st_nlink)
        real_trees = [p / 'node_modules' for p in self.releases.iterdir() if not (p / 'node_modules').is_symlink()]
        self.assertEqual(real_trees, [self.dependencies])

    def test_only_exact_ethers_asset_can_resolve_through_shared_dependency_root(self):
        self.ns['clone_source'](); asset = self.ns['asset_file']
        name = 'node_modules/ethers/dist/ethers.umd.min.js'
        self.assertEqual(asset(self.next, name).read_bytes(), b'fixture ethers')
        self.assertEqual(asset(self.next, 'shared/source.mjs').read_bytes(), b'fixture source')
        other = self.dependencies / 'ethers/dist/other.js'; other.write_bytes(b'fixture ethers')
        for name in ('node_modules/ethers/dist/other.js', '../old/shared/source.mjs'):
            with self.subTest(name=name), self.assertRaises(AssertionError): asset(self.next, name)
        outside = self.root / 'outside.js'; outside.write_bytes(b'fixture ethers')
        self.ethers.unlink(); self.ethers.symlink_to(outside)
        with self.assertRaises(AssertionError): asset(self.next, 'node_modules/ethers/dist/ethers.umd.min.js')
        (self.next / 'shared/escape.js').symlink_to(outside)
        with self.assertRaises(AssertionError): asset(self.next, 'shared/escape.js')

    def test_dependency_payload_is_rejected_before_clone_or_dependency_mutation(self):
        before = self.ethers.read_bytes()
        for name in ('node_modules/ethers/dist/ethers.umd.min.js',
                     'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js',
                     'nested/node_modules/other.js'):
            self.ns['m']['files'] = {name: {}}
            with self.subTest(name=name), self.assertRaisesRegex(AssertionError, 'cannot mutate shared dependencies'):
                self.ns['clone_source']()
            self.assertFalse(self.next.exists()); self.assertEqual(self.ethers.read_bytes(), before)

    def test_dependency_root_outside_release_tree_or_writable_is_rejected(self):
        self.dependencies.chmod(0o777)
        with self.assertRaises(AssertionError): self.ns['clone_source']()
        self.assertFalse(self.next.exists()); self.dependencies.chmod(0o755)
        outside = self.root / 'external/node_modules'; outside.parent.mkdir()
        shutil.move(self.dependencies, outside); self.dependencies.symlink_to(outside)
        with self.assertRaises(AssertionError): self.ns['clone_source']()
        self.assertFalse(self.next.exists())





class BrotliPublication(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        class HostPath(type(pathlib.Path())):
            def lstat(self):
                fields=list(super().lstat());fields[4]=0
                return os.stat_result(fields)
        self.root=HostPath(self.temp.name).resolve();self.source=self.root/'source';self.source.mkdir()
        self.base=self.root/'public';self.destination=self.base/'release'
        self.node=shutil.which('node');self.assertIsNotNone(self.node)
        self.ns={'pathlib':pathlib,'stat':stat,'os':os,'subprocess':subprocess,'hashlib':hashlib,'json':json,'re':re,
                 'BASE':self.base,'SOURCE':self.source,'m':{'node':self.node},'sha':lambda value:hashlib.sha256(value).hexdigest()}
        exec(compile(FUNCTIONS,str(SOURCE_FILE),'exec'),self.ns)
        original_atomic=self.ns['atomic']
        self.ns['atomic']=lambda p,data,mode=0o644,uid=0,gid=0:original_atomic(p,data,mode,os.getuid(),os.getgid())
        self.data=b'export const example = "verified asset";\n'*4000
        (self.source/'sdk.mjs').write_bytes(self.data)
        self.sha=hashlib.sha256(self.data).hexdigest()
        self.description={'runtime':{'schemaVersion':1},'files':{'/wallet/sdk.mjs':{'file':'sdk.mjs','bytes':len(self.data),'sha256':self.sha}}}
        self.target=self.base/'by-hash'/self.sha/'wallet/sdk.mjs'

    def publish(self,destination=None):
        self.ns['export_assets'](self.source,self.description,destination or self.destination)

    def test_actual_node_brotli_roundtrip_original_hash_and_linked_delivery(self):
        self.publish();sidecar=self.target.with_name('sdk.mjs.br')
        decoded=subprocess.run([self.node,'-e',"process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(0)))"],input=sidecar.read_bytes(),check=True,capture_output=True).stdout
        self.assertEqual(decoded,self.data);self.assertLess(sidecar.stat().st_size,len(self.data))
        self.assertEqual(self.target.read_bytes(),self.data)
        self.assertEqual((self.destination/'wallet/sdk.mjs.br').stat().st_ino,sidecar.stat().st_ino)
        self.assertEqual(stat.S_IMODE(sidecar.stat().st_mode),0o444)
        second=self.base/'second';self.publish(second)
        self.assertEqual((second/'wallet/sdk.mjs.br').stat().st_ino,sidecar.stat().st_ino)
        # Stage inventory naturally binds generated delivery encodings too.
        self.assertIn('wallet/sdk.mjs.br',[str(p.relative_to(second)) for p in second.rglob('*') if p.is_file()])

    def test_json_artifact_sidecar_keeps_exact_content_hash_and_link(self):
        data=json.dumps({'functions':[{'bytecode':'public-compiled-bytecode'}]*5000}).encode()
        (self.source/'board.json').write_bytes(data)
        digest=hashlib.sha256(data).hexdigest()
        self.description['files']={'/wallet/board.json':{'file':'board.json','bytes':len(data),'sha256':digest}}
        self.publish()
        target=self.base/'by-hash'/digest/'wallet/board.json';sidecar=target.with_name('board.json.br')
        decoded=subprocess.run([self.node,'-e',"process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(0)))"],input=sidecar.read_bytes(),check=True,capture_output=True).stdout
        self.assertEqual(decoded,data);self.assertEqual(target.read_bytes(),data)
        self.assertEqual(hashlib.sha256(decoded).hexdigest(),digest)
        self.assertLess(sidecar.stat().st_size,len(data))
        self.assertEqual((self.destination/'wallet/board.json.br').stat().st_ino,sidecar.stat().st_ino)

    def test_corrupt_or_symlink_sidecar_is_rejected_without_replacing_original(self):
        self.publish();sidecar=self.target.with_name('sdk.mjs.br');original=self.target.read_bytes()
        sidecar.unlink();sidecar.write_bytes(b'corrupt');sidecar.chmod(0o444)
        with self.assertRaises(AssertionError):self.publish(self.base/'corrupt')
        sidecar.unlink();sidecar.symlink_to(self.target)
        with self.assertRaises(AssertionError):self.publish(self.base/'symlink')
        self.assertEqual(self.target.read_bytes(),original)

    def test_wrong_decoded_hash_rejected_before_compression_or_publication(self):
        self.description['files']['/wallet/sdk.mjs']['sha256']='0'*64
        self.ns['brotli_bytes']=lambda _:self.fail('Compression preceded input authentication')
        with self.assertRaises(AssertionError):self.publish()
        self.assertFalse(self.base.exists())

    def test_only_large_javascript_and_exact_public_artifacts_are_compressed(self):
        selected=self.ns['brotli_asset']
        self.assertTrue(selected('/wallet/sdk.js',102400));self.assertTrue(selected('/wallet/runtime.mjs',102400))
        for name in ['board','private-fee','bok']+['native-contract-'+name for name in ['ContractClassRegistry','ContractInstanceRegistry','FeeJuice','MultiCallEntrypoint','AuthRegistry','HandshakeRegistry']]:
            self.assertTrue(selected('/wallet/'+name+'.json',102400))
            self.assertFalse(selected('/wallet/'+name+'.json',102399))
        for url,size in [('/crs/data.bin',1000000),('/wallet/runtime.json',1000000),('/wallet/config.json',1000000),('/wallet/native-contract-Unknown.json',1000000),('/wallet/small.js',102399)]:
            self.assertFalse(selected(url,size))

if __name__ == '__main__':
    unittest.main()
