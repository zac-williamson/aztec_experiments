#!/usr/bin/env python3
"""Publish one aggregate health bit; never transmit application logs or content."""
import json
import re
import subprocess
import sys
import time

UNIT = 'board-moderator.service'
FRESH_SECONDS = 600


def run(*args):
    return subprocess.check_output(args, text=True, timeout=15)


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
    metric = [{'MetricName': 'ModeratorHealthy', 'Value': value, 'Unit': 'Count',
               'Dimensions': [{'Name': 'Deployment', 'Value': deployment}]}]
    subprocess.run(['aws', 'cloudwatch', 'put-metric-data', '--region', region,
                    '--namespace', 'AnonymousMessageBoard', '--metric-data', json.dumps(metric),
                    '--cli-connect-timeout', '5', '--cli-read-timeout', '10'],
                   check=True, timeout=20)
    print('ModeratorHealthy=' + str(value))


if __name__ == '__main__':
    main()
