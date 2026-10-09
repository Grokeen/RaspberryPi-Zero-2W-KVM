#!/bin/bash
# 2026-10-09 22:32 KST: CodexCode - deploy local source and enable boot services.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo bash scripts/install.sh" >&2
  exit 1
fi
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="$(tr -d '\0' </proc/device-tree/model)"
if [[ "$MODEL" != *"Raspberry Pi Zero 2"* ]]; then
  echo "This installer targets Raspberry Pi Zero 2 W; found: $MODEL" >&2
  exit 1
fi
# Compile and validate boot configuration before replacing an installed service.
python3 -m compileall -q "$SOURCE_ROOT/src"
python3 "$SOURCE_ROOT/scripts/configure_boot.py"
getent group kvm >/dev/null || groupadd --system kvm
id zero2w-kvm >/dev/null 2>&1 || useradd --system --gid kvm --groups video --home-dir /nonexistent --shell /usr/sbin/nologin zero2w-kvm
install -d -m 755 /opt/zero2w-kvm
install -d -m 750 -o root -g kvm /etc/zero2w-kvm
if [[ -d /opt/zero2w-kvm/zero2w_kvm ]]; then
  BACKUP_DIR="/opt/zero2w-kvm-backup-$(date +%Y%m%d-%H%M%S)"
  install -d -m 700 "$BACKUP_DIR"
  cp -a /opt/zero2w-kvm/zero2w_kvm "$BACKUP_DIR/"
fi
systemctl stop zero2w-kvm.service 2>/dev/null || true
cp -a "$SOURCE_ROOT/src/zero2w_kvm" /opt/zero2w-kvm/
chown -R root:root /opt/zero2w-kvm
chmod -R go-w /opt/zero2w-kvm
install -m 644 "$SOURCE_ROOT/systemd/99-zero2w-kvm.rules" /etc/udev/rules.d/99-zero2w-kvm.rules
install -m 644 "$SOURCE_ROOT/systemd/zero2w-kvm-gadget.service" /etc/systemd/system/zero2w-kvm-gadget.service
install -m 644 "$SOURCE_ROOT/systemd/zero2w-kvm.service" /etc/systemd/system/zero2w-kvm.service
if [[ ! -f /etc/zero2w-kvm/access.token ]]; then
  python3 -c 'import secrets; from pathlib import Path; Path("/etc/zero2w-kvm/access.token").write_text(secrets.token_urlsafe(32) + "\n")'
fi
chown root:kvm /etc/zero2w-kvm/access.token
chmod 640 /etc/zero2w-kvm/access.token
if [[ ! -f /etc/zero2w-kvm/config ]]; then
  install -m 640 -o root -g kvm "$SOURCE_ROOT/systemd/kvm.env.example" /etc/zero2w-kvm/config
fi
udevadm control --reload-rules
udevadm trigger --subsystem-match=hidg
systemctl daemon-reload
systemctl enable zero2w-kvm-gadget.service zero2w-kvm.service
if [[ -n "$(ls -A /sys/class/udc)" ]]; then
  systemctl restart zero2w-kvm-gadget.service
  systemctl start zero2w-kvm.service
  echo "Installed and started. USB descriptors will enumerate when the host is connected."
else
  echo "Installed. Reboot once to load the dwc2 peripheral overlay."
fi
echo "Console: http://<Pi-IP>:8080"
echo "Read your token locally: sudo cat /etc/zero2w-kvm/access.token"
