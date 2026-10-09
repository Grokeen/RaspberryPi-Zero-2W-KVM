"""2026-10-09 22:22 KST: CodexCode - owned configfs USB keyboard/mouse lifecycle."""
import argparse
import os
from pathlib import Path
import subprocess
import time
from .hid import KEYBOARD_DESCRIPTOR, MOUSE_DESCRIPTOR

BASE = Path("/sys/kernel/config/usb_gadget")
GADGET = BASE / "zero2w_kvm"


def put(path, value):
    if isinstance(value, bytes):
        path.write_bytes(value)
    else:
        path.write_text(str(value))


def stop():
    if not GADGET.exists():
        return
    if (GADGET / "UDC").read_text().strip():
        put(GADGET / "UDC", "\n")
    for link in (GADGET / "configs/c.1").glob("hid.*"):
        link.unlink()
    for relative in ["configs/c.1/strings/0x409", "configs/c.1", "functions/hid.usb0",
                     "functions/hid.usb1", "strings/0x409"]:
        directory = GADGET / relative
        if directory.exists():
            directory.rmdir()
    GADGET.rmdir()


def start():
    subprocess.run(["modprobe", "dwc2"], check=True)
    subprocess.run(["modprobe", "libcomposite"], check=True)
    if not os.path.ismount("/sys/kernel/config"):
        subprocess.run(["mount", "-t", "configfs", "none", "/sys/kernel/config"], check=True)
    controllers = list(Path("/sys/class/udc").iterdir())
    if not controllers:
        raise RuntimeError("No USB device controller. Enable dwc2 peripheral mode and reboot.")
    for gadget in BASE.iterdir():
        if gadget != GADGET:
            if (gadget / "UDC").read_text().strip() or list((gadget / "functions").glob("hid.*")):
                raise RuntimeError(f"USB/HID controller already belongs to {gadget.name}; refusing to replace it")
    if GADGET.exists() and (GADGET / "UDC").read_text().strip():
        return
    stop()
    GADGET.mkdir()
    # Linux Foundation example VID/PID: prototype use, not an assigned production USB identity.
    for name, value in {"idVendor": "0x1d6b", "idProduct": "0x0104",
                        "bcdDevice": "0x0100", "bcdUSB": "0x0200"}.items():
        put(GADGET / name, value)
    strings = GADGET / "strings/0x409"
    strings.mkdir()
    serial = Path("/proc/device-tree/serial-number")
    put(strings / "serialnumber", serial.read_bytes().decode().strip("\x00") if serial.exists() else "zero2w-kvm")
    put(strings / "manufacturer", "CodexCode")
    put(strings / "product", "Zero 2 W KVM Keyboard and Mouse")
    config = GADGET / "configs/c.1"
    (config / "strings/0x409").mkdir(parents=True)
    put(config / "strings/0x409/configuration", "USB keyboard + mouse")
    put(config / "MaxPower", "250")
    for name, protocol, descriptor, length in [
        ("hid.usb0", 1, KEYBOARD_DESCRIPTOR, 8),
        ("hid.usb1", 2, MOUSE_DESCRIPTOR, 4),
    ]:
        function = GADGET / "functions" / name
        function.mkdir()
        put(function / "protocol", protocol)
        put(function / "subclass", 1)
        put(function / "report_length", length)
        put(function / "report_desc", descriptor)
        if (function / "no_out_endpoint").exists():
            put(function / "no_out_endpoint", 1)
        (config / name).symlink_to(function)
    put(GADGET / "UDC", controllers[0].name)
    for _ in range(30):
        if Path("/dev/hidg0").exists() and Path("/dev/hidg1").exists():
            return
        time.sleep(0.1)
    raise RuntimeError("USB gadget bound, but HID device nodes were not created")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop"])
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("USB gadget setup requires root")
    start() if args.action == "start" else stop()
