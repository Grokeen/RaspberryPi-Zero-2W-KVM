#!/bin/bash
# 2026-10-09 23:35 KST: CodexCode - preserve native VNC and add browser desktop service.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run: sudo bash scripts/setup_vnc.sh <desktop-user>" >&2
  exit 1
fi
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_ACCOUNT="${1:-${SUDO_USER:-}}"
if [[ ! "$DESKTOP_ACCOUNT" =~ ^[a-z_][a-z0-9_-]*$ ]] || ! id "$DESKTOP_ACCOUNT" >/dev/null 2>&1; then
  echo "Specify an existing desktop account (not root)." >&2
  exit 1
fi
DESKTOP_ID="$(id -u "$DESKTOP_ACCOUNT")"
if [[ "$DESKTOP_ID" -eq 0 || ! -d /opt/zero2w-kvm/zero2w_kvm ]]; then
  echo "Install the KVM application first and select a non-root desktop account." >&2
  exit 1
fi
if ! command -v wayvnc >/dev/null; then
  echo "WayVNC is required (Raspberry Pi OS Bookworm)." >&2
  exit 1
fi
if ! command -v wlr-randr >/dev/null; then
  echo "This browser desktop service requires a wlroots Wayland desktop." >&2
  exit 1
fi
env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends novnc websockify
getent group kvm >/dev/null
install -d -m 750 -o root -g kvm /etc/zero2w-kvm
python3 - "$SOURCE_ROOT" "$DESKTOP_ACCOUNT" "$DESKTOP_ID" <<'PY'
from datetime import datetime
import json
from pathlib import Path
import secrets
import shutil
import sys

source, account, uid = sys.argv[1:]
settings = Path('/etc/zero2w-kvm')
credentials = settings / 'pi-vnc.json'
if credentials.exists():
    data = json.loads(credentials.read_text())
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k] for k in ('username', 'password')):
        raise SystemExit('Existing VNC credentials are invalid; restore a valid file before setup')
else:
    data = {'username': 'web-console', 'password': secrets.token_urlsafe(32)}
    credentials.write_text(json.dumps(data) + '\n')
if any('\n' in data[k] or '\r' in data[k] for k in ('username', 'password')):
    raise SystemExit('VNC credentials must not contain line breaks')
configuration = settings / 'pi-vnc.conf'
text = ('# CodexCode browser VNC: loopback transport; outer KVM session authentication\n'
        '# Authentication is enforced at the KVM gateway and internal WebSocket adapter.\n'
        'address=/run/zero2w-kvm-desktop/vnc.sock\nenable_auth=false\nenable_pam=false\n')
if configuration.exists() and configuration.read_text() != text:
    backup = configuration.with_name(configuration.name + '.backup-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(configuration, backup)
configuration.write_text(text)
unit = (Path(source) / 'systemd/zero2w-kvm-desktop.service').read_text()
unit = unit.replace('@DESKTOP_USER@', account).replace('@DESKTOP_UID@', uid)
Path('/etc/systemd/system/zero2w-kvm-desktop.service').write_text(unit)
PY
chown root:kvm /etc/zero2w-kvm/pi-vnc.json /etc/zero2w-kvm/pi-vnc.conf
chmod 640 /etc/zero2w-kvm/pi-vnc.json /etc/zero2w-kvm/pi-vnc.conf
install -m 644 "$SOURCE_ROOT/scripts/wait_for_wayland.py" /opt/zero2w-kvm/wait_for_wayland.py
install -m 644 "$SOURCE_ROOT/scripts/prepare_vnc_socket.py" /opt/zero2w-kvm/prepare_vnc_socket.py
install -m 644 "$SOURCE_ROOT/systemd/zero2w-kvm-desktop-proxy.service" /etc/systemd/system/zero2w-kvm-desktop-proxy.service
# Enable the OS-provided VNC service while retaining its own authentication settings.
if [[ "$(raspi-config nonint get_vnc)" != "0" ]]; then
  raspi-config nonint do_vnc 0
fi
systemctl daemon-reload
systemctl enable zero2w-kvm-desktop.service zero2w-kvm-desktop-proxy.service
systemctl stop zero2w-kvm-desktop-proxy.service 2>/dev/null || true
systemctl restart zero2w-kvm-desktop.service
systemctl start zero2w-kvm-desktop-proxy.service
systemctl restart zero2w-kvm.service
echo "Pi browser desktop: http://<Pi-IP>:8080/pi"
echo "Native VNC: <Pi-IP>:5900 (existing OS authentication)"
echo "Private VNC uses a group-restricted Unix socket. The authenticated adapter listens on 127.0.0.1:6081."
