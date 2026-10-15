"""2026-10-16 00:25 KST: CodexCode - explicit clipboard jobs, scope, expiry and text bounds."""
import unittest
from zero2w_kvm.clipboard import ClipboardBridge


class ClipboardTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.bridge = ClipboardBridge("test-only-console-token-32-characters", clock=lambda: self.now)

    def test_helper_scope_and_explicit_single_use_job(self):
        self.assertFalse(self.bridge.accepts_agent("test-only-console-token-32-characters"))
        self.assertTrue(self.bridge.accepts_agent(self.bridge.agent_token))
        self.assertIsNone(self.bridge.poll())
        self.assertIsNone(self.bridge.job)
        identity = self.bridge.create("owner")
        self.assertEqual(self.bridge.poll(), identity)
        self.assertIsNone(self.bridge.poll())
        with self.assertRaises(KeyError):
            self.bridge.result(identity, "other")
        self.assertEqual(self.bridge.result(identity, "owner"), {"ready": False})
        text = "첫째 줄\r\n둘째 줄\t😀  "
        self.bridge.complete(identity, text)
        self.assertEqual(self.bridge.result(identity, "owner")["text"], text)
        self.assertIsNone(self.bridge.job)

    def test_offline_expired_cancelled_and_replayed_jobs_are_rejected(self):
        with self.assertRaises(ConnectionError):
            self.bridge.create("owner")
        self.bridge.poll()
        identity = self.bridge.create("owner")
        self.bridge.poll()
        self.bridge.cancel("other")
        self.assertEqual(self.bridge.result(identity, "owner"), {"ready": False})
        self.bridge.cancel("owner")
        with self.assertRaises(KeyError):
            self.bridge.complete(identity, "late")
        self.bridge.poll()
        identity = self.bridge.create("owner")
        self.bridge.poll()
        self.now = 11
        with self.assertRaises(KeyError):
            self.bridge.complete(identity, "expired")
        self.assertFalse(self.bridge.status()["agent_ready"])
        self.bridge.expire()
        self.assertIsNone(self.bridge.job)

    def test_utf8_byte_limit_and_failure_codes(self):
        self.bridge.poll()
        identity = self.bridge.create("owner")
        self.bridge.poll()
        with self.assertRaises(ValueError):
            self.bridge.complete(identity, "가" * 22000)
        with self.assertRaises(ValueError):
            self.bridge.complete(identity, error="arbitrary error details")
        self.bridge.complete(identity, error="no_text")
        result = self.bridge.result(identity, "owner")
        self.assertEqual(result["error"], "no_text")
        self.assertIsNone(result["text"])
