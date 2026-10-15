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
        self.app = Application(TOKEN, Controller(writer=lambda p, r: self.reports.append((p, r)),
                                                 state_reader=lambda: "configured"))
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

    # 2026-10-16 00:15 KST: a public same-origin script uses the actual backend allowlist.
    def test_browser_keyboard_table_matches_hid_backend(self):
        from zero2w_kvm.hid import KEY_CODES
        code, headers, body = self.request("/keyboard-map.js")
        self.assertEqual(code, 200)
        self.assertIn("text/javascript", headers["Content-Type"])
        mapping = json.loads(body.decode().split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        self.assertEqual(mapping, KEY_CODES)
        self.assertEqual(mapping["Lang1"], 0x90)

    def test_clipboard_helper_token_cannot_control_usb_or_read_console(self):
        agent = {"Authorization": "Bearer " + self.app.clipboard.agent_token}
        self.assertEqual(self.request("/api/clipboard/agent/poll")[0], 401)
        self.assertEqual(self.request("/api/clipboard/agent/poll", headers=self.auth())[0], 401)
        self.assertEqual(self.request("/api/clipboard/agent/poll", headers=agent)[0], 200)
        self.assertEqual(self.request("/api/status", headers=agent)[0], 401)
        self.assertEqual(self.request("/api/input", {"type": "tap", "codes": ["KeyA"]}, agent)[0], 401)
        self.assertEqual(self.reports, [])

    def test_explicit_clipboard_copy_flow_and_owner_authentication(self):
        agent = {"Authorization": "Bearer " + self.app.clipboard.agent_token}
        self.request("/api/clipboard/agent/poll", headers=agent)
        self.assertEqual(self.request("/api/clipboard/copy", {}, self.auth())[0], 409)
        self.app.controller.owner = "bearer"
        code, _, body = self.request("/api/clipboard/copy", {}, self.auth())
        self.assertEqual(code, 200)
        job = json.loads(body)["job"]
        self.assertEqual(json.loads(self.request("/api/clipboard/agent/poll", headers=agent)[2])["job"], job)
        content = "테스트\r\nwith spaces  😀"
        self.assertEqual(self.request("/api/clipboard/agent/result", {"job": job, "text": content}, agent)[0], 200)
        self.assertEqual(self.request("/api/clipboard/result?job=" + job)[0], 401)
        result = json.loads(self.request("/api/clipboard/result?job=" + job, headers=self.auth())[2])
        self.assertEqual(result["text"], content)
        self.assertEqual(self.request("/api/clipboard/result?job=" + job, headers=self.auth())[0], 404)
        self.assertEqual(self.reports, [])

    def test_windows_helper_is_paired_only_for_authenticated_downloads(self):
        self.assertEqual(self.request("/api/clipboard/windows-helper.ps1")[0], 401)
        code, headers, body = self.request("/api/clipboard/windows-helper.ps1", headers=self.auth())
        self.assertEqual(code, 200)
        self.assertIn(b"http://127.0.0.1:", body)
        self.assertIn(self.app.clipboard.agent_token.encode(), body)
        self.assertNotIn(TOKEN.encode(), body)
        self.assertNotIn(b"__KVM_AGENT_TOKEN__", body)
        self.assertEqual(headers["Cache-Control"], "no-store")

    # 2026-10-11 15:27 KST: the key planner is available with the normal console assets.
    def test_text_planner_asset_is_served_as_javascript(self):
        code, headers, body = self.request("/text-entry.js")
        self.assertEqual(code, 200)
        self.assertIn("text/javascript", headers["Content-Type"])
        self.assertIn(b"KVMText", body)
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
        self.assertEqual(json.loads(body)["code"], "usb_disconnected")

    def test_errno_108_is_a_readable_disconnection_response(self):
        def unavailable(path, report):
            raise OSError(108, "Cannot send after transport endpoint shutdown")
        self.app.controller.writer = unavailable
        code, _, body = self.request("/api/input", {"type": "keyboard", "codes": ["KeyA"]}, self.auth())
        self.assertEqual(code, 503)
        result = json.loads(body)
        self.assertEqual(result["code"], "usb_disconnected")
        self.assertIn("데이터 케이블", result["error"])

    def test_disconnected_heartbeat_does_not_claim_control(self):
        self.app.controller.state_reader = lambda: "not attached"
        code, _, body = self.request("/api/input", {"type": "heartbeat"}, self.auth())
        self.assertEqual(code, 503)
        self.assertEqual(json.loads(body)["code"], "usb_disconnected")
        self.assertIsNone(self.app.controller.owner)
        self.assertEqual(self.reports, [])

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
