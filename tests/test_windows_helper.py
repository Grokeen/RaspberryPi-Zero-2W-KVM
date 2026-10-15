"""2026-10-16 03:27 KST: exercise the real Windows HTTP client against a private fixture, never a user's clipboard."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest


@unittest.skipUnless(sys.platform == "win32" and shutil.which("powershell.exe"), "Windows PowerShell only")
class WindowsHelperTests(unittest.TestCase):
    def test_http_client_utf8_auth_failure_and_bounded_timeout(self):
        requests = []

        class Fixture(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization"), None))
                if self.path == "/slow":
                    time.sleep(0.8)
                body = json.dumps({"ok": True}).encode()
                self.send_response(403 if self.path == "/denied" else 200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                requests.append((self.path, self.headers.get("Authorization"), json.loads(raw)))
                self.send_response(200)
                self.send_header("Content-Length", "11")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        helper = Path(__file__).parents[1] / "src/zero2w_kvm/static/windows-clipboard-helper.ps1"
        script = """
$ErrorActionPreference = 'Stop'
. '__HELPER__'
$KvmServer = 'http://127.0.0.1:__PORT__'
$KvmAgentToken = 'fixture-only-scoped-token'
$client = New-KvmHttpClient
try {
    if (!(Invoke-KvmRequest $client '/health').ok) { throw 'Health response lost' }
    Invoke-KvmRequest $client '/result' @{job='fixture-job'; text='한글 🖥'} | Out-Null
    $denied = $false
    try { Invoke-KvmRequest $client '/denied' | Out-Null } catch { $denied = (Get-KvmFailure $_) -match 'authentication failed' }
    if (!$denied) { throw 'HTTP 403 classification lost' }
} finally { $client.Dispose() }
$client = New-KvmHttpClient
$client.Timeout = [TimeSpan]::FromMilliseconds(100)
try {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $timedOut = $false
    try { Invoke-KvmRequest $client '/slow' | Out-Null } catch { $timedOut = (Get-KvmFailure $_) -match 'Cannot reach' }
    if (!$timedOut -or $timer.Elapsed.TotalSeconds -gt 3) { throw 'Request timeout was not bounded' }
} finally { $client.Dispose() }
Write-Host 'PASS isolated HTTP fixture'
""".replace("__HELPER__", str(helper).replace("'", "''")).replace("__PORT__", str(server.server_port))
        try:
            with tempfile.TemporaryDirectory(prefix="kvm-http-fixture-") as directory:
                path = Path(directory) / "fixture.ps1"
                path.write_text(script, encoding="utf-8-sig")
                result = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(path)], capture_output=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            self.assertTrue(all(auth == "Bearer fixture-only-scoped-token" for _, auth, _ in requests))
            posted = [payload for route, _, payload in requests if route == "/result"]
            self.assertEqual(posted, [{"job": "fixture-job", "text": "한글 🖥"}])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
