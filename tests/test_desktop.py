"""2026-10-09 23:38 KST: CodexCode - authenticated WebSocket bridge and asset confinement."""
import base64
import hashlib
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
from zero2w_kvm.desktop import PiDesktop, websocket_key
from zero2w_kvm.server import Application, Server

TOKEN = "desktop-test-token-only-32-characters"
KEY = "dGhlIHNhbXBsZSBub25jZQ=="
UPGRADE = {"Upgrade": "websocket", "Connection": "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": KEY}


class Backend:
    def __init__(self, valid=True):
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen()
        self.port = self.socket.getsockname()[1]
        self.request = None
        self.valid = valid
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        connection, _ = self.socket.accept()
        with connection:
            connection.settimeout(3)
            self.request = b""
            while b"\r\n\r\n" not in self.request:
                data = connection.recv(4096)
                if not data:
                    return
                self.request += data
            key = next(line.split(b": ", 1)[1] for line in self.request.split(b"\r\n") if line.startswith(b"Sec-WebSocket-Key:"))
            accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            connection.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                               + (accept if self.valid else b"invalid") + b"\r\n\r\n\x82\x0cRFB 003.008\n")
            try:
                while True:
                    data = connection.recv(4096)
                    if not data:
                        break
                    connection.sendall(data)
            except (OSError, TimeoutError):
                pass

    def close(self):
        self.socket.close()
        self.thread.join(timeout=4)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.credentials = self.root / "credentials.json"
        self.credentials.write_text(json.dumps({"username": "test-user", "password": "test-password"}))
        (self.root / "core").mkdir()
        (self.root / "core/rfb.js").write_text("export default class RFB {}")
        self.desktop = PiDesktop(credentials_file=self.credentials, assets=self.root)
        self.app = Application(TOKEN, desktop=self.desktop)
        self.server = Server(("127.0.0.1", 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.app.closed.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def request(self, path, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request("GET", path, headers=headers or {})
        res = conn.getresponse()
        result = res.status, res.read()
        conn.close()
        return result

    def auth(self):
        return {"Authorization": "Bearer " + TOKEN}

    def test_status_credentials_and_modules_require_authentication(self):
        for path in ("/api/pi/status", "/api/pi/vnc", "/novnc/core/rfb.js"):
            self.assertEqual(self.request(path)[0], 401)
        self.assertEqual(self.request("/pi")[0], 200)
        self.assertEqual(self.request("/pi.js")[0], 200)
        self.assertEqual(self.request("/api/pi/credentials", self.auth())[0], 404)

    def test_encoded_and_plain_traversal_are_rejected(self):
        for path in ("/novnc/core/../credentials.json", "/novnc/core/%2e%2e/credentials.json",
                     "/novnc/core/%2fetc/passwd.js", "/novnc/core/..%5ccredentials.js"):
            self.assertEqual(self.request(path, self.auth())[0], 404)
        self.assertEqual(self.request("/novnc/core/rfb.js", self.auth())[0], 200)

    def test_websocket_rejects_missing_and_foreign_origins(self):
        for origin in (None, "http://evil.example"):
            headers = {**self.auth(), **UPGRADE}
            if origin:
                headers["Origin"] = origin
            self.assertEqual(self.request("/api/pi/vnc", headers)[0], 403)

    def test_websocket_rejects_invalid_nonce_and_non_upgrade(self):
        headers = {**self.auth(), "Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(self.request("/api/pi/vnc", headers)[0], 400)
        headers.update(UPGRADE)
        headers["Sec-WebSocket-Key"] = "bad"
        self.assertEqual(self.request("/api/pi/vnc", headers)[0], 400)

    def test_bridge_relays_initial_and_bidirectional_frames_without_credentials(self):
        backend = Backend()
        self.desktop.port = backend.port
        client = socket.create_connection(("127.0.0.1", self.port), timeout=3)
        try:
            headers = {**self.auth(), **UPGRADE, "Origin": f"http://127.0.0.1:{self.port}"}
            request = f"GET /api/pi/vnc HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
            request += "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n"
            client.sendall(request.encode())
            response = b""
            while b"RFB 003.008\n" not in response:
                response += client.recv(4096)
            self.assertIn(b"101 Switching Protocols", response)
            self.assertNotIn(TOKEN.encode(), backend.request)
            self.assertIn(b"Authorization: Basic ", backend.request)
            self.assertNotIn(b"Bearer ", backend.request)
            client.sendall(b"\x82\x03abc")
            self.assertEqual(client.recv(5), b"\x82\x03abc")
            self.app.closed.set()
            self.assertEqual(client.recv(1), b"")
        finally:
            client.close()
            backend.close()

    def test_invalid_backend_handshake_is_rejected(self):
        backend = Backend(valid=False)
        self.desktop.port = backend.port
        try:
            with self.assertRaises(OSError):
                self.desktop.upgrade(KEY)
        finally:
            backend.close()

    def test_all_viewer_slots_in_use_returns_429(self):
        for _ in range(4):
            self.desktop.slots.acquire()
        headers = {**self.auth(), **UPGRADE, "Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(self.request("/api/pi/vnc", headers)[0], 429)
        for _ in range(4):
            self.desktop.slots.release()

    def test_authentication_payload_is_not_in_status(self):
        code, body = self.request("/api/pi/status", self.auth())
        self.assertEqual(code, 200)
        self.assertNotIn(b"test-password", body)

    def test_platform_without_unix_sockets_reports_not_ready(self):
        with patch.object(socket, "AF_UNIX", None, create=True):
            state = self.desktop.status()
        self.assertTrue(state["enabled"])
        self.assertFalse(state["ready"])


if __name__ == "__main__":
    unittest.main()
