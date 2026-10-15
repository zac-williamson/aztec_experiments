"""Package preflight tests; never build an archive or execute a prover."""
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prover_package', ROOT / 'deploy/prover/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

class PackagePreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'prover').mkdir()
        shutil.copyfile(ROOT / 'prover/rolling-artifacts.mjs', self.root / 'prover/rolling-artifacts.mjs')
        shutil.copyfile(ROOT / 'toolchain.json', self.root / 'toolchain.json')
        (self.root / 'prover/rolling-artifacts.json').write_text(json.dumps({'schemaVersion': 1, 'status': 'pending', 'artifacts': [], 'inputs': {}}))
        self.node = os.environ.get('PROVER_VALIDATION_NODE', 'node')

    def tearDown(self):
        self.temp.cleanup()

    def test_release_gate_rejects_missing_or_historical_linux_pin_before_source_reads(self):
        # Explicitly fake toolchains; no archive, native execution or qualification.
        for pins in [{},{'nativeProverPackage':'6.0.0-rc.6','nativeProver':{},'nativeProverHistory':{'linux-x64':{'version':'6.0.0-rc.1'}}}]:
            (self.root/'toolchain.json').write_text(json.dumps(pins))
            with self.assertRaisesRegex(ValueError,'Active Linux prover qualification required'):
                package.release_preflight(self.root)
            self.assertEqual(sorted(p.name for p in self.root.iterdir()),['prover','toolchain.json'])

    def test_release_gate_requires_full_pinned_helper_composition_after_qualification(self):
        # Labelled candidate qualification in an isolated test directory only.
        spec=importlib.util.spec_from_file_location('fixture_bootstrap',ROOT/'deploy/prover/bootstrap.py')
        b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
        (self.root/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':b.BB_SHA}}}))
        with self.assertRaises(FileNotFoundError):package.release_preflight(self.root)
        for rel,raw in b.startup_sources(ROOT).items():
            p=self.root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        for rel in ('deploy/prover/board-prover.service',*b.ACTIVATION_PUBLIC_FILES):
            p=self.root/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,p)
        self.assertEqual(package.release_preflight(self.root),{'version':b.BB_VERSION,'sha256':b.BB_SHA})
        (self.root/'prover/compact-node-registration.mjs').write_text('PRIVATE_SENTINEL')
        with self.assertRaisesRegex(ValueError,'Invalid helper source hash'):package.release_preflight(self.root)

    def test_pending_artifacts_cannot_enter_package(self):
        with self.assertRaises(subprocess.CalledProcessError):
            package.rolling_resources(self.root, self.node)

    def test_activation_unit_and_public_verifier_closure_are_required(self):
        spec=importlib.util.spec_from_file_location('activation_bootstrap',ROOT/'deploy/prover/bootstrap.py')
        b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
        (self.root/'toolchain.json').write_text(json.dumps({'nativeProverPackage':b.BB_VERSION,'nativeProver':{'linux-x64':{'version':b.BB_VERSION,'sha256':b.BB_SHA}}}))
        for rel,raw in b.startup_sources(ROOT).items():
            p=self.root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        paths=('deploy/prover/board-prover.service',*b.ACTIVATION_PUBLIC_FILES)
        for rel in paths:
            p=self.root/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,p)
        package.release_preflight(self.root)
        for rel in paths:
            p=self.root/rel;raw=p.read_bytes();p.unlink()
            with self.assertRaisesRegex(ValueError,'closure missing'):package.release_preflight(self.root)
            p.write_bytes(raw)
        (self.root/paths[0]).write_text('[Service]\nUser=root\n')
        with self.assertRaisesRegex(ValueError,'service source changed'):package.release_preflight(self.root)

    def test_validation_node_must_match_pinned_version(self):
        pins = json.loads((self.root / 'toolchain.json').read_text())
        pins['node'] = '0.0.0'
        (self.root / 'toolchain.json').write_text(json.dumps(pins))
        with self.assertRaisesRegex(RuntimeError, 'Pinned validation Node'):
            package.rolling_resources(self.root, self.node)

    def test_archive_builder_is_import_safe(self):
        # Importing the preflight API has neither parsed CLI flags nor created a
        # release directory. The only entries here were installed by setUp.
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['prover', 'toolchain.json'])

