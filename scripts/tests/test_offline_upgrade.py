"""隔离测试真实离线脚本，Docker/Compose使用替身；在Linux运行：
python3 -m unittest discover -s scripts/tests -v
"""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

MOCK = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, tarfile
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
if name == 'uname':
    print('aarch64'); sys.exit(0)
if name == 'sleep':
    sys.exit(0)
entry = {'name': name, 'args': args}
if name == 'docker-compose':
    compose = pathlib.Path(args[args.index('-f') + 1])
    entry['legacy'] = 'minio:' in compose.read_text()
    args = args[args.index('-f') + 2:]
with open(os.environ['EVENT_LOG'], 'a') as log:
    log.write(json.dumps(entry) + '\n')
mode = os.environ['TEST_MODE']
if name == 'docker':
    if args[0] == 'inspect':
        print('unhealthy' if mode == 'unhealthy' and args[-1] == 'opencode-id' else 'healthy')
    elif args[0] == 'run':
        if mode == 'archive-failure': sys.exit(1)
        mounts = [args[i + 1] for i, x in enumerate(args) if x == '-v']
        source = pathlib.Path(next(x[:-11] for x in mounts if x.endswith(':/source:ro')))
        backup = pathlib.Path(next(x[:-8] for x in mounts if x.endswith(':/backup')))
        with tarfile.open(backup / 'persistent-data.tar.gz', 'w:gz') as archive:
            for item in ('data', '.env'): archive.add(source / item, arcname=item)
elif name == 'docker-compose':
    if args[0] == 'exec':
        if mode == 'dump-failure': sys.exit(1)
        print('database backup')
    elif args[0] == 'ps':
        if '--status' in args:
            print('opencode-id\napi-id\nworker-id\nweb-id')
        elif '-q' in args:
            service = args[-1]
            if service == 'minio': sys.exit(2)
            print(service + '-id')
