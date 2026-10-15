"""2026-10-15 23:10 KST: CodexCode - localhost forwarding auth, origin checks and upgrades."""
import http.client
import json
import socket
import socketserver
import threading
import unittest
from zero2w_kvm.hid import Controller
from zero2w_kvm.local_console import LocalConsole
from zero2w_kvm.server import Application, Server


class LocalConsoleTests(unittest.TestCase):
    def setUp(self):
        self.token = "test-local-console-access-token-only"
        app = Application(self.token, Controller(writer=lambda *_: None,
                                                state_reader=lambda: "configured"))
        self.pi = Server(("127.0.0.1", 0), app)
        self.proxy = LocalConsole(0, ("127.0.0.1", self.pi.server_port))
        self.servers = [self.pi, self.proxy]
        for server in self.servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        self.port = self.proxy.server_address[1]

    def tearDown(self):
        for server in reversed(self.servers):
            server.shutdown()
            server.server_close()

    def request(self, path, data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        supplied = {"Content-Type": "application/json", **(headers or {})}
        connection.request("GET" if data is None else "POST", path,
                           None if data is None else json.dumps(data), supplied)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_loopback_health_and_authenticated_console(self):
        code, _, body = self.request("/__local_kvm__/status")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["pi_port"], self.pi.server_port)
        self.assertEqual(self.proxy.server_address[0], "127.0.0.1")
        self.assertEqual(self.request("/api/status")[0], 401)
        origin = {"Origin": f"http://127.0.0.1:{self.port}"}
        code, headers, _ = self.request("/api/login", {"token": self.token}, origin)
        self.assertEqual(code, 200)
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0], **origin}
        self.assertEqual(self.request("/api/status", headers=cookie)[0], 200)
        self.assertEqual(self.request("/api/logout", {}, cookie)[0], 200)
        self.assertEqual(self.request("/api/status", headers=cookie)[0], 401)

    def test_cross_origin_and_dns_rebinding_are_rejected(self):
        for headers in ({"Host": "evil.example"}, {"Origin": "https://evil.example"},
                        {"Origin": "null"}, {"Host": f"localhost:{self.port}",
                                            "Origin": f"http://127.0.0.1:{self.port}"}):
            self.assertEqual(self.request("/api/login", {"token": self.token}, headers)[0], 403)

    def test_localhost_name_is_supported_and_camera_policy_is_present(self):
        code, headers, body = self.request("/", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual(code, 200)
        self.assertIn(b"local-video-device", body)
        self.assertEqual(headers["Permissions-Policy"], "camera=(self), microphone=()")
        self.assertIn("media-src 'self' blob:", headers["Content-Security-Policy"])

    def test_offline_pi_returns_gateway_error(self):
        self.proxy.target = ("127.0.0.1", 0)
        self.assertEqual(self.request("/")[0], 502)

    def test_websocket_upgrade_preserves_bidirectional_bytes(self):
        class Upgrade(socketserver.BaseRequestHandler):
            def handle(self):
                data = b""
                while b"\r\n\r\n" not in data:
                    data += self.request.recv(4096)
                self.request.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
                self.request.sendall(self.request.recv(4096))

        upstream = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Upgrade)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        self.servers.append(upstream)
        self.proxy.target = upstream.server_address
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as connection:
            connection.sendall((f"GET /api/pi/vnc HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                                f"Origin: http://127.0.0.1:{self.port}\r\nUpgrade: websocket\r\n\r\n").encode())
            header = b""
            while b"\r\n\r\n" not in header:
                header += connection.recv(4096)
            self.assertIn(b"101 Switching Protocols", header)
            payload = b"\x82\x04test"
            connection.sendall(payload)
            self.assertEqual(connection.recv(4096), payload)