class PackagedQueryImports(unittest.TestCase):
    """Actual copied adapter + inspector, deliberately fake SDK; no service/prover.

    A disabled-query import alone missed the production defect. Exercise the
    enabled dynamic import outside every repository ancestor and remove its file
    as a negative control. This is not Linux dependency/runtime acceptance.
    """
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='isolated-prover-sources-')
        self.release = pathlib.Path(self.temp.name) / 'release'
        self.release.mkdir()
        self.assertNotIn(ROOT, self.release.parents)
        package.copy_sources(ROOT, self.release)
        self.node = os.environ.get('PROVER_VALIDATION_NODE', 'node')
        # Only the SDK is fake. Both createPrivateQuery and inspectTrustedNode are
        # unmodified source copied by the same function main() uses for releases.
        sdk = """
const h='0x'+'01'.repeat(32),rollup='0x'+'11'.repeat(20);
const node={
 getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,realProofs:globalThis.fixtureProofs!==false,l1ContractAddresses:{rollupAddress:rollup}}),
 getChainTips:async()=>({proposed:{number:1,hash:h},...Object.fromEntries(['checkpointed','proven','finalized'].map(k=>[k,{block:{number:1,hash:h},checkpoint:{number:1,hash:h}}]))}),
 getWorldStateSyncStatus:async()=>({treesAreSynched:true,latestBlockNumber:1,latestBlockHash:h,finalizedBlockNumber:1,oldestHistoricBlockNumber:0}),
 getBlockData:async n=>({blockHash:h,header:{globalVariables:{blockNumber:n}}}),
 getSyncedL1Timestamp:async()=>BigInt(Math.floor(Date.now()/1000)-(globalThis.fixtureLag??0)),
};
export const createSafeJsonRpcClient=()=>node;
export const jsonStringify=JSON.stringify;
export const getSchemaParameters=()=>{},getSchemaReturnType=()=>{},parseWithOptionals=()=>{},schemaHasMethod=()=>false;
export const AztecNodeApiSchema={};
export const getVersioningResponseHandler=()=>()=>{};
"""
        for name, exports in [('@aztec-labs/foundation', ['json-rpc/client', 'json-rpc', 'schemas']),
                              ('@aztec-labs/stdlib', ['interfaces/client', 'versioning'])]:
            target = self.release / 'node_modules' / name
            target.mkdir(parents=True)
            (target / 'package.json').write_text(json.dumps({'name':name,'type':'module','exports':{'./'+key:'./fixture.mjs' for key in exports}}))
            (target / 'fixture.mjs').write_text(sdk)

    def test_startup_wrapper_exact_public_source_enters_isolated_hash_inventory(self):
        import hashlib
        source=ROOT/'deploy/prover/bootstrap.py';copied=self.release/'deploy/prover/bootstrap.py'
        self.assertEqual(copied.read_bytes(),source.read_bytes())
        inventory={str(p.relative_to(self.release)):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.release.rglob('*') if p.is_file()}
        self.assertEqual(inventory['deploy/prover/bootstrap.py'],hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(sorted(str(p.relative_to(self.release)) for p in (self.release/'deploy').rglob('*') if p.is_file()),['deploy/prover/board-prover.service','deploy/prover/bootstrap.py','deploy/prover/startup-stages.mjs'])
        self.assertNotIn('CONFIG = {',copied.read_text())
        stage=ROOT/'deploy/prover/startup-stages.mjs'
        self.assertEqual((self.release/'deploy/prover/startup-stages.mjs').read_bytes(),stage.read_bytes())
        self.assertEqual(inventory['deploy/prover/startup-stages.mjs'],hashlib.sha256(stage.read_bytes()).hexdigest())
        for relative in ('deploy/prover/board-prover.service','shared/portal-runtime.mjs','shared/portal-runtime.json','shared/protocol-commitments.mjs','shared/protocol-schema.mjs'):
            self.assertEqual((self.release/relative).read_bytes(),(ROOT/relative).read_bytes())
        isolated=importlib.util.spec_from_file_location('isolated_startup',copied);module=importlib.util.module_from_spec(isolated);isolated.loader.exec_module(module)
        output=module.NodeOutput();output.feed(b'PRIVATE_SENTINEL\n');output.finish(1)
        self.assertEqual(output.value['errors'],['unknown']);self.assertNotIn('PRIVATE_SENTINEL',json.dumps(output.value))

    def tearDown(self):
        self.temp.cleanup()

    def run_isolated(self, script):
        env = {'PATH': os.defpath, 'NODE_PATH': '', 'NODE_OPTIONS': ''}
        prelude = "import assert from 'node:assert/strict';import {createPrivateQuery} from './prover/private-query.mjs';globalThis.fetch=()=>{throw Error('Network forbidden in packaging unit test');};"
        return subprocess.run([self.node, '--input-type=module', '--eval', prelude+script],cwd=self.release,env=env,capture_output=True,text=True,check=True)

    def test_enabled_query_loads_copied_inspector_and_checks_public_state(self):
        self.assertEqual((self.release/'shared/trusted-private-node.mjs').read_bytes(),(ROOT/'shared/trusted-private-node.mjs').read_bytes())
        self.assertEqual((self.release/'shared/rolling/compact-client.mjs').read_bytes(),(ROOT/'shared/rolling/compact-client.mjs').read_bytes())
        self.run_isolated("""
const options={queryNode:{url:'http://127.0.0.1:9000/',rollupAddress:'0x'+'11'.repeat(20)},chainId:'31337',rollupVersion:'1',proofsEnabled:true};
const query=await createPrivateQuery(options);
assert.deepEqual(await query.health(),{enabled:true,ready:true});
const wrong=await createPrivateQuery({...options,chainId:'1'});
assert.equal((await wrong.health()).ready,false);
globalThis.fixtureLag=121;assert.equal((await query.health()).ready,false);globalThis.fixtureLag=0;
globalThis.fixtureProofs=false;assert.equal((await query.health()).ready,false);
const disabled=await createPrivateQuery({...options,proofsEnabled:false});assert.equal((await disabled.health()).ready,true);
""")

    def test_missing_dynamic_dependency_fails_enabled_query_without_ancestor_fallback(self):
        (self.release/'shared/trusted-private-node.mjs').unlink()
        self.run_isolated("""
assert.equal(await createPrivateQuery({}),undefined);
await assert.rejects(createPrivateQuery({queryNode:{url:'http://127.0.0.1:9000/',rollupAddress:'0x'+'11'.repeat(20)},chainId:'31337',rollupVersion:'1',proofsEnabled:true}),e=>e.code==='ERR_MODULE_NOT_FOUND'&&e.url.endsWith('/shared/trusted-private-node.mjs'));
""")

if __name__ == '__main__':
    unittest.main()
