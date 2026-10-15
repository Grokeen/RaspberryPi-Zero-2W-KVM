"""2026-10-09 22:35 KST: CodexCode - wire bytes, isolation and recovery tests."""
import struct
import unittest
from zero2w_kvm.hid import Controller, ControlBusyError, USBDisconnectedError, keyboard_report, mouse_reports, KEYS, KEYBOARD_DESCRIPTOR


class HIDTests(unittest.TestCase):
    # 2026-10-16 00:15 KST: language keys must fit both the wire report and its HID descriptor.
    def test_international_function_and_keypad_usage_numbers(self):
        for code, usage in {"Lang1": 0x90, "Lang2": 0x91, "IntlRo": 0x87, "IntlYen": 0x89,
                            "KanaMode": 0x88, "Convert": 0x8A, "NonConvert": 0x8B,
                            "F13": 0x68, "F24": 0x73, "NumpadEqual": 0x67,
                            "NumpadComma": 0x85, "NumpadClear": 0xD8}.items():
            self.assertEqual(keyboard_report([code]), bytes([0, 0, usage, 0, 0, 0, 0, 0]))

    def test_descriptor_array_covers_every_supported_non_modifier_usage(self):
        fields, arrays, offset = {}, [], 0
        while offset < len(KEYBOARD_DESCRIPTOR):
            prefix = KEYBOARD_DESCRIPTOR[offset]
            length = (0, 1, 2, 4)[prefix & 3]
            value = int.from_bytes(KEYBOARD_DESCRIPTOR[offset + 1:offset + 1 + length], "little")
            tag = prefix & 0xFC
            if tag == 0x80 and value == 0:
                arrays.append((fields[0x24], fields[0x28], fields[0x74], fields[0x94]))
            fields[tag] = value
            offset += length + 1
        self.assertEqual(len(arrays), 1)
        logical, usage, bits, count = arrays[0]
        self.assertEqual((bits, count), (8, 6))
        self.assertTrue(all(0 < value <= min(logical, usage) for value in KEYS.values()))

    def test_language_tap_restores_other_held_keys_and_validates_restore_before_writing(self):
        self.controller.update({"type": "tap", "codes": ["ShiftLeft", "KeyA", "Lang1"],
                                "restore_codes": ["ShiftLeft", "KeyA"]}, "a")
        self.assertEqual(self.reports[-1][1], keyboard_report(["ShiftLeft", "KeyA"]))
        self.assertEqual(self.controller.keyboard_state, self.reports[-1][1])
        before = list(self.reports)
        with self.assertRaises(ValueError):
            self.controller.update({"type": "tap", "codes": ["Lang1"], "restore_codes": ["Invalid"]}, "a")
        self.assertEqual(self.reports, before)

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

    def test_korean_shift_combinations_have_correct_hid_modifier_and_usage(self):
        # 2026-10-10 01:00 KST: ㄲ/ㅉ/ㄸ/ㅆ/ㅃ/ㅒ/ㅖ use Shift+R/W/E/T/Q/O/P.
        for code, usage in [("KeyR", 21), ("KeyW", 26), ("KeyE", 8), ("KeyT", 23),
                            ("KeyQ", 20), ("KeyO", 18), ("KeyP", 19)]:
            self.assertEqual(keyboard_report(["ShiftLeft", code]), bytes([2, 0, usage, 0, 0, 0, 0, 0]))

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

    # 2026-10-11 17:02 KST: UK pipe uses Shift + USB non-US backslash (0x64).
    def test_uk_pipe_uses_existing_iso_keyboard_usage(self):
        self.assertEqual(keyboard_report(["ShiftLeft", "IntlBackslash"]), bytes([2, 0, 100, 0, 0, 0, 0, 0]))

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
