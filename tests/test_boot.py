"""2026-10-09 22:35 KST: CodexCode - boot backups, repeat installs and ownership guards."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("configure_boot", Path(__file__).resolve().parents[1] / "scripts/configure_boot.py")
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


class BootTests(unittest.TestCase):
    def test_repeat_install_is_idempotent_and_preserves_other_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.txt").write_text("camera_auto_detect=1\n[cm5]\ndtoverlay=dwc2,dr_mode=host\n[all]\n")
            (root / "cmdline.txt").write_text("rootwait modules-load=i2c-dev quiet\n")
            boot.configure(root)
            config = (root / "config.txt").read_text()
            cmdline = (root / "cmdline.txt").read_text()
            boot.configure(root)
            self.assertEqual((root / "config.txt").read_text(), config)
            self.assertEqual((root / "cmdline.txt").read_text(), cmdline)
            self.assertIn("camera_auto_detect=1", config)
            self.assertIn("[cm5]\ndtoverlay=dwc2,dr_mode=host", config)
            self.assertIn("modules-load=i2c-dev,dwc2,libcomposite", cmdline)
            self.assertEqual(len(list(root.glob("*.bak"))), 2)

    def test_existing_legacy_gadget_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = "[all]\n"
            (root / "config.txt").write_text(original)
            (root / "cmdline.txt").write_text("rootwait modules-load=dwc2,g_ether\n")
            with self.assertRaises(RuntimeError):
                boot.configure(root)
            self.assertEqual((root / "config.txt").read_text(), original)


if __name__ == "__main__":
    unittest.main()
