"""2026-10-09 22:22 KST: CodexCode - HID reports, bounded I/O and stuck-key recovery."""
import os
import errno
import select
import struct
import threading
import time
from pathlib import Path

# Standard boot keyboard (8 bytes) and relative mouse with wheel (4 bytes).
KEYBOARD_DESCRIPTOR = bytes.fromhex(
    "05010906a101050719e029e715002501750195088102950175088103"
    "9505750105081901290591029501750391039506750815002565"
    "0507190029658100c0"
)
MOUSE_DESCRIPTOR = bytes.fromhex(
    "05010902a1010901a10005091901290315002501950375018102"
    "95017505810305010930093109381581257f750895038106c0c0"
)
MODIFIERS = {code: 1 << index for index, code in enumerate([
    "ControlLeft", "ShiftLeft", "AltLeft", "MetaLeft",
    "ControlRight", "ShiftRight", "AltRight", "MetaRight",
])}
KEYS = {f"Key{chr(65 + i)}": 4 + i for i in range(26)}
KEYS.update({f"Digit{n}": 29 + n for n in range(1, 10)})
KEYS.update({f"F{n}": 57 + n for n in range(1, 13)})
KEYS.update({
    "Digit0": 39, "Enter": 40, "Escape": 41, "Backspace": 42,
    "Tab": 43, "Space": 44, "Minus": 45, "Equal": 46,
    "BracketLeft": 47, "BracketRight": 48, "Backslash": 49,
    "Semicolon": 51, "Quote": 52, "Backquote": 53, "Comma": 54,
    "Period": 55, "Slash": 56, "CapsLock": 57, "PrintScreen": 70,
    "ScrollLock": 71, "Pause": 72, "Insert": 73, "Home": 74,
    "PageUp": 75, "Delete": 76, "End": 77, "PageDown": 78,
    "ArrowRight": 79, "ArrowLeft": 80, "ArrowDown": 81, "ArrowUp": 82,
    "NumLock": 83, "NumpadDivide": 84, "NumpadMultiply": 85,
    "NumpadSubtract": 86, "NumpadAdd": 87, "NumpadEnter": 88,
    "Numpad0": 98, "NumpadDecimal": 99, "IntlBackslash": 100,
    "ContextMenu": 101,
})
KEYS.update({f"Numpad{n}": 88 + n for n in range(1, 10)})


def integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer in {minimum}..{maximum}")
    return value


def keyboard_report(codes):
    if not isinstance(codes, list) or len(codes) > 14:
        raise ValueError("codes must be a list of at most 14 physical key codes")
    modifiers, keys = 0, []
    for code in codes:
        if not isinstance(code, str):
            raise ValueError("key codes must be strings")
        if code in MODIFIERS:
            modifiers |= MODIFIERS[code]
        elif code in KEYS:
            if KEYS[code] not in keys:
                keys.append(KEYS[code])
        else:
            raise ValueError(f"Unsupported key: {code}")
    if len(keys) > 6:
        raise ValueError("USB boot keyboard supports six non-modifier keys at once")
    return bytes([modifiers, 0, *keys, *([0] * (6 - len(keys)))])


def mouse_reports(x=0, y=0, buttons=0, wheel=0):
    values = [integer(x, "x", -2048, 2048), integer(y, "y", -2048, 2048),
              integer(wheel, "wheel", -127, 127)]
    integer(buttons, "buttons", 0, 7)
    reports = []
    while True:
        step = [max(-127, min(127, value)) for value in values]
        reports.append(struct.pack("Bbbb", buttons, *step))
        values = [value - part for value, part in zip(values, step)]
        if not any(values):
            return reports


class DeviceWriter:
    def __init__(self, timeout=0.25):
        self.timeout = timeout

    def __call__(self, path, report):
        fd = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
        try:
            deadline = time.monotonic() + self.timeout
            while True:
                try:
                    if os.write(fd, report) != len(report):
                        raise OSError("Incomplete HID report")
                    return
                except BlockingIOError:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not select.select([], [fd], [], remaining)[1]:
                        raise TimeoutError("USB host is not reading HID reports")
        finally:
            os.close(fd)


