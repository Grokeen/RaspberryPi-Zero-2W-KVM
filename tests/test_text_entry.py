"""2026-10-23 22:24 KST: CodexCode - background typing, cancellation and ownership regression tests."""
import json
from pathlib import Path
import shutil
import subprocess
import threading
import unittest

from zero2w_kvm.hid import Controller, ControlBusyError, keyboard_report
from zero2w_kvm.text_entry import TextEntry, plan_text


class TextEntryTests(unittest.TestCase):
    def setUp(self):
        self.reports = []
        self.controller = Controller(writer=lambda p, r: self.reports.append((p, r)),
                                     state_reader=lambda: "configured")
        self.entry = TextEntry(self.controller)

    def tearDown(self):
        self.entry.close()

    def finish(self):
        self.entry.thread.join(timeout=3)
        self.assertFalse(self.entry.thread.is_alive())
        return self.entry.status("a")["job"]

    @unittest.skipUnless(shutil.which("node"), "Node required for browser/server planner parity")
    def test_server_and_browser_plans_match_symbols_korean_jamo_and_all_ime_choices(self):
        samples = [["\t\n\r\n" + "".join(chr(c) for c in range(32, 127)), "us", "AltRight"],
                   ['£¬@"#~\\|', "gb", "AltRight"], ["한글 값쌍ㅏㄱ A\n", "ko", "Lang1"]]
        # Cover every Hangul syllable, including compound vowels/finals, in valid-size jobs.
        for offset in range(0xAC00, 0xD7A4, 2000):
            samples.append(["".join(chr(c) for c in range(offset, min(offset + 2000, 0xD7A4))), "ko", "AltRight"])
        for ime in ["ControlLeft,Space", "ShiftLeft,Space", "MetaLeft,Space"]:
            samples.append(["한글 ABC ㄲㅖ", "ko", ime])
        script = "require(process.argv[1]);let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(x=>KVMText.plan(...x)))));"
        planner = Path(__file__).parents[1] / "src/zero2w_kvm/static/text-entry.js"
        result = subprocess.run(["node", "-e", script, str(planner)], input=json.dumps(samples),
                                capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertEqual(json.loads(result.stdout), [plan_text(*sample) for sample in samples])

    def test_invalid_request_is_rejected_without_usb_writes(self):
        for text, layout, ime in [("ok😀", "us", "AltRight"), ("\x00", "us", "AltRight"),
                                  ("a" * 2001, "us", "AltRight"), ("한", "ko", "KeyA"),
                                  (None, "us", "AltRight"), ("a", [], "AltRight")]:
            with self.assertRaises(ValueError):
                self.entry.start("a", text, layout, ime)
        self.assertEqual(self.reports, [])

    def test_background_job_survives_browser_release_and_excludes_other_input(self):
        result = self.entry.start("a", "Ab\n" * 4)
        self.assertTrue(result["busy"])
        self.assertIsNotNone(result["job"]["id"])
        self.entry.input({"type": "release"}, "a")
        self.assertIsNone(self.entry.status("b")["job"])
        for owner in ("a", "b"):
            with self.assertRaises(ControlBusyError):
                self.entry.input({"type": "tap", "codes": ["KeyX"]}, owner)
            with self.assertRaises(ControlBusyError):
                self.entry.start(owner, "duplicate")
        with self.assertRaises(KeyError):
            self.entry.cancel("b", result["job"]["id"])
        self.controller.last_input -= 10
        self.entry.expire()
        self.assertEqual(self.controller.owner, "a")
        self.assertEqual(self.finish()["state"], "completed")
        self.assertEqual(self.entry.status("a")["job"]["progress"], 12)
        self.assertIsNone(self.controller.owner)
        down = [r for p, r in self.reports if p.endswith("0") and any(r)]
        self.assertEqual(down, [keyboard_report(keys) for keys in (["ShiftLeft", "KeyA"], ["KeyB"], ["Enter"])] * 4)

    def test_cancel_restores_korean_ime_and_releases_all_keys(self):
        def write(path, report):
            self.reports.append((path, report))
            if report == keyboard_report(["Lang1"]):
                self.entry.cancel("a")
        self.controller.writer = write
        result = self.entry.start("a", "한글", "ko", "Lang1")
        job = self.finish()
        self.assertEqual(job["state"], "cancelled")
        self.assertEqual(job["progress"], 0)
        self.assertEqual([r for p, r in self.reports if p.endswith("0") and any(r)],
                         [keyboard_report(["Lang1"])] * 2)
        self.assertEqual(self.reports[-2:], [("/dev/hidg0", bytes(8)), ("/dev/hidg1", bytes(4))])
        with self.assertRaises(KeyError):
            self.entry.cancel("a", result["job"]["id"] + "stale")

    def test_usb_failure_stops_without_retrying_or_sending_remaining_characters(self):
        def write(path, report):
            self.reports.append((path, report))
            if report == keyboard_report(["KeyB"]):
                raise OSError("device lost")
        self.controller.writer = write
        self.entry.start("a", "abcd")
        job = self.finish()
        self.assertEqual((job["state"], job["progress"]), ("failed", 1))
        down = [r for p, r in self.reports if p.endswith("0") and any(r)]
        self.assertEqual(down, [keyboard_report(["KeyA"]), keyboard_report(["KeyB"])])
        self.assertEqual(self.controller.keyboard_state, bytes(8))
        self.assertNotIn("abcd", json.dumps(job))

    def test_another_live_controller_cannot_be_displaced_and_shutdown_cancels_worker(self):
        self.controller.update({"type": "heartbeat"}, "b")
        with self.assertRaises(ControlBusyError):
            self.entry.start("a", "abc")
        self.assertEqual(self.reports, [])
        self.controller.release()
        self.entry.start("a", "a" * 100)
        self.entry.close()
        self.assertEqual(self.finish()["state"], "cancelled")
        self.assertIsNone(self.controller.owner)
