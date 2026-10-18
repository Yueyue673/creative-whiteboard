"""CI-only Linux containers, independent synthetic data and locally verified TLS."""
import http.cookiejar
import json
import os
import socket
import ssl
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from program_context import export_context, program_files

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def verify_build_boundary(root):
    """Actual Docker matching, with synthetic sentinels in an isolated tree."""
    baseline = root / 'parent-rule-baseline'; baseline.mkdir()
    for name in ('hosted/core/portal_assets/portal.js', 'hosted/private.env', 'hosted/core/fixture.log'):
        path = baseline / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'Synthetic context sentinel')
    (baseline / '.dockerignore').write_text('**\n!hosted\n!hosted/core\n!hosted/core/portal_assets\n!hosted/core/portal_assets/portal.js\n', encoding='utf-8')
    def snapshot(context, output):
        subprocess.run(['docker', 'build', '--progress=plain', '--file', '-', '--output', 'type=tar,dest=' + str(output), str(context)],
                       input='FROM scratch\nCOPY . /\n', text=True, check=True, timeout=120)
        with tarfile.open(output) as archive:
            return {item.name.removeprefix('./') for item in archive.getmembers() if item.isfile()}
    old = snapshot(baseline, root / 'parent-rule-output.tar')
    assert 'hosted/private.env' in old and 'hosted/core/fixture.log' in old
    # This is a minimal reproduction of the old parent-negation semantics,
    # not evidence that an actual private input has ever entered an image.
    context = root / 'program-context'; export_context(ROOT, context)
    probes = ['server.py', '.env', 'hosted/private.env', 'hosted/operator.key', 'hosted/core/fixture.log',
              'hosted/core/data/original.json', 'hosted/core/__pycache__/fixture.pyc',
              'hosted/core/portal_assets/unreviewed.js', 'hosted/deployment/private-config.json',
              'hosted/service/test_settings.py', 'hosted/tests/synthetic.mjs', 'vendor/private.key']
    for name in probes:
        path = context / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'Synthetic excluded input')
    included = snapshot(context, root / 'exact-context-output.tar')
    assert included == set(program_files(ROOT)), 'Docker context differs from the explicit program contract'
    assert not set(probes) & included
    return context


