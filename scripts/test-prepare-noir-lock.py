"""Small labelled synthetic artifact/tree tests; no compiler or source fetching."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_noir_lock', pathlib.Path(__file__).with_name('prepare-noir-lock.py'))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='noir-inventory-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name).resolve()
        self.root, self.cache = self.base / 'repo', self.base / 'cache'
        self.root.mkdir(); self.cache.mkdir()
        self.write(self.root / 'billboard/Nargo.toml', '[workspace]\nmembers=["contract"]\n')
        self.write(self.root / 'billboard/contract/Nargo.toml', '[package]\nname="board"\ntype="contract"\n[dependencies]\naztec={git="https://github.com/owner/lib",tag="v6",directory="aztec"}\n')
        self.write(self.root / 'billboard/contract/src/main.nr', 'local fixture')
        self.external = self.cache / 'github.com/owner/lib/v6/aztec'
        self.write(self.external / 'Nargo.toml', '[package]\nname="aztec"\ntype="lib"\n')
        self.write(self.external / 'src/lib.nr', 'external fixture')
        self.contracts = ('Board',)
        self.manifests = ('billboard/Nargo.toml',)
        self.artifact = self.root / 'billboard/target/board.json'
        self.record = {'name':'Board','file_map': {'1':{'path':str(self.external / 'src/lib.nr'),'source':'external fixture'}, '2':{'path':'billboard/contract/src/main.nr','source':'local fixture'}}}
        self.save()

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def save(self):
        self.write(self.artifact, json.dumps(self.record))

    def run_prepare(self):
        return generator.prepare(self.root, self.cache, [self.artifact], self.manifests, self.contracts)

    def test_actual_file_bytes_bound_schema2_and_determinism(self):
        first = self.run_prepare()
        self.assertEqual(first['schema'], 2)
        self.assertEqual(first, self.run_prepare())
        self.assertEqual(first['artifactSources']['Board']['sha256'], generator.sha(self.artifact.read_bytes()))
        self.assertEqual(len(first['localManifests']), 2)
        self.assertEqual(first['embeddedSourcesByContract']['Board'], {'dependencies/github.com/owner/lib/v6/aztec/src/lib.nr':generator.sha(b'external fixture')})

    def test_additional_experiment_graph_included(self):
        self.write(self.root / 'experiments/avatar/Nargo.toml', '[package]\nname="avatar"\ntype="contract"\n')
        self.write(self.root / 'experiments/avatar/src/main.nr', 'avatar fixture')
        self.manifests += ('experiments/avatar/Nargo.toml',)
        self.assertIn('experiments/avatar/Nargo.toml', self.run_prepare()['localManifests'])

    def test_two_distinct_contracts_have_separate_inventories(self):
        second = self.root / 'billboard/target/other.json'
        self.write(second, json.dumps({**self.record, 'name':'Other'}))
        result = generator.prepare(self.root, self.cache, [self.artifact, second], self.manifests, ('Board','Other'))
        self.assertEqual(set(result['embeddedSourcesByContract']), {'Board','Other'})

    def test_normalized_dependency_paths_supported(self):
        self.record['file_map']['1']['path'] = 'dependencies/github.com/owner/lib/v6/aztec/src/lib.nr'
        self.save(); self.run_prepare()

    def test_wrong_source_and_unknown_dependency_rejected(self):
        for path, source in [(str(self.external / 'src/lib.nr'),'altered'),('dependencies/github.com/other/lib/v6/src/a.nr','external fixture')]:
            with self.subTest(path=path):
                self.record['file_map']['1']={'path':path,'source':source}; self.save()
                with self.assertRaisesRegex(ValueError, 'Embedded source'): self.run_prepare()

    def test_changed_local_source_rejected(self):
        self.write(self.root / 'billboard/contract/src/main.nr', 'new local fixture')
        with self.assertRaisesRegex(ValueError, 'local source'): self.run_prepare()

    def test_duplicate_contract_and_artifact_rejected(self):
        second = self.root / 'billboard/target/second.json'; self.write(second, self.artifact.read_text())
        with self.assertRaisesRegex(ValueError, 'duplicate contract'): generator.prepare(self.root,self.cache,[self.artifact,second],self.manifests,self.contracts)
        with self.assertRaisesRegex(ValueError, 'Duplicate artifact'): generator.prepare(self.root,self.cache,[self.artifact,self.artifact],self.manifests,self.contracts)

    def test_missing_unexpected_and_empty_contract_inventories(self):
        with self.assertRaisesRegex(ValueError, 'Missing required'): generator.prepare(self.root,self.cache,[self.artifact],self.manifests,('Board','Missing'))
        self.record['name']='Unexpected';self.save()
        with self.assertRaisesRegex(ValueError, 'Unexpected'):self.run_prepare()
        self.record['name']='Board';self.record['file_map']={};self.save()
        with self.assertRaisesRegex(ValueError, 'Empty compiler'):self.run_prepare()
        self.record['file_map']={'1':{'path':'std/x.nr','source':'standard fixture'}};self.save()
        with self.assertRaisesRegex(ValueError, 'Empty contract'):self.run_prepare()

    def test_duplicate_json_and_source_path_conflicts(self):
        self.write(self.artifact,'{"name":"Board","name":"Other"}')
        with self.assertRaisesRegex(ValueError,'Duplicate JSON'): self.run_prepare()
        self.record['file_map']['3']={**self.record['file_map']['1'],'source':'conflicting'};self.save()
        with self.assertRaisesRegex(ValueError,'Duplicate or conflicting'):self.run_prepare()

    def test_path_escapes_and_unknown_absolute_paths(self):
        for bad in ['../outside.nr','dependencies/../outside.nr','/outside/src/lib.nr','dependencies\\outside.nr']:
            with self.subTest(path=bad):
                self.record['file_map']['1']['path']=bad;self.save()
                with self.assertRaises(ValueError):self.run_prepare()
        with self.assertRaises(ValueError):generator.prepare(self.root,self.cache,[self.base/'outside.json'],self.manifests,self.contracts)

    def test_symlink_sources_manifests_and_artifacts(self):
        for target in [self.external/'src/lib.nr',self.root/'billboard/contract/Nargo.toml',self.artifact]:
            with self.subTest(path=target):
                content=target.read_bytes();backup=target.with_suffix('.backup');target.rename(backup);target.symlink_to(backup)
                with self.assertRaisesRegex(ValueError,'Symlink'):self.run_prepare()
                target.unlink();backup.rename(target);self.assertEqual(target.read_bytes(),content)

    def test_symlink_directory_even_before_parent_segment_rejected(self):
        link=self.root/'billboard/link';link.symlink_to(self.root/'billboard/contract',target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'Symlink'):generator.checked(self.root,link/'../contract/Nargo.toml')

    def test_symlink_cache_root_rejected(self):
        link=self.base/'cache-link';link.symlink_to(self.cache,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'Symlink root'):generator.prepare(self.root,link,[self.artifact],self.manifests,self.contracts)

    def test_empty_source_tree_and_origin_escape_rejected(self):
        (self.external/'src/lib.nr').unlink()
        with self.assertRaisesRegex(ValueError,'Empty package'):self.run_prepare()
        self.write(self.external/'src/lib.nr','external fixture')
        path=self.root/'billboard/contract/Nargo.toml';path.write_text(path.read_text().replace('directory="aztec"','directory="../aztec"'))
        with self.assertRaisesRegex(ValueError,'Unsupported dependency origin'):self.run_prepare()

    def test_duplicate_scope_or_required_contracts_rejected(self):
        with self.assertRaisesRegex(ValueError,'duplicate manifest'):generator.prepare(self.root,self.cache,[self.artifact],self.manifests*2,self.contracts)
        with self.assertRaisesRegex(ValueError,'duplicate required'):generator.prepare(self.root,self.cache,[self.artifact],self.manifests,self.contracts*2)

    def test_relative_local_and_external_library_graphs_are_preserved(self):
        self.write(self.root / 'experiments/shared/Nargo.toml', '[package]\nname="shared"\ntype="lib"\n')
        self.write(self.root / 'experiments/shared/src/lib.nr', 'local shared')
        manifest = self.root / 'billboard/contract/Nargo.toml'
        manifest.write_text(manifest.read_text() + 'shared={path="../../experiments/shared"}\n')
        sibling = self.external.parent / 'types'
        self.write(sibling / 'Nargo.toml', '[package]\nname="types"\ntype="lib"\n')
        self.write(sibling / 'src/lib.nr', 'external types')
        manifest = self.external / 'Nargo.toml'
        manifest.write_text(manifest.read_text() + '[dependencies]\ntypes={path="../types"}\n')
        result = self.run_prepare()
        self.assertIn('experiments/shared/Nargo.toml', result['localManifests'])
        self.assertIn('dependencies/github.com/owner/lib/v6/types', result['packages'])

    def test_repository_origin_parent_and_nonobject_artifact_rejected(self):
        manifest=self.root/'billboard/contract/Nargo.toml'
        original=manifest.read_text();manifest.write_text(original.replace('github.com/owner/lib','github.com/owner/..'))
        with self.assertRaisesRegex(ValueError,'Unsupported dependency origin'):self.run_prepare()
        manifest.write_text(original);self.write(self.artifact, '[]')
        with self.assertRaisesRegex(ValueError,'Malformed compiler artifact'):self.run_prepare()

    def test_default_scope_retains_all_existing_acceptance_contracts(self):
        self.assertEqual(len(generator.DEFAULT_CONTRACTS),7)
        self.assertIn('experiments/private-bok/Nargo.toml',generator.DEFAULT_MANIFESTS)
        self.assertIn('experiments/avatar/Nargo.toml',generator.DEFAULT_MANIFESTS)


if __name__ == '__main__':
    unittest.main()
