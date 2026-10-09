#!/usr/bin/env python3
"""2026-10-10 00:03 KST: CodexCode - grant only the KVM group access to the VNC socket."""
import os
from pathlib import Path
import stat
import time

target = Path('/run/zero2w-kvm-desktop/vnc.sock')
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    try:
        attributes = target.stat()
        if stat.S_ISSOCK(attributes.st_mode) and attributes.st_uid == os.getuid():
            target.chmod(0o660)
            break
    except FileNotFoundError:
        pass
    time.sleep(0.1)
else:
    raise SystemExit('VNC Unix socket was not created by the desktop service')
