#!/usr/bin/env python3
"""Publish aggregate moderator and backup health bits; never transmit application logs or content."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time

UNIT = 'board-moderator.service'
FRESH_SECONDS = 600


def run(*args):
    return subprocess.check_output(args, text=True, timeout=5)


def healthy(record, now):
    age = now - int(record['__REALTIME_TIMESTAMP']) / 1_000_000
    message = record['MESSAGE']
    match = re.fullmatch(r'\[[^\]]+\] \[(?:info|warn|error)\] (\{.*\})', message)
    if not match:
        return False
    health = json.loads(match[1])
    return (0 <= age <= FRESH_SECONDS
            and health['type'] == 'billboard-moderation-health-v1'
            and health['severity'] in ('ok', 'warning')
            and isinstance(health['alerts'], list)
            and all(a['code'] == 'AWAITING_FINALITY' for a in health['alerts']))


def backup_healthy(record, active, now):
    if active == 'failed':
        return False
    started, succeeded = record['startedAt'], record['lastSuccessAt']
    if any(type(v) is not int or v < 0 or v > now for v in (started, succeeded)):
        return False
    if succeeded == 0 or now - succeeded > 26 * 3600:
        return False
    if record['status'] == 'success':
        return succeeded >= started
    return (record['status'] == 'running' and active in ('activating', 'active')
            and 0 <= now - started <= 540 and succeeded <= started)


def main():
    region, deployment = sys.argv[1:]
    state = dict(line.split('=', 1) for line in run(
        'systemctl', 'show', UNIT, '-p', 'ActiveState', '-p', 'InvocationID').splitlines())
    value = 0
    if state['ActiveState'] == 'active' and state['InvocationID']:
        journal = subprocess.run(
            ['journalctl', '--no-pager', '-o', 'json', '-n', '1',
             '_SYSTEMD_INVOCATION_ID=' + state['InvocationID'],
             '--grep=billboard-moderation-health-v1'],
            text=True, stdout=subprocess.PIPE, timeout=15)
        if journal.returncode not in (0, 1):
            journal.check_returncode()
        records = journal.stdout if journal.returncode == 0 else ''
        if records.strip():
            try:
                value = int(healthy(json.loads(records), time.time()))
            except (ValueError, KeyError, TypeError):
                value = 0  # Malformed health is unhealthy, never a success substitute.
    backup_state = run('systemctl', 'show', 'board-moderator-backup.service',
                       '-p', 'ActiveState', '--value').strip()
    backup_value = 0
    try:
        backup_value = int(backup_healthy(
            json.loads(Path('/srv/board/backup-status.json').read_text()),
            backup_state, time.time()))
    except (OSError, ValueError, KeyError, TypeError):
        backup_value = 0
    metric = [{'MetricName': name, 'Value': measured, 'Unit': 'Count',
               'Dimensions': [{'Name': 'Deployment', 'Value': deployment}]}
              for name, measured in [('ModeratorHealthy', value), ('BackupHealthy', backup_value)]]
    subprocess.run(['aws', 'cloudwatch', 'put-metric-data', '--region', region,
                    '--namespace', 'AnonymousMessageBoard', '--metric-data', json.dumps(metric),
                    '--cli-connect-timeout', '5', '--cli-read-timeout', '10'],
                   check=True, timeout=20)
    print('ModeratorHealthy=' + str(value) + ' BackupHealthy=' + str(backup_value))


if __name__ == '__main__':
    main()
