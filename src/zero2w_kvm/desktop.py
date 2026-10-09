"""2026-10-09 23:34 KST: CodexCode - authenticated loopback WayVNC WebSocket bridge."""
import base64
import hashlib
import json
from pathlib import Path
import select
import socket
import threading


def websocket_key(headers):
    if headers.get("Upgrade", "").lower() != "websocket":
        raise ValueError("A WebSocket upgrade is required")
    if "upgrade" not in [part.strip().lower() for part in headers.get("Connection", "").split(",")]:
        raise ValueError("Connection must include Upgrade")
    if headers.get("Sec-WebSocket-Version") != "13":
        raise ValueError("WebSocket version 13 is required")
    key = headers.get("Sec-WebSocket-Key", "")
    try:
        if len(base64.b64decode(key, validate=True)) != 16:
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Invalid WebSocket key") from None
    return key


class PiDesktop:
    def __init__(self, port=6081, credentials_file="/etc/zero2w-kvm/pi-vnc.json",
                 assets="/usr/share/novnc"):
        if not 1 <= port <= 65535:
            raise ValueError("Invalid Pi desktop port")
        self.port = port
        self.credentials_file = Path(credentials_file)
        self.assets = Path(assets)
        self.slots = threading.BoundedSemaphore(4)

    def credentials(self):
        data = json.loads(self.credentials_file.read_text())
        if not isinstance(data, dict) or not all(isinstance(data.get(name), str) and data[name]
                                                 for name in ("username", "password")):
            raise ValueError("Pi VNC credentials are not configured correctly")
        return {name: data[name] for name in ("username", "password")}

    def asset(self, relative):
        # Debian noVNC uses root-owned symlinks to packaged vendor libraries.
        # Permit these trusted links, but reject traversal and serve JS modules only.
        parts = relative.split("/")
        if not parts or parts[0] not in ("core", "vendor") or any(part in ("", ".", "..") for part in parts):
            raise ValueError("Invalid noVNC asset path")
        if not relative.endswith(".js") or any("\\" in part or "\x00" in part for part in parts):
            raise ValueError("Invalid noVNC asset type")
        return (self.assets / relative).read_bytes()

    def status(self):
        configured = self.credentials_file.exists() and (self.assets / "core/rfb.js").exists()
        ready = False
        unix_family = getattr(socket, "AF_UNIX", None)
        if configured and unix_family is not None:
            try:
                with socket.socket(unix_family, socket.SOCK_STREAM) as local:
                    local.settimeout(0.2)
                    local.connect("/run/zero2w-kvm-desktop/vnc.sock")
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.2):
                    ready = True
            except OSError:
                pass
        return {"enabled": configured, "ready": ready, "backend": "WayVNC",
                "native_port": 5900, "websocket_path": "/api/pi/vnc",
                "error": None if ready else "Pi desktop service is not ready" if configured
                else "Run sudo bash scripts/setup_vnc.sh <desktop-user>"}

    def upgrade(self, key):
        backend = socket.create_connection(("127.0.0.1", self.port), timeout=3)
        try:
            # 2026-10-10 00:03 KST: use a private adapter secret, never browser credentials.
            credentials = self.credentials()
            basic = base64.b64encode(f"{credentials['username']}:{credentials['password']}".encode()).decode()
            request = (f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                       "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                       f"Sec-WebSocket-Protocol: binary\r\nAuthorization: Basic {basic}\r\n\r\n")
            backend.sendall(request.encode("ascii"))
            response = bytearray()
            while b"\r\n\r\n" not in response:
                chunk = backend.recv(4096)
                if not chunk:
                    raise OSError("WayVNC closed the WebSocket handshake")
                response.extend(chunk)
                if len(response) > 16384:
                    raise OSError("WayVNC handshake exceeded the size limit")
            header, initial = bytes(response).split(b"\r\n\r\n", 1)
            lines = header.decode("ascii").split("\r\n")
            if len(lines[0].split()) < 2 or lines[0].split()[1] != "101":
                raise OSError("WayVNC rejected the WebSocket upgrade")
            fields = dict(line.split(":", 1) for line in lines[1:] if ":" in line)
            fields = {name.lower(): value.strip() for name, value in fields.items()}
            expected = base64.b64encode(hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            if fields.get("sec-websocket-accept") != expected:
                raise OSError("Invalid WayVNC WebSocket handshake response")
            backend.settimeout(5)
            return backend, header + b"\r\n\r\n" + initial
        except Exception:
            backend.close()
            raise

    @staticmethod
    def relay(client, backend, active):
        while active():
            ready, _, _ = select.select([client, backend], [], [], 0.5)
            for source in ready:
                chunk = source.recv(65536)
                if not chunk:
                    return
                target = backend if source is client else client
                target.sendall(chunk)
