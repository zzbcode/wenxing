#!/usr/bin/env python3
"""Reject credentials, runtime artifacts and deployment-specific details in public source."""
from pathlib import Path
import argparse
import ipaddress
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SECRET = re.compile(rb'(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,})')
IPV4 = re.compile(rb'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])')
HOME_PATH = re.compile(rb'/(?:Users|home)/(?!node(?:/|\b))[^\s/]+/')
OWNER_NETWORK = re.compile(rb'\b[a-z0-9]+-web-gateway\b')
EXAMPLE_NETWORKS = tuple(ipaddress.ip_network(x) for x in ('192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24'))
INTERNAL_REPORTS = {'production-acceptance.md', 'independent-acceptance.md', 'model-verification.json', 'design-qa.md'}


def check_content(name, content):
    reasons = []
    path = Path(name)
    if (path.name == '.env' or (path.name.startswith('.env.') and path.name != '.env.example')
        or re.search(r'\.(?:pem|key|sqlite3?|db)(?:-(?:wal|shm))?$', path.name)
        or any(part in {'data', 'backups', 'source-reference', 'node_modules', 'output', 'private', '__pycache__'} for part in path.parts)
        or path.suffix in {'.pyc', '.pyo'}
        or path.name in INTERNAL_REPORTS):
        reasons.append('private/runtime artifact')
    if SECRET.search(content):
        reasons.append('possible credential')
    if content.startswith(b'SQLite format 3\0'):
        reasons.append('database content')
    if b'\0' not in content:
        if HOME_PATH.search(content):
            reasons.append('host-specific home directory')
        if OWNER_NETWORK.search(content):
            reasons.append('deployment-specific network name')
        for match in IPV4.finditer(content):
            try:
                address = ipaddress.ip_address(match.group().decode())
            except ValueError:
                continue
            if not (address.is_loopback or address.is_unspecified or any(address in net for net in EXAMPLE_NETWORKS)):
                reasons.append('non-example IP address')
                break
    return [name + ': ' + reason + ' (value suppressed)' for reason in reasons]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', action='store_true', help='Also inspect every blob reachable from local Git refs')
    args = parser.parse_args()
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).split(b'\0')
    problems = []
    for raw in paths:
        if not raw:
            continue
        name = raw.decode()
        full = ROOT / name
        if full.is_file():
            problems.extend(check_content(name, full.read_bytes()))
    if args.history:
        seen = set()
        for row in subprocess.check_output(['git', 'rev-list', '--objects', '--all'], cwd=ROOT).splitlines():
            oid, _, raw_name = row.partition(b' ')
            if oid in seen:
                continue
            seen.add(oid)
            if subprocess.check_output(['git', 'cat-file', '-t', oid], cwd=ROOT).strip() != b'blob':
                continue
            content = subprocess.check_output(['git', 'cat-file', 'blob', oid], cwd=ROOT)
            problems.extend('history:' + issue for issue in check_content(raw_name.decode(), content))
    if problems:
        print('\n'.join(sorted(set(problems))), file=sys.stderr)
        return 1
    print('Public source checks passed' + (' (including reachable Git history).' if args.history else '.'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
