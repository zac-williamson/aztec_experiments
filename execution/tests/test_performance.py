"""Structural aggregation tests; synthetic timings are never qualification evidence."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('performance', Path(__file__).parents[1] / 'summarize_performance.py')
performance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(performance)


class PerformanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = dict(schemaVersion=1, expectedPairs=30, engine='chrome',
                             attemptLogs=[f'{i:02}.log' for i in range(30)])
        for i, name in enumerate(self.manifest['attemptLogs']):
            samples = [dict(state=state, transactionHash=f'{i}-{state}', proveTxMs=24000,
                            toTxMs=10, proofMs=24010, guiElapsedMs=41000) for state in ['cold', 'warm']]
            samples[0].update(crsMs=500, pxeMs=600, coldMeasuredInitializationAndProofMs=25110)
            posts = [dict(txHash=s['transactionHash'], proofSha256=s['transactionHash'], **dict.fromkeys([
                'passed', 'normalNodeVerification', 'exactDepositNullifier', 'exactReplacementNote',
                'exactPostNote', 'exactCooldown', 'publicContentChecked', 'privateFeeDebitChecked',
                'publicFeePayerDebitChecked', 'authorPublicFeeBalanceZero'], True)) for s in samples]
            report = dict(scenario='browser-chrome-performance', passed=True, failures=[],
                ownedTreeAbsent=True, temporaryDirectoryRemoved=True, deadlineMs=540000, rssLimitKiB=4194304,
                startedAt=f'2026-09-20T00:{i:02}:00Z', finishedAt=f'2026-09-20T00:{i:02}:30Z',
                sourceHashes={'app':'synthetic'}, binarySha256='synthetic', applicationBBThreads=1, nodeBBThreads=1,
                browser=dict(passed=True, browserClosed=True, ownedServerStopped=True, browserEngine='chrome',
                    browserMode='performance', browserVersion='synthetic', gasSettings={'synthetic':1},
                    publicTransactionHashes=[s['transactionHash'] for s in samples],
                    journey=dict(passed=True, performanceQualified=False, samples=samples, hardware={'synthetic':True})),
                worker={'node':{'bridge':{'browserPost':{'verification':dict(passed=True, sameWallet=True,
                    privateFeeDebits='2', posts=posts)}}}})
            path = self.root / f'{i:02}.json'
            path.write_text(json.dumps(report))
            (self.root / name).write_text(json.dumps(dict(passed=True, evidence=str(path)))+'\n')

    def change(self, i, mutate):
        path = self.root / f'{i:02}.json'
        report = json.loads(path.read_text()); mutate(report); path.write_text(json.dumps(report))

    def test_complete_cohort_and_nearest_rank(self):
        self.assertEqual(performance.percentile(list(range(1,31)), .95), 29)
        result = performance.summarize(self.manifest,self.root)
        self.assertTrue(result['qualified']); self.assertEqual(result['completedPairs'],30)

    def test_missing_and_failed_are_not_replaced(self):
        (self.root / '00.log').unlink()
        self.change(1,lambda r:r.update(passed=False))
        result = performance.summarize(self.manifest,self.root)
        self.assertFalse(result['qualified']); self.assertEqual(result['attemptedPairs'],29)
        self.assertEqual(result['completedPairs'],28); self.assertEqual(result['failedPairs'],1)

    def test_duplicate_and_inconsistent_metadata_rejected(self):
        (self.root / '01.log').write_text((self.root / '00.log').read_text())
        self.change(2,lambda r:r['sourceHashes'].update(app='different'))
        self.change(3,lambda r:r['browser']['gasSettings'].update(synthetic=2))
        result = performance.summarize(self.manifest,self.root)
        self.assertFalse(result['qualified']); self.assertEqual(result['failedPairs'],3)

    def test_initialization_budget(self):
        for i in [28,29]:
            self.change(i,lambda r:r['browser']['journey']['samples'][0].update(
                crsMs=180000,coldMeasuredInitializationAndProofMs=204610))
        self.assertFalse(performance.summarize(self.manifest,self.root)['qualified'])

    def test_warm_budget(self):
        for i in [28,29]:
            self.change(i,lambda r:r['browser']['journey']['samples'][1].update(proveTxMs=90000,proofMs=90010))
        self.assertFalse(performance.summarize(self.manifest,self.root)['qualified'])

    def test_duplicate_manifest_slot_rejected(self):
        self.manifest['attemptLogs'][1]='00.log'
        with self.assertRaises(AssertionError): performance.summarize(self.manifest,self.root)