class ControlBusyError(Exception):
    """An authenticated session already owns the input lease."""


class USBDisconnectedError(OSError):
    """2026-10-10 00:24 KST: reject input until the target USB host configures HID."""
    def __init__(self):
        super().__init__(errno.ENOTCONN, "USB target is not configured")


def read_usb_state():
    for state in Path("/sys/class/udc").glob("*/state"):
        try:
            return state.read_text().strip()
        except OSError:
            continue
    return None


class Controller:
    def __init__(self, keyboard="/dev/hidg0", mouse="/dev/hidg1", writer=None, clock=time.monotonic,
                 state_reader=read_usb_state):
        self.keyboard, self.mouse = keyboard, mouse
        self.writer = writer or DeviceWriter()
        self.clock = clock
        self.state_reader = state_reader
        self.lock = threading.RLock()
        self.last_input = clock()
        self.keyboard_state = bytes(8)
        self.buttons = 0
        self.owner = None
        self.error = None

    def _write(self, device, report):
        try:
            self.writer(device, report)
            self.error = None
        except OSError as error:
            self.error = str(error)
            raise

    def _claim(self, owner):
        if self.owner is not None and self.owner != owner:
            raise ControlBusyError("Another browser is controlling the USB host")
        self.owner = owner

    def update(self, event, owner):
        if not isinstance(event, dict):
            raise ValueError("event must be an object")
        kind = event.get("type")
        # Validate the complete event before changing any state or writing reports.
        if kind in ("keyboard", "tap"):
            report = keyboard_report(event.get("codes"))
        elif kind == "mouse":
            reports = mouse_reports(event.get("x", 0), event.get("y", 0),
                                    event.get("buttons", 0), event.get("wheel", 0))
        elif kind not in ("release", "heartbeat"):
            raise ValueError("Unknown input event type")
        with self.lock:
            # 2026-10-10 00:24 KST: heartbeat must not acquire disconnected hardware.
            if kind != "release" and self.state_reader() != "configured":
                raise USBDisconnectedError()
            self._claim(owner)
            self.last_input = self.clock()
            if kind == "keyboard":
                # Retain a nonzero state even if the host disappears; watchdog retries release.
                self.keyboard_state = report
                self._write(self.keyboard, report)
            elif kind == "tap":
                self.keyboard_state = report
                try:
                    self._write(self.keyboard, report)
                    time.sleep(0.035)
                finally:
                    self._write(self.keyboard, bytes(8))
                    self.keyboard_state = bytes(8)
            elif kind == "mouse":
                self.buttons = event.get("buttons", 0)
                for report in reports:
                    self._write(self.mouse, report)
            elif kind == "release":
                self.release()

    def release(self):
        with self.lock:
            if self.state_reader() != "configured" and not any(self.keyboard_state) and not self.buttons:
                self.owner = None
                return
            first_error = None
            for path, report in [(self.keyboard, bytes(8)), (self.mouse, bytes(4))]:
                try:
                    self._write(path, report)
                    if path == self.keyboard:
                        self.keyboard_state = bytes(8)
                    else:
                        self.buttons = 0
                except OSError as error:
                    first_error = first_error or error
            self.owner = None
            if first_error:
                raise first_error

    def expire(self, timeout=2.5):
        with self.lock:
            if self.clock() - self.last_input > timeout:
                if self.owner is not None or any(self.keyboard_state) or self.buttons:
                    self.release()

    def status(self):
        usb_state = self.state_reader()
        with self.lock:
            return {"keyboard": Path(self.keyboard).exists(), "mouse": Path(self.mouse).exists(),
                    "usb_state": usb_state, "controlling": self.owner is not None,
                    "error": self.error}
