"""2026-10-09 22:35 KST: CodexCode - real HTTP auth, CSRF and input routing tests."""
import http.client
import json
import threading
import unittest
from zero2w_kvm.hid import Controller
from zero2w_kvm.server import Application, Server

TOKEN = "test-only-access-token-32-characters"


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.reports = []
        self.app = Application(TOKEN, Controller(writer=lambda p, r: self.reports.append((p, r))))
        self.server = Server(("127.0.0.1", 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.app.closed.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, data=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        headers = {**({"Content-Type": "application/json"} if data is not None or raw else {}), **(headers or {})}
        connection.request("POST" if data is not None or raw else "GET", path,
                           raw if raw is not None else json.dumps(data) if data is not None else None, headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def auth(self):
        return {"Authorization": "Bearer " + TOKEN}

    def test_unauthenticated_input_and_status_are_rejected(self):
        self.assertEqual(self.request("/api/status")[0], 401)
        self.assertEqual(self.request("/api/input", {"type": "release"})[0], 401)
        self.assertEqual(self.reports, [])

    def test_login_cookie_authentication_logout_and_release(self):
        code, headers, _ = self.request("/api/login", {"token": TOKEN})
        self.assertEqual(code, 200)
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        self.assertEqual(self.request("/api/status", headers=cookie)[0], 200)
        self.assertEqual(self.request("/api/input", {"type": "keyboard", "codes": ["KeyA"]}, cookie)[0], 200)
        self.assertEqual(self.request("/api/logout", {}, cookie)[0], 200)
        self.assertEqual(self.reports[-2:], [("/dev/hidg0", bytes(8)), ("/dev/hidg1", bytes(4))])
        self.assertEqual(self.request("/api/status", headers=cookie)[0], 401)

    def test_cross_origin_cannot_login_or_send_input(self):
        headers = {**self.auth(), "Origin": "http://evil.example"}
        for path, data in [("/api/login", {"token": TOKEN}), ("/api/input", {"type": "release"})]:
            self.assertEqual(self.request(path, data, headers)[0], 403)
        self.assertEqual(self.reports, [])

    def test_same_origin_is_allowed(self):
        headers = {**self.auth(), "Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(self.request("/api/input", {"type": "release"}, headers)[0], 200)

    def test_login_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.request("/api/login", {"token": "wrong"})[0], 401)
        self.assertEqual(self.request("/api/login", {"token": TOKEN})[0], 429)

    def test_malformed_and_oversized_json_do_not_write(self):
        for raw in ['[]', '{bad', '{"type":"release","extra":"' + 'x' * 8200 + '"}']:
            self.assertEqual(self.request("/api/input", headers=self.auth(), raw=raw)[0], 400)
        self.assertEqual(self.reports, [])

    def test_device_permission_errors_return_unavailable(self):
        def deny(path, report):
            raise PermissionError("device permission denied")
        self.app.controller.writer = deny
        self.assertEqual(self.request("/api/input", {"type": "release"}, self.auth())[0], 503)

    def test_second_browser_receives_conflict(self):
        self.assertEqual(self.request("/api/input", {"type": "heartbeat"}, self.auth())[0], 200)
        _, headers, _ = self.request("/api/login", {"token": TOKEN})
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        self.assertEqual(self.request("/api/input", {"type": "release"}, cookie)[0], 409)

    def test_unplugged_usb_broken_pipe_returns_json_unavailable(self):
        def unplugged(path, report):
            raise BrokenPipeError(32, "Broken pipe")
        self.app.controller.writer = unplugged
        code, headers, body = self.request("/api/input", {"type": "release"}, self.auth())
        self.assertEqual(code, 503)
        self.assertIn("USB input unavailable", json.loads(body)["error"])

    def test_logout_revokes_session_even_when_usb_disappears(self):
        _, headers, _ = self.request("/api/login", {"token": TOKEN})
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        self.request("/api/input", {"type": "keyboard", "codes": ["KeyA"]}, cookie)
        def unplugged(path, report):
            raise BrokenPipeError(32, "Broken pipe")
        self.app.controller.writer = unplugged
        self.assertEqual(self.request("/api/logout", {}, cookie)[0], 200)
        self.assertEqual(self.request("/api/status", headers=cookie)[0], 401)
        self.assertTrue(any(self.app.controller.keyboard_state))

    def test_static_assets_and_path_traversal(self):
        for path in ("/", "/app.js", "/style.css"):
            code, headers, body = self.request(path)
            self.assertEqual(code, 200)
            self.assertTrue(body)
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("/../../codexCode.md")[0], 404)
        self.assertEqual(self.request("/api/video", headers=self.auth())[0], 503)


if __name__ == "__main__":
    unittest.main()