'''


@unittest.skipUnless(os.name == 'posix', '需要Linux/POSIX shell')
class OfflineUpgradeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='matrix-upgrade-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.target = self.root / 'new', self.root / 'old'
        self.source.mkdir()
        self.target.mkdir()
        self.bin = self.root / 'mock-bin'
        self.bin.mkdir()
        self.log = self.root / 'events.jsonl'
        for name in ('docker', 'uname', 'sleep'):
            self.executable(self.bin / name, MOCK)
        for directory in (self.source, self.target):
            (directory / 'bin').mkdir()
            self.executable(directory / 'bin/docker-compose', MOCK)
            for script in (ROOT / 'offline').glob('*.sh'):
                self.executable(directory / script.name, script.read_text())
        for item in ('postgres', 'redis', 'projects', 'minio', 'opencode-config'):
            (self.target / 'data' / item).mkdir(parents=True)
        self.config = self.target / 'data/opencode-config/opencode.json'
        self.config.write_text('{"model":"test/model","plugin":["file:///plugin/dist/index.js"]}')
        self.project = self.target / 'data/projects/source.docx'
        self.project.write_bytes(b'original document')
        (self.target / 'data/minio/legacy').write_text('legacy data')
        env = (ROOT / '.env.offline.example').read_text().replace('replace-with-', 'test-only-')
        self.env_text = env + '\nMINIO_ACCESS_KEY=legacy\nMINIO_SECRET_KEY=replace-with-unused\n'
        (self.target / '.env').write_text(self.env_text)
        self.old_compose = 'services:\n  minio:\n    image: old-minio\n'
        (self.target / 'docker-compose.yml').write_text(self.old_compose)
        self.new_compose = (ROOT / 'docker-compose.offline-arm64.yml').read_text()
        (self.source / 'docker-compose.yml').write_text(self.new_compose)
        (self.source / 'requirements-manager-arm64-images.tar').write_bytes(b'mock images')
        # 真正执行sha256sum，先校验新配置，不能替换成无条件成功的替身。
        import hashlib
        digest = hashlib.sha256((self.source / 'docker-compose.yml').read_bytes()).hexdigest()
        (self.source / 'SHA256SUMS').write_text(f'{digest}  docker-compose.yml\n')

    def executable(self, path, text):
        path.write_text(text, newline='\n')
        path.chmod(0o755)

    def run_upgrade(self, mode='success'):
        env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
               'EVENT_LOG': str(self.log), 'TEST_MODE': mode}
        result = subprocess.run(['sh', str(self.source / 'upgrade.sh'), str(self.target)],
                                env=env, capture_output=True, text=True, timeout=20)
        events = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, events

    def assert_preserved(self):
        self.assertEqual((self.target / '.env').read_text(), self.env_text)
        self.assertEqual(self.project.read_bytes(), b'original document')
        self.assertEqual((self.target / 'data/minio/legacy').read_text(), 'legacy data')
        self.assertIn('test/model', self.config.read_text())

    def test_legacy_upgrade_stops_old_compose_and_preserves_data(self):
        result, events = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        down = next(i for i, e in enumerate(events) if 'down' in e['args'])
        up = next(i for i, e in enumerate(events) if 'up' in e['args'])
        self.assertLess(down, up)
        load = next(i for i, e in enumerate(events) if e['name'] == 'docker' and e['args'][0] == 'load')
        archive = next(i for i, e in enumerate(events) if e['name'] == 'docker' and e['args'][0] == 'run')
        self.assertLess(load, down)
        self.assertLess(down, archive)
        self.assertLess(archive, up)
        self.assertTrue(events[down]['legacy'])
        self.assertFalse(events[up]['legacy'])
        self.assertEqual((self.target / 'docker-compose.yml').read_text(), self.new_compose)
        self.assert_preserved()
        backup = next((self.root / 'requirements-manager-backups').glob('*'))
        with tarfile.open(backup / 'persistent-data.tar.gz') as archive:
            self.assertIn('data/minio/legacy', archive.getnames())
            self.assertEqual(archive.extractfile('.env').read().decode(), self.env_text)
        self.assertEqual((backup / 'previous-docker-compose.yml').read_text(), self.old_compose)

    def test_shell_scripts_parse(self):
        for script in (ROOT / 'offline').glob('*.sh'):
            with self.subTest(script=script.name):
                result = subprocess.run(['sh', '-n', str(script)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_corrupt_bundle_does_not_stop_services(self):
        (self.source / 'docker-compose.yml').write_text('corrupted')
        result, events = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('down' in e['args'] or 'load' in e['args'] for e in events))
        self.assertEqual((self.target / 'docker-compose.yml').read_text(), self.old_compose)
        self.assert_preserved()

    def test_no_minio_environment_required(self):
        self.env_text = '\n'.join(line for line in self.env_text.splitlines() if not line.startswith('MINIO_')) + '\n'
        (self.target / '.env').write_text(self.env_text)
        result, _ = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_preserved()

    def test_database_backup_failure_does_not_stop_services(self):
        result, events = self.run_upgrade('dump-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('down' in e['args'] or 'up' in e['args'] for e in events))
        self.assertEqual((self.target / 'docker-compose.yml').read_text(), self.old_compose)
        self.assert_preserved()

    def test_archive_failure_does_not_replace_configuration(self):
        result, events = self.run_upgrade('archive-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any('down' in e['args'] for e in events))
        self.assertFalse(any('up' in e['args'] for e in events))
        self.assertEqual((self.target / 'docker-compose.yml').read_text(), self.old_compose)
        self.assert_preserved()

    def test_running_but_unhealthy_opencode_times_out(self):
        result, events = self.run_upgrade('unhealthy')
        self.assertNotEqual(result.returncode, 0)
        checks = [e for e in events if e['name'] == 'docker' and e['args'][0] == 'inspect'
                  and e['args'][-1] == 'opencode-id']
        self.assertEqual(len(checks), 36)
        self.assertIn('180', result.stderr)
        self.assert_preserved()


if __name__ == '__main__':
    unittest.main()
