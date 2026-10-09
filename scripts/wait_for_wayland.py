#!/usr/bin/env python3
"""2026-10-09 23:35 KST: CodexCode - wait for the selected user's existing Wayland session."""
import os
from pathlib import Path
import stat
import time

socket_path = Path(os.environ["XDG_RUNTIME_DIR"]) / os.environ.get("WAYLAND_DISPLAY", "wayland-0")
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    try:
        if stat.S_ISSOCK(socket_path.stat().st_mode):
            break
    except FileNotFoundError:
        pass
    time.sleep(1)
else:
    raise SystemExit(f"Wayland desktop is not running: {socket_path}")
