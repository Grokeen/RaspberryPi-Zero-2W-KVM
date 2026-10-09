"""2026-10-09 22:35 KST: CodexCode - wire bytes, isolation and recovery tests."""
import struct
import unittest
from zero2w_kvm.hid import Controller, ControlBusyError, USBDisconnectedError, keyboard_report, mouse_reports


class HIDTests(unittest.TestCase):
    def setUp(self):
        self.reports = []
        self.now = 0
        self.controller = Controller(writer=lambda path, data: self.reports.append((path, data)),
                                     clock=lambda: self.now, state_reader=lambda: "configured")

    def test_boot_keyboard_and_modifiers(self):
        self.assertEqual(keyboard_report(["ControlLeft", "AltLeft", "Delete"]),
                         bytes([5, 0, 76, 0, 0, 0, 0, 0]))
        self.assertEqual(keyboard_report(["KeyA", "KeyA", "ShiftRight"]),
                         bytes([32, 0, 4, 0, 0, 0, 0, 0]))

    def test_invalid_keys_and_rollover_are_rejected(self):
        for codes in [["KeyZ", "Unidentified"], [False], None, list("ABCDEFG")]:
            with self.assertRaises(ValueError):
                keyboard_report(codes)
        with self.assertRaises(ValueError):
            keyboard_report([f"Key{letter}" for letter in "ABCDEFG"])

    def test_mouse_split_preserves_distance_buttons_and_wheel(self):
        parts = [struct.unpack("Bbbb", report) for report in mouse_reports(400, -350, 5, -2)]
        self.assertTrue(all(part[0] == 5 for part in parts))
        self.assertEqual(tuple(sum(part[i] for part in parts) for i in (1, 2, 3)), (400, -350, -2))
        self.assertEqual(mouse_reports(), [bytes(4)])

    def test_mouse_rejects_overflow_and_nonintegers(self):
        for kwargs in [{"x": 2049}, {"buttons": 8}, {"y": 1.5}, {"wheel": True}]:
            with self.assertRaises(ValueError):
                mouse_reports(**kwargs)

    def test_validation_has_no_usb_side_effects(self):
        with self.assertRaises(ValueError):
            self.controller.update({"type": "mouse", "x": 4, "buttons": 8}, "a")
        self.assertEqual(self.reports, [])
        self.assertIsNone(self.controller.owner)

    def test_sessions_cannot_interleave_or_release_other_session(self):
        self.controller.update({"type": "keyboard", "codes": ["KeyA"]}, "a")
        with self.assertRaises(ControlBusyError):
            self.controller.update({"type": "release"}, "b")
        self.assertEqual(len(self.reports), 1)

    def test_watchdog_releases_keyboard_and_mouse_then_allows_new_owner(self):
        self.controller.update({"type": "keyboard", "codes": ["ControlLeft"]}, "a")
        self.controller.update({"type": "mouse", "buttons": 1}, "a")
        self.now = 3
        self.controller.expire()
        self.assertEqual(self.reports[-2:], [("/dev/hidg0", bytes(8)), ("/dev/hidg1", bytes(4))])
        self.assertIsNone(self.controller.owner)
        self.controller.update({"type": "heartbeat"}, "b")
        self.assertEqual(self.controller.owner, "b")

    def test_failed_release_attempts_both_devices_and_retries(self):
        self.controller.update({"type": "keyboard", "codes": ["KeyA"]}, "a")
        def fail_keyboard(path, report):
            self.reports.append((path, report))
            if path.endswith("0"):
                raise OSError("unplugged")
        self.controller.writer = fail_keyboard
        self.now = 3
        with self.assertRaises(OSError):
            self.controller.expire()
        self.assertEqual(self.reports[-1], ("/dev/hidg1", bytes(4)))
        self.assertTrue(any(self.controller.keyboard_state))
        self.controller.writer = lambda path, data: self.reports.append((path, data))
        self.controller.expire()
        self.assertEqual(self.controller.keyboard_state, bytes(8))

    def test_tap_always_sends_key_release(self):
        self.controller.update({"type": "tap", "codes": ["Enter"]}, "a")
        self.assertEqual(self.reports[-1], ("/dev/hidg0", bytes(8)))

    # 2026-10-10 00:26 KST: detached input must not touch HID or claim the USB lease.
    def test_disconnected_host_rejects_keyboard_mouse_tap_and_heartbeat(self):
        self.controller.state_reader = lambda: "not attached"
        for event in [{"type": "keyboard", "codes": ["KeyA"]},
                      {"type": "mouse", "x": 1}, {"type": "tap", "codes": ["Enter"]},
                      {"type": "heartbeat"}]:
            with self.assertRaises(USBDisconnectedError):
                self.controller.update(event, "a")
        self.assertEqual(self.reports, [])
        self.assertIsNone(self.controller.owner)

    def test_disconnected_empty_release_is_a_noop(self):
        self.controller.state_reader = lambda: "not attached"
        self.controller.update({"type": "release"}, "a")
        self.assertEqual(self.reports, [])
        self.assertIsNone(self.controller.owner)

    def test_release_pending_keys_survives_disconnect_and_reconnect(self):
        self.controller.update({"type": "keyboard", "codes": ["KeyA"]}, "a")
        self.controller.state_reader = lambda: "not attached"
        def unavailable(path, report):
            raise OSError(108, "Cannot send after transport endpoint shutdown")
        self.controller.writer = unavailable
        with self.assertRaises(OSError):
            self.controller.release()
        self.assertTrue(any(self.controller.keyboard_state))
        self.controller.state_reader = lambda: "configured"
        self.controller.writer = lambda p, r: self.reports.append((p, r))
        self.controller.release()
        self.assertEqual(self.reports[-2:], [("/dev/hidg0", bytes(8)), ("/dev/hidg1", bytes(4))])


if __name__ == "__main__":
    unittest.main()