def main():
    if os.name != "posix":
        raise SystemExit("Container acceptance requires Linux Docker; this is not a Windows substitute.")
    with tempfile.TemporaryDirectory(prefix="creative-hosted-container-") as temporary:
        root = Path(temporary).resolve()
        build_root = verify_build_boundary(root)
        store, backups = root / "store", root / "backups"
        store.mkdir(); backups.mkdir()
        key = root / "fixture.key"
        key.write_text("container-fixture-only-" + "k" * 64, encoding="utf-8")
        os.chmod(store, 0o700); os.chmod(backups, 0o700); os.chmod(key, 0o400)
        subprocess.run(["sudo", "chown", "10001:10001", str(store), str(backups), str(key)], check=True)
        cert, private_key = root / "fixture.crt", root / "fixture.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", str(private_key), "-out", str(cert), "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        proxy_port, app_port = free_port(), free_port()
        proxy_conf = root / "nginx.conf"
        proxy_conf.write_text('events {}\nhttp { access_log off; error_log /dev/null; server { listen 443 ssl; server_name localhost; ssl_certificate /fixture/fixture.crt; ssl_certificate_key /fixture/fixture.pem; location / { proxy_pass http://app:8000; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Real-IP $remote_addr; } } }', encoding="utf-8")
        override = root / "override.yaml"
        override.write_text('services:\n  proxy:\n    image: nginx:stable-alpine\n    ports: ["127.0.0.1:' + str(proxy_port) + ':443"]\n    volumes:\n      - "' + str(proxy_conf) + ':/etc/nginx/nginx.conf:ro"\n      - "' + str(cert) + ':/fixture/fixture.crt:ro"\n      - "' + str(private_key) + ':/fixture/fixture.pem:ro"\n', encoding="utf-8")
        environment = {**os.environ, "HOSTED_DOMAIN": "localhost", "HOSTED_PORT": str(app_port), "HOSTED_DATA_DIR": str(store), "HOSTED_BACKUP_DIR": str(backups), "HOSTED_SECRET_PATH": str(key)}
        compose = ["docker", "compose", "-p", "hosted-check-" + str(os.getpid()), "-f", str(build_root / "hosted/compose.yaml"), "-f", str(override), "--profile", "operations"]
        def command(*arguments, input=None, capture=False):
            result = subprocess.run([*compose, *arguments], cwd=ROOT, env=environment, input=input, text=True, encoding="utf-8", capture_output=capture, timeout=480)
            if result.returncode:
                raise RuntimeError("Synthetic compose operation failed: " + " ".join(arguments[:3]) + ("\n" + result.stderr[-3000:] if capture else ""))
            return result.stdout if capture else ""
        def operations(*args):
            return command("run", "--rm", "--no-deps", "-T", "ops", *args, capture=True)
        def fixture(code):
            text = command("run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "ops", "manage.py", "shell", "--verbosity", "0", input=code, capture=True)
            return json.loads(text.strip().splitlines()[-1])
        def await_health():
            for _ in range(80):
                try:
                    with opener.open(origin + "/api/health", timeout=3) as response:
                        if response.status == 200:
                            return
                except (urllib.error.URLError, ConnectionError, TimeoutError):
                    time.sleep(.5)
            raise AssertionError("Synthetic HTTPS backend did not become ready")
        checks = [f'Actual Docker parent-negation baseline includes synthetic extras; exact context contains all{len(program_files(ROOT))} program files and excludes12 unlisted synthetic inputs.']
        try:
            resolved = json.loads(command("config", "--format", "json", capture=True))
            assert resolved["services"]["app"]["ports"][0]["host_ip"] == "127.0.0.1"
            assert resolved["services"]["app"]["read_only"] and resolved["services"]["app"]["user"] == "10001:10001"
            assert "CREATIVE_BOARD_HOSTED_SECRET" not in resolved["services"]["app"]["environment"]
            checks.append("Resolved Compose is non-root/read-only, bounded, loopback-only and file-secret based.")
            command("build", "app")
            inventory = command('run', '--rm', '--no-deps', '-T', '--entrypoint', 'python', 'ops', '-c',
                "import json;from pathlib import Path;r=Path('/opt/creative');print(json.dumps(sorted(str(p.relative_to(r)) for p in r.rglob('*') if p.is_file())))", capture=True)
            assert json.loads(inventory.strip().splitlines()[-1]) == sorted(program_files(ROOT))
            checks.append('Built application image contains exactly the reviewed program manifest, with latest assets/migration and no tests, caches, logs or synthetic secrets.')
            refused = subprocess.run([*compose, "run", "--rm", "--no-deps", "-T", "ops", "serve"], cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30)
            assert refused.returncode
            command("run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "ops", "-c", "from pathlib import Path; assert not Path('/data/accounts.sqlite3').exists()")
            operations("migrate")
            operations("check")
            data = fixture('''
import io,json,uuid
from core.models import Account,Initialization
from core.services import create_personal_workspace
from core.scope import WorkspaceScope
from core.documents import put_document
from core.media import upload_stream,reserve_upload,checked_storage
from core.maintenance import StorageLease
with StorageLease(offline=True):
 owner=Account.objects.create_user("owner@example.test","Container-Fixture-Only-Passphrase-729",display_name="Synthetic Owner")
 other=Account.objects.create_user("other@example.test","Other-Fixture-Only-Passphrase-631",display_name="Synthetic Other")
 Initialization.objects.create(id=1)
 workspace=create_personal_workspace(owner); foreign=create_personal_workspace(other)
 scope=WorkspaceScope(workspace,"owner")
 board={"format":"creative-board","version":1,"name":"Synthetic original","nodes":[{"id":"original","type":"note","title":"Synthetic own title","body":"Literal original **text**","sizeMode":"manual","x":12,"y":25,"w":321.5,"h":240.25,"tags":[],"color":"#e7e2da","opaque":[57]}],"edges":[],"view":{"x":10,"y":10,"z":1},"extension":[79]}
 put_document(scope,owner,"board","fixture",board,"new")
 raw=b"\\x89PNG\\r\\n\\x1a\\n"+bytes(range(64))
 asset=upload_stream(scope,owner,io.BytesIO(raw),len(raw),"fixture.png","")
 pending=reserve_upload(scope,owner,100,"pending.png","")
 checked_storage(scope,"incoming",pending.pk,create=True).write_bytes(b"Synthetic pending bytes")
 orphan=checked_storage(scope,"media",uuid.uuid4(),create=True); orphan.write_bytes(b"Synthetic unregistered bytes")
 print(json.dumps({"owner":owner.pk,"workspace":str(workspace.pk),"foreign":str(foreign.pk),"asset":str(asset.pk),"board":board}))
''')
            origin = "https://localhost:" + str(proxy_port)
            jar = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(cert))), urllib.request.HTTPCookieProcessor(jar))
            command("up", "-d", "app", "proxy")
            await_health()
            def request(path, *, method="GET", payload=None, headers=None):
                h = {"X-Creative-Account": str(data["owner"]), **(headers or {})}
                if payload is not None:
                    h["Content-Type"] = "application/json"
                    h["Origin"] = origin
                    h["X-CSRFToken"] = next(cookie.value for cookie in jar if cookie.name == "__Host-creative_csrf")
                req = urllib.request.Request(origin + path, data=json.dumps(payload).encode() if payload is not None else None, headers=h, method=method)
                try:
                    response = opener.open(req, timeout=10)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    return response.status, response.read(), response.headers
            assert request("/api/session")[0] == 200
            assert request("/api/login", method="POST", payload={"email":"owner@example.test","password":"Container-Fixture-Only-Passphrase-729"})[0] == 200
            assert any(cookie.name == "__Host-creative_session" and cookie.secure for cookie in jar)
            board_path = "/w/" + data["workspace"] + "/api/boards/fixture"
            status, board_raw, board_headers = request(board_path)
            assert status == 200 and json.loads(board_raw) == data["board"]
            media_path = "/w/" + data["workspace"] + "/api/media/" + data["asset"]
            raw = b"\x89PNG\r\n\x1a\n" + bytes(range(64))
            assert request(media_path)[1] == raw
            status, part, headers = request(media_path, headers={"Range":"bytes=8-15"})
            assert status == 206 and part == raw[8:16]
            assert request("/w/" + data["foreign"] + "/api/boards/fixture")[0] in (403,404)
            assert request("/api/assets?path=/etc/passwd")[0] == 404
            assert request(board_path, headers={"X-Creative-Account":"999999"})[0] == 409
            checks.append("Real locally verified HTTPS, secure login/CSRF, exact board/media/Range, fixed-account and foreign-workspace refusal.")
            refused = subprocess.run([*compose,"run","--rm","--no-deps","-T","ops","manage","backup_store","--service-stopped","--destination","/backups/blocked"], cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30)
            assert refused.returncode
            command("stop", "app")
            package = json.loads(operations("manage", "backup_store", "--service-stopped", "--destination", "/backups/complete"))
            verified = json.loads(operations("manage", "verify_backup", "--source", "/backups/complete"))
            manifest_hash = verified["manifestHash"]
            original_store = store
            restored = root / "restored"
            restored.mkdir(); os.chmod(restored,0o700); subprocess.run(["sudo","chown","10001:10001",str(restored)],check=True)
            environment["HOSTED_DATA_DIR"] = str(restored)
            operations("manage", "restore_store", "--service-stopped", "--source", "/backups/complete", "--manifest-hash", manifest_hash, "--confirm-restore-new-store")
            command("up", "-d", "app")
            command("restart", "proxy")
            await_health()
            assert request(board_path)[1] == board_raw
            assert request(media_path)[1] == raw
            assert request("/api/session")[0] == 200
            checks.append("Running workers block offline backup; stopped full store restores to a different empty directory with exact original board/media and login.")
            assert original_store.exists()
            logs = command("logs", "--no-color", "app", capture=True)
            assert "?path=" not in logs and "Container-Fixture-Only-Passphrase" not in logs and "container-fixture-only-" not in logs
            checks.append("Original store retained, synthetic query/password/key omitted from container logs.")
            print(json.dumps({"completed":True,"checks":checks,"tlsScope":"local synthetic CA verified; no external DNS/certificate acceptance","privateDataUsed":False},indent=2))
        finally:
            try:
                command("down", "--remove-orphans")
            finally:
                # Ownership belongs only to this resolved temporary CI fixture tree.
                assert root.is_relative_to(Path(tempfile.gettempdir()).resolve()) and root.name.startswith("creative-hosted-container-")
                subprocess.run(["sudo", "chown", "-R", str(os.getuid()) + ":" + str(os.getgid()), str(root)], check=True)


if __name__ == "__main__":
    main()
