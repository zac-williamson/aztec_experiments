"""Read-only aggregation of a predeclared 30-attempt proving campaign."""
import hashlib
import json
import math
import sys
from datetime import datetime
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parent / 'evidence' / 'T04'


def percentile(values, fraction):
    return sorted(values)[math.ceil(fraction * len(values)) - 1]


def statistics(values):
    return None if not values else {'samples': len(values), 'p50Ms': percentile(values, .5),
                                   'p95Ms': percentile(values, .95), 'maxMs': max(values)}


def summarize(manifest, evidence=EVIDENCE):
    assert manifest['schemaVersion'] == 1 and manifest['expectedPairs'] == 30
    assert manifest['engine'] in ['chrome', 'firefox', 'webkit']
    logs = manifest['attemptLogs']
    assert len(logs) == len(set(logs)) == 30
    assert all(Path(name).name == name and name.endswith('.log') for name in logs)
    rows, cold, warm, initialization = [], [], [], []
    baseline, previous_end, hashes, transactions = None, None, set(), set()
    for name in logs:
        log = evidence / name
        if not log.exists():
            rows.append({'log': name, 'status': 'not_started'})
            continue
        row = {'log': name, 'status': 'failed'}
        rows.append(row)
        try:
            summary = json.loads(log.read_text().splitlines()[-1])
            report_path = Path(summary['evidence']).resolve()
            assert report_path.parent == evidence.resolve()
            raw = report_path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            assert digest not in hashes
            hashes.add(digest)
            report = json.loads(raw)
            row.update(report=report_path.name, sha256=digest)
            assert report['scenario'] == 'browser-' + manifest['engine'] + '-performance'
            assert report['passed'] and summary['passed'] and not report['failures']
            assert report['ownedTreeAbsent'] and report['temporaryDirectoryRemoved']
            assert report['deadlineMs'] == 540000 and report['rssLimitKiB'] == 4194304
            start, end = (datetime.fromisoformat(report[key].replace('Z', '+00:00'))
                          for key in ['startedAt', 'finishedAt'])
            assert start < end and (previous_end is None or start >= previous_end)
            previous_end = end
            browser = report['browser']
            assert browser['passed'] and browser['browserClosed'] and browser['ownedServerStopped']
            assert browser['browserEngine'] == manifest['engine'] and browser['browserMode'] == 'performance'
            journey = browser['journey']
            assert journey['passed'] and not journey['performanceQualified']
            identity = [report['sourceHashes'], browser['browserVersion'], journey['hardware'], browser['gasSettings'],
                        report['binarySha256'], report['applicationBBThreads'], report['nodeBBThreads']]
            if baseline is None:
                baseline = identity
            assert identity == baseline
            samples = journey['samples']
            assert [sample['state'] for sample in samples] == ['cold', 'warm']
            verification = report['worker']['node']['bridge']['browserPost']['verification']
            assert verification['passed'] and verification['sameWallet'] and verification['privateFeeDebits'] == '2'
            posts = verification['posts']
            assert len(posts) == 2 and posts[0]['proofSha256'] != posts[1]['proofSha256']
            assert browser['publicTransactionHashes'] == [sample['transactionHash'] for sample in samples]
            for sample, post in zip(samples, posts):
                assert sample['transactionHash'] == post['txHash'] and post['txHash'] not in transactions
                transactions.add(post['txHash'])
                assert all(post[key] is True for key in ['passed', 'normalNodeVerification', 'exactDepositNullifier',
                    'exactReplacementNote', 'exactPostNote', 'exactCooldown', 'publicContentChecked',
                    'privateFeeDebitChecked', 'publicFeePayerDebitChecked', 'authorPublicFeeBalanceZero'])
                for key in ['proveTxMs', 'toTxMs', 'proofMs', 'guiElapsedMs']:
                    assert type(sample[key]) in [int, float] and math.isfinite(sample[key]) and sample[key] >= 0
                assert math.isclose(sample['proofMs'], sample['proveTxMs'] + sample['toTxMs'], abs_tol=.001)
            first = samples[0]
            assert all(type(first[key]) in [int, float] and math.isfinite(first[key]) and first[key] >= 0
                       for key in ['crsMs', 'pxeMs', 'coldMeasuredInitializationAndProofMs'])
            assert math.isclose(first['coldMeasuredInitializationAndProofMs'],
                                first['crsMs'] + first['pxeMs'] + first['proofMs'], abs_tol=.001)
            cold.append(first['proofMs']); warm.append(samples[1]['proofMs'])
            initialization.append(first['coldMeasuredInitializationAndProofMs'])
            row['status'] = 'passed'
        except (AssertionError, KeyError, ValueError, IndexError, OSError, TypeError):
            row['reason'] = 'Incomplete, failed, duplicate or inconsistent evidence; inspect the retained report.'
    completed = len(cold)
    attempted = sum(row['status'] != 'not_started' for row in rows)
    qualified = completed == attempted == 30 and percentile(cold, .95) <= 180000 and percentile(warm, .95) <= 90000 and percentile(initialization, .95) <= 180000
    return {'schemaVersion': 1, 'engine': manifest['engine'], 'attemptedPairs': attempted,
            'completedPairs': completed, 'failedPairs': attempted-completed, 'qualified': qualified,
            'coldProof': statistics(cold), 'warmProof': statistics(warm),
            'coldMeasuredInitializationAndProof': statistics(initialization), 'attempts': rows,
            'scope': 'Nearest-rank statistics of valid pairs. Incomplete/failed cohorts cannot qualify. Pilot excluded; no failed attempt replaced.'}


if __name__ == '__main__':
    manifest = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(summarize(manifest), indent=2))
