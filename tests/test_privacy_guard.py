import importlib.util
import ipaddress
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('privacy_guard', Path(__file__).resolve().parents[1] / 'scripts/check-public-files.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class PublicSourceTests(unittest.TestCase):
    def test_runtime_artifacts_and_database_payload_rejected(self):
        for name in ('.env', '.env.production', 'data/app.sqlite', 'snapshots/export.sqlite-wal', 'private/notes.md', 'docs/production-acceptance.md'):
            with self.subTest(name=name):
                self.assertTrue(guard.check_content(name, b'content'))
        self.assertTrue(guard.check_content('payload.bin', b'SQLite format 3\0data'))

    def test_real_addresses_and_home_paths_rejected(self):
        address = str(ipaddress.ip_address(134744072)).encode()
        self.assertTrue(guard.check_content('README.md', b'https://' + address + b'/app'))
        self.assertTrue(guard.check_content('README.md', b'/' + b'Users' + b'/example/project/'))
        self.assertTrue(guard.check_content('README.md', b'/' + b'home' + b'/example/project/'))
        self.assertTrue(guard.check_content('compose.yaml', b'name: owner' + b'-web-gateway'))

    def test_generic_instructions_remain_allowed(self):
        self.assertFalse(guard.check_content('.env.example', b'TJUSAI_API_KEY=\n'))
        self.assertFalse(guard.check_content('README.md', b'http://127.0.0.1:3000; http://0.0.0.0; https://203.0.113.4/app'))
        self.assertFalse(guard.check_content('docs/deployment.md', b'node server/backup.mjs backups/example.sqlite'))

    def test_keys_rejected_without_printing_value(self):
        secret = b'sk-' + b'x' * 32
        issues = guard.check_content('config.txt', secret)
        self.assertTrue(issues)
        self.assertNotIn(secret.decode(), str(issues))


if __name__ == '__main__':
    unittest.main()
