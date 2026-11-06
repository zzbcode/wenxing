#!/usr/bin/env python3
"""Create a Wenxing account; passwords are read privately, never shell arguments."""
import argparse
import getpass
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', required=True)
    parser.add_argument('--name')
    parser.add_argument('--docker', action='store_true', help='Run in the compose app service')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error('Run in an interactive terminal to enter the password privately.')
    password = getpass.getpass('密码（至少12位，隐藏输入）：')
    if password != getpass.getpass('再次输入：'):
        parser.error('两次输入不一致')
    if not 12 <= len(password) <= 256:
        parser.error('密码需为12至256位')
    root = Path(__file__).resolve().parents[1]
    command = (['docker', 'compose', 'exec', '-T', 'app', 'node'] if args.docker else
               [os.environ.get('NODE_BINARY', 'node'), '--env-file=.env'])
    command += ['server/create-user.mjs', '--username', args.username]
    if args.name:
        command += ['--name', args.name]
    result = subprocess.run(command, cwd=root, input=password + '\n', text=True, check=False)
    return result.returncode


if __name__ == '__main__':
    sys.exit(main())
