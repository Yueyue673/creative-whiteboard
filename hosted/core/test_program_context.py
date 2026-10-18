import ast
import json
import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from deployment.program_context import ContextError, export_context, program_files


class ProgramContextTests(SimpleTestCase):
    def test_runtime_contract_covers_current_assets_migrations_modules_and_templates(self):
        root = settings.BASE_DIR.parent; files = set(program_files(root))
        tree = ast.parse((root / 'hosted/core/portal.py').read_text(encoding='utf-8'))
        assets = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'ASSETS' for target in node.targets))
        required = {f'hosted/core/portal_assets/{name}' for name in assets if name not in ('markdown-it.js', 'html2canvas.js')}
        required.update(['vendor/markdown-it.min.js', 'vendor/html2canvas.min.js', 'vendor/html2canvas.LICENSE', 'ai_context.py'])
        for path in (root / 'hosted/core').rglob('*.py'):
            if not path.name.startswith('test_') and path.name != 'tests.py': required.add(path.relative_to(root).as_posix())
        required.update(path.relative_to(root).as_posix() for path in (root / 'hosted/core/templates').rglob('*.html'))
        required.update(path.relative_to(root).as_posix() for path in (root / 'hosted/service').glob('*.py') if path.name != 'test_settings.py')
        self.assertFalse(required - files, 'Current runtime files are missing from the build manifest')
        self.assertNotIn('hosted/core/tests.py', files)
        self.assertNotIn('hosted/deployment/container_smoke.py', files)

    def test_docker_context_is_the_exact_runtime_list_without_directory_or_glob_exceptions(self):
        root = settings.BASE_DIR.parent
        lines = [line.strip() for line in (root / '.dockerignore').read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
        self.assertEqual(lines[0], '**')
        self.assertEqual(lines[1:], ['!' + name for name in program_files(root)])

    def test_new_export_keeps_source_and_omits_unlisted_synthetic_secret_tests_and_logs(self):
        with tempfile.TemporaryDirectory(prefix='hosted-program-fixture-') as temporary:
            root = Path(temporary).resolve() / 'source'; root.mkdir()
            (root / 'hosted/deployment').mkdir(parents=True)
            files = ['LICENSE', 'hosted/deployment/program_files.json']
            (root / files[1]).write_text(json.dumps({'version': 1, 'files': files}), encoding='utf-8')
            (root / 'LICENSE').write_bytes(b'Generic program')
            for name in ('.dockerignore', 'hosted/Dockerfile', 'hosted/compose.yaml'): (root / name).write_bytes(b'Generic build control')
            for name in ('hosted/.env', 'hosted/private.key', 'hosted/local.log'): (root / name).write_bytes(b'Synthetic excluded bytes')
            target = root.parent / 'export'; hashes = export_context(root, target)
            self.assertEqual(set(hashes), set(files) | {'.dockerignore', 'hosted/Dockerfile', 'hosted/compose.yaml'})
            self.assertEqual({path.relative_to(target).as_posix() for path in target.rglob('*') if path.is_file()}, set(hashes))
            self.assertEqual((target / 'LICENSE').read_bytes(), b'Generic program')
            self.assertEqual((root / 'hosted/private.key').read_bytes(), b'Synthetic excluded bytes')
            with self.assertRaises(ContextError): export_context(root, target)
            with self.assertRaises(ContextError): export_context(root, root / 'nested')
            with self.assertRaises(ContextError): export_context(root, Path('relative-new-context'))

    def test_traversal_wildcards_duplicate_or_runtime_data_paths_are_refused(self):
        with tempfile.TemporaryDirectory(prefix='hosted-program-fixture-') as temporary:
            root = Path(temporary).resolve(); (root / 'hosted/deployment').mkdir(parents=True); manifest = root / 'hosted/deployment/program_files.json'
            for files in (['../outside'], ['/absolute'], ['hosted/core/*.py'], ['hosted/core/a.py', 'hosted/core/A.py'], ['hosted/core/private.key'], ['hosted/core/data/original.py'], ['hosted/core/test_input.py'], ['server.py']):
                with self.subTest(files=files):
                    manifest.write_text(json.dumps({'version': 1, 'files': files}), encoding='utf-8')
                    with self.assertRaises(ContextError): program_files(root)
            for value in ({'version': True, 'files': ['LICENSE']}, {'version': 1, 'files': []}, {'version': 1, 'files': ['LICENSE'], 'extra': True}):
                manifest.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ContextError): program_files(root)

    def test_native_hard_link_input_is_refused_without_copying_its_bytes(self):
        with tempfile.TemporaryDirectory(prefix='hosted-program-fixture-') as temporary:
            root = Path(temporary).resolve(); (root / 'hosted/deployment').mkdir(parents=True)
            (root / 'LICENSE').write_bytes(b'Synthetic original program')
            os.link(root / 'LICENSE', root / 'synthetic-linked-original')
            (root / 'hosted/deployment/program_files.json').write_text(json.dumps({'version': 1, 'files': ['LICENSE']}), encoding='utf-8')
            with self.assertRaises(ContextError): program_files(root)
