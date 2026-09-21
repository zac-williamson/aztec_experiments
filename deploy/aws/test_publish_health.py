import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('publish-health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class BackupHealthTests(unittest.TestCase):
    def test_attempt_outcomes_and_freshness(self):
        now = 200000
        cases = [
            ('recent success', 'success', 199000, 199100, 'inactive', True),
            ('early service failure', 'success', 199000, 199100, 'failed', False),
            ('newer failure', 'failed', 199500, 199100, 'failed', False),
            ('stale success', 'success', 100000, 100100, 'inactive', False),
            ('interrupted after reboot', 'running', 199900, 199100, 'inactive', False),
            ('bounded running', 'running', 199900, 199100, 'activating', True),
            ('running too long', 'running', 199000, 198900, 'activating', False),
            ('first run', 'running', 199900, 0, 'activating', False),
            ('future start', 'success', 200001, 199100, 'inactive', False),
            ('future success', 'success', 199000, 200001, 'inactive', False),
            ('success before start', 'success', 199900, 199100, 'inactive', False),
            ('boolean timestamp', 'success', True, 199100, 'inactive', False),
            ('unknown status', 'unknown', 199000, 199100, 'active', False),
        ]
        for label, status, started, succeeded, active, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(health.backup_healthy(
                    {'status': status, 'startedAt': started, 'lastSuccessAt': succeeded},
                    active, now), expected)

    def test_actual_status_writer_preserves_last_success_on_failure(self):
        import json
        import subprocess
        import sys
        import tempfile
        # Execute the script's embedded writer with an isolated path, without
        # stopping a service or touching a real wallet/backup.
        script = Path(__file__).with_name('backup-moderator.sh').read_text()
        writer = script.split("<<'STATUS'\n", 1)[1].split('\nSTATUS', 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            def write(status):
                subprocess.run([sys.executable, '-', status, str(path)],
                               input=writer, text=True, check=True, timeout=5)
                return json.loads(path.read_text())
            self.assertEqual(write('running')['lastSuccessAt'], 0)
            self.assertEqual(write('failed')['lastSuccessAt'], 0)
            write('running')
            succeeded = write('success')['lastSuccessAt']
            self.assertGreater(succeeded, 0)
            self.assertEqual(write('running')['lastSuccessAt'], succeeded)
            self.assertEqual(write('failed')['lastSuccessAt'], succeeded)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_absent_or_invalid_record_is_published_unhealthy(self):
        import json
        for value in (FileNotFoundError(), '{', '{}', 'null'):
            with self.subTest(value=value), patch.object(health.sys, 'argv', ['health', 'eu-west-2', 'board']), \
                    patch.object(health, 'run', side_effect=['ActiveState=inactive\nInvocationID=\n', 'inactive']), \
                    patch.object(health.subprocess, 'run') as send, patch('builtins.print'), \
                    patch.object(health.Path, 'read_text') as read:
                if isinstance(value, Exception):
                    read.side_effect = value
                else:
                    read.return_value = value
                health.main()
                self.assertEqual(send.call_count, 1)
                command = send.call_args.args[0]
                metrics = json.loads(command[command.index('--metric-data') + 1])
                self.assertEqual({m['MetricName']: m['Value'] for m in metrics},
                                 {'ModeratorHealthy': 0, 'BackupHealthy': 0})


if __name__ == '__main__':
    unittest.main()
